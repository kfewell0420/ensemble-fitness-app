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
  var POLL_MS = 60000; // backstop only — also refreshes on window focus and right after opening the panel
  var currentUserId = null;
  var panelOpen = false;

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
    if (row.type === "reaction") {
      return "<strong>" + name + "</strong> reacted " + reactionEmoji(row.reaction_type) + " to your post";
    }
    if (row.type === "comment") {
      return "<strong>" + name + "</strong> commented: “" + escapeHtml(row.preview || "") + "”";
    }
    if (row.type === "follow") {
      return "<strong>" + name + "</strong> started following you";
    }
    if (row.type === "message") {
      return "<strong>" + name + "</strong> sent you a message: “" + escapeHtml(row.preview || "") + "”";
    }
    return "<strong>" + name + "</strong> did something on Ensemble Fitness";
  }

  function destinationFor(row) {
    if (row.type === "reaction" || row.type === "comment") return "feed.html";
    if (row.type === "follow") return row.actor_id ? "member.html?id=" + encodeURIComponent(row.actor_id) : "members.html";
    if (row.type === "message") return "profile.html";
    return "feed.html";
  }

  function buildBell() {
    var nav = document.querySelector(".app-nav");
    var links = nav ? nav.querySelector(".app-nav-links") : null;
    if (!nav || !links || document.getElementById("efitNotifWrap")) return null;

    var wrap = document.createElement("div");
    wrap.className = "efit-notif-wrap";
    wrap.id = "efitNotifWrap";
    wrap.innerHTML =
      '<button type="button" class="efit-notif-bell" id="efitNotifBell" aria-haspopup="true" aria-expanded="false" aria-label="Notifications">' +
        "🔔" +
        '<span class="efit-notif-badge" id="efitNotifBadge" hidden>0</span>' +
      "</button>" +
      '<div class="efit-notif-panel" id="efitNotifPanel" hidden role="menu"></div>';

    // Sits right after the page's own nav links, before "Sign Out" would be
    // reached visually since it's appended last in that same flex row —
    // consistent placement across every page regardless of how many links
    // that particular page has.
    links.appendChild(wrap);
    return wrap;
  }

  function renderList(panel, rows) {
    if (!rows.length) {
      panel.innerHTML =
        '<div class="efit-notif-panel-header">Notifications</div>' +
        '<div class="empty-state">No notifications yet — when someone reacts, comments, follows, or messages you, it’ll show up here.</div>';
      return;
    }
    var hasUnread = rows.some(function (r) { return !r.read_at; });
    var html = '<div class="efit-notif-panel-header"><span>Notifications</span>';
    if (hasUnread) html += '<button type="button" class="efit-notif-mark-all" id="efitNotifMarkAll">Mark all read</button>';
    html += "</div>";
    rows.forEach(function (row) {
      html +=
        '<a href="' + destinationFor(row) + '" class="efit-notif-item' + (row.read_at ? "" : " unread") + '" data-id="' + row.id + '">' +
          describe(row) +
          '<span class="efit-notif-item-time">' + timeAgo(row.created_at) + "</span>" +
        "</a>";
    });
    panel.innerHTML = html;
  }

  async function fetchRows(userId) {
    // notifications has TWO foreign keys into profiles (recipient_id AND
    // actor_id) — a plain "profiles(display_name)" embed is ambiguous and
    // errors out (the exact bug hit earlier with media_reactions/comments),
    // so the actor's name is fetched via the explicitly-named FK hint.
    var { data, error } = await window.sb
      .from("notifications")
      .select("id, type, media_id, reaction_type, preview, actor_id, created_at, read_at, profiles!notifications_actor_id_fkey(display_name)")
      .eq("recipient_id", userId)
      .order("created_at", { ascending: false })
      .limit(20);
    if (error || !data) return [];
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
    if (n > 0) {
      badge.textContent = n > 9 ? "9+" : String(n);
      badge.hidden = false;
    } else {
      badge.hidden = true;
    }
  }

  async function markAllRead(userId, ids) {
    if (!ids.length) return;
    await window.sb.from("notifications").update({ read_at: new Date().toISOString() }).in("id", ids);
    refreshBadge(userId);
  }

  function closePanel() {
    var panel = document.getElementById("efitNotifPanel");
    var bell = document.getElementById("efitNotifBell");
    if (!panel) return;
    panel.hidden = true;
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

    var rows = await fetchRows(userId);
    renderList(panel, rows);

    var markAllBtn = document.getElementById("efitNotifMarkAll");
    if (markAllBtn) {
      markAllBtn.addEventListener("click", function (e) {
        e.preventDefault();
        var unreadIds = rows.filter(function (r) { return !r.read_at; }).map(function (r) { return r.id; });
        markAllRead(userId, unreadIds);
        panel.querySelectorAll(".efit-notif-item.unread").forEach(function (el) { el.classList.remove("unread"); });
        markAllBtn.remove();
      });
    }

    // Opening the panel is "I saw these" — mark whatever was unread at open
    // time as read a beat later, so the highlight doesn't vanish out from
    // under someone still reading it.
    var unreadIds = rows.filter(function (r) { return !r.read_at; }).map(function (r) { return r.id; });
    if (unreadIds.length) {
      setTimeout(function () { markAllRead(userId, unreadIds); }, 1500);
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
    var wrap = buildBell();
    if (!wrap) return;

    wireEvents(userId);
    refreshBadge(userId);
    setInterval(function () { refreshBadge(userId); }, POLL_MS);
    window.addEventListener("focus", function () { refreshBadge(userId); });
  });
})();
