/* =========================================================================
   Notification-style badge on the "Fitness Journeys" nav link (desktop +
   mobile menu) — a small orange circle with just a number, sitting at the
   upper-right corner of the word "Journeys", the same pattern as an
   unread-count badge on Instagram/Facebook/email. "Fitness Journeys" itself
   stays plain nav-link text at all times; only the little circle is ever
   highlighted.

   The number is simply the total count of real, approved journeys
   (community_questions where status = 'approved') that exist right now.
   It's the same number for every visitor, on every browser, every time —
   no per-visitor "have you seen this" memory, no localStorage. (An earlier
   version tried a per-browser unread/seen count, but that meant the badge
   could look "broken" on one browser/device while working fine on another
   — simpler and more predictable to just show the live total everywhere.)

   It also updates LIVE while someone is sitting on the page: this
   subscribes to Supabase Realtime changes on community_questions, so if
   another member posts a journey while you're already on the homepage,
   the number ticks up (with a little flash) without you refreshing.
   Realtime needs to be turned on for that table in the Supabase dashboard
   (Database → Replication) — if it isn't, the badge still works and shows
   the right count on every page load, it just won't update live without a
   refresh until that's switched on.

   Clicking the badge (or the rest of the "Fitness Journeys" link) takes you
   to the Fitness Journeys page; if there's at least one approved journey,
   it deep-links straight to the newest one and gives it a brief highlight,
   via journey-real-posts.js on that page.
   ========================================================================= */
(function () {
  var SUPABASE_URL = "https://wgrldwdgvvlhcmlyoxrl.supabase.co";
  var SUPABASE_ANON_KEY = "sb_publishable_4sbGE70Sh5gkgpmBqdGVBg_VkqjzJVx";
  var lastKnownTotal = null;

  function setBadges(total, latestId, flash) {
    var badges = document.querySelectorAll(".journeys-badge");
    for (var i = 0; i < badges.length; i++) {
      var badge = badges[i];
      // closest() walks up to the enclosing <a href="fitness-journey.html">
      // so clicking the badge (or the rest of the link) can be pointed at
      // the specific newest journey instead of just the page in general.
      var link = badge.closest ? badge.closest("a") : null;
      if (total > 0) {
        badge.textContent = String(total);
        badge.style.display = "flex";
        badge.setAttribute("aria-label", total + (total === 1 ? " journey" : " journeys") + " shared so far");
        if (link && latestId) {
          link.href = "fitness-journey.html#journey-" + latestId;
        }
        if (flash) {
          badge.classList.remove("journeys-badge-flash");
          // eslint-disable-next-line no-unused-expressions
          badge.offsetWidth; // force reflow so the animation can restart
          badge.classList.add("journeys-badge-flash");
        }
      } else {
        badge.style.display = "none";
        badge.removeAttribute("aria-label");
        if (link) {
          link.href = "fitness-journey.html";
        }
      }
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    if (!document.querySelector(".journeys-badge")) return;

    if (!window.supabase) {
      // The supabase-js CDN script (loaded right before this file) didn't
      // define window.supabase — almost always a network/ad-blocker issue
      // blocking cdn.jsdelivr.net, not a bug in this file. Logged instead
      // of failing silently so it shows up in the browser console (F12).
      console.warn("[journeys-badge] window.supabase is missing — the Supabase JS library from cdn.jsdelivr.net never loaded, so the journeys count can't be fetched.");
      return;
    }

    try {
      var sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

      function refreshBadge() {
        // count:"exact" (without head:true) also returns the row data, so a
        // single request gets both the total approved count AND — since
        // it's ordered newest first and capped at 1 — the newest approved
        // journey's id, which is what the badge link points to.
        return sb
          .from("community_questions")
          .select("id", { count: "exact" })
          .eq("status", "approved")
          .order("created_at", { ascending: false })
          .limit(1)
          .then(function (res) {
            if (!res || res.error) {
              console.warn("[journeys-badge] Supabase query failed — check that the community_questions table and its 'status = approved' rows are readable by an anonymous visitor (RLS policy).", res && res.error);
              return;
            }
            if (typeof res.count !== "number") {
              console.warn("[journeys-badge] Supabase returned no count — check the anon key / project URL are still correct.", res);
              return;
            }
            var total = res.count;
            var latestId = res.data && res.data[0] ? res.data[0].id : null;
            var changed = lastKnownTotal !== null && total !== lastKnownTotal;
            console.log("[journeys-badge] approved total:", total, "newest id:", latestId, changed ? "(live update)" : "");
            setBadges(total, latestId, changed);
            lastKnownTotal = total;
          })
          .catch(function (err) {
            console.warn("[journeys-badge] Supabase request threw an error:", err);
          });
      }

      refreshBadge();

      // Live updates: re-check the count whenever a journey is added,
      // approved, edited, or removed, so the badge changes in front of
      // someone already sitting on the page instead of waiting for a
      // reload. Re-fetching (rather than trusting the payload) keeps the
      // count exactly right even though this listens broadly instead of
      // filtering to status=approved (a filter would miss the case of a
      // post moving OUT of approved).
      sb.channel("journeys-badge-changes")
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "community_questions" },
          function () {
            refreshBadge();
          }
        )
        .subscribe();
    } catch (e) {
      console.warn("[journeys-badge] Unexpected error setting up the badge:", e);
    }
  });
})();
