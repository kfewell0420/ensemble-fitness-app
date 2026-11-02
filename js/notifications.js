/* =========================================================================
   Notification bell — "you're part of a vibrant, connected community"
   -------------------------------------------------------------------------
   Injects a 🔔 into the shared .app-nav header on every page that loads
   this file (after js/supabaseClient.js), showing reactions, comments,
   new followers, and messages other members send this way — the in-app
   half of the feature; sql/notifications.sql sends the matching email.

   Rows in the "notifications" table are only ever written by the
   SECURITY DEFINER trigger functions in that SQL file, never by this
   script — this only ever reads the signed-in member's own rows
   (recipient_id = me, enforced by RLS) and marks them read. Nothing here
   can forge or fake a notification.

   Silently does nothing if nobody's signed in yet (login.html, a page
   mid-redirect, etc.) — safe to include everywhere.
   ========================================================================= */
(function () {
  var POLL_MS = 30000; // checked every 30s while the page is on screen (a tiny count-only question), and again whenever the app comes back to the front or the panel opens
  var currentUserId = null;
  var panelOpen = false;
  var autoMarkReadTimeoutId = null;
  var IS_HOME = false; // set on DOMContentLoaded: true on the Home page (feed.html), which has its own "Welcome back" header

  function escapeHtml(str) {
    var div = document.createElement("div");
    div.textContent = str == null ? "" : String(str);
    return div.innerHTML;
  }

  function timeAgo(iso) {
    var seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
    if (seconds < 60) return "just now";
    var minutes = Math.floor(seconds / 60);
    if (minutes < 60) return minutes + "m ago";
    var hours = Math.floor(minutes / 60);
    if (hours < 24) return hours + "h ago";
    var days = Math.floor(hours / 24);
    return days + "d ago";
  }

  function reactionEmoji(type) {
    if (type === "muscle") return "💪";
    if (type === "heart") return "❤️";
    return "👍";
  }

  function describe(row) {
    var name = escapeHtml((row.actorName || "Someone"));
    // Oct 28 (Ken + the artist): tap the name (or the little photo) to see who it is -- opens their profile grid.
    // Oct 29 (Ken): a MESSAGE notification opens the conversation so you can answer -- tapping the name or the photo there used to
    // jump to the sender's profile instead. (Other kinds keep "tap the name/photo to see who it is".)
    if (row.actor_id && row.type !== "message") name = '<span class="efit-notif-name" data-go="' + escapeHtml(String(row.actor_id)) + '">' + name + "</span>";
    if (row.type === "reaction") {
      return "<strong>" + name + "</strong> reacted " + reactionEmoji(row.reaction_type) + " to your post";
    }
    if (row.type === "comment") {
      return "<strong>" + name + "</strong> commented: “" + escapeHtml(row.preview || "") + "”" + '<span class="efit-notif-reply">Tap to reply \u203A</span>';
    }
    if (row.type === "follow") {
      return "<strong>" + name + "</strong> started following you";
    }
    if (row.type === "message") {
      return "<strong>" + name + "</strong> sent you a message: “" + escapeHtml(row.preview || "") + "”" + '<span class="efit-notif-reply">Tap to reply \u203A</span>';
    }
    // Oct 28 (Ken): when a song/video is taken down, the reason is a notification (not a message in Messages).
    if (row.type === "removal") {
      return "<strong>" + name + "</strong>: " + escapeHtml(row.preview || "One of your posts was removed.");
    }
    return "<strong>" + name + "</strong> did something on Ensemble Fitness";
  }

  function destinationFor(row) {
    // Oct 28 (Ken): a comment notification opens your Comments list (see who said it, reply, tap their photo); a message opens Messages.
    if (row.type === "removal") return "profile.html";
    if (row.type === "comment") return "profile.html#comments";
    if (row.type === "reaction") return "feed.html";
    if (row.type === "follow") return row.actor_id ? "member.html?id=" + encodeURIComponent(row.actor_id) : "members.html";
    if (row.type === "message") return row.actor_id ? "profile.html?chat=" + encodeURIComponent(row.actor_id) + "#messages" : "profile.html#messages";
    return "feed.html";
  }

  // Ken's ask (Sept 2026): home + bell used to append into .app-nav-links,
  // which put them at the far right end of the page's own nav links — on a
  // page with a busy photo behind the nav (Music Library) that read as
  // cramped into the top-right corner and easy to miss. This shared group
  // sits right next to the logo on the left instead (see the .app-nav /
  // .app-nav-links CSS change in app.css that keeps the page's own links
  // pinned to the right so nothing else shifts).
  function getUtilityGroup() {
    var nav = document.querySelector(".app-nav");
    if (!nav) return null;
    var group = document.getElementById("efitNavUtility");
    if (group) return group;
    group = document.createElement("div");
    group.className = "efit-nav-utility";
    group.id = "efitNavUtility";
    var brand = nav.querySelector(".app-brand");
    if (brand && brand.nextSibling) {
      nav.insertBefore(group, brand.nextSibling);
    } else if (brand) {
      nav.appendChild(group);
    } else {
      nav.insertBefore(group, nav.firstChild);
    }
    return group;
  }

  // Home page only: on a computer the bell lives right after the member's name on the "Welcome back" line; on a phone it lives in
  // the header right after "Ensemble Fitness". One bell, moved to whichever spot is showing.
  function placeHomeBell() {
    var wrap = document.getElementById("efitNotifWrap");
    if (!wrap || !IS_HOME) return;
    var slot = document.getElementById("rpDashBellSlot");
    var wide = window.matchMedia && window.matchMedia("(min-width: 900px)").matches;
    var target = wide ? slot : document.getElementById("efitNavUtility");
    if (target && wrap.parentNode !== target) target.appendChild(wrap);
    if (panelOpen) closePanel();
  }

  function buildHomeLink() {
    var group = getUtilityGroup();
    if (!group || document.getElementById("efitHomeLink")) return null;

    // No point linking home from the home feed itself.
    if (/(^|\/)feed\.html(\?|#|$)/.test(window.location.pathname)) return null;

    var homeLink = document.createElement("a");
    homeLink.href = "feed.html";
    homeLink.id = "efitHomeLink";
    homeLink.className = "efit-home-link";
    homeLink.title = "Home";
    homeLink.setAttribute("aria-label", "Home");
    // An inline SVG rather than an emoji glyph — renders identically on every
    // browser/OS instead of depending on that system having a house emoji in
    // its font stack.
    homeLink.innerHTML =
      '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" ' +
      'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M3 11.5 12 4l9 7.5"></path>' +
      '<path d="M5.5 9.8V20h13V9.8"></path>' +
      '<path d="M9.5 20v-6h5v6"></path>' +
      "</svg>";

    // Placed right before the bell so it reads as a small pair of icons
    // together, per Ken's request to put it "over near the bell".
    group.appendChild(homeLink);
    return homeLink;
  }

  function buildBell() {
    var group = getUtilityGroup();
    if (!group || document.getElementById("efitNotifWrap")) return null;

    var wrap = document.createElement("div");
    wrap.className = "efit-notif-wrap";
    wrap.id = "efitNotifWrap";
    // Home page (Oct 29, Ken): a plain yellow bell, no circle, drawn about as tall and as bold as the "Ensemble Fitness" /
    // member-name text next to it (so the order is logo, then name, then bell -- big to small). Other pages keep the 🔔 they had.
    var BELL_SVG = '<svg viewBox="0 0 24 24" fill="currentColor" fill-opacity="0.22" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      '<path d="M18 9a6 6 0 0 0-12 0c0 6.5-2.5 8-2.5 8h17S18 15.5 18 9z"></path><path d="M10.2 20.5a2 2 0 0 0 3.6 0"></path></svg>';
    if (IS_HOME) wrap.className += " efit-feedbell-wrap";
    wrap.innerHTML =
      '<button type="button" class="efit-notif-bell' + (IS_HOME ? " efit-feedbell" : "") + '" id="efitNotifBell" aria-haspopup="true" aria-expanded="false" aria-label="Notifications">' +
        (IS_HOME ? BELL_SVG : "🔔") +
        '<span class="efit-notif-badge" id="efitNotifBadge" hidden>0</span>' +
      "</button>" +
      '<div class="efit-notif-panel" id="efitNotifPanel" hidden role="menu"></div>';

    group.appendChild(wrap);
    return wrap;
  }

  // ---- little profile circles (Oct 28) -------------------------------------------------------------
  function avatarColor(uid) {
    var h = 0, str = String(uid || "");
    for (var i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
    return "hsl(" + (h % 360) + " 45% 38%)";
  }
  function avatarHtml(row) {
    var name = row.actorName || "Someone";
    var initial = (name.trim().charAt(0) || "?").toUpperCase();
    var uid = row.actor_id ? String(row.actor_id) : "";
    return '<span class="efit-notif-av" ' + (uid ? (row.type !== "message" ? 'data-go="' + escapeHtml(uid) + '" ' : "") + 'data-av="' + escapeHtml(uid) + '" ' : "") +
      'style="background:' + avatarColor(uid) + '">' + escapeHtml(initial) + "</span>";
  }
  // Same rule the feed uses: a member's picture is their newest approved profile photo.
  async function hydrateAvatars(panel, rows) {
    try {
      var ids = [], seen = {};
      rows.forEach(function (r) { if (r.actor_id && !seen[r.actor_id]) { seen[r.actor_id] = true; ids.push(r.actor_id); } });
      if (!ids.length) return;
      var res = await window.sb.from("media").select("user_id, storage_path, created_at")
        .in("user_id", ids).eq("kind", "photo").eq("is_profile_photo", true).eq("status", "approved")
        .order("created_at", { ascending: false });
      if (!res || res.error || !res.data) return;
      var pathBy = {};
      res.data.forEach(function (r) { if (!pathBy[r.user_id]) pathBy[r.user_id] = r.storage_path; });
      await Promise.all(Object.keys(pathBy).map(async function (uid) {
        var s = await window.sb.storage.from("media").createSignedUrl(pathBy[uid], 3600);
        var url = s && s.data ? s.data.signedUrl : "";
        if (!url) return;
        Array.prototype.forEach.call(panel.querySelectorAll('.efit-notif-av[data-av="' + uid + '"]'), function (el) {
          el.style.background = "";
          el.innerHTML = '<img src="' + escapeHtml(url) + '" alt="" />';
        });
      }));
    } catch (e) { /* the colored initial stays */ }
  }

  // ---- phones: the notifications open as a full-width sheet (Oct 28) --------------------------------
  // Ken: "you have to scroll to the side to see your notifications ... they are really small on the right." On a phone the
  // dropdown hung off the right edge of the page. Now, on a phone, it is pinned to the screen: the full width, right under the
  // header, scrolling inside itself.
  function isPhone() { return window.matchMedia && window.matchMedia("(max-width: 720px)").matches; }
  function placeSheet(panel) {
    if (!isPhone()) { panel.classList.remove("efit-notif-sheet"); panel.style.cssText = ""; return; }
    try { window.scrollTo(0, window.pageYOffset || 0); document.documentElement.scrollLeft = 0; document.body.scrollLeft = 0; } catch (e) {}
    var nav = document.querySelector(".app-nav");
    var T = nav ? Math.max(0, Math.round(nav.getBoundingClientRect().bottom)) : 0;
    panel.classList.add("efit-notif-sheet");
    panel.style.cssText = "position:fixed;left:0;right:auto;top:" + T + "px;width:100vw;max-width:100vw;margin:0;transform:none;box-sizing:border-box;" +
      "max-height:" + Math.max(160, window.innerHeight - T - 72) + "px;overflow-y:auto;overflow-x:hidden;-webkit-overflow-scrolling:touch;z-index:2147483000;";
    // If a parent (blur/transform) makes "fixed" measure from the header instead of the screen, correct the offset once.
    var r = panel.getBoundingClientRect();
    var dx = r.left, dy = r.top - T;
    if (Math.abs(dx) > 0.5) panel.style.left = (-dx) + "px";
    if (Math.abs(dy) > 0.5) panel.style.top = (T - dy) + "px";
  }
  function injectStyles() {
    if (document.getElementById("efitNotifExtraCss")) return;
    var st = document.createElement("style");
    st.id = "efitNotifExtraCss";
    st.textContent =
      ".efit-notif-item { display: flex; align-items: flex-start; gap: 10px; }" +
      ".efit-notif-text { flex: 1; min-width: 0; overflow-wrap: anywhere; }" +
      ".efit-notif-av { flex: none; width: 38px; height: 38px; border-radius: 50%; overflow: hidden; display: flex; align-items: center; justify-content: center;" +
      " font-weight: 800; font-size: 15px; color: #fff; cursor: pointer; }" +
      ".efit-notif-av img { width: 100%; height: 100%; object-fit: cover; display: block; }" +
      ".efit-notif-close { display: none; }" +
      ".efit-notif-reply { display: block; margin-top: 3px; font-size: 12.5px; font-weight: 700; color: #ff8a4c; }" +
      ".efit-notif-sheet .efit-notif-panel-header { display: flex !important; align-items: center; gap: 10px; position: sticky; top: 0; z-index: 3; background: inherit; }" +
      ".efit-notif-sheet .efit-notif-panel-header > span:first-child { flex: 1 1 auto; }" +
      ".efit-notif-sheet .efit-notif-close { display: inline-flex; align-items: center; justify-content: center; flex: none; width: 46px; height: 46px; margin: -8px -8px -8px auto; padding: 0;" +
      " border: 0; border-radius: 50%; background: rgba(255,255,255,0.10); color: #fff; font-size: 24px; font-weight: 800; line-height: 1; cursor: pointer; -webkit-tap-highlight-color: transparent; }" +
      ".efit-notif-name { cursor: pointer; text-decoration: underline; text-decoration-color: rgba(255,255,255,0.35); text-underline-offset: 2px; }" +
      "@media (max-width: 720px) { .efit-notif-sheet .efit-notif-item { padding-top: 12px; padding-bottom: 12px; } }" +
      // ---- Home page bell (Oct 29) ----
      ".efit-notif-wrap.efit-feedbell-wrap { position: relative; display: inline-flex; align-items: center; }" +
      ".efit-notif-bell.efit-feedbell { position: relative; background: none !important; border: 0 !important; box-shadow: none !important; border-radius: 0 !important;" +
      " width: 34px; height: 34px; padding: 0 !important; margin: 0; font-size: 0 !important; line-height: 0; color: #ffd23f; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; -webkit-tap-highlight-color: transparent; }" +
      ".efit-feedbell svg { width: 20px; height: 20px; display: block; }" +
      // the count: a red number floating by itself on the yellow bell (no circle)
      ".efit-feedbell .efit-notif-badge { position: absolute !important; top: -3px !important; right: -4px !important; left: auto !important; min-width: 0 !important; height: auto !important; padding: 0 !important;" +
      " background: none !important; border: 0 !important; border-radius: 0 !important; box-shadow: none !important; color: #ff3b30 !important; font-family: 'Inter', -apple-system, 'Segoe UI', Arial, sans-serif !important;" +
      " font-size: 16px !important; font-weight: 800 !important; font-variant-numeric: lining-nums; line-height: 1 !important; pointer-events: none; text-shadow: 0 0 3px #000, 0 1px 2px #000, 0 -1px 2px #000; }" +
      ".efit-feedbell .efit-notif-badge[hidden] { display: none !important; }" +
      "#rpAppNav .efit-nav-utility { display: flex; align-items: center; gap: 6px; margin-left: 8px; flex: none; }" +
      // computer: the bell sits right after the member's name; its list drops down underneath it
      ".rp-dash-bell-slot .efit-feedbell svg { width: 21px; height: 21px; }" +
      ".rp-dash-bell-slot .efit-notif-panel { position: absolute; top: calc(100% + 8px); left: 0; right: auto; width: min(400px, 92vw); max-height: 70vh; overflow-y: auto; z-index: 60; }" +
      // phones only (Oct 29, Ken): the Home button is one size on every phone page -- a 40px circle with a 23px house (was 32px / 18px)
      "@media (max-width: 899px) { #efitHomeLink.efit-home-link { display: inline-flex !important; align-items: center; justify-content: center; width: 40px !important; height: 40px !important; min-width: 40px; padding: 0 !important; border-radius: 50% !important; flex: none; }" +
      " #efitHomeLink.efit-home-link svg { width: 23px !important; height: 23px !important; } }";
    st.textContent += NEW_CSS;
    document.head.appendChild(st);
  }

  // Oct 29 (Ken): on a phone the list is a full-width sheet with no way to put it away, so it gets a big X at the far right of the
  // "Notifications" line. (Hidden on a computer, where the list is a small dropdown that closes when you click elsewhere.)
  var CLOSE_BTN = '<button type="button" class="efit-notif-close" id="efitNotifClose" aria-label="Close notifications">\u2715</button>';


  // =====================================================================================================================
  // Nov 2026 (Ken): "What's new" in the bell. Besides personal activity (reactions, comments, follows, messages), the bell now
  // also counts what is NEW on the site since this member last looked: Journeys, Meal Preps, member posts and Challenges.
  // No rows are written per member: each phone/browser remembers when it last looked at each area (localStorage) and the bell
  // just counts what was posted after that (a count-only question per area, cached ~2 minutes). Own posts never count.
  // =====================================================================================================================
  var NEW_AREAS = [
    { key: "journeys",   icon: "\uD83C\uDF05", one: "new Journey",     many: "new Journeys",     idle: "Journeys",   href: "fitness-journeys.html", page: /fitness-journeys/ },
    { key: "mealprep",   icon: "\uD83E\uDD57", one: "new Meal Prep",   many: "new Meal Preps",   idle: "Meal Preps", href: "meal-prep.html",        page: /meal-prep/ },
    { key: "posts",      icon: "\uD83D\uDE4C", one: "new member post", many: "new member posts", idle: "Member posts", href: "feed.html",           page: null },
    { key: "challenges", icon: "\uD83C\uDFC6", one: "new Challenge",   many: "new Challenges",   idle: "Challenges", href: "challenges.html",       page: /challenges/ }
  ];
  var NEW_TTL_MS = 120000;
  var newCounts = {};      // key -> number
  var newLatest = {};      // key -> "Latest: ..." text (filled when the panel opens)
  var newFetchedAt = 0;
  var newInFlight = null;

  function seenKey(uid, key) { return "efit_seen_" + uid + "_" + key; }
  function getSeen(uid, key) {
    var now = new Date().toISOString();
    try {
      var v = window.localStorage.getItem(seenKey(uid, key));
      if (!v) { window.localStorage.setItem(seenKey(uid, key), now); return now; }   // first time: start counting from now
      return v;
    } catch (e) { return now; }
  }
  function setSeen(uid, key) {
    try { window.localStorage.setItem(seenKey(uid, key), new Date().toISOString()); } catch (e) {}
    newCounts[key] = 0; newLatest[key] = "";
  }
  function setAllSeen(uid) { NEW_AREAS.forEach(function (a) { setSeen(uid, a.key); }); }
  function newTotal() { var n = 0; NEW_AREAS.forEach(function (a) { n += (newCounts[a.key] || 0); }); return n; }

  function notMine(q, uid) {
    q = q.neq("user_id", uid);
    try {
      var ids = window.blockedIds ? Array.prototype.slice.call(window.blockedIds) : [];
      if (ids.length && ids.length <= 60) q = q.not("user_id", "in", "(" + ids.join(",") + ")");
    } catch (e) {}
    return q;
  }
  function areaQuery(key, uid, since, wantRow) {
    var sel = wantRow ? "" : null;
    var q;
    if (key === "journeys") {
      q = window.sb.from("community_questions")
        .select(wantRow ? "activity, notes, asker_name, created_at" : "id", wantRow ? undefined : { count: "exact", head: true })
        .eq("status", "approved");
      q = notMine(q, uid).gt("created_at", since);
    } else if (key === "mealprep" || key === "posts") {
      q = window.sb.from("media")
        .select(wantRow ? "caption, created_at, profiles!media_user_id_fkey(display_name)" : "id", wantRow ? undefined : { count: "exact", head: true })
        .eq("status", "approved").in("kind", ["video", "photo"]);
      q = key === "mealprep" ? q.eq("workout_type", "Meal Prep") : q.or("workout_type.neq.Meal Prep,workout_type.is.null");
      q = notMine(q, uid).gt("created_at", since);
    } else {
      q = window.sb.from("community_events")
        .select(wantRow ? "title, created_at" : "id", wantRow ? undefined : { count: "exact", head: true })
        .gte("starts_at", new Date().toISOString());
      q = q.neq("created_by", uid).gt("created_at", since);
    }
    if (wantRow) q = q.order("created_at", { ascending: false }).limit(1);
    return q;
  }

  async function fetchNewCounts(uid, force) {
    if (!force && Date.now() - newFetchedAt < NEW_TTL_MS) return newCounts;
    if (newInFlight) return newInFlight;
    newInFlight = (async function () {
      await Promise.all(NEW_AREAS.map(async function (a) {
        try {
          var res = await areaQuery(a.key, uid, getSeen(uid, a.key), false);
          newCounts[a.key] = (res && !res.error && typeof res.count === "number") ? res.count : 0;
        } catch (e) { newCounts[a.key] = 0; }
      }));
      newFetchedAt = Date.now();
      newInFlight = null;
      return newCounts;
    })();
    return newInFlight;
  }

  function snippet(s, n) { s = String(s || "").replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "\u2026" : s; }
  async function fetchNewLatest(uid) {
    await Promise.all(NEW_AREAS.map(async function (a) {
      if (!(newCounts[a.key] > 0)) { newLatest[a.key] = ""; return; }
      try {
        var res = await areaQuery(a.key, uid, getSeen(uid, a.key), true);
        var r = res && !res.error && res.data && res.data[0];
        if (!r) { newLatest[a.key] = ""; return; }
        if (a.key === "journeys") newLatest[a.key] = "Latest: " + snippet(r.activity || r.notes || "", 40);
        else if (a.key === "challenges") newLatest[a.key] = "Latest: " + snippet(r.title, 40);
        else {
          var who = r.profiles && r.profiles.display_name;
          newLatest[a.key] = r.caption ? "Latest: " + snippet(r.caption, 40) : (who ? "Latest from " + who : "");
        }
      } catch (e) { newLatest[a.key] = ""; }
    }));
  }

  function newSectionHtml() {
    var h = '<div class="efit-new-lab"><span>\u2B50 What\u2019s new</span><s></s></div><div class="efit-new-wrap">';
    NEW_AREAS.forEach(function (a) {
      var n = newCounts[a.key] || 0;
      h += '<a href="' + a.href + '" class="efit-new-row' + (n ? "" : " seen") + '" data-area="' + a.key + '">' +
        '<span class="efit-new-ic">' + a.icon + '</span>' +
        '<span class="efit-new-t"><b>' + (n ? n + " " + (n === 1 ? a.one : a.many) : a.idle) + '</b>' +
        '<span>' + escapeHtml(n ? (newLatest[a.key] || "Tap to see") : "Nothing new since you looked") + '</span></span>' +
        (n ? '<span class="efit-new-cnt">' + (n > 99 ? "99+" : n) + '</span>' : '') +
        '<span class="efit-new-chev">\u203A</span></a>';
    });
    return h + '</div>';
  }

  var NEW_CSS =
    ".efit-new-lab { display: flex; align-items: center; gap: 8px; padding: 12px 14px 4px; font-size: 12px; font-weight: 800; letter-spacing: 0.1em; text-transform: uppercase; color: #ff5a1f; }" +
    ".efit-new-lab s { flex: 1; height: 1px; background: rgba(255,255,255,0.1); text-decoration: none; }" +
    ".efit-new-wrap { padding: 0 10px 6px; }" +
    ".efit-new-row { display: flex; align-items: center; gap: 11px; padding: 9px 10px; margin: 5px 0; border-radius: 16px; background: rgba(255,90,31,0.10); border: 1px solid rgba(255,122,61,0.45); color: #fff; text-decoration: none; }" +
    ".efit-new-row.seen { background: rgba(255,255,255,0.04); border-color: rgba(255,255,255,0.1); }" +
    ".efit-new-ic { flex: none; width: 40px; height: 40px; border-radius: 13px; background: rgba(255,90,31,0.2); display: flex; align-items: center; justify-content: center; font-size: 20px; }" +
    ".efit-new-row.seen .efit-new-ic { background: rgba(255,255,255,0.08); }" +
    ".efit-new-t { flex: 1; min-width: 0; }" +
    ".efit-new-t b { display: block; font-size: 15px; font-weight: 800; color: #fff; }" +
    ".efit-new-t span { display: block; font-size: 12.5px; color: #b9bcc4; margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }" +
    ".efit-new-cnt { flex: none; min-width: 26px; height: 26px; border-radius: 13px; background: #ff5a1f; color: #fff; font-weight: 800; font-size: 13px; display: flex; align-items: center; justify-content: center; padding: 0 7px; }" +
    ".efit-new-chev { flex: none; color: #8d919a; font-size: 20px; line-height: 1; }" +
    ".efit-foryou-empty { padding: 10px 16px 16px; font-size: 13px; color: rgba(255,255,255,0.6); }";

  function renderList(panel, rows) {
    var hasUnread = rows.some(function (r) { return !r.read_at; }) || newTotal() > 0;
    var html = '<div class="efit-notif-panel-header"><span>Notifications</span>';
    if (hasUnread) html += '<button type="button" class="efit-notif-mark-all" id="efitNotifMarkAll">Mark all read</button>';
    html += CLOSE_BTN + "</div>";
    html += newSectionHtml();
    html += '<div class="efit-new-lab"><span>\uD83D\uDC64 For you</span><s></s></div>';
    if (!rows.length) {
      html += '<div class="efit-foryou-empty">Nothing yet \u2014 when someone reacts, comments, follows, or messages you, it\u2019ll show up here.</div>';
    }
    rows.forEach(function (row) {
      html +=
        '<a href="' + destinationFor(row) + '" class="efit-notif-item' + (row.read_at ? "" : " unread") + '" data-id="' + row.id + '">' +
          avatarHtml(row) +
          '<span class="efit-notif-text">' + describe(row) +
          '<span class="efit-notif-item-time">' + timeAgo(row.created_at) + "</span></span>" +
        "</a>";
    });
    panel.innerHTML = html;
  }

  async function fetchRows(userId) {
    // notifications has TWO foreign keys into profiles (recipient_id AND
    // actor_id) — a plain "profiles(display_name)" embed is ambiguous and
    // errors out (the exact bug hit earlier with media_reactions/comments),
    // so the actor's name is fetched via the explicitly-named FK hint.
    var SEL = "id, type, media_id, reaction_type, preview, actor_id, created_at, read_at, profiles!notifications_actor_id_fkey(display_name)";
    // Oct 29 (Ken: "I looked at all 8 and it still says 8"): the list used to be only the newest 20, so unread ones older than that were
    // counted by the bell but never shown or cleared. Now: the newest 30, plus every unread one (up to 60), merged.
    var results = await Promise.all([
      window.sb.from("notifications").select(SEL).eq("recipient_id", userId).order("created_at", { ascending: false }).limit(30),
      window.sb.from("notifications").select(SEL).eq("recipient_id", userId).is("read_at", null).order("created_at", { ascending: false }).limit(60)
    ]);
    var data = null, seenIds = {};
    results.forEach(function (res) {
      if (!res || res.error || !res.data) return;
      data = data || [];
      res.data.forEach(function (r) { if (!seenIds[r.id]) { seenIds[r.id] = true; data.push(r); } });
    });
    if (!data) return [];
    data.sort(function (a, b) { return new Date(b.created_at) - new Date(a.created_at); });
    return data.map(function (row) {
      return {
        id: row.id,
        type: row.type,
        media_id: row.media_id,
        reaction_type: row.reaction_type,
        preview: row.preview,
        actor_id: row.actor_id,
        created_at: row.created_at,
        read_at: row.read_at,
        actorName: (row.profiles && row.profiles.display_name) || "Someone"
      };
    });
  }

  async function refreshBadge(userId) {
    var badge = document.getElementById("efitNotifBadge");
    if (!badge) return;
    var { count } = await window.sb
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("recipient_id", userId)
      .is("read_at", null);
    var n = count || 0;
    try { await fetchNewCounts(userId, false); } catch (e) {}
    n += newTotal();
    if (n > 0) {
      badge.textContent = n > 99 ? "99+" : String(n);
      badge.hidden = false;
    } else {
      badge.hidden = true;
    }
  }

  // Marks every unread notification of this member as read in the database -- the same rows the website, the phone app and the
  // Profile page all read, so seeing them anywhere clears the number everywhere (other screens pick it up within ~30s or when
  // they come back to the front). Not just the rows on screen.
  var markInFlight = false;
  async function markAllRead(userId) {
    if (markInFlight) return;
    markInFlight = true;
    try {
      var res = await window.sb.from("notifications").update({ read_at: new Date().toISOString() })
        .eq("recipient_id", userId).is("read_at", null).select("id");
      if (res && res.error && window.console) console.warn("notifications: could not mark as read", res.error);
    } catch (e) { if (window.console) console.warn("notifications: mark-read failed", e); }
    markInFlight = false;
    await refreshBadge(userId);
  }
  var pendingMark = false;
  function flushMark() {
    if (autoMarkReadTimeoutId) { clearTimeout(autoMarkReadTimeoutId); autoMarkReadTimeoutId = null; }
    if (pendingMark && currentUserId) { pendingMark = false; markAllRead(currentUserId); }
  }

  function closePanel() {
    var panel = document.getElementById("efitNotifPanel");
    var bell = document.getElementById("efitNotifBell");
    if (!panel) return;
    flushMark(); // closing = "I've seen them": don't lose the mark-as-read if it was still waiting its beat
    panel.hidden = true;
    panel.classList.remove("efit-notif-sheet");
    panel.style.cssText = "";
    if (bell) bell.setAttribute("aria-expanded", "false");
    panelOpen = false;
  }

  async function openPanel(userId) {
    var panel = document.getElementById("efitNotifPanel");
    var bell = document.getElementById("efitNotifBell");
    if (!panel) return;
    panel.hidden = false;
    if (bell) bell.setAttribute("aria-expanded", "true");
    panelOpen = true;

    // A fresh open always supersedes whatever the previous open's 1.5s
    // timer was about to do (see below) — cancel it so re-opening the
    // panel can't stack up more than one pending auto-mark-read call.
    if (autoMarkReadTimeoutId) {
      clearTimeout(autoMarkReadTimeoutId);
      autoMarkReadTimeoutId = null;
    }

    placeSheet(panel);
    var results = await Promise.all([fetchRows(userId), fetchNewCounts(userId, true)]);
    var rows = results[0];
    await fetchNewLatest(userId);
    renderList(panel, rows);
    placeSheet(panel); // (the list just changed height)
    hydrateAvatars(panel, rows);

    var markAllBtn = document.getElementById("efitNotifMarkAll");
    if (markAllBtn) {
      markAllBtn.addEventListener("click", function (e) {
        e.preventDefault();
        // Ken's ask (Oct 2026): clicking this used to leave the 1.5s
        // auto-mark-read timer below still pending, so it fired a second,
        // redundant markAllRead call with the same ids a moment later —
        // harmless (idempotent update), but an avoidable extra request on
        // every single "Mark all read" click across the whole user base.
        if (autoMarkReadTimeoutId) {
          clearTimeout(autoMarkReadTimeoutId);
          autoMarkReadTimeoutId = null;
        }
        pendingMark = false;
        markAllRead(userId);
        setAllSeen(userId);
        renderList(panel, rows.map(function (r) { r.read_at = r.read_at || new Date().toISOString(); return r; }));
        placeSheet(panel);
        hydrateAvatars(panel, rows);
        refreshBadge(userId);
      });
    }

    // Opening the panel is "I saw these" — mark whatever was unread at open
    // time as read a beat later, so the highlight doesn't vanish out from
    // under someone still reading it.
    var badgeEl = document.getElementById("efitNotifBadge");
    var anyUnread = rows.some(function (r) { return !r.read_at; }) || (badgeEl && !badgeEl.hidden);
    if (anyUnread) {
      pendingMark = true;
      autoMarkReadTimeoutId = setTimeout(function () {
        autoMarkReadTimeoutId = null;
        pendingMark = false;
        markAllRead(userId);
      }, 1500);
    }
  }

  function wireEvents(userId) {
    var bell = document.getElementById("efitNotifBell");
    if (!bell) return;

    bell.addEventListener("click", function (e) {
      e.stopPropagation();
      if (panelOpen) { closePanel(); return; }
      openPanel(userId);
    });

    // Tap a person's photo or name inside a notification -> their profile and grid (not the notification's own page).
    var panelEl = document.getElementById("efitNotifPanel");
    if (panelEl) panelEl.addEventListener("click", function (e) {
      if (e.target.closest && e.target.closest("#efitNotifClose")) { e.preventDefault(); e.stopPropagation(); closePanel(); return; }
    });
    if (panelEl) panelEl.addEventListener("click", function (e) {
      var a = e.target.closest ? e.target.closest(".efit-new-row") : null;
      if (a) setSeen(userId, a.getAttribute("data-area"));   // the link itself then takes them to that page
    });
    window.addEventListener("pagehide", flushMark);
    document.addEventListener("visibilitychange", function () { if (document.hidden) flushMark(); });
    if (panelEl) panelEl.addEventListener("click", function (e) {
      var t = e.target.closest ? e.target.closest("[data-go]") : null;
      if (!t) return;
      e.preventDefault(); e.stopPropagation();
      var uid = t.getAttribute("data-go");
      if (uid) window.location.href = (uid === userId) ? "profile.html" : "member.html?id=" + encodeURIComponent(uid);
    });
    window.addEventListener("resize", function () { if (panelOpen) { var p = document.getElementById("efitNotifPanel"); if (p) placeSheet(p); } });

    document.addEventListener("click", function (e) {
      var wrap = document.getElementById("efitNotifWrap");
      if (panelOpen && wrap && !wrap.contains(e.target)) closePanel();
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && panelOpen) closePanel();
    });
  }

  document.addEventListener("DOMContentLoaded", async function () {
    if (!window.sb) return;
    var { data } = await window.sb.auth.getSession();
    var userId = data && data.session && data.session.user ? data.session.user.id : null;
    if (!userId) return; // signed out — nothing to show yet

    currentUserId = userId;
    IS_HOME = !!document.getElementById("rpDashBellSlot");
    injectStyles();
    buildHomeLink();
    // Marketplace (gear.html, the Amazon picks): Home button only, no bell (Ken, Oct 29)
    if (/(^|\/)gear(\.html)?(\?|#|$)/.test(window.location.pathname)) return;
    var wrap = buildBell();
    if (!wrap) return;

    placeHomeBell();
    if (IS_HOME && window.matchMedia) {
      var mq = window.matchMedia("(min-width: 900px)");
      if (mq.addEventListener) mq.addEventListener("change", placeHomeBell); else if (mq.addListener) mq.addListener(placeHomeBell);
    }
    wireEvents(userId);
    // Being on Journeys / Meal Preps / Challenges counts as "looked". Member posts: spending a few seconds on Home counts.
    var path = window.location.pathname || "";
    NEW_AREAS.forEach(function (a) { if (a.page && a.page.test(path)) setSeen(userId, a.key); });
    if (IS_HOME) setTimeout(function () { setSeen(userId, "posts"); refreshBadge(userId); }, 8000);
    refreshBadge(userId);
    // Live count: every 30 seconds while the page is showing, and straight away when the app/tab comes back to the front.
    setInterval(function () { if (!document.hidden) refreshBadge(userId); }, POLL_MS);
    window.addEventListener("focus", function () { refreshBadge(userId); });
    document.addEventListener("visibilitychange", function () { if (!document.hidden) refreshBadge(userId); });
  });
})();
