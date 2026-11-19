# Sonic AI · TAG Record Platform

Vollständiger Nachbau und funktionale Weiterentwicklung der Manus 2.0 Vorlage mit hochperformantem Go-Backend (`julienschmidt/httprouter`), 60-Minuten On-Demand Lazy Cache, echter Myfxbook-Echtzeitanbindung und interaktivem Frontend-Zinseszins-Rechner.

---

## Highlights & Neuerungen gegenüber der Manus-Vorlage

1. **Lazy On-Demand Caching (Zero-Overhead):**
   - Kein ständiger Hintergrund-Polling-Daemon, wenn niemand auf der Seite ist.
   - Anfragen werden bis zu 60 Minuten lang blitzschnell (< 1 ms) aus dem In-Memory Cache bedient.
   - Erst wenn eine Anfrage eingeht und der Cache älter als 60 Min. ist, wird der schlanke Chromium-Crawler on-demand getriggert und der Cache mit den neuesten Trades und Kurvenpunkten aktualisiert.

2. **Echte Trading Fees & Plausibilitätsprüfung:**
   - Berücksichtigung der realen Lot-Gebühren (**~$9,80 / Standard-Lot**, skaliert mit ~0,000784 Lots pro 1.000 $ MT5-Eigenkapital).
   - **30% Performance Fee** mit High-Water-Mark (HWM) und Verlustvortrag (5% Trader-Share + 25% Netzwerk-Boni auf 10 Ebenen).
   - Transparente Aufschlüsselung von Brutto-Ergebnis, Gebühren und Netto-Gewinn (70%).

3. **Interaktiver Zinseszins-Simulator (Compounding):**
   - Ermöglicht den direkten Vergleich zwischen:
     - **Keine Reinvestition (Linear):** ~170% p.a.
     - **Monatliche Reinvestition:** ~400% p.a.
     - **Wöchentliche Reinvestition (Sonntag):** ~650% p.a.
     - **Tägliche Reinvestition um Mitternacht:** **~800% p.a.!**
   - Dual-Line SVG Performance-Chart (Grün = Zinseszins, Blau gestrichelt = Linear) mit Live-Crosshair und Tooltip.

4. **Vollständiges Frontend:**
   - **Trading Sonic:** Interaktiver Rechner mit Kapital-Schnellauswahl ($1.000 bis $50.000), 1x/12x/24x Hebel-Umschaltung, Zinseszins-Wahlschalter, Periodenergebnisse und paginiertes Trade-Archiv.
   - **Guide (`/guide`):** 13-stufige illustrierte Schritt-für-Schritt-Anleitung für CopyX, TAG Markets, MT5 und EpixPay.
   - **Zooms (`/zooms`):** Live-Termine (Mittwoch 20:30 Uhr Call mit Zoom-Einwahllink) und YouTube-Wissensarchiv.
   - **Vergütungsplan:** Interaktiver Verteilungsbalken (70% Investor, 5% Trader, 25% Network), Share- und Lot-Boni.
   - **Rechtliches:** Datenschutz (`/privacy`) und Disclaimer (`/disclaimer`).

---

## Projektstruktur

```
sonic/
├── cmd/
│   └── server/
│       └── main.go              # Go HTTP Server Entrypoint mit Graceful Shutdown
├── internal/
│   ├── api/
│   │   └── router.go            # julienschmidt/httprouter REST & Static Routes
│   ├── cache/
│   │   └── cache.go             # 60-Minuten In-Memory & File Cache Manager
│   └── models/
│       └── sonic.go             # Go Structs für Myfxbook, Trades, Zooms
├── scripts/
│   └── crawl_myfxbook.js        # Puppeteer-Core Chromium Scraper (Bypasses Cloudflare)
├── frontend/
│   ├── index.html               # Hauptanwendung (Trading Sonic, Rechner, Chart)
│   ├── guide.html               # 13-Schritte Setup Guide
│   ├── zooms.html               # Community Zooms & Aufzeichnungen
│   ├── privacy.html             # Datenschutz
│   ├── disclaimer.html          # Disclaimer & Impressum
│   ├── css/
│   │   └── style.css            # Modernes Dark-Mode Glassmorphism Design
│   ├── js/
│   │   ├── app.js               # Frontend Application Controller & API Sync
│   │   ├── calculator.js        # Zinseszins-, Hebel- & Fee-Berechnungs-Engine
│   │   └── chart.js             # 60fps Dual-Line SVG Interactive Chart
│   └── assets/                  # Bilder, Icons, Videos, Fonts (Lokal vorgehalten)
├── data/
│   ├── sonic_cache.json         # Lokaler Snapshot-Speicher
│   └── community-zooms.json     # Zoom-Calls & Aufzeichnungen
├── reference/
│   └── manus/                   # Gespiegelte Original-Referenz
├── Makefile                     # Make-Befehle für Build, Run, Test
├── go.mod
└── go.sum
```

---

## Schnellstart

### 1. Server starten
```bash
make run
# oder manuell:
go run ./cmd/server/main.go -port 8085
```
Die Anwendung ist sofort unter **`http://localhost:8085`** erreichbar.

### 2. Manueller Cache-Refresh (optional)
```bash
make crawl
```
Oder direkt über den Button **„Jetzt aktualisieren“** in der Weboberfläche bzw. via API:
```bash
curl -X POST http://localhost:8085/api/refresh
```

### 3. Verfügbare REST-Endpoints
- `GET /api/sonic/summary` – Aktuelle Gesamtmetriken, Periodenwerte und Cache-Status
- `GET /api/sonic/growth` – 430 historische Kurvenpunkte und tägliche Lot-Volumina
- `GET /api/sonic/trades?page=1&limit=20` – Paginierte Trade-Historie aller geschlossenen Trades
- `GET /api/zooms` – Zoom-Termine und Videoaufzeichnungen
- `POST /api/refresh` – Forciert einen sofortigen On-Demand Myfxbook-Crawl
