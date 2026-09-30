/* =========================================================================
   Cross-domain sign-in handoff: app.ensemblefitness.com -> ensemblefitness.com
   -------------------------------------------------------------------------
   Earlier attempt: make Supabase store its ENTIRE session (tokens + full
   user object — email, metadata, identities, etc.) in a cookie shared
   across both subdomains. That blew past the ~4KB a single cookie allows,
   which silently failed to save and locked people out of signing in at
   all. Reverted that in js/supabaseClient.js — the app's own session is
   back to Supabase's normal, reliable per-origin localStorage.

   This is a smaller, safer replacement: instead of mirroring the WHOLE
   session, this app writes just the two small tokens (access + refresh)
   needed to hand off a working session to the marketing site — a few
   hundred bytes, nowhere near the cookie limit. It never touches how the
   app itself stores or manages its own session.

   Call writeCrossDomainSession(session) whenever this app has a session
   (see js/supabaseClient.js's onAuthStateChange), and
   clearCrossDomainSession() on sign out. The site reads it back with
   readCrossDomainSession() (site/js/shared-session.js) and calls
   supabase.auth.setSession({access_token, refresh_token}) once to pick up
   a real, working session of its own — after that the site manages its
   own refresh independently; this cookie is only ever a one-time handoff.
   ========================================================================= */
(function () {
  var COOKIE_NAME = "efit_xsession";

  function cookieDomain() {
    var host = window.location.hostname;
    return host.indexOf("ensemblefitness.com") !== -1 ? ".ensemblefitness.com" : host;
  }

  function writeCrossDomainSession(session) {
    if (!session || !session.access_token || !session.refresh_token) return;
    var payload = JSON.stringify({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_at: session.expires_at
    });
    var expires = new Date();
    expires.setTime(expires.getTime() + 30 * 24 * 60 * 60 * 1000); // 30 days
    document.cookie = COOKIE_NAME + "=" + encodeURIComponent(payload) +
      "; expires=" + expires.toUTCString() +
      "; path=/; domain=" + cookieDomain() + "; SameSite=Lax; Secure";
  }

  function clearCrossDomainSession() {
    document.cookie = COOKIE_NAME + "=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; domain=" + cookieDomain();
  }

  window.writeCrossDomainSession = writeCrossDomainSession;
  window.clearCrossDomainSession = clearCrossDomainSession;
})();
