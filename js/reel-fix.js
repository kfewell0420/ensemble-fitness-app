/* Android reel player (Nov 2026). The posted-reel player in js/supabaseClient.js keeps a hidden second <video> loading the next clip, and
   hands over to it at each cut. On Android phones that second player competes for the phone's few video decoders (and for the network
   while a big next clip downloads), and when the hand-over is not ready in time the reel could stall on its first clip. On Android ONLY
   this replaces it with a simpler, sturdier player: one <video>, the next clip is loaded when the current one ends, a play() that is not
   accepted is tried again, a clip with no address is skipped, and a watchdog moves the reel on if a clip has ended and nothing happened.
   iPhones and computers keep the original player. Same name, same returned object, so no page needs to change except to load this file
   right after js/supabaseClient.js. */
(function () {
  var FORCE_LOG = true; // TEST BUILD 40: log always on; switch to false once the problem is found
  if (!/Android/.test(navigator.userAgent || "")) return;
  if (typeof window.wireReelPlayback !== "function") return;

  function logLine(m) {
    try {
      if (!FORCE_LOG && !/[?&]dbg=1/.test(location.search)) return;
      var box = document.getElementById("efReelLog");
      if (!box) {
        box = document.createElement("div"); box.id = "efReelLog";
        box.style.cssText = "position:fixed;left:4px;right:4px;bottom:4px;max-height:28vh;overflow:hidden;z-index:99999;background:rgba(0,0,0,.75);color:#7CFC00;font:11px/1.3 monospace;padding:4px;pointer-events:none;white-space:pre-wrap";
        (document.body || document.documentElement).appendChild(box);
      }
      var lines = (box._l = box._l || []); lines.push(((Date.now() / 1000) % 1000).toFixed(1) + " " + m);
      if (lines.length > 14) lines.shift(); box.textContent = lines.join("\n");
    } catch (e) {}
  }
  document.addEventListener("DOMContentLoaded", function () { logLine("reel-fix 40 loaded"); });
  var wired = 0;
  window.wireReelPlayback = function (video, clips, durations) {
    if (!video || !clips || clips.length < 2) return null;
    var rid = "r" + (++wired);
    var index = 0, holding = false, finishHook = null, lastAdvance = 0, tok = 0;
    var offsets = null;
    if (durations && durations.length === clips.length) {
      offsets = [0];
      for (var di = 0; di < durations.length; di++) offsets.push(offsets[di] + (Number(durations[di]) || 0));
    }
    function clipStart(c) { return typeof c.start === "number" ? c.start : 0; }
    function clipEnd(c) { return typeof c.end === "number" ? c.end : null; }
    function onScreen() {
      try {
        if (!video.isConnected) return false;
        var r = video.getBoundingClientRect(), h = window.innerHeight || document.documentElement.clientHeight || 700;
        return r.bottom > 0 && r.top < h && r.height > 0;
      } catch (e) { return true; }
    }
    function say(m) { logLine(rid + " " + m); }

    video.loop = false;
    say("wired " + clips.length + " clips, links: " + clips.map(function (c) { return c.url ? "Y" : "NO"; }).join(","));
    ["error", "stalled", "waiting", "ended", "loadedmetadata", "playing", "pause"].forEach(function (ev) {
      video.addEventListener(ev, function () {
        if (!onScreen()) return;
        var e = ev === "error" && video.error ? " code " + video.error.code : "";
        say(ev + e + " c" + (index + 1) + " t=" + (video.currentTime || 0).toFixed(1) + "/" + (isFinite(video.duration) ? video.duration.toFixed(1) : "?"));
      });
    });
    function clampToStart() { var s = clipStart(clips[index]); if (s && video.currentTime < s) { try { video.currentTime = s; } catch (e) {} } }

    function goToClip(i) {
      // a clip with no address (its link could not be made) is skipped, not waited on
      var tries = 0;
      while (!clips[i] || !clips[i].url) { i = (i + 1) % clips.length; if (++tries >= clips.length) return; }
      index = i; lastAdvance = Date.now(); say("going to clip " + (i + 1) + " of " + clips.length);
      var my = ++tok, clip = clips[i];
      video.loop = false;
      video.src = clip.url;
      video.addEventListener("loadedmetadata", function onReady() { video.removeEventListener("loadedmetadata", onReady); clampToStart(); });
      var p = video.play(); if (p && p.catch) p.catch(function () {});
      // the phone sometimes accepts the new address but never begins: try again, and restart the load if nothing arrived at all
      [900, 2200, 4500].forEach(function (ms, n) {
        setTimeout(function () {
          if (my !== tok || holding || !video.paused || video.ended || !onScreen()) return;
          say("clip " + (i + 1) + " still waiting, trying again");
          if (video.readyState === 0 && n >= 1) { try { video.load(); } catch (e) {} }
          var q = video.play(); if (q && q.catch) q.catch(function () {});
        }, ms);
      });
    }

    function advance() {
      if (Date.now() - lastAdvance < 300) return;   // one hand-over at a time
      if (index === clips.length - 1 && finishHook) {
        if (holding) return;
        if (finishHook()) { holding = true; if (!video.paused && !video.ended) video.pause(); return; }
      }
      goToClip((index + 1) % clips.length);
    }
    video.addEventListener("play", function () { if (holding) { holding = false; goToClip(0); } });
    video.addEventListener("loadedmetadata", clampToStart);
    video.addEventListener("timeupdate", function () {
      var end = clipEnd(clips[index]);
      if (end !== null && video.currentTime >= end) advance();
    });
    video.addEventListener("ended", advance);
    // watchdog: a clip has ended (or sits at its very end) and the reel did not move on
    setInterval(function () {
      if (!video.isConnected || holding) return;
      var d = video.duration;
      var atEnd = onScreen() && (video.ended || (isFinite(d) && d > 0 && video.currentTime >= d - 0.05 && video.paused));
      if (atEnd && Date.now() - lastAdvance > 1200) { say("moving on from clip " + (index + 1)); advance(); }
    }, 500);

    return {
      hasTimes: !!offsets,
      total: function () { return offsets ? offsets[offsets.length - 1] : null; },
      index: function () { return index; },
      onFinish: function (fn) { finishHook = fn; },
      restart: function () { holding = false; goToClip(0); },
      time: function () {
        var base = offsets ? offsets[index] : 0;
        return base + Math.max(0, video.currentTime - clipStart(clips[index]));
      }
    };
  };
})();
