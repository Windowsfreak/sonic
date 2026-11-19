# Sonic AI - TAG Record Service Makefile

PORT ?= 8085
DATA_DIR ?= ./data
SCRIPTS_DIR ?= ./scripts
FRONTEND_DIR ?= ./frontend

.PHONY: all build run crawl test clean

all: build

build:
	@echo "==> Building Sonic Server binary..."
	go build -o sonic-server ./cmd/server

run: build
	@echo "==> Starting Sonic Server on port $(PORT)..."
	@bash -c 'set -a; [ -f .env ] && . ./.env; set +a; exec ./sonic-server -port "$(PORT)" -data "$(DATA_DIR)" -scripts "$(SCRIPTS_DIR)" -frontend "$(FRONTEND_DIR)"'

crawl:
	@echo "==> Running on-demand crawler to refresh cache..."
	@bash -c 'set -a; [ -f .env ] && . ./.env; set +a; exec node ./scripts/crawl_myfxbook.js ./data/sonic_cache.json'

test:
	@echo "==> Testing Go codebase..."
	go test -v ./...
	@echo "==> Checking curl endpoint..."
	@curl -s http://localhost:$(PORT)/api/sonic/summary | jq .account_name || echo "Server not running on port $(PORT)"

clean:
	@echo "==> Cleaning build artifacts..."
	rm -f sonic-server
