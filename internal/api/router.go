package api

import (
	"crypto/subtle"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/julienschmidt/httprouter"
	"github.com/windowsfreak/sonic/internal/cache"
	"github.com/windowsfreak/sonic/internal/models"
)

type Server struct {
	router      *httprouter.Router
	cacheMgr    *cache.Manager
	frontendDir string
}

func NewServer(cacheMgr *cache.Manager, frontendDir string) *Server {
	s := &Server{
		router:      httprouter.New(),
		cacheMgr:    cacheMgr,
		frontendDir: frontendDir,
	}
	s.setupRoutes()
	return s
}

func (s *Server) Router() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasPrefix(r.URL.Path, "/api/") || r.URL.Path == "/openapi.yaml" {
			setCORSHeaders(w, r)
			if r.Method == http.MethodOptions {
				w.WriteHeader(http.StatusNoContent)
				return
			}
		}
		s.router.ServeHTTP(w, r)
	})
}

func setCORSHeaders(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD")
	if reqHeaders := r.Header.Get("Access-Control-Request-Headers"); reqHeaders != "" {
		w.Header().Set("Access-Control-Allow-Headers", reqHeaders)
		w.Header().Add("Vary", "Access-Control-Request-Headers")
	} else {
		w.Header().Set("Access-Control-Allow-Headers", "*, Authorization, Content-Type, X-API-Key")
	}
	w.Header().Set("Access-Control-Max-Age", "86400")
}

func (s *Server) setupRoutes() {
	// API routes
	s.router.GET("/api/sonic/summary", s.handleSummary)
	s.router.GET("/api/sonic/growth", s.handleGrowth)
	s.router.GET("/api/sonic/trades", s.handleTrades)
	s.router.GET("/api/sonic/lots", s.handleLots)
	s.router.GET("/api/sonic/calendar", s.handleCalendar)
	s.router.GET("/api/sonic/streaks", s.handleStreaks)
	s.router.POST("/api/sonic/update", s.handleUpdate)
	s.router.POST("/api/sonic/webhook/trades", s.handleWebhookTrades)
	s.router.GET("/api/zooms", s.handleZooms)

	// Static files & pages
	s.router.NotFound = http.HandlerFunc(s.handleStaticOrSPA)
}

func (s *Server) writeJSON(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}

func (s *Server) handleSummary(w http.ResponseWriter, r *http.Request, _ httprouter.Params) {
	data, err := s.cacheMgr.GetCachedData()
	if err != nil {
		s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	age, isStale, isCrawling := s.cacheMgr.GetCacheStatus()
	resp := map[string]any{
		"account_name":        data.AccountName,
		"account_id":          data.AccountID,
		"source":              data.Source,
		"fetched_utc":         data.FetchedUTC,
		"last_full_crawl_utc": data.LastFullCrawlUTC,
		"last_crawl_mode":     data.LastCrawlMode,
		"age_seconds":         age,
		"min_force_seconds":   int(cache.MinForceUpdateInterval.Seconds()),
		"is_stale":            isStale,
		"is_updating":         isCrawling,
		"general":             data.General,
		"periods":             data.Periods,
		"monthly_gain":        data.MonthlyGain,
	}
	if !data.LastWebhookUTC.IsZero() {
		resp["last_webhook_utc"] = data.LastWebhookUTC
	}
	s.writeJSON(w, http.StatusOK, resp)
}

func (s *Server) handleGrowth(w http.ResponseWriter, r *http.Request, _ httprouter.Params) {
	data, err := s.cacheMgr.GetCachedData()
	if err != nil {
		s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	s.writeJSON(w, http.StatusOK, map[string]any{
		"fetched_utc":  data.FetchedUTC,
		"growth":       data.Growth,
		"lots":         data.Lots.Days,
		"monthly_gain": data.MonthlyGain,
	})
}

func (s *Server) handleTrades(w http.ResponseWriter, r *http.Request, _ httprouter.Params) {
	data, err := s.cacheMgr.GetCachedData()
	if err != nil {
		s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	pageStr := r.URL.Query().Get("page")
	limitStr := r.URL.Query().Get("limit")

	page := 1
	limit := 20
	if r.URL.Query().Get("all") == "true" {
		limit = 10000
	} else {
		if p, err := strconv.Atoi(pageStr); err == nil && p > 0 {
			page = p
		}
		if l, err := strconv.Atoi(limitStr); err == nil && l > 0 && l <= 1000 {
			limit = l
		}
	}

	total := len(data.Trades)
	start := (page - 1) * limit
	if start > total {
		start = total
	}
	end := start + limit
	if end > total {
		end = total
	}

	var pageTrades []models.ClosedTrade
	if start < total {
		pageTrades = data.Trades[start:end]
	}

	s.writeJSON(w, http.StatusOK, map[string]any{
		"total":  total,
		"page":   page,
		"limit":  limit,
		"trades": pageTrades,
	})
}

func (s *Server) handleLots(w http.ResponseWriter, r *http.Request, _ httprouter.Params) {
	data, err := s.cacheMgr.GetCachedData()
	if err != nil {
		s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	s.writeJSON(w, http.StatusOK, data.Lots)
}

func (s *Server) handleZooms(w http.ResponseWriter, _ *http.Request, _ httprouter.Params) {
	zooms, err := s.cacheMgr.GetZooms()
	if err != nil {
		s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	s.writeJSON(w, http.StatusOK, zooms)
}

func currentCalendarToday() time.Time {
	loc, err := time.LoadLocation("Europe/Berlin")
	if err != nil {
		return time.Now().UTC()
	}
	now := time.Now().In(loc)
	return time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, time.UTC)
}

func (s *Server) handleCalendar(w http.ResponseWriter, r *http.Request, _ httprouter.Params) {
	q := r.URL.Query()
	anchor := currentCalendarToday()
	days := 7
	forward := q.Get("dir") == "forward"

	if monthStr := strings.TrimSpace(q.Get("month")); monthStr != "" && strings.TrimSpace(q.Get("date")) == "" {
		parsedMonth, err := time.Parse("2006-01", monthStr)
		if err != nil {
			s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid month format, expected YYYY-MM"})
			return
		}
		firstOfNext := time.Date(parsedMonth.Year(), parsedMonth.Month()+1, 1, 0, 0, 0, 0, time.UTC)
		lastOfMonth := firstOfNext.AddDate(0, 0, -1)
		anchor = lastOfMonth
		days = lastOfMonth.Day()
		forward = false
	}

	if dateStr := strings.TrimSpace(q.Get("date")); dateStr != "" {
		parsedDate, err := time.Parse("2006-01-02", dateStr)
		if err != nil {
			s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid date format, expected YYYY-MM-DD"})
			return
		}
		anchor = parsedDate.UTC()
	}

	if daysStr := strings.TrimSpace(q.Get("days")); daysStr != "" {
		parsedDays, err := strconv.Atoi(daysStr)
		if err != nil || parsedDays < 1 || parsedDays > 366 {
			s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid days parameter, expected 1..366"})
			return
		}
		days = parsedDays
	}

	cal, err := s.cacheMgr.GetCalendar(anchor, days, forward)
	if err != nil {
		s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	s.writeJSON(w, http.StatusOK, cal)
}

func (s *Server) handleStreaks(w http.ResponseWriter, _ *http.Request, _ httprouter.Params) {
	streaks, err := s.cacheMgr.GetStreaks()
	if err != nil {
		s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}
	s.writeJSON(w, http.StatusOK, streaks)
}

func (s *Server) handleUpdate(w http.ResponseWriter, r *http.Request, _ httprouter.Params) {
	force := r.URL.Query().Get("force") == "true"
	mode := strings.TrimSpace(r.URL.Query().Get("mode"))
	started, err := s.cacheMgr.TriggerUpdateWithMode(force, mode)
	if err != nil {
		s.writeJSON(w, http.StatusInternalServerError, map[string]string{"error": err.Error()})
		return
	}

	age, isStale, isCrawling := s.cacheMgr.GetCacheStatus()
	minForceSecs := int(cache.MinForceUpdateInterval.Seconds())
	cooldownActive := age < minForceSecs
	cooldownRemaining := 0
	if cooldownActive {
		cooldownRemaining = minForceSecs - age
	}

	status := "up_to_date"
	httpStatus := http.StatusOK
	if started {
		status = "started"
		httpStatus = http.StatusAccepted
	} else if isCrawling {
		status = "already_running"
		httpStatus = http.StatusAccepted
	} else if cooldownActive {
		status = "cooldown"
	}

	resp := map[string]any{
		"status":                     status,
		"started":                    started,
		"age_seconds":                age,
		"is_stale":                   isStale,
		"is_updating":                isCrawling,
		"min_force_seconds":          minForceSecs,
		"cooldown_active":            cooldownActive,
		"cooldown_remaining_seconds": cooldownRemaining,
		"force_ignored":              force && !started && !isCrawling && cooldownActive,
	}

	s.writeJSON(w, httpStatus, resp)
}

func extractBearerOrHeaderKey(r *http.Request) string {
	if auth := strings.TrimSpace(r.Header.Get("Authorization")); auth != "" {
		if len(auth) >= 7 && strings.EqualFold(auth[:7], "Bearer ") {
			return strings.TrimSpace(auth[7:])
		}
		return auth
	}
	if key := strings.TrimSpace(r.Header.Get("X-API-Key")); key != "" {
		return key
	}
	return ""
}

func parseWebhookPayload(raw []byte) ([]models.WebhookTradeInput, error) {
	trimmed := strings.TrimSpace(string(raw))
	if trimmed == "" {
		return nil, http.ErrBodyNotAllowed
	}

	if strings.HasPrefix(trimmed, "[") {
		var list []models.WebhookTradeInput
		if err := json.Unmarshal([]byte(trimmed), &list); err != nil {
			return nil, err
		}
		return list, nil
	}

	var envelope models.WebhookTradesPayload
	if err := json.Unmarshal([]byte(trimmed), &envelope); err != nil {
		return nil, err
	}
	if len(envelope.Trades) > 0 {
		return envelope.Trades, nil
	}
	if envelope.Trade != nil {
		return []models.WebhookTradeInput{*envelope.Trade}, nil
	}

	var single models.WebhookTradeInput
	if err := json.Unmarshal([]byte(trimmed), &single); err != nil {
		return nil, err
	}
	if single.Open != "" || single.Close != "" || single.Symbol != "" || single.Action != "" {
		return []models.WebhookTradeInput{single}, nil
	}
	return nil, nil
}

func (s *Server) handleWebhookTrades(w http.ResponseWriter, r *http.Request, _ httprouter.Params) {
	expectedKey := s.cacheMgr.WebhookAPIKey()
	if expectedKey == "" {
		s.writeJSON(w, http.StatusServiceUnavailable, map[string]string{
			"error": "webhook API key is not configured (set SONIC_WEBHOOK_API_KEY)",
		})
		return
	}

	providedKey := extractBearerOrHeaderKey(r)
	if providedKey == "" || subtle.ConstantTimeCompare([]byte(providedKey), []byte(expectedKey)) != 1 {
		s.writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "invalid or missing API key"})
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, 4<<20)
	defer r.Body.Close()
	dec := json.NewDecoder(r.Body)
	var raw json.RawMessage
	if err := dec.Decode(&raw); err != nil {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid JSON body: " + err.Error()})
		return
	}

	inputs, err := parseWebhookPayload(raw)
	if err != nil || len(inputs) == 0 {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": "expected trades array or trade object"})
		return
	}

	resp, err := s.cacheMgr.IngestWebhookTrades(inputs)
	if err != nil {
		s.writeJSON(w, http.StatusBadRequest, map[string]string{"error": err.Error()})
		return
	}

	s.writeJSON(w, http.StatusOK, resp)
}

func (s *Server) handleStaticOrSPA(w http.ResponseWriter, r *http.Request) {
	cleanPath := filepath.Clean(r.URL.Path)
	if cleanPath == "/" {
		cleanPath = "/index.html"
	}

	// Support clean page URLs like /guide, /zooms, /sonic, /privacy, /disclaimer
	filePath := filepath.Join(s.frontendDir, cleanPath)
	info, err := os.Stat(filePath)

	if err != nil || info.IsDir() {
		// Check if html file exists (e.g. /guide -> /guide.html)
		htmlCandidate := filePath + ".html"
		if hInfo, hErr := os.Stat(htmlCandidate); hErr == nil && !hInfo.IsDir() {
			http.ServeFile(w, r, htmlCandidate)
			return
		}
		// If not found and not an API call, serve index.html
		if !strings.HasPrefix(cleanPath, "/api/") {
			http.ServeFile(w, r, filepath.Join(s.frontendDir, "index.html"))
			return
		}
		http.NotFound(w, r)
		return
	}

	http.ServeFile(w, r, filePath)
}
