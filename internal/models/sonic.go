package models

import "time"

// GeneralMetrics holds high-level account statistics as raw numbers and ISO timestamps.
type GeneralMetrics struct {
	GainPct      float64   `json:"gain_pct"`
	AbsGainPct   float64   `json:"abs_gain_pct"`
	DailyPct     float64   `json:"daily_pct"`
	MonthlyPct   float64   `json:"monthly_pct"`
	DrawdownPct  float64   `json:"drawdown_pct"`
	Balance      float64   `json:"balance"`
	Equity       float64   `json:"equity"`
	EquityPct    float64   `json:"equity_pct"`
	Highest      float64   `json:"highest"`
	HighestDate  string    `json:"highest_date,omitempty"`
	Profit       float64   `json:"profit"`
	Interest     float64   `json:"interest"`
	Deposits     float64   `json:"deposits"`
	Withdrawals  float64   `json:"withdrawals"`
	Trades       int       `json:"trades"`
	ProfitFactor float64   `json:"profit_factor"`
	UpdatedAt    time.Time `json:"updated_at"`
}

// PeriodMetric represents numeric metrics for a specific time frame.
type PeriodMetric struct {
	GainPct    float64 `json:"gain_pct"`
	Profit     float64 `json:"profit"`
	Pips       float64 `json:"pips"`
	WinRatePct float64 `json:"win_rate_pct"`
	Trades     int     `json:"trades"`
	Lots       float64 `json:"lots"`
}

// PeriodsMap maps standard periods.
type PeriodsMap struct {
	Today PeriodMetric `json:"today"`
	Week  PeriodMetric `json:"week"`
	Month PeriodMetric `json:"month"`
	Year  PeriodMetric `json:"year"`
}

// TradeAnalytics represents intra-trade excursion and accuracy metrics from Myfxbook sparklines.
type TradeAnalytics struct {
	EntryAccuracy          *float64  `json:"entry_accuracy,omitempty"`
	ExitAccuracy           *float64  `json:"exit_accuracy,omitempty"`
	DrawdownPips           *float64  `json:"drawdown_pips,omitempty"`
	RiskReward             string    `json:"risk_reward,omitempty"`
	MaxPips                *float64  `json:"max_pips,omitempty"`
	MaxUSD                 *float64  `json:"max_usd,omitempty"`
	MinPips                *float64  `json:"min_pips,omitempty"`
	MinUSD                 *float64  `json:"min_usd,omitempty"`
	ProfitMissedPips       *float64  `json:"profit_missed_pips,omitempty"`
	ProfitMissedUSD        *float64  `json:"profit_missed_usd,omitempty"`
	TimeProfitablePct      *float64  `json:"time_profitable_pct,omitempty"`
	TimeProfitableDuration string    `json:"time_profitable_duration,omitempty"`
	PricePath              []float64 `json:"price_path,omitempty"`
}

// ClosedTrade represents a single closed trade with ISO-8601 timestamps and raw numeric metrics.
type ClosedTrade struct {
	Open            time.Time       `json:"open"`
	Close           time.Time       `json:"close"`
	Symbol          string          `json:"symbol"`
	Action          string          `json:"action"`
	Lots            float64         `json:"lots"`
	OpenPrice       float64         `json:"open_price"`
	ClosePrice      float64         `json:"close_price"`
	Pips            float64         `json:"pips"`
	Profit          float64         `json:"profit"`
	DurationSeconds int             `json:"duration_seconds"`
	GainPct         float64         `json:"gain_pct"`
	Analytics       *TradeAnalytics `json:"analytics,omitempty"`
}

// GrowthPoint represents a single cumulative growth observation for an ISO date (YYYY-MM-DD).
type GrowthPoint struct {
	Date    string  `json:"date"`
	GainPct float64 `json:"gain_pct"`
}

// MonthlyGain represents historical monthly gain for an ISO month (YYYY-MM).
type MonthlyGain struct {
	Month string  `json:"month"`
	Gain  float64 `json:"gain"`
}

// LotHistory represents daily lot sums keyed by ISO date (YYYY-MM-DD).
type LotHistory struct {
	Days map[string]float64 `json:"days"`
}

// SonicData is the root cache data structure.
type SonicData struct {
	SchemaVersion    int            `json:"schema_version"`
	AccountName      string         `json:"account_name"`
	AccountID        string         `json:"account_id"`
	Source           string         `json:"source"`
	FetchedUTC       time.Time      `json:"fetched_utc"`
	LastFullCrawlUTC time.Time      `json:"last_full_crawl_utc,omitempty"`
	LastCrawlMode    string         `json:"last_crawl_mode,omitempty"`
	General          GeneralMetrics `json:"general"`
	Periods          PeriodsMap     `json:"periods"`
	Growth           []GrowthPoint  `json:"growth"`
	MonthlyGain      []MonthlyGain  `json:"monthly_gain"`
	Lots             LotHistory     `json:"lots"`
	Trades           []ClosedTrade  `json:"trades"`
	TradesCount      int            `json:"trades_count"`
	GrowthCount      int            `json:"growth_count"`
}

// CalendarDay holds aggregated trading metrics and trades for a single calendar date.
type CalendarDay struct {
	Date              string        `json:"date"`
	DeltaAccountValue float64       `json:"delta_account_value"`
	TradesCount       int           `json:"trades_count"`
	Wins              int           `json:"wins"`
	Losses            int           `json:"losses"`
	Growth1xPct       float64       `json:"growth_1x_pct"`
	Growth12xPct      float64       `json:"growth_12x_pct"`
	Growth24xPct      float64       `json:"growth_24x_pct"`
	Trades            []ClosedTrade `json:"trades"`
}

// CalendarSummary aggregates metrics across all days in a calendar query range.
type CalendarSummary struct {
	DeltaAccountValue float64 `json:"delta_account_value"`
	TradesCount       int     `json:"trades_count"`
	Wins              int     `json:"wins"`
	Losses            int     `json:"losses"`
	Growth1xPct       float64 `json:"growth_1x_pct"`
	Growth12xPct      float64 `json:"growth_12x_pct"`
	Growth24xPct      float64 `json:"growth_24x_pct"`
}

// CalendarResponse is the payload returned by GET /api/sonic/calendar.
type CalendarResponse struct {
	Date               string          `json:"date"`
	StartDate          string          `json:"start_date"`
	EndDate            string          `json:"end_date"`
	DaysRequested      int             `json:"days_requested"`
	PerformanceFeeRate float64         `json:"performance_fee_rate"`
	Summary            CalendarSummary `json:"summary"`
	Days               []CalendarDay   `json:"days"`
}

// StreaksResponse is the payload returned by GET /api/sonic/streaks.
type StreaksResponse struct {
	TotalTrades          int   `json:"total_trades"`
	CurrentWinningStreak int   `json:"current_winning_streak"`
	CurrentLosingStreak  int   `json:"current_losing_streak"`
	LongestWinningStreak int   `json:"longest_winning_streak"`
	LongestLosingStreak  int   `json:"longest_losing_streak"`
	WinningDistribution  []int `json:"winning_distribution"`
	LosingDistribution   []int `json:"losing_distribution"`
}

// ZoomItem represents a community call or recording.
type ZoomItem struct {
	Title       string `json:"title"`
	Date        string `json:"date,omitempty"`
	Time        string `json:"time,omitempty"`
	Language    string `json:"language,omitempty"`
	Description string `json:"description,omitempty"`
	URL         string `json:"url"`
	Recording   bool   `json:"recording,omitempty"`
}

// RecurringZoomCall describes the recurring weekly Zoom schedule in snake_case.
type RecurringZoomCall struct {
	Title           string   `json:"title"`
	Speakers        []string `json:"speakers"`
	Weekday         int      `json:"weekday"`
	Time            string   `json:"time"`
	TimeZone        string   `json:"time_zone"`
	URL             string   `json:"url"`
	MeetingID       string   `json:"meeting_id"`
	Image           string   `json:"image,omitempty"`
	TelegramTarget  string   `json:"telegram_target,omitempty"`
	SkippedDates    []string `json:"skipped_dates"`
	TelegramTargets []string `json:"telegram_targets,omitempty"`
	Paused          bool     `json:"paused,omitempty"`
}

// ZoomData holds calls, recordings, and recurring call configuration.
type ZoomData struct {
	Calls         []ZoomItem         `json:"calls"`
	Recordings    []ZoomItem         `json:"recordings"`
	RecurringCall *RecurringZoomCall `json:"recurring_call,omitempty"`
}
