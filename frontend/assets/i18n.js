// Site translations. English is written in the pages; other languages come from
// /assets/i18n/<lang>.json, a map from the English text (the element's inner HTML,
// whitespace collapsed) to its translation. Page scripts translate their own
// strings with i18n.t("English text") after i18n.ready.
(function () {
  var LANGS = [
    ["de", "Deutsch"],
    ["en", "English", "en"],
    ["fr", "Français"],
    ["es", "Español"],
    ["pl", "Polski"],
    ["ro", "Română"],
    ["sq", "Shqip"],
    ["tr", "Türkçe"],
    ["ru", "Русский"],
    ["uk", "Українська"],
    ["ar", "العربية"]
  ];
  // Alphabetical by the language's English name.
  var ENGLISH = {
    de: "German", en: "English", fr: "French", es: "Spanish", pl: "Polish",
    ro: "Romanian", sq: "Albanian", tr: "Turkish", ru: "Russian", uk: "Ukrainian", ar: "Arabic"
  };
  var COUNTRY = {
    de: "Germany", en: "United Kingdom", fr: "France", es: "Spain", pl: "Poland",
    ro: "Romania", sq: "Albania", tr: "Turkey", ru: "Russia", uk: "Ukraine", ar: "Saudi Arabia"
  };
  LANGS.sort(function (a, b) { return COUNTRY[a[2] || a[0]].localeCompare(COUNTRY[b[2] || b[0]]); });
  var SHORT = {
    de: "GER", en: "ENG", fr: "FRA", es: "ESP", pl: "POL",
    ro: "ROU", sq: "ALB", tr: "TUR", ru: "RUS", uk: "UKR", ar: "ARA"
  };
  var RTL = { ar: true };
  // Small inline SVG flags (emoji flags do not show on Windows).
  var FLAGS = {
    us: '<rect width="60" height="40" fill="#fff"/><path d="M0 1.54h60M0 7.69h60M0 13.85h60M0 20h60M0 26.15h60M0 32.31h60M0 38.46h60" stroke="#B22234" stroke-width="3.08"/><rect width="26" height="21.54" fill="#3C3B6E"/><g fill="#fff"><circle cx="4" cy="3.5" r="1"/><circle cx="10" cy="3.5" r="1"/><circle cx="16" cy="3.5" r="1"/><circle cx="22" cy="3.5" r="1"/><circle cx="7" cy="7.5" r="1"/><circle cx="13" cy="7.5" r="1"/><circle cx="19" cy="7.5" r="1"/><circle cx="4" cy="11.5" r="1"/><circle cx="10" cy="11.5" r="1"/><circle cx="16" cy="11.5" r="1"/><circle cx="22" cy="11.5" r="1"/><circle cx="7" cy="15.5" r="1"/><circle cx="13" cy="15.5" r="1"/><circle cx="19" cy="15.5" r="1"/><circle cx="4" cy="19" r="1"/><circle cx="10" cy="19" r="1"/><circle cx="16" cy="19" r="1"/><circle cx="22" cy="19" r="1"/></g>',

    en: '<rect width="60" height="40" fill="#012169"/><path d="M0 0L60 40M60 0L0 40" stroke="#fff" stroke-width="8"/><path d="M0 0L60 40M60 0L0 40" stroke="#C8102E" stroke-width="3"/><path d="M30 0V40M0 20H60" stroke="#fff" stroke-width="12"/><path d="M30 0V40M0 20H60" stroke="#C8102E" stroke-width="7"/>',
    nl: '<rect width="60" height="40" fill="#21468B"/><rect width="60" height="26.7" fill="#fff"/><rect width="60" height="13.3" fill="#AE1C28"/>',
    de: '<rect width="60" height="40" fill="#FFCE00"/><rect width="60" height="26.7" fill="#DD0000"/><rect width="60" height="13.3" fill="#000"/>',
    fr: '<rect width="60" height="40" fill="#EF4135"/><rect width="40" height="40" fill="#fff"/><rect width="20" height="40" fill="#0055A4"/>',
    it: '<rect width="60" height="40" fill="#CE2B37"/><rect width="40" height="40" fill="#fff"/><rect width="20" height="40" fill="#009246"/>',
    es: '<rect width="60" height="40" fill="#AA151B"/><rect y="10" width="60" height="20" fill="#F1BF00"/>',
    pl: '<rect width="60" height="40" fill="#DC143C"/><rect width="60" height="20" fill="#fff"/>',
    ro: '<rect width="60" height="40" fill="#CE1126"/><rect width="40" height="40" fill="#FCD116"/><rect width="20" height="40" fill="#002B7F"/>',
    sq: '<rect width="60" height="40" fill="#E41E20"/><path d="M26 14l4 4 4-4v4l-4 4-4-4zm-4 6l6 3v5l-4 4-2-2 2-4-4-2zm16 0l-6 3v5l4 4 2-2-2-4 4-2z" fill="#000"/>',
    hi: '<rect width="60" height="40" fill="#138808"/><rect width="60" height="26.7" fill="#fff"/><rect width="60" height="13.3" fill="#FF9933"/><circle cx="30" cy="20" r="5" fill="none" stroke="#000080" stroke-width="1.5"/>',
    bn: '<rect width="60" height="40" fill="#006A4E"/><circle cx="27" cy="20" r="11" fill="#F42A41"/>',
    pt: '<rect width="60" height="40" fill="#FF0000"/><rect width="24" height="40" fill="#006600"/><circle cx="24" cy="20" r="7" fill="#FFCC00"/><circle cx="24" cy="20" r="4" fill="#fff" stroke="#FF0000" stroke-width="1.5"/>',
    ru: '<rect width="60" height="40" fill="#D52B1E"/><rect width="60" height="26.7" fill="#0039A6"/><rect width="60" height="13.3" fill="#fff"/>',
    uk: '<rect width="60" height="40" fill="#FFD700"/><rect width="60" height="20" fill="#0057B7"/>',
    zh: '<rect width="60" height="40" fill="#DE2910"/><polygon points="10,5 11.8,10.5 17.6,10.5 12.9,13.9 14.7,19.4 10,16 5.3,19.4 7.1,13.9 2.4,10.5 8.2,10.5" fill="#FFDE00"/><circle cx="20" cy="4" r="1.3" fill="#FFDE00"/><circle cx="23" cy="8" r="1.3" fill="#FFDE00"/><circle cx="23" cy="13" r="1.3" fill="#FFDE00"/><circle cx="20" cy="17" r="1.3" fill="#FFDE00"/>',
    ar: '<rect width="60" height="40" fill="#006C35"/><rect x="14" y="26" width="32" height="2.5" rx="1" fill="#fff"/><rect x="16" y="12" width="28" height="8" rx="2" fill="none" stroke="#fff" stroke-width="1.5"/>',
    ur: '<rect width="60" height="40" fill="#01411C"/><rect width="15" height="40" fill="#fff"/><circle cx="37" cy="20" r="10" fill="#fff"/><circle cx="40" cy="17.5" r="8.5" fill="#01411C"/><polygon points="45,11 46,14 49,14 46.6,15.8 47.5,18.8 45,17 42.5,18.8 43.4,15.8 41,14 44,14" fill="#fff"/>',
    th: '<rect width="60" height="40" fill="#A51931"/><rect y="6.67" width="60" height="26.67" fill="#F4F5F8"/><rect y="13.33" width="60" height="13.33" fill="#2D2A4A"/>',
    tr: '<rect width="60" height="40" fill="#E30A17"/><circle cx="22" cy="20" r="10" fill="#fff"/><circle cx="24.5" cy="20" r="8" fill="#E30A17"/><polygon points="34,20 39.6,18.2 36.1,22.9 36.1,17.1 39.6,21.8" fill="#fff"/>'
  };
  function flag(code) {
    return '<svg class="flag" viewBox="0 0 60 40" aria-hidden="true">' + FLAGS[code] + "</svg>";
  }
  var SELECTOR = "title, h1, h2, h3, h4, p, li, figcaption, th, td, nav a, footer a, footer div, .footer-links a, .k, .eyebrow, .title, .note, .sub, .kv span, .src-label, .tab, .page-tab, .plan-bar span, .kpi-label, .kpi-sub, .btn-toggle, .section-title, .section-desc, .calc-label span, .calc-label, .calc-label-inline, .range-btn, .fee-k, .fee-title strong, .fee-title, .tbl-period-name strong, .badge, #sync-status-indicator, #trades-count-badge, .zoom-tab, .empty-kicker, .pool-badge, .pool-amount, .pool-req, .inc-title, .inc-desc, .inc-freq, .disclaimer-text, .grand-banner div, .plan-rows span, .plan-rows strong, .plan-total span, .plan-total strong, .plan-legend li, [data-i18n], strong[data-i18n], span[data-i18n], .forecast-title, .tick-label, .explainer-title, .explainer-title strong, .badge-verified, #label-sample-months, #label-forecast-months, #forecast-basis-badge, #metrics-desc-prefix, #btn-manual-refresh, .metric-expectancy-lbl";
  var dict = {};
  var canonicalDict = {};

  function norm(s) { return s.replace(/\s+/g, " ").trim(); }
  function canonical(s) {
    var template = document.createElement("template");
    template.innerHTML = s;
    template.content.querySelectorAll("*").forEach(function (element) {
      var attributes = Array.from(element.attributes).map(function (a) { return [a.name, a.value]; });
      attributes.sort(function (a, b) { return a[0].localeCompare(b[0]); });
      attributes.forEach(function (a) { element.removeAttribute(a[0]); });
      attributes.forEach(function (a) { element.setAttribute(a[0], a[1]); });
    });
    return norm(template.innerHTML);
  }

  function current() {
    var fromUrl = new URLSearchParams(location.search).get("lang");
    var saved = null;
    try { saved = localStorage.getItem("lang"); } catch (e) {}
    var lang = fromUrl || saved || "de";
    return LANGS.some(function (l) { return l[0] === lang; }) ? lang : "en";
  }
  var lang = current();

  function t(text) {
    if (!text) return text;
    var k = norm(text);
    return dict[k] || canonicalDict[canonical(k)] || text;
  }

  function f(text, vars) {
    return t(text).replace(/\{(\w+)\}/g, function (_, k) { return vars[k]; });
  }

  function apply(root) {
    var done = [];
    (root || document).querySelectorAll(SELECTOR).forEach(function (e) {
      if (done.some(function (d) { return d.contains(e); })) return;
      if (e.closest("[translate=no]")) return;
      if (e.closest(".lang")) return;

      if (!e.hasAttribute("data-i18n-orig")) {
        e.setAttribute("data-i18n-orig", norm(e.innerHTML));
      }
      var origHtml = e.getAttribute("data-i18n-orig");
      var currentHtml = norm(e.innerHTML);
      var textKey = norm(e.textContent);

      var value = dict[origHtml] || dict[currentHtml] || dict[textKey] ||
                  canonicalDict[canonical(origHtml)] || canonicalDict[canonical(currentHtml)];
      if (value) {
        e.innerHTML = value;
        done.push(e);
      }
    });
  }

  function choose(code, flagKey) {
    try { localStorage.setItem("lang", code); localStorage.setItem("langFlag", flagKey || code); } catch (e) {}
    var url = new URL(location.href);
    url.searchParams.set("lang", code);
    location.href = url.toString();
  }

  // Dropdown with flags, top right of the menu bar.
  function addSelect() {
    var bar = document.querySelector(".topbar-inner");
    if (!bar) return;
    var savedFlag = null;
    try { savedFlag = localStorage.getItem("langFlag"); } catch (e) {}
    var cur = LANGS.filter(function (l) { return l[0] === lang && (l[2] || l[0]) === savedFlag; })[0]
      || LANGS.filter(function (l) { return l[0] === lang; })[0];
    var wrap = document.createElement("div");
    wrap.className = "lang";
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "lang-btn";
    btn.setAttribute("aria-haspopup", "listbox");
    btn.setAttribute("aria-expanded", "false");
    btn.setAttribute("aria-label", "Language");
    btn.innerHTML = flag(cur[2] || cur[0]) +
      '<span class="lang-code">' + (SHORT[cur[0]] || cur[0].toUpperCase()) + '</span>' +
      '<svg class="lang-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
    var list = document.createElement("ul");
    list.className = "lang-list";
    list.setAttribute("role", "listbox");
    list.hidden = true;
    LANGS.forEach(function (l) {
      var li = document.createElement("li");
      li.setAttribute("role", "option");
      li.tabIndex = 0;
      var isCur = l === cur;
      if (isCur) li.setAttribute("aria-selected", "true");
      li.innerHTML = flag(l[2] || l[0]) +
        '<span class="lang-name">' + l[1] + '</span>' +
        (isCur ? '<svg class="lang-check" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>' : '');
      li.addEventListener("click", function () { choose(l[0], l[2]); });
      li.addEventListener("keydown", function (ev) { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); choose(l[0], l[2]); } });
      list.appendChild(li);
    });
    function toggle(open) {
      var isOpening = typeof open === "boolean" ? open : list.hidden;
      list.hidden = !isOpening;
      btn.setAttribute("aria-expanded", String(isOpening));
      wrap.classList.toggle("is-open", isOpening);
    }
    btn.addEventListener("click", function (ev) {
      ev.stopPropagation();
      var willOpen = !wrap.classList.contains("is-open");
      toggle(willOpen);
    });
    document.addEventListener("click", function (ev) {
      if (!wrap.contains(ev.target)) {
        toggle(false);
      }
    });
    document.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape") toggle(false);
    });
    wrap.appendChild(btn);
    wrap.appendChild(list);
    bar.appendChild(wrap);
  }

  var ready = fetch("/assets/i18n/" + lang + ".json?v=9")
    .then(function (r) {
      if (!r.ok) return {};
      return r.json();
    })
    .then(function (d) {
      dict = d || {};
      Object.keys(dict).forEach(function (key) { canonicalDict[canonical(key)] = dict[key]; });
      try {
        window.dispatchEvent(new CustomEvent("i18n:ready", { detail: { lang: lang } }));
      } catch (e) {}
    })
    .catch(function () {});

  document.documentElement.lang = lang;
  document.documentElement.dir = RTL[lang] ? "rtl" : "ltr";
  window.i18n = { lang: lang, t: t, f: f, apply: apply, ready: ready };

  function start() {
    addSelect();
    ready.then(function () { apply(document); });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
