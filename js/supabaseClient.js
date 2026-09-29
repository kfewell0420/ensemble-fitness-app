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

/* Turns the total-inches integer stored on profiles.height_inches (set by
   stripe-webhook.js's handleFitnessPlusSignup when someone pays for
   Fitness+) into a friendly "5'8"" for display on the profile page and
   Fitness+ match cards. Returns "" for null/undefined so callers can just
   drop the result straight into a template without an extra null check. */
function formatHeightInches(totalInches) {
  if (totalInches === null || totalInches === undefined) return "";
  var feet = Math.floor(totalInches / 12);
  var inches = totalInches % 12;
  return feet + "'" + inches + '"';
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

/* Multi-clip reels (Ken's ask, Nov 2026): a member can attach several
   already-trimmed clips to one video post instead of just one, and they're
   meant to play back-to-back as one continuous reel — see
   sql/multi-clip-reels.sql for why clip 1 is always the post's own row and
   clip 2 onward live in media_clips. Nothing is ever merged/re-encoded;
   this just swaps the <video>'s src to the next clip when the current one
   finishes, generalizing wireTrimPlayback above from one clip to N. Once
   the LAST clip finishes it loops back around to clip 1, so a multi-clip
   post keeps the same infinite-loop feel a single-clip post already has.

   `clips` is an ordered array of { url, start, end } — start/end are each
   either a number of seconds (that clip's own trim_start/trim_end) or
   null/undefined, meaning "play this clip's whole file." Clip 1's entry is
   whatever the <video> was already showing (its src is left alone here).
   No-op for fewer than 2 clips — callers should use wireTrimPlayback
   instead for an ordinary single-clip post, which is the vast majority and
   should keep behaving exactly as it always has. */
function wireReelPlayback(video, clips) {
  if (!video || !clips || clips.length < 2) return;
  var index = 0;

  function clipStart(clip) { return typeof clip.start === "number" ? clip.start : 0; }
  function clipEnd(clip) { return typeof clip.end === "number" ? clip.end : null; }

  // The native `loop` attribute a single-clip slide is built with would
  // just replay clip 1 forever and would never even fire "ended" — this
  // feature drives its own loop-back-to-clip-1 below instead, so that
  // attribute (if the caller's markup happened to set it) has to go.
  video.loop = false;

  function clampToStart() {
    var start = clipStart(clips[index]);
    if (start && video.currentTime < start) video.currentTime = start;
  }

  function goToClip(i) {
    index = i;
    var clip = clips[index];
    video.src = clip.url;
    video.addEventListener("loadedmetadata", function onReady() {
      video.removeEventListener("loadedmetadata", onReady);
      clampToStart();
    });
    var p = video.play();
    if (p && p.catch) p.catch(function () {});
  }

  function advance() {
    goToClip((index + 1) % clips.length);
  }

  // Clip 1 is already loaded (its src was set when the slide/tile itself
  // was built) — just clamp its own start point the same way
  // wireTrimPlayback does, no need to reload it here.
  video.addEventListener("loadedmetadata", clampToStart);
  video.addEventListener("timeupdate", function () {
    var end = clipEnd(clips[index]);
    if (end !== null && video.currentTime >= end) advance();
  });
  // A clip with no trim_end just plays to its own natural end instead.
  video.addEventListener("ended", advance);
}