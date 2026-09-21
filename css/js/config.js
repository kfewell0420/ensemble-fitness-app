/* =========================================================================
   Ensemble Fitness member app — Supabase connection config
   -------------------------------------------------------------------------
   Fill these two values in from your Supabase project:
     Dashboard → Project Settings → API → "Project URL" and "anon public" key
   The anon key is safe to expose in client-side code like this — it only
   ever works within the limits of the Row Level Security policies defined
   in sql/schema.sql.
   ========================================================================= */

window.SUPABASE_URL = "https://wgrldwdgvvlhcmlyoxrl.supabase.co";
window.SUPABASE_ANON_KEY = "sb_publishable_4sbGE70Sh5gkgpmBqdGVBg_VkqjzJVx";

/* =========================================================================
   Visible error banner — loaded first, before any other script on the
   page, so it can catch a failure anywhere (a script that failed to run,
   a promise that rejected and nobody caught it) and show it in plain red
   text at the top of the page instead of it failing silently.
   This exists specifically because "the button does nothing" is nearly
   impossible to diagnose without seeing the actual browser console — this
   puts that same information directly on the screen instead.
   ========================================================================= */
(function () {
  function showNow(message) {
    var existing = document.getElementById("efitErrorBanner");
    if (existing) {
      existing.textContent += "  |  " + message;
      return;
    }
    var banner = document.createElement("div");
    banner.id = "efitErrorBanner";
    banner.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:99999;" +
      "background:#c0392b;color:#fff;padding:12px 16px;font:14px/1.4 -apple-system,BlinkMacSystemFont,sans-serif;" +
      "text-align:center;box-shadow:0 2px 8px rgba(0,0,0,0.3);";
    banner.textContent = "Something went wrong — please screenshot this and send it: " + message;
    document.body.prepend(banner);
  }
  function showErrorBanner(message) {
    if (document.body) { showNow(message); return; }
    document.addEventListener("DOMContentLoaded", function () { showNow(message); });
  }
  window.addEventListener("error", function (e) {
    showErrorBanner(e.message || "Unknown script error");
  });
  window.addEventListener("unhandledrejection", function (e) {
    var reason = e.reason;
    var msg = (reason && reason.message) ? reason.message : String(reason);
    showErrorBanner(msg);
  });
})();
