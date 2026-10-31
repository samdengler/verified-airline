// Verified Airline's policy pages: the button that shows or hides the Lean
// model, and the popovers of the ∀ markers.  Whether the model shows is set
// before the page draws, by a script in each page's head (?lean=1 or the
// remembered choice); this script changes it and remembers the new choice.
(function () {
  "use strict";
  var KEY = "verified-airline-lean";
  var root = document.documentElement;
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

  syncToggles();

  document.addEventListener("click", function (event) {
    var toggle = event.target.closest(".lean-toggle");
    if (toggle) {
      showModel(!root.classList.contains("lean-on"));
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
