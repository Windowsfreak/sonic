// Home: the event banners take turns every 5 seconds. The Krakow video starts
// on arrival, muted; the visitor can turn the sound on (it starts at 20%).
// While it plays the
// banners stay put; they start turning when it ends or when someone picks
// another banner. Hovering or focusing the banner pauses the turns.
(function () {
  var box = document.getElementById("events");
  if (!box) return;
  var slides = box.querySelectorAll(".slide"), dots = box.querySelector(".event-dots");
  if (slides.length < 2) return;
  var cur = 0, timer = null, held = false, stopped = false, buttons = [];

  function show(i) {
    slides[cur].classList.remove("is-active");
    buttons[cur].setAttribute("aria-current", "false");
    var v = slides[cur].querySelector("video");
    if (v && !v.paused) v.pause();
    cur = (i + slides.length) % slides.length;
    slides[cur].classList.add("is-active");
    buttons[cur].setAttribute("aria-current", "true");
  }
  function start() {
    clearInterval(timer);
    if (!stopped && !held) timer = setInterval(function () { show(cur + 1); }, 5000);
  }

  slides.forEach(function (s, i) {
    var b = document.createElement("button");
    b.type = "button";
    b.setAttribute("aria-label", s.getAttribute("aria-label"));
    b.setAttribute("aria-current", i === 0 ? "true" : "false");
    b.addEventListener("click", function () { show(i); start(); });
    dots.appendChild(b);
    buttons.push(b);
  });
  var video = slides[0].querySelector("video");
  if (video) {
    video.volume = 0.2;
    video.addEventListener("play", function () { stopped = true; clearInterval(timer); });
    video.addEventListener("pause", function () { stopped = false; start(); });
    video.addEventListener("ended", function () { stopped = false; show(cur + 1); start(); });
    video.muted = true;
    var p = video.play();
    if (p && p.catch) p.catch(function () {});
  }
  box.addEventListener("mouseenter", function () { held = true; clearInterval(timer); });
  box.addEventListener("mouseleave", function () { held = false; start(); });
  box.addEventListener("focusin", function () { held = true; clearInterval(timer); });
  box.addEventListener("focusout", function () { held = false; start(); });
  start();
})();

// Home: section tabs (Trading Sonic, Bonuses, Compensation Plan).
(function () {
  // The chosen tab is kept in the browser, so it stays open after a language change.
  var tabs = document.querySelectorAll(".page-tab[data-panel]");
  function open(tab) {
    tabs.forEach(function (t) {
      var on = t === tab;
      t.setAttribute("aria-selected", String(on));
      document.getElementById(t.getAttribute("data-panel")).hidden = !on;
    });
  }
  tabs.forEach(function (tab) {
    tab.addEventListener("click", function () {
      open(tab);
      try { localStorage.setItem("homeTab", tab.getAttribute("data-panel")); } catch (e) {}
    });
  });
  var saved = null;
  try { saved = localStorage.getItem("homeTab"); } catch (e) {}
  tabs.forEach(function (t) { if (t.getAttribute("data-panel") === saved) open(t); });
  // Links inside the page that open another tab (data-goto="panel-plan").
  document.addEventListener("click", function (ev) {
    var a = ev.target.closest && ev.target.closest("[data-goto]");
    if (!a) return;
    var tab = document.querySelector('.page-tab[data-panel="' + a.getAttribute("data-goto") + '"]');
    if (!tab) return;
    ev.preventDefault();
    tab.click();
    tab.scrollIntoView({ behavior: "smooth", block: "start" });
  });
})();

// EpixPay banner: on wider screens the title stays on one line; a longer
// translation gets a smaller font until it fits (style.css sets nowrap).
(function () {
  var title = document.querySelector(".event-epix .event-title");
  if (!title) return;
  function fit() {
    title.style.fontSize = "";
    if (getComputedStyle(title).whiteSpace !== "nowrap") return;
    var size = parseFloat(getComputedStyle(title).fontSize);
    while (title.scrollWidth > title.clientWidth && size > 14) { size -= 0.5; title.style.fontSize = size + "px"; }
  }
  // After the translation is in place (i18n.ready, then one frame).
  function later() { setTimeout(fit, 50); }
  (window.i18n ? i18n.ready : Promise.resolve()).then(later, later);
  window.addEventListener("load", later);
  window.addEventListener("resize", fit);
})();
