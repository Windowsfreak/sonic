const puppeteer = require('puppeteer-core');
const { ScrapingBrowser } = require('@zenrows/browser-sdk');
const { parseHTML } = require('linkedom');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

function loadDotEnv() {
    const candidates = [
        path.join(__dirname, '../.env'),
        path.join(process.cwd(), '.env')
    ];
    const seen = new Set();
    for (const filePath of candidates) {
        const resolved = path.resolve(filePath);
        if (seen.has(resolved) || !fs.existsSync(resolved)) continue;
        seen.add(resolved);
        try {
            const lines = fs.readFileSync(resolved, 'utf8').split(/\r?\n/);
            for (const rawLine of lines) {
                const line = rawLine.trim();
                if (!line || line.startsWith('#')) continue;
                const cleaned = line.startsWith('export ') ? line.slice('export '.length).trim() : line;
                const eqIdx = cleaned.indexOf('=');
                if (eqIdx <= 0) continue;
                const key = cleaned.slice(0, eqIdx).trim();
                let val = cleaned.slice(eqIdx + 1).trim();
                if (
                    val.length >= 2 &&
                    ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
                ) {
                    val = val.slice(1, -1);
                }
                if (key && process.env[key] === undefined) {
                    process.env[key] = val;
                }
            }
        } catch (e) {
            console.warn(`[Crawler] Warning: could not read ${resolved}: ${e.message}`);
        }
    }
}

loadDotEnv();

const CHALLENGE_URL_RE = /\/cdn-cgi\/|challenges\.cloudflare\.com|hcaptcha\.com|recaptcha\.net|google\.com\/recaptcha|gstatic\.com\/recaptcha|arkoselabs\.com|funcaptcha\.com|turnstile/i;
const HANGING_AD_RE = /(?:doubleclick\.net|googlesyndication\.com|googletagmanager\.com|google-analytics\.com|analytics\.google\.com|adform\.net|adnxs\.com|criteo\.com|taboola\.com|outbrain\.com|pubmatic\.com|rubiconproject\.com|openx\.net|facebook\.net)/i;

function isChallengeUrl(url) {
    return typeof url === 'string' && CHALLENGE_URL_RE.test(url);
}

function redactToken(text) {
    return String(text || '')
        .replace(/([?&](?:token|apikey|api_key)=)[^&\s"']+/gi, '$1[REDACTED]')
        .replace(/(["']?(?:token|apikey|apiKey)["']?\s*[:=]\s*["']?)[^"',\s}]+/gi, '$1[REDACTED]');
}

const SESSION_STATE_FILE = process.env.BROWSERLESS_SESSION_FILE || path.join(__dirname, '../data/browserless_session.json');
const SESSION_MAX_AGE_MS = Math.max(parseInt(process.env.BROWSERLESS_SESSION_MAX_AGE_MS || String(12 * 3600 * 1000), 10) || 12 * 3600 * 1000, 60000);

function loadSavedSession() {
    if (process.env.BROWSERLESS_PERSIST_SESSION === 'false') return null;
    if (!fs.existsSync(SESSION_STATE_FILE)) return null;
    try {
        const data = JSON.parse(fs.readFileSync(SESSION_STATE_FILE, 'utf8'));
        const savedAtMs = Date.parse(data.savedAt || '');
        if (!savedAtMs || (Date.now() - savedAtMs) > SESSION_MAX_AGE_MS) {
            return null;
        }
        const nowSec = Date.now() / 1000;
        const cookies = Array.isArray(data.cookies)
            ? data.cookies.filter(c => c && c.name && c.value && (c.expires === -1 || !c.expires || c.expires > nowSec))
            : [];
        if (cookies.length === 0) return null;
        return {
            savedAt: data.savedAt,
            userAgent: data.userAgent || '',
            cookies
        };
    } catch (e) {
        return null;
    }
}

async function saveSessionState(page) {
    if (process.env.BROWSERLESS_PERSIST_SESSION === 'false') return;
    try {
        const cookies = await page.cookies();
        if (!Array.isArray(cookies) || cookies.length === 0) return;
        const userAgent = await page.evaluate(() => navigator.userAgent).catch(() => '');
        fs.mkdirSync(path.dirname(SESSION_STATE_FILE), { recursive: true });
        fs.writeFileSync(
            SESSION_STATE_FILE,
            JSON.stringify({ savedAt: new Date().toISOString(), userAgent, cookies }, null, 2),
            { encoding: 'utf8', mode: 0o600 }
        );
    } catch (e) {
        console.warn('[Crawler] Could not persist session state:', e.message);
    }
}

function buildBrowserlessConfig() {
    const token = (process.env.BROWSERLESS_TOKEN || '').trim();
    if (!token) {
        throw new Error('BROWSERLESS_TOKEN environment variable is required.');
    }

    const host = (process.env.BROWSERLESS_HOST || 'production-sfo.browserless.io').trim();
    const mode = (process.env.BROWSERLESS_MODE || 'unblock').trim().toLowerCase();
    const rawRoute = (process.env.BROWSERLESS_ROUTE || '/stealth').trim();
    const route = rawRoute.startsWith('/') ? rawRoute : `/${rawRoute}`;
    const timeoutMs = Math.min(
        Math.max(parseInt(process.env.BROWSERLESS_TIMEOUT_MS || '120000', 10) || 120000, 10000),
        120000
    );
    const unblockTtlMs = Math.min(
        Math.max(parseInt(process.env.BROWSERLESS_UNBLOCK_TTL_MS || '30000', 10) || 30000, 5000),
        30000
    );

    const commonParams = new URLSearchParams({
        token,
        proxy: (process.env.BROWSERLESS_PROXY || 'residential').trim(),
        // Keep blockAds=false by default: uBlock breaks Myfxbook's #tradingHistoryTable loading
        blockAds: process.env.BROWSERLESS_BLOCK_ADS === 'true' ? 'true' : 'false',
    });

    if (process.env.BROWSERLESS_PROXY_COUNTRY) {
        commonParams.set('proxyCountry', process.env.BROWSERLESS_PROXY_COUNTRY.trim());
    }

    const stealthParams = new URLSearchParams(commonParams);
    stealthParams.set('solveCaptchas', process.env.BROWSERLESS_SOLVE_CAPTCHAS === 'false' ? 'false' : 'true');
    stealthParams.set('timeout', String(timeoutMs));

    const unblockParams = new URLSearchParams(commonParams);

    return {
        token,
        host,
        mode,
        route,
        timeoutMs,
        unblockTtlMs,
        proxy: commonParams.get('proxy'),
        solveCaptchas: stealthParams.get('solveCaptchas') === 'true',
        blockAds: commonParams.get('blockAds') === 'true',
        blockAssets: process.env.BROWSERLESS_BLOCK_ASSETS !== 'false',
        fastPath: process.env.BROWSERLESS_SESSION_FAST_PATH === 'true',
        unblockUrl: `https://${host}/unblock?${unblockParams.toString()}`,
        stealthWsEndpoint: `wss://${host}${route}?${stealthParams.toString()}`,
    };
}

async function requestUnblockSession(blConfig, targetUrl) {
    const res = await fetch(blConfig.unblockUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            url: targetUrl,
            content: false,
            cookies: false,
            screenshot: false,
            browserWSEndpoint: true,
            ttl: blConfig.unblockTtlMs,
        }),
        signal: AbortSignal.timeout(90000),
    });

    if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(`Browserless /unblock failed with HTTP ${res.status}: ${redactToken(body).slice(0, 300)}`);
    }

    const data = await res.json();
    if (!data || !data.browserWSEndpoint) {
        throw new Error('Browserless /unblock did not return a browserWSEndpoint.');
    }

    const wsUrl = new URL(data.browserWSEndpoint);
    wsUrl.searchParams.set('token', blConfig.token);
    return {
        wsEndpoint: wsUrl.toString(),
        solved: Boolean(data.solved),
    };
}

function buildZenRowsConfig() {
    const apiKey = (process.env.ZENROWS_API_KEY || '').trim();
    if (!apiKey) {
        throw new Error('ZENROWS_API_KEY environment variable is required.');
    }
    const sessionTTL = Math.min(
        Math.max(parseInt(process.env.ZENROWS_SESSION_TTL || '120', 10) || 120, 60),
        900
    );
    const proxyCountry = (process.env.ZENROWS_PROXY_COUNTRY || '').trim().toLowerCase();
    const scrapingBrowser = new ScrapingBrowser({ apiKey });
    const connectOpts = { sessionTTL };
    if (proxyCountry) {
        connectOpts.proxy = { location: proxyCountry };
    }
    return {
        apiKey,
        sessionTTL,
        proxyCountry,
        blockAssets: process.env.ZENROWS_BLOCK_ASSETS !== 'false',
        wsEndpoint: scrapingBrowser.getConnectURL(connectOpts),
    };
}

const rawArgs = process.argv.slice(2);
let cliMode = process.env.CRAWL_MODE || 'auto';
let cliProviders = '';
const positionalArgs = [];
for (const arg of rawArgs) {
    if (arg.startsWith('--mode=')) {
        cliMode = arg.slice('--mode='.length).trim().toLowerCase();
    } else if (arg.startsWith('--provider=')) {
        cliProviders = arg.slice('--provider='.length).trim().toLowerCase();
    } else if (!arg.startsWith('--')) {
        positionalArgs.push(arg);
    }
}
if (!['auto', 'partial', 'full', 'metrics'].includes(cliMode)) {
    cliMode = 'auto';
}

const OUT_FILE = positionalArgs[0] || path.join(__dirname, '../data/sonic_cache.json');
const TARGET_URL = process.env.TARGET_URL || positionalArgs[1] || 'https://www.myfxbook.com/members/SonicExperts/sonic-ai/12076857';

const MONTH_MAP = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };

function parseNum(raw) {
    if (typeof raw === 'number') return Number.isFinite(raw) ? raw : 0;
    if (!raw) return 0;
    const cleaned = String(raw).replace(/[^0-9.-]/g, '');
    const n = parseFloat(cleaned);
    return Number.isFinite(n) ? n : 0;
}

function parseMyfxbookTimestampToISO(raw) {
    if (!raw) return '';
    const s = String(raw).trim();
    const m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
    if (!m) return s;
    const month = m[1].padStart(2, '0');
    const day = m[2].padStart(2, '0');
    const year = m[3];
    const hour = (m[4] || '00').padStart(2, '0');
    const min = (m[5] || '00').padStart(2, '0');
    const sec = (m[6] || '00').padStart(2, '0');
    return `${year}-${month}-${day}T${hour}:${min}:${sec}Z`;
}

function parseDurationToSeconds(raw) {
    if (typeof raw === 'number') return Math.round(raw);
    if (!raw || typeof raw !== 'string') return 0;
    let total = 0;
    const d = raw.match(/(\d+)\s*d/i);
    const h = raw.match(/(\d+)\s*h/i);
    const m = raw.match(/(\d+)\s*m(?!s)/i);
    const s = raw.match(/(\d+)\s*s/i);
    if (d) total += parseInt(d[1], 10) * 86400;
    if (h) total += parseInt(h[1], 10) * 3600;
    if (m) total += parseInt(m[1], 10) * 60;
    if (s) total += parseInt(s[1], 10);
    return total;
}

function parseHighest(raw, now) {
    const str = String(raw || '');
    const pctOrDate = str.match(/\(([A-Za-z]{3})\s+(\d{1,2})\)/);
    let highestDate = '';
    if (pctOrDate) {
        const monNum = parseInt(MONTH_MAP[pctOrDate[1]] || '0', 10);
        if (monNum >= 1 && monNum <= 12) {
            let yr = now.getUTCFullYear();
            if (monNum > now.getUTCMonth() + 1) yr--;
            highestDate = `${yr}-${String(monNum).padStart(2, '0')}-${pctOrDate[2].padStart(2, '0')}`;
        }
    }
    const stripped = str.replace(/\([^)]*\)/g, '');
    return {
        highest: parseNum(stripped),
        highest_date: highestDate
    };
}

function parseEquity(raw) {
    const str = String(raw || '');
    const mPct = str.match(/\(([0-9.,-]+)%?\)/);
    const stripped = str.replace(/\([^)]*\)/g, '');
    return {
        equity: parseNum(stripped),
        equity_pct: mPct ? parseNum(mPct[1]) : 100
    };
}

function parseUpdatedAt(raw, now) {
    const str = String(raw || '').trim().toLowerCase();
    if (!str || str.includes('just now')) return now.toISOString();
    const rel = str.match(/(\d+)\s*(second|minute|hour|day)/);
    if (rel) {
        const val = parseInt(rel[1], 10);
        const unitMs = rel[2] === 'second' ? 1000
            : rel[2] === 'minute' ? 60000
            : rel[2] === 'hour' ? 3600000
            : 86400000;
        return new Date(now.getTime() - val * unitMs).toISOString();
    }
    const abs = String(raw || '').trim().match(/^([A-Za-z]{3})\s+(\d{1,2})\s+at\s+(\d{1,2}):(\d{2})$/i);
    if (abs && MONTH_MAP[abs[1]]) {
        const monNum = parseInt(MONTH_MAP[abs[1]], 10);
        let yr = now.getUTCFullYear();
        if (monNum > now.getUTCMonth() + 1) yr--;
        return `${yr}-${MONTH_MAP[abs[1]]}-${abs[2].padStart(2, '0')}T${abs[3].padStart(2, '0')}:${abs[4]}:00Z`;
    }
    return now.toISOString();
}

function monthToISO(raw) {
    if (!raw) return '';
    if (/^\d{4}-\d{2}$/.test(raw)) return raw;
    const m = String(raw).trim().match(/^([A-Za-z]{3})\s+(\d{4})$/);
    if (m && MONTH_MAP[m[1]]) return `${m[2]}-${MONTH_MAP[m[1]]}`;
    return raw;
}

const makeTradeKey = (t) => `${t.open}|${t.close}|${t.symbol}|${t.action}|${Number(t.lots || 0).toFixed(2)}|${Number(t.open_price || 0)}|${Number(t.close_price || 0)}`;

function isCloudflareTitle(title) {
    if (!title) return false;
    const lower = title.toLowerCase();
    return (
        lower.includes('attention required') ||
        lower.includes('cloudflare') ||
        lower.includes('just a moment') ||
        lower.includes('nur einen moment') ||
        lower.includes('un instant') ||
        lower.includes('un momento') ||
        lower.includes('chwila') ||
        lower.includes('один момент') ||
        lower.includes('moment...') ||
        lower.includes('moment…')
    );
}

// Pre-load existing cache so tiered mode can decide partial vs full up front
let existing = null;
if (fs.existsSync(OUT_FILE)) {
    try {
        existing = JSON.parse(fs.readFileSync(OUT_FILE, 'utf-8'));
    } catch (e) {
        console.warn('[Crawler] Could not read existing cache:', e.message);
    }
}

const existingTradeKeys = new Set();
if (existing && Array.isArray(existing.trades)) {
    for (const t of existing.trades) {
        existingTradeKeys.add(makeTradeKey(t));
    }
}

let EFFECTIVE_MODE = cliMode;
if (EFFECTIVE_MODE === 'auto') {
    const hasHistory = existing && Array.isArray(existing.trades) && existing.trades.length > 0;
    const lastFullMs = existing && existing.last_full_crawl_utc ? Date.parse(existing.last_full_crawl_utc) : 0;
    const fullAgeHours = lastFullMs ? (Date.now() - lastFullMs) / 3600000 : Infinity;
    EFFECTIVE_MODE = (hasHistory && fullAgeHours < 24) ? 'partial' : 'full';
}

async function setupSafeAssetInterception(page, isCaptchaPending) {
    await page.setRequestInterception(true);
    page.on('request', (request) => {
        if (request.isInterceptResolutionHandled()) return;
        const url = request.url();
        const frameUrl = request.frame() ? request.frame().url() : '';

        // Never interfere with CAPTCHA/Cloudflare challenge frames or resources
        if (isCaptchaPending() || isChallengeUrl(url) || isChallengeUrl(frameUrl)) {
            request.continue();
            return;
        }

        if (HANGING_AD_RE.test(url) || ['image', 'media', 'font'].includes(request.resourceType())) {
            request.abort();
            return;
        }

        request.continue();
    });
}

async function waitForPageReady(page, getCaptchaState, waitMs = 45000) {
    const safePageTitle = async () => {
        try {
            return await page.title();
        } catch (e) {
            return '';
        }
    };
    const hasTurnstileFrame = () => page.frames().some(f => isChallengeUrl(f.url()));

    let pageTitle = await safePageTitle();
    console.log(`[Crawler] Initial page title: "${pageTitle}"`);

    const state = getCaptchaState ? getCaptchaState() : { pending: false, waitPromise: Promise.resolve() };
    if (isCloudflareTitle(pageTitle) || hasTurnstileFrame() || state.pending) {
        console.log('[Crawler] Protection challenge detected. Waiting for provider stealth / auto-solve...');
        const deadline = Date.now() + waitMs;
        while (Date.now() < deadline) {
            const cur = getCaptchaState ? getCaptchaState() : { pending: false, waitPromise: Promise.resolve() };
            if (cur.pending) {
                await Promise.race([cur.waitPromise, new Promise(r => setTimeout(r, 2000))]);
            } else {
                await new Promise(r => setTimeout(r, 1000));
            }
            pageTitle = await safePageTitle();
            const post = getCaptchaState ? getCaptchaState() : { pending: false };
            if (pageTitle && !isCloudflareTitle(pageTitle) && !hasTurnstileFrame() && !post.pending) {
                console.log(`[Crawler] Challenge cleared! Page title: "${pageTitle}"`);
                break;
            }
        }
    }

    if (!pageTitle || isCloudflareTitle(pageTitle)) {
        throw new Error(`Cloudflare bot challenge detected ("${pageTitle || 'empty title'}"). Preserving existing cache.`);
    }

    return pageTitle;
}

async function openBrowserlessPage(targetUrl) {
    const blConfig = buildBrowserlessConfig();
    const savedSession = loadSavedSession();
    console.log(
        `[Crawler] Starting Browserless provider (mode=${EFFECTIVE_MODE}, host=${blConfig.host}, blMode=${blConfig.mode}, proxy=${blConfig.proxy}, savedSession=${savedSession ? `${savedSession.cookies.length} cookies` : 'none'}) for ${targetUrl}...`
    );

    const attachPageHandlers = async (page) => {
        await page.setViewport({ width: 1440, height: 900 });
        const cdp = await page.createCDPSession();
        let captchaPending = false;
        let resolveCaptchaPromise = () => {};
        const captchaWaitPromise = new Promise((resolve) => {
            resolveCaptchaPromise = resolve;
        });

        cdp.on('Browserless.captchaFound', ({ type, status } = {}) => {
            captchaPending = true;
            console.log(`[Browserless] CAPTCHA detected (type=${type || 'unknown'}, status=${status || 'pending'}). Waiting for automatic solve...`);
        });

        cdp.on('Browserless.captchaAutoSolved', (data = {}) => {
            captchaPending = false;
            console.log('[Browserless] CAPTCHA automatically solved.');
            resolveCaptchaPromise(data);
        });

        if (blConfig.blockAssets) {
            await setupSafeAssetInterception(page, () => captchaPending);
        }

        return () => ({ pending: captchaPending, waitPromise: captchaWaitPromise });
    };

    if (blConfig.fastPath && savedSession && blConfig.mode === 'unblock') {
        let fastBrowser;
        try {
            console.log('[Crawler] Trying Browserless /stealth fast-path with persisted cookies...');
            fastBrowser = await puppeteer.connect({ browserWSEndpoint: blConfig.stealthWsEndpoint });
            const fastPage = await fastBrowser.newPage();
            const getState = await attachPageHandlers(fastPage);
            if (savedSession.userAgent) {
                await fastPage.setUserAgent(savedSession.userAgent);
            }
            await fastPage.setCookie(...savedSession.cookies);
            await fastPage.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
            const pageTitle = await waitForPageReady(fastPage, getState, 15000);
            return { browser: fastBrowser, page: fastPage, pageTitle };
        } catch (fastErr) {
            console.warn('[Crawler] Browserless /stealth fast-path did not clear; falling back to /unblock:', redactToken(fastErr.message));
            if (fastBrowser) {
                try { await fastBrowser.close(); } catch (e) {}
            }
        }
    }

    let browser;
    let page;
    let alreadyNavigated = false;

    if (blConfig.mode === 'unblock') {
        console.log('[Crawler] Unblocking target URL via Browserless /unblock...');
        const unblockSession = await requestUnblockSession(blConfig, targetUrl);
        console.log(`[Crawler] /unblock ready (captchaSolved=${unblockSession.solved}). Connecting Puppeteer...`);
        browser = await puppeteer.connect({ browserWSEndpoint: unblockSession.wsEndpoint });
        const pages = await browser.pages();
        page = pages.find(p => {
            try { return p.url().includes('myfxbook.com'); } catch (e) { return false; }
        }) || pages[0] || await browser.newPage();
        alreadyNavigated = Boolean(page.url() && page.url() !== 'about:blank');
    } else {
        browser = await puppeteer.connect({ browserWSEndpoint: blConfig.stealthWsEndpoint });
        page = await browser.newPage();
        if (savedSession) {
            if (savedSession.userAgent) {
                await page.setUserAgent(savedSession.userAgent);
            }
            await page.setCookie(...savedSession.cookies);
        }
    }

    const getState = await attachPageHandlers(page);
    if (!alreadyNavigated) {
        console.log('[Crawler] Loading page via Browserless...');
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    }
    const pageTitle = await waitForPageReady(page, getState, 45000);
    return { browser, page, pageTitle };
}

async function openZenRowsPage(targetUrl) {
    const zrConfig = buildZenRowsConfig();
    console.log(
        `[Crawler] Starting ZenRows fallback provider (mode=${EFFECTIVE_MODE}, ttl=${zrConfig.sessionTTL}s, country=${zrConfig.proxyCountry || 'auto'}) for ${targetUrl}...`
    );

    const browser = await puppeteer.connect({ browserWSEndpoint: zrConfig.wsEndpoint });
    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 900 });

    if (zrConfig.blockAssets) {
        await setupSafeAssetInterception(page, () => false);
    }

    console.log('[Crawler] Loading page via ZenRows Scraping Browser...');
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    const pageTitle = await waitForPageReady(page, null, 45000);
    return { browser, page, pageTitle };
}

async function runCrawlWithProvider(providerName) {
    let browser;
    try {
        let session;
        if (providerName === 'browserless') {
            session = await openBrowserlessPage(TARGET_URL);
        } else if (providerName === 'zenrows') {
            session = await openZenRowsPage(TARGET_URL);
        } else {
            throw new Error(`Unsupported crawler provider: ${providerName}`);
        }

        browser = session.browser;
        const page = session.page;
        const pageTitle = session.pageTitle;

        // Wait for document.readyState === 'complete', #csrf, and #tradingPeriodsTable so Cloudflare background JS settles
        try {
            await page.waitForFunction(() => {
                return (
                    document.readyState === 'complete' &&
                    Boolean(document.querySelector('#tradingPeriodsTable tr td')) &&
                    Boolean(document.querySelector('#csrf'))
                );
            }, { timeout: 20000 });
            await new Promise(r => setTimeout(r, 2000));
        } catch (e) {
            try {
                await page.waitForFunction(() => {
                    return (
                        document.readyState !== 'loading' &&
                        Boolean(document.querySelector('#tradingPeriodsTable tr td'))
                    );
                }, { timeout: 10000 });
                await new Promise(r => setTimeout(r, 2000));
            } catch (e2) {
                console.log('[Crawler] Timed out waiting for #csrf/#tradingPeriodsTable readiness, continuing...');
            }
        }

        const normalizeDomTrade = (raw) => ({
            open: parseMyfxbookTimestampToISO(raw.open),
            close: parseMyfxbookTimestampToISO(raw.close),
            symbol: raw.symbol,
            action: raw.action,
            lots: parseNum(raw.lots),
            open_price: parseNum(raw.open_price),
            close_price: parseNum(raw.close_price),
            pips: parseNum(raw.pips),
            profit: parseNum(raw.profit),
            duration_seconds: parseDurationToSeconds(raw.duration),
            gain_pct: parseNum(raw.gain),
            ...(raw.analytics ? { analytics: raw.analytics } : {})
        });

        // Browser-side shared parser + in-page fetch runner (Option 1)
        const fetchResult = await page.evaluate(async (needTrades) => {
            const clean = (s) => (s ? s.replace(/\s+/g, ' ').trim() : '');

            const parseTradesFromRoot = (root, rowSelector = '#tradingHistoryTable tbody tr') => {
                const trades = [];
                const trList = root.querySelectorAll(rowSelector);
                trList.forEach(tr => {
                    const tds = Array.from(tr.querySelectorAll('td')).map(td => clean(td.textContent || td.innerText));
                    if (tds.length >= 14) {
                        const openDate = tds[1];
                        const closeDate = tds[3];
                        const symbol = tds[5];
                        const action = tds[6];
                        const lots = tds[7];
                        const openPrice = tds[10];
                        const closePrice = tds[11];
                        const pips = tds[12];
                        const profit = tds[13];
                        const duration = tds[14];
                        const gain = tds[15] || '';

                        let analytics = null;
                        const sparkSpan = tr.querySelector('.inlinesparkline');
                        if (sparkSpan) {
                            const chartData = sparkSpan.getAttribute('data-chart-data') || '';
                            const rawContent = sparkSpan.getAttribute('data-content') || '';
                            if (chartData || rawContent) {
                                const content = rawContent
                                    .replace(/&quot;/g, '"')
                                    .replace(/&lt;/g, '<')
                                    .replace(/&gt;/g, '>')
                                    .replace(/&amp;/g, '&')
                                    .replace(/&#39;/g, "'");

                                const an = {};
                                if (chartData) {
                                    an.price_path = chartData.split(',').map(v => parseFloat(v.trim())).filter(n => !isNaN(n));
                                }
                                const mTime = content.match(/Time Profitable:.*?<td[^>]*>([0-9.]+)%\s*\/\s*([^<]+)<\/td>/is);
                                if (mTime) {
                                    an.time_profitable_pct = parseFloat(mTime[1]);
                                    an.time_profitable_duration = clean(mTime[2]);
                                }
                                const mDd = content.match(/Drawdown:.*?<td[^>]*>([0-9,.-]+)\s*pips<\/td>/is);
                                if (mDd) {
                                    an.drawdown_pips = parseFloat(mDd[1].replace(/,/g, ''));
                                }
                                const mRr = content.match(/Risk Reward:.*?<td[^>]*>([^<]+)<\/td>/is);
                                if (mRr) {
                                    an.risk_reward = clean(mRr[1]);
                                }
                                const mMax = content.match(/Max:.*?<td[^>]*>([0-9,.-]+)\s*pips\s*\/\s*\$?([0-9,.-]+)<\/td>/is);
                                if (mMax) {
                                    an.max_pips = parseFloat(mMax[1].replace(/,/g, ''));
                                    an.max_usd = parseFloat(mMax[2].replace(/,/g, ''));
                                }
                                const mMin = content.match(/Min:.*?<td[^>]*>([0-9,.-]+)\s*pips\s*\/\s*(-?)\$?([0-9,.-]+)<\/td>/is);
                                if (mMin) {
                                    an.min_pips = parseFloat(mMin[1].replace(/,/g, ''));
                                    const sign = mMin[2] === '-' ? -1 : 1;
                                    an.min_usd = sign * parseFloat(mMin[3].replace(/,/g, ''));
                                }
                                const mMiss = content.match(/Profit Missed.*?<td[^>]*>([0-9,.-]+)\s*pips\s*\/\s*(-?)\$?([0-9,.-]+)<\/td>/is);
                                if (mMiss) {
                                    an.profit_missed_pips = parseFloat(mMiss[1].replace(/,/g, ''));
                                    const sign = mMiss[2] === '-' ? -1 : 1;
                                    an.profit_missed_usd = sign * parseFloat(mMiss[3].replace(/,/g, ''));
                                }
                                const mEntry = content.match(/Entry Accuracy:.*?<td[^>]*>([0-9.]+)%<\/td>/is);
                                if (mEntry) {
                                    an.entry_accuracy = parseFloat(mEntry[1]);
                                }
                                const mExit = content.match(/Exit Accuracy:.*?<td[^>]*>([0-9.]+)%<\/td>/is);
                                if (mExit) {
                                    an.exit_accuracy = parseFloat(mExit[1]);
                                }
                                if (Object.keys(an).length > 0) {
                                    analytics = an;
                                }
                            }
                        }

                        if (symbol && (action === 'Buy' || action === 'Sell')) {
                            const tradeItem = {
                                open: openDate,
                                close: closeDate,
                                symbol,
                                action,
                                lots,
                                open_price: openPrice,
                                close_price: closePrice,
                                pips,
                                profit,
                                duration,
                                gain
                            };
                            if (analytics) tradeItem.analytics = analytics;
                            trades.push(tradeItem);
                        }
                    }
                });
                return trades;
            };
            window.__sonicParseTrades = parseTradesFromRoot;

            const extractDomSummary = () => {
                const general = {
                    gain: '',
                    abs_gain: '',
                    daily: '',
                    monthly: '',
                    drawdown: '',
                    balance: '',
                    equity: '',
                    highest: '',
                    profit: '',
                    interest: '',
                    deposits: '',
                    withdrawals: '',
                    trades: '',
                    profit_factor: '',
                    updated: ''
                };

                document.querySelectorAll('td, th, span, div').forEach(el => {
                    const txt = clean(el.innerText);
                    if (!txt) return;

                    const matchMetric = (key, targetProp) => {
                        if (txt === key || txt === key + ':') {
                            let next = el.nextElementSibling;
                            if (!next && el.parentElement) {
                                const siblings = Array.from(el.parentElement.children);
                                const idx = siblings.indexOf(el);
                                if (idx !== -1 && idx + 1 < siblings.length) next = siblings[idx + 1];
                            }
                            if (next && !general[targetProp]) {
                                general[targetProp] = clean(next.innerText);
                            }
                        }
                    };

                    matchMetric('Abs. Gain', 'abs_gain');
                    matchMetric('Daily', 'daily');
                    matchMetric('Monthly', 'monthly');
                    matchMetric('Drawdown', 'drawdown');
                    matchMetric('Balance', 'balance');
                    matchMetric('Equity', 'equity');
                    matchMetric('Highest', 'highest');
                    matchMetric('Profit', 'profit');
                    matchMetric('Interest', 'interest');
                    matchMetric('Deposits', 'deposits');
                    matchMetric('Withdrawals', 'withdrawals');
                    matchMetric('Trades', 'trades');
                    matchMetric('Profit Factor', 'profit_factor');
                    matchMetric('Updated', 'updated');
                    matchMetric('Last Update', 'updated');
                });

                if (!general.updated) {
                    const bodyText = document.body ? document.body.innerText : '';
                    const m = bodyText.match(/Updated:\s*([^\n\r·]+)/i);
                    if (m) {
                        general.updated = clean(m[1]);
                    }
                }

                const periods = {
                    today: { gain: '', profit: '', pips: '', win_rate: '', trades: '', lots: '' },
                    week: { gain: '', profit: '', pips: '', win_rate: '', trades: '', lots: '' },
                    month: { gain: '', profit: '', pips: '', win_rate: '', trades: '', lots: '' },
                    year: { gain: '', profit: '', pips: '', win_rate: '', trades: '', lots: '' }
                };

                const periodsTable = document.querySelector('#tradingPeriodsTable');
                if (periodsTable) {
                    periodsTable.querySelectorAll('tr').forEach(r => {
                        const cols = Array.from(r.querySelectorAll('td')).map(c => clean(c.innerText));
                        if (cols.length >= 7) {
                            const name = cols[0].toLowerCase();
                            let targetKey = null;
                            if (name.includes('today')) targetKey = 'today';
                            else if (name.includes('week')) targetKey = 'week';
                            else if (name.includes('month')) targetKey = 'month';
                            else if (name.includes('year')) targetKey = 'year';

                            if (targetKey) {
                                const parseVal = (str) => {
                                    const m = str.match(/^([^\(]+)/);
                                    return m ? m[1].trim() : str.trim();
                                };
                                periods[targetKey] = {
                                    gain: parseVal(cols[1]),
                                    profit: parseVal(cols[2]),
                                    pips: parseVal(cols[3]),
                                    win_rate: parseVal(cols[4]),
                                    trades: parseVal(cols[5]),
                                    lots: parseVal(cols[6])
                                };
                            }
                        }
                    });
                }

                return { general, periods };
            };

            const { general, periods } = extractDomSummary();
            const csrf =
                document.querySelector('#csrf')?.value ||
                document.querySelector('input[name="_csrf"]')?.value ||
                document.querySelector('meta[name="_csrf"]')?.content ||
                '';
            const oid =
                document.querySelector('#accountOid')?.value ||
                (location.pathname.match(/\/(\d+)(?:\/|$)/) || [])[1] ||
                '12076857';

            const hdrs = { 'X-Requested-With': 'XMLHttpRequest' };

            const fetchJsonWithRetry = async (url, init) => {
                for (let attempt = 0; attempt < 2; attempt++) {
                    const text = await fetch(url, init).then(r => r.text());
                    const trimmed = text.trim();
                    if (!trimmed.startsWith('<')) {
                        return JSON.parse(text);
                    }
                    if (attempt === 0) {
                        await new Promise(r => setTimeout(r, 3000));
                    }
                }
                throw new Error('Unexpected HTML/Cloudflare response from JSON endpoint');
            };

            const parseHistoryDocument = (htmlStr) => {
                const doc = new DOMParser().parseFromString(htmlStr, 'text/html');
                const trades = parseTradesFromRoot(doc);
                const sortInput = doc.querySelector('#historyTableSort');
                const sizeInput = doc.querySelector('#historySize');
                const lastPageBtn = doc.querySelector('ul.pagination [lastpage="true"], ul.pagination [lastPage="true"]');
                const pageBtns = Array.from(doc.querySelectorAll('ul.pagination a[page]'));
                const nums = pageBtns.map(b => parseInt(b.getAttribute('page'), 10)).filter(n => !isNaN(n));
                const totalPages = lastPageBtn
                    ? (parseInt(lastPageBtn.getAttribute('page'), 10) || 1)
                    : (nums.length ? Math.max(...nums) : 1);
                const sampleBtn = pageBtns.find(b => b.getAttribute('params'));
                return {
                    trades,
                    totalPages,
                    totalTrades: parseInt(sizeInput?.value || sortInput?.getAttribute('total') || '0', 10) || 0,
                    startDate: sortInput?.getAttribute('start') || '',
                    endDate: sortInput?.getAttribute('end') || '',
                    pagingParams: sampleBtn ? sampleBtn.getAttribute('params') : '',
                };
            };

            let historyMeta = null;
            let page1Trades = [];
            let fetchErrors = [];

            if (needTrades && csrf) {
                try {
                    const hJson = await fetchJsonWithRetry('/systemPageGetHistoryFirstPage.json', {
                        method: 'POST',
                        credentials: 'same-origin',
                        headers: { ...hdrs, 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
                        body: `invitation=&accountOid=${encodeURIComponent(oid)}&_csrf=${encodeURIComponent(csrf)}`
                    });
                    if (hJson && !hJson.error && hJson.content && hJson.content.history) {
                        const parsedH1 = parseHistoryDocument(hJson.content.history);
                        page1Trades = parsedH1.trades;
                        historyMeta = {
                            totalPages: parsedH1.totalPages,
                            totalTrades: parsedH1.totalTrades,
                            startDate: parsedH1.startDate,
                            endDate: parsedH1.endDate,
                            pagingParams: parsedH1.pagingParams,
                        };
                    } else {
                        fetchErrors.push('systemPageGetHistoryFirstPage returned empty/error');
                    }
                } catch (e) {
                    fetchErrors.push(`historyFirstPage: ${e.message}`);
                }
            }

            const startDt = (historyMeta && historyMeta.startDate) ? historyMeta.startDate : '2020-01-01 00:00';
            const startDay = startDt.slice(0, 10);
            const tomorrowDay = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
            const endDt = (historyMeta && historyMeta.endDate) ? historyMeta.endDate : `${tomorrowDay} 23:59`;

            const filterCommon = 'invitation=&showLots=true&showPips=false&showChange=false&showSymbolPips=false&showMain=true&magicNumbers=&symbols=&tags=&days=1,5,2,6,3,7,4&hours=0,4,8,12,16,20,1,5,9,13,17,21,2,6,10,14,18,22,3,7,11,15,19,23&buySell=0,1,6,16&yieldStart=&yieldEnd=&netProfitStart=&netProfitEnd=&takeProfitStart=&takeProfitEnd=&stopLoss=&stopLossEnd=&sizingStart=&sizingEnd=&selectedTime=1&pipsStart=&pipsEnd=';

            let growthPoints = [];
            let dailyLots = {};
            let monthlyGains = [];
            let latestGain = null;

            const readPtVal = (pt) => {
                if (Array.isArray(pt)) return typeof pt[1] === 'number' ? pt[1] : parseFloat(pt[1]) || 0;
                if (pt && typeof pt === 'object') return typeof pt.y === 'number' ? pt.y : parseFloat(pt.y) || 0;
                return typeof pt === 'number' ? pt : parseFloat(pt) || 0;
            };

            try {
                const yearStartDay = `${new Date().getUTCFullYear()}-01-01`;
                const q1 = `startDate=${encodeURIComponent(startDt)}&endDate=${encodeURIComponent(endDt)}&${filterCommon}&chartType=1&period=6&l=s&accountOid=${encodeURIComponent(oid)}`;
                const q3 = `startDate=${encodeURIComponent(yearStartDay)}&endDate=${encodeURIComponent(tomorrowDay)}&${filterCommon}&chartType=3&monthType=0&l=s&oid=${encodeURIComponent(oid)}&accountOid=${encodeURIComponent(oid)}`;

                const [c1, c3] = await Promise.all([
                    fetchJsonWithRetry(`/private/charts.json?${q1}`, { method: 'POST', credentials: 'same-origin', headers: hdrs }),
                    fetchJsonWithRetry(`/private/charts.json?${q3}`, { method: 'POST', credentials: 'same-origin', headers: hdrs }).catch(() => null)
                ]);

                if (c1 && Array.isArray(c1.categories) && Array.isArray(c1.series)) {
                    const growthSeries = c1.series.find(s => s.name === 'Growth');
                    const lotsSeries = c1.series.find(s => s.name === 'Lots');
                    if (growthSeries && Array.isArray(growthSeries.data)) {
                        growthSeries.data.forEach((pt, idx) => {
                            const cat = c1.categories[idx];
                            if (cat) growthPoints.push([cat, readPtVal(pt)]);
                        });
                        if (growthSeries.data.length > 0) {
                            latestGain = readPtVal(growthSeries.data[growthSeries.data.length - 1]);
                        }
                    }
                    if (lotsSeries && Array.isArray(lotsSeries.data)) {
                        lotsSeries.data.forEach((pt, idx) => {
                            const cat = c1.categories[idx];
                            if (cat) dailyLots[cat] = readPtVal(pt);
                        });
                    }
                }

                if (c3 && Array.isArray(c3.categories) && Array.isArray(c3.series) && c3.series[0] && Array.isArray(c3.series[0].data)) {
                    c3.series[0].data.forEach((pt, idx) => {
                        const val = Array.isArray(pt) ? pt[0] : readPtVal(pt);
                        monthlyGains.push({
                            month: c3.categories[idx] || `Month ${idx + 1}`,
                            gain: typeof val === 'number' ? val : parseFloat(val) || 0
                        });
                    });
                }
            } catch (e) {
                fetchErrors.push(`charts: ${e.message}`);
            }

            if (latestGain !== null) {
                general.gain = (latestGain >= 0 ? '+' : '') + latestGain.toFixed(2) + '%';
            }

            return {
                csrf,
                oid,
                general,
                periods,
                growthPoints,
                dailyLots,
                monthlyGains,
                historyMeta,
                page1Trades,
                fetchErrors
            };
        }, EFFECTIVE_MODE !== 'metrics');

        let extracted = {
            general: fetchResult.general,
            periods: fetchResult.periods,
            growthPoints: fetchResult.growthPoints,
            dailyLots: fetchResult.dailyLots,
            monthlyGains: fetchResult.monthlyGains
        };

        if (extracted.growthPoints.length === 0) {
            console.log(`[Crawler] Direct fetch did not yield chart points (${fetchResult.fetchErrors.join('; ') || 'empty'}); falling back to Highcharts DOM extraction...`);
            try {
                await page.waitForFunction(() => {
                    return Boolean(
                        window.Highcharts &&
                        Array.isArray(Highcharts.charts) &&
                        Highcharts.charts.some(c => c && c.series && c.series.some(s => s.name === 'Growth' && s.data && s.data.length > 0))
                    );
                }, { timeout: 25000 });
                await new Promise(r => setTimeout(r, 400));
            } catch (e) {}

            const domCharts = await page.evaluate(() => {
                let growthPoints = [];
                let dailyLots = {};
                let monthlyGains = [];
                let latestGain = null;

                if (window.Highcharts && Highcharts.charts) {
                    Highcharts.charts.forEach(chart => {
                        if (!chart || !chart.series) return;
                        if (chart.title && chart.title.textStr && chart.title.textStr.includes('Monthly Gain')) {
                            const s = chart.series[0];
                            if (s && s.data && chart.xAxis && chart.xAxis[0] && chart.xAxis[0].categories) {
                                const cats = chart.xAxis[0].categories;
                                s.data.forEach((pt, idx) => {
                                    monthlyGains.push({ month: cats[idx] || `Month ${idx + 1}`, gain: pt.y });
                                });
                            }
                        }
                        const growthSeries = chart.series.find(s => s.name === 'Growth');
                        const lotsSeries = chart.series.find(s => s.name === 'Lots');
                        if (growthSeries && chart.xAxis && chart.xAxis[0] && chart.xAxis[0].categories) {
                            const cats = chart.xAxis[0].categories;
                            growthSeries.data.forEach((pt, idx) => {
                                growthPoints.push([cats[idx], typeof pt.y === 'number' ? pt.y : 0]);
                            });
                            if (growthSeries.data.length > 0) {
                                latestGain = growthSeries.data[growthSeries.data.length - 1].y;
                            }
                            if (lotsSeries) {
                                lotsSeries.data.forEach((pt, idx) => {
                                    dailyLots[cats[idx]] = typeof pt.y === 'number' ? pt.y : 0;
                                });
                            }
                        }
                    });
                }
                return { growthPoints, dailyLots, monthlyGains, latestGain };
            });

            if (domCharts.growthPoints.length > 0) {
                extracted.growthPoints = domCharts.growthPoints;
                extracted.dailyLots = domCharts.dailyLots;
                extracted.monthlyGains = domCharts.monthlyGains;
                if (domCharts.latestGain !== null) {
                    extracted.general.gain = (domCharts.latestGain >= 0 ? '+' : '') + domCharts.latestGain.toFixed(2) + '%';
                }
            }
        } else {
            console.log(`[Crawler] Direct fetch extracted ${extracted.growthPoints.length} growth points and ${extracted.monthlyGains.length} monthly gain entries.`);
        }

        // Sanity guard: if neither metrics nor growth points were extracted, abort without overwriting cache
        if (!extracted.general.balance && extracted.growthPoints.length === 0) {
            throw new Error(`No metrics or chart data extracted (title: "${pageTitle}"). Preserving existing cache.`);
        }

        const expectedTotalTrades = (fetchResult.historyMeta && fetchResult.historyMeta.totalTrades)
            || parseInt(String(extracted.general.trades || '').replace(/[^0-9]/g, ''), 10)
            || 0;
        let allTrades = [];
        let crawledAllPages = false;
        let actualCrawlMode = EFFECTIVE_MODE;

        const countNewAndOverlap = (pageTrades) => {
            let newInPage = 0;
            let overlapInPage = 0;
            for (const t of pageTrades) {
                if (existingTradeKeys.has(makeTradeKey(t))) {
                    overlapInPage++;
                } else {
                    newInPage++;
                }
            }
            return { newInPage, overlapInPage };
        };

        // #historySize includes non-Buy/Sell balance rows (deposits/withdrawals), so allow a small margin when a prior full crawl exists
        const gapTolerance = (existing && existing.last_full_crawl_utc && existingTradeKeys.size > 0) ? 25 : 0;
        const hasMissingTradeGap = (totalNew) => expectedTotalTrades > 0 && (existingTradeKeys.size + totalNew + gapTolerance) < expectedTotalTrades;

        if (EFFECTIVE_MODE === 'metrics') {
            console.log('[Crawler] Metrics-only mode: skipping closed trade history.');
        } else if (fetchResult.page1Trades.length > 0 && fetchResult.historyMeta) {
            const page1Trades = fetchResult.page1Trades.map(normalizeDomTrade);
            allTrades.push(...page1Trades);
            const totalPages = fetchResult.historyMeta.totalPages || 1;
            console.log(`[Crawler] Direct fetch Page 1 trades: ${page1Trades.length} (total pages: ${totalPages}, expected: ${expectedTotalTrades || 'unknown'})`);

            let totalNewTrades = 0;
            const p1Stats = countNewAndOverlap(page1Trades);
            totalNewTrades += p1Stats.newInPage;

            const hasHistoricalGap = hasMissingTradeGap(totalNewTrades);
            if (EFFECTIVE_MODE === 'partial' && hasHistoricalGap) {
                console.log(`[Crawler] Gap detected (cached ${existingTradeKeys.size} + ${totalNewTrades} new < expected ${expectedTotalTrades}); escalating to full crawl.`);
                actualCrawlMode = 'full';
            }

            const shouldStopPartial = (
                actualCrawlMode === 'partial' &&
                totalPages > 1 &&
                p1Stats.overlapInPage > 0 &&
                !hasHistoricalGap
            );

            if (shouldStopPartial) {
                console.log(`[Crawler] Partial crawl complete on Page 1 (${p1Stats.newInPage} new, ${p1Stats.overlapInPage} known). Skipping ${totalPages - 1} historical pages.`);
            } else if (totalPages > 1 && fetchResult.historyMeta.pagingParams) {
                const maxPagesToCrawl = Math.min(totalPages, 50);
                let stoppedEarly = false;
                for (let p = 2; p <= maxPagesToCrawl; p++) {
                    const sp = new URLSearchParams(fetchResult.historyMeta.pagingParams.replace(/^\?/, ''));
                    sp.set('p', String(p));
                    if (fetchResult.csrf) sp.set('_csrf', fetchResult.csrf);
                    const pagingUrl = `/paging.html?${sp.toString()}`;

                    const rawPageTrades = await page.evaluate(async (url) => {
                        const res = await fetch(url, {
                            credentials: 'same-origin',
                            headers: { 'X-Requested-With': 'XMLHttpRequest' }
                        });
                        const text = await res.text();
                        let htmlStr = text;
                        if (text.trim().startsWith('{')) {
                            try {
                                const j = JSON.parse(text);
                                htmlStr = (j.content && (j.content.history || j.content)) || text;
                            } catch (e) {}
                        }
                        const doc = new DOMParser().parseFromString(htmlStr, 'text/html');
                        return window.__sonicParseTrades(doc, '#tradingHistoryTable tbody tr, tr');
                    }, pagingUrl);

                    const pageTrades = rawPageTrades.map(normalizeDomTrade);
                    if (pageTrades.length === 0) {
                        console.log(`[Crawler] Stop fetch pagination: 0 trades returned at page ${p}`);
                        stoppedEarly = true;
                        break;
                    }
                    allTrades.push(...pageTrades);

                    const pStats = countNewAndOverlap(pageTrades);
                    totalNewTrades += pStats.newInPage;
                    const stillHasGap = hasMissingTradeGap(totalNewTrades);
                    if (actualCrawlMode === 'partial' && pStats.overlapInPage > 0 && !stillHasGap) {
                        console.log(`[Crawler] Partial crawl reached cached overlap on page ${p} (+${totalNewTrades} new trades). Stopping early.`);
                        stoppedEarly = true;
                        break;
                    }
                }
                if (!stoppedEarly && totalPages <= 50) {
                    crawledAllPages = true;
                }
                console.log(`[Crawler] Total trades fetched (${actualCrawlMode}): ${allTrades.length} across ${totalPages} available pages.`);
            }
        } else {
            // 4b. Fallback: Closed Trades History Extraction via DOM tab clicks
            console.log(`[Crawler] Switching to history tab (DOM fallback, mode=${EFFECTIVE_MODE}, expected=${expectedTotalTrades || 'unknown'})...`);
            const activateHistoryTab = async () => {
                await page.evaluate(() => {
                    const historyTab = document.querySelector('a[href="#historyCont"]');
                    if (historyTab) historyTab.click();
                    const lenSel = document.querySelector('#historyCont select, select[name*="historyTable_length"], select[name="history_length"]');
                    if (lenSel) {
                        lenSel.value = '100';
                        lenSel.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                });
            };

            await activateHistoryTab();

            const waitForHistoryRows = (timeoutMs) => page.waitForFunction(() => {
                return document.querySelectorAll('#historyCont #tradingHistoryTable tbody tr').length > 0;
            }, { timeout: timeoutMs });

            try {
                try {
                    await waitForHistoryRows(10000);
                } catch (firstErr) {
                    console.log('[Crawler] Retrying history tab activation...');
                    await activateHistoryTab();
                    await waitForHistoryRows(15000);
                }
                await new Promise(r => setTimeout(r, 350));
            } catch (e) {
                console.log('[Crawler] Timed out waiting for #tradingHistoryTable rows.');
            }

            const extractTradesFromDOM = () => window.__sonicParseTrades(document, '#historyCont #tradingHistoryTable tbody tr');

            const page1Trades = (await page.evaluate(extractTradesFromDOM)).map(normalizeDomTrade);
            allTrades.push(...page1Trades);
            console.log(`[Crawler] Page 1 trades: ${page1Trades.length}`);

            const totalPages = await page.evaluate(() => {
                const lastPageBtn = document.querySelector('#historyCont ul.pagination [lastpage="true"]');
                if (lastPageBtn) return parseInt(lastPageBtn.getAttribute('page'), 10);
                const pageBtns = Array.from(document.querySelectorAll('#historyCont ul.pagination a[page]'));
                const nums = pageBtns.map(b => parseInt(b.getAttribute('page'), 10)).filter(n => !isNaN(n));
                return nums.length ? Math.max(...nums) : 1;
            });

            console.log(`[Crawler] Total trade pages detected: ${totalPages}`);

            let totalNewTrades = 0;
            const p1Stats = countNewAndOverlap(page1Trades);
            totalNewTrades += p1Stats.newInPage;

            const hasHistoricalGap = hasMissingTradeGap(totalNewTrades);
            if (EFFECTIVE_MODE === 'partial' && hasHistoricalGap) {
                console.log(`[Crawler] Gap detected (cached ${existingTradeKeys.size} + ${totalNewTrades} new < expected ${expectedTotalTrades}); escalating to full crawl.`);
                actualCrawlMode = 'full';
            }

            let shouldStopPartial = (
                actualCrawlMode === 'partial' &&
                totalPages > 1 &&
                p1Stats.overlapInPage > 0 &&
                !hasHistoricalGap
            );

            if (shouldStopPartial) {
                console.log(`[Crawler] Partial crawl complete on Page 1 (${p1Stats.newInPage} new, ${p1Stats.overlapInPage} known). Skipping ${totalPages - 1} historical pages.`);
            } else {
                const maxPagesToCrawl = Math.min(totalPages, 50);
                let stoppedEarly = false;
                for (let p = 2; p <= maxPagesToCrawl; p++) {
                    const prevFirstRowText = await page.evaluate(() => {
                        const row = document.querySelector('#historyCont #tradingHistoryTable tbody tr');
                        return row ? row.innerText.trim() : '';
                    });

                    const clicked = await page.evaluate((targetPage) => {
                        const btn = document.querySelector(`#historyCont ul.pagination a[page="${targetPage}"]`);
                        if (btn) {
                            btn.click();
                            return true;
                        }
                        const nextBtn = document.querySelector('#historyCont ul.pagination li.next:not(.disabled) a');
                        if (nextBtn) {
                            nextBtn.click();
                            return true;
                        }
                        return false;
                    }, p);

                    if (!clicked) {
                        console.log(`[Crawler] Stop pagination: button not found at page ${p}`);
                        stoppedEarly = true;
                        break;
                    }

                    try {
                        await page.waitForFunction((prevText, targetPage) => {
                            const row = document.querySelector('#historyCont #tradingHistoryTable tbody tr');
                            const curText = row ? row.innerText.trim() : '';
                            const active = document.querySelector('#historyCont ul.pagination li.active a[page]');
                            const activePage = active ? parseInt(active.getAttribute('page'), 10) : 0;
                            return (curText && curText !== prevText) || activePage === targetPage;
                        }, { timeout: 6000 }, prevFirstRowText, p);
                        await new Promise(r => setTimeout(r, 200));
                    } catch (e) {
                        await new Promise(r => setTimeout(r, 600));
                    }

                    const pageTrades = (await page.evaluate(extractTradesFromDOM)).map(normalizeDomTrade);
                    allTrades.push(...pageTrades);

                    const pStats = countNewAndOverlap(pageTrades);
                    totalNewTrades += pStats.newInPage;
                    const stillHasGap = hasMissingTradeGap(totalNewTrades);
                    if (actualCrawlMode === 'partial' && pStats.overlapInPage > 0 && !stillHasGap) {
                        console.log(`[Crawler] Partial crawl reached cached overlap on page ${p} (+${totalNewTrades} new trades). Stopping early.`);
                        stoppedEarly = true;
                        break;
                    }
                }
                if (!stoppedEarly && totalPages <= 50) {
                    crawledAllPages = true;
                }
                console.log(`[Crawler] Total trades crawled (${actualCrawlMode}): ${allTrades.length} across ${totalPages} available pages.`);
            }
        }

        if (EFFECTIVE_MODE !== 'metrics' && allTrades.length === 0) {
            throw new Error(`No trades extracted in ${actualCrawlMode} mode; preserving existing cache.`);
        }

        if (extracted.growthPoints.length === 0 && allTrades.length === 0) {
            throw new Error(`Incomplete JS load (0 growth points and 0 trades extracted via ${providerName}). Preserving existing cache.`);
        }

        await saveSessionState(page);
        finalizeAndWriteCache({ providerName, extracted, allTrades, actualCrawlMode, crawledAllPages });
    } finally {
        if (browser) {
            try {
                await browser.close();
            } catch (e) {}
        }
    }
}

function finalizeAndWriteCache({ providerName, extracted, allTrades, actualCrawlMode, crawledAllPages }) {
    // Date helper: convert Myfxbook category "Nov 03, '24" to ISO "2024-11-03"
    function catToISO(cat) {
        if (!cat) return null;
        // Format: "Nov 03, '24" or "Nov 03, 2024"
        const m = cat.match(/([A-Za-z]+)\s+(\d+),\s*'?(\d+)/);
        if (!m) return cat;
        const mon = MONTH_MAP[m[1]] || '01';
        const day = m[2].padStart(2, '0');
        let yr = m[3];
        if (yr.length === 2) yr = '20' + yr;
        return `${yr}-${mon}-${day}`;
    }

    const normalizedGrowth = extracted.growthPoints.map(([cat, val]) => ({
        date: catToISO(cat),
        gain_pct: typeof val === 'number' ? val : parseNum(val)
    }));
    const normalizedLots = {};
    for (const [k, v] of Object.entries(extracted.dailyLots)) {
        normalizedLots[catToISO(k)] = typeof v === 'number' ? v : parseNum(v);
    }

    // Merge newly crawled trades with existing historical trades so all trades accumulate
    let mergedTrades = allTrades;
    if (existing && Array.isArray(existing.trades)) {
        const tradeMap = new Map();
        allTrades.forEach(t => {
            tradeMap.set(makeTradeKey(t), t);
        });
        existing.trades.forEach(t => {
            const key = makeTradeKey(t);
            if (!tradeMap.has(key)) {
                tradeMap.set(key, t);
            } else if (!tradeMap.get(key).analytics && t.analytics) {
                tradeMap.get(key).analytics = t.analytics;
            }
        });
        mergedTrades = Array.from(tradeMap.values());
    }

    // Always sort trades strictly descending by ISO close/open timestamp (newest first)
    mergedTrades.sort((a, b) => Date.parse(b.close || b.open || 0) - Date.parse(a.close || a.open || 0));

    // Safety fallback: NEVER overwrite valid existing growth curve or stats with empty arrays!
    const finalGrowth = (normalizedGrowth && normalizedGrowth.length >= 20)
        ? normalizedGrowth
        : (existing && existing.growth && existing.growth.length > 0 ? existing.growth : normalizedGrowth);

    const finalLots = (normalizedLots && Object.keys(normalizedLots).length > 0)
        ? { days: normalizedLots }
        : (existing && existing.lots ? existing.lots : { days: {} });

    // Reconcile/extend growth curve and daily lots with latest trades if Highcharts lag
    const growthDateSet = new Set(finalGrowth.map(p => p.date));
    const tradesByDay = new Map();
    mergedTrades.forEach(t => {
        const iso = String(t.close || t.open || '').slice(0, 10);
        if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
            if (!tradesByDay.has(iso)) tradesByDay.set(iso, { lots: 0, gain: 0, count: 0 });
            const rec = tradesByDay.get(iso);
            rec.count++;
            rec.lots = parseFloat((rec.lots + (Number(t.lots) || 0)).toFixed(2));
            rec.gain = parseFloat((rec.gain + (Number(t.gain_pct) || 0)).toFixed(4));
        }
    });

    // Ensure lots contains all trading days
    for (const [day, stats] of tradesByDay.entries()) {
        if (finalLots.days[day] === undefined && stats.lots > 0) {
            finalLots.days[day] = stats.lots;
        }
    }

    // Ensure growth points exist for days with trades beyond the last Highcharts growth point
    if (finalGrowth.length > 0) {
        const lastPoint = finalGrowth[finalGrowth.length - 1];
        const lastDate = lastPoint.date;
        let currentCumGain = lastPoint.gain_pct;

        const sortedTradeDays = Array.from(tradesByDay.keys()).sort();
        sortedTradeDays.forEach(day => {
            if (day > lastDate && !growthDateSet.has(day)) {
                const stats = tradesByDay.get(day);
                currentCumGain = parseFloat((currentCumGain + stats.gain).toFixed(2));
                finalGrowth.push({ date: day, gain_pct: currentCumGain });
                growthDateSet.add(day);
                console.log(`[Crawler] Extended growth curve for ${day}: +${stats.gain}% -> ${currentCumGain}% (Lots: ${stats.lots})`);
            }
        });
    }

    const now = new Date();
    const rawG = extracted.general;
    const eqParsed = parseEquity(rawG.equity);
    const hiParsed = parseHighest(rawG.highest, now);
    const fallbackGeneral = existing && existing.general ? existing.general : null;

    const normalizePeriod = (p, prev) => {
        if (!p || !p.gain || p.gain === '-') {
            return prev || { gain_pct: 0, profit: 0, pips: 0, win_rate_pct: 0, trades: 0, lots: 0 };
        }
        return {
            gain_pct: parseNum(p.gain),
            profit: parseNum(p.profit),
            pips: parseNum(p.pips),
            win_rate_pct: parseNum(p.win_rate),
            trades: parseInt(String(p.trades || '0').replace(/[^0-9-]/g, ''), 10) || 0,
            lots: parseNum(p.lots)
        };
    };

    const finalPeriods = {
        today: normalizePeriod(extracted.periods.today, fallbackGeneral && existing.periods && existing.periods.today),
        week: normalizePeriod(extracted.periods.week, fallbackGeneral && existing.periods && existing.periods.week),
        month: normalizePeriod(extracted.periods.month, fallbackGeneral && existing.periods && existing.periods.month),
        year: normalizePeriod(extracted.periods.year, fallbackGeneral && existing.periods && existing.periods.year)
    };

    const parsedBalance = parseNum(rawG.balance);
    const finalGeneral = (parsedBalance <= 0 && fallbackGeneral) ? { ...fallbackGeneral } : {
        gain_pct: finalGrowth.length > 0 ? finalGrowth[finalGrowth.length - 1].gain_pct : parseNum(rawG.gain),
        abs_gain_pct: parseNum(rawG.abs_gain),
        daily_pct: rawG.daily ? parseNum(rawG.daily) : finalPeriods.today.gain_pct,
        monthly_pct: rawG.monthly ? parseNum(rawG.monthly) : finalPeriods.month.gain_pct,
        drawdown_pct: parseNum(rawG.drawdown),
        balance: parsedBalance,
        equity: eqParsed.equity,
        equity_pct: eqParsed.equity_pct,
        highest: hiParsed.highest,
        ...(hiParsed.highest_date ? { highest_date: hiParsed.highest_date } : {}),
        profit: parseNum(rawG.profit),
        interest: parseNum(rawG.interest),
        deposits: parseNum(rawG.deposits),
        withdrawals: parseNum(rawG.withdrawals),
        trades: mergedTrades.length > 0 ? mergedTrades.length : (parseInt(String(rawG.trades || '0').replace(/[^0-9]/g, ''), 10) || 0),
        profit_factor: parseNum(rawG.profit_factor),
        updated_at: parseUpdatedAt(rawG.updated, now)
    };

    const finalMonthlyGain = (extracted.monthlyGains && extracted.monthlyGains.length > 0)
        ? extracted.monthlyGains.map(m => ({ month: monthToISO(m.month), gain: Number(m.gain) || 0 }))
        : (existing && existing.monthly_gain ? existing.monthly_gain : []);

    const isFullCompleted = actualCrawlMode === 'full' && (crawledAllPages || allTrades.length > 0);
    const lastFullCrawlUtc = isFullCompleted
        ? now.toISOString()
        : (existing && existing.last_full_crawl_utc ? existing.last_full_crawl_utc : undefined);

    const finalData = {
        schema_version: 3,
        account_name: 'SONIC AI',
        account_id: '12076857',
        source: TARGET_URL,
        fetched_utc: now.toISOString(),
        last_crawl_mode: actualCrawlMode,
        ...(lastFullCrawlUtc ? { last_full_crawl_utc: lastFullCrawlUtc } : {}),
        general: finalGeneral,
        periods: finalPeriods,
        growth: finalGrowth,
        monthly_gain: finalMonthlyGain,
        lots: finalLots,
        trades: mergedTrades,
        trades_count: mergedTrades.length,
        growth_count: finalGrowth.length
    };

    fs.writeFileSync(OUT_FILE, JSON.stringify(finalData, null, 2), 'utf-8');
    try {
        fs.writeFileSync(OUT_FILE + '.backup.json', JSON.stringify(finalData, null, 2), 'utf-8');
    } catch (e) {}

    console.log(`[Crawler] Successfully wrote cache via ${providerName} to ${OUT_FILE}`);
    console.log(`[Crawler] Stats: ${finalData.growth_count} growth points, ${finalData.trades_count} total accumulated history trades.`);
}

function invokeTlsFetchBatch({ userAgent, baseUrl, profile, cookies, requests }) {
    const payload = JSON.stringify({ userAgent, baseUrl, profile, cookies, requests });
    const configuredBin = (process.env.SONIC_TLS_FETCH_BIN || '').trim();
    const defaultBin = path.join(__dirname, '../sonic-server');
    let stdout;
    if (configuredBin && fs.existsSync(configuredBin)) {
        stdout = execFileSync(configuredBin, ['-tls-fetch'], { input: payload, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    } else if (fs.existsSync(defaultBin)) {
        stdout = execFileSync(defaultBin, ['-tls-fetch'], { input: payload, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    } else {
        stdout = execFileSync('go', ['run', './cmd/server', '-tls-fetch'], {
            cwd: path.join(__dirname, '..'),
            input: payload,
            encoding: 'utf8',
            maxBuffer: 32 * 1024 * 1024
        });
    }
    const parsed = JSON.parse(stdout);
    return parsed.responses || [];
}

function parseTradesFromNodeDocument(doc, rowSelector = '#tradingHistoryTable tbody tr') {
    const clean = (s) => (s ? s.replace(/\s+/g, ' ').trim() : '');
    const trades = [];
    doc.querySelectorAll(rowSelector).forEach(tr => {
        const tds = Array.from(tr.querySelectorAll('td')).map(td => clean(td.textContent));
        if (tds.length >= 14) {
            const symbol = tds[5];
            const action = tds[6];
            if (symbol && (action === 'Buy' || action === 'Sell')) {
                let analytics = null;
                const sparkSpan = tr.querySelector('.inlinesparkline');
                if (sparkSpan) {
                    const chartData = sparkSpan.getAttribute('data-chart-data') || '';
                    const rawContent = sparkSpan.getAttribute('data-content') || '';
                    if (chartData || rawContent) {
                        const content = rawContent.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/&#39;/g, "'");
                        const an = {};
                        if (chartData) an.price_path = chartData.split(',').map(v => parseFloat(v.trim())).filter(n => !isNaN(n));
                        const mTime = content.match(/Time Profitable:.*?<td[^>]*>([0-9.]+)%\s*\/\s*([^<]+)<\/td>/is);
                        if (mTime) { an.time_profitable_pct = parseFloat(mTime[1]); an.time_profitable_duration = clean(mTime[2]); }
                        const mDd = content.match(/Drawdown:.*?<td[^>]*>([0-9,.-]+)\s*pips<\/td>/is);
                        if (mDd) an.drawdown_pips = parseFloat(mDd[1].replace(/,/g, ''));
                        const mRr = content.match(/Risk Reward:.*?<td[^>]*>([^<]+)<\/td>/is);
                        if (mRr) an.risk_reward = clean(mRr[1]);
                        const mMax = content.match(/Max:.*?<td[^>]*>([0-9,.-]+)\s*pips\s*\/\s*\$?([0-9,.-]+)<\/td>/is);
                        if (mMax) { an.max_pips = parseFloat(mMax[1].replace(/,/g, '')); an.max_usd = parseFloat(mMax[2].replace(/,/g, '')); }
                        const mMin = content.match(/Min:.*?<td[^>]*>([0-9,.-]+)\s*pips\s*\/\s*(-?)\$?([0-9,.-]+)<\/td>/is);
                        if (mMin) { an.min_pips = parseFloat(mMin[1].replace(/,/g, '')); an.min_usd = (mMin[2] === '-' ? -1 : 1) * parseFloat(mMin[3].replace(/,/g, '')); }
                        const mMiss = content.match(/Profit Missed.*?<td[^>]*>([0-9,.-]+)\s*pips\s*\/\s*(-?)\$?([0-9,.-]+)<\/td>/is);
                        if (mMiss) { an.profit_missed_pips = parseFloat(mMiss[1].replace(/,/g, '')); an.profit_missed_usd = (mMiss[2] === '-' ? -1 : 1) * parseFloat(mMiss[3].replace(/,/g, '')); }
                        const mEntry = content.match(/Entry Accuracy:.*?<td[^>]*>([0-9.]+)%<\/td>/is);
                        if (mEntry) an.entry_accuracy = parseFloat(mEntry[1]);
                        const mExit = content.match(/Exit Accuracy:.*?<td[^>]*>([0-9.]+)%<\/td>/is);
                        if (mExit) an.exit_accuracy = parseFloat(mExit[1]);
                        if (Object.keys(an).length > 0) analytics = an;
                    }
                }
                const tradeItem = {
                    open: parseMyfxbookTimestampToISO(tds[1]),
                    close: parseMyfxbookTimestampToISO(tds[3]),
                    symbol,
                    action,
                    lots: parseNum(tds[7]),
                    open_price: parseNum(tds[10]),
                    close_price: parseNum(tds[11]),
                    pips: parseNum(tds[12]),
                    profit: parseNum(tds[13]),
                    duration_seconds: parseDurationToSeconds(tds[14]),
                    gain_pct: parseNum(tds[15] || '')
                };
                if (analytics) tradeItem.analytics = analytics;
                trades.push(tradeItem);
            }
        }
    });
    return trades;
}

function parseSummaryFromNodeDocument(doc) {
    const clean = (s) => (s ? s.replace(/\s+/g, ' ').trim() : '');
    const general = {
        gain: '', abs_gain: '', daily: '', monthly: '', drawdown: '',
        balance: '', equity: '', highest: '', profit: '', interest: '',
        deposits: '', withdrawals: '', trades: '', profit_factor: '', updated: ''
    };
    doc.querySelectorAll('td, th, span, div').forEach(el => {
        const txt = clean(el.textContent);
        if (!txt) return;
        const matchMetric = (key, targetProp) => {
            if (txt === key || txt === key + ':') {
                let next = el.nextElementSibling;
                if (!next && el.parentElement) {
                    const siblings = Array.from(el.parentElement.children);
                    const idx = siblings.indexOf(el);
                    if (idx !== -1 && idx + 1 < siblings.length) next = siblings[idx + 1];
                }
                if (next && !general[targetProp]) {
                    general[targetProp] = clean(next.textContent);
                }
            }
        };
        matchMetric('Abs. Gain', 'abs_gain');
        matchMetric('Daily', 'daily');
        matchMetric('Monthly', 'monthly');
        matchMetric('Drawdown', 'drawdown');
        matchMetric('Balance', 'balance');
        matchMetric('Equity', 'equity');
        matchMetric('Highest', 'highest');
        matchMetric('Profit', 'profit');
        matchMetric('Interest', 'interest');
        matchMetric('Deposits', 'deposits');
        matchMetric('Withdrawals', 'withdrawals');
        matchMetric('Trades', 'trades');
        matchMetric('Profit Factor', 'profit_factor');
        matchMetric('Updated', 'updated');
        matchMetric('Last Update', 'updated');
    });

    if (!general.updated) {
        const bodyText = doc.body ? doc.body.textContent : '';
        const m = bodyText.match(/Updated:\s*([^\n\r·]+)/i);
        if (m) general.updated = clean(m[1]);
    }

    const periods = {
        today: { gain: '', profit: '', pips: '', win_rate: '', trades: '', lots: '' },
        week: { gain: '', profit: '', pips: '', win_rate: '', trades: '', lots: '' },
        month: { gain: '', profit: '', pips: '', win_rate: '', trades: '', lots: '' },
        year: { gain: '', profit: '', pips: '', win_rate: '', trades: '', lots: '' }
    };

    const periodsTable = doc.querySelector('#tradingPeriodsTable');
    if (periodsTable) {
        periodsTable.querySelectorAll('tr').forEach(r => {
            const cols = Array.from(r.querySelectorAll('td')).map(c => clean(c.textContent));
            if (cols.length >= 7) {
                const name = cols[0].toLowerCase();
                let targetKey = null;
                if (name.includes('today')) targetKey = 'today';
                else if (name.includes('week')) targetKey = 'week';
                else if (name.includes('month')) targetKey = 'month';
                else if (name.includes('year')) targetKey = 'year';
                if (targetKey) {
                    const parseVal = (str) => {
                        const m = str.match(/^([^\(]+)/);
                        return m ? m[1].trim() : str.trim();
                    };
                    periods[targetKey] = {
                        gain: parseVal(cols[1]), profit: parseVal(cols[2]), pips: parseVal(cols[3]),
                        win_rate: parseVal(cols[4]), trades: parseVal(cols[5]), lots: parseVal(cols[6])
                    };
                }
            }
        });
    }

    return { general, periods };
}

async function runCrawlWithByparr() {
    const byparrUrl = (process.env.BYPARR_URL || 'http://127.0.0.1:8191/v1').trim();
    const maxTimeout = Math.min(Math.max(parseInt(process.env.BYPARR_TIMEOUT_MS || '60000', 10) || 60000, 10000), 120000);
    console.log(`[Crawler] Starting Byparr + tls-client provider (mode=${EFFECTIVE_MODE}, endpoint=${byparrUrl}) for ${TARGET_URL}...`);

    const byparrRes = await fetch(byparrUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            cmd: 'request.get',
            url: TARGET_URL,
            maxTimeout
        }),
        signal: AbortSignal.timeout(maxTimeout + 15000)
    });

    if (!byparrRes.ok) {
        const errBody = await byparrRes.text().catch(() => '');
        throw new Error(`Byparr returned HTTP ${byparrRes.status}: ${errBody.slice(0, 200)}`);
    }

    const byparrJson = await byparrRes.json();
    if (!byparrJson || byparrJson.status !== 'ok' || !byparrJson.solution || !byparrJson.solution.response) {
        throw new Error(`Byparr failed: ${byparrJson && byparrJson.message ? byparrJson.message : 'missing solution'}`);
    }

    const sol = byparrJson.solution;
    const { document: doc } = parseHTML(sol.response);
    const titleEl = doc.querySelector('title');
    const titleRegexMatch = sol.response.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const pageTitle = ((doc.title || (titleEl && titleEl.textContent) || (titleRegexMatch && titleRegexMatch[1]) || '')).trim();
    console.log(`[Crawler] Byparr page title: "${pageTitle}" (cookies=${(sol.cookies || []).length})`);

    if (!pageTitle || isCloudflareTitle(pageTitle)) {
        throw new Error(`Byparr did not clear Cloudflare ("${pageTitle || 'empty title'}").`);
    }

    const { general, periods } = parseSummaryFromNodeDocument(doc);
    const csrf =
        (doc.querySelector('#csrf') && doc.querySelector('#csrf').getAttribute('value')) ||
        (doc.querySelector('input[name="_csrf"]') && doc.querySelector('input[name="_csrf"]').getAttribute('value')) ||
        (doc.querySelector('meta[name="_csrf"]') && doc.querySelector('meta[name="_csrf"]').getAttribute('content')) ||
        '';
    const oid =
        (doc.querySelector('#accountOid') && doc.querySelector('#accountOid').getAttribute('value')) ||
        (TARGET_URL.match(/\/(\d+)(?:\/|$)/) || [])[1] ||
        '12076857';

    const originUrl = new URL(TARGET_URL).origin;
    const tlsHeaders = {
        'X-Requested-With': 'XMLHttpRequest',
        'Referer': TARGET_URL,
        'Origin': originUrl,
    };

    let historyMeta = null;
    let page1Trades = [];
    if (EFFECTIVE_MODE !== 'metrics' && csrf) {
        const [hResp] = invokeTlsFetchBatch({
            userAgent: sol.userAgent || '',
            baseUrl: originUrl + '/',
            profile: 'firefox',
            cookies: sol.cookies || [],
            requests: [{
                method: 'POST',
                url: `${originUrl}/systemPageGetHistoryFirstPage.json`,
                headers: { ...tlsHeaders, 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
                body: `invitation=&accountOid=${encodeURIComponent(oid)}&_csrf=${encodeURIComponent(csrf)}`
            }]
        });
        if (!hResp || hResp.error || hResp.status >= 400 || (hResp.body || '').trim().startsWith('<')) {
            throw new Error(`tls-client history request failed (status=${hResp && hResp.status}, err=${(hResp && hResp.error) || 'HTML/Cloudflare'})`);
        }
        const hJson = JSON.parse(hResp.body);
        if (hJson && !hJson.error && hJson.content && hJson.content.history) {
            const { document: hDoc } = parseHTML(hJson.content.history);
            page1Trades = parseTradesFromNodeDocument(hDoc, '#tradingHistoryTable tbody tr');
            const sortInput = hDoc.querySelector('#historyTableSort');
            const sizeInput = hDoc.querySelector('#historySize');
            const lastPageBtn = hDoc.querySelector('ul.pagination [lastpage="true"], ul.pagination [lastPage="true"]');
            const pageBtns = Array.from(hDoc.querySelectorAll('ul.pagination a[page]'));
            const nums = pageBtns.map(b => parseInt(b.getAttribute('page'), 10)).filter(n => !isNaN(n));
            const totalPages = lastPageBtn
                ? (parseInt(lastPageBtn.getAttribute('page'), 10) || 1)
                : (nums.length ? Math.max(...nums) : 1);
            const sampleBtn = pageBtns.find(b => b.getAttribute('params'));
            historyMeta = {
                totalPages,
                totalTrades: parseInt((sizeInput && sizeInput.getAttribute('value')) || (sortInput && sortInput.getAttribute('total')) || '0', 10) || 0,
                startDate: (sortInput && sortInput.getAttribute('start')) || '',
                endDate: (sortInput && sortInput.getAttribute('end')) || '',
                pagingParams: sampleBtn ? sampleBtn.getAttribute('params') : '',
            };
        }
    }

    const startDt = (historyMeta && historyMeta.startDate) ? historyMeta.startDate : '2020-01-01 00:00';
    const tomorrowDay = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
    const endDt = (historyMeta && historyMeta.endDate) ? historyMeta.endDate : `${tomorrowDay} 23:59`;
    const yearStartDay = `${new Date().getUTCFullYear()}-01-01`;
    const filterCommon = 'invitation=&showLots=true&showPips=false&showChange=false&showSymbolPips=false&showMain=true&magicNumbers=&symbols=&tags=&days=1,5,2,6,3,7,4&hours=0,4,8,12,16,20,1,5,9,13,17,21,2,6,10,14,18,22,3,7,11,15,19,23&buySell=0,1,6,16&yieldStart=&yieldEnd=&netProfitStart=&netProfitEnd=&takeProfitStart=&takeProfitEnd=&stopLoss=&stopLossEnd=&sizingStart=&sizingEnd=&selectedTime=1&pipsStart=&pipsEnd=';
    const q1 = `startDate=${encodeURIComponent(startDt)}&endDate=${encodeURIComponent(endDt)}&${filterCommon}&chartType=1&period=6&l=s&accountOid=${encodeURIComponent(oid)}`;
    const q3 = `startDate=${encodeURIComponent(yearStartDay)}&endDate=${encodeURIComponent(tomorrowDay)}&${filterCommon}&chartType=3&monthType=0&l=s&oid=${encodeURIComponent(oid)}&accountOid=${encodeURIComponent(oid)}`;

    const [c1Resp, c3Resp] = invokeTlsFetchBatch({
        userAgent: sol.userAgent || '',
        baseUrl: originUrl + '/',
        profile: 'firefox',
        cookies: sol.cookies || [],
        requests: [
            { method: 'POST', url: `${originUrl}/private/charts.json?${q1}`, headers: tlsHeaders },
            { method: 'POST', url: `${originUrl}/private/charts.json?${q3}`, headers: tlsHeaders },
        ]
    });

    const readPtVal = (pt) => {
        if (Array.isArray(pt)) return typeof pt[1] === 'number' ? pt[1] : parseFloat(pt[1]) || 0;
        if (pt && typeof pt === 'object') return typeof pt.y === 'number' ? pt.y : parseFloat(pt.y) || 0;
        return typeof pt === 'number' ? pt : parseFloat(pt) || 0;
    };

    let growthPoints = [];
    let dailyLots = {};
    let monthlyGains = [];
    let latestGain = null;

    if (c1Resp && !c1Resp.error && c1Resp.status < 400 && !(c1Resp.body || '').trim().startsWith('<')) {
        const c1 = JSON.parse(c1Resp.body);
        if (c1 && Array.isArray(c1.categories) && Array.isArray(c1.series)) {
            const growthSeries = c1.series.find(s => s.name === 'Growth');
            const lotsSeries = c1.series.find(s => s.name === 'Lots');
            if (growthSeries && Array.isArray(growthSeries.data)) {
                growthSeries.data.forEach((pt, idx) => {
                    const cat = c1.categories[idx];
                    if (cat) growthPoints.push([cat, readPtVal(pt)]);
                });
                if (growthSeries.data.length > 0) latestGain = readPtVal(growthSeries.data[growthSeries.data.length - 1]);
            }
            if (lotsSeries && Array.isArray(lotsSeries.data)) {
                lotsSeries.data.forEach((pt, idx) => {
                    const cat = c1.categories[idx];
                    if (cat) dailyLots[cat] = readPtVal(pt);
                });
            }
        }
    }

    if (c3Resp && !c3Resp.error && c3Resp.status < 400 && !(c3Resp.body || '').trim().startsWith('<')) {
        const c3 = JSON.parse(c3Resp.body);
        if (c3 && Array.isArray(c3.categories) && Array.isArray(c3.series) && c3.series[0] && Array.isArray(c3.series[0].data)) {
            c3.series[0].data.forEach((pt, idx) => {
                const val = Array.isArray(pt) ? pt[0] : readPtVal(pt);
                monthlyGains.push({
                    month: c3.categories[idx] || `Month ${idx + 1}`,
                    gain: typeof val === 'number' ? val : parseFloat(val) || 0
                });
            });
        }
    }

    if (latestGain !== null) {
        general.gain = (latestGain >= 0 ? '+' : '') + latestGain.toFixed(2) + '%';
    }

    const extracted = { general, periods, growthPoints, dailyLots, monthlyGains };
    if (!extracted.general.balance && extracted.growthPoints.length === 0) {
        throw new Error(`Byparr/tls-client extracted no metrics or chart data.`);
    }

    const expectedTotalTrades = (historyMeta && historyMeta.totalTrades)
        || parseInt(String(extracted.general.trades || '').replace(/[^0-9]/g, ''), 10)
        || 0;
    const gapTolerance = (existing && existing.last_full_crawl_utc && existingTradeKeys.size > 0) ? 25 : 0;
    const hasMissingTradeGap = (totalNew) => expectedTotalTrades > 0 && (existingTradeKeys.size + totalNew + gapTolerance) < expectedTotalTrades;
    const countNewAndOverlap = (pageTrades) => {
        let newInPage = 0;
        let overlapInPage = 0;
        for (const t of pageTrades) {
            if (existingTradeKeys.has(makeTradeKey(t))) overlapInPage++;
            else newInPage++;
        }
        return { newInPage, overlapInPage };
    };

    let allTrades = [];
    let crawledAllPages = false;
    let actualCrawlMode = EFFECTIVE_MODE;

    if (EFFECTIVE_MODE !== 'metrics') {
        allTrades.push(...page1Trades);
        const totalPages = (historyMeta && historyMeta.totalPages) || 1;
        console.log(`[Crawler] Byparr+tls-client Page 1 trades: ${page1Trades.length} (total pages: ${totalPages}, expected: ${expectedTotalTrades || 'unknown'})`);

        const p1Stats = countNewAndOverlap(page1Trades);
        let totalNewTrades = p1Stats.newInPage;
        const hasHistoricalGap = hasMissingTradeGap(totalNewTrades);
        if (EFFECTIVE_MODE === 'partial' && hasHistoricalGap) {
            actualCrawlMode = 'full';
        }

        const shouldStopPartial = (
            actualCrawlMode === 'partial' &&
            totalPages > 1 &&
            p1Stats.overlapInPage > 0 &&
            !hasHistoricalGap
        );

        if (shouldStopPartial) {
            console.log(`[Crawler] Partial crawl complete on Page 1 (${p1Stats.newInPage} new, ${p1Stats.overlapInPage} known). Skipping ${totalPages - 1} historical pages.`);
        } else if (totalPages > 1 && historyMeta && historyMeta.pagingParams) {
            const maxPagesToCrawl = Math.min(totalPages, 50);
            const batchReqs = [];
            for (let p = 2; p <= maxPagesToCrawl; p++) {
                const sp = new URLSearchParams(historyMeta.pagingParams.replace(/^\?/, ''));
                sp.set('p', String(p));
                if (csrf) sp.set('_csrf', csrf);
                batchReqs.push({
                    method: 'GET',
                    url: `${originUrl}/paging.html?${sp.toString()}`,
                    headers: tlsHeaders
                });
            }
            const pageResps = invokeTlsFetchBatch({
                userAgent: sol.userAgent || '',
                baseUrl: originUrl + '/',
                profile: 'firefox',
                cookies: sol.cookies || [],
                requests: batchReqs
            });
            let stoppedEarly = false;
            for (const resp of pageResps) {
                if (!resp || resp.error || resp.status >= 400) {
                    stoppedEarly = true;
                    break;
                }
                let htmlStr = resp.body || '';
                if (htmlStr.trim().startsWith('{')) {
                    try {
                        const j = JSON.parse(htmlStr);
                        htmlStr = (j.content && (j.content.history || j.content)) || htmlStr;
                    } catch (e) {}
                }
                const { document: pDoc } = parseHTML(htmlStr);
                const pageTrades = parseTradesFromNodeDocument(pDoc, '#tradingHistoryTable tbody tr, tr');
                if (pageTrades.length === 0) {
                    stoppedEarly = true;
                    break;
                }
                allTrades.push(...pageTrades);
                const pStats = countNewAndOverlap(pageTrades);
                totalNewTrades += pStats.newInPage;
                if (actualCrawlMode === 'partial' && pStats.overlapInPage > 0 && !hasMissingTradeGap(totalNewTrades)) {
                    stoppedEarly = true;
                    break;
                }
            }
            if (!stoppedEarly && totalPages <= 50) crawledAllPages = true;
        }

        if (allTrades.length === 0) {
            throw new Error(`Byparr/tls-client extracted 0 trades in ${actualCrawlMode} mode.`);
        }
    }

    if (extracted.growthPoints.length === 0 && allTrades.length === 0) {
        throw new Error('Byparr/tls-client extracted 0 growth points and 0 trades.');
    }

    finalizeAndWriteCache({ providerName: 'byparr', extracted, allTrades, actualCrawlMode, crawledAllPages });
}

function getConfiguredProviders() {
    const raw = cliProviders || process.env.CRAWLER_PROVIDERS || 'browserless,zenrows,byparr';
    const requested = raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    const hasKey = {
        browserless: Boolean((process.env.BROWSERLESS_TOKEN || '').trim()),
        zenrows: Boolean((process.env.ZENROWS_API_KEY || '').trim()),
        byparr: process.env.BYPARR_ENABLED !== 'false',
    };
    const configured = requested.filter(p => hasKey[p]);
    return configured.length > 0 ? configured : requested;
}

(async () => {
    const providers = getConfiguredProviders();
    const errors = [];
    const zenrowsMaxAttempts = Math.min(Math.max(parseInt(process.env.ZENROWS_MAX_ATTEMPTS || '2', 10) || 2, 1), 3);

    for (let i = 0; i < providers.length; i++) {
        const provider = providers[i];
        const maxAttempts = provider === 'zenrows' ? zenrowsMaxAttempts : 1;

        let succeeded = false;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                if (provider === 'byparr') {
                    await runCrawlWithByparr();
                } else {
                    await runCrawlWithProvider(provider);
                }
                succeeded = true;
                break;
            } catch (err) {
                const msg = redactToken(err && err.message ? err.message : err);
                errors.push(`${provider}${maxAttempts > 1 ? `#${attempt}` : ''}: ${msg}`);
                console.error(`[Crawler] Provider "${provider}" attempt ${attempt}/${maxAttempts} failed: ${msg}`);
            }
        }
        if (succeeded) {
            return;
        }
        if (i + 1 < providers.length) {
            console.log(`[Crawler] Falling back to next provider "${providers[i + 1]}"...`);
        }
    }

    console.error(`[Crawler] All providers failed (${errors.join(' | ')})`);
    process.exit(1);
})();
