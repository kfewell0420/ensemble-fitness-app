/* =========================================================================
   Real, approved Share Your Journey posts — shown at the top of the
   Fitness Journey page, newest first, above the illustrative example
   cards. Real posts now get real reactions (clap/heart/thumbs up) and
   real replies, backed by story_reactions / story_replies — the same
   tables and rules used by the homepage's live chat widget — so members
   can actually coach and cheer each other on right here, not just on the
   homepage widget. Reacting or replying requires a signed-in member,
   same as everywhere else this feature appears.

   Nothing is ever deleted to make room for new posts — every approved
   post stays in community_questions forever. This just fetches a bounded
   page of them (newest first) and offers a "Load more" button to pull in
   older ones, so the page never has to render hundreds of cards at once.

   It also hides the illustrative example cards below, one by one, as real
   posts come in — up to a full swap-out once there are at least as many
   real posts as there were examples. Real posts always come first; the
   examples just fill whatever room is left.
   ========================================================================= */
(function () {
  var SUPABASE_URL = "https://wgrldwdgvvlhcmlyoxrl.supabase.co";
  var SUPABASE_ANON_KEY = "sb_publishable_4sbGE70Sh5gkgpmBqdGVBg_VkqjzJVx";
  var PAGE_SIZE = 12;
  var AVATAR_CLASSES = ["g1", "g2", "g3", "g4", "g5", "g6"];
  var REACTIONS = [
    { key: "clap", icon: "👏" },
    { key: "heart", icon: "❤️" },
    { key: "thumbs_up", icon: "👍" }
  ];
  var REFRESH_MS = 20000;

  if (!window.supabase) {
    // CDN didn't load — swap the "Loading…" line for something less confusing
    // than a spinner that never resolves.
    document.addEventListener("DOMContentLoaded", function () {
      var status = document.getElementById("journeyRealStatus");
      if (status) status.textContent = "Couldn't load recent journeys right now — please refresh to try again.";
    });
    return;
  }
  var sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  var offset = 0;
  var done = false;
  var loading = false;
  var hasSession = false;
  var myUserId = null;
  var loadedIds = []; // ids currently rendered, for the periodic reaction/reply refresh

  function escapeHtml(str) {
    var div = document.createElement("div");
    div.textContent = str == null ? "" : str;
    return div.innerHTML;
  }

  function initials(name) {
    var parts = (name || "").trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return "?";
    var first = parts[0].charAt(0);
    var second = parts.length > 1 ? parts[parts.length - 1].charAt(0) : (parts[0].charAt(1) || "");
    return (first + second).toUpperCase();
  }

  function avatarClass(seedStr) {
    var sum = 0;
    for (var i = 0; i < (seedStr || "").length; i++) sum += seedStr.charCodeAt(i);
    return AVATAR_CLASSES[sum % AVATAR_CLASSES.length];
  }

  function formatDate(iso) {
    try {
      var d = new Date(iso);
      return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
    } catch (e) {
      return "";
    }
  }

  function reactionCounts(reactions) {
    var counts = { clap: 0, heart: 0, thumbs_up: 0 };
    var mine = { clap: false, heart: false, thumbs_up: false };
    (reactions || []).forEach(function (r) {
      if (counts.hasOwnProperty(r.reaction)) counts[r.reaction]++;
      if (myUserId && r.user_id === myUserId) mine[r.reaction] = true;
    });
    return { counts: counts, mine: mine };
  }

  function reactionsHtml(id, reactions) {
    var rc = reactionCounts(reactions);
    var html = '<div class="journey-real-reactions" data-story-id="' + id + '">';
    REACTIONS.forEach(function (r) {
      var active = rc.mine[r.key];
      html += '<button type="button" class="reaction-btn' + (active ? ' active' : '') + '" data-story-id="' + id + '" data-reaction="' + r.key + '" data-active="' + (active ? "1" : "0") + '">' + r.icon + ' <span class="rx-count">' + rc.counts[r.key] + '</span></button>';
    });
    html += '</div>';
    return html;
  }

  function repliesHtml(replies) {
    if (!replies || !replies.length) return '<div class="journey-real-replies" data-role="replies"></div>';
    var html = '<div class="journey-real-replies" data-role="replies">';
    replies.forEach(function (reply) {
      var replyName = escapeHtml((reply.profiles && reply.profiles.display_name) || "A member");
      html += '<div class="journey-real-reply"><strong>' + replyName + '</strong>' + escapeHtml(reply.reply_text) + '</div>';
    });
    html += '</div>';
    return html;
  }

  function replyFormHtml(id) {
    return (
      '<form class="journey-real-reply-form" data-story-id="' + id + '">' +
        '<input type="text" class="journey-real-reply-input" maxlength="280" placeholder="Reply with encouragement…" aria-label="Reply with encouragement" />' +
        '<button type="submit" class="journey-real-reply-send">Send</button>' +
      '</form>'
    );
  }

  function cardHtml(row) {
    var name = row.asker_name || "A member";
    return (
      '<div class="journey-card journey-card-real" id="journey-' + row.id + '" data-real-id="' + row.id + '">' +
        '<div class="journey-card-top">' +
          '<div class="story-avatar ' + avatarClass(name + row.id) + '">' + escapeHtml(initials(name)) + '</div>' +
          '<div class="journey-card-info">' +
            '<div class="journey-name">' + escapeHtml(name) + '</div>' +
            '<div class="journey-started">' + formatDate(row.created_at) + '</div>' +
          '</div>' +
        '</div>' +
        '<p class="journey-quote">"' + escapeHtml(row.question_text) + '"</p>' +
        reactionsHtml(row.id, row.story_reactions) +
        repliesHtml(row.story_replies) +
        replyFormHtml(row.id) +
        '<div class="journey-real-signin-note" data-role="signin-note" style="display:none;">Sign in to your Ensemble Fitness account to react or reply — <a href="https://app.ensemblefitness.com/login.html" target="_blank" rel="noopener">Sign In</a></div>' +
      '</div>'
    );
  }

  // Nav badge links here as "fitness-journey.html#journey-<id>" so the
  // "new journeys" number actually takes you to the new journey, not just
  // the top of the page. Cards render async, so we can't rely on the
  // browser's native hash-jump-on-load — it fires before the card exists.
  function scrollToHashTarget() {
    var hash = window.location.hash;
    if (!hash || hash.indexOf("#journey-") !== 0) return;
    var target = document.getElementById(hash.slice(1));
    if (!target) return;
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    target.classList.add("journey-card-highlight");
    setTimeout(function () {
      target.classList.remove("journey-card-highlight");
    }, 2600);
  }

  // Hides illustrative example cards from the bottom up, one for each real
  // post that exists, so real posts effectively "replace" examples as they
  // come in. Never un-hides — if a post is later removed, the examples
  // simply stay hidden rather than flickering back in.
  function shrinkExamplesFor(realTotal) {
    var exampleCards = document.querySelectorAll(".journey-scroll .journey-card");
    if (!exampleCards.length) return;
    var toHide = Math.max(0, Math.min(realTotal, exampleCards.length));
    for (var i = exampleCards.length - 1, hidden = 0; i >= 0 && hidden < toHide; i--, hidden++) {
      exampleCards[i].style.display = "none";
    }
    var remaining = exampleCards.length - toHide;
    var hint = document.getElementById("journeyExampleCountHint");
    if (hint) {
      hint.textContent = remaining > 0
        ? "Showing " + remaining + " example " + (remaining === 1 ? "entry" : "entries") + " — scroll within the panel below to see more ↓"
        : "All the examples below have been replaced by real member journeys.";
    }
  }

  async function refreshExampleShrink() {
    try {
      var res = await sb
        .from("community_questions")
        .select("id", { count: "exact", head: true })
        .eq("status", "approved");
      if (res && typeof res.count === "number") shrinkExamplesFor(res.count);
    } catch (err) {
      // Leave the examples as-is if this fails — purely cosmetic.
    }
  }

  async function sendReaction(storyId, reaction, currentlyActive) {
    try {
      if (currentlyActive) {
        await sb.from("story_reactions").delete()
          .eq("question_id", storyId)
          .eq("user_id", myUserId)
          .eq("reaction", reaction);
      } else {
        await sb.from("story_reactions").insert({
          question_id: storyId,
          user_id: myUserId,
          reaction: reaction
        });
      }
    } catch (err) {
      // Swallow — a failed reaction toggle just leaves the count as-is.
    }
  }

  // Re-fetches reactions + replies for whatever real cards are currently on
  // the page and patches them in place, so cheering shows up for everyone
  // watching without a full reload or losing "Load more" position.
  async function refreshVisible(grid) {
    if (!loadedIds.length) return;
    try {
      var { data, error } = await sb
        .from("community_questions")
        .select("id, story_replies(id, reply_text, created_at, profiles(display_name)), story_reactions(reaction, user_id)")
        .in("id", loadedIds)
        .order("created_at", { ascending: true, foreignTable: "story_replies" });
      if (error || !data) return;
      data.forEach(function (row) {
        var card = document.getElementById("journey-" + row.id);
        if (!card) return;
        var reactionsEl = card.querySelector(".journey-real-reactions");
        if (reactionsEl) reactionsEl.outerHTML = reactionsHtml(row.id, row.story_reactions);
        var repliesEl = card.querySelector('[data-role="replies"]');
        if (repliesEl) repliesEl.outerHTML = repliesHtml(row.story_replies);
      });
    } catch (err) {
      // Quiet — this is a background refresh, not a user-triggered action.
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    var grid = document.getElementById("journeyRealGrid");
    var status = document.getElementById("journeyRealStatus");
    var loadMoreBtn = document.getElementById("journeyRealLoadMore");
    if (!grid || !status) return;

    sb.auth.getSession().then(function (res) {
      var session = res && res.data && res.data.session;
      hasSession = !!session;
      myUserId = session ? session.user.id : null;
    });
    sb.auth.onAuthStateChange(function (_event, session) {
      hasSession = !!session;
      myUserId = session ? session.user.id : null;
    });

    async function loadPage() {
      if (loading || done) return;
      loading = true;
      if (loadMoreBtn) loadMoreBtn.disabled = true;
      var isFirstPage = offset === 0;

      try {
        var { data, error } = await sb
          .from("community_questions")
          .select("id, asker_name, question_text, created_at, story_replies(id, reply_text, created_at, profiles(display_name)), story_reactions(reaction, user_id)")
          .eq("status", "approved")
          .order("created_at", { ascending: false })
          .order("created_at", { ascending: true, foreignTable: "story_replies" })
          .range(offset, offset + PAGE_SIZE - 1);

        if (error) throw error;

        if (offset === 0 && status) {
          status.remove();
          status = null;
        }

        (data || []).forEach(function (row) {
          grid.insertAdjacentHTML("beforeend", cardHtml(row));
          loadedIds.push(row.id);
        });

        if (offset === 0 && (!data || data.length === 0)) {
          grid.insertAdjacentHTML(
            "beforeend",
            '<p class="journey-real-status">No public journeys shared yet — <a href="share-your-journey.html">be the first to share yours →</a></p>'
          );
        }

        // The newest journey (what the nav badge links to) is always on the
        // first page since these are ordered newest-first.
        if (isFirstPage) scrollToHashTarget();

        offset += (data || []).length;
        if (!data || data.length < PAGE_SIZE) {
          done = true;
          if (loadMoreBtn) loadMoreBtn.style.display = "none";
        } else if (loadMoreBtn) {
          loadMoreBtn.style.display = "inline-flex";
        }

        refreshExampleShrink();
      } catch (err) {
        if (offset === 0 && status) {
          status.textContent = "Couldn't load recent journeys right now — please refresh to try again.";
        }
      } finally {
        loading = false;
        if (loadMoreBtn) loadMoreBtn.disabled = false;
      }
    }

    if (loadMoreBtn) {
      loadMoreBtn.addEventListener("click", loadPage);
    }

    grid.addEventListener("click", async function (e) {
      var reactBtn = e.target.closest(".reaction-btn");
      if (reactBtn) {
        var card = reactBtn.closest(".journey-card");
        if (!hasSession) {
          var note = card && card.querySelector('[data-role="signin-note"]');
          if (note) note.style.display = "block";
          return;
        }
        var storyId = reactBtn.getAttribute("data-story-id");
        var reaction = reactBtn.getAttribute("data-reaction");
        var active = reactBtn.getAttribute("data-active") === "1";
        reactBtn.disabled = true;
        await sendReaction(storyId, reaction, active);
        await refreshVisible(grid);
        return;
      }
    });

    grid.addEventListener("submit", async function (e) {
      var form = e.target.closest(".journey-real-reply-form");
      if (!form) return;
      e.preventDefault();
      var card = form.closest(".journey-card");
      if (!hasSession) {
        var note = card && card.querySelector('[data-role="signin-note"]');
        if (note) note.style.display = "block";
        return;
      }
      var input = form.querySelector(".journey-real-reply-input");
      var text = input && input.value.trim();
      if (!text) return;
      var sendBtn = form.querySelector(".journey-real-reply-send");
      if (sendBtn) sendBtn.disabled = true;
      try {
        await sb.from("story_replies").insert({
          question_id: form.getAttribute("data-story-id"),
          user_id: myUserId,
          reply_text: text
        });
        if (input) input.value = "";
        await refreshVisible(grid);
      } catch (err) {
        // Leave the typed text in place so the member can retry.
      } finally {
        if (sendBtn) sendBtn.disabled = false;
      }
    });

    loadPage();
    setInterval(function () { refreshVisible(grid); }, REFRESH_MS);
  });
})();
