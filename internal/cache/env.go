package cache

import (
	"bufio"
	"os"
	"path/filepath"
	"strings"
)

// parseDotEnv reads KEY=VALUE pairs from a .env file, ignoring comments and blank lines.
func parseDotEnv(path string) (map[string]string, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()

	vars := make(map[string]string)
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		if strings.HasPrefix(line, "export ") {
			line = strings.TrimSpace(strings.TrimPrefix(line, "export "))
		}
		idx := strings.IndexByte(line, '=')
		if idx <= 0 {
			continue
		}
		key := strings.TrimSpace(line[:idx])
		val := strings.TrimSpace(line[idx+1:])
		if len(val) >= 2 && ((val[0] == '"' && val[len(val)-1] == '"') || (val[0] == '\'' && val[len(val)-1] == '\'')) {
			val = val[1 : len(val)-1]
		}
		if key != "" {
			vars[key] = val
		}
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}
	return vars, nil
}

// buildCrawlerEnv merges variables from candidate .env files into baseEnv without overriding existing entries.
func buildCrawlerEnv(baseEnv []string, envPaths []string) []string {
	merged := make(map[string]string, len(baseEnv))
	order := make([]string, 0, len(baseEnv))

	for _, entry := range baseEnv {
		idx := strings.IndexByte(entry, '=')
		if idx <= 0 {
			continue
		}
		k := entry[:idx]
		if _, exists := merged[k]; !exists {
			order = append(order, k)
		}
		merged[k] = entry[idx+1:]
	}

	for _, p := range envPaths {
		if p == "" {
			continue
		}
		vars, err := parseDotEnv(p)
		if err != nil {
			continue
		}
		for k, v := range vars {
			if _, exists := merged[k]; !exists {
				order = append(order, k)
				merged[k] = v
			}
		}
	}

	out := make([]string, 0, len(order))
	for _, k := range order {
		out = append(out, k+"="+merged[k])
	}
	return out
}

func (m *Manager) envCandidatePaths() []string {
	seen := make(map[string]struct{})
	candidates := []string{".env"}
	if m.crawlerPath != "" {
		scriptsDir := filepath.Dir(m.crawlerPath)
		candidates = append(candidates, filepath.Join(filepath.Dir(scriptsDir), ".env"))
	}
	if m.cacheFile != "" {
		dataDir := filepath.Dir(m.cacheFile)
		candidates = append(candidates, filepath.Join(filepath.Dir(dataDir), ".env"))
	}

	unique := make([]string, 0, len(candidates))
	for _, p := range candidates {
		abs, err := filepath.Abs(p)
		if err != nil {
			abs = p
		}
		if _, ok := seen[abs]; !ok {
			seen[abs] = struct{}{}
			unique = append(unique, p)
		}
	}
	return unique
}
