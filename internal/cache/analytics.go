package cache

import (
	"math"
	"sort"
	"time"

	"github.com/windowsfreak/sonic/internal/models"
)

const (
	PerformanceFeeRate = 0.30
	NetInvestorShare   = 0.70
)

func roundDecimals(val float64, decimals int) float64 {
	pow := math.Pow(10, float64(decimals))
	r := math.Round(val*pow) / pow
	if r == 0 {
		return 0
	}
	return r
}

func tradeTimestamp(t models.ClosedTrade) (time.Time, bool) {
	if !t.Close.IsZero() {
		return t.Close.UTC(), true
	}
	if !t.Open.IsZero() {
		return t.Open.UTC(), true
	}
	return time.Time{}, false
}

func tradeDateISO(t models.ClosedTrade) string {
	if ts, ok := tradeTimestamp(t); ok {
		return ts.Format("2006-01-02")
	}
	return ""
}

func applyPerformanceFee(grossPct float64) float64 {
	if grossPct > 0 {
		return grossPct * NetInvestorShare
	}
	return grossPct
}

// BuildCalendar aggregates trades and leveraged net returns (after 30% performance fee)
// for a window of days ending at anchorDate (or starting at anchorDate when forward=true).
func BuildCalendar(data *models.SonicData, anchorDate time.Time, days int, forward bool) *models.CalendarResponse {
	if days <= 0 {
		days = 7
	}
	if days > 366 {
		days = 366
	}

	anchor := time.Date(anchorDate.Year(), anchorDate.Month(), anchorDate.Day(), 0, 0, 0, 0, time.UTC)
	startDate := anchor.AddDate(0, 0, -(days - 1))
	endDate := anchor
	if forward {
		startDate = anchor
		endDate = anchor.AddDate(0, 0, days-1)
	}

	masterBalance := 140000.0
	if data != nil && data.General.Balance > 0 {
		masterBalance = data.General.Balance
	}

	tradesByDate := make(map[string][]models.ClosedTrade)
	if data != nil {
		for _, t := range data.Trades {
			iso := tradeDateISO(t)
			if iso != "" {
				tradesByDate[iso] = append(tradesByDate[iso], t)
			}
		}
	}

	calDays := make([]models.CalendarDay, 0, days)
	var summaryDelta float64
	var summaryTrades, summaryWins, summaryLosses int
	summaryFactor1x := 1.0
	summaryFactor12x := 1.0
	summaryFactor24x := 1.0

	for i := 0; i < days; i++ {
		cur := startDate.AddDate(0, 0, i)
		iso := cur.Format("2006-01-02")
		dayTrades := tradesByDate[iso]
		if dayTrades == nil {
			dayTrades = []models.ClosedTrade{}
		}

		var delta float64
		var wins, losses int
		factor1x := 1.0

		for _, t := range dayTrades {
			delta += t.Profit
			if t.Profit > 0 {
				wins++
			} else if t.Profit < 0 {
				losses++
			}

			var r float64
			if t.GainPct != 0 {
				r = t.GainPct / 100.0
			} else if t.Profit != 0 && masterBalance > 0 {
				r = t.Profit / masterBalance
			}
			factor1x *= (1.0 + r)
		}

		g1x := (factor1x - 1.0) * 100.0
		g12x := applyPerformanceFee(g1x * 12.0)
		g24x := applyPerformanceFee(g1x * 24.0)

		dayCopy := make([]models.ClosedTrade, len(dayTrades))
		copy(dayCopy, dayTrades)

		calDays = append(calDays, models.CalendarDay{
			Date:              iso,
			DeltaAccountValue: roundDecimals(delta, 2),
			TradesCount:       len(dayCopy),
			Wins:              wins,
			Losses:            losses,
			Growth1xPct:       roundDecimals(g1x, 4),
			Growth12xPct:      roundDecimals(g12x, 4),
			Growth24xPct:      roundDecimals(g24x, 4),
			Trades:            dayCopy,
		})

		summaryDelta += delta
		summaryTrades += len(dayCopy)
		summaryWins += wins
		summaryLosses += losses
		summaryFactor1x *= (1.0 + g1x/100.0)
		summaryFactor12x *= (1.0 + g12x/100.0)
		summaryFactor24x *= (1.0 + g24x/100.0)
	}

	return &models.CalendarResponse{
		Date:               anchor.Format("2006-01-02"),
		StartDate:          startDate.Format("2006-01-02"),
		EndDate:            endDate.Format("2006-01-02"),
		DaysRequested:      days,
		PerformanceFeeRate: PerformanceFeeRate,
		Summary: models.CalendarSummary{
			DeltaAccountValue: roundDecimals(summaryDelta, 2),
			TradesCount:       summaryTrades,
			Wins:              summaryWins,
			Losses:            summaryLosses,
			Growth1xPct:       roundDecimals((summaryFactor1x-1.0)*100.0, 4),
			Growth12xPct:      roundDecimals((summaryFactor12x-1.0)*100.0, 4),
			Growth24xPct:      roundDecimals((summaryFactor24x-1.0)*100.0, 4),
		},
		Days: calDays,
	}
}

// ComputeStreaks computes current, longest, and length-occurrence distributions for
// winning and losing streaks across closed trades sorted chronologically.
func ComputeStreaks(data *models.SonicData) *models.StreaksResponse {
	resp := &models.StreaksResponse{
		WinningDistribution: []int{},
		LosingDistribution:  []int{},
	}
	if data == nil || len(data.Trades) == 0 {
		return resp
	}

	// Copy and reverse first so same-timestamp trades preserve chronological order
	// (cache stores trades newest-first).
	ordered := make([]models.ClosedTrade, len(data.Trades))
	n := len(data.Trades)
	for i := 0; i < n; i++ {
		ordered[i] = data.Trades[n-1-i]
	}

	sort.SliceStable(ordered, func(i, j int) bool {
		ti, oki := tradeTimestamp(ordered[i])
		tj, okj := tradeTimestamp(ordered[j])
		if oki && okj {
			return ti.Before(tj)
		}
		return false
	})

	winCounts := make(map[int]int)
	lossCounts := make(map[int]int)
	var lastKind string
	var runLen int
	var longestWin, longestLoss int

	flushRun := func() {
		if runLen <= 0 || lastKind == "" {
			return
		}
		if lastKind == "win" {
			winCounts[runLen]++
			if runLen > longestWin {
				longestWin = runLen
			}
		} else {
			lossCounts[runLen]++
			if runLen > longestLoss {
				longestLoss = runLen
			}
		}
	}

	evaluated := 0
	for _, t := range ordered {
		var kind string
		if t.Profit > 0 {
			kind = "win"
		} else if t.Profit < 0 {
			kind = "loss"
		} else {
			continue
		}
		evaluated++

		if kind == lastKind {
			runLen++
		} else {
			flushRun()
			lastKind = kind
			runLen = 1
		}
	}
	flushRun()

	resp.TotalTrades = evaluated
	resp.LongestWinningStreak = longestWin
	resp.LongestLosingStreak = longestLoss
	if lastKind == "win" {
		resp.CurrentWinningStreak = runLen
		resp.CurrentLosingStreak = 0
	} else if lastKind == "loss" {
		resp.CurrentWinningStreak = 0
		resp.CurrentLosingStreak = runLen
	}

	if longestWin > 0 {
		resp.WinningDistribution = make([]int, longestWin)
		for length, count := range winCounts {
			resp.WinningDistribution[length-1] = count
		}
	}
	if longestLoss > 0 {
		resp.LosingDistribution = make([]int, longestLoss)
		for length, count := range lossCounts {
			resp.LosingDistribution[length-1] = count
		}
	}

	return resp
}
