// Verified Airline's policy pages: the button that shows or hides the Lean
// model, the popovers of the ∀ markers, and the dark mode button.  Whether the
// model shows, and the theme, are set before the page draws, by a script in
// each page's head (?lean=1 or the remembered choice; the remembered theme or
// the system setting); this script changes them and remembers the new choice.
(function () {
  "use strict";
  var KEY = "verified-airline-lean";
  var THEME_KEY = "verified-airline-theme";
  var root = document.documentElement;
  var system = window.matchMedia("(prefers-color-scheme: dark)");
  var current = null;

  function popover(button) {
    return document.getElementById(button.getAttribute("aria-controls"));
  }

  function close(returnFocus) {
    if (!current) return;
    var button = current;
    current = null;
    button.setAttribute("aria-expanded", "false");
    popover(button).hidden = true;
    if (returnFocus) button.focus();
  }

  function open(button) {
    close(false);
    button.setAttribute("aria-expanded", "true");
    popover(button).hidden = false;
    current = button;
  }

  function showModel(on) {
    root.classList.toggle("lean-on", on);
    try { localStorage.setItem(KEY, on ? "1" : "0"); } catch (e) { /* private browsing */ }
    syncToggles();
    if (!on) close(false);
  }

  function syncToggles() {
    var on = root.classList.contains("lean-on");
    document.querySelectorAll(".lean-toggle").forEach(function (b) {
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  function setTheme(theme) {
    root.setAttribute("data-theme", theme);
    document.querySelectorAll(".theme-toggle").forEach(function (b) {
      b.setAttribute("aria-pressed", theme === "dark" ? "true" : "false");
    });
  }

  // A choice that matches the system setting is forgotten, so the page
  // follows the system again.
  function chooseTheme(theme) {
    try {
      if ((theme === "dark") === system.matches) localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, theme);
    } catch (e) { /* private browsing */ }
    setTheme(theme);
  }

  function remembered() {
    try { return localStorage.getItem(THEME_KEY); } catch (e) { return null; }
  }

  syncToggles();
  setTheme(root.getAttribute("data-theme") === "dark" ? "dark" : "light");
  system.addEventListener("change", function () {
    var t = remembered();
    if (t !== "light" && t !== "dark") setTheme(system.matches ? "dark" : "light");
  });

  document.addEventListener("click", function (event) {
    var toggle = event.target.closest(".lean-toggle");
    if (toggle) {
      showModel(!root.classList.contains("lean-on"));
      return;
    }
    if (event.target.closest(".theme-toggle")) {
      chooseTheme(root.getAttribute("data-theme") === "dark" ? "light" : "dark");
      return;
    }
    var marker = event.target.closest("button.lean-marker");
    if (marker) {
      if (marker === current) close(true);
      else open(marker);
      return;
    }
    if (current && !event.target.closest(".lean-pop")) close(false);
  });

  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && current) {
      event.preventDefault();
      close(true);
    }
  });
})();
