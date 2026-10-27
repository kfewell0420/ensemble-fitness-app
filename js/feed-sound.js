/* feed-sound.js -- Oct 2026 (launch fix for "my song skips sometimes").
   Replaces wireFeedSound() from supabaseClient.js, for the feed only. Same behaviour as before (song starts with the
   clip, follows its trim / delay / window / multi-clip reel, muted switch, "keep my sound too"), with three fixes:
   1) Video stalls: when the video stops to buffer, the song now PAUSES with it and picks up when the picture does.
      Before, the song kept playing while the picture was frozen, then was yanked BACK to the picture's clock the moment
      it resumed -- that backwards jump is the "skip" (it only happened when the video happened to buffer, so it came
      and went).
   2) No seek storm: the song is only re-aimed when it is really off (over 0.6 s), never while it is still loading or
      already seeking, and at most once every 2.5 s (a huge miss, like the clip looping round, is fixed at once).
      Every seek restarts the song's download, so correcting a song that is still loading kept it from ever starting.
   3) The song's download is told to load ahead as soon as its clip starts.
   Loaded after supabaseClient.js, so it simply takes over the name. Nothing else changes. */
(function () {
  window.wireFeedSound = function wireFeedSound(video, audio, keepOriginal, trimStart, musicStart, musicWin, reel, fade) {
    if (!video || !audio) return;
    var start = typeof trimStart === "number" ? trimStart : 0;
    var offset = typeof musicStart === "number" && musicStart > 0 ? musicStart : 0;
    var protoMuted = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, "muted");
    var intentMuted = !!video.muted;

    if (keepOriginal) {
      audio.volume = 0.35;
      audio.muted = intentMuted;
      video.addEventListener("volumechange", function () { audio.muted = video.muted; if (!video.muted && !video.paused && inWin()) { if (audio.paused) seekAudio(); tryPlay(); } });
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
          if (!intentMuted && !video.paused && inWin()) { if (audio.paused) seekAudio(); tryPlay(); } // unmuting happens inside a tap: the phone allows the song to start now, lined up with the picture
        }
      });
    }

    var delay = musicWin && musicWin.delay > 0 ? Number(musicWin.delay) : 0;
    var wlen = musicWin && musicWin.length > 0 ? Number(musicWin.length) : null;
    function rel() { return reel ? reel.time() : video.currentTime - start; }
    function inWin() {
      var r = rel();
      return r >= delay - 0.02 && (wlen === null || r < delay + wlen);
    }
    function expected() { return offset + Math.max(0, rel() - delay); }

    var lastFix = 0;      // when the song was last re-aimed
    var stalled = false;  // the song is paused only because the picture is buffering
    function seekAudio() { lastFix = Date.now(); try { audio.currentTime = expected(); } catch (e) {} }
    // Oct 2026 (Ken: "the speaker shows sound on, but the first video is silent"): the song plays through its own sound
    // player, and a phone will not let that player start WITH sound until the member has touched the screen once. That
    // refusal used to be swallowed, so the speaker said "on" while nothing played. Now, when (and only when) the phone
    // says "not allowed", the page is told (efSoundBlocked) so it can show the speaker as OFF; the song keeps running
    // silently alongside the picture, and the first tap (which unmutes inside the tap itself) brings it in, in time.
    function tryPlay() {
      var pr; try { pr = audio.play(); } catch (e) { return; }
      if (!pr || !pr.catch) return;
      pr.catch(function (err) {
        if (!err || err.name !== "NotAllowedError" || audio.muted) return;
        if (typeof window.efSoundBlocked === "function") { try { window.efSoundBlocked(video); } catch (e2) {} }
        if (!video.muted) return;                       // page chose not to mute (not the audible video): nothing more to do
        audio.muted = true;
        var again; try { again = audio.play(); } catch (e3) { return; }
        if (again && again.catch) again.catch(function () {});   // muted playback is always allowed: keeps the song in step
      });
    }
    function sync() {
      if (stalled) return;
      var drift = Math.abs(audio.currentTime - expected());
      if (drift > 3) { seekAudio(); return; }                       // way off (clip looped round, jumped): fix at once
      if (audio.seeking || audio.readyState < 3) return;            // still loading: leave it alone
      if (Date.now() - lastFix < 2500) return;                      // just corrected: give it time to settle
      if (drift > 0.6) seekAudio();
    }

    video.addEventListener("play", function () {
      stalled = false;
      if (!inWin()) { audio.pause(); return; }
      try { audio.preload = "auto"; } catch (e) {}
      seekAudio();
      tryPlay();
    });
    video.addEventListener("pause", function () {
      stalled = false;
      if (reel && video.ended) return; // reel: a clip finishing is not the song stopping
      audio.pause();
    });
    // The picture stopped to buffer: stop the song too, so the two stay together.
    // Only a real stop counts ("waiting", with no data ready to play). Safari also says "stalled" while a video plays
    // happily from a full buffer, so that one is ignored; and if the song is ever left paused for a stall that has
    // already cleared, the timeupdate below brings it back (self-healing -- it can never stay silent).
    function onStall() {
      if (video.paused || video.ended || audio.paused || stalled) return;
      if (video.readyState >= 3) return;
      stalled = true;
      audio.pause();
    }
    video.addEventListener("waiting", onStall);
    // The picture is moving again: bring the song back in beside it.
    video.addEventListener("playing", function () {
      if (!stalled) return;
      stalled = false;
      if (!inWin()) return;
      if (Math.abs(audio.currentTime - expected()) > 0.6) seekAudio();
      tryPlay();
    });
    video.addEventListener("seeked", function () { if (inWin()) seekAudio(); });
    video.addEventListener("timeupdate", function () {
      if (video.paused || video.ended) return;
      if (!inWin()) { if (!audio.paused) audio.pause(); return; } // before the song comes in / after its end
      if (stalled) {
        if (video.readyState < 3) return;          // really still buffering
        stalled = false;                           // picture is moving again: song rejoins it
        if (Math.abs(audio.currentTime - expected()) > 0.6) seekAudio();
        tryPlay();
        return;
      }
      sync();
      if (audio.paused) tryPlay(); // song entered its window, or ended before the clip looped
    });
    video.addEventListener("ended", function () {
      if (reel) return;
      audio.pause();
    });
    // Oct 2026 (Ken: "I deleted the video and could still hear its music over the next video"): if this video's slide
    // is taken out of the page (deleted, blocked, removed), its song must stop for good. Once the video has been in
    // the page and then is not, silence and drop the song.
    var seenInPage = false;
    var guard = setInterval(function () {
      if (video.isConnected) { seenInPage = true; return; }
      if (!seenInPage) return;
      clearInterval(guard);
      try { audio.pause(); audio.removeAttribute("src"); audio.load(); } catch (e) {}
    }, 700);
  };
})();
