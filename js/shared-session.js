/* =========================================================================
   Cross-domain sign-in handoff: app.ensemblefitness.com -> ensemblefitness.com
   -------------------------------------------------------------------------
   Reads the small handoff cookie the member app writes (see
   member-app/js/shared-session.js) — just an access token + refresh token,
   not the whole session — and hands it to a Supabase client here via
   supabase.auth.setSession({access_token, refresh_token}). That's a
   ONE-TIME bootstrap: once set, this site's own Supabase client keeps and
   refreshes that session in its own localStorage from then on, so this
   cookie only needs to be read when the site doesn't already have a
   working local session of its own.

   Earlier attempt mirrored Supabase's ENTIRE session object (including the
   full user record) into a shared cookie, which is easy to push past the
   ~4KB a single cookie allows — when that happened, the cookie silently
   failed to save and broke sign-in on the app entirely. This version only
   ever stores two short tokens, comfortably within that limit.
   ========================================================================= */
(function () {
  var COOKIE_NAME = "efit_xsession";

  function readCrossDomainSession() {
    var match = document.cookie.match(new RegExp("(?:^|; )" + COOKIE_NAME + "=([^;]*)"));
    if (!match) return null;
    try {
      var parsed = JSON.parse(decodeURIComponent(match[1]));
      if (!parsed || !parsed.access_token || !parsed.refresh_token) return null;
      return parsed;
    } catch (e) {
      return null;
    }
  }

  window.readCrossDomainSession = readCrossDomainSession;
})();

/* One shared "go sign in" helper for the marketing site (this file is only
   included on ensemblefitness.com, never on the app itself, which already
   has its own login page).
   -------------------------------------------------------------------------
   An earlier version opened sign-in in a new tab so a visitor wouldn't
   lose the video they were watching — but that meant, after signing in,
   they had to notice the sign-in tab was done, close it, and go dig back
   through the ORIGINAL tab to find the same video again. Confusing, and
   not what anyone wants mid-workout-video.

   This navigates the SAME tab instead, and passes along exactly what
   video (if any) they were on via a "video" id — login.html reads it back
   out of the "redirect" param and, once signed in, sends them straight
   back to THIS PAGE with that video id in the URL. main.js then notices
   that id on load and reopens the lightbox to that exact video — so the
   whole trip feels like "sign in, then land right back where you were,"
   not "juggle two tabs."

   videoId is optional — omit it (e.g. for the Follow button on a page
   with no specific video open) and this just returns to the current page
   as-is. */
function goToMemberSignIn(videoId) {
  var returnUrl = window.location.origin + window.location.pathname;
  var params = new URLSearchParams(window.location.search);
  if (videoId) params.set("video", videoId);
  var qs = params.toString();
  if (qs) returnUrl += "?" + qs;
  returnUrl += window.location.hash;

  window.location.href = "https://app.ensemblefitness.com/login.html?redirect=" + encodeURIComponent(returnUrl);
}
