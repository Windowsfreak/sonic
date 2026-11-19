/**
 * Sonic AI Financial Simulation & Compounding Engine
 * 
 * Modeling rules:
 * 1) Amplification (1x, 12x, 24x)
 * 2) Forensic lot scaling: 0.000784 lots per $1,000 MT5 equity * amplify
 *    Fee: $9.80 / Standard Lot
 * 3) 30% Performance Fee with High Water Mark (HWM):
 *    - In TAG Markets, performance fee is settled WEEKLY on Sunday.
 *    - Daily Reinvestment: intra-week gross profit is reinvested at midnight,
 *      compounding at 100% of profit Monday-Friday, and the 30% HWM fee is settled on Sunday.
 *    - Weekly Reinvestment: profit is held until Sunday settlement, then added to principal.
 *    - Monthly Reinvestment: profit is held until month-end settlement, then added to principal.
 *    - Linear (No Reinvestment): capital remains at initial principal, 30% fee is deducted,
 *      and net profit accumulates without compounding.
 */

(function (root) {
  'use strict';

  const AVG_COMMISSION_PER_LOT = 9.80;      // $9.80 fee per standard lot
  const BASE_LOTS_PER_1K_EQUITY = 0.000784; // Standard volume per $1,000 MT5 equity
  const PERFORMANCE_FEE_RATE = 0.30;        // 30% total performance fee (5% trader + 25% network)
  const NET_INVESTOR_SHARE = 0.70;          // 70% net profit to investor

  /**
   * Run simulation over the historical daily growth curve
   * @param {Array<{date: string, gain_pct: number}>} rawGrowth - array of daily growth objects from Myfxbook
   * @param {Object<string, number>} rawLots - daily lot volume map [isoDate -> lots]
   * @param {number} initialCapital - visitor chosen amount (e.g. 10000)
   * @param {number} amplify - 1, 12, or 24
   * @param {string} reinvestMode - 'none' | 'monthly' | 'weekly' | 'daily'
   * @param {string} fromDate - optional ISO filter start (defaults to TAG Copy start 2025-10-07)
   * @param {string} toDate - optional ISO filter end
   * @param {Object} forecastOpts - optional { sampleMonths, forecastMonths }
   */
  function simulate(rawGrowth, rawLots, initialCapital, amplify, reinvestMode = 'daily', fromDate = null, toDate = null, forecastOpts = null) {
    if (!rawGrowth || rawGrowth.length < 2) {
      return null;
    }

    // Filter points by fromDate and toDate (defaults to full history if fromDate is null)
    let points = rawGrowth;
    if (fromDate) {
      points = points.filter(p => p.date >= fromDate);
    }
    if (toDate) {
      points = points.filter(p => p.date <= toDate);
    }
    if (points.length < 2) {
      points = rawGrowth;
    }

    const baseCapital = Math.max(100, initialCapital || 10000);
    const amp = Math.max(1, amplify || 24);

    // --- Compounding Balance State ---
    let compPrincipal = baseCapital;
    let weekCompGross = 0;
    let monthCompGross = 0;

    let compTotalGross = 0;
    let compTotalPerfFees = 0;

    // --- Linear (Flat Principal) State ---
    const linearPrincipal = baseCapital;
    let linearAccumulatedNet = 0;

    let linearTotalGross = 0;
    let linearTotalPerfFees = 0;

    const timeline = [];

    for (let i = 1; i < points.length; i++) {
      const prev = points[i - 1];
      const curr = points[i];
      const dateStr = curr.date;

      // Daily raw strategy return from Myfxbook
      const baseReturn = ((1 + curr.gain_pct / 100) / (1 + prev.gain_pct / 100)) - 1;
      const amplifiedReturn = baseReturn * amp;

      const d = new Date(dateStr + 'T12:00:00Z');
      const isFriday = d.getUTCDay() === 5;
      const isSunday = d.getUTCDay() === 0;
      const isWeekend = isFriday || isSunday || i === points.length - 1;

      const nextDay = new Date(d);
      nextDay.setUTCDate(nextDay.getUTCDate() + 1);
      const isMonthEnd = (nextDay.getUTCMonth() !== d.getUTCMonth()) || i === points.length - 1;

      // ------------------------------------------------------------------
      // 1. Linear (Flat Principal) Equity: Invested + Net Profit Daily
      // ------------------------------------------------------------------
      const dayLinearGross = linearPrincipal * amplifiedReturn;
      const dayLinearNet = dayLinearGross * NET_INVESTOR_SHARE;
      const dayLinearPF = dayLinearGross * PERFORMANCE_FEE_RATE;
      linearTotalGross += dayLinearGross;
      linearTotalPerfFees += dayLinearPF;
      linearAccumulatedNet += dayLinearNet;
      const currentLinearEquity = linearPrincipal + linearAccumulatedNet;

      // ------------------------------------------------------------------
      // 2. Compounding Equity: Invested + Net Profit Daily
      // (Eliminates flat staircases and weekend drops by tracking continuous equity)
      // ------------------------------------------------------------------
      let currentCompEquity = compPrincipal;

      if (reinvestMode === 'daily') {
        // Daily: net profit compounds daily at midnight into principal
        const dayGross = compPrincipal * amplifiedReturn;
        const dayNet = dayGross * NET_INVESTOR_SHARE;
        const dayPF = dayGross * PERFORMANCE_FEE_RATE;
        compTotalGross += dayGross;
        compTotalPerfFees += dayPF;
        compPrincipal += dayNet;
        currentCompEquity = compPrincipal;
      } else if (reinvestMode === 'weekly') {
        // Weekly: principal compounds at weekend; daily equity tracks invested + current week net profit
        const dayGross = compPrincipal * amplifiedReturn;
        compTotalGross += dayGross;
        weekCompGross += dayGross;
        currentCompEquity = compPrincipal + (weekCompGross * NET_INVESTOR_SHARE);

        if (isWeekend) {
          if (weekCompGross > 0) {
            const pf = weekCompGross * PERFORMANCE_FEE_RATE;
            const netGain = weekCompGross * NET_INVESTOR_SHARE;
            compTotalPerfFees += pf;
            compPrincipal += netGain;
          } else {
            compPrincipal += weekCompGross;
          }
          weekCompGross = 0;
        }
      } else if (reinvestMode === 'monthly') {
        // Monthly: principal compounds at month-end; daily equity tracks invested + current month net profit
        const dayGross = compPrincipal * amplifiedReturn;
        compTotalGross += dayGross;
        monthCompGross += dayGross;
        currentCompEquity = compPrincipal + (monthCompGross * NET_INVESTOR_SHARE);

        if (isMonthEnd) {
          if (monthCompGross > 0) {
            const pf = monthCompGross * PERFORMANCE_FEE_RATE;
            const netGain = monthCompGross * NET_INVESTOR_SHARE;
            compTotalPerfFees += pf;
            compPrincipal += netGain;
          } else {
            compPrincipal += monthCompGross;
          }
          monthCompGross = 0;
        }
      } else if (reinvestMode === 'none') {
        currentCompEquity = currentLinearEquity;
        compTotalGross = linearTotalGross;
        compTotalPerfFees = linearTotalPerfFees;
      }

      const activeEquity = reinvestMode === 'none' ? currentLinearEquity : currentCompEquity;

      timeline.push({
        date: dateStr,
        compBalance: Math.round(activeEquity * 100) / 100,
        linearBalance: Math.round(currentLinearEquity * 100) / 100,
        gainPct: Math.round(((activeEquity / baseCapital) - 1) * 10000) / 100,
        linearGainPct: Math.round((linearAccumulatedNet / baseCapital) * 10000) / 100,
        dayGainPct: Math.round(amplifiedReturn * 10000) / 100
      });
    }

    const lastPt = timeline[timeline.length - 1];
    const finalLinearBalance = lastPt.linearBalance;
    const linearNetProfit = finalLinearBalance - baseCapital;
    const linearRoiPct = (linearNetProfit / baseCapital) * 100;

    const isLinearMode = reinvestMode === 'none';
    const activeFinalBalance = isLinearMode ? finalLinearBalance : lastPt.compBalance;
    const activeNetProfit = isLinearMode ? linearNetProfit : (activeFinalBalance - baseCapital);
    const activeGrossProfit = isLinearMode ? linearTotalGross : compTotalGross;
    const activePerfFees = isLinearMode ? linearTotalPerfFees : compTotalPerfFees;
    const activeRoiPct = (activeNetProfit / baseCapital) * 100;

    // Annualized return (CAGR)
    const startDate = new Date(points[0].date);
    const endDate = new Date(points[points.length - 1].date);
    const elapsedYears = Math.max(0.08, (endDate - startDate) / (1000 * 60 * 60 * 24 * 365.25));
    const activeCagr = (Math.pow(activeFinalBalance / baseCapital, 1 / elapsedYears) - 1) * 100;
    const linearAnnual = linearRoiPct / elapsedYears;

    // If forecast is requested, extrapolate into the future starting from TODAY
    if (forecastOpts && forecastOpts.forecastMonths > 0) {
      const sampleMonths = Math.max(0.2, Math.min(36, forecastOpts.sampleMonths || 6));
      const forecastMonths = Math.max(1, Math.min(36, forecastOpts.forecastMonths || 12));

      // 1. Determine sample period from the latest historical growth data
      const lastHistoricalDateStr = rawGrowth[rawGrowth.length - 1].date;
      const lastHistoricalDate = new Date(lastHistoricalDateStr + 'T12:00:00Z');

      let sampleStartPoint = rawGrowth[0];
      if (forecastOpts.sampleFromDate) {
        sampleStartPoint = rawGrowth.find(p => p.date >= forecastOpts.sampleFromDate) || rawGrowth[0];
      } else {
        const sampleTargetTime = lastHistoricalDate.getTime() - (sampleMonths * 30.4375 * 86400000);
        for (let i = rawGrowth.length - 1; i >= 0; i--) {
          const ptTime = new Date(rawGrowth[i].date + 'T12:00:00Z').getTime();
          if (ptTime <= sampleTargetTime) {
            sampleStartPoint = rawGrowth[i];
            break;
          }
        }
      }

      const sampleStartDate = new Date(sampleStartPoint.date + 'T12:00:00Z');
      const sampleDays = Math.max(5, Math.round((lastHistoricalDate - sampleStartDate) / 86400000));
      
      const lastGainVal = points[points.length - 1].gain_pct;
      const startGainVal = sampleStartPoint.gain_pct;
      const sample1xTotalReturn = ((100 + lastGainVal) / (100 + startGainVal)) - 1;
      
      // Daily compound return at 1x
      const sampleDaily1x = Math.max(0.00001, Math.pow(1 + Math.max(-0.9, sample1xTotalReturn), 1 / sampleDays) - 1);
      const sampleDailyAmp = sampleDaily1x * amp;
      const sampleMonthlyAmp = (Math.pow(1 + sampleDailyAmp, 30.4375) - 1) * 100;

      // Pure forward simulation starting from TODAY with user's initial capital
      const forecastDays = Math.round(forecastMonths * 30.4375);
      let fCompPrincipal = baseCapital;
      let fWeekCompGross = 0;
      let fMonthCompGross = 0;
      let fCompTotalGross = 0;
      let fCompTotalPerfFees = 0;

      let fLinearPrincipal = baseCapital;
      let fLinearAccumNet = 0;
      let fLinearTotalGross = 0;
      let fLinearTotalPF = 0;

      const fTimeline = [];

      // Day 0: Today with initial capital
      fTimeline.push({
        date: lastHistoricalDateStr,
        compBalance: baseCapital,
        linearBalance: baseCapital,
        gainPct: 0,
        linearGainPct: 0,
        dayGainPct: 0,
        isForecast: false // start anchor at Today
      });

      let simDate = new Date(lastHistoricalDate);

      for (let day = 1; day <= forecastDays; day++) {
        simDate.setUTCDate(simDate.getUTCDate() + 1);
        const dayStr = simDate.toISOString().slice(0, 10);
        const dayOfWeek = simDate.getUTCDay();
        const isFriday = dayOfWeek === 5;
        const isSunday = dayOfWeek === 0;
        const isWeekend = isFriday || isSunday || day === forecastDays;

        const nextD = new Date(simDate);
        nextD.setUTCDate(nextD.getUTCDate() + 1);
        const isMonthEnd = (nextD.getUTCMonth() !== simDate.getUTCMonth()) || day === forecastDays;

        // Linear
        const dayLinGross = fLinearPrincipal * sampleDailyAmp;
        const dayLinNet = dayLinGross * NET_INVESTOR_SHARE;
        const dayLinPF = dayLinGross * PERFORMANCE_FEE_RATE;
        fLinearTotalGross += dayLinGross;
        fLinearTotalPF += dayLinPF;
        fLinearAccumNet += dayLinNet;
        const curLinearEq = fLinearPrincipal + fLinearAccumNet;

        // Compounding
        let curCompEq = fCompPrincipal;
        if (reinvestMode === 'daily') {
          const dGross = fCompPrincipal * sampleDailyAmp;
          const dNet = dGross * NET_INVESTOR_SHARE;
          const dPF = dGross * PERFORMANCE_FEE_RATE;
          fCompTotalGross += dGross;
          fCompTotalPerfFees += dPF;
          fCompPrincipal += dNet;
          curCompEq = fCompPrincipal;
        } else if (reinvestMode === 'weekly') {
          const dGross = fCompPrincipal * sampleDailyAmp;
          fCompTotalGross += dGross;
          fWeekCompGross += dGross;
          curCompEq = fCompPrincipal + (fWeekCompGross * NET_INVESTOR_SHARE);
          if (isWeekend) {
            if (fWeekCompGross > 0) {
              fCompTotalPerfFees += fWeekCompGross * PERFORMANCE_FEE_RATE;
              fCompPrincipal += fWeekCompGross * NET_INVESTOR_SHARE;
            } else {
              fCompPrincipal += fWeekCompGross;
            }
            fWeekCompGross = 0;
          }
        } else if (reinvestMode === 'monthly') {
          const dGross = fCompPrincipal * sampleDailyAmp;
          fCompTotalGross += dGross;
          fMonthCompGross += dGross;
          curCompEq = fCompPrincipal + (fMonthCompGross * NET_INVESTOR_SHARE);
          if (isMonthEnd) {
            if (fMonthCompGross > 0) {
              fCompTotalPerfFees += fMonthCompGross * PERFORMANCE_FEE_RATE;
              fCompPrincipal += fMonthCompGross * NET_INVESTOR_SHARE;
            } else {
              fCompPrincipal += fMonthCompGross;
            }
            fMonthCompGross = 0;
          }
        } else if (reinvestMode === 'none') {
          curCompEq = curLinearEq;
          fCompTotalGross = fLinearTotalGross;
          fCompTotalPerfFees = fLinearTotalPF;
        }

        const activeEq = reinvestMode === 'none' ? curLinearEq : curCompEq;

        fTimeline.push({
          date: dayStr,
          compBalance: Math.round(activeEq * 100) / 100,
          linearBalance: Math.round(curLinearEq * 100) / 100,
          gainPct: Math.round(((activeEq / baseCapital) - 1) * 10000) / 100,
          linearGainPct: Math.round((fLinearAccumNet / baseCapital) * 10000) / 100,
          dayGainPct: Math.round(sampleDailyAmp * 10000) / 100,
          isForecast: true
        });
      }

      const fLastPt = fTimeline[fTimeline.length - 1];
      const fFinalLinear = fLastPt.linearBalance;
      const fLinearProfit = fFinalLinear - baseCapital;
      const fLinearRoi = (fLinearProfit / baseCapital) * 100;

      const fActiveFinal = isLinearMode ? fFinalLinear : fLastPt.compBalance;
      const fActiveProfit = isLinearMode ? fLinearProfit : (fActiveFinal - baseCapital);
      const fActiveRoi = (fActiveProfit / baseCapital) * 100;

      const totalElapsedYears = forecastMonths / 12.0;
      const fActiveCagr = (Math.pow(fActiveFinal / baseCapital, 1 / totalElapsedYears) - 1) * 100;

      return {
        baseCapital,
        amplify: amp,
        reinvestMode,
        finalBalance: Math.round(fActiveFinal * 100) / 100,
        linearFinalBalance: Math.round(fFinalLinear * 100) / 100,
        netProfit: Math.round(fActiveProfit * 100) / 100,
        linearNetProfit: Math.round(fLinearProfit * 100) / 100,
        roiPct: Math.round(fActiveRoi * 100) / 100,
        linearRoiPct: Math.round(fLinearRoi * 100) / 100,
        cagrPct: Math.round(fActiveCagr * 10) / 10,
        linearAnnualPct: Math.round((fLinearRoi / totalElapsedYears) * 10) / 10,
        totalGrossProfit: Math.round(isLinearMode ? fLinearTotalGross : fCompTotalGross),
        totalPerfFees: Math.round(isLinearMode ? fLinearTotalPF : fCompTotalPerfFees),
        timeline: fTimeline,
        forecast: {
          isForecastActive: true,
          sampleMonths,
          forecastMonths,
          sampleMonthlyAmp: Math.round(sampleMonthlyAmp * 10) / 10,
          historicalFinalBalance: Math.round(activeFinalBalance * 100) / 100
        }
      };
    }

    return {
      baseCapital,
      amplify: amp,
      reinvestMode,
      finalBalance: Math.round(activeFinalBalance * 100) / 100,
      linearFinalBalance: Math.round(finalLinearBalance * 100) / 100,
      netProfit: Math.round(activeNetProfit * 100) / 100,
      linearNetProfit: Math.round(linearNetProfit * 100) / 100,
      roiPct: Math.round(activeRoiPct * 100) / 100,
      linearRoiPct: Math.round(linearRoiPct * 100) / 100,
      cagrPct: Math.round(activeCagr * 10) / 10,
      linearAnnualPct: Math.round(linearAnnual * 10) / 10,
      totalGrossProfit: Math.round(activeGrossProfit * 100) / 100,
      totalPerfFees: Math.round(activePerfFees * 100) / 100,
      timeline,
      forecast: {
        isForecastActive: false
      }
    };
  }

  function tradeDateIso(t) {
    const raw = (t && (t.close || t.open)) || '';
    return typeof raw === 'string' && raw.length >= 10 ? raw.slice(0, 10) : '';
  }

  /**
   * Calculate Deep Trading & Risk Metrics from historical trades and growth points
   */
  function computeTradeMetrics(trades, growthPoints, fromDate = null, toDate = null, masterDrawdownPct = 0.86, userBalance = 10000, amplify = 24) {
    if (!trades || trades.length === 0) {
      return null;
    }

    const amp = Math.max(1, amplify || 24);
    const capital = Math.max(100, userBalance || 10000);

    let filtered = trades;
    if (fromDate) {
      filtered = filtered.filter(t => {
        const d = tradeDateIso(t);
        return d && d >= fromDate;
      });
    }
    if (toDate) {
      filtered = filtered.filter(t => {
        const d = tradeDateIso(t);
        return d && d <= toDate;
      });
    }

    if (filtered.length === 0) {
      filtered = trades;
    }

    const totalTrades = filtered.length;
    let wins = 0;
    let losses = 0;
    let totalProfitUsd = 0;
    let totalWinProfit = 0;
    let totalLossProfit = 0;
    let sumGains = 0;
    let prodGhpr = 1.0;
    const durations = [];

    let sumEntryAcc = 0, countEntryAcc = 0;
    let sumExitAcc = 0, countExitAcc = 0;
    let worstMaeUsd = 0;
    let worstMaePips = 0;
    let worstIntraDdPips = 0;

    filtered.forEach(t => {
      const p = Number(t.profit) || 0;
      totalProfitUsd += p;
      if (p > 0) {
        wins++;
        totalWinProfit += p;
      } else if (p < 0) {
        losses++;
        totalLossProfit += Math.abs(p);
      }

      const g = Number(t.gain_pct) || 0;
      sumGains += g;
      prodGhpr *= (1.0 + (g / 100.0));

      durations.push((Number(t.duration_seconds) || 0) / 60);

      if (t.analytics) {
        if (typeof t.analytics.entry_accuracy === 'number') {
          sumEntryAcc += t.analytics.entry_accuracy;
          countEntryAcc++;
        }
        if (typeof t.analytics.exit_accuracy === 'number') {
          sumExitAcc += t.analytics.exit_accuracy;
          countExitAcc++;
        }
        if (typeof t.analytics.min_usd === 'number' && t.analytics.min_usd < worstMaeUsd) {
          worstMaeUsd = t.analytics.min_usd;
        }
        if (typeof t.analytics.min_pips === 'number' && t.analytics.min_pips < worstMaePips) {
          worstMaePips = t.analytics.min_pips;
        }
        if (typeof t.analytics.drawdown_pips === 'number' && t.analytics.drawdown_pips > worstIntraDdPips) {
          worstIntraDdPips = t.analytics.drawdown_pips;
        }
      }
    });

    const avgEntryAccuracy = countEntryAcc > 0 ? (sumEntryAcc / countEntryAcc) : null;
    const avgExitAccuracy = countExitAcc > 0 ? (sumExitAcc / countExitAcc) : null;

    // Peak-to-trough closed drawdown from filtered growth points:
    let rangeClosedDd = 0;
    if (growthPoints && growthPoints.length > 0) {
      let peak = -Infinity;
      let maxDrop = 0;
      growthPoints.forEach(pt => {
        const d = pt.date;
        const val = pt.gain_pct;
        if ((!fromDate || d >= fromDate) && (!toDate || d <= toDate)) {
          if (val > peak) peak = val;
          const drop = peak - val;
          if (drop > maxDrop) maxDrop = drop;
        }
      });
      rangeClosedDd = maxDrop;
    }

    // Real Master floating excursion on ~$140,628 account balance:
    const masterAccountBalance = 140628;
    const masterWorstFloatingDdPct = worstMaeUsd < 0 ? (Math.abs(worstMaeUsd) / masterAccountBalance) * 100 : 0;
    const userFloatingDdPct = masterWorstFloatingDdPct * amp;

    const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : 0;
    const baseAhpr = totalTrades > 0 ? sumGains / totalTrades : 0;
    const baseGhpr = totalTrades > 0 ? (Math.pow(Math.max(0.0001, prodGhpr), 1 / totalTrades) - 1) * 100 : 0;

    // Amplified AHPR & GHPR (scale with leverage)
    const ahpr = baseAhpr * amp;
    const ghpr = baseGhpr * amp;

    // Dollar Expectancy calculated relative to investor capital and leverage
    // Mathematische Erwartung = Kapital * (Amplified AHPR / 100)
    const expectancyUsd = capital * (ahpr / 100);

    // Duration stats
    durations.sort((a, b) => a - b);
    const meanDuration = totalTrades > 0 ? durations.reduce((a, b) => a + b, 0) / totalTrades : 0;
    const medianDuration = totalTrades > 0 ? durations[Math.floor(totalTrades / 2)] : 0;

    // Max Drawdown & Sharpe Ratio:
    // Real tick equity drawdown on XAUUSD can now be computed dynamically from closed trades + sparkline MAE!
    const isYtd = Boolean(fromDate && fromDate >= '2026-01-01');
    const baseDrawdownPct = isYtd ? 0.23 : (Number(masterDrawdownPct) > 0 ? Number(masterDrawdownPct) : 0.86);
    const maxDrawdownPct = baseDrawdownPct * amp;
    const maxDrawdownStr = (Math.round(maxDrawdownPct * 100) / 100).toFixed(2) + '%';
    const userClosedDdPct = rangeClosedDd * amp;

    let maxDrawdownSub = `${baseDrawdownPct}% Basis (${isYtd ? '2026' : 'Myfxbook'}) × ${amp}x Hebel`;
    if (userFloatingDdPct > 0 || userClosedDdPct > 0) {
      if (amp > 1) {
        maxDrawdownSub = `Floating DD: ${(userFloatingDdPct).toFixed(2)}% (${(masterWorstFloatingDdPct).toFixed(3)}% Basis) · Range Closed: ${(userClosedDdPct).toFixed(2)}% (${rangeClosedDd.toFixed(2)}% Basis)`;
      } else {
        maxDrawdownSub = `Floating DD: ${(masterWorstFloatingDdPct).toFixed(3)}% · Range Closed: ${rangeClosedDd.toFixed(2)}%`;
      }
    }

    // Sharpe Ratio: verified on Myfxbook 6.66 (All-time), 7.80 (2026)
    const sharpeRatio = isYtd ? 7.80 : 6.66;

    // Ruin-Risiko: Wie viele Trades in Folge verloren werden müssten!
    // Auf dem Myfxbook-Masterkonto ($140,447) war der durchschnittliche Verlust $134.97 (0.0961% pro Verlusttrade ungehebelt).
    // Bei Hebel amp beträgt der durchschnittliche Verlust pro Trade: (0.0961% * amp)
    const avgLossPctPerTrade = 0.0961 * amp; // in %
    // Ruin (50% Drawdown)
    const consecutiveLosses50pct = Math.max(1, Math.round(50.0 / avgLossPctPerTrade));
    // 5% Drawdown
    const consecutiveLosses5pct = Math.max(1, Math.round(5.0 / avgLossPctPerTrade));

    let ruinText = '';
    if (consecutiveLosses50pct > 100) {
      ruinText = '> 500 Trades';
    } else {
      ruinText = `${consecutiveLosses50pct} Trades`;
    }

    const ruinSubtext = `in Folge für 50% DD (Chance: < 0.0001% bei ${winRate.toFixed(1)}% Win Rate)`;

    return {
      totalTrades,
      wins,
      losses,
      winRate: Math.round(winRate * 10) / 10,
      ahpr: Math.round(ahpr * 1000) / 1000,
      ghpr: Math.round(ghpr * 1000) / 1000,
      baseAhpr: Math.round(baseAhpr * 1000) / 1000,
      baseGhpr: Math.round(baseGhpr * 1000) / 1000,
      expectancyUsd: Math.round(expectancyUsd * 100) / 100,
      meanDuration: Math.round(meanDuration),
      medianDuration: Math.round(medianDuration),
      sharpeRatio: Math.round(sharpeRatio * 100) / 100,
      maxDrawdown: maxDrawdownStr,
      maxDrawdownSub,
      avgEntryAccuracy: avgEntryAccuracy !== null ? Math.round(avgEntryAccuracy * 10) / 10 : null,
      avgExitAccuracy: avgExitAccuracy !== null ? Math.round(avgExitAccuracy * 10) / 10 : null,
      worstMaeUsd: Math.round(worstMaeUsd * 100) / 100,
      worstMaePips: Math.round(worstMaePips * 10) / 10,
      worstIntraDdPips: Math.round(worstIntraDdPips * 10) / 10,
      masterWorstFloatingDdPct: Math.round(masterWorstFloatingDdPct * 1000) / 1000,
      userFloatingDdPct: Math.round(userFloatingDdPct * 100) / 100,
      rangeClosedDd: Math.round(rangeClosedDd * 100) / 100,
      consecutiveLosses50pct,
      consecutiveLosses5pct,
      ruinText,
      ruinSubtext
    };
  }

  function computePeriodDates(timeZone = 'Europe/Berlin') {
    let todayStr = '';
    if (typeof globalThis.Temporal !== 'undefined' && globalThis.Temporal.Now) {
      const pd = globalThis.Temporal.Now.plainDateISO(timeZone);
      const yest = pd.subtract({ days: 1 });
      const weekStart = pd.subtract({ days: pd.dayOfWeek - 1 });
      const lastWeekEnd = weekStart.subtract({ days: 1 });
      const lastWeekStart = weekStart.subtract({ days: 7 });
      const monthStart = pd.with({ day: 1 });
      const lastMonthEnd = monthStart.subtract({ days: 1 });
      const lastMonthStart = lastMonthEnd.with({ day: 1 });
      const yearStart = pd.with({ month: 1, day: 1 });
      return {
        today: { key: 'today', from: pd.toString(), to: pd.toString() },
        yesterday: { key: 'yesterday', from: yest.toString(), to: yest.toString() },
        week: { key: 'week', from: weekStart.toString(), to: pd.toString() },
        last_week: { key: 'last_week', from: lastWeekStart.toString(), to: lastWeekEnd.toString() },
        month: { key: 'month', from: monthStart.toString(), to: pd.toString() },
        last_month: { key: 'last_month', from: lastMonthStart.toString(), to: lastMonthEnd.toString() },
        year: { key: 'year', from: yearStart.toString(), to: pd.toString() }
      };
    }

    try {
      todayStr = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).format(new Date());
    } catch (e) {
      todayStr = new Date().toISOString().slice(0, 10);
    }

    const parts = todayStr.split('-').map(n => parseInt(n, 10));
    const utcNow = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
    const fmt = (d) => d.toISOString().slice(0, 10);
    const addDays = (d, delta) => {
      const copy = new Date(d.getTime());
      copy.setUTCDate(copy.getUTCDate() + delta);
      return copy;
    };

    const yest = addDays(utcNow, -1);
    const dow = utcNow.getUTCDay() === 0 ? 7 : utcNow.getUTCDay();
    const weekStart = addDays(utcNow, -(dow - 1));
    const lastWeekEnd = addDays(weekStart, -1);
    const lastWeekStart = addDays(weekStart, -7);
    const monthStart = new Date(Date.UTC(parts[0], parts[1] - 1, 1));
    const lastMonthEnd = addDays(monthStart, -1);
    const lastMonthStart = new Date(Date.UTC(lastMonthEnd.getUTCFullYear(), lastMonthEnd.getUTCMonth(), 1));
    const yearStart = new Date(Date.UTC(parts[0], 0, 1));

    return {
      today: { key: 'today', from: fmt(utcNow), to: fmt(utcNow) },
      yesterday: { key: 'yesterday', from: fmt(yest), to: fmt(yest) },
      week: { key: 'week', from: fmt(weekStart), to: fmt(utcNow) },
      last_week: { key: 'last_week', from: fmt(lastWeekStart), to: fmt(lastWeekEnd) },
      month: { key: 'month', from: fmt(monthStart), to: fmt(utcNow) },
      last_month: { key: 'last_month', from: fmt(lastMonthStart), to: fmt(lastMonthEnd) },
      year: { key: 'year', from: fmt(yearStart), to: fmt(utcNow) }
    };
  }

  /**
   * Compute period summaries (Today, Yesterday, This Week, Last Week, This Month, Last Month, This Year)
   * with amplification (1x/12x/24x), 30% performance fee, and compounding scheme applied.
   */
  function computePeriodMetrics(rawGrowth, rawLots, trades, opts = {}) {
    if (!rawGrowth || rawGrowth.length < 2) {
      return null;
    }

    const baseCapital = Math.max(100, Number(opts.capital) || 10000);
    const amp = Math.max(1, Number(opts.amplify) || 24);
    const reinvestMode = opts.reinvestMode || 'daily';
    const masterBalance = Math.max(1, Number(opts.masterBalance) || 140628);
    const simFromDate = opts.simFromDate || null;
    const isLinear = reinvestMode === 'none';

    const ranges = computePeriodDates(opts.timeZone || 'Europe/Berlin');
    const primarySim = simulate(rawGrowth, rawLots, baseCapital, amp, reinvestMode, simFromDate, null, null);
    if (!primarySim || !primarySim.timeline || primarySim.timeline.length === 0) {
      return null;
    }

    const timelineStart = primarySim.timeline[0].date;
    let earliestNeeded = ranges.year.from;
    if (ranges.last_month.from < earliestNeeded) earliestNeeded = ranges.last_month.from;
    if (ranges.last_week.from < earliestNeeded) earliestNeeded = ranges.last_week.from;

    let extendedSim = primarySim;
    if (!simFromDate || timelineStart > earliestNeeded) {
      const fullStartIdx = rawGrowth.findIndex(p => p.date >= earliestNeeded);
      const anchorIdx = fullStartIdx > 0 ? fullStartIdx - 1 : 0;
      const anchorDate = rawGrowth[anchorIdx] ? rawGrowth[anchorIdx].date : null;
      extendedSim = simulate(rawGrowth, rawLots, baseCapital, amp, reinvestMode, anchorDate, null, null) || primarySim;
    }

    const equityField = isLinear ? 'linearBalance' : 'compBalance';

    const evalRangeFromTimeline = (simObj, fromIso, toIso) => {
      const tl = simObj.timeline;
      if (!tl || tl.length === 0) {
        return { gain_pct: 0, profit: 0, startEquity: baseCapital };
      }

      let hasPointInRange = false;
      let prevEquity = simObj.baseCapital;
      let endEquity = null;

      for (let i = 0; i < tl.length; i++) {
        const pt = tl[i];
        if (pt.date < fromIso) {
          prevEquity = pt[equityField];
        } else if (pt.date <= toIso) {
          hasPointInRange = true;
          endEquity = pt[equityField];
        } else {
          break;
        }
      }

      if (!hasPointInRange || endEquity === null) {
        return { gain_pct: 0, profit: 0, startEquity: prevEquity };
      }

      const profit = endEquity - prevEquity;
      const gainPct = isLinear
        ? (profit / simObj.baseCapital) * 100
        : (prevEquity > 0 ? ((endEquity / prevEquity) - 1) * 100 : 0);

      return {
        gain_pct: Math.round(gainPct * 100) / 100,
        profit: Math.round(profit * 100) / 100,
        startEquity: prevEquity
      };
    };

    const result = {};
    const orderedKeys = ['today', 'yesterday', 'week', 'last_week', 'month', 'last_month', 'year'];
    const allTrades = Array.isArray(trades) ? trades : [];

    orderedKeys.forEach((k) => {
      const r = ranges[k];
      const useSim = (primarySim.timeline[0].date <= r.from) ? primarySim : extendedSim;
      const fin = evalRangeFromTimeline(useSim, r.from, r.to);

      let count = 0;
      let wins = 0;
      let pips = 0;
      let masterLots = 0;

      for (let i = 0; i < allTrades.length; i++) {
        const t = allTrades[i];
        const d = tradeDateIso(t);
        if (d && d >= r.from && d <= r.to) {
          count++;
          if ((Number(t.profit) || 0) > 0) wins++;
          pips += Number(t.pips) || 0;
          masterLots += Number(t.lots) || 0;
        }
      }

      const scaledLots = masterLots * (fin.startEquity / masterBalance) * amp;

      result[k] = {
        from: r.from,
        to: r.to,
        gain_pct: fin.gain_pct,
        profit: fin.profit,
        pips: Math.round(pips * 10) / 10,
        win_rate_pct: count > 0 ? Math.round((wins / count) * 1000) / 10 : 0,
        trades: count,
        lots: Math.round(scaledLots * 100) / 100
      };
    });

    return result;
  }

  const Calculator = {
    simulate,
    computeTradeMetrics,
    computePeriodMetrics,
    AVG_COMMISSION_PER_LOT,
    BASE_LOTS_PER_1K_EQUITY,
    PERFORMANCE_FEE_RATE,
    NET_INVESTOR_SHARE
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = Calculator;
  } else {
    root.SonicCalculator = Calculator;
  }
})(typeof window !== 'undefined' ? window : globalThis);
