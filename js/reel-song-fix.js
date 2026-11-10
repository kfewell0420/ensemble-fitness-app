/* reel-song-fix.js (Nov 2026)
 * Ken: "once I post it, it skips, per clip -- a glitch in the video and a glitch in the sound."
 * In a post with several videos and one song, js/feed-sound.js re-aims the song every time the picture moves into the next clip
 * (on play, on seeked, on a buffering blink) and stops it while the picture waits. Each re-aim is a seek, heard as a skip, and on
 * Android the seek also starves the video player for a moment (the picture hiccups at the same instant).
 * This file wraps wireFeedSound for those posts ONLY (single-video posts are untouched) so the song just runs:
 *   - a seek that would move the song by less than 3 seconds while it is playing is ignored (the song is never "chased" by the clips);
 *   - a pause caused by the picture changing clips / buffering is held back for a moment, and dropped if the picture comes back.
 * A real stop (the viewer pauses, scrolls away, the song's own part ends) is still applied. Seeks that start the song, or that
 * come after a restart of the whole reel (more than 3 s away), still happen.
 * Nothing here touches the video player.
 */
(function () {
  "use strict";
  var orig = window.wireFeedSound;
  if (typeof orig !== "function" || orig.__efReelSong) return;
  var protoDesc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "currentTime");
  function wrapped(video, audio, keepOriginal, trimStart, musicStart, musicWin, reel, fade) {
    if (reel && audio && video && protoDesc && protoDesc.get && protoDesc.set) {
      try {
        var changeAt = 0, lastIdx = -1, holdTimer = null;
        // the moment the picture really swaps to the next clip (the player empties and loads the new file) also opens the "clip change" window
        ["emptied", "loadstart", "play"].forEach(function (ev) { video.addEventListener(ev, function () { if (ev === "play" && (Date.now() - changeAt) > 2500) return; changeAt = Date.now(); }); });
        function note(m) {   // shows in the green reel log (only when that log is on)
          try { var box = document.getElementById("efReelLog"); if (!box) return; var l = (box._l = box._l || []); l.push(((Date.now() / 1000) % 1000).toFixed(1) + " song: " + m); if (l.length > 14) l.shift(); box.textContent = l.join("\n"); } catch (e) {}
        }
        var origPause = audio.pause.bind(audio);
        var delay = musicWin && musicWin.delay > 0 ? Number(musicWin.delay) : 0;
        var wlen = musicWin && musicWin.length > 0 ? Number(musicWin.length) : null;
        function songPartOver() { try { return wlen !== null && reel.time() >= delay + wlen - 0.02; } catch (e) { return false; } }
        note("song fix active");
        var tick = setInterval(function () {
          if (!video.isConnected && lastIdx !== -2) { /* slide gone: the original guard stops the song */ }
          var i = -1; try { i = (typeof reel.index === "function") ? reel.index() : reel.index; } catch (e) {}
          if (i !== lastIdx) { lastIdx = i; changeAt = Date.now(); }
        }, 50);
        Object.defineProperty(audio, "currentTime", {
          configurable: true,
          get: function () { return protoDesc.get.call(audio); },
          set: function (v) {
            var cur = protoDesc.get.call(audio);
            if (!audio.paused && isFinite(cur) && isFinite(v) && Math.abs(v - cur) < 3) { note("kept playing (skipped a " + Math.abs(v - cur).toFixed(1) + "s re-aim)"); return; }   // playing and close enough: leave the song alone
            protoDesc.set.call(audio, v);
          }
        });
        audio.pause = function () {
          if (audio.paused) return;
          // within a moment of the picture changing clips, a stop request is held back and only applied if it is still true afterwards
          if ((Date.now() - changeAt) < 2500) {
            if (!holdTimer) holdTimer = setTimeout(function () {
              holdTimer = null;
              if (!audio.paused && (video.paused || songPartOver())) origPause();   // the picture really stopped, or the song's own part ended
            }, 500);
            note("held a stop during the clip change");
            return;
          }
          origPause();
        };
        // when the slide is gone for good, stop the interval (the original guard already silences the song)
        var gone = setInterval(function () { if (!video.isConnected) { clearInterval(tick); clearInterval(gone); } }, 3000);
      } catch (e) {}
    }
    return orig.apply(this, arguments);
  }
  wrapped.__efReelSong = true;
  window.wireFeedSound = wrapped;
})();
