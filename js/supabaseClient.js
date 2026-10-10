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

/* Connection Status (Ken's ask, Oct 2026) — an optional, tiny badge beside a member's
   name saying how they're here, so nobody has to message a stranger to find out. NULL /
   empty means "no badge". The same list drives the profile dropdown, the join form's
   dropdown and its legend, and every badge shown next to a name. */
window.CONNECTION_STATUS_OPTIONS = [
  { value: "open_to_connect", icon: "\uD83D\uDC97", label: "Open to Connect", hint: "Single and open to meeting someone" },
  { value: "taken", icon: "\uD83D\uDC8D", label: "Taken", hint: "Married or in a relationship" },
  { value: "community", icon: "\uD83E\uDD1D", label: "Here for Community", hint: "Friends, workout partners, motivation only" }
];

function connectionStatusOption(value) {
  return window.CONNECTION_STATUS_OPTIONS.filter(function (o) { return o.value === value; })[0] || null;
}

/* <option> markup for a status <select>; the blank first option means "show no badge". */
function buildConnectionStatusOptionsHtml(placeholderLabel) {
  var html = '<option value="">' + (placeholderLabel || "No badge") + '</option>';
  window.CONNECTION_STATUS_OPTIONS.forEach(function (o) {
    html += '<option value="' + o.value + '">' + o.icon + " " + o.label + '</option>';
  });
  return html;
}

/* A small reference list of every badge and what it means (shown under the join/profile
   dropdowns so members know what each one signals before choosing). */
function buildConnectionStatusLegendHtml() {
  return window.CONNECTION_STATUS_OPTIONS.map(function (o) {
    return '<div>' + o.icon + ' <strong>' + o.label + '</strong> \u2014 ' + o.hint + '</div>';
  }).join("") + '<div>No badge \u2014 you\'d rather not show a status</div>';
}

/* The tiny badge itself, to drop right after a name. Returns "" for no/unknown status. */
function connectionBadgeHtml(status) {
  var o = connectionStatusOption(status);
  if (!o) return "";
  return '<span class="conn-badge" role="img" title="' + o.label + '" aria-label="' + o.label + '">' + o.icon + '</span>';
}

/* The "what do these mean?" key. Opens when anyone taps a badge or any element with class
   .conn-key-open (the small "What do these mean?" links on the pages). Same wording everywhere. */
function showConnectionKey() {
  if (document.getElementById("connKeyOverlay")) return;
  var rows = window.CONNECTION_STATUS_OPTIONS.map(function (o) {
    return '<div class="conn-key-row"><span class="conn-key-icon">' + o.icon + '</span><span><strong>' + o.label + '</strong><br>' + o.hint + '</span></div>';
  }).join("") +
    '<div class="conn-key-row"><span class="conn-key-icon">\u2014</span><span><strong>No badge</strong><br>Member chooses not to display a status</span></div>';
  var overlay = document.createElement("div");
  overlay.id = "connKeyOverlay";
  overlay.className = "conn-key-overlay";
  overlay.innerHTML = '<div class="conn-key-sheet" role="dialog" aria-modal="true" aria-label="What the badges mean">' +
    '<div class="conn-key-title">Connection status</div>' +
    '<div class="conn-key-sub">The tiny badge beside a member\'s name. It\'s optional, and members choose their own.</div>' +
    rows +
    '<button type="button" class="conn-key-close">Got it</button></div>';
  function close() { if (overlay.parentNode) overlay.parentNode.removeChild(overlay); document.removeEventListener("keydown", onKey); }
  function onKey(e) { if (e.key === "Escape") close(); }
  overlay.addEventListener("click", function (e) { if (e.target === overlay || (e.target.closest && e.target.closest(".conn-key-close"))) close(); });
  document.addEventListener("keydown", onKey);
  document.body.appendChild(overlay);
}
/* Capture phase + stopPropagation so tapping a badge inside a clickable row or card shows
   the key instead of navigating away. */
document.addEventListener("click", function (e) {
  var t = e.target && e.target.closest ? e.target.closest(".conn-badge, .conn-key-open") : null;
  if (!t) return;
  e.preventDefault();
  e.stopPropagation();
  showConnectionKey();
}, true);
/* Always-visible compact key printed right on the page. Any element with a data-conn-key
   attribute gets it filled in automatically. */
function connectionKeyBlockHtml() {
  return '<div class="conn-key-inline"><div class="conn-key-inline-title">Connection status key</div>' +
    window.CONNECTION_STATUS_OPTIONS.map(function (o) {
      return '<div><span class="conn-key-inline-icon">' + o.icon + '</span><strong>' + o.label + '</strong> \u2014 ' + o.hint + '</div>';
    }).join("") +
    '<div><span class="conn-key-inline-icon">\u2014</span><strong>No badge</strong> \u2014 member chooses not to display a status</div></div>';
}
function fillConnectionKeys() {
  Array.prototype.forEach.call(document.querySelectorAll("[data-conn-key]"), function (el) { el.innerHTML = connectionKeyBlockHtml(); });
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fillConnectionKeys);
else fillConnectionKeys();
/* Small always-visible link row for pages that show badges. */
function connectionKeyLinkHtml(extraStyle) {
  return '<button type="button" class="conn-key-open conn-key-link"' + (extraStyle ? ' style="' + extraStyle + '"' : '') + '>' +
    window.CONNECTION_STATUS_OPTIONS.map(function (o) { return o.icon; }).join(" ") + ' What do these mean?</button>';
}

/* Looks up the Connection Status for a batch of members in ONE query and returns a
   { userId: status } map (members with no badge are simply absent). Best-effort by design:
   before sql/connection-status.sql has been run the column doesn't exist, so any error —
   or any other failure — just returns an empty map and the page renders with no badges
   instead of breaking. */
async function fetchConnectionStatuses(userIds) {
  var map = {};
  try {
    var ids = Array.from(new Set((userIds || []).filter(Boolean)));
    if (!ids.length || !window.sb) return map;
    var { data, error } = await window.sb.from("profiles").select("id, connection_status").in("id", ids);
    if (error || !data) return map;
    data.forEach(function (r) { if (r.connection_status) map[r.id] = r.connection_status; });
  } catch (e) {}
  return map;
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
function wireNarrationSync(video, audio, keepOriginal, musicStart, trimStart) {
  if (!video || !audio) return;
  // musicStart: where in the SONG playback begins (seconds; 0 for narration or an unset post).
  // trimStart: the clip's own trim point, so the song lines up with the clip's first frame.
  var offset = typeof musicStart === "number" && musicStart > 0 ? musicStart : 0;
  var tStart = typeof trimStart === "number" && trimStart > 0 ? trimStart : 0;
  function expected() { return offset + Math.max(0, video.currentTime - tStart); }
  if (keepOriginal) {
    // "Keep my video's own sound too": the video stays audible and the track plays
    // softly underneath. The video's own mute/volume controls drive the track too.
    audio.volume = 0.35;
    audio.muted = video.muted;
    video.addEventListener("volumechange", function () { audio.muted = video.muted; });
  } else {
    video.muted = true;
  }
  video.addEventListener("play", function () {
    audio.currentTime = expected();
    audio.play().catch(function () {});
  });
  video.addEventListener("pause", function () { audio.pause(); });
  video.addEventListener("seeking", function () { audio.currentTime = expected(); });
  video.addEventListener("ended", function () {
    audio.pause();
    audio.currentTime = offset;
  });
}

/* Plays a post's attached music/narration track alongside its <video> in the FEED, where
   the reel's own code constantly flips video.muted to follow the viewer's sound choice.
   Two modes:
   - replace (default): the video's own sound must stay silent no matter what, but the feed's
     mute logic should still decide whether the TRACK is heard. So the real muted flag is
     pinned to true and a per-element `muted` accessor remembers the intended state and
     applies it to the track instead (video.volume = 0 would not work — iOS ignores it).
   - keepOriginal: video keeps its own sound; the track plays at low volume and simply
     follows the video's muted state.
   The track starts where the clip's trim starts (at `musicStart` seconds into the song), mirroring the upload preview. */
function wireFeedSound(video, audio, keepOriginal, trimStart, musicStart) {
  if (!video || !audio) return;
  var start = typeof trimStart === "number" ? trimStart : 0;
  var offset = typeof musicStart === "number" && musicStart > 0 ? musicStart : 0; // where in the song playback begins
  var protoMuted = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "muted");
  var intentMuted = !!video.muted;

  if (keepOriginal) {
    audio.volume = 0.35;
    audio.muted = intentMuted;
    video.addEventListener("volumechange", function () { audio.muted = video.muted; });
  } else {
    protoMuted.set.call(video, true);
    audio.muted = intentMuted;
    Object.defineProperty(video, "muted", {
      configurable: true,
      get: function () { return intentMuted; },
      set: function (v) {
        intentMuted = !!v;
        audio.muted = intentMuted;
        protoMuted.set.call(video, true); // original sound never plays in replace mode
      }
    });
  }

  function expected() { return offset + Math.max(0, video.currentTime - start); }
  function sync() {
    if (Math.abs(audio.currentTime - expected()) > 0.4) {
      try { audio.currentTime = expected(); } catch (e) {}
    }
  }
  video.addEventListener("play", function () {
    try { audio.currentTime = expected(); } catch (e) {}
    audio.play().catch(function () {});
  });
  video.addEventListener("pause", function () { audio.pause(); });
  video.addEventListener("seeked", sync);
  video.addEventListener("timeupdate", function () {
    sync();
    if (audio.paused && !video.paused) audio.play().catch(function () {}); // track ended before the clip looped
  });
  video.addEventListener("ended", function () { audio.pause(); });
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


function formatSongTime(sec) {
  sec = Math.max(0, Math.round(sec || 0));
  var m = Math.floor(sec / 60), r = sec % 60;
  return m + ":" + (r < 10 ? "0" : "") + r;
}

/* "Start the song at 0:15" — a small slider plus a "Hear it" button, so an artist can skip a long
   intro and begin the song where the vocals/beat start. Used on the upload page and in a post's
   Edit menu. opts: { audio: an <audio> element whose src is the song (created if omitted),
   initial: seconds, duration: seconds if already known, onChange(seconds) }.
   Returns { el, getValue, setValue, setDuration, stop }. */
function createMusicStartPicker(opts) {
  opts = opts || {};
  var audio = opts.audio || new Audio();
  var value = Math.max(0, Number(opts.initial) || 0);
  var el = document.createElement("div");
  el.className = "music-start";
  el.innerHTML =
    '<div class="music-start-top">' +
      '<span class="music-start-label">Start the song at <b class="ms-time">0:00</b></span>' +
      '<button type="button" class="music-start-play">▶ Hear it</button>' +
    '</div>' +
    '<input type="range" class="ms-range" min="0" max="0" step="1" value="0" aria-label="Where the song starts" />';
  var range = el.querySelector(".ms-range");
  var timeEl = el.querySelector(".ms-time");
  var playBtn = el.querySelector(".music-start-play");
  var stopTimer = null;

  function paint() { timeEl.textContent = formatSongTime(value); range.value = String(value); }
  function setDuration(d) {
    d = Math.floor(Number(d) || 0);
    if (d > 0) { range.max = String(Math.max(0, d - 1)); if (value > d - 1) value = Math.max(0, d - 1); paint(); }
  }
  function stop() {
    if (stopTimer) { clearTimeout(stopTimer); stopTimer = null; }
    try { audio.pause(); } catch (e) {}
    playBtn.textContent = "▶ Hear it";
  }
  if (opts.duration) setDuration(opts.duration);
  audio.addEventListener("loadedmetadata", function () { if (isFinite(audio.duration)) setDuration(audio.duration); });
  if (isFinite(audio.duration) && audio.duration > 0) setDuration(audio.duration);
  // A saved start point can be beyond a not-yet-known duration; keep it until we do know.
  range.max = String(Math.max(Number(range.max) || 0, value));
  paint();

  range.addEventListener("input", function () {
    value = Number(range.value) || 0;
    paint();
    if (opts.onChange) opts.onChange(value);
  });
  playBtn.addEventListener("click", function () {
    if (stopTimer) { stop(); return; }
    try { audio.currentTime = value; } catch (e) {}
    audio.volume = 1;
    audio.muted = false;
    audio.play().catch(function () {});
    playBtn.textContent = "■ Stop";
    stopTimer = setTimeout(stop, 10000); // a 10-second taste is enough to judge the start
  });

  return {
    el: el,
    getValue: function () { return value; },
    setValue: function (v) { value = Math.max(0, Number(v) || 0); range.max = String(Math.max(Number(range.max) || 0, value)); paint(); },
    setDuration: setDuration,
    stop: stop
  };
}
