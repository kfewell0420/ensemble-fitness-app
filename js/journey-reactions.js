/* =========================================================================
   Reactions for the illustrative "Fitness Journey" example cards.
   These cards are explicitly fictional (see the note at the top of
   fitness-journey.html) — there's no real person or account behind any of
   them, so there's nothing to enforce server-side the way the real
   Share Your Journey reactions are (see js/hero-live-chat.js for that
   version, which is backed by the story_reactions table and real users).

   This is a lightweight, purely-decorative version: each card starts with a
   baseline count (data-base on the count span), a click toggles the
   visitor's own reaction on/off and adjusts the displayed count by one, and
   the on/off state persists per-browser via localStorage so it survives a
   refresh. Nothing here is shared between visitors or sent anywhere.
   ========================================================================= */
(function () {
  var STORAGE_PREFIX = "ensembleJourneyReaction:";

  function storageKey(journeyId, reaction) {
    return STORAGE_PREFIX + journeyId + ":" + reaction;
  }

  function readActive(journeyId, reaction) {
    try {
      return localStorage.getItem(storageKey(journeyId, reaction)) === "1";
    } catch (e) {
      return false; // localStorage unavailable (private mode, etc.) — just don't persist.
    }
  }

  function writeActive(journeyId, reaction, active) {
    try {
      if (active) localStorage.setItem(storageKey(journeyId, reaction), "1");
      else localStorage.removeItem(storageKey(journeyId, reaction));
    } catch (e) {
      // Ignore — the toggle still works for this page view, it just won't persist.
    }
  }

  function applyState(btn, active) {
    var countEl = btn.querySelector(".rx-count");
    if (!countEl) return;
    var base = parseInt(countEl.getAttribute("data-base"), 10) || 0;
    countEl.textContent = String(active ? base + 1 : base);
    btn.classList.toggle("active", active);
  }

  document.addEventListener("DOMContentLoaded", function () {
    var buttons = document.querySelectorAll(".journey-card-reactions .reaction-btn");
    if (!buttons.length) return;

    buttons.forEach(function (btn) {
      var card = btn.closest(".journey-card");
      var journeyId = card ? card.getAttribute("data-journey-id") : null;
      var reaction = btn.getAttribute("data-reaction");
      if (!journeyId || !reaction) return;
      applyState(btn, readActive(journeyId, reaction));

      btn.addEventListener("click", function () {
        var nowActive = !btn.classList.contains("active");
        writeActive(journeyId, reaction, nowActive);
        applyState(btn, nowActive);
      });
    });
  });
})();
