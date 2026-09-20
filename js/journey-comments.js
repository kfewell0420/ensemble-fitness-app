/* =========================================================================
   "Send encouragement" for the illustrative Fitness Journey example cards.
   Same spirit as js/journey-reactions.js: these are fictional cards (see
   the note at the top of fitness-journey.html), so there's no real account
   or backend behind this — it's a fun, purely-decorative way for a visitor
   to drop one of five preset encouraging notes on a card. The seeded
   comments baked into the page are illustrative too; anything a visitor
   adds is stored locally in their own browser (localStorage) so it's still
   there if they come back, but nobody else ever sees it.
   ========================================================================= */
(function () {
  var STORAGE_PREFIX = "ensembleJourneyComments:";

  function storageKey(journeyId) {
    return STORAGE_PREFIX + journeyId;
  }

  function readMine(journeyId) {
    try {
      var raw = localStorage.getItem(storageKey(journeyId));
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  function writeMine(journeyId, list) {
    try {
      localStorage.setItem(storageKey(journeyId), JSON.stringify(list));
    } catch (e) {
      // Ignore — the comment still shows for this page view, it just won't persist.
    }
  }

  function escapeHtml(str) {
    var div = document.createElement("div");
    div.textContent = str == null ? "" : str;
    return div.innerHTML;
  }

  function appendCommentEl(listEl, text, mine) {
    var el = document.createElement("div");
    el.className = "journey-comment" + (mine ? " is-mine" : "");
    el.innerHTML = "<strong>" + (mine ? "You" : "A member") + "</strong>" + escapeHtml(text);
    listEl.appendChild(el);
    listEl.scrollTop = listEl.scrollHeight;
  }

  document.addEventListener("DOMContentLoaded", function () {
    var cards = document.querySelectorAll(".journey-card");
    if (!cards.length) return;

    cards.forEach(function (card) {
      var journeyId = card.getAttribute("data-journey-id");
      var listEl = card.querySelector(".journey-card-comments");
      var select = card.querySelector(".journey-comment-select");
      var sendBtn = card.querySelector(".journey-comment-send");
      if (!journeyId || !listEl || !select || !sendBtn) return;

      // Replay anything this visitor already sent to this card.
      readMine(journeyId).forEach(function (text) {
        appendCommentEl(listEl, text, true);
      });

      sendBtn.addEventListener("click", function () {
        var text = select.value;
        if (!text) return;
        sendBtn.disabled = true;
        appendCommentEl(listEl, text, true);
        var mine = readMine(journeyId);
        mine.push(text);
        writeMine(journeyId, mine);
        select.value = "";
        sendBtn.disabled = false;
      });
    });
  });
})();
