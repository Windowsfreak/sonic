package cache

import (
	"context"
	"encoding/json"
	"math"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"

	"github.com/windowsfreak/sonic/internal/models"
)

func writeTempCacheFile(t *testing.T, dir string, data *models.SonicData) string {
	t.Helper()
	p := filepath.Join(dir, "sonic_cache.json")
	b, err := json.MarshalIndent(data, "", "  ")
	if err != nil {
		t.Fatalf("marshal temp cache: %v", err)
	}
	if err := os.WriteFile(p, b, 0644); err != nil {
		t.Fatalf("write temp cache: %v", err)
	}
	return p
}

func baseTestData(fetchedUTC, lastFullUTC time.Time) *models.SonicData {
	return &models.SonicData{
		SchemaVersion:    3,
		AccountName:      "TestSonic",
		AccountID:        "12345",
		FetchedUTC:       fetchedUTC,
		LastFullCrawlUTC: lastFullUTC,
		LastCrawlMode:    "full",
		General: models.GeneralMetrics{
			Balance: 100000.0,
			GainPct: 10.0,
			Profit:  10000.0,
		},
		Trades: []models.ClosedTrade{
			{
				Open:            time.Date(2026, 10, 14, 8, 0, 0, 0, time.UTC),
				Close:           time.Date(2026, 10, 14, 9, 0, 0, 0, time.UTC),
				Symbol:          "EURUSD",
				Action:          "Buy",
				Lots:            1.0,
				Profit:          1000.0,
				DurationSeconds: 3600,
				GainPct:         1.0,
			},
		},
		TradesCount: 1,
	}
}

func TestTriggerUpdateCooldownAndTieredMode(t *testing.T) {
	now := time.Now().UTC()
	dir := t.TempDir()

	// Case 1: Cache < 1h old -> force=true must be ignored and cached data kept
	writeTempCacheFile(t, dir, baseTestData(now.Add(-35*time.Minute), now.Add(-35*time.Minute)))
	mgr, err := NewManager(dir, "", 240*time.Minute)
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	defer mgr.Close()

	var mu sync.Mutex
	var calledModes []string
	mgr.crawlerFn = func(ctx context.Context, mode string) error {
		mu.Lock()
		calledModes = append(calledModes, mode)
		mu.Unlock()
		return nil
	}

	started, err := mgr.TriggerUpdate(true)
	if err != nil {
		t.Fatalf("TriggerUpdate(true) unexpected err: %v", err)
	}
	if started {
		t.Fatalf("expected forced update to be ignored when cache is 35m old (<1h)")
	}
	time.Sleep(30 * time.Millisecond)
	mu.Lock()
	if len(calledModes) != 0 {
		t.Fatalf("expected 0 crawler calls during 1h cooldown, got %v", calledModes)
	}
	mu.Unlock()

	// Case 2: Cache 90m old (>=1h, <4h expiry), lastFull 2h ago (<6h):
	// non-forced -> rejected; forced -> starts "partial"
	writeTempCacheFile(t, dir, baseTestData(now.Add(-90*time.Minute), now.Add(-2*time.Hour)))
	if err := mgr.loadFromDisk(); err != nil {
		t.Fatalf("reload cache: %v", err)
	}
	if started, _ := mgr.TriggerUpdate(false); started {
		t.Fatalf("expected non-forced update to skip before 4h expiry")
	}

	done := make(chan string, 1)
	mgr.crawlerFn = func(ctx context.Context, mode string) error {
		done <- mode
		return nil
	}
	started, err = mgr.TriggerUpdate(true)
	if err != nil || !started {
		t.Fatalf("expected forced update at 90m to start, started=%v err=%v", started, err)
	}
	if mode := <-done; mode != "partial" {
		t.Fatalf("expected forced update with lastFull 2h ago to pick 'partial', got %q", mode)
	}

	// Wait for isCrawling flag to clear
	mgr.mu.Lock()
	for mgr.isCrawling {
		mgr.crawlCond.Wait()
	}
	mgr.mu.Unlock()

	// Case 3: Cache 90m old, lastFull 7h ago (>=6h): forced -> picks "full"
	writeTempCacheFile(t, dir, baseTestData(now.Add(-90*time.Minute), now.Add(-7*time.Hour)))
	if err := mgr.loadFromDisk(); err != nil {
		t.Fatalf("reload cache: %v", err)
	}
	started, err = mgr.TriggerUpdate(true)
	if err != nil || !started {
		t.Fatalf("expected forced update with 7h full age to start, started=%v err=%v", started, err)
	}
	if mode := <-done; mode != "full" {
		t.Fatalf("expected forced update with lastFull 7h ago to pick 'full', got %q", mode)
	}
	mgr.mu.Lock()
	for mgr.isCrawling {
		mgr.crawlCond.Wait()
	}
	mgr.mu.Unlock()

	// Case 4: Cache 245m old (stale >4h), lastFull 25h ago (>=24h): non-forced -> picks "full"
	writeTempCacheFile(t, dir, baseTestData(now.Add(-245*time.Minute), now.Add(-25*time.Hour)))
	if err := mgr.loadFromDisk(); err != nil {
		t.Fatalf("reload cache: %v", err)
	}
	started, err = mgr.TriggerUpdate(false)
	if err != nil || !started {
		t.Fatalf("expected stale update to start, started=%v err=%v", started, err)
	}
	if mode := <-done; mode != "full" {
		t.Fatalf("expected stale update with lastFull 25h ago to pick 'full', got %q", mode)
	}
}

func TestBuildCalendar(t *testing.T) {
	data := &models.SonicData{
		General: models.GeneralMetrics{
			Balance: 100000.0,
		},
		Trades: []models.ClosedTrade{
			// 2026-10-15: 2 wins (+1.0% compounded -> +0.1%, +0.1% ~= +0.2001%), total +$200.00
			{Close: time.Date(2026, 10, 15, 14, 30, 0, 0, time.UTC), Symbol: "EURUSD", Action: "Buy", Profit: 100.0, GainPct: 0.10},
			{Close: time.Date(2026, 10, 15, 10, 15, 0, 0, time.UTC), Symbol: "USDCHF", Action: "Sell", Profit: 100.0, GainPct: 0.10},
			// 2026-10-14: 1 loss with gain 0.00% -> fallback profit/balance = -500 / 100000 = -0.5%
			{Close: time.Date(2026, 10, 14, 11, 0, 0, 0, time.UTC), Symbol: "EURUSD", Action: "Buy", Profit: -500.0, GainPct: 0.00},
		},
	}

	anchor := time.Date(2026, 10, 15, 0, 0, 0, 0, time.UTC)
	cal := BuildCalendar(data, anchor, 7, false)

	if len(cal.Days) != 7 {
		t.Fatalf("expected 7 days, got %d", len(cal.Days))
	}
	if cal.StartDate != "2026-10-09" || cal.EndDate != "2026-10-15" {
		t.Fatalf("unexpected window %s..%s", cal.StartDate, cal.EndDate)
	}

	day14 := cal.Days[5] // 2026-10-14
	if day14.Date != "2026-10-14" || day14.TradesCount != 1 || day14.Losses != 1 || day14.Wins != 0 {
		t.Fatalf("unexpected day14: %+v", day14)
	}
	if math.Abs(day14.DeltaAccountValue-(-500.0)) > 1e-6 {
		t.Fatalf("day14 delta expected -500, got %v", day14.DeltaAccountValue)
	}
	// Losses bear full 100% (no 30% fee rebate)
	if math.Abs(day14.Growth12xPct-(-6.0)) > 1e-4 || math.Abs(day14.Growth24xPct-(-12.0)) > 1e-4 {
		t.Fatalf("day14 loss growth unexpected: 12x=%v 24x=%v", day14.Growth12xPct, day14.Growth24xPct)
	}

	day15 := cal.Days[6] // 2026-10-15
	if day15.Date != "2026-10-15" || day15.TradesCount != 2 || day15.Wins != 2 || day15.Losses != 0 || len(day15.Trades) != 2 {
		t.Fatalf("unexpected day15: %+v", day15)
	}
	expected1x := ((1.001 * 1.001) - 1.0) * 100.0
	expected12xNet := expected1x * 12.0 * 0.70
	expected24xNet := expected1x * 24.0 * 0.70
	if math.Abs(day15.Growth12xPct-expected12xNet) > 1e-3 {
		t.Fatalf("day15 12x net expected %.4f, got %.4f", expected12xNet, day15.Growth12xPct)
	}
	if math.Abs(day15.Growth24xPct-expected24xNet) > 1e-3 {
		t.Fatalf("day15 24x net expected %.4f, got %.4f", expected24xNet, day15.Growth24xPct)
	}
}

func TestComputeStreaksSynthetic(t *testing.T) {
	// Stored newest-first (as scraped by crawl_myfxbook.js)
	// Chronological order: W, W, L, L, L, W, L, W, W
	// Win runs: len 2 (x2), len 1 (x1); current = 2 wins
	// Loss runs: len 3 (x1), len 1 (x1); current = 0 losses
	data := &models.SonicData{
		Trades: []models.ClosedTrade{
			{Close: time.Date(2026, 10, 9, 10, 0, 0, 0, time.UTC), Profit: 10.0},  // W (newest)
			{Close: time.Date(2026, 10, 8, 10, 0, 0, 0, time.UTC), Profit: 10.0},  // W
			{Close: time.Date(2026, 10, 7, 10, 0, 0, 0, time.UTC), Profit: -10.0}, // L
			{Close: time.Date(2026, 10, 6, 10, 0, 0, 0, time.UTC), Profit: 10.0},  // W
			{Close: time.Date(2026, 10, 5, 10, 0, 0, 0, time.UTC), Profit: -10.0}, // L
			{Close: time.Date(2026, 10, 4, 10, 0, 0, 0, time.UTC), Profit: -10.0}, // L
			{Close: time.Date(2026, 10, 3, 10, 0, 0, 0, time.UTC), Profit: -10.0}, // L
			{Close: time.Date(2026, 10, 2, 10, 0, 0, 0, time.UTC), Profit: 10.0},  // W
			{Close: time.Date(2026, 10, 1, 10, 0, 0, 0, time.UTC), Profit: 10.0},  // W (oldest)
		},
	}

	st := ComputeStreaks(data)
	if st.TotalTrades != 9 {
		t.Fatalf("expected 9 trades, got %d", st.TotalTrades)
	}
	if st.CurrentWinningStreak != 2 || st.CurrentLosingStreak != 0 {
		t.Fatalf("expected cur win=2 loss=0, got win=%d loss=%d", st.CurrentWinningStreak, st.CurrentLosingStreak)
	}
	if st.LongestWinningStreak != 2 || st.LongestLosingStreak != 3 {
		t.Fatalf("expected longest win=2 loss=3, got win=%d loss=%d", st.LongestWinningStreak, st.LongestLosingStreak)
	}
	if len(st.WinningDistribution) != 2 || st.WinningDistribution[0] != 1 || st.WinningDistribution[1] != 2 {
		t.Fatalf("unexpected win dist: %v", st.WinningDistribution)
	}
	if len(st.LosingDistribution) != 3 || st.LosingDistribution[0] != 1 || st.LosingDistribution[1] != 0 || st.LosingDistribution[2] != 1 {
		t.Fatalf("unexpected loss dist: %v", st.LosingDistribution)
	}
}

func TestComputeStreaksFromRealSnapshot(t *testing.T) {
	realPath := filepath.Join("..", "..", "data", "sonic_cache.json")
	b, err := os.ReadFile(realPath)
	if err != nil {
		t.Skipf("real snapshot not found (%v), skipping", err)
	}
	var data models.SonicData
	if err := json.Unmarshal(b, &data); err != nil {
		t.Fatalf("unmarshal real snapshot: %v", err)
	}

	st := ComputeStreaks(&data)
	if st.TotalTrades == 0 {
		t.Fatalf("expected evaluated trades > 0")
	}
	if st.CurrentWinningStreak != 0 && st.CurrentLosingStreak != 0 {
		t.Fatalf("one current streak must always be 0, got win=%d loss=%d", st.CurrentWinningStreak, st.CurrentLosingStreak)
	}
	if len(st.WinningDistribution) != st.LongestWinningStreak {
		t.Fatalf("win dist len %d != longest %d", len(st.WinningDistribution), st.LongestWinningStreak)
	}
	if len(st.LosingDistribution) != st.LongestLosingStreak {
		t.Fatalf("loss dist len %d != longest %d", len(st.LosingDistribution), st.LongestLosingStreak)
	}

	sumTrades := 0
	for i, c := range st.WinningDistribution {
		sumTrades += (i + 1) * c
	}
	for i, c := range st.LosingDistribution {
		sumTrades += (i + 1) * c
	}
	if sumTrades != st.TotalTrades {
		t.Fatalf("weighted distribution sum %d != TotalTrades %d", sumTrades, st.TotalTrades)
	}
}

func TestBuildCrawlerEnvPrecedence(t *testing.T) {
	dir := t.TempDir()
	envPath := filepath.Join(dir, ".env")
	content := "# comment\nBROWSERLESS_TOKEN=\"from_dotenv\"\nZENROWS_API_KEY='zr_from_dotenv'\nexport CRAWLER_PROVIDERS=browserless,zenrows\n"
	if err := os.WriteFile(envPath, []byte(content), 0600); err != nil {
		t.Fatalf("write .env: %v", err)
	}

	base := []string{"BROWSERLESS_TOKEN=from_os_env", "PATH=/usr/bin"}
	merged := buildCrawlerEnv(base, []string{envPath, filepath.Join(dir, "missing.env")})

	got := make(map[string]string)
	for _, entry := range merged {
		for i := 0; i < len(entry); i++ {
			if entry[i] == '=' {
				got[entry[:i]] = entry[i+1:]
				break
			}
		}
	}

	if got["BROWSERLESS_TOKEN"] != "from_os_env" {
		t.Fatalf("expected OS env to take precedence, got %q", got["BROWSERLESS_TOKEN"])
	}
	if got["ZENROWS_API_KEY"] != "zr_from_dotenv" {
		t.Fatalf("expected ZENROWS_API_KEY from .env, got %q", got["ZENROWS_API_KEY"])
	}
	if got["CRAWLER_PROVIDERS"] != "browserless,zenrows" {
		t.Fatalf("expected CRAWLER_PROVIDERS from .env, got %q", got["CRAWLER_PROVIDERS"])
	}
}

