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
var CONN_CHECK_SVG = '<svg class="conn-check" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" style="width:1.15em;height:1em;vertical-align:-0.14em;overflow:visible"><path d="M3.5 13.5 C5.5 12.5 7.5 15 9 19 C11.5 11 16 6 21.5 3.5" fill="none" stroke="#0095f6" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
window.CONNECTION_STATUS_OPTIONS = [
  { value: "taken", icon: "\uD83D\uDC8D", label: "Taken", hint: "Married or in a relationship" },
  { value: "open_to_connect", icon: CONN_CHECK_SVG, plainIcon: "\u2714", label: "Open to Connect", hint: "Single and open to meeting someone" },
  { value: "community", icon: "\uD83E\uDD1D", label: "Here for the Community", hint: "Friends, workout partners, motivation only" }
];

function connectionStatusOption(value) {
  return window.CONNECTION_STATUS_OPTIONS.filter(function (o) { return o.value === value; })[0] || null;
}

/* <option> markup for a status <select>; the blank first option is only a "Choose one…" prompt. */
function buildConnectionStatusOptionsHtml(placeholderLabel) {
  var html = '<option value="">' + (placeholderLabel || "Choose one\u2026") + '</option>';
  window.CONNECTION_STATUS_OPTIONS.forEach(function (o) {
    html += '<option value="' + o.value + '">' + (o.plainIcon || o.icon) + " " + o.label + '</option>';
  });
  return html;
}

/* A small reference list of every badge and what it means (shown under the join/profile
   dropdowns so members know what each one signals before choosing). */
function buildConnectionStatusLegendHtml() {
  return window.CONNECTION_STATUS_OPTIONS.map(function (o) {
    return '<div>' + o.icon + ' <strong>' + o.label + '</strong> \u2014 ' + o.hint + '</div>';
  }).join("");
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
  }).join("");
  var overlay = document.createElement("div");
  overlay.id = "connKeyOverlay";
  overlay.className = "conn-key-overlay";
  overlay.innerHTML = '<div class="conn-key-sheet" role="dialog" aria-modal="true" aria-label="What the badges mean">' +
    '<div class="conn-key-title">Connection status</div>' +
    '<div class="conn-key-sub">The tiny badge beside a member\'s name. Members choose their own.</div>' +
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
    }).join("") + '</div>';
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

/* Music fade-out tail (Oct 2026): the song plays at full volume for the WHOLE video, and when the video
   reaches its last frame the picture holds there while the song carries on for 3 more seconds, fading to
   silence. (No fade while the video is still playing.) If the song is not playing at that moment (it was cut
   short, or it is shorter than the video) there is no tail and things end as before. Volume is set on the
   audio element; iPhones ignore that setting, so there the tail is skipped and the song just stops with the
   video. */
function songFadeGain(remaining, fadeLen) {
  if (!(fadeLen > 0) || remaining >= fadeLen) return 1;
  var g = Math.max(0, remaining / fadeLen);
  return g * g; // squared sounds like an even fade to the ear
}
function audioVolumeWorks() {
  try { var a = new Audio(); a.volume = 0.5; return a.volume === 0.5; } catch (e) { return false; }
}
// getBase(): the volume the song normally plays at. start(done) -> true if a tail began (done() runs when
// it has finished), false if there is nothing to fade (caller ends things the normal way).
// Flip to true to bring back the 3-second fade-out. While it is false the tail objects are not even created, so a looping
// post video keeps its browser-native seamless loop (the tail code used to stop the loop and restart the clip by hand,
// which with no 3-second hold showed up as a visible hitch every time the clip came round -- Ken, Android, Oct 2026).
var SONG_TAIL_ENABLED = false;
function createSongTail(video, audio, getBase) {
  var TAIL = 3; // seconds the song fades out after the video ends
  var raf = null, t0 = 0, active = false, onEnd = null, works = null, io = null, visible = true;
  function restoreVol() { try { audio.volume = getBase(); } catch (e) {} }
  function stopWatching() { if (io) { try { io.disconnect(); } catch (e) {} io = null; } }
  function step() {
    raf = null;
    if (!active) return;
    var e = (performance.now() - t0) / 1000;
    if (e >= TAIL || audio.paused || audio.ended) { finish(true); return; }
    try { audio.volume = Math.max(0, Math.min(1, getBase() * songFadeGain(TAIL - e, TAIL))); } catch (x) {}
    raf = requestAnimationFrame(step);
  }
  function finish(natural) {
    if (!active) return;
    active = false; stopWatching();
    if (raf) { cancelAnimationFrame(raf); raf = null; }
    try { audio.pause(); } catch (e) {}
    restoreVol();
    var f = onEnd; onEnd = null;
    if (f && natural && visible) f();
  }
  return {
    active: function () { return active; },
    start: function (done) {
      // Ken (Oct 2026): "no one likes the 3-second fade after the video is gone -- just cut it." The tail is switched
      // off everywhere (upload preview, feed, profile, review queue): returning false makes every caller end the
      // way it did before the tail existed -- the song stops with the picture.
      if (!SONG_TAIL_ENABLED) return false;
      if (active) return true;
      if (works === null) works = audioVolumeWorks();
      if (!works || audio.paused || audio.ended || audio.muted) return false;
      active = true; visible = true; t0 = performance.now(); onEnd = done || null;
      if (window.IntersectionObserver && video) {
        try {
          io = new IntersectionObserver(function (en) {
            visible = !!(en[0] && en[0].intersectionRatio > 0.3);
            if (!visible) finish(false);
          }, { threshold: [0, 0.3, 0.6] });
          io.observe(video);
        } catch (e) { io = null; }
      }
      raf = requestAnimationFrame(step);
      return true;
    },
    cancel: function () { // somebody pressed play / jumped / left: drop the tail and stop the song
      if (!active) return;
      finish(false);
    }
  };
}

/* Keeps a hidden narration <audio> track in sync with its paired <video> —
   used everywhere a video with a recorded voiceover is shown (feed, profile
   "My uploads", and the admin review queue). The video's own sound is muted
   so only the narration plays. Best-effort: if the browser's autoplay policy
   blocks audio.play(), it fails silently rather than throwing. */
function wireNarrationSync(video, audio, keepOriginal, musicStart, trimStart, musicWin, reel, fade) {
  if (!video || !audio) return;
  // musicStart: where in the SONG playback begins (seconds; 0 for narration or an unset post).
  // trimStart: the clip's own trim point, so the song lines up with the clip's first frame.
  var offset = typeof musicStart === "number" && musicStart > 0 ? musicStart : 0;
  var tStart = typeof trimStart === "number" && trimStart > 0 ? trimStart : 0;
  // musicWin (optional): { delay, length } — the song comes in `delay` seconds into the clip and
  // plays `length` seconds (null/absent = until the clip ends). Outside that window it is silent.
  var delay = musicWin && musicWin.delay > 0 ? Number(musicWin.delay) : 0;
  var wlen = musicWin && musicWin.length > 0 ? Number(musicWin.length) : null;
  var hasWindow = delay > 0 || wlen !== null;
  // reel (optional): a multi-clip post — time is then counted along the WHOLE reel, not the clip on screen.
  function rel() { return reel ? reel.time() : video.currentTime - tStart; }
  function inWin() {
    var r = rel();
    return r >= delay - 0.02 && (wlen === null || r < delay + wlen);
  }
  function expected() { return offset + Math.max(0, rel() - delay); }
  if (keepOriginal) {
    // "Keep my video's own sound too": the video stays audible and the track plays
    // softly underneath. The video's own mute/volume controls drive the track too.
    audio.volume = 0.35;
    audio.muted = video.muted;
    video.addEventListener("volumechange", function () { audio.muted = video.muted; });
  } else {
    video.muted = true;
  }
  // fade (music only): when the video ends, the song carries on for 3 seconds, fading out (see createSongTail).
  var baseVol = keepOriginal ? 0.35 : 1;
  var tail = (fade && SONG_TAIL_ENABLED) ? createSongTail(video, audio, function () { return baseVol; }) : null;
  if (tail && reel && reel.onFinish) {
    reel.onFinish(function () { return tail.start(function () { audio.currentTime = offset; reel.restart(); }); });
  }
  video.addEventListener("play", function () {
    if (tail) tail.cancel();
    if (!inWin()) { audio.pause(); return; }
    audio.currentTime = expected();
    audio.play().catch(function () {});
  });
  video.addEventListener("pause", function () {
    if (reel && video.ended) return; // reel: a clip finishing is not the song stopping
    if (tail && (tail.active() || (video.ended && songRunsToEnd()))) return; // the song's fade-out tail
    audio.pause();
  });
  video.addEventListener("seeking", function () {
    if (tail && tail.active()) { tail.cancel(); return; }
    audio.currentTime = expected();
  });
  // True when the song is set to play right up to the end of the video (so a fade-out tail makes sense).
  function songRunsToEnd() {
    if (wlen === null) return true;
    var total = reel && reel.total && reel.total() ? reel.total() : (isFinite(video.duration) ? video.duration - tStart : null);
    return total === null || delay + wlen >= total - 0.25;
  }
  if (hasWindow || reel) {
    video.addEventListener("timeupdate", function () {
      if (video.paused || video.ended || (tail && tail.active())) return;
      if (inWin()) {
        if (audio.paused) { audio.currentTime = expected(); audio.play().catch(function () {}); }
        else if (Math.abs(audio.currentTime - expected()) > 0.5) audio.currentTime = expected();
      } else if (!audio.paused) {
        audio.pause();
      }
    });
  }
  video.addEventListener("ended", function () {
    if (reel) return;
    if (tail && songRunsToEnd() && tail.start(function () { audio.currentTime = offset; })) return; // fade out over 3 more seconds
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
function wireFeedSound(video, audio, keepOriginal, trimStart, musicStart, musicWin, reel, fade) {
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

  // musicWin (optional): { delay, length } — see wireNarrationSync.
  var delay = musicWin && musicWin.delay > 0 ? Number(musicWin.delay) : 0;
  var wlen = musicWin && musicWin.length > 0 ? Number(musicWin.length) : null;
  // reel (optional): a multi-clip post — time is counted along the WHOLE reel, so one song runs across every clip.
  function rel() { return reel ? reel.time() : video.currentTime - start; }
  function inWin() {
    var r = rel();
    return r >= delay - 0.02 && (wlen === null || r < delay + wlen);
  }
  function expected() { return offset + Math.max(0, rel() - delay); }
  function sync() {
    if (Math.abs(audio.currentTime - expected()) > 0.4) {
      try { audio.currentTime = expected(); } catch (e) {}
    }
  }
  // fade (music only): when the video ends, the picture holds on its last frame while the song carries on
  // for 3 seconds, fading out; then the video starts over (see createSongTail).
  var baseVol = keepOriginal ? 0.35 : 1;
  var tail = (fade && SONG_TAIL_ENABLED) ? createSongTail(video, audio, function () { return baseVol; }) : null;
  var wasLoop = !!(tail && !reel && video.loop);
  if (wasLoop) video.loop = false; // so the clip reaches its end (and the tail can play) before starting over
  function songRunsToEnd() {
    if (wlen === null) return true;
    var total = reel && reel.total && reel.total() ? reel.total() : (isFinite(video.duration) ? video.duration - start : null);
    return total === null || delay + wlen >= total - 0.25;
  }
  function startOver() {
    try { video.currentTime = start; } catch (e) {}
    var p = video.play(); if (p && p.catch) p.catch(function () {});
  }
  if (tail && reel && reel.onFinish) {
    reel.onFinish(function () { return tail.start(function () { reel.restart(); }); });
  }
  video.addEventListener("play", function () {
    if (tail) tail.cancel();
    if (!inWin()) { audio.pause(); return; }
    try { audio.currentTime = expected(); } catch (e) {}
    audio.play().catch(function () {});
  });
  video.addEventListener("pause", function () {
    if (reel && video.ended) return; // reel: a clip finishing is not the song stopping
    if (tail && (tail.active() || (video.ended && songRunsToEnd()))) return; // the song's fade-out tail
    audio.pause();
  });
  video.addEventListener("seeked", function () { if (tail && tail.active()) return; if (inWin()) sync(); });
  video.addEventListener("timeupdate", function () {
    if (video.paused || video.ended || (tail && tail.active())) return;
    if (!inWin()) { if (!audio.paused) audio.pause(); return; } // before the song comes in / after its end
    sync();
    if (audio.paused) audio.play().catch(function () {}); // song entered its window, or ended before the clip looped
  });
  video.addEventListener("ended", function () {
    if (reel) return;
    if (tail && songRunsToEnd() && tail.start(wasLoop ? startOver : null)) return; // fade out over 3 more seconds
    audio.pause();
    if (wasLoop) startOver();
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
/* Cut cleanly from one clip to the next (several-clip posts, Oct 2026). Swapping a <video>'s src
   normally freezes the picture for a moment and can flash the player's own buttons. This keeps a
   hidden twin <video> that has the NEXT clip already loaded at its first frame. At the cut the twin is
   shown right on top of the real player and starts playing at once (an instant, clean cut), while the
   real player quietly loads the clip underneath; as soon as it is playing at the same moment, the
   twin is hidden again. Callers keep using the real <video> for everything else.
     preload(url, start)  get the twin ready (cheap to call again)
     swap(url, start)     do the cut; returns false when the twin isn't ready (caller then loads the
                          clip the ordinary way)
     time()               seconds into the clip on screen right now (the twin's while it is showing)
     busy()               true while the twin is still on screen */
// Hides a player's own buttons/spinner WITHOUT touching its `controls` attribute (switching that on and
// off rebuilds the player's control layer, which is one of the things that flashed on phones).
function setPlayerChromeHidden(video, hide) {
  if (!document.getElementById("ef-chrome-hide")) {
    var st = document.createElement("style");
    st.id = "ef-chrome-hide";
    st.textContent = "video.ef-chrome-hidden::-webkit-media-controls,video.ef-chrome-hidden::-webkit-media-controls-enclosure,video.ef-chrome-hidden::-webkit-media-controls-panel,video.ef-chrome-hidden::-webkit-media-controls-overlay-play-button,video.ef-chrome-hidden::-webkit-media-controls-start-playback-button,video.ef-chrome-hidden::-internal-media-controls-overlay-cast-button{display:none !important;opacity:0 !important;-webkit-appearance:none}";
    (document.head || document.documentElement).appendChild(st);
  }
  if (video) video.classList.toggle("ef-chrome-hidden", !!hide);
}

function createClipSwapper(video) {
  var shadow = null, pre = { url: null, ready: false }, swapTok = 0, showing = false;
  function make() {
    if (shadow || !video || !video.parentNode) return shadow;
    shadow = document.createElement("video");
    shadow.muted = true; shadow.defaultMuted = true;
    shadow.setAttribute("playsinline", ""); shadow.setAttribute("muted", "");
    shadow.preload = "auto"; shadow.controls = false; shadow.disablePictureInPicture = true;
    shadow.setAttribute("aria-hidden", "true");
    shadow.style.cssText = "position:absolute; pointer-events:none; opacity:0.02; margin:0; transition:none; will-change:opacity; transform:translateZ(0);";
    video.parentNode.insertBefore(shadow, video.nextSibling);
    return shadow;
  }
  function place() {
    var cs = window.getComputedStyle(video);
    shadow.className = video.className;
    shadow.style.left = video.offsetLeft + "px";
    shadow.style.top = video.offsetTop + "px";
    shadow.style.width = video.offsetWidth + "px";
    shadow.style.height = video.offsetHeight + "px";
    shadow.style.maxWidth = "none"; shadow.style.maxHeight = "none"; shadow.style.aspectRatio = "auto";
    shadow.style.objectFit = cs.objectFit; shadow.style.objectPosition = cs.objectPosition;
    shadow.style.borderRadius = cs.borderRadius; shadow.style.background = cs.backgroundColor;
    shadow.style.transform = cs.transform === "none" ? "translateZ(0)" : cs.transform;
  }
  function preload(url, start) {
    if (!make() || !url) return;
    if (pre.url === url && shadow.getAttribute("data-start") === String(start || 0)) return;
    if (showing) return; // still handing over — the next preload happens after
    pre = { url: url, ready: false };
    shadow.setAttribute("data-start", String(start || 0));
    var st = start || 0, me = pre;
    function onMeta() {
      shadow.removeEventListener("loadedmetadata", onMeta);
      try { shadow.currentTime = st; } catch (e) {}
    }
    function onFrame() {
      shadow.removeEventListener("seeked", onFrame);
      if (pre === me) me.ready = true;
    }
    shadow.addEventListener("loadedmetadata", onMeta);
    shadow.addEventListener("seeked", onFrame);
    shadow.addEventListener("loadeddata", function onData() {
      shadow.removeEventListener("loadeddata", onData);
      if (pre === me && !st) me.ready = true; // starting at the very first frame: it is already showing
    });
    shadow.src = url;
    try { shadow.load(); } catch (e) {}
  }
  function swap(url, start) {
    if (!shadow || pre.url !== url || !pre.ready || showing) return false;
    var S = shadow, tok = ++swapTok, t0 = Date.now(), tries = 0, lead = 0.2, seeking = false;
    showing = true;
    setPlayerChromeHidden(video, true); // no flash of the player's own buttons underneath
    place();
    S.style.opacity = "1";
    var sp = S.play(); if (sp && sp.catch) sp.catch(function () {});
    video.src = url;
    function reallyFinish() {
      if (tok !== swapTok) return;
      setPlayerChromeHidden(video, false);
      showing = false;
      S.style.opacity = "0.02";
      try { S.pause(); } catch (e) {}
      pre = { url: null, ready: false };
      S.removeAttribute("data-start");
      if (swap.onDone) swap.onDone();
    }
    // Only take the twin away once the real player has actually put a fresh picture on screen (and
    // then one more frame), otherwise a blank frame can show for an instant — the flash.
    function finish() {
      if (tok !== swapTok) return;
      var fired = false;
      function go() { if (fired) return; fired = true; requestAnimationFrame(function () { requestAnimationFrame(reallyFinish); }); }
      if (video.requestVideoFrameCallback && !video.paused) {
        try { video.requestVideoFrameCallback(function () { go(); }); } catch (e) { go(); }
        setTimeout(go, 250);
      } else setTimeout(go, 120);
    }
    // Put the real player a little AHEAD of the twin (by what loading is expected to cost), then
    // learn from how far off it lands and correct, so the hand-over is not a visible jump.
    function aim() {
      seeking = true;
      var done = function () { video.removeEventListener("seeked", done); seeking = false; };
      video.addEventListener("seeked", done);
      try { video.currentTime = S.currentTime + lead; } catch (e) { seeking = false; }
    }
    function onMeta() {
      video.removeEventListener("loadedmetadata", onMeta);
      if (tok !== swapTok) return;
      aim();
      var p = video.play(); if (p && p.catch) p.catch(function () {});
      poll();
    }
    video.addEventListener("loadedmetadata", onMeta);
    function poll() {
      if (tok !== swapTok) return;
      var d = video.currentTime - S.currentTime;
      var live = !video.paused && video.readyState >= 3 && !seeking;
      if (live && Math.abs(d) < 0.09) { finish(); return; }
      if (Date.now() - t0 > 2500 || tries >= 5) { finish(); return; }
      if (live) { tries++; lead = Math.max(0, Math.min(0.8, lead - d)); aim(); }
      requestAnimationFrame(poll);
    }
    return true;
  }
  return {
    preload: preload,
    swap: swap,
    busy: function () { return showing; },
    cancel: function () { // abandon a hand-over in progress (the caller is about to load a clip another way)
      swapTok++;
      if (showing) setPlayerChromeHidden(video, false); // give the upload preview its buttons back
      if (showing && shadow) { showing = false; shadow.style.opacity = "0.02"; try { shadow.pause(); } catch (e) {} }
    },
    time: function () { return showing && shadow ? shadow.currentTime : video.currentTime; },
    onDone: function (fn) { swap.onDone = fn; }
  };
}

function wireReelPlayback(video, clips, durations) {
  if (!video || !clips || clips.length < 2) return null;
  var index = 0;
  // durations (optional): how long each clip plays (seconds), in order. With them the reel can say
  // "how far along the WHOLE reel are we" — what lets one song run across all the clips.
  var offsets = null;
  if (durations && durations.length === clips.length) {
    offsets = [0];
    for (var di = 0; di < durations.length; di++) offsets.push(offsets[di] + (Number(durations[di]) || 0));
  }

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

  var swapper = createClipSwapper(video);
  // finishHook() (set through onFinish): asked when the LAST clip ends; returns true if it takes over (the
  // picture then holds on the last frame until restart() is called), false to loop straight back to clip 1.
  var finishHook = null, holding = false;
  function preloadNext() {
    var n = (index + 1) % clips.length;
    swapper.preload(clips[n].url, clipStart(clips[n]));
  }
  // Cut a hair BEFORE a clip's end so the player never reaches "ended" (which is what flashed its play
  // button): the twin takes over while the last instant is still playing.
  var watchRaf = null;
  function watchEnd() {
    watchRaf = null;
    if (video.paused || swapper.busy()) return;
    if (finishHook && index === clips.length - 1) return; // the last clip runs to its true end (a song fade-out may follow)
    var end = clipEnd(clips[index]);
    var limit = end !== null ? end : video.duration;
    if (isFinite(limit) && video.currentTime > 0.3 && limit - video.currentTime < 0.09) { advance(); return; }
    watchRaf = requestAnimationFrame(watchEnd);
  }
  video.addEventListener("playing", function () {
    preloadNext(); // once a clip is really playing, get the next one ready behind it
    if (!watchRaf) watchRaf = requestAnimationFrame(watchEnd);
  });
  swapper.onDone(preloadNext);

  function goToClip(i) {
    index = i;
    var clip = clips[index];
    if (swapper.swap(clip.url, clipStart(clip))) return; // clean cut — the next clip was already waiting
    swapper.cancel();
    video.src = clip.url;
    video.addEventListener("loadedmetadata", function onReady() {
      video.removeEventListener("loadedmetadata", onReady);
      clampToStart();
    });
    var p = video.play();
    if (p && p.catch) p.catch(function () {});
  }

  function advance() {
    if (index === clips.length - 1 && finishHook) {
      if (holding) return;
      if (finishHook()) { holding = true; if (!video.paused && !video.ended) video.pause(); return; }
    }
    goToClip((index + 1) % clips.length);
  }
  // Pressing play on a reel that has finished (and is holding) starts it over from clip 1.
  video.addEventListener("play", function () { if (holding) { holding = false; goToClip(0); } });

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

  return {
    hasTimes: !!offsets,
    total: function () { return offsets ? offsets[offsets.length - 1] : null; },
    index: function () { return index; },
    onFinish: function (fn) { finishHook = fn; },
    restart: function () { holding = false; goToClip(0); },
    // Seconds into the whole reel (clip 1 starts at 0).
    time: function () {
      var base = offsets ? offsets[index] : 0;
      return base + Math.max(0, swapper.time() - clipStart(clips[index]));
    }
  };
}


function formatSongTime(sec) {
  sec = Math.max(0, Math.round(sec || 0));
  var m = Math.floor(sec / 60), r = sec % 60;
  return m + ":" + (r < 10 ? "0" : "") + r;
}

/* "Start the song at 0:15" — a small slider plus a "Hear it" button, so an artist can skip a long
   intro and begin the song where the vocals/beat start. Used on the upload page and in a post's
   Edit menu. opts: { audio: an <audio> element whose src is the song (created if omitted),
   initial: seconds, duration: seconds if already known, onChange(seconds, committed),
   nudge: true switches to the upload-page layout: half-second steps, "− / +" buttons beside the
     slider, and the button becomes "▶ Play with video" which calls opts.onPlay() instead of playing
     the song alone (the page plays video and song together). onChange's second argument is true
     when the member let go of the slider or tapped a nudge button, so the page can replay the clip
     against the new start point right away }.
   Returns { el, getValue, setValue, setDuration, stop, setPlaying }. */
function createMusicStartPicker(opts) {
  opts = opts || {};
  var audio = opts.audio || new Audio();
  var value = Math.max(0, Number(opts.initial) || 0);
  var el = document.createElement("div");
  el.className = "music-start";
  var nudgeBtnStyle = 'style="flex:0 0 auto; padding:6px 12px; font-size:13px;"';
  el.innerHTML =
    '<div class="music-start-top">' +
      '<span class="music-start-label">Start the song at <b class="ms-time">0:00</b></span>' +
      '<button type="button" class="music-start-play">' + (opts.nudge ? '▶ Play with video' : '▶ Hear it') + '</button>' +
    '</div>' +
    (opts.nudge
      ? '<div class="ms-row" style="display:flex; align-items:center; gap:8px; margin-top:8px;">' +
          '<button type="button" class="music-start-play ms-back" aria-label="Half a second earlier" ' + nudgeBtnStyle + '>−½</button>' +
          '<input type="range" class="ms-range" min="0" max="0" step="0.5" value="0" aria-label="Where the song starts" style="flex:1; min-width:0; margin:0;" />' +
          '<button type="button" class="music-start-play ms-fwd" aria-label="Half a second later" ' + nudgeBtnStyle + '>+½</button>' +
        '</div>'
      : '<input type="range" class="ms-range" min="0" max="0" step="1" value="0" aria-label="Where the song starts" />');
  var range = el.querySelector(".ms-range");
  var timeEl = el.querySelector(".ms-time");
  var playBtn = el.querySelector(".music-start-top .music-start-play");
  var stopTimer = null;

  function fmt(v) {
    if (!opts.nudge || v === Math.floor(v)) return formatSongTime(v);
    return formatSongTime(Math.floor(v)) + "." + Math.floor((v - Math.floor(v)) * 10 + 1e-6);
  }
  function paint() { timeEl.textContent = fmt(value); range.value = String(value); }
  var songDur = 0, startCap = null;
  function applyMax() {
    var m = Math.max(0, songDur - 1);
    if (startCap !== null) m = Math.min(m, startCap);
    range.max = String(m);
    if (value > m) value = m;
    paint();
  }
  function setDuration(d) {
    d = Math.floor(Number(d) || 0);
    if (d > 0) { songDur = d; applyMax(); }
  }
  // Latest allowed start (seconds), or null for "no extra limit" — the upload page uses this so the
  // song can never start so late that it would run out before the video ends.
  function setMaxStart(c) {
    startCap = (c === null || c === undefined) ? null : Math.max(0, Math.floor(Number(c) * 2) / 2);
    if (songDur > 0) applyMax();
  }
  function stop() {
    if (stopTimer) { clearTimeout(stopTimer); stopTimer = null; }
    if (!opts.nudge) {
      try { audio.pause(); } catch (e) {}
      playBtn.textContent = "▶ Hear it";
    }
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
    if (opts.onChange) opts.onChange(value, false);
  });
  range.addEventListener("change", function () {
    value = Number(range.value) || 0;
    paint();
    if (opts.onChange) opts.onChange(value, true);
  });
  if (opts.nudge) {
    var nudgeBy = function (delta) {
      value = Math.min(Number(range.max) || 0, Math.max(0, value + delta));
      paint();
      if (opts.onChange) opts.onChange(value, true);
    };
    el.querySelector(".ms-back").addEventListener("click", function () { nudgeBy(-0.5); });
    el.querySelector(".ms-fwd").addEventListener("click", function () { nudgeBy(0.5); });
  }
  playBtn.addEventListener("click", function () {
    if (opts.nudge) { if (opts.onPlay) opts.onPlay(); return; }
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
    setMaxStart: setMaxStart,
    stop: stop,
    setPlaying: function (playing) { if (opts.nudge) playBtn.textContent = playing ? "■ Stop" : "▶ Play with video"; }
  };
}


/* ==========================================================================
   Daily Inspiration quote picker (shared by feed.html, quote-library.html and
   admin.html's "Today ★" marker, so all three always agree).
   Ken's ask (Oct 2026): a different quote every day, in any order — not
   necessarily 1, 2, 3. How it works: the active quotes are put in a stable
   order (oldest first, then id, so identical timestamps from a bulk add can't
   reorder them), then each "round" of days uses its own seeded shuffle of that
   list. Every quote shows once per round before any repeats, the order looks
   random, the last quote of one round is never the first of the next, and
   two days in a row are never the same. No database column or scheduled job
   needed. The day changes at midnight on the member's own clock.
   ========================================================================== */
function quoteDayNumber() {
  var d = new Date();
  return Math.floor((d.getTime() - d.getTimezoneOffset() * 60000) / 86400000);
}
function quoteShuffleOrder(n, seed) {
  var s = (seed * 2654435761 + 0x9e3779b9) >>> 0;
  function rnd() {
    s = (s + 0x6D2B79F5) >>> 0;
    var t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  var a = [], i, j, tmp;
  for (i = 0; i < n; i++) a.push(i);
  for (i = n - 1; i > 0; i--) {
    j = Math.floor(rnd() * (i + 1));
    tmp = a[i]; a[i] = a[j]; a[j] = tmp;
  }
  return a;
}
function pickQuoteOfDay(quotes, dayNumber) {
  var n = quotes ? quotes.length : 0;
  if (!n) return null;
  var day = dayNumber === undefined ? quoteDayNumber() : dayNumber;
  if (n <= 2) return quotes[((day % n) + n) % n];
  var round = Math.floor(day / n), pos = day - round * n;
  var order = quoteShuffleOrder(n, round);
  if (pos <= 1) {
    // Never start a round with the quote that ended the previous round.
    var prevLast = quoteShuffleOrder(n, round - 1)[n - 1];
    if (order[0] === prevLast) { var t = order[0]; order[0] = order[1]; order[1] = t; }
  }
  return quotes[order[pos]];
}


/* ---------------------------------------------------------------------------
   Exercise labels on videos (Ken, Oct 2026). A post can carry a few short labels:
   { t: "Tricep Extensions", u: "3x10-12 reps", s: 3.2, d: 2.5 }   (s = seconds into the
   post's playback, d = how long it stays). They are stored in media.text_labels (sql/text-labels.sql)
   and drawn over the video here — slide in from the left, hold, fade out. The video file is untouched.
   --------------------------------------------------------------------------- */
var TEXT_LABEL_MAX = 6, TEXT_LABEL_SECONDS = 2.5;

/* Cleans whatever came back from the database (or the editor) into a safe, small list. */
function sanitizeTextLabels(raw) {
  if (!Array.isArray(raw)) return [];
  var out = [];
  raw.forEach(function (x) {
    if (!x || typeof x !== "object") return;
    var t = String(x.t == null ? "" : x.t).replace(/\s+/g, " ").trim().slice(0, 28);
    var u = String(x.u == null ? "" : x.u).replace(/\s+/g, " ").trim().slice(0, 18);
    var s = Number(x.s), d = Number(x.d);
    if (!t || !isFinite(s) || s < 0) return;
    if (!isFinite(d) || d < 1 || d > 6) d = TEXT_LABEL_SECONDS;
    out.push({ t: t, u: u, s: Math.round(s * 10) / 10, d: d });
  });
  out.sort(function (a, b) { return a.s - b.s; });
  return out.slice(0, TEXT_LABEL_MAX);
}

/* Best-effort: { mediaId: [labels] } for a list of video ids. Any failure (e.g. the column does not
   exist yet) simply returns an empty map, so a page can never break because of labels. */
async function fetchTextLabels(ids) {
  var map = {};
  try {
    if (!window.sb || !ids || !ids.length) return map;
    var res = await window.sb.from("media").select("id, text_labels").in("id", ids);
    if (res && !res.error && res.data) {
      res.data.forEach(function (r) {
        var l = sanitizeTextLabels(r.text_labels);
        if (l.length) map[r.id] = l;
      });
    }
  } catch (e) {}
  return map;
}

/* Draws the labels over `video` inside `host` (any positioned box that wraps the video).
   getLabels: array OR function returning the current array (the upload editor changes it live).
   getTime:   optional function returning the post's playback time in seconds (multi-clip posts pass the
              whole-reel clock); default is the video's own time minus trimStart.
   Returns { refresh() } — call after the labels change. Safe to call on a video that never plays. */
function attachTextLabels(video, host, getLabels, trimStart, getTime) {
  if (!video || !host) return { refresh: function () {} };
  var layer = host.querySelector(":scope > .vl-layer");
  if (!layer) { layer = document.createElement("div"); layer.className = "vl-layer"; host.appendChild(layer); }
  var start = typeof trimStart === "number" ? trimStart : 0;
  var shown = null, raf = 0;
  function labels() { return sanitizeTextLabels(typeof getLabels === "function" ? getLabels() : getLabels); }
  function now() { return getTime ? getTime() : (video.currentTime - start); }
  function clear() { shown = null; layer.innerHTML = ""; }
  function render() {
    var t = now(), list = labels(), hit = null;
    for (var i = 0; i < list.length; i++) { if (t >= list[i].s && t < list[i].s + list[i].d) { hit = list[i]; break; } }
    if (!hit) { if (shown) clear(); return; }
    var key = hit.t + "|" + hit.u + "|" + hit.s;
    var el = layer.firstChild;
    var elapsed = t - hit.s;
    // paused (editing / scrubbing): hold the label fully visible instead of at the invisible first/last frame
    if (video.paused) elapsed = Math.max(hit.d * 0.18, Math.min(hit.d * 0.76, elapsed));
    elapsed = Math.max(0, Math.min(hit.d, elapsed));
    if (shown !== key || !el) {
      clear();
      el = document.createElement("div");
      el.className = "vl-label";
      var a = document.createElement("span"); a.className = "vl-l1"; a.textContent = hit.t; el.appendChild(a);
      if (hit.u) { var b = document.createElement("span"); b.className = "vl-l2"; b.textContent = hit.u; el.appendChild(b); }
      el.style.animationDuration = hit.d + "s";
      el.style.animationPlayState = "paused"; // we drive the animation clock from the VIDEO clock below, so they can never drift apart
      if (!el.getAnimations) el.style.animationDelay = "-" + elapsed.toFixed(2) + "s"; // only the plain-CSS fallback needs this
      layer.appendChild(el);
      shown = key;
    }
    var anim = (el.getAnimations && el.getAnimations()[0]) || null;
    if (anim) { try { anim.pause(); anim.currentTime = elapsed * 1000; } catch (e) {} }
    else { el.style.animationPlayState = video.paused ? "paused" : "running"; } // very old browsers: plain CSS timing
  }
  function loop() { render(); raf = (!video.paused && !video.ended) ? requestAnimationFrame(loop) : 0; }
  function kick() { if (!raf) raf = requestAnimationFrame(loop); }
  video.addEventListener("play", kick);
  video.addEventListener("playing", kick);
  ["pause", "seeked", "timeupdate", "loadedmetadata", "ended"].forEach(function (ev) { video.addEventListener(ev, render); });
  render();
  if (getTime) { // a multi-clip reel swaps videos behind the scenes, so the events above may not fire: check on a short timer
    var poll = setInterval(function () { if (!video.isConnected) { clearInterval(poll); return; } render(); }, 120);
  }
  return { refresh: function () { shown = null; render(); } };
}
