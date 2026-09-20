// Ensemble Fitness — marketing site interactions

// Real video lightbox — opens any real (Supabase-backed) member video large,
// with native controls, so playback actually works instead of trying to
// play inside a small thumbnail. Scripts are loaded at the end of <body>,
// so the modal markup already exists in the DOM by the time this runs.
//
// This is a "reel", not a single popup: hero-live-feed.js fills
// window.__ensembleVideoFeed with every real video it fetched (from both
// the hero strip and the "Latest Workouts" grid), and openVideoLightbox
// takes an INDEX into that shared list rather than a bare src — so once
// open, a visitor can scroll/swipe/click straight through every real video
// on the page without ever closing this and picking another thumbnail.
(function () {
  var lightbox = document.getElementById("videoLightbox");
  var backdrop = document.getElementById("videoLightboxBackdrop");
  var closeBtn = document.getElementById("videoLightboxClose");
  var player = document.getElementById("videoLightboxPlayer");
  var card = document.getElementById("videoLightboxCard");
  var metaEl = document.getElementById("videoLightboxMeta");
  var prevBtn = document.getElementById("videoLightboxPrev");
  var nextBtn = document.getElementById("videoLightboxNext");
  var upNextEl = document.getElementById("videoLightboxUpNext");
  if (!lightbox || !player) return;

  var currentIndex = -1;

  function feed() { return window.__ensembleVideoFeed || []; }

  // ---- Preload the next couple videos --------------------------------
  // The "up next" thumbnails below only use preload="metadata" (just
  // enough to draw a poster frame) and are hidden on narrow screens
  // anyway. Neither actually removes the loading spinner someone sees
  // after swiping/clicking to the next video. This keeps a small pool of
  // off-screen <video preload="auto"> elements pointed at the next 1-2
  // videos in the feed, so their bytes are already sitting in the
  // browser's cache by the time renderCurrent() sets player.src to the
  // same URL — the TikTok/Instagram "never see a spinner" feel.
  var PRELOAD_COUNT = 2;
  var preloadPool = [];
  function ensurePreloadPool(size) {
    while (preloadPool.length < size) {
      var v = document.createElement("video");
      v.muted = true;
      v.playsInline = true;
      v.preload = "auto";
      v.setAttribute("aria-hidden", "true");
      v.tabIndex = -1;
      v.style.cssText = "position:absolute; width:1px; height:1px; opacity:0; pointer-events:none; left:-9999px; top:-9999px;";
      document.body.appendChild(v);
      preloadPool.push(v);
    }
  }
  function preloadUpcoming() {
    var list = feed();
    var upcoming = list.slice(currentIndex + 1, currentIndex + 1 + PRELOAD_COUNT);
    ensurePreloadPool(PRELOAD_COUNT);
    preloadPool.forEach(function (v, i) {
      var item = upcoming[i];
      var wantedSrc = item ? item.url : "";
      if (wantedSrc && v.getAttribute("data-src") !== wantedSrc) {
        v.setAttribute("data-src", wantedSrc);
        v.src = wantedSrc;
        v.load();
      } else if (!wantedSrc && v.hasAttribute("data-src")) {
        v.removeAttribute("data-src");
        v.removeAttribute("src");
        v.load();
      }
    });
  }

  // ---- Real reactions (👍 / 💪) + real comments ---------------------------
  // No heart here on purpose — that's reserved for Meal Prep posts. These
  // are real counts/comments pulled from the same tables the member app
  // uses, via the same public anon key (media_reactions/media_comments now
  // have a public-read policy so a signed-out visitor can see them — see
  // sql/public-read-reactions-comments.sql).
  //
  // Whether a visitor can actually CLICK these (vs. just being sent to sign
  // in) depends on siteCurrentUserId below, which comes from the shared
  // sign-in cookie (js/shared-session.js) — the same one the member app
  // writes when someone signs in there. No account, no shared session yet?
  // Every control opens sign-in in a new tab instead of posting anything,
  // so the video they were watching isn't lost.
  var REACTIONS = [
    { key: "thumbs_up", emoji: "👍" },
    { key: "muscle", emoji: "💪" }
  ];
  var reactionsEl = document.getElementById("videoReactions");
  var commentsListEl = document.getElementById("videoCommentsList");
  var commentSigninBtn = document.getElementById("videoCommentSigninBtn");
  var commentFormEl = document.getElementById("videoCommentForm");
  var commentInputEl = document.getElementById("videoCommentInput");
  var commentPostBtn = document.getElementById("videoCommentPostBtn");
  // A plain client, same as before this feature existed — it keeps its OWN
  // session in this site's normal localStorage once it has one. See
  // refreshSiteAuth() for how it gets that first session.
  var videoSb = window.supabase
    ? window.supabase.createClient(
        "https://wgrldwdgvvlhcmlyoxrl.supabase.co",
        "sb_publishable_4sbGE70Sh5gkgpmBqdGVBg_VkqjzJVx"
      )
    : null;

  var siteCurrentUserId = null;

  // Re-checked before every video's reactions load, and again whenever this
  // tab regains focus — so if someone signs in from a NEW tab (the normal
  // flow below) and switches back here, the buttons switch from "sign in"
  // to "react for real" without needing a page reload.
  //
  // Fast path: this client already has its own working session (from a
  // previous visit) — just use it. Otherwise, look for the small handoff
  // cookie the member app leaves (js/shared-session.js) and, if it's
  // there, hand its two tokens to THIS client with setSession() — a
  // one-time bootstrap. From then on this client manages and refreshes
  // that session itself, independent of the cookie.
  async function refreshSiteAuth() {
    if (!videoSb) { siteCurrentUserId = null; return null; }

    var { data } = await videoSb.auth.getSession();
    if (data && data.session && data.session.user) {
      siteCurrentUserId = data.session.user.id;
      return siteCurrentUserId;
    }

    var handoff = (typeof readCrossDomainSession === "function") ? readCrossDomainSession() : null;
    if (handoff) {
      var { data: setData, error } = await videoSb.auth.setSession({
        access_token: handoff.access_token,
        refresh_token: handoff.refresh_token
      });
      if (!error && setData && setData.session && setData.session.user) {
        siteCurrentUserId = setData.session.user.id;
        return siteCurrentUserId;
      }
    }

    siteCurrentUserId = null;
    return null;
  }

  // goToMemberSignIn(videoId) is defined once, globally, in
  // js/shared-session.js, loaded before this file — it sends someone to
  // sign in and, passing this video's id, brings them right back to THIS
  // exact video afterward (see the "reopen on return" block near the
  // bottom of this file) instead of just landing on their profile.

  function renderReactionCounts(mediaId, counts, myReactions) {
    if (!reactionsEl) return;
    reactionsEl.innerHTML = REACTIONS.map(function (r) {
      var active = !!(myReactions && myReactions[r.key]);
      return '<button type="button" class="video-reaction-btn' + (active ? " active" : "") + '" data-reaction="' + r.key + '">' +
        '<span>' + r.emoji + '</span>' +
        '<span class="video-reaction-count">' + (counts[r.key] || 0) + '</span>' +
      '</button>';
    }).join("");
    reactionsEl.querySelectorAll(".video-reaction-btn").forEach(function (btn) {
      if (siteCurrentUserId) {
        btn.addEventListener("click", function () { toggleVideoReaction(mediaId, btn.dataset.reaction); });
      } else {
        btn.addEventListener("click", function () { goToMemberSignIn(mediaId); });
      }
    });
  }

  // Each reaction type is its own row (media_id, user_id, reaction_type) so
  // 👍 and 💪 can both be active on the same video at once — clicking one
  // only ever adds/removes that one, never swaps out the other.
  async function toggleVideoReaction(mediaId, reactionType) {
    if (!siteCurrentUserId) { goToMemberSignIn(mediaId); return; }

    var { data: existing } = await videoSb
      .from("media_reactions")
      .select("reaction_type")
      .eq("media_id", mediaId)
      .eq("user_id", siteCurrentUserId)
      .eq("reaction_type", reactionType)
      .maybeSingle();

    if (existing) {
      await videoSb.from("media_reactions").delete()
        .eq("media_id", mediaId).eq("user_id", siteCurrentUserId).eq("reaction_type", reactionType);
    } else {
      await videoSb.from("media_reactions").insert({ media_id: mediaId, user_id: siteCurrentUserId, reaction_type: reactionType });
    }

    if (feed()[currentIndex] && feed()[currentIndex].id === mediaId) loadReactionsAndComments(mediaId);
  }

  function renderComments(comments) {
    if (!commentsListEl) return;
    commentsListEl.innerHTML = (comments && comments.length)
      ? comments.map(function (c) {
          var name = (c.profiles && c.profiles.display_name) || "A member";
          return '<div class="video-comment-item">' +
            '<span class="video-comment-name">' + escapeHtml(name) + '</span>' +
            '<div class="video-comment-body">' + escapeHtml(c.body) + '</div>' +
          '</div>';
        }).join("")
      : '<div class="video-comment-empty">No comments yet.</div>';

    if (commentFormEl) commentFormEl.hidden = !siteCurrentUserId;
    if (commentSigninBtn) commentSigninBtn.hidden = !!siteCurrentUserId;
  }

  async function postVideoComment(mediaId) {
    if (!commentInputEl || !siteCurrentUserId) return;
    var body = commentInputEl.value.trim();
    if (!body) return;

    if (commentPostBtn) commentPostBtn.disabled = true;
    var { error } = await videoSb.from("media_comments").insert({ media_id: mediaId, user_id: siteCurrentUserId, body: body });
    if (commentPostBtn) commentPostBtn.disabled = false;
    if (error) return;

    commentInputEl.value = "";
    if (feed()[currentIndex] && feed()[currentIndex].id === mediaId) loadReactionsAndComments(mediaId);
  }

  async function loadReactionsAndComments(mediaId) {
    if (reactionsEl) reactionsEl.innerHTML = "";
    if (commentsListEl) commentsListEl.innerHTML = "";
    if (!videoSb || !mediaId) return;

    await refreshSiteAuth();
    if (feed()[currentIndex] && feed()[currentIndex].id !== mediaId) return;

    var { data: reactions } = await videoSb
      .from("media_reactions")
      .select("user_id, reaction_type")
      .eq("media_id", mediaId);

    // Bail out quietly if the visitor moved to a different video while this
    // was in flight.
    if (feed()[currentIndex] && feed()[currentIndex].id !== mediaId) return;

    var counts = { thumbs_up: 0, muscle: 0 };
    var myReactions = {};
    (reactions || []).forEach(function (r) {
      if (counts[r.reaction_type] != null) counts[r.reaction_type] += 1;
      if (siteCurrentUserId && r.user_id === siteCurrentUserId) myReactions[r.reaction_type] = true;
    });
    renderReactionCounts(mediaId, counts, myReactions);

    var { data: comments } = await videoSb
      .from("media_comments")
      .select("body, created_at, profiles!media_comments_user_id_fkey(display_name)")
      .eq("media_id", mediaId)
      .order("created_at", { ascending: false })
      .limit(5);

    if (feed()[currentIndex] && feed()[currentIndex].id !== mediaId) return;
    renderComments(comments);
  }

  if (commentSigninBtn) {
    commentSigninBtn.addEventListener("click", function () {
      var item = feed()[currentIndex];
      goToMemberSignIn(item ? item.id : null);
    });
  }
  if (commentPostBtn) {
    commentPostBtn.addEventListener("click", function () {
      var item = feed()[currentIndex];
      if (item) postVideoComment(item.id);
    });
  }
  if (commentInputEl) {
    commentInputEl.addEventListener("keydown", function (e) {
      if (e.key !== "Enter") return;
      var item = feed()[currentIndex];
      if (item) postVideoComment(item.id);
    });
  }

  // Defensive fallback for anyone who ends up signed in via some OTHER tab
  // (not the normal flow anymore — see goToMemberSignIn/the auto-reopen
  // block below, which now navigate this same tab there and back) — if
  // that happens, re-check auth and refresh the currently-open video's
  // controls next time they switch back to this tab, rather than leaving
  // stale "sign in" buttons showing.
  window.addEventListener("focus", function () {
    if (!lightbox.classList.contains("open")) return;
    var item = feed()[currentIndex];
    if (item) loadReactionsAndComments(item.id);
  });

  function postedLabel(isoString) {
    var seconds = Math.floor((Date.now() - new Date(isoString).getTime()) / 1000);
    if (seconds < 60) return "Posted just now";
    var minutes = Math.floor(seconds / 60);
    if (minutes < 60) return "Posted " + minutes + "m ago";
    var hours = Math.floor(minutes / 60);
    if (hours < 24) return "Posted " + hours + "h ago";
    var days = Math.floor(hours / 24);
    return "Posted " + days + "d ago";
  }

  function escapeHtml(str) {
    var div = document.createElement("div");
    div.textContent = str || "";
    return div.innerHTML;
  }

  function renderCurrent() {
    var list = feed();
    var item = list[currentIndex];
    if (!item) return;

    player.src = item.url;
    player.muted = false;
    player.currentTime = 0;
    var playPromise = player.play();
    if (playPromise && playPromise.catch) playPromise.catch(function () {});

    if (metaEl) {
      var sub = [postedLabel(item.created_at)];
      if (item.workout_type) sub.push(escapeHtml(item.workout_type));
      metaEl.innerHTML =
        '<div class="video-lightbox-name">' + escapeHtml(item.name) + '</div>' +
        '<div class="video-lightbox-sub">' + sub.join(" · ") + '</div>';
    }

    if (prevBtn) prevBtn.disabled = currentIndex <= 0;
    if (nextBtn) nextBtn.disabled = currentIndex >= list.length - 1;

    renderUpNext();
    preloadUpcoming();
    loadReactionsAndComments(item.id);
  }

  // A quiet peek at what's coming — desktop only (hidden on narrow screens
  // by CSS) — so scrolling to the next video isn't a total guess. The
  // whole feed is already fetched up front by hero-live-feed.js, so this
  // just slices the next few items out of it — no extra fetching needed.
  function renderUpNext() {
    if (!upNextEl) return;
    var list = feed();
    var upcoming = list.slice(currentIndex + 1, currentIndex + 4);
    if (!upcoming.length) { upNextEl.innerHTML = ""; return; }

    var html = '<div class="video-lightbox-upnext-label">Up next</div>';
    upcoming.forEach(function (item, i) {
      html += '<div class="video-lightbox-upnext-item' + (i === 0 ? ' next-up' : '') + '" data-jump="' + (currentIndex + 1 + i) + '">' +
        '<video src="' + item.url + '" muted playsinline preload="metadata"></video>' +
      '</div>';
    });
    upNextEl.innerHTML = html;
  }

  // Fades (and gently slides) the card out in the direction it was
  // dismissed, swaps the video, fades back in — so moving to the next
  // video feels like a real vertical swipe rather than an abrupt cut.
  function transitionRender(direction) {
    if (!card) { renderCurrent(); return; }
    card.classList.add("transitioning");
    card.classList.toggle("slide-prev", direction === "prev");
    card.classList.toggle("slide-next", direction !== "prev");
    setTimeout(function () {
      renderCurrent();
      card.classList.remove("transitioning", "slide-prev", "slide-next");
    }, 150);
  }

  function closeLightbox() {
    lightbox.classList.remove("open");
    lightbox.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
    player.pause();
    player.removeAttribute("src");
    player.load();
    currentIndex = -1;
    resumeBackgroundVideos();
  }

  // Every real video slot in the hero strip and "Latest Workouts" grid
  // autoplays on its own, muted, in a loop — great for the page at a
  // glance, but once several real videos exist they're all quietly
  // streaming at the same time in the background. That competes for the
  // same bandwidth as the one video someone actually opened here, which
  // is what shows up as periodic stutter/rebuffering in the big player.
  // Pausing every other <video> on the page while this lightbox is open
  // (and resuming them on close) removes that contention.
  function pauseBackgroundVideos() {
    document.querySelectorAll("video").forEach(function (v) {
      if (v !== player) v.pause();
    });
  }
  function resumeBackgroundVideos() {
    document.querySelectorAll("video").forEach(function (v) {
      if (v === player) return;
      var playPromise = v.play();
      if (playPromise && playPromise.catch) playPromise.catch(function () {});
    });
  }

  window.openVideoLightbox = function (index) {
    var list = feed();
    if (!list.length) return;
    currentIndex = Math.max(0, Math.min(index, list.length - 1));
    pauseBackgroundVideos();
    renderCurrent();
    lightbox.classList.add("open");
    lightbox.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
  };

  function goPrev() {
    if (currentIndex <= 0) return;
    currentIndex -= 1;
    transitionRender("prev");
  }

  function goNext() {
    var list = feed();
    if (currentIndex >= list.length - 1) return;
    currentIndex += 1;
    transitionRender("next");
  }

  if (closeBtn) closeBtn.addEventListener("click", closeLightbox);
  if (backdrop) backdrop.addEventListener("click", closeLightbox);
  if (prevBtn) prevBtn.addEventListener("click", goPrev);
  if (nextBtn) nextBtn.addEventListener("click", goNext);

  if (upNextEl) {
    upNextEl.addEventListener("click", function (e) {
      var el = e.target.closest(".video-lightbox-upnext-item");
      if (!el) return;
      var idx = parseInt(el.getAttribute("data-jump"), 10);
      if (isNaN(idx) || idx === currentIndex || !feed()[idx]) return;
      var direction = idx > currentIndex ? "next" : "prev";
      currentIndex = idx;
      transitionRender(direction);
    });
  }

  document.addEventListener("keydown", function (e) {
    if (!lightbox.classList.contains("open")) return;
    if (e.key === "Escape") closeLightbox();
    else if (e.key === "ArrowUp" || e.key === "ArrowLeft") goPrev();
    else if (e.key === "ArrowDown" || e.key === "ArrowRight") goNext();
  });

  // Mouse wheel / trackpad — one scroll gesture = one step. The lock keeps
  // a single fling from skipping several videos at once.
  var wheelLocked = false;
  lightbox.addEventListener("wheel", function (e) {
    if (!lightbox.classList.contains("open")) return;
    e.preventDefault();
    if (wheelLocked || Math.abs(e.deltaY) < 12) return;
    wheelLocked = true;
    if (e.deltaY > 0) goNext(); else goPrev();
    setTimeout(function () { wheelLocked = false; }, 550);
  }, { passive: false });

  // Touch swipe — swipe up for the next video, down for the previous one
  // (same vertical convention as TikTok/Reels/Shorts).
  var touchStartY = null;
  lightbox.addEventListener("touchstart", function (e) {
    touchStartY = e.touches[0].clientY;
  }, { passive: true });
  lightbox.addEventListener("touchend", function (e) {
    if (touchStartY === null) return;
    var deltaY = touchStartY - e.changedTouches[0].clientY;
    touchStartY = null;
    if (Math.abs(deltaY) < 45) return;
    if (deltaY > 0) goNext(); else goPrev();
  });

  // Auto-reopen after a sign-in round trip: goToMemberSignIn(videoId) (in
  // js/shared-session.js) sends a signed-out visitor to the member app to
  // sign in, then brings them straight back to THIS page with the video's
  // id in a "?video=" param. Once hero-live-feed.js finishes fetching the
  // real video list — it dispatches "ensembleFeedReady" right after setting
  // window.__ensembleVideoFeed — look for that id and reopen the lightbox
  // to it automatically, so the whole trip feels like "sign in, then land
  // right back on the same video," not "go dig through the page again."
  function openVideoFromUrlIfPresent() {
    var videoId = new URLSearchParams(window.location.search).get("video");
    if (!videoId) return;
    var list = feed();
    var idx = -1;
    for (var i = 0; i < list.length; i++) {
      if (String(list[i].id) === videoId) { idx = i; break; }
    }
    if (idx === -1) return; // video not in the list (yet, or removed) — leave the page as-is
    window.openVideoLightbox(idx);
    // Strip "video" back out of the URL so refreshing or sharing this link
    // later doesn't keep popping the lightbox back open.
    var params = new URLSearchParams(window.location.search);
    params.delete("video");
    var qs = params.toString();
    var cleanUrl = window.location.pathname + (qs ? "?" + qs : "") + window.location.hash;
    window.history.replaceState(null, "", cleanUrl);
  }

  if (window.__ensembleVideoFeed && window.__ensembleVideoFeed.length) {
    openVideoFromUrlIfPresent();
  } else {
    document.addEventListener("ensembleFeedReady", openVideoFromUrlIfPresent);
  }
})();

document.addEventListener("DOMContentLoaded", function () {

  // Mobile menu
  var menuToggle = document.getElementById("menuToggle");
  var menuClose = document.getElementById("menuClose");
  var mobileMenu = document.getElementById("mobileMenu");

  if (menuToggle && mobileMenu) {
    menuToggle.addEventListener("click", function () {
      mobileMenu.classList.add("open");
      document.body.style.overflow = "hidden";
    });
  }
  if (menuClose && mobileMenu) {
    menuClose.addEventListener("click", closeMenu);
  }
  if (mobileMenu) {
    mobileMenu.querySelectorAll("a").forEach(function (a) {
      a.addEventListener("click", closeMenu);
    });
  }
  function closeMenu() {
    mobileMenu.classList.remove("open");
    document.body.style.overflow = "";
  }

  // FAQ accordion
  var faqItems = document.querySelectorAll(".faq-item");
  faqItems.forEach(function (item) {
    var q = item.querySelector(".faq-q");
    var a = item.querySelector(".faq-a");
    if (!q || !a) return;

    // set initial state
    if (item.classList.contains("open")) {
      a.style.maxHeight = a.scrollHeight + "px";
    }

    q.addEventListener("click", function () {
      var isOpen = item.classList.contains("open");

      // close all others
      faqItems.forEach(function (other) {
        other.classList.remove("open");
        var otherA = other.querySelector(".faq-a");
        if (otherA) otherA.style.maxHeight = null;
      });

      if (!isOpen) {
        item.classList.add("open");
        a.style.maxHeight = a.scrollHeight + "px";
      }
    });
  });

  // Recalculate open FAQ height on resize (text reflow)
  window.addEventListener("resize", function () {
    var openItem = document.querySelector(".faq-item.open .faq-a");
    if (openItem) openItem.style.maxHeight = openItem.scrollHeight + "px";
  });

  // Charter member enrollment form — saves to Supabase (same project as the
  // rest of the app) so it lands in admin.html for you to review and
  // approve/deny. Nothing here bypasses that review: the row is inserted as
  // "pending" and stays invisible to everyone but an admin until approved.
  var CHARTER_SUPABASE_URL = "https://wgrldwdgvvlhcmlyoxrl.supabase.co";
  var CHARTER_SUPABASE_ANON_KEY = "sb_publishable_4sbGE70Sh5gkgpmBqdGVBg_VkqjzJVx";
  var form = document.getElementById("waitlistForm");
  var success = document.getElementById("formSuccess");
  var formError = document.getElementById("formError");

  // Captured the moment this script runs, which is right at page load
  // (this file loads at the end of <body>) — used below as "how long was
  // the form actually on screen before this got submitted." A real person
  // needs at least a couple seconds to read the form and type into it; an
  // automated bot that found this page and blasted the form typically
  // submits in a fraction of a second.
  var waitlistFormRenderedAt = Date.now();

  if (form && success) {
    form.addEventListener("submit", function (e) {
      e.preventDefault();

      // Spam guards — silently pretend it worked either way, rather than
      // showing an error: never tip off a bot that it was caught (which
      // just teaches it to adapt), and never bother anyone with an email
      // for a submission that was never real in the first place. A real
      // person who's somehow tripped one of these (extremely unlikely —
      // the honeypot field is invisible and skipped by real browsers'
      // normal tabbing/typing, and 1.5s is a very low bar) loses nothing:
      // they just don't get a row in the review queue, same as if they'd
      // never submitted.
      var honeypot = form.querySelector('[name="website"]');
      var tooFast = Date.now() - waitlistFormRenderedAt < 1500;
      if ((honeypot && honeypot.value.trim() !== "") || tooFast) {
        form.style.display = "none";
        success.classList.add("show");
        return;
      }

      var data = {
        name: form.name.value.trim(),
        email: form.email.value.trim(),
        zip: form.zip.value.trim(),
        wants_tester: form.tester.checked
      };

      if (formError) formError.textContent = "";

      if (!window.supabase) {
        if (formError) formError.textContent = "Couldn't reach the server just now — please try again in a moment.";
        return;
      }

      var sb = window.supabase.createClient(CHARTER_SUPABASE_URL, CHARTER_SUPABASE_ANON_KEY);
      var submitBtn = form.querySelector('button[type="submit"]');
      if (submitBtn) submitBtn.disabled = true;

      sb.from("charter_enrollments").insert(data).then(function (res) {
        if (res.error) {
          if (submitBtn) submitBtn.disabled = false;
          if (formError) formError.textContent = "Couldn't submit that just now — please try again in a moment.";
          return;
        }
        form.style.display = "none";
        success.classList.add("show");
      });
    });
  }

  // Fit Marketplace partner/advertiser inquiry form (front-end only — wire
  // this up to a real backend such as Formspree or your own API before launch)
  var partnerForm = document.getElementById("partnerForm");
  var partnerSuccess = document.getElementById("partnerSuccess");

  if (partnerForm && partnerSuccess) {
    partnerForm.addEventListener("submit", function (e) {
      e.preventDefault();

      var data = {
        brand: partnerForm.brand.value.trim(),
        email: partnerForm.email.value.trim(),
        category: partnerForm.category.value.trim(),
        message: partnerForm.message.value.trim()
      };
      console.log("Partner inquiry (wire this up to a real backend):", data);

      partnerForm.style.display = "none";
      partnerSuccess.classList.add("show");
    });
  }

  // ------------------------------------------------------------------
  // Community feed — active-members rail + video feed + story viewer
  //
  // FEED_POSTS is sample/placeholder content so the layout can be
  // previewed before the real product exists. Two statuses matter and
  // are never conflated in the UI:
  //   - isActiveNow: the member is currently checked in / live right
  //     now (shown as a bright green "Active Now" indicator).
  //   - postedLabel: how long ago their video was posted (always
  //     shown on the video card itself, independent of live status).
  // A member can be posted-only, active-only, or both at once.
  //
  // Card order (FEED_ORDER) is deliberately NOT pure reverse-chronological
  // — it blends recency with a couple of "reason" signals (nearby,
  // follows, matches your activities) to preview a real ranking model.
  // See FEED_SPEC.md in this project for the intended production logic.
  // ------------------------------------------------------------------
  var FEED_POSTS = [
    { name: "Jessica R.", initials: "JR", grad: "g1", activity: "Gym — Legs",
      postedLabel: "Posted 8m ago", isActiveNow: true, duration: "0:41", distance: "1.8 mi • Arlington", reason: null,
      caption: "New leg day PR this morning. Squats felt strong.",
      stat1: "Checked in", stat1v: "12 min ago", stat2: "Location", stat2v: "LA Fitness, Arlington" },
    { name: "Marcus T.", initials: "MT", grad: "g2", activity: "Run",
      postedLabel: "Posted 14m ago", isActiveNow: false, duration: "0:28", distance: "2.4 mi • Fort Worth", reason: "Because you run too",
      caption: "Easy 5K to shake out the legs before the weekend.",
      stat1: "Distance", stat1v: "5.0 km", stat2: "Pace", stat2v: "5:42 /km" },
    { name: "Aaliyah K.", initials: "AK", grad: "g3", activity: "Cycling",
      postedLabel: "Posted 19m ago", isActiveNow: true, duration: "0:52", distance: "3.1 mi • Grapevine", reason: null,
      caption: "Sunset ride along the trail. Perfect weather tonight.",
      stat1: "Checked in", stat1v: "6 min ago", stat2: "Location", stat2v: "Grapevine Lake Trail" },
    { name: "David P.", initials: "DP", grad: "g4", activity: "Pickleball",
      postedLabel: "Posted 26m ago", isActiveNow: false, duration: "0:33", distance: "4.0 mi • Arlington", reason: "Matches your activities",
      caption: "Looking for a rematch this weekend — bring it.",
      stat1: "Format", stat1v: "Singles", stat2: "Location", stat2v: "River Legacy Park" },
    { name: "Sofia M.", initials: "SM", grad: "g5", activity: "Yoga",
      postedLabel: "Posted 31m ago", isActiveNow: false, duration: "0:45", distance: null, reason: null,
      caption: "Sunrise flow to start the day right.",
      stat1: "Style", stat1v: "Vinyasa", stat2: "Duration", stat2v: "40 min" },
    { name: "Chris B.", initials: "CB", grad: "g6", activity: "Hiking",
      postedLabel: "Posted 42m ago", isActiveNow: false, duration: "1:02", distance: "5.6 mi • Southlake", reason: null,
      caption: "Found a new trail with a great view at the top.",
      stat1: "Distance", stat1v: "6.4 km", stat2: "Elevation", stat2v: "+310 m" },
    { name: "Priya N.", initials: "PN", grad: "g1", activity: "Swim",
      postedLabel: "Posted 47m ago", isActiveNow: true, duration: "0:24", distance: "2.9 mi • Irving", reason: null,
      caption: "Lap swim before work. Slowly getting faster.",
      stat1: "Checked in", stat1v: "20 min ago", stat2: "Location", stat2v: "Irving Rec Center Pool" },
    { name: "Ethan W.", initials: "EW", grad: "g3", activity: "Gym — Full Body",
      postedLabel: "Posted 1h ago", isActiveNow: false, duration: "0:38", distance: "1.2 mi • Dallas", reason: "Because you train legs too",
      caption: "Full body burn to close out the week.",
      stat1: "Duration", stat1v: "48 min", stat2: "Location", stat2v: "Gold's Gym, Dallas" },
    { name: "Brittany L.", initials: "BL", grad: "g4", activity: "Walk",
      postedLabel: "Posted 1h ago", isActiveNow: false, duration: "0:19", distance: null, reason: null,
      caption: "Recovery walk around the lake with the dog.",
      stat1: "Distance", stat1v: "3.1 km", stat2: "Location", stat2v: "White Rock Lake" },
    { name: "Miguel A.", initials: "MA", grad: "g2", activity: "Tennis",
      postedLabel: "Posted 2h ago", isActiveNow: false, duration: "0:36", distance: "3.7 mi • Plano", reason: null,
      caption: "Good practice session — serve is finally clicking.",
      stat1: "Format", stat1v: "Practice", stat2: "Duration", stat2v: "1 hr" },
    { name: "Hannah G.", initials: "HG", grad: "g5", activity: "Pilates",
      postedLabel: "Posted 2h ago", isActiveNow: false, duration: "0:29", distance: "2.1 mi • Frisco", reason: "2 friends going",
      caption: "Core day. Never gets easier.",
      stat1: "Style", stat1v: "Mat Pilates", stat2: "Duration", stat2v: "35 min" },
    { name: "Tyler J.", initials: "TJ", grad: "g6", activity: "Basketball",
      postedLabel: "Posted 3h ago", isActiveNow: true, duration: "0:31", distance: "1.5 mi • Arlington", reason: null,
      caption: "3-on-3 run at the park. Come through.",
      stat1: "Checked in", stat1v: "9 min ago", stat2: "Location", stat2v: "Randol Mill Park" },
    { name: "Nicole F.", initials: "NF", grad: "g1", activity: "Volleyball",
      postedLabel: "Posted 3h ago", isActiveNow: false, duration: "0:40", distance: null, reason: null,
      caption: "Beach volleyball league, week 4.",
      stat1: "Format", stat1v: "League", stat2: "Duration", stat2v: "1.5 hr" },
    { name: "Omar S.", initials: "OS", grad: "g2", activity: "Surf",
      postedLabel: "Posted 4h ago", isActiveNow: false, duration: "0:55", distance: "6.8 mi • Corpus Christi", reason: null,
      caption: "Small waves but good enough for a morning session.",
      stat1: "Duration", stat1v: "1 hr", stat2: "Location", stat2v: "Padre Island" },
    { name: "Grace L.", initials: "GL", grad: "g3", activity: "Gym — Strength",
      postedLabel: "Posted 5h ago", isActiveNow: false, duration: "0:34", distance: "2.6 mi • Arlington", reason: "Because you train legs too",
      caption: "Deadlift PR attempt — third time's the charm.",
      stat1: "Duration", stat1v: "55 min", stat2: "Location", stat2v: "LA Fitness, Arlington" },
    { name: "Jordan H.", initials: "JH", grad: "g4", activity: "Run",
      postedLabel: "Posted 6h ago", isActiveNow: false, duration: "0:22", distance: "3.4 mi • Fort Worth", reason: null,
      caption: "Tempo run — legs are toast now.",
      stat1: "Distance", stat1v: "6.2 km", stat2: "Pace", stat2v: "4:58 /km" }
  ];

  // Rail order: active-right-now members surface first, then everyone
  // else in recency order — mirrors "currently active" outranking
  // "posted a while ago" the way the product spec calls for.
  var RAIL_ORDER = FEED_POSTS
    .map(function (p, i) { return i; })
    .sort(function (a, b) {
      var pa = FEED_POSTS[a], pb = FEED_POSTS[b];
      if (pa.isActiveNow !== pb.isActiveNow) return pa.isActiveNow ? -1 : 1;
      return a - b;
    });

  // Grid order: a hand-tuned preview of a real ranking blend (recency +
  // proximity + activity affinity + who you follow), not pure newest-first.
  var FEED_ORDER = [0, 3, 1, 2, 7, 11, 4, 6, 5, 8, 9, 10, 12, 13, 14, 15];
  // Phones get a shorter first batch — the single biggest chunk of mobile
  // scroll length was 8 full-width video cards stacked before a visitor
  // ever reached anything else on the page. "Load More Workouts" still
  // reveals the rest; nothing is actually removed, just deferred.
  var GRID_PAGE_SIZE = window.innerWidth <= 760 ? 3 : 8;
  var gridRendered = 0;

  var feedTrack = document.getElementById("feedTrack");
  var feedRail = document.getElementById("feedRail");
  var videoGrid = document.getElementById("videoGrid");
  var loadMoreBtn = document.getElementById("loadMoreBtn");

  function playIconSVG(size) {
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size +
      '" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 3 20 12 6 21 6 3"></polygon></svg>';
  }

  // ---- Active Members rail ----

  function buildBubble(poolIndex, railPosition) {
    var post = FEED_POSTS[poolIndex];
    var btn = document.createElement("button");
    btn.className = "story-bubble";
    btn.type = "button";
    btn.setAttribute("aria-label", (post.isActiveNow ? "Active now: " : "Watch ") + post.name + "'s workout post");

    var ring = document.createElement("div");
    if (post.isActiveNow) {
      ring.className = "story-ring active-ring";
    } else {
      ring.className = "story-ring" + (railPosition > 6 ? " seen" : "");
    }

    var frame = document.createElement("div");
    frame.className = "story-avatar-frame";

    var grad = document.createElement("div");
    grad.className = "story-avatar-gradient " + post.grad;
    grad.textContent = post.initials;

    var badge = document.createElement("div");
    if (post.isActiveNow) {
      badge.className = "story-play-badge active-badge";
      badge.innerHTML = '<span class="pulse-ring"></span>';
    } else {
      badge.className = "story-play-badge";
      badge.innerHTML = playIconSVG(11);
    }
    grad.appendChild(badge);

    frame.appendChild(grad);
    ring.appendChild(frame);

    var name = document.createElement("span");
    name.className = "story-name";
    name.textContent = post.name;

    var time = document.createElement("span");
    time.className = "story-time" + (post.isActiveNow ? " live" : "");
    time.textContent = post.isActiveNow ? "Active Now" : post.postedLabel.replace("Posted ", "");

    btn.appendChild(ring);
    btn.appendChild(name);
    btn.appendChild(time);

    btn.addEventListener("click", function () {
      openStory(poolIndex);
    });

    return btn;
  }

  function buildAddBubble() {
    var wrap = document.createElement("a");
    wrap.className = "story-bubble";
    wrap.href = "#waitlist";

    var circle = document.createElement("div");
    circle.className = "story-add";
    circle.textContent = "+";

    var name = document.createElement("span");
    name.className = "story-name";
    name.textContent = "Share yours";

    var time = document.createElement("span");
    time.className = "story-time";
    time.textContent = "Join first";

    wrap.appendChild(circle);
    wrap.appendChild(name);
    wrap.appendChild(time);
    return wrap;
  }

  if (feedTrack && FEED_POSTS.length) {
    // Render the tray twice back-to-back so the CSS marquee animation
    // (translateX 0 -> -50%) loops seamlessly.
    for (var copy = 0; copy < 2; copy++) {
      var group = document.createElement("div");
      group.className = "feed-group";
      RAIL_ORDER.forEach(function (poolIndex, railPosition) {
        group.appendChild(buildBubble(poolIndex, railPosition));
      });
      group.appendChild(buildAddBubble());
      feedTrack.appendChild(group);
    }
  }

  // ---- Latest Workouts video grid ----

  // The marketing site has no login/session of its own for these DEMO
  // cards (no real account behind "Jessica R." etc.) — Follow and Message
  // just send a visitor to sign in. goToMemberSignIn() is defined once,
  // globally, in js/shared-session.js (loaded before this file).
  function buildVideoCard(poolIndex) {
    var post = FEED_POSTS[poolIndex];
    var card = document.createElement("article");
    card.className = "video-card";

    var thumb = document.createElement("button");
    thumb.type = "button";
    thumb.className = "video-thumb " + post.grad;
    thumb.setAttribute("aria-label", "Watch " + post.name + "'s workout video");

    var badge = document.createElement("span");
    if (post.isActiveNow) {
      badge.className = "video-badge active-now";
      badge.textContent = "Active Now";
    } else {
      badge.className = "video-badge";
      badge.textContent = post.postedLabel;
    }

    var duration = document.createElement("span");
    duration.className = "video-duration";
    duration.textContent = post.duration;

    var play = document.createElement("div");
    play.className = "story-play";
    play.innerHTML = playIconSVG(17);

    thumb.appendChild(badge);
    thumb.appendChild(play);
    thumb.appendChild(duration);
    thumb.addEventListener("click", function () { openStory(poolIndex); });

    var info = document.createElement("div");
    info.className = "video-info";

    var memberBtn = document.createElement("button");
    memberBtn.type = "button";
    memberBtn.className = "video-member";
    memberBtn.setAttribute("aria-label", "View " + post.name + "'s profile");

    var avatar = document.createElement("div");
    avatar.className = "story-avatar " + post.grad;
    avatar.textContent = post.initials;

    var memberText = document.createElement("div");
    memberText.className = "video-member-text";
    var mName = document.createElement("span");
    mName.className = "video-member-name";
    mName.textContent = post.name;
    var mSub = document.createElement("span");
    mSub.className = "video-member-sub";
    mSub.textContent = post.isActiveNow ? "Active " + post.stat1v : post.postedLabel;
    memberText.appendChild(mName);
    memberText.appendChild(mSub);

    memberBtn.appendChild(avatar);
    memberBtn.appendChild(memberText);
    memberBtn.addEventListener("click", function () { openStory(poolIndex); });

    var tags = document.createElement("div");
    tags.className = "video-tags";
    var activityTag = document.createElement("span");
    activityTag.className = "video-tag";
    activityTag.textContent = post.activity;
    tags.appendChild(activityTag);
    if (post.distance) {
      var distTag = document.createElement("span");
      distTag.className = "video-tag";
      distTag.textContent = post.distance;
      tags.appendChild(distTag);
    }
    if (post.reason) {
      var reasonTag = document.createElement("span");
      reasonTag.className = "video-tag reason";
      reasonTag.textContent = post.reason;
      tags.appendChild(reasonTag);
    }

    var actions = document.createElement("div");
    actions.className = "video-actions";

    // Follow/Message here are on the public demo feed, not a real member
    // account — tapping either sends a visitor to sign in so the real
    // feature (in the member app) is what they actually land in.
    var followBtn = document.createElement("button");
    followBtn.type = "button";
    followBtn.className = "btn btn-ghost-light btn-follow";
    followBtn.textContent = "Follow";
    followBtn.addEventListener("click", goToMemberSignIn);

    var connectBtn = document.createElement("button");
    connectBtn.type = "button";
    connectBtn.className = post.isActiveNow ? "btn btn-primary" : "btn btn-ghost-light";
    connectBtn.textContent = post.isActiveNow ? "Join Workout" : "Message";
    connectBtn.addEventListener("click", goToMemberSignIn);

    actions.appendChild(followBtn);
    actions.appendChild(connectBtn);

    info.appendChild(memberBtn);
    info.appendChild(tags);
    info.appendChild(actions);

    card.appendChild(thumb);
    card.appendChild(info);
    return card;
  }

  function renderNextGridPage() {
    if (!videoGrid) return;
    var next = FEED_ORDER.slice(gridRendered, gridRendered + GRID_PAGE_SIZE);
    next.forEach(function (poolIndex) {
      videoGrid.appendChild(buildVideoCard(poolIndex));
    });
    gridRendered += next.length;
    if (loadMoreBtn) loadMoreBtn.hidden = gridRendered >= FEED_ORDER.length;
  }

  if (videoGrid) {
    renderNextGridPage();
    if (loadMoreBtn) {
      loadMoreBtn.addEventListener("click", renderNextGridPage);
    }
  }

  // ---- Story viewer (shared by the rail and the video grid) ----
  var storyModal = document.getElementById("storyModal");
  var storyAvatar = document.getElementById("storyAvatar");
  var storyName = document.getElementById("storyName");
  var storyTime = document.getElementById("storyTime");
  var storyVisual = document.getElementById("storyVisual");
  var storyStats = document.getElementById("storyStats");
  var storyCaption = document.getElementById("storyCaption");
  var storyProgressFill = document.getElementById("storyProgressFill");
  var storyClose = document.getElementById("storyClose");
  var storyPrev = document.getElementById("storyPrev");
  var storyNext = document.getElementById("storyNext");
  var storyBackdrop = document.getElementById("storyBackdrop");

  var currentRailPos = 0;
  var STORY_DURATION = 6000;
  var progressTimer = null;

  function renderStory(poolIndex) {
    var post = FEED_POSTS[poolIndex];
    if (!post) return;

    storyAvatar.textContent = post.initials;
    storyAvatar.className = "story-avatar " + post.grad;
    storyName.textContent = post.name;
    // Always show both signals, never merged: activity + how long ago it
    // was posted, plus a distinct "Active now" flag when it applies.
    storyTime.textContent = post.activity + " · " + post.postedLabel + (post.isActiveNow ? " · Active now" : "");

    storyVisual.className = "story-visual " + post.grad;
    storyVisual.innerHTML = '<div class="story-play">' + playIconSVG(20) + '</div>';

    storyStats.innerHTML =
      '<div class="story-stat">' + post.stat1 + '<strong>' + post.stat1v + '</strong></div>' +
      '<div class="story-stat">' + post.stat2 + '<strong>' + post.stat2v + '</strong></div>';

    storyCaption.textContent = post.caption;
  }

  function startProgress() {
    stopProgress();
    storyProgressFill.classList.remove("animate");
    storyProgressFill.style.width = "0%";
    // Force reflow so the transition restarts cleanly on each story.
    void storyProgressFill.offsetWidth;
    storyProgressFill.classList.add("animate");
    storyProgressFill.style.transitionDuration = STORY_DURATION + "ms";
    requestAnimationFrame(function () {
      storyProgressFill.style.width = "100%";
    });
    progressTimer = setTimeout(nextStory, STORY_DURATION);
  }

  function stopProgress() {
    if (progressTimer) {
      clearTimeout(progressTimer);
      progressTimer = null;
    }
  }

  function openStory(poolIndex) {
    currentRailPos = RAIL_ORDER.indexOf(poolIndex);
    if (currentRailPos < 0) currentRailPos = 0;
    renderStory(RAIL_ORDER[currentRailPos]);
    storyModal.classList.add("open");
    storyModal.setAttribute("aria-hidden", "false");
    if (feedTrack) feedTrack.classList.add("paused");
    document.body.style.overflow = "hidden";
    startProgress();
  }

  function closeStory() {
    storyModal.classList.remove("open");
    storyModal.setAttribute("aria-hidden", "true");
    if (feedTrack) feedTrack.classList.remove("paused");
    document.body.style.overflow = "";
    stopProgress();
  }

  function nextStory() {
    currentRailPos = (currentRailPos + 1) % RAIL_ORDER.length;
    renderStory(RAIL_ORDER[currentRailPos]);
    startProgress();
  }

  function prevStory() {
    currentRailPos = (currentRailPos - 1 + RAIL_ORDER.length) % RAIL_ORDER.length;
    renderStory(RAIL_ORDER[currentRailPos]);
    startProgress();
  }

  if (storyModal) {
    if (storyClose) storyClose.addEventListener("click", closeStory);
    if (storyBackdrop) storyBackdrop.addEventListener("click", closeStory);
    if (storyNext) storyNext.addEventListener("click", nextStory);
    if (storyPrev) storyPrev.addEventListener("click", prevStory);

    // Pause auto-advance while the viewer is pressed/held.
    storyModal.addEventListener("pointerdown", function (e) {
      if (e.target === storyPrev || e.target === storyNext || e.target === storyClose) return;
      stopProgress();
    });
    storyModal.addEventListener("pointerup", function (e) {
      if (e.target === storyPrev || e.target === storyNext || e.target === storyClose) return;
      if (storyModal.classList.contains("open")) startProgress();
    });

    document.addEventListener("keydown", function (e) {
      if (!storyModal.classList.contains("open")) return;
      if (e.key === "Escape") closeStory();
      if (e.key === "ArrowRight") nextStory();
      if (e.key === "ArrowLeft") prevStory();
    });
  }

  // Pause the feed marquee on touch so mobile users can tap accurately.
  if (feedRail) {
    feedRail.addEventListener("touchstart", function () {
      feedTrack.classList.add("paused");
    }, { passive: true });
    feedRail.addEventListener("touchend", function () {
      setTimeout(function () { feedTrack.classList.remove("paused"); }, 1500);
    }, { passive: true });
  }

  // ------------------------------------------------------------------
  // Hero "Also here for Dating" vertical rail — a slim rotating column
  // of faces to the left of the hero photo, hinting at the Dating side
  // of the product (the paid Ensemble Fitness+ driver) right in the hero,
  // without duplicating the full feed UI. Faces loop top-to-bottom.
  //
  // These use the same stylized gradient-avatar system as the rest of
  // the site rather than real photos: we don't have real member photos
  // pre-launch, and using stock photos of real strangers here would
  // read as implying they're actual Ensemble Fitness daters. Swap in real
  // (consented) member photos once there's a live user base.
  // ------------------------------------------------------------------
  // Wake-up times are mixed on purpose — early birds, mid-morning, and a couple of genuine
  // night owls — to preview the real Fitness Plus app feature that matches members by the
  // time they naturally wake up, not just location.
  var DATING_PROFILES = [
    { name: "Maya, 25", initials: "M", grad: "g1", wake: "Wakes at 5:45 AM" },
    { name: "Derek, 29", initials: "D", grad: "g2", wake: "Wakes at 6:30 AM" },
    { name: "Alexis, 34", initials: "A", grad: "g3", wake: "Wakes at 7:15 AM" },
    { name: "Cameron, 38", initials: "C", grad: "g4", wake: "Wakes at 8:00 AM" },
    { name: "Bianca, 43", initials: "B", grad: "g5", wake: "Wakes at 9:30 AM" },
    { name: "Noah, 47", initials: "N", grad: "g6", wake: "Wakes at 10:00 AM" },
    { name: "Renee, 52", initials: "R", grad: "g1", wake: "Wakes at 10:45 AM" },
    { name: "Victor, 56", initials: "V", grad: "g3", wake: "Wakes around noon" }
  ];

  var datingTrackV = document.getElementById("datingTrackV");
  var datingRailV = document.getElementById("datingRailV");

  function buildDatingChip(profile) {
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "dating-chip-v";
    btn.setAttribute("aria-label", "See Ensemble Fitness Dating — " + profile.name);

    var avatar = document.createElement("div");
    avatar.className = "dating-avatar-v " + profile.grad;
    avatar.textContent = profile.initials;

    var name = document.createElement("span");
    name.className = "dating-name-v";
    name.textContent = profile.name;

    btn.appendChild(avatar);
    btn.appendChild(name);

    if (profile.wake) {
      var wake = document.createElement("span");
      wake.className = "dating-wake-v";
      wake.textContent = profile.wake;
      btn.appendChild(wake);
    }

    btn.addEventListener("click", function () {
      var target = document.getElementById("pricing");
      if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return btn;
  }

  if (datingTrackV && DATING_PROFILES.length) {
    for (var dCopy = 0; dCopy < 2; dCopy++) {
      var dGroup = document.createElement("div");
      dGroup.className = "dating-group-v";
      DATING_PROFILES.forEach(function (profile) {
        dGroup.appendChild(buildDatingChip(profile));
      });
      datingTrackV.appendChild(dGroup);
    }
  }

  if (datingRailV) {
    datingRailV.addEventListener("touchstart", function () {
      datingTrackV.classList.add("paused");
    }, { passive: true });
    datingRailV.addEventListener("touchend", function () {
      setTimeout(function () { datingTrackV.classList.remove("paused"); }, 1200);
    }, { passive: true });
  }

  // Sticky nav shadow on scroll
  var nav = document.querySelector(".nav");
  if (nav) {
    window.addEventListener("scroll", function () {
      if (window.scrollY > 8) {
        nav.style.boxShadow = "0 8px 24px rgba(0,0,0,0.25)";
      } else {
        nav.style.boxShadow = "none";
      }
    });
  }
});
