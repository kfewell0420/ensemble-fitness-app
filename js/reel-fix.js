/* Android reel player (Nov 2026). The posted-reel player in js/supabaseClient.js keeps a hidden second <video> loading the next clip, and
   hands over to it at each cut. On Android phones that second player competes for the phone's few video decoders (and for the network
   while a big next clip downloads), and when the hand-over is not ready in time the reel could stall on its first clip. On Android ONLY
   this replaces it with a simpler, sturdier player: one <video>, the next clip is loaded when the current one ends, a play() that is not
   accepted is tried again, a clip with no address is skipped, and a watchdog moves the reel on if a clip has ended and nothing happened.
   iPhones and computers keep the original player. Same name, same returned object, so no page needs to change except to load this file
   right after js/supabaseClient.js. */
(function () {
  var FORCE_LOG = false; // set to true to show the green reel log without ?dbg=1
  // Everything EXCEPT iPhones/iPads (those keep the original player, which Ken saw playing cleanly): Android phones and computers.
  var UA = navigator.userAgent || "";
  if (/iPhone|iPad|iPod/.test(UA) || (/Macintosh/.test(UA) && navigator.maxTouchPoints > 1)) return;
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
  document.addEventListener("DOMContentLoaded", function () { logLine("reel-fix 46 loaded"); });
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

    // Get the NEXT clip's file downloaded into memory while the current one plays, so the cut is instant (no second
    // hidden player, which Android phones cannot spare). At the cut the phone plays that in-memory copy.
    var pre = null, curBlob = null, cutT = 0, cutHow = "";
    // armed: the clip on screen has really started playing (only then can "it ended and nothing happened" be true).
    // pendingCut: a cut has been asked for but the next clip has not been handed to the player yet (still arriving).
    var armed = !video.paused && video.readyState >= 3, pendingCut = false;
    function dropPre() {
      if (!pre) return;
      try { if (pre.ctl) pre.ctl.abort(); } catch (e) {}
      try { if (pre.blob) URL.revokeObjectURL(pre.blob); } catch (e) {}
      pre = null;
    }
    function finishPre(rec) { rec.done = true; var w = rec.waiters; rec.waiters = []; w.forEach(function (f) { f(); }); }
    function prefetchNext() {
      if (!window.fetch || !window.URL || !URL.createObjectURL) return;
      var n = (index + 1) % clips.length, k = 0;
      while ((!clips[n] || !clips[n].url) && k++ < clips.length) n = (n + 1) % clips.length;
      if (n === index || !clips[n] || !clips[n].url) return;
      if (pre && pre.i === n) return;
      dropPre();
      var rec = pre = { i: n, blob: null, done: false, waiters: [], ctl: (window.AbortController ? new AbortController() : null) };
      var t0 = Date.now();
      fetch(clips[n].url, rec.ctl ? { signal: rec.ctl.signal } : {}).then(function (r) {
        if (!r.ok) throw new Error("http " + r.status);
        return r.blob();
      }).then(function (b) {
        if (pre !== rec) return;
        if (b.size > 90 * 1024 * 1024) throw new Error("too big");
        rec.blob = URL.createObjectURL(b);
        say("clip " + (n + 1) + " ready ahead: " + (b.size / 1048576).toFixed(1) + " MB in " + ((Date.now() - t0) / 1000).toFixed(1) + "s");
        finishPre(rec);
      }).catch(function (e) { say("clip " + (n + 1) + " ahead-load failed: " + (e && e.message ? e.message : e)); finishPre(rec); });
    }

    // Across a cut the phone would show its own placeholder (the "old media player" look). Hold the last picture instead
    // (copied from the clip when the phone allows it, otherwise a plain black frame), and put the post's own poster back after.
    var BLANK = "data:image/gif;base64,R0lGODdhAQABAIEAAAAAAAAAAAAAAAAAACwAAAAAAQABAAAIBAABBAQAOw==";
    var savedPoster, posterHeld = false;
    function holdPicture() {
      var shot = null;
      try {
        if (video.videoWidth && video.readyState >= 2) {
          var w = Math.min(video.videoWidth, 540), h = Math.round(video.videoHeight * w / video.videoWidth);
          var cv = document.createElement("canvas"); cv.width = w; cv.height = h;
          cv.getContext("2d").drawImage(video, 0, 0, w, h);
          shot = cv.toDataURL("image/jpeg", 0.6);   // throws for a clip still coming straight from the web; fine, black is used then
        }
      } catch (e) { shot = null; }
      try {
        if (!posterHeld) { savedPoster = video.getAttribute("poster"); posterHeld = true; }
        video.setAttribute("poster", shot || BLANK);
        if (window.setPlayerChromeHidden) window.setPlayerChromeHidden(video, true);
      } catch (e) {}
    }
    function releasePicture() {
      if (!posterHeld) return;
      function put() {
        if (!posterHeld) return; posterHeld = false;
        try {
          if (savedPoster === null || savedPoster === undefined || savedPoster === "") video.removeAttribute("poster");
          else video.setAttribute("poster", savedPoster);
          if (window.setPlayerChromeHidden) window.setPlayerChromeHidden(video, false);
        } catch (e) {}
      }
      try {
        if (video.requestVideoFrameCallback) { video.requestVideoFrameCallback(function () { requestAnimationFrame(put); }); setTimeout(put, 400); }
        else setTimeout(put, 150);
      } catch (e) { put(); }
    }

    function goToClip(i) {
      // a clip with no address (its link could not be made) is skipped, not waited on
      var tries = 0;
      while (!clips[i] || !clips[i].url) { i = (i + 1) % clips.length; if (++tries >= clips.length) return; }
      index = i; lastAdvance = Date.now(); cutT = Date.now(); armed = false; pendingCut = true;
      var my = ++tok, clip = clips[i];
      say("going to clip " + (i + 1) + " of " + clips.length);
      function go(src, how) {
        if (my !== tok) return;
        pendingCut = false; lastAdvance = Date.now();
        cutHow = how;
        video.loop = false;
        holdPicture();
        var old = curBlob; curBlob = (how === "memory") ? src : null;
        video.src = src;
        if (old) { try { URL.revokeObjectURL(old); } catch (e) {} }
        var p = video.play(); if (p && p.catch) p.catch(function () {});
        // the phone sometimes accepts the new source but never begins: try again, and restart the load if nothing arrived
        [900, 2200, 4500].forEach(function (ms, n) {
          setTimeout(function () {
            if (my !== tok || holding || !video.paused || video.ended || !onScreen()) return;
            say("clip " + (i + 1) + " still waiting, trying again");
            if (video.readyState === 0 && n >= 1) { try { video.load(); } catch (e) {} }
            var q = video.play(); if (q && q.catch) q.catch(function () {});
          }, ms);
        });
      }
      var rec = pre;
      if (rec && rec.i === i) {
        if (rec.blob) { pre = null; go(rec.blob, "memory"); return; }
        if (!rec.done) {
          // still arriving: the last picture stays on screen for a moment; give it up to 5 seconds
          var fired = false;
          var timer = setTimeout(function () { if (fired) return; fired = true; if (pre === rec) dropPre(); go(clip.url, "network"); }, 5000);
          rec.waiters.push(function () {
            if (fired) return; fired = true; clearTimeout(timer);
            if (pre === rec) pre = null;
            if (rec.blob) go(rec.blob, "memory"); else go(clip.url, "network");
          });
          return;
        }
        pre = null;
      }
      go(clip.url, "network");
    }

    function advance() {
      if (pendingCut) return;                       // the next clip is still on its way
      if (Date.now() - lastAdvance < 300) return;   // one hand-over at a time
      if (index === clips.length - 1 && finishHook) {
        if (holding) return;
        if (finishHook()) { holding = true; if (!video.paused && !video.ended) video.pause(); return; }
      }
      goToClip((index + 1) % clips.length);
    }
    video.addEventListener("play", function () { if (holding) { holding = false; goToClip(0); } });
    video.addEventListener("playing", function () {
      armed = true; pendingCut = false;
      releasePicture();
      if (cutT) { say("clip " + (index + 1) + " on screen " + (Date.now() - cutT) + " ms after the cut (" + cutHow + ")"); cutT = 0; }
      prefetchNext();
    });
    video.addEventListener("loadedmetadata", clampToStart);
    video.addEventListener("timeupdate", function () {
      if (pendingCut || !armed) return;
      var end = clipEnd(clips[index]);
      if (end !== null && video.currentTime >= end) advance();
    });
    video.addEventListener("ended", advance);
    // Build 43 experiment. Ken saw that with the green log showing, every clip played, and with it hidden they did not (on two different
    // pages). The log redraws part of the screen at every clip change. This does the same, invisibly: while the reel is on screen, a
    // 3-pixel almost-clear dot in the corner is refreshed ten times a second. Remove if it turns out not to matter.
    var beat = document.getElementById("efReelBeat"), beatN = 0;
    if (!beat) {
      beat = document.createElement("div"); beat.id = "efReelBeat"; beat.setAttribute("aria-hidden", "true");
      beat.style.cssText = "position:fixed;left:0;top:0;width:3px;height:3px;overflow:hidden;opacity:0.04;font:2px/3px monospace;color:#fff;z-index:99998;pointer-events:none";
      (document.body || document.documentElement).appendChild(beat);
    }
    var beatTimer = setInterval(function () {
      if (!video.isConnected) { clearInterval(beatTimer); return; }
      if (onScreen()) beat.textContent = (beatN++ % 2) ? "." : ":";
    }, 100);

    // watchdog: a clip has ended (or sits at its very end) and the reel did not move on
    setInterval(function () {
      if (!video.isConnected || holding || !armed || pendingCut) return;
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
        if (pendingCut) return base;
        return base + Math.max(0, video.currentTime - clipStart(clips[index]));
      }
    };
  };
})();
