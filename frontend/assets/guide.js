// Guide: a click on a step's title row hides its content and leaves only the
// title; a second click shows it again. Keyboard: Enter or Space.
(function () {
  document.querySelectorAll(".step").forEach(function (step) {
    var head = step.querySelector(".step-head"), body = step.querySelector(".step-body");
    if (!head || !body) return;
    head.setAttribute("role", "button");
    head.setAttribute("tabindex", "0");
    head.setAttribute("aria-expanded", "true");
    function toggle() {
      var closed = step.classList.toggle("collapsed");
      head.setAttribute("aria-expanded", String(!closed));
    }
    head.addEventListener("click", function (ev) {
      if (ev.target.closest("a")) return;
      toggle();
    });
    head.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); toggle(); }
    });
  });
})();
