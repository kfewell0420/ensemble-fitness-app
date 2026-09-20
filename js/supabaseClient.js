/* Initializes one shared Supabase client for every page in the app. */
(function () {
  function showBanner(text) {
    document.addEventListener("DOMContentLoaded", function () {
      var warn = document.createElement("div");
      warn.className = "config-warning";
      warn.textContent = text;
      document.body.prepend(warn);
    });
  }

  if (!window.supabase) {
    console.error("Supabase library did not load — check your internet connection or ad-blocker.");
    showBanner("Couldn't load the Supabase library (network/ad-blocker issue) — try refreshing.");
    return;
  }
  if (window.SUPABASE_URL.indexOf("REPLACE_WITH") === 0) {
    showBanner("This app isn't connected to Supabase yet — edit js/config.js with your Project URL and anon key.");
    return;
  }
  // Exactly what this app used before any of the cross-domain sign-in work
  // started — no auth options, no listener. The app's session stays in
  // Supabase's normal, reliable per-origin localStorage, same as always.
  // (An earlier version added an onAuthStateChange listener here to hand a
  // small cookie to the marketing site on every session change — moved out
  // of this shared file, which every single page loads, and into the one
  // place that actually needs it: login.html's own sign-in success path.
  // Keeping this file exactly as small and boring as it's always been
  // means nothing about how every other page starts up can be affected by
  // that feature, whatever else happens with it.)
  window.sb = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);
})();

/* Redirects to login.html if nobody is signed in. Call from pages that require auth.
   Preserves any extra query params (e.g. ?tag=Meal%20Prep from a deep link) and the
   hash, alongside the redirect target, so a deep link isn't lost across the sign-in
   detour. */
async function requireAuth() {
  if (!window.sb) return null;
  var { data } = await window.sb.auth.getSession();
  if (!data.session) {
    var here = window.location.pathname.split("/").pop() || "profile.html";
    var params = new URLSearchParams(window.location.search);
    params.set("redirect", here);
    window.location.href = "login.html?" + params.toString() + window.location.hash;
    return null;
  }
  return data.session.user;
}

/* Redirects away from login.html if someone is already signed in. */
async function redirectIfSignedIn(destination) {
  if (!window.sb) return;
  var { data } = await window.sb.auth.getSession();
  if (data.session) {
    window.location.href = destination || "profile.html";
  }
}

async function isCurrentUserAdmin() {
  if (!window.sb) return false;
  var { data } = await window.sb.auth.getSession();
  if (!data.session) return false;
  var { data: row } = await window.sb
    .from("admins")
    .select("user_id")
    .eq("user_id", data.session.user.id)
    .maybeSingle();
  return !!row;
}

/* The five natural-wake-up-time buckets used at signup, on the profile page, and for matching
   on the Find Members page. Kept in one place so every page's <select> and every displayed label
   stay in sync — and so they match the values allowed by the database check constraint. */
window.WAKE_TIME_OPTIONS = [
  { value: "early_bird", label: "Early Bird — before 6:00 AM" },
  { value: "early_riser", label: "Early Riser — 6:00–7:30 AM" },
  { value: "standard", label: "Standard — 7:30–9:00 AM" },
  { value: "late_riser", label: "Late Riser — 9:00–10:30 AM" },
  { value: "night_owl", label: "Night Owl — after 10:30 AM" }
];

function wakeTimeLabel(value) {
  var match = window.WAKE_TIME_OPTIONS.filter(function (o) { return o.value === value; })[0];
  return match ? match.label : "";
}

/* Builds <option> markup for a wake-time <select>. Pass a placeholderLabel to include a blank
   first option (e.g. "Choose one…" for a required field, or "Any" for an optional filter);
   omit it to list only the five real buckets. */
function buildWakeTimeOptionsHtml(placeholderLabel) {
  var html = placeholderLabel ? '<option value="">' + placeholderLabel + '</option>' : "";
  window.WAKE_TIME_OPTIONS.forEach(function (o) {
    html += '<option value="' + o.value + '">' + o.label + '</option>';
  });
  return html;
}

/* Optional "what are you looking for" preference used by Fitness+ matching. Kept in one
   place, same pattern as WAKE_TIME_OPTIONS above, so the profile page's <select> and any
   displayed label stay in sync with the values allowed by the database check constraint. */
window.RELATIONSHIP_INTENT_OPTIONS = [
  { value: "long_term", label: "Long-term relationship" },
  { value: "dating", label: "Dating" },
  { value: "open_to_connection", label: "Open to connection" }
];

function relationshipIntentLabel(value) {
  var match = window.RELATIONSHIP_INTENT_OPTIONS.filter(function (o) { return o.value === value; })[0];
  return match ? match.label : "";
}

/* Builds <option> markup for a relationship-intent <select>. Pass a placeholderLabel to
   include a blank first option (e.g. "Prefer not to say" — this field is optional, unlike
   ZIP code and wake-up time); omit it to list only the three real options. */
function buildRelationshipIntentOptionsHtml(placeholderLabel) {
  var html = placeholderLabel ? '<option value="">' + placeholderLabel + '</option>' : "";
  window.RELATIONSHIP_INTENT_OPTIONS.forEach(function (o) {
    html += '<option value="' + o.value + '">' + o.label + '</option>';
  });
  return html;
}

async function signOut() {
  if (!window.sb) return;
  await window.sb.auth.signOut();
  window.location.href = "login.html";
}

/* Shared show/hide toggle for a password field — used on the sign-up/sign-in
   form and the "Change your password" form in profile.html. */
function wirePasswordToggle(button, input) {
  button.addEventListener("click", function () {
    var showing = input.type === "text";
    input.type = showing ? "password" : "text";
    button.textContent = showing ? "👁" : "🙈";
    button.setAttribute("aria-label", showing ? "Show password" : "Hide password");
  });
}

/* Keeps a hidden narration <audio> track in sync with its paired <video> —
   used everywhere a video with a recorded voiceover is shown (feed, profile
   "My uploads", and the admin review queue). The video's own sound is muted
   so only the narration plays. Best-effort: if the browser's autoplay policy
   blocks audio.play(), it fails silently rather than throwing. */
function wireNarrationSync(video, audio) {
  if (!video || !audio) return;
  video.muted = true;
  video.addEventListener("play", function () {
    audio.currentTime = video.currentTime;
    audio.play().catch(function () {});
  });
  video.addEventListener("pause", function () { audio.pause(); });
  video.addEventListener("seeking", function () { audio.currentTime = video.currentTime; });
  video.addEventListener("ended", function () {
    audio.pause();
    audio.currentTime = 0;
  });
}

/* Applies a member's chosen trim points to a <video> WITHOUT re-encoding the
   file — the full original is still stored and uploaded, this just clamps
   playback to stay between trimStart and trimEnd (seconds). Used everywhere
   a video shows up (feed, profile "My uploads", a member's public profile).
   No-op if neither trim point was ever set, so untouched videos behave
   exactly as before this feature existed. */
function wireTrimPlayback(video, trimStart, trimEnd) {
  if (!video) return;
  var start = typeof trimStart === "number" ? trimStart : 0;
  var end = typeof trimEnd === "number" ? trimEnd : null;
  if (!start && end === null) return;

  video.addEventListener("loadedmetadata", function () {
    if (video.currentTime < start) video.currentTime = start;
  });
  video.addEventListener("play", function () {
    if (video.currentTime < start || (end !== null && video.currentTime >= end)) {
      video.currentTime = start;
    }
  });
  video.addEventListener("timeupdate", function () {
    if (video.currentTime < start - 0.25) {
      video.currentTime = start;
    } else if (end !== null && video.currentTime >= end) {
      video.pause();
      video.currentTime = start;
    }
  });
}
