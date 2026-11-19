package cache

import (
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"reflect"
	"sort"
	"strings"
	"time"

	"github.com/windowsfreak/sonic/internal/models"
)

const (
	defaultMasterBalance  = 140000.0
	defaultLotsPer1k      = 0.00076
	webhookTimeMatchLimit = 120 * time.Second
)

// parseWebhookTimestamp parses ISO-8601 / RFC3339 or common datetime strings into UTC.
func parseWebhookTimestamp(raw string) (time.Time, error) {
	s := strings.TrimSpace(raw)
	if s == "" {
		return time.Time{}, fmt.Errorf("empty timestamp")
	}
	layouts := []string{
		time.RFC3339Nano,
		time.RFC3339,
		"2006-01-02T15:04:05",
		"2006-01-02 15:04:05",
		"2006.01.02 15:04:05",
	}
	for _, layout := range layouts {
		if t, err := time.Parse(layout, s); err == nil {
			return t.UTC(), nil
		}
	}
	return time.Time{}, fmt.Errorf("unsupported timestamp format %q", raw)
}

func normalizeWebhookSymbol(sym string) string {
	s := strings.ToUpper(strings.TrimSpace(sym))
	if idx := strings.LastIndexByte(s, '.'); idx > 0 {
		suffix := s[idx+1:]
		if len(suffix) > 0 && len(suffix) <= 4 {
			s = s[:idx]
		}
	}
	return s
}

func normalizeWebhookAction(action string) (string, bool) {
	switch strings.ToLower(strings.TrimSpace(action)) {
	case "buy":
		return "Buy", true
	case "sell":
		return "Sell", true
	default:
		return "", false
	}
}

func absDuration(d time.Duration) time.Duration {
	if d < 0 {
		return -d
	}
	return d
}

// isSameUnderlyingTrade matches provisional MT5 webhook trades against Myfxbook settled trades
// despite second-vs-minute truncation and small exit spread differences.
func isSameUnderlyingTrade(a, b models.ClosedTrade) bool {
	if normalizeWebhookSymbol(a.Symbol) != normalizeWebhookSymbol(b.Symbol) {
		return false
	}
	actA, okA := normalizeWebhookAction(a.Action)
	actB, okB := normalizeWebhookAction(b.Action)
	if !okA || !okB || actA != actB {
		return false
	}
	if a.Open.IsZero() || b.Open.IsZero() || a.Close.IsZero() || b.Close.IsZero() {
		return false
	}
	return absDuration(a.Open.Sub(b.Open)) <= webhookTimeMatchLimit &&
		absDuration(a.Close.Sub(b.Close)) <= webhookTimeMatchLimit
}

func cloneAndScaleAnalytics(src *models.TradeAnalytics, usdScale float64) *models.TradeAnalytics {
	if src == nil {
		return nil
	}
	cp := *src
	if len(src.PricePath) > 0 {
		cp.PricePath = append([]float64(nil), src.PricePath...)
	}
	scalePtr := func(p *float64) *float64 {
		if p == nil {
			return nil
		}
		v := roundDecimals(*p*usdScale, 2)
		return &v
	}
	if usdScale > 0 && usdScale != 1.0 {
		cp.MaxUSD = scalePtr(src.MaxUSD)
		cp.MinUSD = scalePtr(src.MinUSD)
		cp.ProfitMissedUSD = scalePtr(src.ProfitMissedUSD)
	} else {
		cp.MaxUSD = scalePtr(src.MaxUSD)
		cp.MinUSD = scalePtr(src.MinUSD)
		cp.ProfitMissedUSD = scalePtr(src.ProfitMissedUSD)
	}
	return &cp
}

// convertWebhookTradeToMaster normalizes an incoming webhook trade into a 1x master ClosedTrade.
// Scaled master/PAMM payloads (e.g. dada_master with ~$110M balance) are converted to 1x lots (0.1 step)
// and estimated 1x profit using masterBalance * (gain_pct / 100).
func convertWebhookTradeToMaster(in models.WebhookTradeInput, masterBalance float64) (models.ClosedTrade, error) {
	action, ok := normalizeWebhookAction(in.Action)
	if !ok {
		return models.ClosedTrade{}, fmt.Errorf("non-trade action %q", in.Action)
	}

	openTime, err := parseWebhookTimestamp(in.Open)
	if err != nil {
		return models.ClosedTrade{}, fmt.Errorf("invalid open timestamp: %w", err)
	}
	closeTime, err := parseWebhookTimestamp(in.Close)
	if err != nil {
		return models.ClosedTrade{}, fmt.Errorf("invalid close timestamp: %w", err)
	}

	symbol := normalizeWebhookSymbol(in.Symbol)
	if symbol == "" {
		return models.ClosedTrade{}, fmt.Errorf("missing symbol")
	}

	durationSec := in.DurationSeconds
	if durationSec <= 0 && closeTime.After(openTime) {
		durationSec = int(closeTime.Sub(openTime).Seconds())
	}

	gainPct := in.GainPct
	if gainPct == 0 && in.Profit != 0 && in.BalanceBefore > 0 {
		gainPct = roundDecimals((in.Profit/in.BalanceBefore)*100.0, 4)
	}

	if masterBalance <= 0 {
		masterBalance = defaultMasterBalance
	}

	needsScale := (in.BalanceBefore > 0 && in.BalanceBefore > masterBalance*2.0) || in.LeverageFactor > 1
	estLots := in.Lots
	estProfit := in.Profit
	usdScale := 1.0

	if needsScale {
		var rawLots float64
		if in.Lots > 0 && in.BalanceBefore > 0 {
			rawLots = masterBalance * (in.Lots / in.BalanceBefore)
		} else {
			rawLots = (masterBalance / 1000.0) * defaultLotsPer1k
		}
		estLots = roundDecimals(math.Max(0.1, math.Round(rawLots*10.0)/10.0), 2)

		if gainPct != 0 {
			estProfit = roundDecimals(masterBalance*(gainPct/100.0), 2)
		} else if in.Pips != 0 {
			estProfit = roundDecimals(estLots*(in.Pips-10.0), 2)
			if masterBalance > 0 {
				gainPct = roundDecimals((estProfit/masterBalance)*100.0, 4)
			}
		}

		if in.Lots > 0 {
			usdScale = estLots / in.Lots
		}
	} else {
		estLots = roundDecimals(estLots, 2)
		estProfit = roundDecimals(estProfit, 2)
	}

	return models.ClosedTrade{
		Open:            openTime,
		Close:           closeTime,
		Symbol:          symbol,
		Action:          action,
		Lots:            estLots,
		OpenPrice:       in.OpenPrice,
		ClosePrice:      in.ClosePrice,
		Pips:            in.Pips,
		Profit:          estProfit,
		DurationSeconds: durationSec,
		GainPct:         roundDecimals(gainPct, 4),
		Source:          "webhook",
		Ticket:          strings.TrimSpace(in.Ticket),
		Provisional:     true,
		Analytics:       cloneAndScaleAnalytics(in.Analytics, usdScale),
	}, nil
}

func provisionalTradeUnchanged(prev, next models.ClosedTrade) bool {
	return prev.Open.Equal(next.Open) &&
		prev.Close.Equal(next.Close) &&
		prev.Symbol == next.Symbol &&
		prev.Action == next.Action &&
		prev.Lots == next.Lots &&
		prev.OpenPrice == next.OpenPrice &&
		prev.ClosePrice == next.ClosePrice &&
		prev.Pips == next.Pips &&
		prev.GainPct == next.GainPct &&
		prev.DurationSeconds == next.DurationSeconds &&
		prev.Ticket == next.Ticket &&
		reflect.DeepEqual(prev.Analytics, next.Analytics)
}

func (m *Manager) applyGrowthAndLotsDelta(t models.ClosedTrade, sign float64) {
	if m.sonicData == nil {
		return
	}
	day := tradeDateISO(t)
	if day == "" {
		return
	}

	if m.sonicData.Lots.Days == nil {
		m.sonicData.Lots.Days = make(map[string]float64)
	}
	updatedDayLots := roundDecimals(m.sonicData.Lots.Days[day]+sign*t.Lots, 2)
	if updatedDayLots <= 0 {
		delete(m.sonicData.Lots.Days, day)
	} else {
		m.sonicData.Lots.Days[day] = updatedDayLots
	}

	n := len(m.sonicData.Growth)
	if n > 0 {
		lastIdx := n - 1
		lastDate := m.sonicData.Growth[lastIdx].Date
		if day == lastDate {
			m.sonicData.Growth[lastIdx].GainPct = roundDecimals(m.sonicData.Growth[lastIdx].GainPct+sign*t.GainPct, 2)
			m.sonicData.General.GainPct = m.sonicData.Growth[lastIdx].GainPct
		} else if day > lastDate && sign > 0 {
			nextGain := roundDecimals(m.sonicData.Growth[lastIdx].GainPct+t.GainPct, 2)
			m.sonicData.Growth = append(m.sonicData.Growth, models.GrowthPoint{
				Date:    day,
				GainPct: nextGain,
			})
			m.sonicData.GrowthCount = len(m.sonicData.Growth)
			m.sonicData.General.GainPct = nextGain
		}
	} else if sign > 0 {
		m.sonicData.Growth = append(m.sonicData.Growth, models.GrowthPoint{
			Date:    day,
			GainPct: roundDecimals(t.GainPct, 2),
		})
		m.sonicData.GrowthCount = len(m.sonicData.Growth)
		m.sonicData.General.GainPct = roundDecimals(t.GainPct, 2)
	}
}

func (m *Manager) saveCacheLocked() error {
	if m.sonicData == nil {
		return fmt.Errorf("cannot save nil cache")
	}
	if err := os.MkdirAll(filepath.Dir(m.cacheFile), 0755); err != nil {
		return fmt.Errorf("create cache dir: %w", err)
	}
	encoded, err := json.MarshalIndent(m.sonicData, "", "  ")
	if err != nil {
		return fmt.Errorf("marshal cache json: %w", err)
	}
	tmpPath := m.cacheFile + ".tmp"
	if err := os.WriteFile(tmpPath, encoded, 0644); err != nil {
		return fmt.Errorf("write temp cache: %w", err)
	}
	if err := os.Rename(tmpPath, m.cacheFile); err != nil {
		_ = os.Remove(tmpPath)
		return fmt.Errorf("rename cache file: %w", err)
	}
	if info, err := os.Stat(m.cacheFile); err == nil {
		m.lastDiskMod = info.ModTime()
	}
	return nil
}

// IngestWebhookTrades adds or updates provisional webhook trades while deduplicating against
// already-settled Myfxbook trades, leaving FetchedUTC intact so scheduled Myfxbook scrapes still run.
func (m *Manager) IngestWebhookTrades(inputs []models.WebhookTradeInput) (*models.WebhookTradesResponse, error) {
	if len(inputs) == 0 {
		return nil, fmt.Errorf("at least one trade is required")
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	// Sync from disk first if another process (e.g. crawler) wrote a newer cache file.
	if info, err := os.Stat(m.cacheFile); err == nil {
		if m.sonicData == nil || info.ModTime().After(m.lastDiskMod) {
			raw, readErr := os.ReadFile(m.cacheFile)
			if readErr == nil {
				var diskData models.SonicData
				if unmarshalErr := json.Unmarshal(raw, &diskData); unmarshalErr == nil {
					m.sonicData = &diskData
					m.lastDiskMod = info.ModTime()
				}
			}
		}
	}

	if m.sonicData == nil {
		m.sonicData = &models.SonicData{
			SchemaVersion: 3,
			AccountName:   "SONIC AI",
			Source:        "webhook",
			General: models.GeneralMetrics{
				Balance: defaultMasterBalance,
				Equity:  defaultMasterBalance,
			},
			Lots: models.LotHistory{
				Days: make(map[string]float64),
			},
			Trades: []models.ClosedTrade{},
		}
	}

	// Process incoming batch chronologically so running balance and growth step cleanly.
	ordered := append([]models.WebhookTradeInput(nil), inputs...)
	sort.SliceStable(ordered, func(i, j int) bool {
		ti, ei := parseWebhookTimestamp(ordered[i].Close)
		tj, ej := parseWebhookTimestamp(ordered[j].Close)
		if ei != nil || ej != nil {
			return ordered[i].Open < ordered[j].Open
		}
		if !ti.Equal(tj) {
			return ti.Before(tj)
		}
		oi, _ := parseWebhookTimestamp(ordered[i].Open)
		oj, _ := parseWebhookTimestamp(ordered[j].Open)
		return oi.Before(oj)
	})

	resp := &models.WebhookTradesResponse{
		Status: "ok",
	}

	modified := false
	now := time.Now().UTC()

	for _, in := range ordered {
		if _, ok := normalizeWebhookAction(in.Action); !ok {
			resp.Ignored++
			continue
		}

		// Parse basic timestamps to check settled Myfxbook dedupe before estimation.
		provisionalCandidate, err := convertWebhookTradeToMaster(in, m.sonicData.General.Balance)
		if err != nil {
			resp.Ignored++
			continue
		}

		matchedSettled := false
		matchedProvIdx := -1

		for idx, existing := range m.sonicData.Trades {
			if !existing.Provisional && existing.Source != "webhook" {
				if isSameUnderlyingTrade(existing, provisionalCandidate) {
					matchedSettled = true
					break
				}
				continue
			}

			if provisionalCandidate.Ticket != "" && existing.Ticket == provisionalCandidate.Ticket {
				matchedProvIdx = idx
				break
			}
			if isSameUnderlyingTrade(existing, provisionalCandidate) {
				matchedProvIdx = idx
				break
			}
		}

		if matchedSettled {
			resp.SkippedExisting++
			continue
		}

		if matchedProvIdx >= 0 {
			prev := m.sonicData.Trades[matchedProvIdx]
			// Roll back prior provisional contribution so re-estimate uses baseline balance.
			baseBal := m.sonicData.General.Balance - prev.Profit
			updatedTrade, convErr := convertWebhookTradeToMaster(in, baseBal)
			if convErr != nil {
				resp.Ignored++
				continue
			}
			if provisionalTradeUnchanged(prev, updatedTrade) {
				resp.SkippedExisting++
				continue
			}
			m.sonicData.General.Balance = roundDecimals(baseBal+updatedTrade.Profit, 2)
			m.sonicData.General.Equity = m.sonicData.General.Balance
			m.sonicData.General.Profit = roundDecimals(m.sonicData.General.Profit-prev.Profit+updatedTrade.Profit, 2)
			m.applyGrowthAndLotsDelta(prev, -1)
			m.applyGrowthAndLotsDelta(updatedTrade, +1)
			m.sonicData.Trades[matchedProvIdx] = updatedTrade
			resp.Updated++
			modified = true
		} else {
			m.sonicData.General.Balance = roundDecimals(m.sonicData.General.Balance+provisionalCandidate.Profit, 2)
			m.sonicData.General.Equity = m.sonicData.General.Balance
			m.sonicData.General.Profit = roundDecimals(m.sonicData.General.Profit+provisionalCandidate.Profit, 2)
			if m.sonicData.General.Balance > m.sonicData.General.Highest {
				m.sonicData.General.Highest = m.sonicData.General.Balance
				m.sonicData.General.HighestDate = tradeDateISO(provisionalCandidate)
			}
			m.applyGrowthAndLotsDelta(provisionalCandidate, +1)
			m.sonicData.Trades = append(m.sonicData.Trades, provisionalCandidate)
			resp.Inserted++
			modified = true
		}
	}

	if modified {
		sort.SliceStable(m.sonicData.Trades, func(i, j int) bool {
			ti, oki := tradeTimestamp(m.sonicData.Trades[i])
			tj, okj := tradeTimestamp(m.sonicData.Trades[j])
			if oki && okj && !ti.Equal(tj) {
				return ti.After(tj)
			}
			return m.sonicData.Trades[i].Open.After(m.sonicData.Trades[j].Open)
		})
		m.sonicData.TradesCount = len(m.sonicData.Trades)
		m.sonicData.General.Trades = m.sonicData.TradesCount
		m.sonicData.General.UpdatedAt = now
		m.sonicData.LastWebhookUTC = now
		if err := m.saveCacheLocked(); err != nil {
			return nil, err
		}
	}

	provCount := 0
	for _, t := range m.sonicData.Trades {
		if t.Provisional || t.Source == "webhook" {
			provCount++
		}
	}

	resp.TotalTrades = len(m.sonicData.Trades)
	resp.ProvisionalTrades = provCount
	resp.Balance = m.sonicData.General.Balance
	resp.GainPct = m.sonicData.General.GainPct
	resp.LastWebhookUTC = m.sonicData.LastWebhookUTC
	return resp, nil
}
