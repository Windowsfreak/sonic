package api

import (
	"encoding/json"
	"math"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/windowsfreak/sonic/internal/cache"
	"github.com/windowsfreak/sonic/internal/models"
)

func newTestServer(t *testing.T, fetchedUTC time.Time) (*Server, string) {
	t.Helper()
	dir := t.TempDir()
	cachePath := filepath.Join(dir, "sonic_cache.json")
	data := &models.SonicData{
		SchemaVersion:    3,
		AccountName:      "SonicTest",
		AccountID:        "99999",
		FetchedUTC:       fetchedUTC,
		LastFullCrawlUTC: fetchedUTC,
		LastCrawlMode:    "full",
		General: models.GeneralMetrics{
			Balance: 10000.0,
			GainPct: 25.0,
			Profit:  2500.0,
		},
		Trades: []models.ClosedTrade{
			{Close: time.Date(2026, 10, 16, 14, 0, 0, 0, time.UTC), Open: time.Date(2026, 10, 16, 12, 0, 0, 0, time.UTC), Symbol: "EURUSD", Action: "Buy", Lots: 0.50, Profit: 12.34, DurationSeconds: 7200, GainPct: 0.10},
			{Close: time.Date(2026, 10, 15, 11, 0, 0, 0, time.UTC), Open: time.Date(2026, 10, 15, 10, 0, 0, 0, time.UTC), Symbol: "GBPUSD", Action: "Sell", Lots: 0.50, Profit: -50.00, DurationSeconds: 3600, GainPct: -0.50},
			{Close: time.Date(2026, 10, 15, 9, 0, 0, 0, time.UTC), Open: time.Date(2026, 10, 15, 8, 0, 0, 0, time.UTC), Symbol: "EURUSD", Action: "Buy", Lots: 0.50, Profit: 80.00, DurationSeconds: 3600, GainPct: 0.80},
			{Close: time.Date(2026, 10, 14, 10, 0, 0, 0, time.UTC), Open: time.Date(2026, 10, 14, 9, 0, 0, 0, time.UTC), Symbol: "EURUSD", Action: "Buy", Lots: 0.50, Profit: 30.00, DurationSeconds: 3600, GainPct: 0.30},
		},
		TradesCount: 4,
	}
	b, err := json.Marshal(data)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	if err := os.WriteFile(cachePath, b, 0644); err != nil {
		t.Fatalf("write cache: %v", err)
	}

	mgr, err := cache.NewManager(dir, "", 240*time.Minute)
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	t.Cleanup(mgr.Close)

	return NewServer(mgr, t.TempDir()), cachePath
}

func TestUpdateForceCooldownReturnsCachedData(t *testing.T) {
	srv, _ := newTestServer(t, time.Now().UTC().Add(-10*time.Minute))
	router := srv.Router()

	endpoint := "/api/sonic/update?force=true"
	req := httptest.NewRequest(http.MethodPost, endpoint, nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("%s status = %d, want 200", endpoint, rec.Code)
	}

	var body struct {
		Status            string `json:"status"`
		Started           bool   `json:"started"`
		CooldownActive    bool   `json:"cooldown_active"`
		CooldownRemaining int    `json:"cooldown_remaining_seconds"`
		ForceIgnored      bool   `json:"force_ignored"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("%s unmarshal: %v", endpoint, err)
	}
	if body.Status != "cooldown" {
		t.Fatalf("%s: expected status=cooldown, got %q", endpoint, body.Status)
	}
	if body.Started {
		t.Fatalf("%s: expected started=false inside 1h cooldown", endpoint)
	}
	if !body.CooldownActive || !body.ForceIgnored {
		t.Fatalf("%s: expected cooldown_active=true force_ignored=true, got %+v", endpoint, body)
	}
	if body.CooldownRemaining <= 0 {
		t.Fatalf("%s: expected cooldown_remaining_seconds > 0, got %d", endpoint, body.CooldownRemaining)
	}
}

func TestCalendarEndpoint(t *testing.T) {
	srv, _ := newTestServer(t, time.Now().UTC())
	router := srv.Router()

	// 1. Default days=7 ending at anchor date=2026-10-16
	req := httptest.NewRequest(http.MethodGet, "/api/sonic/calendar?date=2026-10-16", nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("calendar status = %d, want 200", rec.Code)
	}

	var resp models.CalendarResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal calendar: %v", err)
	}
	if resp.DaysRequested != 7 || len(resp.Days) != 7 {
		t.Fatalf("expected 7 days, got DaysRequested=%d len=%d", resp.DaysRequested, len(resp.Days))
	}
	if math.Abs(resp.PerformanceFeeRate-0.30) > 1e-6 {
		t.Fatalf("expected 0.30 fee rate, got %v", resp.PerformanceFeeRate)
	}
	day16 := resp.Days[6]
	if day16.Date != "2026-10-16" || day16.TradesCount != 1 || day16.Wins != 1 || day16.Losses != 0 {
		t.Fatalf("unexpected day16: %+v", day16)
	}
	if math.Abs(day16.DeltaAccountValue-12.34) > 1e-6 {
		t.Fatalf("expected delta 12.34, got %v", day16.DeltaAccountValue)
	}
	// Gain 0.10% -> 12x net = 0.10 * 12 * 0.7 = 0.84%, 24x net = 1.68%
	if math.Abs(day16.Growth12xPct-0.84) > 1e-3 || math.Abs(day16.Growth24xPct-1.68) > 1e-3 {
		t.Fatalf("unexpected 12x/24x growth on day16: 12x=%v 24x=%v", day16.Growth12xPct, day16.Growth24xPct)
	}
	if len(day16.Trades) != 1 || day16.Trades[0].Symbol != "EURUSD" {
		t.Fatalf("expected 1 EURUSD trade in day16 slice, got %+v", day16.Trades)
	}

	// 2. /api/sonic/calendar?month=2026-10 returns full October (31 days)
	reqMonth := httptest.NewRequest(http.MethodGet, "/api/sonic/calendar?month=2026-10", nil)
	recMonth := httptest.NewRecorder()
	router.ServeHTTP(recMonth, reqMonth)
	if recMonth.Code != http.StatusOK {
		t.Fatalf("calendar month status = %d, want 200", recMonth.Code)
	}
	var monthResp models.CalendarResponse
	if err := json.Unmarshal(recMonth.Body.Bytes(), &monthResp); err != nil {
		t.Fatalf("unmarshal month: %v", err)
	}
	if monthResp.StartDate != "2026-10-01" || monthResp.EndDate != "2026-10-31" || len(monthResp.Days) != 31 {
		t.Fatalf("expected full Oct 2026 (31 days), got %s..%s len=%d", monthResp.StartDate, monthResp.EndDate, len(monthResp.Days))
	}
	if monthResp.Summary.TradesCount != 4 || monthResp.Summary.Wins != 3 || monthResp.Summary.Losses != 1 {
		t.Fatalf("unexpected month summary: %+v", monthResp.Summary)
	}
}

func TestStreaksEndpoint(t *testing.T) {
	srv, _ := newTestServer(t, time.Now().UTC())
	router := srv.Router()

	endpoint := "/api/sonic/streaks"
	req := httptest.NewRequest(http.MethodGet, endpoint, nil)
	rec := httptest.NewRecorder()
	router.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("%s status = %d, want 200", endpoint, rec.Code)
	}
	var resp models.StreaksResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("%s unmarshal: %v", endpoint, err)
	}
	// Chronological trades: 10.14 Win, 10.15 09:00 Win, 10.15 11:00 Loss, 10.16 Win
	// Runs: W(2), L(1), W(1) -> curWin=1, curLoss=0, maxWin=2, maxLoss=1
	if resp.TotalTrades != 4 {
		t.Fatalf("%s TotalTrades=%d, want 4", endpoint, resp.TotalTrades)
	}
	if resp.CurrentWinningStreak != 1 || resp.CurrentLosingStreak != 0 {
		t.Fatalf("%s cur streaks win=%d loss=%d, want 1/0", endpoint, resp.CurrentWinningStreak, resp.CurrentLosingStreak)
	}
	if resp.LongestWinningStreak != 2 || resp.LongestLosingStreak != 1 {
		t.Fatalf("%s longest win=%d loss=%d, want 2/1", endpoint, resp.LongestWinningStreak, resp.LongestLosingStreak)
	}
	if len(resp.WinningDistribution) != 2 || resp.WinningDistribution[0] != 1 || resp.WinningDistribution[1] != 1 {
		t.Fatalf("%s win dist=%v, want [1 1]", endpoint, resp.WinningDistribution)
	}
	if len(resp.LosingDistribution) != 1 || resp.LosingDistribution[0] != 1 {
		t.Fatalf("%s loss dist=%v, want [1]", endpoint, resp.LosingDistribution)
	}
}

func TestCORSAllAPIEndpoints(t *testing.T) {
	srv, _ := newTestServer(t, time.Now().UTC())
	router := srv.Router()

	// Preflight OPTIONS on API endpoints
	reqOpt := httptest.NewRequest(http.MethodOptions, "/api/sonic/update", nil)
	reqOpt.Header.Set("Origin", "https://example.com")
	reqOpt.Header.Set("Access-Control-Request-Method", "POST")
	reqOpt.Header.Set("Access-Control-Request-Headers", "Authorization, Content-Type")
	recOpt := httptest.NewRecorder()
	router.ServeHTTP(recOpt, reqOpt)

	if recOpt.Code != http.StatusNoContent {
		t.Fatalf("OPTIONS /api/sonic/update status = %d, want 204", recOpt.Code)
	}
	if got := recOpt.Header().Get("Access-Control-Allow-Origin"); got != "*" {
		t.Fatalf("Access-Control-Allow-Origin = %q, want *", got)
	}
	if got := recOpt.Header().Get("Access-Control-Allow-Methods"); got == "" {
		t.Fatalf("expected non-empty Access-Control-Allow-Methods")
	}
	if got := recOpt.Header().Get("Access-Control-Allow-Headers"); got != "Authorization, Content-Type" {
		t.Fatalf("Access-Control-Allow-Headers = %q, want echoed headers", got)
	}

	// Regular API GET and API 404 both include wildcard CORS headers
	for _, path := range []string{"/api/sonic/summary", "/api/zooms", "/api/nonexistent", "/openapi.yaml"} {
		req := httptest.NewRequest(http.MethodGet, path, nil)
		rec := httptest.NewRecorder()
		router.ServeHTTP(rec, req)
		if got := rec.Header().Get("Access-Control-Allow-Origin"); got != "*" {
			t.Fatalf("GET %s Access-Control-Allow-Origin = %q, want *", path, got)
		}
	}
}

func TestWebhookTradesAuthAndIngestion(t *testing.T) {
	srv, _ := newTestServer(t, time.Now().UTC().Add(-2*time.Hour))
	router := srv.Router()

	payload := `{
		"konto": "dada_master",
		"trades": [{
			"open": "2026-10-16T16:00:10Z",
			"close": "2026-10-16T16:12:06Z",
			"symbol": "XAUUSD",
			"action": "Sell",
			"lots": 84.19,
			"open_price": 3866.37,
			"close_price": 3864.57,
			"pips": 180,
			"profit": 14313.34,
			"gain_pct": 0.0129,
			"balance_before": 110789010.52,
			"ticket": "105581675"
		}]
	}`

	// 1. Unconfigured key returns 503
	t.Setenv("SONIC_WEBHOOK_API_KEY", "")
	t.Setenv("WEBHOOK_API_KEY", "")
	req503 := httptest.NewRequest(http.MethodPost, "/api/sonic/webhook/trades", strings.NewReader(payload))
	rec503 := httptest.NewRecorder()
	router.ServeHTTP(rec503, req503)
	if rec503.Code != http.StatusServiceUnavailable {
		t.Fatalf("unconfigured key status = %d, want 503", rec503.Code)
	}

	// 2. Invalid/missing key returns 401
	t.Setenv("SONIC_WEBHOOK_API_KEY", "super-secret-shared-key")
	req401 := httptest.NewRequest(http.MethodPost, "/api/sonic/webhook/trades", strings.NewReader(payload))
	req401.Header.Set("X-API-Key", "wrong-key")
	rec401 := httptest.NewRecorder()
	router.ServeHTTP(rec401, req401)
	if rec401.Code != http.StatusUnauthorized {
		t.Fatalf("wrong key status = %d, want 401", rec401.Code)
	}

	// 3. Valid X-API-Key succeeds
	reqOK := httptest.NewRequest(http.MethodPost, "/api/sonic/webhook/trades", strings.NewReader(payload))
	reqOK.Header.Set("X-API-Key", "super-secret-shared-key")
	recOK := httptest.NewRecorder()
	router.ServeHTTP(recOK, reqOK)
	if recOK.Code != http.StatusOK {
		t.Fatalf("valid X-API-Key status = %d, want 200 (body: %s)", recOK.Code, recOK.Body.String())
	}

	var resp models.WebhookTradesResponse
	if err := json.Unmarshal(recOK.Body.Bytes(), &resp); err != nil {
		t.Fatalf("unmarshal webhook response: %v", err)
	}
	if resp.Inserted != 1 || resp.TotalTrades != 5 || resp.ProvisionalTrades != 1 {
		t.Fatalf("unexpected webhook response: %+v", resp)
	}

	// 4. Valid Bearer token also works cleanly
	reqBearer := httptest.NewRequest(http.MethodPost, "/api/sonic/webhook/trades", strings.NewReader(payload))
	reqBearer.Header.Set("Authorization", "Bearer super-secret-shared-key")
	recBearer := httptest.NewRecorder()
	router.ServeHTTP(recBearer, reqBearer)
	if recBearer.Code != http.StatusOK {
		t.Fatalf("Bearer retry status = %d, want 200", recBearer.Code)
	}
	var resp2 models.WebhookTradesResponse
	_ = json.Unmarshal(recBearer.Body.Bytes(), &resp2)
	if resp2.SkippedExisting != 1 || resp2.Updated != 0 || resp2.TotalTrades != 5 {
		t.Fatalf("expected idempotent skip on Bearer retry, got %+v", resp2)
	}
}

