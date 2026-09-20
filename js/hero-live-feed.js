/* =========================================================================
   Hero "Latest Workouts" strip + the larger "Latest Workouts" video grid
   further down the page — both pull from ONE shared list of real, approved
   member videos (window.__ensembleVideoFeed) fetched once here, so:

   1. Visitors see actual activity instead of just demo placeholders (each
      section falls back to its existing static demo content for any slot
      that doesn't have a real video yet — never a broken/empty square,
      never an error shown to visitors on failure).
   2. Every real video on the page is reachable from ONE navigable list, so
      the lightbox (js/main.js) can scroll/swipe from any of them straight
      through to the next — a visitor who opens a video from the hero strip
      can keep going and land on videos that were only shown in the grid,
      and vice versa, without ever closing the lightbox in between.

   Only APPROVED videos are ever shown here (same rule as everywhere else
   in the app) — nothing pending or rejected is reachable this way, and this
   uses the same public anon key + Row Level Security rules as the rest of
   the app, not a special back door.
   ========================================================================= */
(function () {
  var SUPABASE_URL = "https://wgrldwdgvvlhcmlyoxrl.supabase.co";
  var SUPABASE_ANON_KEY = "sb_publishable_4sbGE70Sh5gkgpmBqdGVBg_VkqjzJVx";
  var FEED_LIMIT = 20;

  window.__ensembleVideoFeed = [];

  if (!window.supabase) return; // CDN didn't load — just keep the static demo content.

  // A plain client, same as before this feature existed — see
  // loadSiteAuthAndFollowing() below for how it picks up "already signed
  // into the app," needed so a real video card's Follow button can work
  // for real here instead of always sending a signed-in visitor to sign
  // in again.
  var sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  var siteCurrentUserId = null;
  var followingIds = new Set();

  // Fast path: this client already has its own session (from a previous
  // visit). Otherwise, look for the small handoff cookie the member app
  // leaves (js/shared-session.js) — just two tokens, not the whole
  // session — and hand them to this client with setSession() once. See
  // js/main.js's refreshSiteAuth() for the fuller explanation of why.
  async function loadSiteAuthAndFollowing() {
    var { data } = await sb.auth.getSession();
    siteCurrentUserId = (data && data.session && data.session.user) ? data.session.user.id : null;

    if (!siteCurrentUserId) {
      var handoff = (typeof readCrossDomainSession === "function") ? readCrossDomainSession() : null;
      if (handoff) {
        var { data: setData, error } = await sb.auth.setSession({
          access_token: handoff.access_token,
          refresh_token: handoff.refresh_token
        });
        if (!error && setData && setData.session && setData.session.user) {
          siteCurrentUserId = setData.session.user.id;
        }
      }
    }

    if (!siteCurrentUserId) { followingIds = new Set(); return; }
    var { data: rows } = await sb.from("follows").select("followee_id").eq("follower_id", siteCurrentUserId);
    followingIds = new Set((rows || []).map(function (r) { return r.followee_id; }));
  }

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

  function formatDuration(seconds) {
    if (!isFinite(seconds) || seconds <= 0) return null;
    var m = Math.floor(seconds / 60);
    var s = Math.floor(seconds % 60);
    return m + ":" + (s < 10 ? "0" : "") + s;
  }

  function initialsFrom(name) {
    var parts = (name || "?").trim().split(/\s+/);
    var initials = parts[0] ? parts[0].charAt(0) : "?";
    if (parts.length > 1) initials += parts[parts.length - 1].charAt(0);
    return initials.toUpperCase();
  }

  async function fetchFeed() {
    var { data, error } = await sb
      .from("media")
      // The FK hint (!media_user_id_fkey) is required here: once media_reactions
      // and media_comments existed (each linking media <-> profiles too), plain
      // "profiles(display_name)" became ambiguous and Supabase returned a 300/
      // "more than one relationship was found" error instead of any videos —
      // which is why real videos stopped appearing on this page.
      .select("id, user_id, storage_path, workout_type, created_at, profiles!media_user_id_fkey(display_name)")
      .eq("status", "approved")
      .eq("kind", "video")
      .order("created_at", { ascending: false })
      .limit(FEED_LIMIT);

    if (error || !data || data.length === 0) return [];

    var items = [];
    for (var i = 0; i < data.length; i++) {
      var { data: signed } = await sb.storage.from("media").createSignedUrl(data[i].storage_path, 3600);
      if (!signed) continue; // Skip this one — leave whichever slot wanted it as a demo placeholder.
      items.push({
        id: data[i].id,
        user_id: data[i].user_id,
        url: signed.signedUrl,
        name: (data[i].profiles && data[i].profiles.display_name) || "A member",
        workout_type: data[i].workout_type || "",
        created_at: data[i].created_at
      });
    }
    return items;
  }

  function fillHeroSlots(feed) {
    var slots = document.querySelectorAll("[data-hero-video-slot]");
    if (!slots.length || !feed.length) return;

    for (var i = 0; i < slots.length && i < feed.length; i++) {
      var item = feed[i];
      var slot = slots[i];

      var video = document.createElement("video");
      video.src = item.url;
      video.muted = true;
      video.autoplay = true;
      video.loop = true;
      video.playsInline = true;
      video.preload = "metadata";

      var durEl = slot.querySelector(".hero-video-dur");
      video.addEventListener("loadedmetadata", function (durSpan) {
        return function () {
          var formatted = formatDuration(this.duration);
          if (formatted && durSpan) durSpan.textContent = formatted;
        };
      }(durEl));

      slot.classList.remove("g1", "g2", "g5", "g6"); // real footage replaces the gradient placeholder
      slot.insertBefore(video, slot.firstChild);
      slot.setAttribute("aria-label", "Watch a real member's workout video");

      // This slot is an <a href="#feed"> in the markup so the demo squares
      // still scroll to the feed — but once it holds a real video, clicking
      // should open the reel lightbox at this video's position instead of
      // just jumping the page.
      slot.addEventListener("click", function (feedIndex) {
        return function (e) {
          e.preventDefault();
          if (window.openVideoLightbox) window.openVideoLightbox(feedIndex);
        };
      }(i));
    }
  }

  /* =======================================================================
     "Latest Workouts" grid (the larger card section further down the page)
     -----------------------------------------------------------------------
     Same one-for-one idea as the hero strip: for every real approved video,
     add one real card and remove one demo card, so the grid never grows
     past its normal size and — as more members upload — naturally fills in
     with real people instead of demo placeholders, until eventually none
     are left.

     Only the fields we can actually back with real data are shown on a
     real card: who posted it, when, and the workout type if they added
     one. The demo cards' "Active Now" badge, distance, and "matches your
     activity" reasoning are illustrative-only concepts we haven't built
     yet (live presence, location matching, affinity ranking) — showing
     those on a real member's real video would be showing something false
     about a real person, which is worse than a demo placeholder. So real
     cards intentionally look a little simpler than demo ones for now.
     ========================================================================= */

  var GRAD_CLASSES = ["g1", "g2", "g3", "g4", "g5", "g6"];

  function buildRealVideoCard(item, feedIndex, gradIndex) {
    var name = item.name;
    var grad = GRAD_CLASSES[gradIndex % GRAD_CLASSES.length];

    var card = document.createElement("article");
    card.className = "video-card";
    card.setAttribute("data-real-card", "true");

    var thumb = document.createElement("button");
    thumb.type = "button";
    thumb.className = "video-thumb " + grad;
    thumb.setAttribute("aria-label", "Watch " + name + "'s workout video");

    var video = document.createElement("video");
    video.src = item.url;
    video.muted = true;
    video.autoplay = true;
    video.loop = true;
    video.playsInline = true;
    video.preload = "metadata";

    var badge = document.createElement("span");
    badge.className = "video-badge";
    badge.textContent = postedLabel(item.created_at);

    var duration = document.createElement("span");
    duration.className = "video-duration";
    video.addEventListener("loadedmetadata", function () {
      var seconds = video.duration;
      if (!isFinite(seconds) || seconds <= 0) return;
      var m = Math.floor(seconds / 60);
      var s = Math.floor(seconds % 60);
      duration.textContent = m + ":" + (s < 10 ? "0" : "") + s;
    });

    var play = document.createElement("div");
    play.className = "story-play";
    play.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 3 20 12 6 21 6 3"></polygon></svg>';

    thumb.appendChild(video);
    thumb.appendChild(badge);
    thumb.appendChild(play);
    thumb.appendChild(duration);
    thumb.addEventListener("click", function () {
      if (window.openVideoLightbox) {
        window.openVideoLightbox(feedIndex);
      } else {
        // Fallback in case the lightbox script hasn't loaded for some reason.
        video.muted = false;
        video.controls = true;
        video.play();
      }
    });

    var info = document.createElement("div");
    info.className = "video-info";

    var memberBtn = document.createElement("button");
    memberBtn.type = "button";
    memberBtn.className = "video-member";
    memberBtn.setAttribute("aria-label", "View " + name + "'s profile");

    var avatar = document.createElement("div");
    avatar.className = "story-avatar " + grad;
    avatar.textContent = initialsFrom(name);

    var memberText = document.createElement("div");
    memberText.className = "video-member-text";
    var mName = document.createElement("span");
    mName.className = "video-member-name";
    mName.textContent = name;
    var mSub = document.createElement("span");
    mSub.className = "video-member-sub";
    mSub.textContent = postedLabel(item.created_at);
    memberText.appendChild(mName);
    memberText.appendChild(mSub);

    memberBtn.appendChild(avatar);
    memberBtn.appendChild(memberText);

    var tags = document.createElement("div");
    tags.className = "video-tags";
    if (item.workout_type) {
      var activityTag = document.createElement("span");
      activityTag.className = "video-tag";
      activityTag.textContent = item.workout_type;
      tags.appendChild(activityTag);
    }

    var actions = document.createElement("div");
    actions.className = "video-actions";

    // These are real members, so Follow works for real once a visitor is
    // recognized as signed in (see loadSiteAuthAndFollowing() above) —
    // same "follows" table the member app uses, so following someone here
    // shows up there too, and vice versa. goToMemberSignIn(videoId) is
    // defined once, globally, in js/shared-session.js — it navigates this
    // same tab to sign-in and brings the visitor right back to this exact
    // video once they're signed in, so always pass item.id, never the
    // click event itself. Message still always opens sign-in — composing
    // a message isn't built into the site itself (yet).
    var connectBtn = document.createElement("button");
    connectBtn.type = "button";
    connectBtn.className = "btn btn-ghost-light";
    connectBtn.textContent = "Message";
    connectBtn.addEventListener("click", function () { goToMemberSignIn(item.id); });

    if (item.user_id && item.user_id !== siteCurrentUserId) {
      var followBtn = document.createElement("button");
      followBtn.type = "button";
      followBtn.className = "btn btn-ghost-light btn-follow";

      function paintFollowBtn() {
        var following = followingIds.has(item.user_id);
        followBtn.textContent = following ? "Following ✓" : "Follow";
        followBtn.dataset.following = following ? "true" : "false";
      }
      paintFollowBtn();

      followBtn.addEventListener("click", async function () {
        if (!siteCurrentUserId) { goToMemberSignIn(item.id); return; }
        followBtn.disabled = true;
        var following = followingIds.has(item.user_id);
        if (following) {
          var { error } = await sb.from("follows").delete()
            .eq("follower_id", siteCurrentUserId).eq("followee_id", item.user_id);
          if (!error) followingIds.delete(item.user_id);
        } else {
          var { error: insErr } = await sb.from("follows")
            .insert({ follower_id: siteCurrentUserId, followee_id: item.user_id });
          if (!insErr) followingIds.add(item.user_id);
        }
        followBtn.disabled = false;
        paintFollowBtn();
      });

      actions.appendChild(followBtn);
    }
    actions.appendChild(connectBtn);

    info.appendChild(memberBtn);
    if (tags.children.length) info.appendChild(tags);
    info.appendChild(actions);

    card.appendChild(thumb);
    card.appendChild(info);
    return card;
  }

  async function fillVideoGrid(feed) {
    var grid = document.getElementById("videoGrid");
    if (!grid || !feed.length) return;

    // main.js renders its first page of demo cards synchronously on the same
    // DOMContentLoaded event, before this async function's first await
    // resumes — so by the time we get here, those cards already exist.
    // As a safety net in case that ever changes, wait briefly for them.
    for (var waited = 0; grid.children.length === 0 && waited < 1000; waited += 100) {
      await new Promise(function (resolve) { setTimeout(resolve, 100); });
    }

    var demoCount = grid.children.length;
    if (demoCount === 0) return;

    for (var j = 0; j < feed.length && j < demoCount; j++) {
      var realCard = buildRealVideoCard(feed[j], j, j);
      grid.insertBefore(realCard, grid.firstChild);
      if (grid.lastChild) grid.removeChild(grid.lastChild); // one fake out for one real in
    }
  }

  document.addEventListener("DOMContentLoaded", async function () {
    var results = await Promise.all([fetchFeed(), loadSiteAuthAndFollowing()]);
    var feed = results[0];
    window.__ensembleVideoFeed = feed;
    // Tells main.js the real video list is ready — it listens for this to
    // reopen the lightbox on a specific video after someone returns from
    // signing in (see goToMemberSignIn/the auto-reopen block in main.js).
    // Dispatched even when feed.length is 0 so that listener never waits
    // forever on a page with no real videos yet.
    document.dispatchEvent(new CustomEvent("ensembleFeedReady"));
    if (!feed.length) return; // Keep all static/demo content exactly as it was.
    fillHeroSlots(feed);
    fillVideoGrid(feed);
  });
})();
