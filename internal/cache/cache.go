package cache

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"time"

	"github.com/windowsfreak/sonic/internal/models"
)

const (
	MinForceUpdateInterval = 60 * time.Minute
	FullCrawlInterval      = 24 * time.Hour
	ForceFullCrawlInterval = 6 * time.Hour
)

type Manager struct {
	mu           sync.RWMutex
	cacheFile    string
	zoomsFile    string
	crawlerPath  string
	expiry       time.Duration
	sonicData    *models.SonicData
	lastDiskMod  time.Time
	zoomsData    *any
	isCrawling   bool
	crawlCond    *sync.Cond
	stopChan     chan struct{}
	crawlerFn    func(ctx context.Context, mode string) error
}

func NewManager(dataPath, scriptsPath string, expiry time.Duration) (*Manager, error) {
	cacheFile := filepath.Join(dataPath, "sonic_cache.json")
	zoomsFile := filepath.Join(dataPath, "community-zooms.json")
	crawlerPath := filepath.Join(scriptsPath, "crawl_myfxbook.js")

	if expiry <= 0 {
		expiry = 240 * time.Minute
	}

	m := &Manager{
		cacheFile:   cacheFile,
		zoomsFile:   zoomsFile,
		crawlerPath: crawlerPath,
		expiry:      expiry,
		stopChan:    make(chan struct{}),
	}
	m.crawlerFn = m.execCrawler
	m.crawlCond = sync.NewCond(&m.mu)

	// Load initial cache from disk if available
	if err := m.loadFromDisk(); err != nil {
		log.Printf("[Cache] Warning: could not load initial cache from disk: %v", err)
	}

	// Start periodic crawler worker to keep all historical trades fresh at its fingertips
	go m.startPeriodicWorker()

	return m, nil
}

func (m *Manager) startPeriodicWorker() {
	checkInterval := 5 * time.Minute
	if m.expiry < checkInterval {
		checkInterval = m.expiry
	}
	ticker := time.NewTicker(checkInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ticker.C:
			_, isStale, isCrawling := m.GetCacheStatus()
			if isStale && !isCrawling {
				log.Printf("[Cache] Periodic check triggered. Cache is stale, initiating crawl...")
				_, _ = m.TriggerUpdate(false)
			}
		case <-m.stopChan:
			return
		}
	}
}

func (m *Manager) Close() {
	close(m.stopChan)
}

func (m *Manager) loadFromDisk() error {
	m.mu.Lock()
	defer m.mu.Unlock()

	info, err := os.Stat(m.cacheFile)
	if err != nil {
		return err
	}

	data, err := os.ReadFile(m.cacheFile)
	if err != nil {
		return err
	}

	var sonic models.SonicData
	if err := json.Unmarshal(data, &sonic); err != nil {
		return fmt.Errorf("failed to parse cache json: %w", err)
	}

	m.sonicData = &sonic
	m.lastDiskMod = info.ModTime()
	log.Printf("[Cache] Loaded cache from disk (fetched utc: %s, growth pts: %d, trades: %d)",
		sonic.FetchedUTC.Format(time.RFC3339), len(sonic.Growth), len(sonic.Trades))
	return nil
}

// GetCachedData returns the currently cached SonicData immediately from memory.
// It never blocks on crawling. If the disk file has changed, it automatically reloads.
func (m *Manager) GetCachedData() (*models.SonicData, error) {
	// Check if file on disk has been updated
	if info, err := os.Stat(m.cacheFile); err == nil {
		m.mu.RLock()
		needReload := m.sonicData == nil || info.ModTime().After(m.lastDiskMod)
		m.mu.RUnlock()
		if needReload {
			if err := m.loadFromDisk(); err != nil && m.sonicData == nil {
				return nil, fmt.Errorf("failed to reload cache: %w", err)
			}
		}
	}

	m.mu.RLock()
	defer m.mu.RUnlock()
	if m.sonicData == nil {
		return nil, fmt.Errorf("cache is empty")
	}
	return m.sonicData, nil
}

// GetCacheStatus returns current cache age in seconds, whether it is stale (>expiry), and if update is running.
func (m *Manager) GetCacheStatus() (int, bool, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	if m.sonicData == nil || m.sonicData.FetchedUTC.IsZero() {
		return 0, true, m.isCrawling
	}

	age := int(time.Since(m.sonicData.FetchedUTC).Seconds())
	if age < 0 {
		age = 0
	}
	isStale := age >= int(m.expiry.Seconds())
	return age, isStale, m.isCrawling
}

func (m *Manager) selectCrawlModeLocked(force bool, requestedMode string) string {
	switch requestedMode {
	case "full", "partial", "metrics":
		return requestedMode
	}

	if m.sonicData == nil || len(m.sonicData.Trades) == 0 || m.sonicData.LastFullCrawlUTC.IsZero() {
		return "full"
	}

	sinceFull := time.Since(m.sonicData.LastFullCrawlUTC)
	if sinceFull >= FullCrawlInterval {
		return "full"
	}
	if force && sinceFull >= ForceFullCrawlInterval {
		return "full"
	}
	return "partial"
}

// TriggerUpdate starts an asynchronous crawler in the background using the tiered strategy.
// Regardless of force, updates are rejected when the cache is less than 1 hour old.
func (m *Manager) TriggerUpdate(force bool) (bool, error) {
	return m.TriggerUpdateWithMode(force, "")
}

// TriggerUpdateWithMode starts a background crawl with an optional requested mode ("full", "partial", "metrics", or "" for tiered auto).
func (m *Manager) TriggerUpdateWithMode(force bool, requestedMode string) (bool, error) {
	m.mu.Lock()

	// If crawler is already running, return false
	if m.isCrawling {
		m.mu.Unlock()
		return false, nil
	}

	if m.sonicData != nil && !m.sonicData.FetchedUTC.IsZero() {
		age := time.Since(m.sonicData.FetchedUTC)
		// Hard 1-hour cooldown: ignore force flag when cache is < 1 hour old
		if age < MinForceUpdateInterval {
			m.mu.Unlock()
			return false, nil
		}
		if !force && age < m.expiry {
			m.mu.Unlock()
			return false, nil
		}
	}

	mode := m.selectCrawlModeLocked(force, requestedMode)
	m.isCrawling = true
	m.mu.Unlock()

	go m.runCrawlerBackground(mode)

	return true, nil
}

func (m *Manager) runCrawlerBackground(mode string) {
	defer func() {
		m.mu.Lock()
		m.isCrawling = false
		m.crawlCond.Broadcast()
		m.mu.Unlock()
	}()

	log.Printf("[Cache] Background crawl started (mode=%s)...", mode)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()

	runner := m.crawlerFn
	if runner == nil {
		runner = m.execCrawler
	}
	if err := runner(ctx, mode); err != nil {
		log.Printf("[Cache] Background crawl failed: %v", err)
		return
	}

	if err := m.loadFromDisk(); err != nil {
		log.Printf("[Cache] Failed to reload cache after background crawl: %v", err)
		return
	}

	log.Printf("[Cache] Background crawl finished (mode=%s) and cache updated successfully.", mode)
}

// GetData is kept for backwards compatibility
func (m *Manager) GetData(ctx context.Context, forceRefresh bool) (*models.SonicData, error) {
	if forceRefresh {
		_, _ = m.TriggerUpdate(true)
	}
	return m.GetCachedData()
}

func (m *Manager) execCrawler(ctx context.Context, mode string) error {
	args := []string{m.crawlerPath, m.cacheFile}
	if mode != "" {
		args = append(args, "--mode="+mode)
	}
	cmd := exec.CommandContext(ctx, "node", args...)
	cmd.Env = buildCrawlerEnv(os.Environ(), m.envCandidatePaths())
	output, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("crawler command failed: %w (output: %s)", err, string(output))
	}
	log.Printf("[Cache] Crawler completed successfully:\n%s", string(output))
	return nil
}

// GetCalendar computes daily trade & leveraged net growth metrics for a date window.
func (m *Manager) GetCalendar(anchorDate time.Time, days int, forward bool) (*models.CalendarResponse, error) {
	data, err := m.GetCachedData()
	if err != nil {
		return nil, err
	}
	return BuildCalendar(data, anchorDate, days, forward), nil
}

// GetStreaks computes current, longest, and distribution streak statistics across closed trades.
func (m *Manager) GetStreaks() (*models.StreaksResponse, error) {
	data, err := m.GetCachedData()
	if err != nil {
		return nil, err
	}
	return ComputeStreaks(data), nil
}

// GetZooms returns the community Zoom calls and recordings configuration.
func (m *Manager) GetZooms() (*models.ZoomData, error) {
	data, err := os.ReadFile(m.zoomsFile)
	if err != nil {
		return nil, err
	}
	var res models.ZoomData
	if err := json.Unmarshal(data, &res); err != nil {
		return nil, err
	}
	return &res, nil
}
