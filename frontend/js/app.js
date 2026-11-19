/**
 * Sonic Master Frontend Application
 * Interactivity, API sync, responsive state management, and real-time calculations
 */

(function () {
  'use strict';

  // Application State
  const state = {
    balance: 10000,
    amplify: 24,
    reinvestMode: 'daily', // 'none' | 'monthly' | 'weekly' | 'daily'
    range: 'all',          // '1w' | '1m' | 'ytd' | 'all'
    displayMode: 'cash',   // 'cash' | 'percent'
    sampleMonths: 13,
    sampleIndex: null,
    sampleSteps: [],
    forecastMonths: 0,
    isForecastActive: false,
    lotBonusMode: 'multi', // 'multi' (21.7%) | 'single' (38.8%)
    summary: null,
    summaryFetchedAtMs: 0,
    growthData: null,
    allTrades: [],
    tradesPage: 1,
    tradesLimit: 30,
    tradesTotal: 0,
    tradesLoaded: 0,
    tradesLoading: false,
    allTradesLoaded: false,
    isRefreshing: false,
    calendarMonth: null,
    calendarData: null,
    calendarSelectedDate: null,
    latestActiveMonth: null,
    streaksData: null
  };

  // DOM Elements cache
  const el = {};

  document.addEventListener('DOMContentLoaded', init);

  function init() {
    cacheDOMElements();
    setupNavigationTabs();
    setupCalculatorControls();
    initAffiliateCalculator();
    setupInfiniteScroll();
    setupRefreshButton();
    setupCalendarControls();
    setupCarousel();

    // Initialize calendar month to current calendar month without TZ drift
    const today = getTodayPlainDate();
    state.calendarMonth = { year: today.year, month: today.month };

    // Step 1: Immediate fetch from cache (< 10ms)
    Promise.all([
      fetchSummary(),
      fetchGrowthData(),
      fetchAllTrades(),
      fetchZooms(),
      fetchCalendar(),
      fetchStreaks()
    ]).then(() => {
      if (window.i18n && window.i18n.apply) {
        window.i18n.apply();
      }
      // Keep status badge & 30-minute cooldown button state fresh every 15s
      setInterval(updateStatusBadge, 15000);
      // Step 2: Send async update request only if cache is > 60 minutes old
      checkAndTriggerAsyncUpdate();
    });

    if (window.i18n && window.i18n.ready) {
      window.i18n.ready.then(() => {
        renderPeriodsTable();
        if (window.i18n.apply) window.i18n.apply();
      });
    }
  }

  function cacheDOMElements() {
    el.navTabs = document.querySelectorAll('.page-tab');
    el.panels = document.querySelectorAll('.page-panel');
    el.balanceInput = document.getElementById('input-balance');
    el.presetChips = document.querySelectorAll('.preset-chip');
    el.ampButtons = document.querySelectorAll('.btn-amp');
    el.reinvestButtons = document.querySelectorAll('.btn-reinvest');
    el.chartContainer = document.getElementById('sonic-chart-canvas');
    el.chartTitle = document.getElementById('chart-title');
    el.chartSubtitle = document.getElementById('chart-subtitle');

    // Tile metrics
    el.tileFinalBalance = document.getElementById('val-final-balance');
    el.tileNetProfit = document.getElementById('val-net-profit');
    el.tileLinearProfit = document.getElementById('val-linear-profit');
    el.tileRoi = document.getElementById('val-roi');
    el.tileAnnualized = document.getElementById('val-annualized');
    el.tileCompAdvantage = document.getElementById('val-comp-advantage');

    // Fee breakdown
    el.feeGross = document.getElementById('fee-gross');
    el.feePerf = document.getElementById('fee-perf');
    el.feeNet = document.getElementById('fee-net');

    // Status & Refresh
    el.lastUpdated = document.getElementById('last-updated-text');
    el.syncStatusIndicator = document.getElementById('sync-status-indicator');
    el.syncDot = document.getElementById('sync-dot');
    el.refreshBtn = document.getElementById('btn-manual-refresh');
    el.statusBadge = document.getElementById('cache-status-badge');

    // Tables & Infinite scroll
    el.periodsBody = document.querySelector('#periods-table tbody');
    el.periodsDesc = document.getElementById('periods-section-desc');
    el.tradesBody = document.querySelector('#trades-table tbody');
    el.tradesPager = document.getElementById('trades-pager');
    el.tradesCountBadge = document.getElementById('trades-count-badge');
    el.tradesScrollWrap = document.getElementById('trades-scroll-wrap');
    el.tradesScrollSentinel = document.getElementById('trades-scroll-sentinel');

    // Calendar & Streaks
    el.calPrevBtn = document.getElementById('cal-prev-month');
    el.calNextBtn = document.getElementById('cal-next-month');
    el.calCurrentBtn = document.getElementById('cal-current-month');
    el.calJumpLatestBtn = document.getElementById('cal-jump-latest');
    el.calMonthLabel = document.getElementById('cal-month-label');
    el.calMonthSummary = document.getElementById('cal-month-summary');
    el.calBody = document.getElementById('calendar-body');
    el.calDayDetail = document.getElementById('calendar-day-detail');

    el.streakCurLabel = document.getElementById('streak-cur-label');
    el.streakCurValue = document.getElementById('streak-cur-value');
    el.streakMaxWin = document.getElementById('streak-max-win');
    el.streakMaxLoss = document.getElementById('streak-max-loss');
    el.streakTotalTrades = document.getElementById('streak-total-trades');
    el.streaksChartCanvas = document.getElementById('streaks-chart-canvas');

    // Affiliate elements
    el.affTeamBalance = document.getElementById('aff-team-balance');
    el.presetChipsAff = document.querySelectorAll('.preset-chip-aff');
    el.btnAffPeriods = document.querySelectorAll('.btn-aff-period');
    el.affGrossDaily = document.getElementById('aff-gross-daily');
    el.affGrossWeekly = document.getElementById('aff-gross-weekly');
    el.affGrossMonthly = document.getElementById('aff-gross-monthly');
    el.affShareWeek = document.getElementById('aff-share-week');
    el.affShareMonth = document.getElementById('aff-share-month');
    el.affLotWeek = document.getElementById('aff-lot-week');
    el.affLotMonth = document.getElementById('aff-lot-month');

    // GB elements
    el.gbTotalInput = document.getElementById('gb-total-input');
    el.gbLineInput = document.getElementById('gb-line-input');
    el.gbLevelPct = document.getElementById('gb-level-pct');
    el.gbLevelSub = document.getElementById('gb-level-sub');
    el.gbCountedVol = document.getElementById('gb-counted-vol');
    el.gbCountedSub = document.getElementById('gb-counted-sub');
    el.gbNextPct = document.getElementById('gb-next-pct');
    el.gbNextSub = document.getElementById('gb-next-sub');
    el.gbPayout = document.getElementById('gb-payout');
    el.gbCalcNote = document.getElementById('gb-calc-note');

    // Grand banner
    el.grandShare = document.getElementById('grand-share');
    el.grandLot = document.getElementById('grand-lot');
    el.grandGb = document.getElementById('grand-gb');
    el.grandTotal = document.getElementById('grand-total');

    // Forecast controls
    el.sliderSampleMonths = document.getElementById('slider-sample-months');
    el.labelSampleMonths = document.getElementById('label-sample-months');
    el.sampleMonthsTicks = document.getElementById('sample-months-ticks');
    el.sliderForecastMonths = document.getElementById('slider-forecast-months');
    el.labelForecastMonths = document.getElementById('label-forecast-months');
    el.btnToggleForecast = document.getElementById('btn-toggle-forecast');
    el.forecastBasisBadge = document.getElementById('forecast-basis-badge');

    // Deep Trading Metrics
    el.metricTradesCount = document.getElementById('metric-trades-count');
    el.metricTradesSub = document.getElementById('metric-trades-sub');
    el.metricWinRate = document.getElementById('metric-win-rate');
    el.metricWinSub = document.getElementById('metric-win-sub');
    el.metricMaxDd = document.getElementById('metric-max-dd');
    el.metricDdSub = document.getElementById('metric-dd-sub');
    el.metricAhpr = document.getElementById('metric-ahpr');
    el.metricGhpr = document.getElementById('metric-ghpr');
    el.metricExpectancyBadge = document.getElementById('metric-expectancy-badge');
    el.metricExpectancyVal = document.getElementById('metric-expectancy-val');
    el.metricSharpe = document.getElementById('metric-sharpe');
    el.metricSharpeSub = document.getElementById('metric-sharpe-sub');
    el.metricDuration = document.getElementById('metric-duration');
    el.metricDurationSub = document.getElementById('metric-duration-sub');
    el.metricRor = document.getElementById('metric-ror');
    el.metricRorSub = document.getElementById('metric-ror-sub');
    el.metricProfitSub = document.getElementById('metric-profit-sub');
    el.metricsActiveRange = document.getElementById('metrics-active-range');

    // Affiliate additions
    el.affLiveRateBadge = document.getElementById('aff-live-rate-badge');
    el.affLotSub = document.getElementById('aff-lot-sub');
    el.btnLotModes = document.querySelectorAll('.btn-lot-mode');
  }

  // --- API Fetchers ---
  async function fetchSummary() {
    try {
      const res = await fetch('/api/sonic/summary');
      if (!res.ok) throw new Error('Summary fetch failed');
      state.summary = await res.json();
      state.summaryFetchedAtMs = Date.now();
      renderSummaryCards();
      renderPeriodsTable();
      updateStatusBadge();
    } catch (err) {
      console.warn('[App] Could not fetch summary:', err.message);
    }
  }

  async function fetchGrowthData() {
    try {
      const res = await fetch('/api/sonic/growth');
      if (!res.ok) throw new Error('Growth fetch failed');
      state.growthData = await res.json();
      detectLatestActiveMonthFromGrowth();
      recalculateAndRender();
    } catch (err) {
      console.warn('[App] Could not fetch growth data:', err.message);
    }
  }

  function renderTradesSlice(page = 1, append = false) {
    if (!state.allTrades || state.allTrades.length === 0) return;

    state.tradesPage = page;
    state.tradesTotal = state.allTrades.length;
    const startIdx = (page - 1) * state.tradesLimit;
    const endIdx = startIdx + state.tradesLimit;
    const slice = state.allTrades.slice(startIdx, endIdx);

    if (!append) {
      state.tradesLoaded = 0;
      state.allTradesLoaded = false;
      if (el.tradesBody) el.tradesBody.innerHTML = '';
    }

    renderTradesTable(slice, append);
    state.tradesLoaded += slice.length;

    // Update badge
    if (el.tradesCountBadge) {
      const tr = (k) => (window.i18n && window.i18n.t ? window.i18n.t(k) : k);
      el.tradesCountBadge.textContent = `${state.tradesLoaded} ${tr('von')} ${state.tradesTotal} ${tr('Trades im Archiv')}`;
    }

    if (window.i18n && window.i18n.apply) {
      window.i18n.apply();
    }

    if (state.tradesLoaded >= state.tradesTotal || slice.length === 0) {
      state.allTradesLoaded = true;
      if (el.tradesScrollSentinel) {
        el.tradesScrollSentinel.innerHTML = `<span style="color: var(--accent-emerald); font-weight:600;">✓ Alle ${state.tradesTotal} historischen Trades geladen</span>`;
      }
    } else {
      if (el.tradesScrollSentinel) {
        el.tradesScrollSentinel.innerHTML = `<span style="color: var(--text-muted); font-size:12px;">Scrolle nach unten für weitere Trades (${state.tradesLoaded} von ${state.tradesTotal}) ↓</span>`;
      }
    }
  }

  async function fetchAllTrades() {
    try {
      const res = await fetch('/api/sonic/trades?all=true');
      if (!res.ok) throw new Error('Trades fetch failed');
      const data = await res.json();
      if (data && data.trades && Array.isArray(data.trades)) {
        state.allTrades = data.trades.slice().sort((a, b) => {
          const parseTime = (t) => {
            const s = (t && (t.close || t.open)) || '';
            const ms = Date.parse(s);
            return Number.isFinite(ms) ? ms : 0;
          };
          return parseTime(b) - parseTime(a);
        });
        state.tradesTotal = state.allTrades.length;
        detectLatestActiveMonth();
        renderTradesSlice(1, false);
        recalculateAndRender();
        if (state.calendarData) renderCalendar();
      }
    } catch (err) {
      console.warn('[App] Could not fetch all trades:', err.message);
      if (el.tradesScrollSentinel) {
        el.tradesScrollSentinel.innerHTML = `<span style="color: var(--accent-rose); cursor:pointer;">Fehler beim Laden. Tippe hier zum Wiederholen.</span>`;
        el.tradesScrollSentinel.onclick = () => fetchAllTrades();
      }
    }
  }

  async function fetchZooms() {
    try {
      const res = await fetch('/api/zooms');
      if (!res.ok) return;
      const data = await res.json();
      renderZoomsTab(data);
    } catch (err) {
      console.warn('[App] Could not fetch zooms:', err.message);
    }
  }

  // --- Dynamic Sample Steps (Milestones) ---
  function computeSampleSteps(rawGrowth) {
    if (!rawGrowth || rawGrowth.length < 2) return [];

    const firstDateStr = rawGrowth[0].date; // e.g. '2024-11-03'
    const lastDateStr = rawGrowth[rawGrowth.length - 1].date; // e.g. '2026-10-14'
    const lastDate = new Date(lastDateStr + 'T12:00:00Z');
    const firstDate = new Date(firstDateStr + 'T12:00:00Z');

    // Dynamically calculate tagMonths: largest whole months such that startDate >= 2025-09-13
    let tagMonths = 1;
    while (true) {
      const test = new Date(lastDate);
      test.setUTCMonth(test.getUTCMonth() - (tagMonths + 1));
      if (test.toISOString().slice(0, 10) < '2025-09-13') {
        break;
      }
      tagMonths++;
    }

    const dTag = new Date(lastDate);
    dTag.setUTCMonth(dTag.getUTCMonth() - tagMonths);
    const tagFromDateStr = dTag.toISOString().slice(0, 10);

    const formatEuDate = (iso) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.${iso.slice(0, 4)}`;
    const curYear = lastDate.getUTCFullYear();
    const ytdDateStr = `${curYear}-01-01`;

    const candidates = [
      {
        id: '1w',
        title: '1W',
        monthsEquivalent: 7 / 30.4375,
        fromDate: (() => { const d = new Date(lastDate); d.setUTCDate(d.getUTCDate() - 7); return d.toISOString().slice(0, 10); })()
      },
      {
        id: '1m',
        title: '1M',
        monthsEquivalent: 1,
        fromDate: (() => { const d = new Date(lastDate); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 10); })()
      },
      {
        id: '2m',
        title: '2M',
        monthsEquivalent: 2,
        fromDate: (() => { const d = new Date(lastDate); d.setUTCMonth(d.getUTCMonth() - 2); return d.toISOString().slice(0, 10); })()
      },
      {
        id: '3m',
        title: '3M',
        monthsEquivalent: 3,
        fromDate: (() => { const d = new Date(lastDate); d.setUTCMonth(d.getUTCMonth() - 3); return d.toISOString().slice(0, 10); })()
      },
      {
        id: '6m',
        title: '6M',
        monthsEquivalent: 6,
        fromDate: (() => { const d = new Date(lastDate); d.setUTCMonth(d.getUTCMonth() - 6); return d.toISOString().slice(0, 10); })()
      },
      {
        id: 'ytd',
        title: 'YTD',
        curYear: curYear,
        monthsEquivalent: Math.max(0.5, (lastDate - new Date(ytdDateStr + 'T12:00:00Z')) / (86400000 * 30.4375)),
        fromDate: ytdDateStr
      },
      {
        id: '12m',
        title: '12M',
        monthsEquivalent: 12,
        fromDate: (() => { const d = new Date(lastDate); d.setUTCMonth(d.getUTCMonth() - 12); return d.toISOString().slice(0, 10); })()
      },
      {
        id: 'tag',
        title: `${tagMonths}M`,
        tagMonths: tagMonths,
        formattedFromDate: formatEuDate(tagFromDateStr),
        monthsEquivalent: tagMonths,
        fromDate: tagFromDateStr,
        isDefault: true
      },
      {
        id: '18m',
        title: '18M',
        monthsEquivalent: 18,
        fromDate: (() => { const d = new Date(lastDate); d.setUTCMonth(d.getUTCMonth() - 18); return d.toISOString().slice(0, 10); })()
      },
      {
        id: 'max',
        title: 'Max',
        formattedFromDate: formatEuDate(firstDateStr),
        monthsEquivalent: Math.max(1, (lastDate - firstDate) / (86400000 * 30.4375)),
        fromDate: firstDateStr
      }
    ];

    // Filter out steps older than first historical point
    const valid = candidates.filter(c => c.id === 'max' || c.fromDate >= firstDateStr);

    // Sort strictly chronologically: newest fromDate first, oldest fromDate last
    valid.sort((a, b) => {
      if (a.fromDate > b.fromDate) return -1;
      if (a.fromDate < b.fromDate) return 1;
      return 0;
    });

    // Deduplicate any step that might share same title
    const deduped = [];
    for (const step of valid) {
      const existing = deduped.find(e => e.title === step.title);
      if (existing) {
        if (step.isDefault) {
          existing.isDefault = true;
          existing.label = step.label;
          existing.id = step.id;
        }
      } else {
        deduped.push(step);
      }
    }

    return deduped;
  }

  function formatStepLabel(step) {
    if (!step) return '';
    const tr = (k) => (window.i18n && window.i18n.t ? window.i18n.t(k) : k);
    switch (step.id) {
      case '1w':
        return `1W (7 ${tr('Tage')})`;
      case '1m':
        return `1M (1 ${tr('Monat')})`;
      case '2m':
        return `2M (2 ${tr('Monate')})`;
      case '3m':
        return `3M (3 ${tr('Monate')})`;
      case '6m':
        return `6M (6 ${tr('Monate')})`;
      case 'ytd':
        return `YTD (${tr('seit')} 01.01.${step.curYear || ''})`;
      case '12m':
        return `12M (1 ${tr('Jahr')})`;
      case 'tag':
        return `${step.title || (step.tagMonths + 'M')} (${tr('ab')} ${step.formattedFromDate || ''})`;
      case '18m':
        return `18M (1,5 ${tr('Jahre')})`;
      case 'max':
        return `Max (${tr('Gesamt ab')} ${step.formattedFromDate || ''})`;
      default:
        return step.label || step.title;
    }
  }

  function renderSampleTicks() {
    if (!el.sampleMonthsTicks || !state.sampleSteps || state.sampleSteps.length === 0) return;
    el.sampleMonthsTicks.innerHTML = state.sampleSteps.map((s, idx) => {
      const isSel = idx === state.sampleIndex;
      return `<span data-idx="${idx}" style="cursor: pointer; padding: 2px 4px; border-radius: 4px; transition: all 0.2s; ${isSel ? 'color: var(--accent-cyan); font-weight: 700; background: rgba(0,229,255,0.15);' : 'color: var(--text-muted);'}">${s.title}</span>`;
    }).join('');

    el.sampleMonthsTicks.querySelectorAll('span[data-idx]').forEach(tick => {
      tick.addEventListener('click', () => {
        const idx = parseInt(tick.dataset.idx, 10);
        if (!isNaN(idx) && el.sliderSampleMonths) {
          el.sliderSampleMonths.value = idx;
          state.sampleIndex = idx;
          if (state.sampleSteps[idx]) {
            state.sampleMonths = state.sampleSteps[idx].monthsEquivalent;
          }
          recalculateAndRender();
        }
      });
    });
  }

  function updateSampleTicksHighlight() {
    if (!el.sampleMonthsTicks) return;
    el.sampleMonthsTicks.querySelectorAll('span[data-idx]').forEach(tick => {
      const idx = parseInt(tick.dataset.idx, 10);
      const isSel = idx === state.sampleIndex;
      tick.style.color = isSel ? 'var(--accent-cyan)' : 'var(--text-muted)';
      tick.style.fontWeight = isSel ? '700' : 'normal';
      tick.style.background = isSel ? 'rgba(0,229,255,0.15)' : 'transparent';
    });
  }

  // --- Calculation & Chart Render ---
  function recalculateAndRender() {
    if (!state.growthData || !state.growthData.growth || !Array.isArray(state.growthData.growth) || state.growthData.growth.length < 2) {
      return;
    }

    const rawGrowth = state.growthData.growth;
    const rawLots = state.growthData.lots || {};

    // Initialize sample milestones if not already populated
    if (!state.sampleSteps || state.sampleSteps.length === 0) {
      state.sampleSteps = computeSampleSteps(rawGrowth);
      const defaultIdx = state.sampleSteps.findIndex(s => s.isDefault);
      state.sampleIndex = defaultIdx >= 0 ? defaultIdx : Math.floor(state.sampleSteps.length / 2);

      if (el.sliderSampleMonths) {
        el.sliderSampleMonths.min = 0;
        el.sliderSampleMonths.max = Math.max(0, state.sampleSteps.length - 1);
        el.sliderSampleMonths.value = state.sampleIndex;
      }
      renderSampleTicks();
    }

    if (state.sampleIndex === null || state.sampleIndex === undefined) {
      const defaultIdx = state.sampleSteps.findIndex(s => s.isDefault);
      state.sampleIndex = defaultIdx >= 0 ? defaultIdx : 0;
    }

    const currentStep = state.sampleSteps[state.sampleIndex] || state.sampleSteps[0];
    if (currentStep) {
      state.sampleMonths = currentStep.monthsEquivalent;
      if (el.labelSampleMonths) {
        el.labelSampleMonths.textContent = formatStepLabel(currentStep);
      }
    }
    updateSampleTicksHighlight();

    // In historical view (forecastMonths === 0), chart date range is controlled by the sample slider!
    let fromDate = null;
    if (state.isForecastActive && state.forecastMonths > 0) {
      fromDate = null;
    } else {
      fromDate = (currentStep && currentStep.id !== 'max') ? currentStep.fromDate : null;
    }

    const forecastOpts = (state.isForecastActive && state.forecastMonths > 0 && currentStep) ? {
      sampleMonths: currentStep.monthsEquivalent,
      sampleFromDate: currentStep.fromDate,
      forecastMonths: state.forecastMonths
    } : null;

    const sim = window.SonicCalculator.simulate(
      rawGrowth,
      rawLots,
      state.balance,
      state.amplify,
      state.reinvestMode,
      fromDate,
      null,
      forecastOpts
    );

    if (!sim) return;

    // Render KPI Cards
    if (el.tileFinalBalance) el.tileFinalBalance.textContent = `$${sim.finalBalance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (el.tileNetProfit) el.tileNetProfit.textContent = `+$${sim.netProfit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (el.tileLinearProfit) el.tileLinearProfit.textContent = `$${sim.linearNetProfit.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    if (el.tileRoi) el.tileRoi.textContent = `+${sim.roiPct.toFixed(1)}%`;
    if (el.tileAnnualized) el.tileAnnualized.textContent = `~${sim.cagrPct.toFixed(0)}% p.a.`;

    const diff = sim.finalBalance - sim.linearFinalBalance;
    if (el.tileCompAdvantage) {
      el.tileCompAdvantage.textContent = state.reinvestMode === 'none' 
        ? '$0' 
        : `+$${Math.round(diff).toLocaleString('en-US')}`;
    }

    // Fee breakdown cards
    if (el.feeGross) el.feeGross.textContent = `$${Math.round(sim.totalGrossProfit).toLocaleString('en-US')}`;
    if (el.feePerf) el.feePerf.textContent = `-$${Math.round(sim.totalPerfFees).toLocaleString('en-US')}`;
    if (el.feeNet) el.feeNet.textContent = `$${Math.round(sim.netProfit).toLocaleString('en-US')}`;

    const tr = (k) => (window.i18n && window.i18n.t ? window.i18n.t(k) : k);

    // Update Forecast Badge
    if (el.forecastBasisBadge) {
      if (state.isForecastActive && state.forecastMonths > 0 && sim.forecast) {
        el.forecastBasisBadge.textContent = `${tr('Basis:')} ${currentStep ? currentStep.title : state.sampleMonths + 'M'} (+${sim.forecast.sampleMonthlyAmp}% p.M.)`;
      } else {
        el.forecastBasisBadge.textContent = tr('Prognose: Aus (Historische Ansicht)');
      }
    }

    // Update Chart Title
    const modeLabel = state.reinvestMode === 'daily' ? tr('Tägliche Reinvestition') 
      : state.reinvestMode === 'weekly' ? tr('Wöchentliche Reinvestition')
      : state.reinvestMode === 'monthly' ? tr('Monatliche Reinvestition')
      : tr('Keine Reinvestition (Linear)');
    if (el.chartTitle) {
      if (state.isForecastActive && state.forecastMonths > 0) {
        el.chartTitle.textContent = `${tr('Wachstumsprognose')} (+${state.forecastMonths} ${tr('Monate')}) · ${state.amplify}x ${tr('Hebel')} · ${modeLabel}`;
        if (el.chartSubtitle && currentStep) {
          el.chartSubtitle.textContent = `${tr('Basis:')} ${formatStepLabel(currentStep)} · ${tr('Extrapolation bei gleichbleibender Handelsrendite')}`;
        }
      } else {
        const stepName = currentStep ? currentStep.title : tr('Gesamt');
        el.chartTitle.textContent = `${tr('Historische Performance')} (${stepName}) · ${state.amplify}x ${tr('Hebel')} · ${modeLabel}`;
        if (el.chartSubtitle) {
          el.chartSubtitle.textContent = tr('Grüne Linie = Zinseszins · Blaue gestrichelte Linie = Gewinn ohne Reinvest');
        }
      }
    }

    // Render SVG chart
    window.SonicChart.render(el.chartContainer, sim.timeline, {
      height: 290,
      mode: state.displayMode
    });

    // Update simulated Periods Table dynamically with current capital, leverage, fees & reinvest scheme
    renderPeriodsTable();

    // Render Deep Trading & Risk Metrics dynamically!
    if (window.SonicCalculator && window.SonicCalculator.computeTradeMetrics && state.allTrades && state.allTrades.length > 0) {
      const metricsFilterDate = (currentStep && currentStep.id !== 'max') ? currentStep.fromDate : null;
      const masterDd = state.summary && state.summary.general && typeof state.summary.general.drawdown_pct === 'number'
        ? state.summary.general.drawdown_pct
        : 0.86;
      const metrics = window.SonicCalculator.computeTradeMetrics(
        state.allTrades,
        rawGrowth,
        metricsFilterDate,
        null,
        masterDd,
        state.balance,
        state.amplify
      );
      renderDeepMetrics(metrics, currentStep);
    }
  }

  function renderDeepMetrics(m, currentStep) {
    if (!m) return;
    const tr = (k) => (window.i18n && window.i18n.t ? window.i18n.t(k) : k);

    if (el.metricTradesCount) el.metricTradesCount.textContent = m.totalTrades;
    if (el.metricTradesSub) el.metricTradesSub.textContent = `${m.wins} ${tr('Gewinner')} · ${m.losses} ${tr('Verlierer')}`;
    if (el.metricWinRate) el.metricWinRate.textContent = `${m.winRate}%`;
    if (el.metricWinSub) {
      let winSub = `${m.wins} ${tr('Gewinner')} (${m.winRate}%)`;
      if (m.avgEntryAccuracy !== null) {
        winSub += ` · Ø ${tr('Einstieg')}: ${m.avgEntryAccuracy}%`;
      }
      el.metricWinSub.textContent = winSub;
    }
    if (el.metricMaxDd) el.metricMaxDd.textContent = m.maxDrawdown;
    if (el.metricDdSub) {
      if (m.maxDrawdownSub) {
        el.metricDdSub.textContent = m.maxDrawdownSub;
      } else {
        const isYtd = Boolean(currentStep && currentStep.fromDate && currentStep.fromDate >= '2026-01-01');
        const baseDrawdownPct = isYtd ? 0.23 : 0.86;
        el.metricDdSub.textContent = `${baseDrawdownPct}% ${tr('Basis')} (${isYtd ? '2026' : 'Myfxbook'}) × ${state.amplify}x ${tr('Hebel')}`;
      }
    }
    if (el.metricAhpr) {
      el.metricAhpr.innerHTML = `${m.ahpr >= 0 ? '+' : ''}${m.ahpr}% <span style="font-size: 0.9rem; color: var(--text-secondary); font-weight: normal;">(AHPR ${tr('bei')} ${state.amplify}x)</span>`;
    }
    if (el.metricGhpr) el.metricGhpr.textContent = `${m.ghpr >= 0 ? '+' : ''}${m.ghpr}%`;
    if (el.metricExpectancyBadge) el.metricExpectancyBadge.textContent = `${m.expectancyUsd >= 0 ? '+' : ''}$${m.expectancyUsd.toFixed(2)} / Trade`;
    if (el.metricExpectancyVal) el.metricExpectancyVal.textContent = `${m.expectancyUsd >= 0 ? '+' : ''}$${m.expectancyUsd.toFixed(2)}`;
    if (el.metricProfitSub) {
      el.metricProfitSub.innerHTML = `GHPR: <strong id="metric-ghpr">${m.ghpr >= 0 ? '+' : ''}${m.ghpr}%</strong> · <span class="metric-expectancy-lbl">${tr('Erwartungswert:')}</span> <strong id="metric-expectancy-val">${m.expectancyUsd >= 0 ? '+' : ''}$${m.expectancyUsd.toFixed(2)}</strong>`;
    }
    if (el.metricSharpe) el.metricSharpe.textContent = m.sharpeRatio.toFixed(2);
    if (el.metricDuration) el.metricDuration.textContent = `${m.medianDuration} ${tr('Min')}`;
    if (el.metricDurationSub) el.metricDurationSub.textContent = `${tr('Mittelwert:')} ${m.meanDuration} ${tr('Min')} (${(m.meanDuration / 60).toFixed(1)} ${tr('Std.')})`;
    if (el.metricRor) {
      el.metricRor.textContent = m.consecutiveLosses50pct > 100 
        ? `> 500 ${tr('Trades')}` 
        : `${m.consecutiveLosses50pct} ${tr('Trades')}`;
    }
    if (el.metricRorSub) {
      const pattern = tr('in Folge für 50% DD (Chance: < 0.0001% bei {winRate}% Win Rate)');
      el.metricRorSub.textContent = pattern.replace('{winRate}', m.winRate.toFixed(1));
    }
    if (el.metricsActiveRange && currentStep) {
      el.metricsActiveRange.textContent = formatStepLabel(currentStep);
    }
  }


  // --- Formatting Helpers ---
  function fmtCurrency(val) {
    if (val == null || Number.isNaN(Number(val))) return '-';
    const n = Number(val);
    const abs = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return n < 0 ? `-$${abs}` : `$${abs}`;
  }

  function fmtGainPct(val) {
    if (val == null || Number.isNaN(Number(val))) return '-';
    const n = Number(val);
    return `${n >= 0 ? '+' : '-'}${Math.abs(n).toFixed(2)}%`;
  }

  function fmtSignedPips(val) {
    if (val == null || Number.isNaN(Number(val))) return '-';
    const n = Number(val);
    const abs = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
    return `${n >= 0 ? '+' : '-'}${abs}`;
  }

  function fmtLots(val) {
    if (val == null || Number.isNaN(Number(val))) return '-';
    return Number(val).toFixed(2);
  }

  function fmtPrice(val) {
    if (val == null || Number.isNaN(Number(val))) return '-';
    const n = Number(val);
    return Math.abs(n) >= 100
      ? n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : n.toFixed(5);
  }

  function fmtDuration(sec) {
    if (sec == null || !Number.isFinite(Number(sec))) return '-';
    const s = Math.max(0, Math.round(Number(sec)));
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    if (d > 0) return h > 0 ? `${d}d ${h}h` : `${d}d`;
    if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
    if (m > 0) return `${m}m`;
    return `${s}s`;
  }

  function formatBerlinTimestamp(isoStr) {
    if (!isoStr) return '';
    const dt = new Date(isoStr);
    if (Number.isNaN(dt.getTime())) return String(isoStr);
    return new Intl.DateTimeFormat('de-DE', {
      timeZone: 'Europe/Berlin',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      timeZoneName: 'short'
    }).format(dt);
  }

  // --- Summary & Periods Rendering ---
  function renderSummaryCards() {
    if (!state.summary || !state.summary.general) return;
    const g = state.summary.general;

    const bind = (id, val) => {
      const node = document.getElementById(id);
      if (node && val != null) node.textContent = val;
    };

    bind('sum-balance', fmtCurrency(g.balance));
    bind('sum-equity', typeof g.equity_pct === 'number' ? `(${g.equity_pct.toFixed(2)}%) ${fmtCurrency(g.equity)}` : fmtCurrency(g.equity));
    bind('sum-profit', fmtCurrency(g.profit));
    bind('sum-gain', fmtGainPct(g.gain_pct));
    bind('sum-drawdown', typeof g.drawdown_pct === 'number' ? `${g.drawdown_pct.toFixed(2)}%` : '-');
    bind('sum-factor', typeof g.profit_factor === 'number' ? g.profit_factor.toFixed(2) : '-');
    bind('sum-deposits', fmtCurrency(g.deposits));
    bind('sum-withdrawals', fmtCurrency(g.withdrawals));
  }

  function renderPeriodsTable() {
    if (!el.periodsBody) return;
    const tr = (k) => (window.i18n && window.i18n.t ? window.i18n.t(k) : k);

    const rawGrowth = state.growthData && Array.isArray(state.growthData.growth) ? state.growthData.growth : null;
    const rawLots = state.growthData && state.growthData.lots ? state.growthData.lots : {};
    const masterBalance = state.summary && state.summary.general && Number(state.summary.general.balance) > 0
      ? Number(state.summary.general.balance)
      : 140628;
    const currentStep = state.sampleSteps && state.sampleIndex !== null ? state.sampleSteps[state.sampleIndex] : null;
    const simFromDate = (currentStep && currentStep.id !== 'max') ? currentStep.fromDate : null;

    let computed = null;
    if (rawGrowth && rawGrowth.length >= 2 && window.SonicCalculator && window.SonicCalculator.computePeriodMetrics) {
      computed = window.SonicCalculator.computePeriodMetrics(rawGrowth, rawLots, state.allTrades || [], {
        capital: state.balance,
        amplify: state.amplify,
        reinvestMode: state.reinvestMode,
        masterBalance,
        simFromDate,
        timeZone: 'Europe/Berlin'
      });
    }

    if (el.periodsDesc) {
      if (computed) {
        const modeLabel = state.reinvestMode === 'daily' ? tr('Tägliche Reinvestition')
          : state.reinvestMode === 'weekly' ? tr('Wöchentliche Reinvestition')
          : state.reinvestMode === 'monthly' ? tr('Monatliche Reinvestition')
          : tr('Keine Reinvestition (Linear)');
        el.periodsDesc.textContent = `${fmtCurrency(state.balance)} · ${state.amplify}x ${tr('Hebel')} · ${modeLabel} · ${tr('inkl. 30% Perf. Fee')}`;
      } else {
        el.periodsDesc.textContent = tr('Ergebnisse des Master-Kontos (ungehebelt) als rechnerische Basis für die Hochrechnung.');
      }
    }

    const fallback = (state.summary && state.summary.periods) || {};
    const p = computed || fallback;
    if (!p || (!p.today && !p.week && !p.month && !p.year)) return;

    const rows = computed
      ? [
          { name: tr('Heute'), data: p.today },
          { name: tr('Gestern'), data: p.yesterday },
          { name: tr('Diese Woche'), data: p.week },
          { name: tr('Letzte Woche'), data: p.last_week },
          { name: tr('Dieser Monat'), data: p.month },
          { name: tr('Letzter Monat'), data: p.last_month },
          { name: tr('Dieses Jahr'), data: p.year }
        ]
      : [
          { name: tr('Heute'), data: p.today },
          { name: tr('Diese Woche'), data: p.week },
          { name: tr('Dieser Monat'), data: p.month },
          { name: tr('Dieses Jahr'), data: p.year }
        ];

    el.periodsBody.innerHTML = '';
    rows.forEach(r => {
      const rowEl = document.createElement('tr');
      const d = r.data || {};
      const gainCls = (d.gain_pct || 0) >= 0 ? 'pos' : 'neg';
      const profCls = (d.profit || 0) >= 0 ? 'pos' : 'neg';
      const rangeTitle = d.from && d.to ? (d.from === d.to ? d.from : `${d.from} – ${d.to}`) : '';
      rowEl.innerHTML = `
        <td class="tbl-period-name" title="${rangeTitle}"><strong>${r.name}</strong></td>
        <td class="${gainCls} font-tabular">${fmtGainPct(d.gain_pct)}</td>
        <td class="${profCls} font-tabular">${fmtCurrency(d.profit)}</td>
        <td class="font-tabular">${fmtSignedPips(d.pips)}</td>
        <td class="font-tabular">${typeof d.win_rate_pct === 'number' ? `${Math.round(d.win_rate_pct)}%` : '-'}</td>
        <td class="font-tabular">${typeof d.trades === 'number' ? d.trades : '-'}</td>
        <td class="font-tabular">${fmtLots(d.lots)}</td>
      `;
      el.periodsBody.appendChild(rowEl);
    });
  }

  // Date Formatter: Convert ISO-8601 timestamp -> DD.MM.YYYY HH:MM (UTC)
  function formatTradeDate(dateStr) {
    if (!dateStr || typeof dateStr !== 'string') return '-';
    const dt = new Date(dateStr);
    if (Number.isNaN(dt.getTime())) return dateStr;
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(dt.getUTCDate())}.${pad(dt.getUTCMonth() + 1)}.${dt.getUTCFullYear()} ${pad(dt.getUTCHours())}:${pad(dt.getUTCMinutes())}`;
  }

  // Helper: render inline SVG sparkline curve with 3 analytics dots:
  // green = optimal entry time, red = optimal exit time, orange = actual exit time
  function generateSparklineSvg(pricePath, isProfit, isBuy = true) {
    if (!pricePath || pricePath.length < 2) return '';
    const min = Math.min(...pricePath);
    const max = Math.max(...pricePath);
    const range = max - min || 1;
    const w = 72;
    const h = 22;
    const pad = 3.5;
    const coords = pricePath.map((p, i) => {
      const x = pad + (i / (pricePath.length - 1)) * (w - 2 * pad);
      const y = h - pad - ((p - min) / range) * (h - 2 * pad);
      return { x, y };
    });
    const pts = coords.map(c => `${c.x.toFixed(1)},${c.y.toFixed(1)}`);

    let minIdx = 0;
    let maxIdx = 0;
    for (let i = 1; i < pricePath.length; i++) {
      if (pricePath[i] < pricePath[minIdx]) minIdx = i;
      if (pricePath[i] > pricePath[maxIdx]) maxIdx = i;
    }

    const optEntryIdx = isBuy ? minIdx : maxIdx;
    const optExitIdx = isBuy ? maxIdx : minIdx;
    const actualExitIdx = pricePath.length - 1;

    const entryPt = coords[optEntryIdx];
    const optExitPt = coords[optExitIdx];
    const actualPt = coords[actualExitIdx];
    const lineColor = isProfit ? 'rgba(56, 189, 248, 0.9)' : 'rgba(148, 163, 184, 0.85)';

    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="Kursverlauf mit optimalem Einstieg, optimalem Ausstieg und tatsächlichem Ausstieg" style="display:inline-block; vertical-align:middle; overflow:visible;">
      <title>Grün: Optimaler Einstieg | Rot: Optimaler Ausstieg | Orange: Tatsächlicher Ausstieg</title>
      <polyline fill="none" stroke="${lineColor}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" points="${pts.join(' ')}" />
      <circle cx="${optExitPt.x.toFixed(1)}" cy="${optExitPt.y.toFixed(1)}" r="2.8" fill="#ff5252" stroke="#0a0c0b" stroke-width="0.8"><title>Optimaler Ausstieg</title></circle>
      <circle cx="${entryPt.x.toFixed(1)}" cy="${entryPt.y.toFixed(1)}" r="2.4" fill="#00e676" stroke="#0a0c0b" stroke-width="0.8"><title>Optimaler Einstieg</title></circle>
      <circle cx="${actualPt.x.toFixed(1)}" cy="${actualPt.y.toFixed(1)}" r="1.9" fill="#ff9800" stroke="#0a0c0b" stroke-width="0.7"><title>Tatsächlicher Ausstieg</title></circle>
    </svg>`;
  }

  // --- Trades Table & Infinite Scroll ---
  function renderTradesTable(trades, append = false) {
    if (!el.tradesBody) return;
    if (!append) el.tradesBody.innerHTML = '';

    if (!trades || trades.length === 0) {
      if (!append) {
        el.tradesBody.innerHTML = '<tr><td colspan="10" style="text-align:center; padding: 24px; color: rgba(255,255,255,0.4);">Keine Trades verfügbar</td></tr>';
      }
      return;
    }

    const trText = (k) => (window.i18n && window.i18n.t ? window.i18n.t(k) : k);

    trades.forEach(t => {
      const tr = document.createElement('tr');
      const isBuy = t.action === 'Buy';
      const isProfit = Number(t.profit || 0) >= 0;

      let analyticsHtml = '<span style="color: rgba(255,255,255,0.25);">—</span>';
      if (t.analytics) {
        const svg = generateSparklineSvg(t.analytics.price_path, isProfit, isBuy);
        const hasEntryAcc = typeof t.analytics.entry_accuracy === 'number';
        const hasExitAcc = typeof t.analytics.exit_accuracy === 'number';
        const entryAcc = hasEntryAcc ? `${t.analytics.entry_accuracy}%` : '-';
        const exitAcc = hasExitAcc ? `${t.analytics.exit_accuracy}%` : '-';
        const combinedAcc = (hasEntryAcc && hasExitAcc)
          ? `${Number(((t.analytics.entry_accuracy * t.analytics.exit_accuracy) / 100).toFixed(1))}%`
          : (hasEntryAcc ? entryAcc : (hasExitAcc ? exitAcc : '-'));
        const ddPips = typeof t.analytics.drawdown_pips === 'number' ? `${t.analytics.drawdown_pips} pips` : '-';
        const mae = typeof t.analytics.min_usd === 'number' ? `${t.analytics.min_usd < 0 ? '-' : ''}$${Math.abs(t.analytics.min_usd).toFixed(2)}` : '-';
        const mfe = typeof t.analytics.max_usd === 'number' ? `+$${t.analytics.max_usd.toFixed(2)}` : '-';
        const timeProf = typeof t.analytics.time_profitable_pct === 'number'
          ? (t.analytics.time_profitable_duration ? `${t.analytics.time_profitable_pct}% (${t.analytics.time_profitable_duration})` : `${t.analytics.time_profitable_pct}%`)
          : '-';
        const rr = t.analytics.risk_reward || '-';

        analyticsHtml = `
          <div class="sparkline-wrap" tabindex="0">
            <div class="sparkline-preview">
              ${svg}
              <span class="accuracy-pill" title="${trText('Einstiegs-Präzision')} × ${trText('Ausstiegs-Präzision')} (${entryAcc} × ${exitAcc})">${combinedAcc}</span>
            </div>
            <div class="sparkline-tooltip">
              <div class="st-header"><strong>${trText('Trade-Analyse')}</strong> · <span class="${isProfit ? 'pos' : 'neg'}">${t.action} ${t.symbol}</span></div>
              <div class="st-row"><span>${trText('Einstiegs-Präzision')}:</span> <strong>${entryAcc}</strong></div>
              <div class="st-row"><span>${trText('Ausstiegs-Präzision')}:</span> <strong>${exitAcc}</strong></div>
              <div class="st-row"><span>${trText('Intraday Drawdown')}:</span> <strong style="color: #ffb74d;">${ddPips} (${mae})</strong></div>
              <div class="st-row"><span>${trText('Max. Exkursion (MFE)')}:</span> <strong class="pos">${mfe}</strong></div>
              <div class="st-row"><span>${trText('Zeit im Gewinn')}:</span> <strong>${timeProf}</strong></div>
              <div class="st-row"><span>${trText('Risk/Reward')}:</span> <strong>${rr}</strong></div>
              <div class="sparkline-legend">
                <span class="sparkline-legend-item"><i class="sl-dot sl-entry"></i>Opt. Einstieg</span>
                <span class="sparkline-legend-item"><i class="sl-dot sl-exit"></i>Opt. Ausstieg</span>
                <span class="sparkline-legend-item"><i class="sl-dot sl-actual"></i>Exit</span>
              </div>
            </div>
          </div>
        `;
      }

      const isProvisional = Boolean(t.provisional || t.source === 'webhook');
      const provBadge = isProvisional
        ? `<span title="${trText('Vorläufiger MT5-Webhook-Wert (wird beim nächsten Myfxbook-Sync ersetzt)')}" style="color: var(--text-muted); font-size: 11px; margin-left: 3px;">~</span>`
        : '';

      tr.innerHTML = `
        <td><span class="badge ${isBuy ? 'badge-buy' : 'badge-sell'}">${t.action}</span> <strong>${t.symbol}</strong>${provBadge}</td>
        <td class="font-tabular">${isProvisional ? '~' : ''}${fmtLots(t.lots)}</td>
        <td class="font-tabular">${fmtPrice(t.open_price)}</td>
        <td class="font-tabular">${fmtPrice(t.close_price)}</td>
        <td class="font-tabular ${isProfit ? 'pos' : 'neg'}">${typeof t.pips === 'number' ? t.pips.toFixed(1) : '-'}</td>
        <td class="font-tabular ${isProfit ? 'pos' : 'neg'}"><strong>${isProvisional ? '~' : ''}${fmtCurrency(t.profit)}</strong></td>
        <td class="font-tabular">${fmtDuration(t.duration_seconds)}</td>
        <td class="sparkline-cell">${analyticsHtml}</td>
        <td class="tbl-time">${formatTradeDate(t.open)}</td>
        <td class="tbl-time">${formatTradeDate(t.close)}</td>
      `;
      el.tradesBody.appendChild(tr);
    });
  }

  function renderTradesPager() {
    if (el.tradesPager) {
      el.tradesPager.style.display = 'none';
    }
  }

  // --- Zooms Tab Rendering ---
  function renderZoomsTab(data) {
    const list = document.getElementById('zooms-recordings-list');
    const recurringCard = document.getElementById('zooms-recurring-card');

    if (recurringCard && data.recurring_call) {
      const c = data.recurring_call;
      recurringCard.innerHTML = `
        <div class="recurring-badge">JEDEN MITTWOCH · 20:30 UHR</div>
        <h2>${c.title}</h2>
        <p class="recurring-speakers">Mit <strong>${c.speakers ? c.speakers.join(' & ') : 'Team'}</strong></p>
        <p class="recurring-desc">Erfahre aus erster Hand alle Updates, Einblicke in Strategien und Marktanalysen unserer Community.</p>
        <div class="recurring-actions">
          <a href="${c.url}" target="_blank" rel="noopener noreferrer" class="btn btn-primary">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 10l5-5m0 0l-5-5m5 5H9a7 7 0 00-7 7v7"/></svg>
            Am Zoom teilnehmen (Meeting ID: ${c.meeting_id})
          </a>
          ${c.telegram_target ? `<a href="${c.telegram_target}" target="_blank" rel="noopener noreferrer" class="btn btn-outline">Community Telegram</a>` : ''}
        </div>
      `;
    }

    if (list && data.recordings) {
      list.innerHTML = '';
      data.recordings.forEach((rec, idx) => {
        const card = document.createElement('article');
        card.className = 'zoom-card';
        card.innerHTML = `
          <div class="zoom-card-top">
            <span class="badge badge-rec">Aufzeichnung #${idx + 1}</span>
          </div>
          <h3>${rec.title}</h3>
          <p>${rec.description}</p>
          <a href="${rec.url}" target="_blank" rel="noopener noreferrer" class="zoom-link">
            Aufzeichnung auf YouTube ansehen →
          </a>
        `;
        list.appendChild(card);
      });
    }
  }

  // --- Control Listeners ---
  function setupCalculatorControls() {
    // Balance input
    if (el.balanceInput) {
      el.balanceInput.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value.replace(/[^0-9.]/g, ''));
        if (!isNaN(val) && val > 0) {
          state.balance = val;
          recalculateAndRender();
        }
      });
      el.balanceInput.addEventListener('blur', () => {
        el.balanceInput.value = `$${state.balance.toLocaleString('en-US')}`;
      });
    }

    // Preset chips
    el.presetChips.forEach(chip => {
      chip.addEventListener('click', () => {
        const amt = parseFloat(chip.dataset.amount);
        if (amt) {
          state.balance = amt;
          if (el.balanceInput) el.balanceInput.value = `$${amt.toLocaleString('en-US')}`;
          el.presetChips.forEach(c => c.classList.toggle('active', c === chip));
          recalculateAndRender();
        }
      });
    });

    // Amplify toggles
    el.ampButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const amp = parseInt(btn.dataset.amp, 10);
        if (amp) {
          state.amplify = amp;
          el.ampButtons.forEach(b => b.classList.toggle('active', b === btn));
          recalculateAndRender();
        }
      });
    });

    // Reinvest mode toggles
    el.reinvestButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const mode = btn.dataset.reinvest;
        if (mode) {
          state.reinvestMode = mode;
          el.reinvestButtons.forEach(b => b.classList.toggle('active', b === btn));
          recalculateAndRender();
        }
      });
    });

    // Display mode ($ vs %)
    const toggleDisplay = document.getElementById('btn-toggle-display');
    if (toggleDisplay) {
      toggleDisplay.addEventListener('click', () => {
        const tr = (k) => (window.i18n && window.i18n.t ? window.i18n.t(k) : k);
        state.displayMode = state.displayMode === 'cash' ? 'percent' : 'cash';
        toggleDisplay.textContent = state.displayMode === 'cash' ? tr('Modus: USD ($)') : tr('Modus: Prozent (%)');
        recalculateAndRender();
      });
    }

    // Analyse-Zeitraum (Sample Period) Slider
    if (el.sliderSampleMonths) {
      el.sliderSampleMonths.addEventListener('input', (e) => {
        state.sampleIndex = parseInt(e.target.value, 10);
        if (state.sampleSteps && state.sampleSteps[state.sampleIndex]) {
          state.sampleMonths = state.sampleSteps[state.sampleIndex].monthsEquivalent;
        }
        recalculateAndRender();
      });
    }

    // Forecast Horizon Slider
    if (el.sliderForecastMonths) {
      el.sliderForecastMonths.addEventListener('input', (e) => {
        const tr = (k) => (window.i18n && window.i18n.t ? window.i18n.t(k) : k);
        const val = parseInt(e.target.value, 10);
        state.forecastMonths = isNaN(val) ? 0 : val;
        state.isForecastActive = state.forecastMonths > 0;
        if (el.labelForecastMonths) {
          el.labelForecastMonths.textContent = state.forecastMonths === 0 ? tr('0 Monate (Aus)') : `+${state.forecastMonths} ${tr('Monate')}`;
        }
        if (el.btnToggleForecast) {
          el.btnToggleForecast.classList.toggle('active', state.isForecastActive);
          el.btnToggleForecast.textContent = state.isForecastActive ? `${tr('Prognose aktiv')} (+${state.forecastMonths}M)` : tr('Prognose aktivieren');
        }
        const step = state.sampleSteps && state.sampleSteps[state.sampleIndex];
        if (el.forecastBasisBadge) {
          el.forecastBasisBadge.textContent = state.isForecastActive 
            ? `${tr('Basis:')} ${step ? step.title : state.sampleMonths + 'M'}` 
            : tr('Prognose: Aus (Historische Ansicht)');
        }
        recalculateAndRender();
      });
    }

    if (el.btnToggleForecast) {
      el.btnToggleForecast.addEventListener('click', () => {
        const tr = (k) => (window.i18n && window.i18n.t ? window.i18n.t(k) : k);
        if (state.forecastMonths > 0) {
          state.forecastMonths = 0;
          state.isForecastActive = false;
        } else {
          state.forecastMonths = 12;
          state.isForecastActive = true;
        }
        if (el.sliderForecastMonths) el.sliderForecastMonths.value = state.forecastMonths;
        if (el.labelForecastMonths) {
          el.labelForecastMonths.textContent = state.forecastMonths === 0 ? tr('0 Monate (Aus)') : `+${state.forecastMonths} ${tr('Monate')}`;
        }
        el.btnToggleForecast.classList.toggle('active', state.isForecastActive);
        el.btnToggleForecast.textContent = state.isForecastActive ? `${tr('Prognose aktiv')} (+${state.forecastMonths}M)` : tr('Prognose aktivieren');
        const step = state.sampleSteps && state.sampleSteps[state.sampleIndex];
        if (el.forecastBasisBadge) {
          el.forecastBasisBadge.textContent = state.isForecastActive 
            ? `${tr('Basis:')} ${step ? step.title : state.sampleMonths + 'M'}` 
            : tr('Prognose: Aus (Historische Ansicht)');
        }
        recalculateAndRender();
      });
    }
  }

  function setupNavigationTabs() {
    el.navTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const targetPanel = tab.dataset.panel;
        el.navTabs.forEach(t => {
          t.setAttribute('aria-selected', String(t === tab));
          t.classList.toggle('is-active', t === tab);
        });
        el.panels.forEach(p => {
          p.hidden = p.id !== targetPanel;
        });

        if (window.i18n && window.i18n.apply) {
          window.i18n.apply(document.getElementById(targetPanel));
        }

        // Trigger resize for charts when sonic tab opened
        if (targetPanel === 'panel-sonic') {
          setTimeout(() => {
            recalculateAndRender();
            renderStreaks();
          }, 50);
        }
      });
    });
  }

  function setupInfiniteScroll() {
    const sentinel = document.getElementById('trades-scroll-sentinel');
    const wrap = document.getElementById('trades-scroll-wrap');

    const loadMore = () => {
      if (!state.allTradesLoaded && state.allTrades && state.allTrades.length > 0) {
        renderTradesSlice(state.tradesPage + 1, true);
      }
    };

    if (sentinel && 'IntersectionObserver' in window) {
      const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            loadMore();
          }
        });
      }, {
        root: wrap || null,
        rootMargin: '120px',
        threshold: 0.1
      });
      observer.observe(sentinel);
    }

    if (wrap) {
      wrap.addEventListener('scroll', () => {
        if (wrap.scrollTop + wrap.clientHeight >= wrap.scrollHeight - 100) {
          loadMore();
        }
      }, { passive: true });
    }
  }

  function initAffiliateCalculator() {
    const teamInput = document.getElementById('aff-team-balance');
    const affChips = document.querySelectorAll('.preset-chip-aff');
    const affPeriods = document.querySelectorAll('.btn-aff-period');
    const gbTotal = document.getElementById('gb-total-input');
    const gbLine = document.getElementById('gb-line-input');

    let currentPeriod = 'weekly';

    function num(val) {
      return parseFloat(String(val).replace(/[^0-9.]/g, '')) || 0;
    }

    function formatMoney(n) {
      return '$' + Math.round(n).toLocaleString('en-US');
    }

    const GB_LEVELS = [
      [10000, 1],
      [50000, 2],
      [200000, 3.5],
      [1000000, 5],
      [5000000, 5.5],
      [7500000, 6],
      [20000000, 6.5],
      [50000000, 7],
      [100000000, 7.5]
    ];

    function getGbLevel(tot, biggest) {
      for (let i = GB_LEVELS.length - 1; i >= 0; i--) {
        const need = GB_LEVELS[i][0];
        if (Math.min(biggest, need / 2) + (tot - biggest) >= need) return GB_LEVELS[i];
      }
      return null;
    }

    function getGbLineLevel(vol) {
      for (let i = GB_LEVELS.length - 1; i >= 0; i--) {
        if (vol >= GB_LEVELS[i][0]) return GB_LEVELS[i];
      }
      return null;
    }

    function recalculateAffiliate() {
      const teamBalance = num(teamInput ? teamInput.value : 100000);

      // Determine monthly performance rate (live from past 30 days or default ~16%)
      let monthlyProfitRate = 0.16; // 16% monthly profit assumption as requested
      if (state.growthData && state.growthData.growth && state.growthData.growth.length > 30) {
        const pts = state.growthData.growth;
        const curGain = pts[pts.length - 1].gain_pct;
        const lastDt = new Date(pts[pts.length - 1].date + 'T12:00:00Z');
        const targetDt = lastDt.getTime() - (30.4375 * 86400000);
        let pt30 = pts[0];
        for (let i = pts.length - 1; i >= 0; i--) {
          if (new Date(pts[i].date + 'T12:00:00Z').getTime() <= targetDt) {
            pt30 = pts[i];
            break;
          }
        }
        const gain30d1x = ((100 + curGain) / (100 + pt30.gain_pct)) - 1;
        const gain30dAmp = gain30d1x * 24;
        if (gain30dAmp >= 0.08 && gain30dAmp <= 0.40) {
          monthlyProfitRate = gain30dAmp;
        }
      }

      if (el.affLiveRateBadge) {
        el.affLiveRateBadge.textContent = `Basis: ${(monthlyProfitRate * 100).toFixed(1)}% p.M. (Live)`;
      }

      const dailyGross = (teamBalance * monthlyProfitRate) / 21.6;
      const weeklyGross = (teamBalance * monthlyProfitRate) / 4.33;
      const monthlyGross = teamBalance * monthlyProfitRate;

      if (el.affGrossDaily) el.affGrossDaily.textContent = formatMoney(dailyGross);
      if (el.affGrossWeekly) el.affGrossWeekly.textContent = formatMoney(weeklyGross);
      if (el.affGrossMonthly) el.affGrossMonthly.textContent = formatMoney(monthlyGross);

      // Share Bonus (2.5% of gross team profits across generations)
      const shareMonthly = monthlyGross * 0.025;
      const shareWeekly = weeklyGross * 0.025;

      if (el.affShareWeek) el.affShareWeek.textContent = formatMoney(shareWeekly);
      if (el.affShareMonth) el.affShareMonth.textContent = formatMoney(shareMonthly);

      // Lot Bonus: 38.8% (single level) or 21.7% (multi-level average) of Share Bonus
      const lotRatio = state.lotBonusMode === 'single' ? 0.388 : 0.217;
      const lotMonthly = shareMonthly * lotRatio;
      const lotWeekly = shareWeekly * lotRatio;

      if (el.affLotWeek) el.affLotWeek.textContent = formatMoney(lotWeekly);
      if (el.affLotMonth) el.affLotMonth.textContent = formatMoney(lotMonthly);
      if (el.affLotSub) {
        el.affLotSub.textContent = state.lotBonusMode === 'single'
          ? 'wöchentliche Auszahlung (~38.8% des Share-Bonus bei Ebene 1 direkt)'
          : 'wöchentliche Auszahlung (~21.7% des Share-Bonus im Multi-Level Ø)';
      }

      // General Bonus
      const totVol = num(gbTotal ? gbTotal.value : 150000);
      const biggestLine = Math.min(num(gbLine ? gbLine.value : 40000), totVol);

      const lv = getGbLevel(totVol, biggestLine);
      const rate = lv ? lv[1] : 0;
      const ll = getGbLineLevel(biggestLine);
      const lineRate = Math.min(ll ? ll[1] : 0, rate);

      const fromLine = ((rate - lineRate) / 100) * biggestLine;
      const fromRest = (rate / 100) * (totVol - biggestLine);
      const gbMonthly = fromLine + fromRest;

      if (el.gbLevelPct) el.gbLevelPct.textContent = lv ? `${rate}%` : '-';
      if (el.gbLevelSub) el.gbLevelSub.textContent = lv ? `ab ${formatMoney(lv[0])} Teamvolumen` : 'Noch keine Stufe';

      const counted = lv ? Math.min(biggestLine, lv[0] / 2) + (totVol - biggestLine) : totVol;
      if (el.gbCountedVol) el.gbCountedVol.textContent = formatMoney(counted);
      if (el.gbCountedSub) el.gbCountedSub.textContent = lv ? `Stärkste Linie max. ${formatMoney(lv[0] / 2)} gewertet` : '50%-Regel aktiv';

      const next = GB_LEVELS.find(l => !lv || l[0] > lv[0]);
      if (el.gbNextPct) el.gbNextPct.textContent = next ? `${next[1]}%` : 'Max';
      if (el.gbNextSub) el.gbNextSub.textContent = next ? `ab ${formatMoney(next[0])} Teamvolumen` : 'Höchste Stufe erreicht';

      if (el.gbPayout) el.gbPayout.textContent = formatMoney(gbMonthly);

      if (el.gbCalcNote) {
        el.gbCalcNote.textContent = `Berechnung: Stärkste Linie (${formatMoney(biggestLine)}) erreicht eigene ${lineRate}%-Stufe (Differenz: ${rate}% - ${lineRate}% = ${(rate - lineRate).toFixed(1)}% = ${formatMoney(fromLine)}). Restliches Team: volle ${rate}% auf ${formatMoney(totVol - biggestLine)} = ${formatMoney(fromRest)}. General Bonus = ${formatMoney(gbMonthly)}.`;
      }

      // Grand Total
      if (el.grandShare) el.grandShare.textContent = formatMoney(shareWeekly * 4.33);
      if (el.grandLot) el.grandLot.textContent = formatMoney(lotWeekly * 4.33);
      if (el.grandGb) el.grandGb.textContent = formatMoney(gbMonthly);
      if (el.grandTotal) el.grandTotal.textContent = formatMoney((shareWeekly * 4.33) + (lotWeekly * 4.33) + gbMonthly);
    }

    if (el.btnLotModes) {
      el.btnLotModes.forEach(btn => {
        btn.addEventListener('click', () => {
          const mode = btn.dataset.lotMode;
          if (mode) {
            state.lotBonusMode = mode;
            el.btnLotModes.forEach(b => b.classList.toggle('active', b === btn));
            recalculateAffiliate();
          }
        });
      });
    }

    if (teamInput) {
      teamInput.addEventListener('input', recalculateAffiliate);
      teamInput.addEventListener('blur', () => {
        teamInput.value = formatMoney(num(teamInput.value));
      });
    }

    affChips.forEach(chip => {
      chip.addEventListener('click', () => {
        const val = chip.dataset.amount;
        if (val && teamInput) {
          teamInput.value = formatMoney(parseFloat(val));
          affChips.forEach(c => c.classList.toggle('active', c === chip));
          recalculateAffiliate();
        }
      });
    });



    if (gbTotal) {
      gbTotal.addEventListener('input', recalculateAffiliate);
      gbTotal.addEventListener('blur', () => {
        gbTotal.value = formatMoney(num(gbTotal.value));
      });
    }

    if (gbLine) {
      gbLine.addEventListener('input', recalculateAffiliate);
      gbLine.addEventListener('blur', () => {
        gbLine.value = formatMoney(num(gbLine.value));
      });
    }

    // Initial calculation
    recalculateAffiliate();
  }

  // --- Date Helpers (location-agnostic calendar dates via Temporal.PlainDate + safe fallback) ---
  const MONTH_NAMES_DE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
  const MONTH_SHORT_DE = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function formatISODate(year, month, day) {
    return `${year}-${pad2(month)}-${pad2(day)}`;
  }

  function getTodayPlainDate() {
    if (typeof globalThis.Temporal !== 'undefined' && globalThis.Temporal.Now) {
      const pd = globalThis.Temporal.Now.plainDateISO();
      return { year: pd.year, month: pd.month, day: pd.day };
    }
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
  }

  function daysInMonth(year, month) {
    if (typeof globalThis.Temporal !== 'undefined' && globalThis.Temporal.PlainYearMonth) {
      return globalThis.Temporal.PlainYearMonth.from({ year, month }).daysInMonth;
    }
    return new Date(Date.UTC(year, month, 0)).getUTCDate();
  }

  function isoWeekdayMonday1(year, month, day) {
    if (typeof globalThis.Temporal !== 'undefined' && globalThis.Temporal.PlainDate) {
      return globalThis.Temporal.PlainDate.from({ year, month, day }).dayOfWeek;
    }
    const dow = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    return dow === 0 ? 7 : dow;
  }

  function addMonths(ym, delta) {
    const total = ym.year * 12 + (ym.month - 1) + delta;
    const year = Math.floor(total / 12);
    const month = ((total % 12) + 12) % 12 + 1;
    return { year, month };
  }

  function detectLatestActiveMonth() {
    if (!state.allTrades || state.allTrades.length === 0) return;
    const first = state.allTrades[0];
    const raw = (first && (first.close || first.open)) || '';
    const m = raw.match(/^(\d{4})-(\d{2})/);
    if (m) {
      state.latestActiveMonth = { year: parseInt(m[1], 10), month: parseInt(m[2], 10) };
      if (state.calendarData) renderCalendar();
    }
  }

  function escapeHtml(str) {
    return String(str == null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function fmtSignedCurrency(val) {
    const n = Number(val || 0);
    const abs = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return n < 0 ? `-$${abs}` : `+$${abs}`;
  }

  function fmtSignedPct(val) {
    const n = Number(val || 0);
    const sign = n > 0 ? '+' : '';
    return `${sign}${n.toFixed(2)}%`;
  }

  // --- Trading Calendar ---
  function setupCalendarControls() {
    if (el.calPrevBtn) {
      el.calPrevBtn.addEventListener('click', () => {
        if (!state.calendarMonth) return;
        state.calendarMonth = addMonths(state.calendarMonth, -1);
        fetchCalendar();
      });
    }
    if (el.calNextBtn) {
      el.calNextBtn.addEventListener('click', () => {
        if (!state.calendarMonth) return;
        state.calendarMonth = addMonths(state.calendarMonth, 1);
        fetchCalendar();
      });
    }
    if (el.calCurrentBtn) {
      el.calCurrentBtn.addEventListener('click', () => {
        const today = getTodayPlainDate();
        state.calendarMonth = { year: today.year, month: today.month };
        fetchCalendar();
      });
    }
    if (el.calJumpLatestBtn) {
      el.calJumpLatestBtn.addEventListener('click', () => {
        if (state.latestActiveMonth) {
          state.calendarMonth = { ...state.latestActiveMonth };
          fetchCalendar();
        }
      });
    }
  }

  async function fetchCalendar() {
    if (!state.calendarMonth) {
      const today = getTodayPlainDate();
      state.calendarMonth = { year: today.year, month: today.month };
    }
    const ymStr = `${state.calendarMonth.year}-${pad2(state.calendarMonth.month)}`;
    try {
      const res = await fetch(`/api/sonic/calendar?month=${encodeURIComponent(ymStr)}`);
      if (!res.ok) throw new Error('Calendar fetch failed');
      state.calendarData = await res.json();

      const activeDays = (state.calendarData.days || []).filter(d => d.trades_count > 0);
      if (activeDays.length > 0) {
        state.calendarSelectedDate = activeDays[activeDays.length - 1].date;
      } else {
        state.calendarSelectedDate = null;
      }
      renderCalendar();
    } catch (err) {
      console.warn('[App] Could not fetch calendar:', err.message);
      if (el.calBody) {
        el.calBody.innerHTML = '<tr><td colspan="7" class="cal-loading-cell">Kalenderdaten konnten nicht geladen werden.</td></tr>';
      }
    }
  }

  function renderCalendar() {
    if (!el.calBody || !state.calendarMonth) return;
    const { year, month } = state.calendarMonth;
    const data = state.calendarData;

    if (el.calMonthLabel) {
      el.calMonthLabel.textContent = `${MONTH_NAMES_DE[month - 1] || ''} ${year}`;
    }

    const totalMonthTrades = data && data.summary ? (data.summary.trades_count || 0) : 0;
    if (el.calJumpLatestBtn) {
      const hasOtherLatest = state.latestActiveMonth &&
        (state.latestActiveMonth.year !== year || state.latestActiveMonth.month !== month);
      if (totalMonthTrades === 0 && hasOtherLatest) {
        const label = `${MONTH_SHORT_DE[state.latestActiveMonth.month - 1]} ${state.latestActiveMonth.year}`;
        el.calJumpLatestBtn.textContent = `Letzter aktiver Monat (${label})`;
        el.calJumpLatestBtn.hidden = false;
      } else {
        el.calJumpLatestBtn.hidden = true;
      }
    }

    if (el.calMonthSummary && data && data.summary) {
      const s = data.summary;
      const dClass = s.delta_account_value >= 0 ? 'pos' : 'neg';
      const g12Class = s.growth_12x_pct >= 0 ? 'pos' : 'neg';
      const g24Class = s.growth_24x_pct >= 0 ? 'pos' : 'neg';
      const g1Class = s.growth_1x_pct >= 0 ? 'pos' : 'neg';
      el.calMonthSummary.innerHTML = `
        <div class="cal-summary-pill"><span>Monats-Delta (Master)</span><strong class="${dClass}">${fmtSignedCurrency(s.delta_account_value)}</strong></div>
        <div class="cal-summary-pill"><span>Trades (Win / Loss)</span><strong>${s.trades_count} (${s.wins}W / ${s.losses}L)</strong></div>
        <div class="cal-summary-pill"><span>Master-Wachstum (1x)</span><strong class="${g1Class}">${fmtSignedPct(s.growth_1x_pct)}</strong></div>
        <div class="cal-summary-pill"><span>12x Netto (inkl. 30% Fee)</span><strong class="${g12Class}">${fmtSignedPct(s.growth_12x_pct)}</strong></div>
        <div class="cal-summary-pill"><span>24x Netto (inkl. 30% Fee)</span><strong class="${g24Class}">${fmtSignedPct(s.growth_24x_pct)}</strong></div>
      `;
    }

    const byDate = Object.create(null);
    if (data && Array.isArray(data.days)) {
      data.days.forEach(d => {
        byDate[d.date] = d;
      });
    }

    const today = getTodayPlainDate();
    const todayIso = formatISODate(today.year, today.month, today.day);
    const totalDays = daysInMonth(year, month);
    const leadingEmpty = isoWeekdayMonday1(year, month, 1) - 1;
    const totalCells = Math.ceil((leadingEmpty + totalDays) / 7) * 7;

    el.calBody.innerHTML = '';
    let tr = null;
    for (let idx = 0; idx < totalCells; idx++) {
      if (idx % 7 === 0) {
        tr = document.createElement('tr');
        el.calBody.appendChild(tr);
      }
      const td = document.createElement('td');
      const dayNum = idx - leadingEmpty + 1;
      if (dayNum < 1 || dayNum > totalDays) {
        td.className = 'cal-cell cal-cell-outside';
        tr.appendChild(td);
        continue;
      }

      td.className = 'cal-cell';
      const iso = formatISODate(year, month, dayNum);
      const dayData = byDate[iso];
      const hasTrades = dayData && dayData.trades_count > 0;
      const isSelected = state.calendarSelectedDate === iso;
      const isToday = iso === todayIso;

      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.date = iso;
      btn.setAttribute('aria-pressed', String(isSelected));
      btn.className = 'cal-day-btn' +
        (hasTrades ? ` has-trades ${dayData.delta_account_value >= 0 ? 'is-pos' : 'is-neg'}` : '') +
        (isSelected ? ' is-selected' : '') +
        (isToday ? ' is-today' : '');

      if (hasTrades) {
        const deltaClass = dayData.delta_account_value >= 0 ? 'pos' : 'neg';
        btn.innerHTML = `
          <div class="cal-day-head">
            <span class="cal-day-num">${dayNum}</span>
            ${isToday ? '<span class="cal-today-tag">Heute</span>' : ''}
          </div>
          <div class="cal-day-delta ${deltaClass}">${fmtSignedCurrency(dayData.delta_account_value)}</div>
          <div class="cal-day-stats">${dayData.trades_count} ${dayData.trades_count === 1 ? 'Trade' : 'Trades'} · ${dayData.wins}W/${dayData.losses}L</div>
          <div class="cal-day-growth">
            <span>12x: ${fmtSignedPct(dayData.growth_12x_pct)}</span>
            <span>24x: ${fmtSignedPct(dayData.growth_24x_pct)}</span>
          </div>
        `;
      } else {
        btn.innerHTML = `
          <div class="cal-day-head">
            <span class="cal-day-num">${dayNum}</span>
            ${isToday ? '<span class="cal-today-tag">Heute</span>' : ''}
          </div>
          <span class="cal-day-empty">—</span>
        `;
      }

      btn.addEventListener('click', () => {
        state.calendarSelectedDate = iso;
        el.calBody.querySelectorAll('.cal-day-btn').forEach(b => {
          const sel = b.dataset.date === iso;
          b.classList.toggle('is-selected', sel);
          b.setAttribute('aria-pressed', String(sel));
        });
        renderCalendarDayDetail(iso);
      });

      td.appendChild(btn);
      tr.appendChild(td);
    }

    renderCalendarDayDetail(state.calendarSelectedDate);
  }

  function renderCalendarDayDetail(iso) {
    if (!el.calDayDetail) return;
    if (!iso || !state.calendarData || !Array.isArray(state.calendarData.days)) {
      el.calDayDetail.hidden = true;
      return;
    }
    const dayData = state.calendarData.days.find(d => d.date === iso);
    if (!dayData) {
      el.calDayDetail.hidden = true;
      return;
    }

    const parts = iso.split('-');
    const niceDate = parts.length === 3
      ? `${parseInt(parts[2], 10)}. ${MONTH_NAMES_DE[parseInt(parts[1], 10) - 1] || ''} ${parts[0]}`
      : iso;

    const trades = Array.isArray(dayData.trades) ? dayData.trades : [];
    const tradesRows = trades.length > 0
      ? trades.map(t => {
          const isBuy = t.action === 'Buy';
          const pNum = Number(t.profit || 0);
          const pCls = pNum >= 0 ? 'pos' : 'neg';
          const pipsStr = typeof t.pips === 'number' ? t.pips.toFixed(1) : '-';
          return `
            <tr>
              <td><span class="badge ${isBuy ? 'badge-buy' : 'badge-sell'}">${escapeHtml(t.action)}</span> <strong>${escapeHtml(t.symbol)}</strong></td>
              <td class="font-tabular">${escapeHtml(fmtLots(t.lots))}</td>
              <td class="font-tabular">${escapeHtml(formatTradeDate(t.open))}</td>
              <td class="font-tabular">${escapeHtml(formatTradeDate(t.close))}</td>
              <td class="font-tabular ${pCls}">${escapeHtml(pipsStr)}</td>
              <td class="font-tabular ${pCls}"><strong>${escapeHtml(fmtCurrency(t.profit))}</strong></td>
            </tr>
          `;
        }).join('')
      : '<tr><td colspan="6" style="text-align:center; color: var(--text-muted); padding: 14px;">Keine geschlossenen Trades an diesem Kalendertag.</td></tr>';

    const dCls = dayData.delta_account_value >= 0 ? 'pos' : 'neg';
    const g12Cls = dayData.growth_12x_pct >= 0 ? 'pos' : 'neg';
    const g24Cls = dayData.growth_24x_pct >= 0 ? 'pos' : 'neg';

    el.calDayDetail.innerHTML = `
      <div class="cal-detail-header">
        <h3>Tagesdetails: ${escapeHtml(niceDate)}</h3>
        <button type="button" class="cal-detail-close" id="cal-detail-close-btn">Schließen &#10005;</button>
      </div>
      <div class="cal-detail-metrics">
        <div class="cal-summary-pill"><span>Kontowert-Delta</span><strong class="${dCls}">${fmtSignedCurrency(dayData.delta_account_value)}</strong></div>
        <div class="cal-summary-pill"><span>Trades (Win / Loss)</span><strong>${dayData.trades_count} (${dayData.wins}W / ${dayData.losses}L)</strong></div>
        <div class="cal-summary-pill"><span>12x Netto (inkl. 30% Fee)</span><strong class="${g12Cls}">${fmtSignedPct(dayData.growth_12x_pct)}</strong></div>
        <div class="cal-summary-pill"><span>24x Netto (inkl. 30% Fee)</span><strong class="${g24Cls}">${fmtSignedPct(dayData.growth_24x_pct)}</strong></div>
      </div>
      <div class="cal-detail-trades-wrap">
        <table class="cal-detail-table">
          <thead>
            <tr>
              <th scope="col">Instrument</th>
              <th scope="col">Lots</th>
              <th scope="col">Eröffnet</th>
              <th scope="col">Geschlossen</th>
              <th scope="col">Pips</th>
              <th scope="col">Profit</th>
            </tr>
          </thead>
          <tbody>${tradesRows}</tbody>
        </table>
      </div>
    `;
    el.calDayDetail.hidden = false;

    const closeBtn = document.getElementById('cal-detail-close-btn');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        state.calendarSelectedDate = null;
        el.calDayDetail.hidden = true;
        el.calBody.querySelectorAll('.cal-day-btn').forEach(b => {
          b.classList.remove('is-selected');
          b.setAttribute('aria-pressed', 'false');
        });
      });
    }
  }

  // --- Streaks Analytics ---
  async function fetchStreaks() {
    try {
      const res = await fetch('/api/sonic/streaks');
      if (!res.ok) throw new Error('Streaks fetch failed');
      state.streaksData = await res.json();
      renderStreaks();
    } catch (err) {
      console.warn('[App] Could not fetch streaks:', err.message);
    }
  }

  function renderStreaks() {
    const s = state.streaksData;
    if (!s) return;

    if (el.streakCurValue) {
      el.streakCurValue.classList.remove('pos', 'neg');
      if (s.current_winning_streak > 0) {
        el.streakCurValue.textContent = `${s.current_winning_streak} Gewinn${s.current_winning_streak === 1 ? '' : 'e'} in Folge`;
        el.streakCurValue.classList.add('pos');
      } else if (s.current_losing_streak > 0) {
        el.streakCurValue.textContent = `${s.current_losing_streak} Verlust${s.current_losing_streak === 1 ? '' : 'e'} in Folge`;
        el.streakCurValue.classList.add('neg');
      } else {
        el.streakCurValue.textContent = '0';
      }
    }
    if (el.streakMaxWin) el.streakMaxWin.textContent = String(s.longest_winning_streak || 0);
    if (el.streakMaxLoss) el.streakMaxLoss.textContent = String(s.longest_losing_streak || 0);
    if (el.streakTotalTrades) el.streakTotalTrades.textContent = String(s.total_trades || 0);

    if (el.streaksChartCanvas && window.SonicChart && window.SonicChart.renderStreaks) {
      window.SonicChart.renderStreaks(el.streaksChartCanvas, s);
    }
  }

  // --- Manual Refresh & Live Status ---
  function getLiveAgeSeconds() {
    if (!state.summary) return null;
    const base = Number(state.summary.age_seconds || 0);
    const elapsed = state.summaryFetchedAtMs > 0
      ? Math.max(0, Math.floor((Date.now() - state.summaryFetchedAtMs) / 1000))
      : 0;
    return base + elapsed;
  }

  function getMinForceSeconds() {
    return Number((state.summary && state.summary.min_force_seconds) || 1800);
  }

  function setupRefreshButton() {
    if (!el.refreshBtn) return;
    const tr = (k) => (window.i18n && window.i18n.t ? window.i18n.t(k) : k);
    el.refreshBtn.addEventListener('click', async () => {
      if (state.isRefreshing || el.refreshBtn.disabled) return;
      state.isRefreshing = true;
      el.refreshBtn.classList.add('loading');
      el.refreshBtn.disabled = true;
      el.refreshBtn.textContent = tr('Aktualisiere Myfxbook...');
      if (el.syncDot) el.syncDot.classList.add('syncing');

      try {
        const res = await fetch('/api/sonic/update?force=true', { method: 'POST' });
        const data = await res.json();

        if (data && (data.force_ignored || data.cooldown_active)) {
          await fetchSummary();
        } else if (data && (data.started || data.status === 'already_running')) {
          for (let attempt = 0; attempt < 40; attempt++) {
            await new Promise(r => setTimeout(r, 3000));
            const sRes = await fetch('/api/sonic/summary');
            if (!sRes.ok) continue;
            const fresh = await sRes.json();
            state.summary = fresh;
            state.summaryFetchedAtMs = Date.now();
            if (!fresh.is_updating) {
              renderSummaryCards();
              renderPeriodsTable();
              await Promise.all([fetchGrowthData(), fetchAllTrades(), fetchCalendar(), fetchStreaks()]);
              break;
            }
          }
        } else {
          await Promise.all([fetchSummary(), fetchGrowthData(), fetchAllTrades(), fetchCalendar(), fetchStreaks()]);
        }
      } catch (err) {
        console.error('Refresh error:', err);
      } finally {
        state.isRefreshing = false;
        el.refreshBtn.classList.remove('loading');
        if (el.syncDot) el.syncDot.classList.remove('syncing');
        updateStatusBadge();
      }
    });
  }

  function updateStatusBadge() {
    if (!state.summary) return;
    const s = state.summary;
    const tr = (k) => (window.i18n && window.i18n.t ? window.i18n.t(k) : k);
    if (el.lastUpdated && s.fetched_utc) {
      el.lastUpdated.textContent = formatBerlinTimestamp(s.fetched_utc);
    }
    const ageSeconds = getLiveAgeSeconds();
    if (el.syncStatusIndicator && ageSeconds !== null) {
      const mins = Math.floor(ageSeconds / 60);
      if (mins < 1) {
        el.syncStatusIndicator.textContent = tr('(gerade synchronisiert)');
      } else if (mins < 60) {
        const tmpl = tr('(vor {mins} Min. synchronisiert)');
        el.syncStatusIndicator.textContent = tmpl.replace('{mins}', mins);
      } else {
        const hrs = Math.floor(mins / 60);
        el.syncStatusIndicator.textContent = `(vor ${hrs} Std. synchronisiert)`;
      }
    }

    if (el.refreshBtn && !state.isRefreshing) {
      const minForce = getMinForceSeconds();
      const cooldownActive = ageSeconds !== null && ageSeconds < minForce;
      const isUpdating = !!s.is_updating;
      el.refreshBtn.disabled = cooldownActive || isUpdating;
      el.refreshBtn.textContent = isUpdating ? tr('Aktualisiere Myfxbook...') : tr('Jetzt aktualisieren');
      if (isUpdating) {
        el.refreshBtn.title = 'Aktualisierung läuft bereits.';
      } else if (cooldownActive) {
        const waitMins = Math.max(1, Math.ceil((minForce - ageSeconds) / 60));
        el.refreshBtn.title = `Erneute Aktualisierung erst in ca. ${waitMins} Min. möglich (30-Min.-Sperrfrist).`;
      } else {
        el.refreshBtn.title = 'Daten jetzt von Myfxbook aktualisieren';
      }
    }
  }

  async function checkAndTriggerAsyncUpdate() {
    if (!state.summary) return;
    const ageSeconds = state.summary.age_seconds || 0;
    const isStale = state.summary.is_stale || ageSeconds >= 3600;

    // Only update if cache is more than 60 minutes old
    if (!isStale) return;

    const tr = (k) => (window.i18n && window.i18n.t ? window.i18n.t(k) : k);
    if (el.syncStatusIndicator) {
      el.syncStatusIndicator.textContent = tr('Aktualisiere Daten im Hintergrund...');
    }
    if (el.syncDot) el.syncDot.classList.add('syncing');

    try {
      const res = await fetch('/api/sonic/update', { method: 'POST' });
      const updateData = await res.json();

      if (updateData.started || updateData.status === 'already_running') {
        let attempts = 0;
        const interval = setInterval(async () => {
          attempts++;
          try {
            const checkRes = await fetch('/api/sonic/summary');
            if (checkRes.ok) {
              const fresh = await checkRes.json();
              if (!fresh.is_updating && fresh.age_seconds < 120) {
                clearInterval(interval);
                state.summary = fresh;
                state.summaryFetchedAtMs = Date.now();
                renderSummaryCards();
                renderPeriodsTable();
                updateStatusBadge();
                await Promise.all([fetchGrowthData(), fetchAllTrades(), fetchCalendar(), fetchStreaks()]);
                if (el.syncStatusIndicator) {
                  el.syncStatusIndicator.textContent = `${tr('Gerade aktualisiert')} ✓`;
                  setTimeout(() => {
                    if (el.syncStatusIndicator && state.summary) {
                      updateStatusBadge();
                    }
                  }, 4000);
                }
                if (el.syncDot) el.syncDot.classList.remove('syncing');
                return;
              }
            }
          } catch (e) {
            // ignore network glitch
          }

          if (attempts >= 15) {
            clearInterval(interval);
            if (el.syncStatusIndicator) updateStatusBadge();
            if (el.syncDot) el.syncDot.classList.remove('syncing');
          }
        }, 4000);
      } else {
        if (el.syncDot) el.syncDot.classList.remove('syncing');
      }
    } catch (err) {
      console.warn('[App] Async background update error:', err);
      if (el.syncStatusIndicator) updateStatusBadge();
      if (el.syncDot) el.syncDot.classList.remove('syncing');
    }
  }

  function setupCarousel() {
    const events = document.getElementById('events');
    if (!events) return;
    const slides = events.querySelectorAll('.slide');
    if (slides.length < 2) return;

    let cur = 0;
    setInterval(() => {
      slides[cur].classList.remove('is-active');
      cur = (cur + 1) % slides.length;
      slides[cur].classList.add('is-active');
    }, 8000);
  }

  window.addEventListener('resize', () => {
    recalculateAndRender();
    renderStreaks();
  });

  window.addEventListener('i18n:ready', () => {
    recalculateAndRender();
  });
  if (window.i18n && window.i18n.ready) {
    window.i18n.ready.then(() => {
      recalculateAndRender();
    });
  }
})();
