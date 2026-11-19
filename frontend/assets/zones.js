// Home, Time zones tab: the time of a Zoom call in every zone, with a short
// plain-text version to paste in WhatsApp (one line per time, short enough
// for a phone). Summer time is handled by the browser (Intl). Zones the
// visitor adds are kept in this browser only (localStorage).
(window.i18n ? i18n.ready : Promise.resolve()).then(function () {
  var app = document.getElementById("tz-app");
  if (!app) return;
  var tx = function (s) { return window.i18n ? i18n.t(s) : s; };
  var F = function (s, v) { return tx(s).replace(/\{(\w+)\}/g, function (_, k) { return v[k]; }); };

  // code: the three-letter country code used in the WhatsApp text (as in
  // football); short: a shorter city name for that text.
  var DEFAULT_ZONES = [
    { id: "la", city: "Los Angeles", country: "United States", code: "USA", flag: "🇺🇸", tz: "America/Los_Angeles" },
    { id: "mia", city: "Miami", country: "United States", code: "USA", flag: "🇺🇸", tz: "America/New_York" },
    { id: "nyc", city: "New York", short: "NYC", country: "United States", code: "USA", flag: "🇺🇸", tz: "America/New_York" },
    { id: "lon", city: "London", country: "United Kingdom", code: "ENG", flag: "🇬🇧", tz: "Europe/London" },
    { id: "bru", city: "Brussels", country: "Belgium", code: "BEL", flag: "🇧🇪", tz: "Europe/Brussels" },
    { id: "par", city: "Paris", country: "France", code: "FRA", flag: "🇫🇷", tz: "Europe/Paris" },
    { id: "ber", city: "Berlin", country: "Germany", code: "GER", flag: "🇩🇪", tz: "Europe/Berlin" },
    { id: "buc", city: "Bucharest", country: "Romania", code: "ROU", flag: "🇷🇴", tz: "Europe/Bucharest" },
    { id: "ath", city: "Athens", country: "Greece", code: "GRE", flag: "🇬🇷", tz: "Europe/Athens" },
    { id: "dxb", city: "Dubai", country: "United Arab Emirates", code: "UAE", flag: "🇦🇪", tz: "Asia/Dubai" },
    { id: "ind", city: "Mumbai", country: "India", code: "IND", flag: "🇮🇳", tz: "Asia/Kolkata" }
  ];
  DEFAULT_ZONES.forEach(function (z) { z.fixed = true; });

  var COMMON_TZ = ["America/Anchorage", "America/Los_Angeles", "America/Denver", "America/Chicago", "America/New_York", "America/Mexico_City", "America/Bogota", "America/Sao_Paulo", "America/Argentina/Buenos_Aires", "Atlantic/Reykjavik", "Europe/London", "Europe/Lisbon", "Europe/Madrid", "Europe/Paris", "Europe/Brussels", "Europe/Berlin", "Europe/Rome", "Europe/Zurich", "Europe/Athens", "Europe/Bucharest", "Europe/Istanbul", "Europe/Moscow", "Africa/Cairo", "Africa/Lagos", "Africa/Johannesburg", "Asia/Dubai", "Asia/Tehran", "Asia/Karachi", "Asia/Kolkata", "Asia/Dhaka", "Asia/Bangkok", "Asia/Singapore", "Asia/Hong_Kong", "Asia/Shanghai", "Asia/Tokyo", "Asia/Seoul", "Australia/Sydney", "Pacific/Auckland", "Pacific/Honolulu"];

  var zones = [];
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  // Zones the visitor added, in this browser only.
  function loadCustom() {
    try { return JSON.parse(localStorage.getItem("tzCustom") || "[]"); } catch (e) { return []; }
  }
  function saveCustom() {
    try { localStorage.setItem("tzCustom", JSON.stringify(zones.filter(function (z) { return !z.fixed; }))); } catch (e) {}
  }

  // Time math (summer time correct).
  function partsInZone(instant, tz) {
    var dtf = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    var p = {};
    dtf.formatToParts(instant).forEach(function (x) { if (x.type !== "literal") p[x.type] = x.value; });
    return p;
  }
  function zoneOffsetMs(tz, instant) {
    var p = partsInZone(instant, tz);
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - instant.getTime();
  }
  // Wall clock time in a zone, to the exact instant.
  function wallToInstant(y, mo, d, h, mi, tz) {
    var guess = Date.UTC(y, mo - 1, d, h, mi, 0);
    var off = zoneOffsetMs(tz, new Date(guess)), inst = guess - off;
    var off2 = zoneOffsetMs(tz, new Date(inst));
    if (off2 !== off) inst = guess - off2;
    return new Date(inst);
  }
  function dayIndex(p) { return Math.floor(Date.UTC(+p.year, +p.month - 1, +p.day) / 86400000); }
  function fmt24(p) { return p.hour + ":" + p.minute; }
  // Only zones with a real name (GMT, EST, PST...) get a label; offset-only
  // zones (Brussels, Dubai) get none.
  function isNamedZone(tz) {
    var jan = new Date(Date.UTC(new Date().getUTCFullYear(), 0, 15, 12, 0, 0));
    var p = new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" }).formatToParts(jan);
    var n = (p.filter(function (x) { return x.type === "timeZoneName"; })[0] || {}).value || "";
    return /^[A-Za-z]+$/.test(n);
  }
  function tzAbbrev(tz, instant) {
    if (!isNamedZone(tz)) return "";
    var locs = ["en-US", "en-GB"];
    for (var i = 0; i < locs.length; i++) {
      var p = new Intl.DateTimeFormat(locs[i], { timeZone: tz, timeZoneName: "short" }).formatToParts(instant);
      var n = (p.filter(function (x) { return x.type === "timeZoneName"; })[0] || {}).value || "";
      if (/^[A-Za-z]+$/.test(n)) return n;
    }
    return "";
  }
  function fmtRel(h) {
    if (h === 0) return "";
    var sign = h > 0 ? "+" : "−", abs = Math.abs(h), whole = Math.floor(abs), mins = Math.round((abs - whole) * 60);
    return sign + (mins ? whole + ":" + String(mins).padStart(2, "0") : whole + "h");
  }
  function uniq(a) { return a.filter(function (x, i) { return x && a.indexOf(x) === i; }); }

  // Page.
  app.innerHTML =
    '<div class="tz-head"><p class="tz-sub"><span class="tz-dot"></span>' + esc(tx("The time of the Zoom call in every zone")) + '</p>' +
    '<div class="tz-headbtns"><button type="button" class="tz-btn" id="tz-copy">' + esc(tx("Copy for WhatsApp")) + '</button>' +
    '<button type="button" class="tz-btn tz-accent" id="tz-now">↻ ' + esc(tx("Set to now")) + '</button></div></div>' +
    '<div class="tz-console">' +
      '<div class="tz-controls">' +
        '<div class="tz-field tz-grow"><label for="tz-ref">' + esc(tx("Reference city")) + '</label><select id="tz-ref"></select></div>' +
        '<div class="tz-field"><label for="tz-time">' + esc(tx("Time")) + '</label><input type="time" id="tz-time"></div>' +
        '<div class="tz-field"><label for="tz-date">' + esc(tx("Date")) + '</label><input type="date" id="tz-date"></div>' +
        '<div class="tz-field"><label>&nbsp;</label><button type="button" class="tz-btn" id="tz-addtoggle">+ ' + esc(tx("Add zone")) + '</button></div>' +
      '</div>' +
      '<div class="tz-rows" id="tz-rows"></div>' +
      '<div class="tz-add" id="tz-add">' +
        '<div class="tz-addgrid">' +
          '<div class="tz-field"><label for="tz-nflag">' + esc(tx("Flag")) + '</label><input type="text" id="tz-nflag" placeholder="🇯🇵" maxlength="8"></div>' +
          '<div class="tz-field"><label for="tz-ncity">' + esc(tx("City")) + '</label><input type="text" id="tz-ncity" placeholder="Tokyo"></div>' +
          '<div class="tz-field"><label for="tz-ncountry">' + esc(tx("Country")) + '</label><input type="text" id="tz-ncountry" placeholder="Japan"></div>' +
          '<div class="tz-field tz-full"><label for="tz-ntz">' + esc(tx("Time zone")) + '</label><input type="text" id="tz-ntz" list="tz-list" placeholder="Asia/Tokyo"><datalist id="tz-list"></datalist></div>' +
        '</div>' +
        '<div class="tz-addrow"><button type="button" class="tz-btn tz-accent" id="tz-save">' + esc(tx("Add zone")) + '</button><span class="tz-hint" id="tz-hint"></span></div>' +
      '</div>' +
      '<div class="tz-foot"><span class="tz-note" id="tz-note"></span><div class="tz-footbtns">' +
        '<button type="button" class="tz-btn" id="tz-reset">' + esc(tx("Reset to defaults")) + '</button></div></div>' +
    '</div>' +
    '<p class="tz-help">' + tx('<b>How to use it.</b> Pick the reference city, usually your own, and set the time and date of the call. The list shows that moment in every zone. Untick the cities you do not need, or add others with + Add zone. Then press Copy for WhatsApp: you get a short message with the date and the time in each city, ready to paste in your team\'s group. No more working out time differences by hand.') + '</p>' +
    '<div class="tz-out" id="tz-out"><div class="tz-out-head"><span>' + esc(tx("Plain text: tap inside, or use Copy")) + '</span>' +
      '<button type="button" class="tz-btn" id="tz-copy2">' + esc(tx("Copy")) + '</button></div>' +
      '<textarea id="tz-text" readonly spellcheck="false"></textarea></div>';

  var $ = function (id) { return document.getElementById(id); };
  var HINT = tx("Pick a time zone from the list, or type any IANA name (for example Asia/Tokyo, America/Sao_Paulo). Summer time is handled automatically.");
  $("tz-hint").textContent = HINT;

  // Cities left out of the WhatsApp text (unticked), kept in this browser.
  var off = {};
  try { off = JSON.parse(localStorage.getItem("tzOff") || "{}"); } catch (e) {}
  function saveOff() { try { localStorage.setItem("tzOff", JSON.stringify(off)); } catch (e) {} }

  function currentRows(onlyOn) {
    var ref = zones.filter(function (z) { return z.id === $("tz-ref").value; })[0] || zones[0];
    var t = ($("tz-time").value || "09:00").split(":").map(Number);
    var d = ($("tz-date").value || "").split("-").map(Number);
    if (!d[0]) return null;
    var instant = wallToInstant(d[0], d[1], d[2], t[0], t[1], ref.tz);
    var refDay = dayIndex(partsInZone(instant, ref.tz)), refOff = zoneOffsetMs(ref.tz, instant);
    var groups = [], byKey = {};
    zones.filter(function (z) { return !onlyOn || !off[z.id]; }).forEach(function (z) {
      var p = partsInZone(instant, z.tz), off = zoneOffsetMs(z.tz, instant);
      var c = { t: fmt24(p), dayDelta: dayIndex(p) - refDay, rel: (off - refOff) / 3600000, sortOff: off };
      var key = c.t + "|" + c.dayDelta;
      if (!byKey[key]) { c.items = []; byKey[key] = c; groups.push(c); }
      byKey[key].items.push(z);
    });
    groups.sort(function (a, b) { return a.sortOff - b.sortOff; });
    return { ref: ref, instant: instant, groups: groups.map(function (g) {
      return {
        items: g.items,
        flags: uniq(g.items.map(function (z) { return z.flag; })).join(" "),
        cities: g.items.map(function (z) { return z.city; }).join(" / "),
        countries: uniq(g.items.map(function (z) { return z.country; })).join(" / "),
        abbr: uniq(g.items.map(function (z) { return tzAbbrev(z.tz, instant); })).join("/"),
        isRef: g.items.some(function (z) { return z.id === ref.id; }),
        dayDelta: g.dayDelta, rel: g.rel, time: g.t,
        customIds: g.items.filter(function (z) { return !z.fixed; }).map(function (z) { return z.id; })
      };
    }) };
  }

  function render() {
    var data = currentRows();
    if (!data) return;
    // One row per city, even when several share the time (each has its team).
    var rows = [];
    data.groups.forEach(function (g) { g.items.forEach(function (z) { rows.push([g, z]); }); });
    $("tz-rows").innerHTML = rows.map(function (r) {
      var g = r[0], z = r[1], isRef = z.id === data.ref.id;
      var day = g.dayDelta !== 0 ? '<span class="tz-day">' + (g.dayDelta > 0 ? "+" : "") + g.dayDelta + "d</span>" : "";
      var rel = isRef ? '<span class="tz-reftag">' + esc(tx("ref")) + "</span>" : g.rel ? '<span class="tz-rel">' + fmtRel(g.rel) + "</span>" : "";
      var rm = z.fixed ? "" : '<button type="button" class="tz-remove" title="' + esc(tx("Remove")) + '" data-rm="' + z.id + '">\u2715</button>';
      return '<div class="tz-row' + (isRef ? " tz-isref" : "") + (off[z.id] ? " tz-off" : "") + '">' +
        '<label class="tz-toggle" title="' + esc(tx("In the WhatsApp text")) + '"><input type="checkbox" data-on="' + z.id + '"' + (off[z.id] ? "" : " checked") + '><span></span></label>' +
        '<div class="tz-flag">' + z.flag + "</div>" +
        '<div class="tz-place"><div class="tz-city">' + esc(z.city) + '</div><div class="tz-meta">' +
          (z.country ? "<span>" + esc(z.country) + "</span>" + (rel || day ? "<span>\u00B7</span>" : "") : "") + rel + day + "</div></div>" +
        '<div class="tz-abbr">' + tzAbbrev(z.tz, data.instant) + '</div><div class="tz-time">' + g.time + "</div>" + rm + "</div>";
    }).join("");
    [].forEach.call($("tz-rows").querySelectorAll("[data-on]"), function (c) {
      c.addEventListener("change", function () {
        var id = c.getAttribute("data-on");
        if (c.checked) delete off[id]; else off[id] = true;
        saveOff(); render();
      });
    });
    [].forEach.call($("tz-rows").querySelectorAll("[data-rm]"), function (b) {
      b.addEventListener("click", function () { removeZones(b.getAttribute("data-rm").split(",")); });
    });
    $("tz-note").textContent = F("Reference: {city}", { city: data.ref.city }) + " · " + data.ref.tz;
    if ($("tz-out").classList.contains("open")) $("tz-text").value = buildText(data);
  }

  // Plain text for WhatsApp: short enough for one line on a phone. One city:
  // "🇬🇧 London, ENG"; several in one country: "🇺🇸 Miami / NYC, USA";
  // several countries: "🇧🇪 BEL / 🇫🇷 FRA / 🇩🇪 GER".
  function buildText(data) {
    data = currentRows(true);
    if (!data) return "";
    // First line: the day and date of the reference city, in the site
    // language ("Thursday, 1 October 2026", "Joi, 1 octombrie 2026").
    var d = ($("tz-date").value || "").split("-").map(Number), head = "";
    try {
      head = new Date(Date.UTC(d[0], d[1] - 1, d[2], 12)).toLocaleDateString(((window.i18n && i18n.lang) || "en") + "-u-ca-gregory",
        { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
      head = head.charAt(0).toUpperCase() + head.slice(1) + "\n";
    } catch (e) {}
    return head + data.groups.map(function (g) {
      var codes = uniq(g.items.map(function (z) { return z.code; }));
      // Several countries: each flag before its name ("🇧🇪 BEL / 🇫🇷 FRA").
      var place = g.items.length === 1 ? g.items[0].flag + " " + g.items[0].city + (codes[0] ? ", " + codes[0] : "")
        : codes.length === 1 ? g.items[0].flag + " " + g.items.map(function (z) { return z.short || z.city; }).join(" / ") + ", " + codes[0]
        : codes.map(function (c) { return g.items.filter(function (z) { return z.code === c; })[0].flag + " " + c; }).join(" / ");
      var dayTag = g.dayDelta !== 0 ? " (" + (g.dayDelta > 0 ? "+" : "") + g.dayDelta + "d)" : "";
      return place + " - " + g.time + (g.abbr ? " " + g.abbr : "") + dayTag;
    }).join("\n");
  }

  function copyText() {
    var text = buildText();
    $("tz-text").value = text;
    $("tz-out").classList.add("open");
    $("tz-text").focus(); $("tz-text").select();
    function done(ok) {
      [$("tz-copy"), $("tz-copy2")].forEach(function (b) {
        b.dataset.label = b.dataset.label || b.textContent;
        b.textContent = ok ? tx("Copied") + " ✓" : tx("Select and copy");
        b.classList.toggle("tz-ok", ok);
      });
      clearTimeout(copyText.t);
      copyText.t = setTimeout(function () {
        [$("tz-copy"), $("tz-copy2")].forEach(function (b) { b.textContent = b.dataset.label; b.classList.remove("tz-ok"); });
      }, 2200);
    }
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(function () { done(true); }, fallback);
    else fallback();
    function fallback() { var ok = false; try { ok = document.execCommand("copy"); } catch (e) {} done(ok); }
  }

  function fillRef() {
    var sel = $("tz-ref"), cur = sel.value;
    sel.innerHTML = zones.map(function (z) { return '<option value="' + z.id + '">' + z.flag + " " + esc(z.city) + (z.code ? " (" + esc(z.code) + ")" : "") + "</option>"; }).join("");
    sel.value = cur && zones.some(function (z) { return z.id === cur; }) ? cur : "nyc";
    if (!sel.value) sel.value = zones[0].id;
  }
  function setNow() {
    var ref = zones.filter(function (z) { return z.id === $("tz-ref").value; })[0] || zones[0];
    var p = partsInZone(new Date(), ref.tz);
    $("tz-time").value = p.hour + ":" + p.minute;
    $("tz-date").value = p.year + "-" + p.month + "-" + p.day;
    render();
  }
  var hintTimer;
  function flashHint(msg, isErr) {
    var h = $("tz-hint");
    h.textContent = msg; h.classList.toggle("tz-err", isErr); h.classList.toggle("tz-good", !isErr);
    clearTimeout(hintTimer);
    hintTimer = setTimeout(function () { h.textContent = HINT; h.classList.remove("tz-err", "tz-good"); }, 3500);
  }
  function addZone() {
    var flag = $("tz-nflag").value.trim(), city = $("tz-ncity").value.trim(), country = $("tz-ncountry").value.trim(), tz = $("tz-ntz").value.trim();
    if (!city || !tz) { flashHint(tx("Add at least a city and a time zone."), true); return; }
    try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); } catch (e) { flashHint(tx("That time zone name is not valid. Try one from the list."), true); return; }
    zones.push({ id: "c" + Date.now().toString(36), city: city, country: country, code: country.slice(0, 3).toUpperCase(), flag: flag || "🏳️", tz: tz, fixed: false });
    saveCustom();
    $("tz-nflag").value = $("tz-ncity").value = $("tz-ncountry").value = $("tz-ntz").value = "";
    fillRef(); render();
    flashHint(F("Added {city}.", { city: city }), false);
  }
  function removeZones(ids) {
    zones = zones.filter(function (z) { return ids.indexOf(z.id) < 0; });
    saveCustom(); fillRef(); render();
  }
  function resetAll() {
    zones = DEFAULT_ZONES.map(function (z) { return Object.assign({}, z); });
    saveCustom(); fillRef(); setNow();
  }

  $("tz-list").innerHTML = COMMON_TZ.map(function (t) { return '<option value="' + t + '">'; }).join("");
  zones = DEFAULT_ZONES.map(function (z) { return Object.assign({}, z); })
    .concat(loadCustom().map(function (z) { return Object.assign({}, z, { fixed: false }); }));
  fillRef();
  setNow();
  ["tz-ref", "tz-time", "tz-date"].forEach(function (id) { $(id).addEventListener("input", render); });
  $("tz-ref").addEventListener("change", render);
  $("tz-now").addEventListener("click", setNow);
  $("tz-addtoggle").addEventListener("click", function () { $("tz-add").classList.toggle("open"); });
  $("tz-save").addEventListener("click", addZone);
  $("tz-copy").addEventListener("click", copyText);
  $("tz-copy2").addEventListener("click", copyText);
  $("tz-reset").addEventListener("click", resetAll);
  $("tz-ntz").addEventListener("keydown", function (e) { if (e.key === "Enter") addZone(); });
});
