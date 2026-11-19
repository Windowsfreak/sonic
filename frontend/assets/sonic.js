// Renders /data/sonic.json (written by scraper/parse_myfxbook.py).
(function () {
  var tx = function (s) { return window.i18n ? i18n.t(s) : s; };
  var F = function (s, v) { return window.i18n ? i18n.f(s, v) : s.replace(/\{(\w+)\}/g, function (_, k) { return v[k]; }); };
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function sign(v) {
    if (!v) return "";
    if (/^\+/.test(v)) return "pos";
    if (/^-|^\(-|^-\$/.test(v)) return "neg";
    return "";
  }
  function kv(target, rows) {
    rows.forEach(function (r) {
      if (!r[1]) return;
      var d = el("div");
      d.appendChild(el("span", null, tx(r[0])));
      d.appendChild(el("span", null, r[1]));
      target.appendChild(d);
    });
  }

  var NS = "http://www.w3.org/2000/svg";
  function svg(tag, attrs, parent) {
    var e = document.createElementNS(NS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  var COPY_START = "2025-10-07"; // first SONIC trade copied on TAG Markets
  var WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  // Day and month in each language's usual order: "Oct 7" (en), "2025年10月7日" (zh), "7 oct" (others).
  function lang() { return window.i18n ? i18n.lang : "en"; }
  function fmtDM(m, d) {
    if (lang() === "en") return tx(MONTHS[m]) + " " + d;
    if (lang() === "zh") return tx(MONTHS[m]) + d + "日";
    return d + " " + tx(MONTHS[m]);
  }
  function fmtDay(iso) {
    var p = iso.split("-"), m = +p[1] - 1, d = +p[2];
    if (lang() === "en") return fmtDM(m, d) + ", " + p[0];
    if (lang() === "zh") return p[0] + "年" + fmtDM(m, d);
    return fmtDM(m, d) + " " + p[0];
  }
  function niceTicks(min, max, n) {
    var span = max - min || 1;
    var step = Math.pow(10, Math.floor(Math.log10(span / n)));
    [1, 2, 5, 10].some(function (m) { if (span / (step * m) <= n) { step *= m; return true; } });
    var ticks = [];
    var end = Math.ceil(max / step - 1e-9) * step;
    for (var v = Math.floor(min / step) * step; v <= end + 1e-9; v += step) ticks.push(+v.toFixed(6));
    return ticks;
  }

  // Growth: one series, crosshair + tooltip on hover.
  function growthChart(box, points) {
    var W = +box.getAttribute("data-w") || 760, H = +box.getAttribute("data-h") || 300, L = 44, R = 12, T = 12, B = 28;
    var ys = points.map(function (p) { return p[1]; });
    var ticks = niceTicks(Math.min(0, Math.min.apply(null, ys)), Math.max.apply(null, ys), 5);
    var y0 = ticks[0], y1 = ticks[ticks.length - 1];
    var X = function (i) { return L + (W - L - R) * i / (points.length - 1); };
    var Y = function (v) { return T + (H - T - B) * (1 - (v - y0) / (y1 - y0)); };
    var s = svg("svg", { viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": "Growth chart" }, box);
    ticks.forEach(function (t) {
      svg("line", { x1: L, x2: W - R, y1: Y(t), y2: Y(t), "class": "grid" }, s);
      svg("text", { x: L - 8, y: Y(t) + 4, "text-anchor": "end" }, s).textContent = t + "%";
    });
    var lastYear = null;
    // Short ranges (a week, a month): a few day labels instead of months.
    if (points.length <= 45) {
      var step = Math.max(1, Math.round((points.length - 1) / (W < 600 ? 3 : 5)));
      points.forEach(function (p, i) {
        var n = points.length - 1;
        if (!(i === n || (i % step === 0 && i <= n - step / 2))) return;
        var d = p[0].split("-");
        svg("text", { x: X(i), y: H - 8, "text-anchor": i === 0 ? "start" : i === points.length - 1 ? "end" : "middle" }, s).textContent = fmtDM(+d[1] - 1, +d[2]);
      });
    }
    points.forEach(function (p, i) {
      if (points.length <= 45) return;
      var ym = p[0].slice(0, 7);
      if (p[0].slice(5, 7) % (W < 600 ? 6 : 3) === 1 && ym !== lastYear) {
        lastYear = ym;
        var lbl = tx(MONTHS[+p[0].slice(5, 7) - 1]) + " '" + p[0].slice(2, 4);
        svg("text", { x: X(i), y: H - 8, "text-anchor": "middle" }, s).textContent = lbl;
      }
    });
    var d = points.map(function (p, i) { return (i ? "L" : "M") + X(i).toFixed(1) + " " + Y(p[1]).toFixed(1); }).join(" ");
    svg("path", { d: d + " L" + X(points.length - 1) + " " + Y(y0) + " L" + X(0) + " " + Y(y0) + " Z", "class": "area" }, s);
    svg("path", { d: d, "class": "line" }, s);

    // Marker: the day SONIC went live for copy trading on TAG Markets.
    var mi = -1;
    points.some(function (pt, i) { if (pt[0] >= COPY_START) { mi = i; return true; } return false; });
    if (mi > 0) {
      var mx = X(mi);
      svg("line", { x1: mx, x2: mx, y1: T, y2: H - B, "class": "marker" }, s);
      // Narrow chart: the label goes left of the line, above the lower part of the curve.
      var right = W >= 600 && mx < W * 0.7;
      var lab = svg("text", { x: right ? mx + 6 : mx - 6, y: W < 600 ? T + 8 : T + 12, "text-anchor": right ? "start" : "end", "class": W < 600 ? "marker-label narrow" : "marker-label" }, s);
      if (W < 600) {
        // Narrow chart: the label on two lines.
        [tx("Copy trading on TAG starts"), "(" + fmtDay(COPY_START) + ")"].forEach(function (t, n) {
          svg("tspan", { x: lab.getAttribute("x"), dy: n ? 14 : 0 }, lab).textContent = t;
        });
      } else {
        lab.textContent = tx("Copy trading on TAG starts") + " (" + fmtDay(COPY_START) + ")";
      }
    }

    var cross = svg("line", { y1: T, y2: H - B, "class": "cross", visibility: "hidden" }, s);
    var dot = svg("circle", { r: 4, "class": "dot", visibility: "hidden" }, s);
    var tip = el("div", "tip"); tip.hidden = true; box.appendChild(tip);
    var hit = svg("rect", { x: L, y: T, width: W - L - R, height: H - T - B, fill: "transparent" }, s);
    function move(ev) {
      var r = s.getBoundingClientRect();
      var cx = (ev.clientX - r.left) * W / r.width;
      var i = Math.max(0, Math.min(points.length - 1, Math.round((cx - L) / (W - L - R) * (points.length - 1))));
      var p = points[i];
      cross.setAttribute("x1", X(i)); cross.setAttribute("x2", X(i)); cross.setAttribute("visibility", "visible");
      dot.setAttribute("cx", X(i)); dot.setAttribute("cy", Y(p[1])); dot.setAttribute("visibility", "visible");
      tip.hidden = false;
      tip.innerHTML = "";
      tip.appendChild(document.createTextNode(fmtDay(p[0]) + "  "));
      tip.appendChild(el("b", null, (p[1] > 0 ? "+" : "") + p[1].toFixed(2) + "%"));
      tip.style.left = (X(i) / W * r.width) + "px";
      tip.style.top = (Y(p[1]) / H * r.height) + "px";
    }
    function leave() { cross.setAttribute("visibility", "hidden"); dot.setAttribute("visibility", "hidden"); tip.hidden = true; }
    hit.addEventListener("pointermove", move);
    hit.addEventListener("pointerdown", move);
    hit.addEventListener("pointerleave", leave);
  }

  // Fester Abrufzeitpunkt des Tages-Snapshots, keine Live-Anzeige.
  function updatedTimer(target, at) {
    var stamp = new Date(at).toLocaleString(lang() === "de" ? "de-DE" : "en-GB", { timeZone: "Europe/Berlin", dateStyle: "short", timeStyle: "short" });
    target.textContent = (lang() === "de" ? "Tages-Snapshot " : "Daily snapshot ") + stamp + (lang() === "de" ? " · nicht live" : " · not live");
  }

  function tradingAgeHours(at, now) {
    var start = Date.parse(at || ""), end = now == null ? Date.now() : now;
    if (!isFinite(start)) return Infinity;
    var hours = 0;
    var weekdays = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", weekday: "short" });
    // Für sehr alte Snapshots ist keine stundengenaue Berechnung nötig.
    if (end - start > 14 * 86400000) return 240;
    while (start < end) {
      var next = Math.min(end, Math.floor(start / 3600000 + 1) * 3600000);
      var day = weekdays.format(new Date(start));
      if (day !== "Sat" && day !== "Sun") hours += (next - start) / 3600000;
      start = next;
    }
    return hours;
  }

  function weekendPause() {
    var day = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", weekday: "short" }).format(new Date());
    return day === "Sat" || day === "Sun";
  }

  function snapshotLabel(label, at, tradingCalendar) {
    var stamp = Date.parse(at || "");
    var german = lang() === "de";
    if (!isFinite(stamp)) return label + (german ? ": Abrufdatum unbekannt" : ": retrieval date unknown");
    var date = new Date(stamp).toLocaleString(german ? "de-DE" : "en-GB", { timeZone: "Europe/Berlin", dateStyle: "short", timeStyle: "short" });
    var stale = tradingCalendar ? tradingAgeHours(at) > 36 : Date.now() - stamp > 36 * 3600000;
    var detail = stale ? (german ? " · veraltet (Abruf älter als 36 Stunden" : " · stale (retrieval over 36 hours old") + (tradingCalendar ? (german ? ", ohne Wochenenden)" : ", excluding weekends)") : ")") : "";
    if (tradingCalendar && weekendPause()) detail += german ? " · Wochenendpause; Handel Montag bis Freitag" : " · weekend pause; trading Monday to Friday";
    return label + ": " + date + detail;
  }

  function beforeStatus(target, text, className) {
    if (!target) return;
    var note = el("p", "note snapshot-status " + (className || ""), text);
    note.setAttribute("translate", "no");
    target.parentNode.insertBefore(note, target);
  }

  // Home chart. By default it follows the period chosen in the filter;
  // the buttons show one week, one month, this year or everything since
  // Oct 7, 2025. Each range starts at 0%. The values are the account's
  // growth times the Amplify chosen (12x or 24x), net (70%) or gross as the
  // profit box shows, without reinvesting.
  var homeChart = null, chartPeriod = null;
  function homeChartRanges(points) {
    var box = $("chart-ranges"), title = $("chart-title"), chart = $("chart");
    var last = points[points.length - 1][0], end = new Date(last + "T00:00:00Z");
    function back(days, months) {
      var d = new Date(end);
      d.setUTCDate(d.getUTCDate() - days); d.setUTCMonth(d.getUTCMonth() - months);
      return d.toISOString().slice(0, 10);
    }
    var ranges = [["1W", back(7, 0)], ["1M", back(0, 1)], ["YTD", last.slice(0, 4) + "-01-01"], ["All", null]];
    var cur = null, curBtn = null;
    function slice(from, to) {
      var base = null;
      points.forEach(function (p) { if (p[0] < from) base = p; });
      var b = 1 + (base ? base[1] : 0) / 100;
      return (base ? [base] : []).concat(points.filter(function (p) { return p[0] >= from && (!to || p[0] <= to); })).map(function (p) {
        return [p[0], ((1 + p[1] / 100) / b - 1) * 100];
      });
    }
    function show(r, btn) {
      // The current month (still running): the last month instead, so the
      // line has more than a day or two in it.
      if (!r && chartPeriod[3] === 1 && chartPeriod[1] >= last) { r = ranges[1]; btn = box.children[1]; }
      var period = !r, from = period ? chartPeriod[0] : r[1];
      var pts = from ? slice(from, period ? chartPeriod[1] : null) : points;
      if (pts.length < 2) { if (period) return show(ranges[1], box.children[1]); return; }
      cur = r; curBtn = btn;
      var k = homeAmp * (homeFlipped ? 1 : 1 - FEE);
      pts = pts.map(function (p) { return [p[0], Math.round(p[1] * k * 100) / 100]; });
      var on = period ? box.children[chartPeriod[3]] : btn;
      [].forEach.call(box.children, function (x) { x.setAttribute("aria-pressed", String(x === on)); });
      var label = period ? chartPeriod[2] : r[1] ? tx(r[0]) : null;
      title.textContent = (label ? tx("Growth (%)") + " · " + label : tx("Growth since Oct 7, 2025 (%)")) + " · " + homeAmp + "x";
      chart.innerHTML = "";
      growthChart(chart, pts);
    }
    ranges.forEach(function (r) {
      var btn = el("button", "range", tx(r[0]));
      btn.type = "button";
      btn.addEventListener("click", function () { show(r, btn); });
      box.appendChild(btn);
    });
    // period: true when the filter changed (back to the period view).
    homeChart = function (period) { if (period || !cur) show(null, null); else show(cur, curBtn); };
    homeChart(true);
  }

  // Home trades table: "1 Oct '26", short enough for the table to fit.
  function shortDate(d) {
    var m = tx(MONTHS[d.getUTCMonth()]), y = String(d.getUTCFullYear()).slice(2);
    if (lang() === "zh") return y + "年" + m + d.getUTCDate() + "日";
    return d.getUTCDate() + " " + m + " '" + y;
  }

  // Home: the growth since copy trading on TAG started, from 0%.
  function fromCopyStart(points) {
    var base = null;
    points.forEach(function (p) { if (p[0] < COPY_START) base = p; });
    if (!base) return points;
    var b = 1 + base[1] / 100;
    return [[COPY_START, 0]].concat(points.filter(function (p) { return p[0] >= COPY_START; }).map(function (p) {
      return [p[0], Math.round(((1 + p[1] / 100) / b - 1) * 10000) / 100];
    }));
  }

  // Monthly gain: one series of bars, value on each bar (few bars only).
  function monthlyChart(box, rows) {
    var W = 760, H = 220, L = 36, R = 8, T = 18, B = 26;
    var vals = rows.map(function (r) { return r[1]; });
    var ticks = niceTicks(Math.min(0, Math.min.apply(null, vals)), Math.max.apply(null, vals), 4);
    var y0 = ticks[0], y1 = ticks[ticks.length - 1];
    var Y = function (v) { return T + (H - T - B) * (1 - (v - y0) / (y1 - y0)); };
    var s = svg("svg", { viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": "Monthly gain chart" }, box);
    ticks.forEach(function (t) {
      svg("line", { x1: L, x2: W - R, y1: Y(t), y2: Y(t), "class": "grid" }, s);
      svg("text", { x: L - 6, y: Y(t) + 4, "text-anchor": "end" }, s).textContent = t + "%";
    });
    var slot = (W - L - R) / rows.length, bw = Math.min(46, slot * 0.6);
    rows.forEach(function (r, i) {
      var cx = L + slot * (i + 0.5), top = Y(Math.max(0, r[1])), bot = Y(Math.min(0, r[1]));
      var b = svg("rect", { x: cx - bw / 2, y: top, width: bw, height: Math.max(1, bot - top), rx: 4, "class": "bar" }, s);
      svg("title", {}, b).textContent = r[0] + ": " + r[1] + "%";
      svg("text", { x: cx, y: top - 5, "text-anchor": "middle", "class": "bar-label" }, s).textContent = r[1].toFixed(2) + "%";
      svg("text", { x: cx, y: H - 8, "text-anchor": "middle" }, s).textContent = tx(r[0].slice(0, 3));
    });
  }

  function $(id) { return document.getElementById(id); }
  function money(v) {
    return "$" + v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function pct(text) { return parseFloat(String(text).replace(/[^0-9.\-]/g, "")) / 100; }

  // Tiles on the Sonic page.
  function renderTiles(g, a) {
    var tiles = $("tiles");
    if (!tiles) return;
    [["Total gain", g.gain, "tile-hero"], ["Balance", g.balance], ["Profit", g.profit], ["Drawdown", g.drawdown],
     ["Daily", g.daily], ["Monthly", g.monthly], ["Trades", a.trades], ["Profit factor", a.profit_factor]]
      .forEach(function (t) {
        if (!t[1]) return;
        var d = el("div", "tile" + (t[2] ? " " + t[2] : ""));
        d.appendChild(el("div", "k", tx(t[0])));
        d.appendChild(el("div", "v " + sign(t[1]), t[1]));
        tiles.appendChild(d);
      });
  }

  // Home: a period filter (since copy trading started on TAG, this year, or
  // one month of this year; default the current month), a balance the
  // visitor types (default $10,000), the account's average daily, weekly
  // and monthly gain over that period (plain), then the same with 24x
  // Amplify, net and gross, in percent and in cash on that balance.
  // For a single month, "monthly" is that month's gain; for longer periods
  // it is the average month. Amplify multiplies the percentages by 24; net
  // is what is left after the 30% fee.
  var AMPLIFY = 24, FEE = 0.3, COMMISSION = 0.025, LOT_BONUS = 1.03;
  // Amplify on the Trading Sonic tab (12x or 24x); the Bonuses tab keeps 24x.
  var homeAmp = AMPLIFY, homeFlipped = false;
  function renderHomeTiles(growth, trades, balance, tradesBalance, metrics, metricStatus, historyStatus) {
    var top = $("home-tiles"), amp = $("home-amp"), filter = $("home-period");
    if (!top || !growth || growth.length < 2) return;
    var last = growth[growth.length - 1], year = last[0].slice(0, 4), lang = (window.i18n && i18n.lang) || "en";
    var german = lang === "de";
    var currentLabel = german ? "Laufende Myfxbook-Perioden" : "Current Myfxbook periods";
    var currentPeriods = { daily: german ? "Tag bei Abruf" : "Day at retrieval", weekly: german ? "Diese Woche" : "This week", monthly: german ? "Dieser Monat" : "This month" };
    if (metrics) currentPeriods.daily += " · " + fmtDay(metrics.today_date);
    var unavailable = german ? "Nicht verfügbar" : "Not available";

    // Periods: [label, first day, last day, average month, short label].
    function monthEnd(ym) {
      var d = new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0));
      return d.toISOString().slice(0, 10);
    }
    function monthName(ym) {
      var d = new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7) - 1, 1));
      try { return d.toLocaleDateString(lang + "-u-ca-gregory", { month: "long", year: "numeric", timeZone: "UTC" }).replace(/^./, function (c) { return c.toUpperCase(); }); }
      catch (e) { return tx(MONTHS[d.getUTCMonth()]) + " " + ym.slice(0, 4); }
    }
    var periods = [[tx("Since Oct 2025"), COPY_START, last[0], true], [tx("This year") + " (" + year + ")", year + "-01-01", last[0], true, year]];
    for (var m = 1; m <= +last[0].slice(5, 7); m++) {
      var ym = year + "-" + (m < 10 ? "0" : "") + m;
      periods.push([monthName(ym), ym + "-01", monthEnd(ym), false]);
    }
    // Default: the last full periods, real results, no estimate. Daily is
    // today when it already has trades, otherwise the last trading day;
    // Weekly the last full Monday-Friday week, Monthly the last full calendar
    // month.
    (function () {
      var now = new Date(last[0] + "T12:00:00Z"), today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
      function iso(d) { return d.toISOString().slice(0, 10); }
      var day = null;
      growth.forEach(function (g) {
        var w = new Date(g[0] + "T00:00:00Z").getUTCDay();
        if (g[0] <= iso(today) && w % 6) day = g[0];
      });
      var fri = new Date(today);
      do { fri.setUTCDate(fri.getUTCDate() - 1); } while (fri.getUTCDay() !== 5);
      var mon = new Date(fri); mon.setUTCDate(mon.getUTCDate() - 4);
      var m0 = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1)), ym = iso(m0).slice(0, 7);
      var dd = day ? new Date(day + "T00:00:00Z") : null;
      var full = {
        daily: day ? [day, day, shortDay(dd) + " " + fmtDM(dd.getUTCMonth(), dd.getUTCDate())] : null,
        weekly: [iso(mon), iso(fri), mon.getUTCMonth() === fri.getUTCMonth()
          ? fmtDM(mon.getUTCMonth(), mon.getUTCDate()).replace(/\d+/, function (n) { return n + "\u2013" + fri.getUTCDate(); })
          : fmtDM(mon.getUTCMonth(), mon.getUTCDate()) + " \u2013 " + fmtDM(fri.getUTCMonth(), fri.getUTCDate())],
        monthly: [ym + "-01", monthEnd(ym), monthName(ym)]
      };
      var p = [tx("Last full periods"), full.monthly[0], full.monthly[1], false];
      p.full = full;
      // Newest first: last full periods, then the months from the latest
      // back, then this year and the whole time since Oct 2025.
      periods.reverse();
      periods.unshift(p);
    })();
    periods.forEach(function (p) { p[0] = (german ? "Historisch: " : "Historical: ") + p[0]; });
    var current = [currentLabel, periods[0][1], periods[0][2], false];
    current.current = true;
    periods.unshift(current);
    var calculationStatus = el("p", "snapshot-status");
    calculationStatus.setAttribute("translate", "no");
    top.parentNode.insertBefore(calculationStatus, top);
    top.appendChild(el("p", "snapshot-status", german ? "Modellrechnung: Ihr Betrag × Myfxbook-Periodengewinn × 12/24. Netto: 70% eines positiven Bruttogewinns; Verluste werden nicht reduziert. Kein tatsächlicher copyX-Kontogewinn oder Zukunftsversprechen." : "Model: your amount × Myfxbook period gain × 12/24. Net is 70% of positive gross gain; losses are not reduced. Not actual copyX returns or a forecast.")).setAttribute("translate", "no");

    // Forex trades Monday to Friday: days are counted as trading days, a week
    // is 5 of them and an average month 21.7 (5 x 52 / 12).
    var WEEK_DAYS = 5, MONTH_DAYS = 5 * 52 / 12;
    // Weekdays after `from` up to and including `to` (both "YYYY-MM-DD").
    function tradingDays(from, to) {
      var n = 0, d = new Date(from + "T00:00:00Z"), end = new Date(to + "T00:00:00Z");
      for (d.setUTCDate(d.getUTCDate() + 1); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
        var w = d.getUTCDay();
        if (w !== 0 && w !== 6) n++;
      }
      return n;
    }

    // Average rates over one period, from the last close before its first day.
    function rates(p) {
      if (p.current) return window.HomeMetrics.rates(metrics);
      if (p.full) {
        var out = {};
        ["daily", "weekly", "monthly"].forEach(function (k) {
          var w = p.full[k], b = null, e = null;
          if (w) growth.forEach(function (g) { if (g[0] < w[0]) b = g; else if (g[0] <= w[1]) e = g; });
          out[k] = b && e ? (1 + e[1] / 100) / (1 + b[1] / 100) - 1 : 0;
        });
        return out;
      }
      var base = null, end = null;
      growth.forEach(function (g) {
        if (g[0] < p[1]) base = g;
        else if (g[0] <= p[2]) end = g;
      });
      if (!base || !end) return null;
      var endDay = p[2] < last[0] ? p[2] : last[0];
      var days = tradingDays(base[0], endDay);
      var total = (1 + end[1] / 100) / (1 + base[1] / 100);
      if (!(days > 0) || !(total > 0)) return null;
      function r(span) { return Math.pow(total, span / days) - 1; }
      // A month still running is shown as an average month (21.7 trading
      // days, about 4.3 weeks), like the week; a finished month shows its total.
      var running = !p[3] && p[2] >= last[0];
      return { daily: r(1), weekly: r(WEEK_DAYS), monthly: p[3] || running ? r(MONTH_DAYS) : total - 1 };
    }

    var cells = [], legends = [], lotDays = null, curPeriod = null;
    var sonicBal = parseFloat(String(balance).replace(/[^0-9.\-]/g, ""));
    // Sonic lots over a period, as a daily, weekly and monthly average (a
    // single month shows its own total).
    function lotsIn(p) {
      if (!lotDays) return null;
      if (p.current) p = periods[1];
      if (p.full) {
        var sums = {};
        ["daily", "weekly", "monthly"].forEach(function (k) {
          var w = p.full[k], t = 0;
          if (w) for (var d in lotDays) if (d >= w[0] && d <= w[1]) t += lotDays[d];
          sums[k] = t;
        });
        return sums;
      }
      var endDay = p[2] < last[0] ? p[2] : last[0], total = 0;
      for (var d in lotDays) if (d >= p[1] && d <= endDay) total += lotDays[d];
      var start = new Date(p[1] + "T00:00:00Z");
      start.setUTCDate(start.getUTCDate() - 1);
      var days = tradingDays(start.toISOString().slice(0, 10), endDay);
      if (!(days > 0)) return null;
      var running = !p[3] && p[2] >= last[0];
      return { daily: total / days, weekly: total / days * WEEK_DAYS, monthly: p[3] || running ? total / days * MONTH_DAYS : total };
    }
    function pctText(v) { return (v >= 0 ? "+" : "") + (v * 100).toFixed(2) + "%"; }
    // Plain tiles: percent big, cash below. Amplify tiles (cashFirst): cash
    // big, percent below.
    function tile(target, label, key, factor, hint, cashFirst, input) {
      var d = el("div", "tile");
      var k = el("div", "k", label);
      if (hint) { k.appendChild(document.createTextNode(" ")); k.appendChild(el("span", "hint", hint)); }
      d.appendChild(k);
      var v = el("div", "v"), c = el("div", "meta"), per = el("div", "per");
      d.appendChild(v); d.appendChild(c); d.appendChild(per);
      cells.push({ v: v, cash: c, per: per, key: key, factor: factor, rate: 0, cashFirst: cashFirst, input: input || null });
      target.appendChild(d);
    }

    // A purple tile with an amount the visitor types.
    function amountTile(target, id, hint, label, value) {
      var b = el("div", "tile tile-input");
      var k = el("label", "k");
      k.htmlFor = id;
      k.appendChild(el("span", "hint", hint));
      b.appendChild(k);
      var i = el("input", "balance-input");
      i.id = id;
      i.setAttribute("aria-label", label);
      i.type = "text"; i.inputMode = "decimal"; i.value = value; i.autocomplete = "off";
      b.appendChild(i);
      target.appendChild(b);
      i.addEventListener("input", recalc);
      i.addEventListener("focus", function () { i.select(); });
      i.addEventListener("blur", function () {
        var a = parseFloat(i.value.replace(/[^0-9.]/g, ""));
        if (isFinite(a)) i.value = "$" + a.toLocaleString("en-US", { maximumFractionDigits: 2 });
      });
      return i;
    }
    var inp = amountTile($("home-amount") || top, "balance-input", tx("Click to enter your\namount"), tx("Balance"), "$10,000");
    // Net profit with 12x or 24x Amplify (24x by default). A click on any
    // of the three tiles turns them over to the gross profit, and back.
    var flipped = false, curIndex = 0;
    var head = el("div", "flip-head"), flipTitle = el("span", "flip-title"), sw = el("div", "amp-switch");
    head.appendChild(flipTitle); head.appendChild(sw);
    top.appendChild(head);
    var flipBox = el("div", "flip-box tiles tiles-3");
    flipBox.setAttribute("role", "button"); flipBox.tabIndex = 0;
    top.appendChild(flipBox);
    ["Daily", "Weekly", "Monthly"].forEach(function (n) {
      var t = el("div", "flip-tile"), inner = el("div", "flip-inner");
      t.appendChild(inner);
      [["front", 1 - FEE], ["back", 1]].forEach(function (f) {
        var face = el("div", "tile face " + f[0]);
        face.appendChild(el("div", "k", tx(n)));
        var v = el("div", "v"), c = el("div", "meta");
        var per = el("div", "per");
        face.appendChild(v); face.appendChild(c); face.appendChild(per);
        inner.appendChild(face);
        cells.push({ v: v, cash: c, per: per, key: n.toLowerCase(), mult: f[1], rate: 0, cashFirst: true, input: null });
      });
      flipBox.appendChild(t);
    });
    function flip() {
      flipped = homeFlipped = !flipped; flipBox.classList.toggle("flipped", flipped); setFlipTitle();
      if (homeChart) homeChart(false);
    }
    flipBox.addEventListener("click", flip);
    // "Net profit" / "gross profit" in the note below turn the box too.
    top.addEventListener("click", function (e) {
      var a = e.target.closest && e.target.closest("[data-flip]");
      if (!a) return;
      e.preventDefault();
      if ((a.getAttribute("data-flip") === "gross") !== flipped) flip();
    });
    flipBox.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); flip(); } });
    function setFlipTitle() {
      var p = periods[curIndex];
      // "Last full period", singular, so the title and its turn-over sign
      // stay on one line; a smaller font if it still does not fit.
      flipTitle.textContent = tx((flipped ? "Gross Profit, " : "Net Profit, ") + homeAmp + "x Amplify") + " (" + (p.full ? tx("Last full period") : p[4] || p[0]) + ")";
      if (p.current) flipTitle.textContent = tx((flipped ? "Gross Profit, " : "Net Profit, ") + homeAmp + "x Amplify");
      flipTitle.style.fontSize = ""; flipTitle.style.whiteSpace = "";
      var room = head.clientWidth - sw.offsetWidth - 10, size = 13;
      flipTitle.style.whiteSpace = "nowrap";
      flipTitle.style.letterSpacing = "";
      while (room > 0 && flipTitle.offsetWidth > room && size > 11) { size -= 0.5; flipTitle.style.fontSize = size + "px"; }
      if (room > 0 && flipTitle.offsetWidth > room) flipTitle.style.letterSpacing = "0";
      if (room > 0 && flipTitle.offsetWidth > room) { flipTitle.style.fontSize = flipTitle.style.letterSpacing = flipTitle.style.whiteSpace = ""; }
    }
    window.addEventListener("resize", function () { setFlipTitle(); });
    [12, 24].forEach(function (n) {
      var b = el("button", "range", n + "x");
      b.type = "button";
      b.setAttribute("aria-pressed", String(n === homeAmp));
      b.addEventListener("click", function () {
        homeAmp = n;
        [].forEach.call(sw.children, function (x) { x.setAttribute("aria-pressed", String(x === b)); });
        choose(curIndex, true);
        if (homeChart) homeChart(false);
      });
      sw.appendChild(b);
    });
    top.appendChild(el("p", "amp-note")).innerHTML = tx('<a href="#" data-flip="net">Net profit</a> is 70% of the <a href="#" data-flip="gross">gross profit</a>. The other 30% is: 5% trader fee and 25% to the network as bonuses, 10 levels deep (see <a href="#" data-goto="panel-affiliate">Bonuses</a>).');

    // Affiliate tab: the whole team's volume and, beside it, the team's gross
    // 24x Amplify profit; below, the rule to qualify and two bonuses side by
    // side: 2.5% of that profit (10 generations deep) and a bonus per lot the
    // team trades. Both are paid weekly. The lot bonus uses $1.03 per team
    // lot, taken from three real weekly payouts (lot bonus / profit share bonus
    // of 11.6%, 10.7% and 14.2%, against $338 profit per Sonic lot since
    // October 2025).
    var aff = $("aff-body"), affTotal = null, affInp = null, affSel = null, lotCells = [];
    if (aff) {
      // Head row: the profit box's title on the left of its column, the
      // period filter on the right; the amount tile and the box below it
      // are then the same height.
      var affHead = el("div", "aff-head"), affHeadR = el("div", "aff-head-r");
      var affTitle = el("h3", "aff-title");
      var affFilter = el("div", "period");
      var affiliateStatus = el("p", "snapshot-status");
      affiliateStatus.setAttribute("translate", "no");
      aff.appendChild(affiliateStatus);
      affHead.appendChild(el("div"));
      affHeadR.appendChild(affTitle); affHeadR.appendChild(affFilter);
      affHead.appendChild(affHeadR);
      aff.appendChild(affHead);
      var affTop = el("div", "aff-top");
      aff.appendChild(affTop);
      affInp = amountTile(affTop, "team-input", tx("Click to enter your whole\nteam volume"), tx("Whole team volume"), "$100,000");
      function group(target, title, cls, head) {
        var box = el("fieldset", "amp-group " + cls);
        // A head title outside the box shows no period: the filter next to it does.
        if (head) head.textContent = tx(title);
        else { var lg = el("legend"); legends.push([lg, tx(title)]); box.appendChild(lg); }
        var row = el("div", "tiles tiles-3");
        box.appendChild(row);
        target.appendChild(box);
        return row;
      }
      var grossRow = group(affTop, "Team Gross Profit, 24x Amplify", "amp-gross", affTitle);
      ["Daily", "Weekly", "Monthly"].forEach(function (n) { tile(grossRow, tx(n), n.toLowerCase(), AMPLIFY, null, true, affInp); });
      aff.appendChild(el("p", "aff-rule", tx("To qualify for bonuses you need at least $250 put in copyX. Each friend you bring directly who has at least $250 in copyX unlocks one more generation in depth: 10 direct QUALIFIED friends, all 10 generations open.")));
      // Share bonus and lot bonus, both paid weekly, in one frame.
      // Box titles sit just above their frames, not on the border.
      aff.appendChild(el("h3", "aff-title box-title", tx("Weekly bonuses")));
      var weeklyBox = el("fieldset", "amp-group amp-net weekly-box");
      aff.appendChild(weeklyBox);
      var pair = el("div", "aff-pair");
      weeklyBox.appendChild(pair);
      var shareRow = group(pair, "Share bonus", "amp-net");
      ["Daily", "Weekly", "Monthly"].forEach(function (n) { tile(shareRow, tx(n), n.toLowerCase(), AMPLIFY * COMMISSION, null, true, affInp); });
      shareRow.children[1].classList.add("paid");
      var lotRow = group(pair, german ? "Lot-Bonus · historisch" : "Lot bonus · historical", "amp-net");
      var lotStatus = el("p", "snapshot-status");
      lotStatus.setAttribute("translate", "no");
      lotRow.parentNode.appendChild(lotStatus);
      ["Daily", "Weekly", "Monthly"].forEach(function (n) {
        var d = el("div", "tile" + (n === "Weekly" ? " paid" : ""));
        var k = el("div", "k", tx(n));
        d.appendChild(k);
        var v = el("div", "v pos"), m = el("div", "meta");
        d.appendChild(v); d.appendChild(m);
        lotRow.appendChild(d);
        var per = el("div", "per");
        d.appendChild(per);
        lotCells.push({ key: n.toLowerCase(), v: v, meta: m, per: per });
      });
      fetch("/data/lots.json", { cache: "no-cache" }).then(function (r) { return r.json(); })
        .then(function (d) { lotDays = d.days || {};
          var lastDay = Object.keys(lotDays).sort().pop() || "";
          for (var k in liveLots) if (k >= lastDay) lotDays[k] = liveLots[k]; recalc(); }).catch(function () {});
      affTotal = el("p", "aff-total");
      weeklyBox.appendChild(affTotal);
      var gbMonth = 0, grand = el("div", "grand");
      generalBonus(aff, function (v) { gbMonth = v; drawGrand(); }, function (lg) { legends.push([lg, tx("Monthly general bonus"), true]); });
      aff.appendChild(grand);
      var affNote = el("p", "aff-note");
      aff.appendChild(affNote);
      var separateNote = el("p", "snapshot-status", german ? "Share-Bonus = Teamvolumen × positiver Myfxbook-Periodengewinn × 24 × 2,5%; bei Verlust kein Share-Bonus. Der historische Lot-Bonus wird nicht mit dem laufenden Share-Bonus zu einer gemeinsamen Periodensumme addiert. Der Generalbonus ist eine unabhängige Eingabemodellrechnung. Alle Beträge sind Schätzungen, keine tatsächlichen Auszahlungen." : "Share bonus = team volume × positive Myfxbook period gain × 24 × 2.5%; losses earn no share bonus. Historical lot bonuses are not added to current share bonuses as a single period total. The general bonus is an independent input-based model. All amounts are estimates, not actual payouts.");
      separateNote.setAttribute("translate", "no");
      aff.appendChild(separateNote);
    }

    // Bonuses tab, bottom: everything per month, weekly bonuses plus the
    // general bonus.
    var shareMonth = 0, lotMonthly = 0;
    function drawGrand() {
      if (!aff || !grand) return;
      grand.innerHTML = "";
      grand.hidden = !!(curPeriod && curPeriod.current);
      if (grand.hidden) return;
      var sum = el("p", "grand-sum");
      function part(label, value, cls) {
        var p = el("span", "part" + (cls ? " " + cls : ""));
        p.appendChild(el("small", null, label));
        p.appendChild(el("b", null, "$" + Math.round(value).toLocaleString("en-US")));
        sum.appendChild(p);
      }
      [[tx("Share bonus"), shareMonth], [tx("Lot bonus"), lotMonthly], [tx("General bonus"), gbMonth]].forEach(function (x, i) {
        if (i) sum.appendChild(el("span", "op", "+"));
        part(x[0], x[1]);
      });
      sum.appendChild(el("span", "op", "="));
      part(tx("Total"), shareMonth + lotMonthly + gbMonth, "total");
      sum.appendChild(el("span", "grand-period", tx("Monthly")));
      grand.appendChild(sum);
    }


    var homeTrades = homeTradesTable(trades, tradesBalance || balance);
    function recalc() {
      var amount = parseFloat(inp.value.replace(/[^0-9.]/g, ""));
      cells.forEach(function (c) {
        if (c.rate == null) { c.v.textContent = "—"; c.cash.textContent = unavailable; return; }
        var amount = parseFloat((c.input || inp).value.replace(/[^0-9.]/g, ""));
        var abs = Math.abs(amount * c.rate), sg = c.rate < 0 ? "-" : "+";
        var cash = isFinite(amount) ? sg + money(abs) : "";
        // Amplify tiles: whole dollars.
        var big = isFinite(amount) ? sg + "$" + Math.round(abs).toLocaleString("en-US") : "";
        c.v.textContent = c.cashFirst ? big : pctText(c.rate);
        c.cash.textContent = c.cashFirst ? pctText(c.rate) : cash.replace(/^\+/, "");
      });
      if (homeTrades) homeTrades(amount);
      if (affTotal) {
        var team = parseFloat(affInp.value.replace(/[^0-9.]/g, ""));
        // Team lots: the Sonic lots scaled to the team volume, with 24x Amplify.
        var lots = curPeriod && lotsIn(curPeriod), per = LOT_BONUS;
        var lotPeriod = curPeriod && curPeriod.current ? periods[1] : curPeriod;
        var scale = isFinite(team) && sonicBal > 0 ? team / sonicBal * AMPLIFY : 0;
        lotCells.forEach(function (c) {
          var n = lots ? lots[c.key] * scale : 0;
          c.v.textContent = lots ? "+$" + Math.round(n * per).toLocaleString("en-US") : "";
          c.meta.textContent = lots ? F("{n} lots", { n: n.toFixed(1) }) : "";
          c.per.textContent = lotPeriod && lotPeriod.full && lotPeriod.full[c.key] ? lotPeriod.full[c.key][2] : "";
        });
        lotStatus.textContent = historyStatus + " · " + (lotPeriod ? lotPeriod[0] : "");
        lotRow.parentNode.querySelector("legend").textContent = (german ? "Lot-Bonus · historisch" : "Lot bonus · historical") + " (" + (lotPeriod ? lotPeriod[0] : "") + ")";
        var monthly = cells.filter(function (c) { return c.input === affInp && c.key === "monthly" && c.factor === AMPLIFY * COMMISSION; }).pop();
        var weekly = cells.filter(function (c) { return c.input === affInp && c.key === "weekly" && c.factor === AMPLIFY * COMMISSION; }).pop();
        var share = isFinite(team) && monthly ? team * monthly.rate : 0;
        var lotMonth = lots ? lots.monthly * scale * per : 0;
        var week = (isFinite(team) && weekly ? team * weekly.rate : 0) + (lots ? lots.weekly * scale * per : 0);
        affTotal.innerHTML = "";
        var line = el("span", "aff-sum");
        line.appendChild(el("span", "aff-sum-k", tx("Weekly bonuses")));
        var wk = el("span", "aff-week");
        wk.appendChild(el("strong", null, money(week)));
        wk.appendChild(el("small", null, " (" + tx("weekly") + ")"));
        var mo = el("span", "aff-month");
        mo.appendChild(el("strong", null, money(share + lotMonth)));
        mo.appendChild(el("small", null, " (" + tx("monthly") + ")"));
        line.appendChild(wk); line.appendChild(mo);
        shareMonth = share; lotMonthly = lotMonth; drawGrand();
        affTotal.appendChild(line);
        affNote.textContent = tx("Bonuses are approximate: this is only an estimate. The exact bonuses are shown in your copyX account. The share bonus and the lot bonus are paid weekly. The general bonus is counted per calendar month and paid at the start of the following month.") + " " + F("2.5% of the gross profit of the whole team, 10 generations deep: {a}. Lot bonus at an average of $1.03 per lot across the 10 levels: {b}. Based on the period chosen above.", { a: money(share), b: money(lotMonth) });
        if (curPeriod && curPeriod.current) {
          affTotal.textContent = (german ? "Share-Bonus dieser Woche: " : "Share bonus this week: ") + (isFinite(team) && weekly && weekly.rate != null ? money(team * weekly.rate) : unavailable);
          affNote.textContent = german ? "Laufende Periode zum Abrufzeitpunkt, keine Auszahlungsgarantie. Lot-Bonus und Generalbonus haben eine separate Berechnungsbasis; keine gemeinsame Gesamtsumme." : "Current period at retrieval, not a guaranteed payout. Lot and general bonuses have separate calculation bases; no combined total.";
        }
      }
    }
    function choose(i, keepChart) {
      var p = periods[i], r = rates(p) || { daily: 0, weekly: 0, monthly: 0 };
      curPeriod = p; curIndex = i;
      calculationStatus.textContent = (p.current ? metricStatus : historyStatus) + " · " + p[0] + (p.current ? (german ? "; bis zum Abruf, kein Tages-/Wochen-/Monatsabschluss." : "; through retrieval, not a closed day/week/month.") : "");
      if (affiliateStatus) affiliateStatus.textContent = calculationStatus.textContent;
      var chartP = p.current ? periods[1] : p;
      // Which chart button matches the period: a month, this year or all.
      chartPeriod = [chartP[1], chartP[2], chartP.full ? chartP.full.monthly[2] : chartP[4] || chartP[0], !chartP[3] ? 1 : chartP[4] ? 2 : 3];
      if (homeChart && !keepChart) homeChart(true);
      cells.forEach(function (c) {
        // Gross first; net is the gross minus the 30% fee, on profit only.
        if (c.mult != null) {
          c.rate = window.HomeMetrics.amplified(r[c.key], homeAmp, c.mult);
        } else if (c.factor === AMPLIFY * COMMISSION) {
          c.rate = window.HomeMetrics.share(r[c.key], AMPLIFY, COMMISSION);
        } else c.rate = r[c.key] == null ? null : r[c.key] * c.factor;
        c.v.className = "v " + (c.rate < 0 ? "neg" : "pos");
        if (c.per) c.per.textContent = p.current ? currentPeriods[c.key] : p.full && p.full[c.key] ? p.full[c.key][2] : "";
      });
      legends.forEach(function (l) { l[0].textContent = l[1] + (l[2] ? "" : " (" + (p[4] || p[0]) + ")"); });
      setFlipTitle();
      recalc();
    }

    if (filter) {
      var lab = el("label", "period-label", tx("Period"));
      lab.htmlFor = "period-select";
      var sel = el("select", "period-select");
      sel.id = "period-select";
      periods.forEach(function (p, i) { var o = el("option", null, p[0]); o.value = i; sel.appendChild(o); });
      sel.value = "0";
      filter.appendChild(lab); filter.appendChild(sel);
      // The Affiliate tab has its own copy of the filter; both stay in step.
      if (aff) {
        var lab2 = lab.cloneNode(true), sel2 = sel.cloneNode(true);
        lab2.htmlFor = sel2.id = "period-select-aff";
        sel2.value = sel.value;
        affFilter.appendChild(lab2); affFilter.appendChild(sel2);
        affSel = sel2;
      }
      [sel, affSel].forEach(function (x) {
        if (x) x.addEventListener("change", function () {
          sel.value = x.value; if (affSel) affSel.value = x.value;
          choose(+x.value);
        });
      });
    }
    choose(0);
  }

  // Home, side by side: size the chart so its box is as tall as the left
  // column (filter and tiles).
  function fitHomeChart() {
    var left = document.querySelector(".home-left"), box = $("chart-box"), chart = $("chart");
    if (!left || !box || !chart || box.offsetTop !== left.offsetTop) return;
    var room = left.offsetHeight - (box.offsetHeight - chart.offsetHeight), w = chart.clientWidth;
    if (room > 120 && w > 0) chart.setAttribute("data-h", Math.round(440 * room / w));
  }

  // General bonus (monthly), on the team's NEW volume of the month.
  // Levels from the compensation plan. 50% rule: one line counts for at most
  // half of a level's volume. Differential: from a line that reached its own
  // level you get only the difference between your level and its level; the
  // MVP assumes the biggest line reaches the level its own volume allows and
  // that the rest of the team comes from lines without a level of their own.
  var GB_LEVELS = [[10000, 1], [50000, 2], [200000, 3.5], [1000000, 5], [5000000, 5.5],
    [7500000, 6], [20000000, 6.5], [50000000, 7], [100000000, 7.5]];
  function gbLevel(total, biggest) {
    for (var i = GB_LEVELS.length - 1; i >= 0; i--) {
      var need = GB_LEVELS[i][0];
      if (Math.min(biggest, need / 2) + (total - biggest) >= need) return GB_LEVELS[i];
    }
    return null;
  }
  function gbLineLevel(vol) {
    for (var i = GB_LEVELS.length - 1; i >= 0; i--) if (vol >= GB_LEVELS[i][0]) return GB_LEVELS[i];
    return null;
  }
  function generalBonus(target, onChange, addLegend) {
    var box = el("fieldset", "amp-group gb");
    var lg = el("h3", "aff-title box-title gb-legend", tx("Monthly general bonus"));
    target.appendChild(lg);
    if (addLegend) addLegend(lg);
    var row = el("div", "gb-inputs");
    box.appendChild(row);
    function input(hint, value) {
      var b = el("div", "tile tile-input");
      var k = el("label", "k");
      k.appendChild(el("span", "hint", hint));
      b.appendChild(k);
      var i = el("input", "balance-input");
      i.type = "text"; i.inputMode = "decimal"; i.value = value; i.autocomplete = "off";
      i.setAttribute("aria-label", hint.replace(/\n/g, " "));
      k.htmlFor = i.id = "gb-" + Math.random().toString(36).slice(2, 8);
      b.appendChild(i);
      row.appendChild(b);
      i.addEventListener("input", calc);
      i.addEventListener("focus", function () { i.select(); });
      i.addEventListener("blur", function () {
        var a = num(i.value);
        if (isFinite(a)) i.value = "$" + a.toLocaleString("en-US", { maximumFractionDigits: 2 });
      });
      return i;
    }
    var totalIn = input(tx("Click to enter your team's\nnew monthly volume"), "$150,000");
    var lineIn = input(tx("Click to enter your biggest\nline's new monthly volume"), "$40,000");
    var out = el("div", "tiles tiles-3 gb-out");
    row.appendChild(out);
    function cell(label) {
      var d = el("div", "tile");
      d.appendChild(el("div", "k", label));
      var v = el("div", "v"), m = el("div", "meta"), m2 = el("div", "meta");
      d.appendChild(v); d.appendChild(m); d.appendChild(m2);
      out.appendChild(d);
      return { v: v, m: m, m2: m2 };
    }
    var cLevel = cell(tx("Your level")), cCounted = cell(tx("Counted volume")), cNext = cell(tx("Next level"));
    box.appendChild(el("p", "gb-foot", tx("To qualify for this bonus you need $10,000 of new volume in the month from your direct friends only; the 50% rule applies.")));
    var note = el("p", "gb-note");
    box.appendChild(note);
    var total = el("p", "aff-total gb-total");
    box.appendChild(total);
    target.appendChild(box);

    function num(v) { return parseFloat(String(v).replace(/[^0-9.]/g, "")); }
    function pct(r) { return r + "%"; }
    function money0(v) { return "$" + Math.round(v).toLocaleString("en-US"); }
    function counted(level, t, big) { return Math.min(big, level[0] / 2) + (t - big); }
    function calc() {
      var t = num(totalIn.value), biggest = Math.min(num(lineIn.value) || 0, t);
      if (!isFinite(t)) return;
      var lv = gbLevel(t, biggest), rate = lv ? lv[1] : 0;
      var ll = gbLineLevel(biggest), lineRate = Math.min(ll ? ll[1] : 0, rate);
      var fromLine = (rate - lineRate) / 100 * biggest, fromRest = rate / 100 * (t - biggest);
      cLevel.v.textContent = lv ? pct(rate) : "-";
      cLevel.m.textContent = lv ? F("from {v}", { v: money0(lv[0]) }) : tx("No level yet");
      cCounted.v.textContent = money0(lv ? counted(lv, t, biggest) : t);
      cCounted.m.textContent = lv ? F("a line counts up to {v}", { v: money0(lv[0] / 2) }) : "";
      var next = GB_LEVELS.filter(function (l) { return !lv || l[0] > lv[0]; })[0];
      cNext.v.textContent = next ? pct(next[1]) : "-";
      cNext.m.textContent = next ? F("from {v}", { v: money0(next[0]) }) : tx("Maximum level reached");
      note.textContent = F("Biggest line: its own level is {lr}, so from it you get {d} ({a}). Rest of the team: {r} of {rv} ({b}).",
        { lr: pct(ll ? ll[1] : 0), d: pct(Math.round((rate - lineRate) * 10) / 10), a: money0(fromLine), r: pct(rate), rv: money0(t - biggest), b: money0(fromRest) }) + " " +
        tx("Only new volume of the month counts, not the volume the team already has. Estimate: the exact bonus is shown in your copyX account.");
      total.innerHTML = "";
      var line = el("span", "aff-sum");
      line.appendChild(el("span", "aff-sum-k", tx("Monthly general bonus")));
      var mo = el("span", "aff-month");
      mo.appendChild(el("strong", null, money0(fromLine + fromRest)));
      mo.appendChild(el("small", null, " (" + tx("monthly") + ")"));
      line.appendChild(mo);
      total.appendChild(line);
      if (onChange) onChange(fromLine + fromRest);
    }
    calc();
  }


  // Myfxbook trade time "MM.DD.YYYY HH:MM" (broker server time) to a UTC
  // Date. The server runs on UTC+3 while US daylight saving time is on,
  // UTC+2 otherwise (same rule as the scraper).
  function brokerToUtc(text) {
    var m = /^(\d\d)\.(\d\d)\.(\d{4}) (\d\d):(\d\d)/.exec(text || "");
    if (!m) return null;
    var y = +m[3], t = Date.UTC(y, m[1] - 1, +m[2], +m[4], +m[5]);
    function sunday(month, from) {
      var d = new Date(Date.UTC(y, month, from));
      return Date.UTC(y, month, from + (7 - d.getUTCDay()) % 7);
    }
    var dst = t >= sunday(2, 8) && t < sunday(10, 1);
    return new Date(t - (dst ? 3 : 2) * 3600000);
  }

  // Weekday, short form in the site language ("Mon", "lun"), without the
  // abbreviation dot some languages add.
  function shortDay(d) {
    var lang = (window.i18n && i18n.lang) || "en";
    try {
      return d.toLocaleDateString(lang, { weekday: "short", timeZone: "UTC" }).replace(/\.$/, "").replace(/^./, function (c) { return c.toUpperCase(); });
    } catch (e) {
      return WEEKDAYS[d.getUTCDay()].slice(0, 3);
    }
  }

  // Home: the last 5 trades, sized for the visitor's balance with 24x
  // Amplify. The account's balance at each trade is the current balance
  // minus the profit of the trades closed after it.
  var PAGE = 10;
  function homeTradesTable(trades, balance) {
    var tb = document.querySelector("#home-trades tbody");
    if (!tb || !trades || !trades.length) return null;
    var bal = parseFloat(String(balance).replace(/[^0-9.\-]/g, ""));
    if (!(bal > 0)) return null;
    var rows = [], lastDay = null, shade = true;
    // The trades of the last 30 trading days (weekdays), counted back from
    // the latest close; 10 per page.
    var first = brokerToUtc(trades[0].close), cutoff = null;
    if (first) {
      var d = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), first.getUTCDate()));
      for (var n = 1; n < 30; ) { d.setUTCDate(d.getUTCDate() - 1); if (d.getUTCDay() % 6) n++; }
      cutoff = d.getTime();
    }
    trades.forEach(function (t) {
      var profit = parseFloat(t.profit.replace(/,/g, "")), lots = parseFloat(t.lots);
      var open = brokerToUtc(t.open), close = brokerToUtc(t.close);
      if (!isFinite(profit) || !isFinite(lots) || !open || !close) return;
      if (cutoff && close.getTime() < cutoff) return;
      var tr = el("tr");
      tr.appendChild(el("td", null, t.symbol));
      tr.appendChild(el("td", t.action === "Sell" ? "short" : "long", tx(t.action === "Sell" ? "Short" : "Long")));
      var size = el("td"), net = el("td", "net"), gross = el("td");
      tr.appendChild(size); tr.appendChild(net);
      tr.appendChild(el("td", null, shortDay(open)));
      tr.appendChild(el("td", null, shortDate(open)));
      tr.appendChild(el("td", null, t.open_price));
      tr.appendChild(el("td", null, t.close_price));
      tr.appendChild(el("td", null, open.toISOString().slice(11, 16)));
      tr.appendChild(el("td", null, close.toISOString().slice(11, 16)));
      tr.appendChild(gross);
      // Days alternate between two shades; trades of the same day share one.
      var day = open.toISOString().slice(0, 10);
      if (day !== lastDay) { shade = !shade; lastDay = day; }
      if (shade) tr.className = "day-alt";
      // The gain is on the balance before the trade, as in Daily.
      rows.push({ tr: tr, size: size, gross: gross, net: net, lots: lots, profit: profit, bal: bal - profit });
      bal -= profit;
    });
    if (!rows.length) return null;
    $("home-trades-box").hidden = false;
    var pager = $("home-trades-pager"), pages = Math.ceil(rows.length / PAGE), page = 0;
    function show() {
      tb.innerHTML = "";
      rows.slice(page * PAGE, page * PAGE + PAGE).forEach(function (r) { tb.appendChild(r.tr); });
      if (!pager) return;
      pager.innerHTML = "";
      if (pages < 2) return;
      var prev = el("button", "page-btn", "‹ " + tx("Previous")), next = el("button", "page-btn", tx("Next") + " ›");
      prev.type = next.type = "button";
      prev.disabled = page === 0; next.disabled = page === pages - 1;
      prev.addEventListener("click", function () { page--; show(); });
      next.addEventListener("click", function () { page++; show(); });
      pager.appendChild(prev);
      pager.appendChild(el("span", "page-info", F("Page {n} of {m}", { n: page + 1, m: pages })));
      pager.appendChild(next);
    }
    show();
    function signed(v) { return (v < 0 ? "-$" : "+$") + Math.abs(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
    return function (amount) {
      rows.forEach(function (r) {
        var ok = isFinite(amount) && amount > 0;
        var scale = ok ? amount * homeAmp / r.bal : 0;
        var g = r.profit * scale, n = g > 0 ? g * (1 - FEE) : g;
        r.size.textContent = ok ? F("{n} Lots", { n: (r.lots * scale).toFixed(2) }) : "";
        r.gross.textContent = ok ? signed(g) : "";
        r.net.textContent = "";
        if (ok) r.net.appendChild(el("span", null, signed(n)));
        r.gross.className = g < 0 ? "neg" : "pos";
        r.net.className = "net " + (n < 0 ? "neg" : "pos");
      });
    };
  }

  // Latest trades, 10 per page (Sonic page and Home).

  function renderTrades(trades) {
    var tb = document.querySelector("#trades tbody"), pager = $("trades-pager");
    if (!tb || !trades || !trades.length) return;
    var pages = Math.ceil(trades.length / PAGE), page = 0;
    function show() {
      tb.innerHTML = "";
      trades.slice(page * PAGE, page * PAGE + PAGE).forEach(function (t) {
        var tr = el("tr");
        [t.close, t.symbol, t.action, t.lots, t.open_price, t.close_price, t.pips, t.profit, t.duration, t.gain].forEach(function (v, i) {
          var cls = (i === 6 || i === 7 || i === 9) ? (/^-/.test(v) ? "neg" : "pos") : "";
          tr.appendChild(el("td", cls, v));
        });
        tb.appendChild(tr);
      });
      if (!pager) return;
      pager.innerHTML = "";
      if (pages < 2) return;
      var prev = el("button", "page-btn", "‹ " + tx("Previous")), next = el("button", "page-btn", tx("Next") + " ›");
      prev.type = next.type = "button";
      prev.disabled = page === 0; next.disabled = page === pages - 1;
      prev.addEventListener("click", function () { page--; show(); });
      next.addEventListener("click", function () { page++; show(); });
      pager.appendChild(prev);
      pager.appendChild(el("span", "page-info", F("Page {n} of {m}", { n: page + 1, m: pages })));
      pager.appendChild(next);
    }
    show();
  }

  function setupTabs() {
    var tabs = document.querySelectorAll(".tab");
    tabs.forEach(function (tab) {
      tab.addEventListener("click", function () {
        tabs.forEach(function (t) {
          var on = t === tab;
          t.setAttribute("aria-selected", String(on));
          $(t.getAttribute("data-tab")).hidden = !on;
        });
      });
    });
  }

  function render(data, metrics) {
    var display = metrics || data;
    var g = display.general || {};
    var a = display.advanced || {};
    var p = display.periods || {};
    var german = lang() === "de";
    var metricStatus = snapshotLabel(german ? "Kennzahlen-Abruf" : "Metrics retrieved", display.fetched_utc, true);
    var historyStatus = snapshotLabel(german ? "Diagramm- und Rechner-Abruf" : "Chart and calculator retrieval", data.fetched_utc);

    if ($("src-link")) $("src-link").href = data.source;
    if ($("fetched")) $("fetched").textContent = metricStatus;

    renderTiles(g, a);
    // Neue Kennzahlen werden niemals als Balance-Nenner historischer Rechner verwendet.
    renderHomeTiles(data.growth, data.trades, data.general.balance, data.trades_balance, metrics, metricStatus, historyStatus);
    var readAt = Date.parse(display.fetched_utc || "");
    if ($("home-updated")) $("home-updated").textContent = snapshotLabel(german ? "Trade-Archiv-Abruf" : "Trade archive retrieved", data.trades_fetched_utc || data.fetched_utc);
    if ($("home-trades-title")) {
      var archiveHeading = $("home-trades-title");
      archiveHeading.textContent = german ? "Historisches Trade-Archiv der " : "Historical trade archive: ";
      archiveHeading.appendChild(el("span", "sonic-name", german ? "Sonic-Strategie" : "Sonic strategy"));
    }
    var archive = Date.parse(data.trades_fetched_utc || data.fetched_utc || "");
    var archiveDate = new Date(archive).toLocaleDateString(lang() === "de" ? "de-DE" : "en-GB", { timeZone: "Europe/Berlin" });
    var archiveText = lang() === "de" ? "Einzeltrades: Archiv vom " + archiveDate + "; bei Myfxbook nicht öffentlich abrufbar." : "Individual trades: archive from " + archiveDate + "; not publicly available on Myfxbook.";
    archiveText += " " + snapshotLabel(german ? "Archiv-Abruf" : "Archive retrieval", data.trades_fetched_utc || data.fetched_utc);
    document.querySelectorAll(".reference-note").forEach(function (note) {
      note.textContent = "";
      [german ? "Öffentliche Myfxbook-Kennzahlen · Abruf Montag bis Freitag · keine Live-Verbindung." : "Public Myfxbook metrics · retrieval Monday to Friday · no live connection.",
       metricStatus + (metrics ? "" : (german ? " · separater Kennzahlenstand nicht verfügbar; letzter vollständiger Snapshot angezeigt." : " · separate metrics unavailable; showing last complete snapshot.")),
       historyStatus + (german ? " · nur historische Diagramme, Einzeltrades und Lot-Bonus. Gewinnanzeige und Share-Bonus verwenden standardmäßig die laufenden Kennzahlen; unverbindliche Modellrechnungen." : " · historical charts, trades and lot bonus only. Profit and share-bonus estimates default to current metrics; model calculations only.")].forEach(function (text) { note.appendChild(el("p", "snapshot-status", text)); });
      var link = el("a", null, german ? "Aktuelle öffentliche Kennzahlen auf der Sonic-Seite" : "Public metrics on the Sonic page");
      link.href = "/sonic#tiles";
      note.appendChild(link);
    });
    beforeStatus($("tiles"), metricStatus, "metrics-status");
    var homePeriods = !!$("home-periods-title");
    if (homePeriods) {
      $("home-periods-title").textContent = german ? "Aktuelle SONIC-Ergebnisse nach Zeitraum" : "Current SONIC results by period";
      $("home-periods-basis").textContent = metrics
        ? (german ? "SONIC-Originalkonto (USD), ohne Amplification. Keine Hochrechnung auf den oben gewählten Betrag." : "SONIC source account (USD), without Amplification. Not projected onto the amount selected above.")
        : (german ? "Aktuelle Perioden sind derzeit nicht verfügbar. Keine historischen Ersatzwerte." : "Current periods are unavailable. No historical substitute values.");
    }
    var periodStatus = homePeriods && !metrics
      ? (german ? "Kennzahlen-Snapshot nicht verfügbar; keine aktuellen Perioden darstellbar." : "Metrics snapshot unavailable; current periods cannot be displayed.")
      : metricStatus + (german ? " · Perioden wie bei Myfxbook zum Abrufzeitpunkt, nicht aktuelle Live-Perioden." : " · periods as reported by Myfxbook at retrieval, not live periods.");
    beforeStatus($("periods"), periodStatus, "metrics-status");
    beforeStatus($("account"), metricStatus, "metrics-status");
    beforeStatus($("advanced"), metricStatus, "metrics-status");
    beforeStatus($("chart"), historyStatus, "history-status");
    beforeStatus($("monthly"), historyStatus, "history-status");
    if (metrics) {
      var sourceText = (german ? "Myfxbook meldete beim Abruf: " : "Myfxbook reported at retrieval: ") + metrics.source_reported_update;
      var sourceAt = new Date(readAt - Number(metrics.source_age_seconds_at_capture) * 1000).toISOString();
      if (tradingAgeHours(sourceAt) > 36) sourceText += german ? " · Quellstand älter als 36 Stunden (ohne Wochenenden)." : " · source data over 36 hours old (excluding weekends).";
      beforeStatus($("tiles"), sourceText, "metrics-status");
    }
    [$("tab-trades"), $("home-trades")].forEach(function (box) {
      if (!box) return;
      var note = el("p", "note", archiveText);
      note.setAttribute("translate", "no");
      if (box.id === "home-trades") {
        note.appendChild(document.createTextNode(german ? " Die Tabellenwerte sind Modellrechnungen für den gewählten Betrag auf Basis archivierter Einzeltrades, keine aktuellen Tagesergebnisse. " : " Table values are model calculations for the selected amount based on archived individual trades, not current daily results. "));
        var currentResults = el("a", null, german ? "Aktuelle Tages- und Periodenergebnisse ansehen" : "View current daily and period results");
        currentResults.href = "/sonic#periods";
        note.appendChild(currentResults);
      }
      box.parentNode.insertBefore(note, box);
    });

    var tbody = document.querySelector("#periods tbody");
    // First row: the last day with trades. "Today", "Yesterday" or the weekday,
    // with the date, counted from the viewer's current UTC date.
    var firstLabel = "Today", firstRow = p.today;
    if (metrics) {
      firstLabel = (german ? "Tageswerte bei Abruf " : "Daily values at retrieval ") + fmtDay(metrics.today_date);
      if (!firstRow.available) firstLabel += german ? " · nicht gemeldet" : " · not reported";
    } else if (data.last_day) {
      var ld = data.last_day, dd = new Date(ld.date + "T00:00:00Z");
      var now = new Date(readAt), today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
      var diff = Math.round((today - dd.getTime()) / 86400000);
      var name = diff <= 0 ? tx("Today") : diff === 1 ? tx("Yesterday") : tx(WEEKDAYS[dd.getUTCDay()]);
      firstLabel = name + " (" + fmtDM(dd.getUTCMonth(), dd.getUTCDate()) + ")";
      firstRow = { gain: ld.gain, profit: ld.profit, pips: ld.pips, win_rate: ld.win_rate, trades: String(ld.trades), lots: ld.lots };
    }
    if (tbody && (!homePeriods || metrics)) [[firstLabel, null, firstRow], ["This week", "week"], ["This month", "month"], ["This year", "year"]].forEach(function (r) {
      var row = r[2] || p[r[1]];
      if (!row) return;
      var tr = el("tr");
      tr.appendChild(el("td", null, r[2] ? r[0] : tx(r[0])));
      ["gain", "profit", "pips", "win_rate", "trades", "lots"].forEach(function (c) {
        var cell = el("td", c === "gain" || c === "pips" ? sign(row[c]) : "", row[c] == null ? "—" : row[c]);
        if (row[c] == null) cell.title = german ? "Von Myfxbook bei diesem Abruf nicht gemeldet; kein Nullwert." : "Not reported by Myfxbook at retrieval; not a zero value.";
        tr.appendChild(cell);
      });
      tbody.appendChild(tr);
    });

    if ($("chart") && data.growth && data.growth.length > 1) {
      $("chart-box").hidden = false;
      fitHomeChart();
      if ($("chart-ranges")) homeChartRanges(fromCopyStart(data.growth));
      else growthChart($("chart"), data.growth);
    }
    if ($("monthly") && data.monthly_gain && data.monthly_gain.length) {
      $("monthly-box").hidden = false;
      var yr = data.monthly_gain[0][0].slice(-4);
      $("monthly-title").textContent = tx("Monthly gain") + ", " + yr;
      monthlyChart($("monthly"), data.monthly_gain);
    }
    renderTrades(data.trades);
    setupTabs();

    if ($("account")) kv($("account"), [
      ["Gain", g.gain], ["Absolute gain", g.abs_gain], ["Balance", g.balance], ["Equity", g.equity],
      ["Highest", g.highest], ["Profit", g.profit], ["Deposits", g.deposits], ["Withdrawals", g.withdrawals],
      ["Interest", g.interest], ["Drawdown", g.drawdown]
    ]);
    if ($("advanced")) kv($("advanced"), [
      ["Trades", a.trades], ["Pips", a.pips], ["Average win", a.average_win], ["Average loss", a.average_loss],
      ["Lots", a.lots], ["Commissions", a.commissions], ["Longs won", a.longs_won], ["Shorts won", a.shorts_won],
      ["Best trade ($)", a.best_trade_usd], ["Worst trade ($)", a.worst_trade_usd],
      ["Best trade (pips)", a.best_trade_pips], ["Worst trade (pips)", a.worst_trade_pips],
      ["Avg. trade length", a.avg_trade_length], ["Profit factor", a.profit_factor], ["Expectancy", a.expectancy]
    ]);
  }

  // Nur der lokal gespeicherte Tages-Snapshot; kein Live-Endpunkt oder Zusatzkonto.
  var liveLots = {};

  (window.i18n ? i18n.ready : Promise.resolve())
    .then(function () {
      var history = fetch("/data/sonic.json", { cache: "no-cache" }).then(function (r) { if (!r.ok) throw new Error("Historischer Snapshot fehlt"); return r.json(); });
      var metrics = fetch("/data/sonic-metrics.json", { cache: "no-cache" }).then(function (r) { if (!r.ok) throw new Error("Kennzahlen-Snapshot fehlt"); return r.json(); }).then(function (d) {
        if (d.schema_version !== 1 || d.account_name !== "SONIC AI" || d.source !== "https://www.myfxbook.com/members/SonicExperts/sonic-ai/12076857" || !d.general || !d.advanced || !d.periods || !isFinite(Date.parse(d.fetched_utc))) throw new Error("Ungültiger Kennzahlen-Snapshot");
        return d;
      }).catch(function (err) { if (window.console) console.warn(err); return null; });
      return Promise.all([history, metrics]);
    })
    .then(function (data) { render(data[0], data[1]); })
    .catch(function (err) {
      if (window.console) console.error(err);
      var target = document.getElementById("tiles") || document.getElementById("home-tiles");
      if (target) target.textContent = tx("The figures could not be loaded right now.");
    });
})();
