/* shrink-video.js — Ensemble Fitness, Nov 2026
 *
 * Shrinks one video clip ON THE MEMBER'S OWN PHONE before it is uploaded, the way Instagram/TikTok
 * shrink every upload. Why: a phone's original clip is ~22 MB; the feed has to download the NEXT clip
 * while the current one plays, and a 22 MB file often has not arrived by the cut, which is the freeze.
 * A shrunk clip is ~3x smaller and arrives in time. No server, no cost, nothing to pay per member.
 *
 * What it does, for ONE clip:  read the file -> decode only the part the member kept (their trim) ->
 * scale to at most 1080 x 1920 -> re-encode as H.264 -> write a new, small, streamable .mp4
 * (index at the front). The cut is frame exact: the new file contains exactly the kept part, so it
 * starts and stops exactly where the member trimmed it. Audio is copied across untouched.
 *
 * Safety: efShrinkVideo() NEVER throws and NEVER blocks an upload. Anything it can't do (older phone,
 * odd file, result not smaller, any error) returns null and the caller uploads the original exactly as before.
 *
 * Self-contained: its own tiny MP4 reader/writer (no libraries). Uses the browser's built-in
 * VideoDecoder / VideoEncoder (WebCodecs): Chrome/Android, Safari 16.4+/iPhone.
 *
 *   efShrinkVideo(file, { start: sec, end: sec (0/undefined = to the end), onProgress: fn(0..1) })
 *     -> Promise< { file: File(.mp4), duration: seconds, from: bytes, to: bytes } | null >
 */
(function () {
  "use strict";

  var MAX_SHORT = 1080, MAX_LONG = 1920;     // biggest picture we keep (portrait phone video: 1080 x 1920)
  var BITS_PER_PIXEL = 0.065;                // quality knob: bits per pixel per frame (1080x1920@30 ~ 4 Mbps)
  var MAX_INPUT_BYTES = 600 * 1048576;       // bigger than this: leave to the old path
  var KEYFRAME_EVERY_US = 2000000;           // a keyframe at least every 2 s (clean seeking)
  var VIDEO_TS = 90000;                      // new file's video timescale
  var CHUNK_SEC = 0.5;                       // interleave audio/video in half-second chunks (streams smoothly)

  /* ---------- little byte helpers ---------- */
  function u32(b, o) { return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0; }
  function i32(b, o) { return (b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]; }
  function u16(b, o) { return (b[o] << 8) | b[o + 1]; }
  function u64(b, o) { return u32(b, o) * 4294967296 + u32(b, o + 4); }
  function s4(b, o) { return String.fromCharCode(b[o], b[o + 1], b[o + 2], b[o + 3]); }
  function hex2(n) { n = n & 255; return (n < 16 ? "0" : "") + n.toString(16); }

  function listBoxes(b, s, e) {
    var out = [], o = s;
    while (o + 8 <= e) {
      var sz = u32(b, o), t = s4(b, o + 4), h = 8;
      if (sz === 1) { if (o + 16 > e) break; sz = u64(b, o + 8); h = 16; }
      else if (sz === 0) sz = e - o;
      if (sz < h || o + sz > e) break;
      out.push({ type: t, start: o, body: o + h, end: o + sz });
      o += sz;
    }
    return out;
  }
  function child(b, box, type, from) {
    var l = listBoxes(b, from === undefined ? box.body : from, box.end);
    for (var i = 0; i < l.length; i++) if (l[i].type === type) return l[i];
    return null;
  }

  /* ---------- READ: find the index (moov) in the file and describe the video/audio tracks ---------- */
  async function readMoov(file) {
    var pos = 0;
    while (pos + 8 <= file.size) {
      var h = new Uint8Array(await file.slice(pos, pos + 16).arrayBuffer());
      var sz = u32(h, 0), t = s4(h, 4), hl = 8;
      if (sz === 1) { sz = u64(h, 8); hl = 16; } else if (sz === 0) sz = file.size - pos;
      if (sz < hl || pos + sz > file.size) return null;
      if (t === "moov") {
        if (sz > 96 * 1048576) return null;
        return new Uint8Array(await file.slice(pos, pos + sz).arrayBuffer());
      }
      pos += sz;
    }
    return null;
  }

  function parseTrack(b, trak) {
    var T = { };
    var tkhd = child(b, trak, "tkhd"), mdia = child(b, trak, "mdia");
    if (!tkhd || !mdia) return null;
    var ver = b[tkhd.body];
    var mOff = tkhd.body + (ver === 1 ? 52 : 40);
    T.matrix = b.slice(mOff, mOff + 36);
    var mdhd = child(b, mdia, "mdhd"), hdlr = child(b, mdia, "hdlr"), minf = child(b, mdia, "minf");
    if (!mdhd || !hdlr || !minf) return null;
    T.timescale = u32(b, mdhd.body + (b[mdhd.body] === 1 ? 20 : 12));
    T.handler = s4(b, hdlr.body + 8);
    var stbl = child(b, minf, "stbl");
    if (!stbl) return null;
    // edit list: the media time the track really starts at (iPhone B-frame video has one)
    T.mediaTime = 0;
    var edts = child(b, trak, "edts");
    if (edts) {
      var elst = child(b, edts, "elst");
      if (elst) {
        var ev = b[elst.body], cnt = u32(b, elst.body + 4), p = elst.body + 8;
        for (var i = 0; i < cnt; i++) {
          var mt;
          if (ev === 1) { mt = (i32(b, p + 8) * 4294967296) + u32(b, p + 12); p += 20; }
          else { mt = i32(b, p + 4); p += 12; }
          if (mt >= 0) { T.mediaTime = mt; break; }
        }
      }
    }
    var stsd = child(b, stbl, "stsd"), stts = child(b, stbl, "stts"), stsz = child(b, stbl, "stsz"),
        stsc = child(b, stbl, "stsc"), stco = child(b, stbl, "stco"), co64 = child(b, stbl, "co64"),
        ctts = child(b, stbl, "ctts"), stss = child(b, stbl, "stss");
    if (!stsd || !stts || !stsz || !stsc || !(stco || co64)) return null;
    // --- sample description (first entry only)
    var ent = listBoxes(b, stsd.body + 8, stsd.end)[0];
    if (!ent) return null;
    T.entType = ent.type; T.entStart = ent.start; T.entEnd = ent.end;
    T.entry = b.slice(ent.start, ent.end);
    if (T.handler === "vide") {
      T.width = u16(b, ent.start + 32); T.height = u16(b, ent.start + 34);
      var kids = ent.start + 86;
      var cfg = null, e2 = { start: ent.start, body: kids, end: ent.end };
      var n;
      if (ent.type === "avc1" || ent.type === "avc3") {
        cfg = child(b, e2, "avcC", kids);
        if (!cfg) return null;
        T.description = b.slice(cfg.body, cfg.end);
        T.codec = "avc1." + hex2(T.description[1]) + hex2(T.description[2]) + hex2(T.description[3]);
      } else if (ent.type === "hvc1" || ent.type === "hev1") {
        cfg = child(b, e2, "hvcC", kids);
        if (!cfg) return null;
        var d = b.slice(cfg.body, cfg.end);
        T.description = d;
        var pspace = (d[1] >> 6) & 3, tier = (d[1] >> 5) & 1, pidc = d[1] & 31;
        var compat = u32(d, 2), rev = 0;
        for (n = 0; n < 32; n++) if (compat & (1 << n)) rev |= (1 << (31 - n));
        var cons = "", last = 5;
        while (last > 0 && d[6 + last] === 0) last--;
        for (n = 0; n <= last; n++) cons += "." + d[6 + n].toString(16).toUpperCase();
        T.codec = ent.type + "." + (pspace ? "ABC"[pspace - 1] : "") + pidc + "." + (rev >>> 0).toString(16).toUpperCase() + "." + (tier ? "H" : "L") + d[12] + cons;
      } else if (ent.type === "vp09") {
        cfg = child(b, e2, "vpcC", kids);
        if (!cfg) return null;
        var pr = b[cfg.body + 4], lv = b[cfg.body + 5], bd = b[cfg.body + 6] >> 4;
        T.codec = "vp09." + (pr < 10 ? "0" : "") + pr + "." + (lv < 10 ? "0" : "") + lv + "." + (bd < 10 ? "0" : "") + bd;
        T.description = undefined;
      } else return null;
    } else if (T.handler === "soun") {
      // only plain AAC is copied across. iPhone .MOV files describe it the QuickTime way (extra fields, 'esds' sometimes inside a
      // 'wave' box), so rebuild a clean MP4-style entry from the channel count, the rate and the AAC settings box.
      if (ent.type !== "mp4a") return null;
      var av = u16(b, ent.start + 16);
      if (av > 1) return null;
      var kids2 = ent.start + 36 + (av === 1 ? 16 : 0), esds = null, e3 = { start: ent.start, body: kids2, end: ent.end };
      esds = child(b, e3, "esds", kids2);
      if (!esds) { var wave = child(b, e3, "wave", kids2); if (wave) esds = child(b, wave, "esds"); }
      if (!esds) return null;
      T.channels = u16(b, ent.start + 24) || 2; T.rate = u32(b, ent.start + 32) >>> 16;
      T.entry = box("mp4a", zeros(6), w16(1), zeros(8), w16(u16(b, ent.start + 24) || 2), w16(16), w16(0), w16(0),
        w32((u32(b, ent.start + 32) >>> 16) * 65536), b.slice(esds.start, esds.end));
    } else return null;
    // --- sample tables
    var count = u32(b, stsz.body + 8), fixed = u32(b, stsz.body + 4), i2, j;
    T.n = count;
    T.size = new Uint32Array(count);
    for (i2 = 0; i2 < count; i2++) T.size[i2] = fixed ? fixed : u32(b, stsz.body + 12 + i2 * 4);
    // chunk offsets
    var nco = u32(b, (stco || co64).body + 4), chunkOff = new Float64Array(nco);
    for (i2 = 0; i2 < nco; i2++) chunkOff[i2] = stco ? u32(b, stco.body + 8 + i2 * 4) : u64(b, co64.body + 8 + i2 * 8);
    var nsc = u32(b, stsc.body + 4), sc = [];
    for (i2 = 0; i2 < nsc; i2++) sc.push([u32(b, stsc.body + 8 + i2 * 12), u32(b, stsc.body + 12 + i2 * 12)]);
    T.offset = new Float64Array(count);
    var s = 0;
    for (i2 = 0; i2 < sc.length; i2++) {
      var firstChunk = sc[i2][0], perChunk = sc[i2][1], lastChunk = (i2 + 1 < sc.length) ? sc[i2 + 1][0] - 1 : nco;
      for (var c = firstChunk; c <= lastChunk && s < count; c++) {
        var off = chunkOff[c - 1];
        for (j = 0; j < perChunk && s < count; j++) { T.offset[s] = off; off += T.size[s]; s++; }
      }
    }
    if (s !== count) return null;
    // decode times
    T.dts = new Float64Array(count); T.dur = new Float64Array(count);
    var nst = u32(b, stts.body + 4), k = 0, t = 0;
    for (i2 = 0; i2 < nst; i2++) {
      var cn = u32(b, stts.body + 8 + i2 * 8), dl = u32(b, stts.body + 12 + i2 * 8);
      for (j = 0; j < cn && k < count; j++) { T.dts[k] = t; T.dur[k] = dl; t += dl; k++; }
    }
    if (k !== count) return null;
    T.cts = new Float64Array(count);
    for (i2 = 0; i2 < count; i2++) T.cts[i2] = T.dts[i2];
    if (ctts) {
      var nct = u32(b, ctts.body + 4); k = 0;
      for (i2 = 0; i2 < nct; i2++) {
        var cc = u32(b, ctts.body + 8 + i2 * 8), co = i32(b, ctts.body + 12 + i2 * 8);
        for (j = 0; j < cc && k < count; j++) { T.cts[k] += co; k++; }
      }
    }
    T.sync = new Uint8Array(count);
    if (stss) {
      var nss = u32(b, stss.body + 4);
      for (i2 = 0; i2 < nss; i2++) { var sn = u32(b, stss.body + 8 + i2 * 4) - 1; if (sn >= 0 && sn < count) T.sync[sn] = 1; }
    } else T.sync.fill(1);
    return T;
  }

  function parseFile(moov) {
    var root = { start: 0, body: 8, end: moov.length };
    var traks = listBoxes(moov, 8, moov.length).filter(function (x) { return x.type === "trak"; });
    var V = null, A = null;
    for (var i = 0; i < traks.length; i++) {
      var hd = child(moov, child(moov, traks[i], "mdia") || traks[i], "hdlr");
      var kind = hd ? s4(moov, hd.body + 8) : "";
      if (kind === "vide" && !V) { V = parseTrack(moov, traks[i]); if (!V) return null; }
      else if (kind === "soun" && !A) { A = parseTrack(moov, traks[i]); if (!A) return { v: null, a: null, audioBad: true }; }
    }
    return { v: V, a: A };
  }

  /* ---------- WRITE: a small MP4 with the index first ---------- */
  function cat(list) {
    var n = 0, i; for (i = 0; i < list.length; i++) n += list[i].length;
    var out = new Uint8Array(n), o = 0;
    for (i = 0; i < list.length; i++) { out.set(list[i], o); o += list[i].length; }
    return out;
  }
  function w32(v) { return new Uint8Array([(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255]); }
  function w16(v) { return new Uint8Array([(v >>> 8) & 255, v & 255]); }
  function a4(s) { return new Uint8Array([s.charCodeAt(0), s.charCodeAt(1), s.charCodeAt(2), s.charCodeAt(3)]); }
  function zeros(n) { return new Uint8Array(n); }
  function box(type) {
    var parts = Array.prototype.slice.call(arguments, 1), body = cat(parts);
    return cat([w32(body.length + 8), a4(type), body]);
  }
  function fullbox(type, ver, flags) {
    var parts = Array.prototype.slice.call(arguments, 3);
    return box.apply(null, [type, new Uint8Array([ver, (flags >> 16) & 255, (flags >> 8) & 255, flags & 255])].concat(parts));
  }
  var IDENT = cat([w32(0x10000), w32(0), w32(0), w32(0), w32(0x10000), w32(0), w32(0), w32(0), w32(0x40000000)]);

  // tr = { handler, timescale, durTicks, sizes[], deltas[], syncs[] | null (all sync), chunks: [{first, count, offset}], entry: Uint8Array,
  //        matrix, width, height, trackId }
  function buildTrak(tr, movieDurMs) {
    var n = tr.sizes.length, i;
    // stts (run-length)
    var runs = [], r = null;
    for (i = 0; i < n; i++) { if (r && r.d === tr.deltas[i]) r.c++; else { r = { c: 1, d: tr.deltas[i] }; runs.push(r); } }
    var sttsB = [w32(runs.length)]; runs.forEach(function (x) { sttsB.push(w32(x.c), w32(x.d)); });
    // stsz
    var stszB = [w32(0), w32(n)]; for (i = 0; i < n; i++) stszB.push(w32(tr.sizes[i]));
    // stsc (collapse equal neighbours)
    var scs = [], prev = -1;
    tr.chunks.forEach(function (c, ci) { if (c.count !== prev) { scs.push([ci + 1, c.count]); prev = c.count; } });
    var stscB = [w32(scs.length)]; scs.forEach(function (x) { stscB.push(w32(x[0]), w32(x[1]), w32(1)); });
    // stco
    var stcoB = [w32(tr.chunks.length)]; tr.chunks.forEach(function (c) { stcoB.push(w32(c.offset)); });
    var stblParts = [fullbox("stsd", 0, 0, w32(1), tr.entry), fullbox("stts", 0, 0, cat(sttsB))];
    if (tr.syncs) { var ssB = [w32(tr.syncs.length)]; tr.syncs.forEach(function (x) { ssB.push(w32(x)); }); stblParts.push(fullbox("stss", 0, 0, cat(ssB))); }
    stblParts.push(fullbox("stsc", 0, 0, cat(stscB)), fullbox("stsz", 0, 0, cat(stszB)), fullbox("stco", 0, 0, cat(stcoB)));
    var isV = tr.handler === "vide";
    var mediaHdr = isV ? fullbox("vmhd", 0, 1, zeros(8)) : fullbox("smhd", 0, 0, zeros(4));
    var dinf = box("dinf", fullbox("dref", 0, 0, w32(1), fullbox("url ", 0, 1)));
    var minf = box("minf", mediaHdr, dinf, box.apply(null, ["stbl"].concat(stblParts)));
    var mdhd = fullbox("mdhd", 0, 0, w32(0), w32(0), w32(tr.timescale), w32(tr.durTicks), w16(0x55c4), w16(0));
    var hdlr = fullbox("hdlr", 0, 0, w32(0), a4(tr.handler), zeros(12), new Uint8Array(isV ? [86, 105, 100, 101, 111, 0] : [83, 111, 117, 110, 100, 0]));
    var tkhd = fullbox("tkhd", 0, 3, w32(0), w32(0), w32(tr.trackId), w32(0), w32(movieDurMs), zeros(8), w16(0), w16(0),
      w16(isV ? 0 : 0x0100), w16(0), tr.matrix || IDENT, w32(isV ? tr.width * 65536 : 0), w32(isV ? tr.height * 65536 : 0));
    return box("trak", tkhd, box("mdia", mdhd, hdlr, minf));
  }
  function buildMoov(tracks, movieDurMs) {
    var mvhd = fullbox("mvhd", 0, 0, w32(0), w32(0), w32(1000), w32(movieDurMs), w32(0x10000), w16(0x0100), zeros(10), IDENT, zeros(24), w32(tracks.length + 1));
    return box.apply(null, ["moov", mvhd].concat(tracks.map(function (t) { return buildTrak(t, movieDurMs); })));
  }
  // lay out: ftyp, moov (index first), mdat. `chunksInOrder` = [{track, samples: [Uint8Array...]}] already interleaved.
  function writeMp4(tracks, interleaved, movieDurMs) {
    var ftyp = box("ftyp", a4("isom"), w32(512), a4("isom"), a4("iso2"), a4("avc1"), a4("mp41"));
    // pass 1: the index with placeholder offsets, to learn its size
    var sizeProbe = buildMoov(tracks, movieDurMs).length;
    var base = ftyp.length + sizeProbe + 8, run = base;
    interleaved.forEach(function (ch) { ch.ref.offset = run; run += ch.bytes; });
    var moov = buildMoov(tracks, movieDurMs);
    if (moov.length !== sizeProbe) throw new Error("index size changed");
    var mdatSize = 8 + (run - base);
    if (run > 4294967295) throw new Error("too big");
    var parts = [ftyp, moov, cat([w32(mdatSize), a4("mdat")])];
    interleaved.forEach(function (ch) { for (var i = 0; i < ch.samples.length; i++) parts.push(ch.samples[i]); });
    return new Blob(parts, { type: "video/mp4" });
  }

  /* ---------- the job ---------- */
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  // every "can't do it" says why (window.efShrinkWhy), so a clip that went up unshrunk can be explained
  function bail(why) { window.efShrinkWhy = why; return null; }

  function pickSize(w, h) {
    var sc = Math.min(1, MAX_SHORT / Math.min(w, h), MAX_LONG / Math.max(w, h));
    return { w: Math.max(2, Math.round(w * sc / 2) * 2), h: Math.max(2, Math.round(h * sc / 2) * 2) };
  }

  // open one clip: its index, its frame times, how it is turned for display
  async function openClip(file, spec) {
    if (!file || !file.size || file.size > MAX_INPUT_BYTES || typeof file.slice !== "function") return bail("file empty or too big");
    var moov = await readMoov(file);
    if (!moov) return bail("could not find the video index in the file");
    var info = parseFile(moov);
    if (!info || !info.v || info.audioBad) return bail(info && info.audioBad ? "the sound format is not supported" : "the video format is not supported (not plain H.264/H.265 in an MP4/MOV)");
    var V = info.v, A = info.a, n = V.n, i;
    var C = { file: file, V: V, A: A, vPts: new Float64Array(n) };
    for (i = 0; i < n; i++) C.vPts[i] = (V.cts[i] - V.mediaTime) / V.timescale;
    var total = 0; for (i = 0; i < n; i++) if (C.vPts[i] + V.dur[i] / V.timescale > total) total = C.vPts[i] + V.dur[i] / V.timescale;
    C.ts = Math.max(0, +spec.start || 0);
    C.te = +spec.end > 0 ? Math.min(+spec.end, total) : total;
    if (!(C.te - C.ts > 0.05)) return bail("the kept part is too short");
    C.fps = n / Math.max(0.001, total);
    var m = V.matrix;
    C.ma = i32(m, 0) / 65536; C.mb = i32(m, 4) / 65536; C.mc = i32(m, 12) / 65536; C.md = i32(m, 16) / 65536;
    C.cw = V.width; C.ch = V.height;
    C.sw = Math.round(Math.abs(C.ma * C.cw + C.mc * C.ch)); C.sh = Math.round(Math.abs(C.mb * C.cw + C.md * C.ch));   // size as the member sees it (turned upright)
    if (!(C.sw > 0 && C.sh > 0)) return bail("picture size unreadable");
    C.decCfg = { codec: V.codec, codedWidth: V.width, codedHeight: V.height };
    if (V.description) C.decCfg.description = V.description;
    var ds = await VideoDecoder.isConfigSupported(C.decCfg);
    if ((!ds || !ds.supported) && /^avc1\.[0-9a-fA-F]{6}$/.test(V.codec)) {
      // Some phones record H.264 labelled with an extreme "level" (Samsung writes 6.0). Browsers refuse to decode on the label
      // alone although the picture itself is ordinary. The real settings are inside the stream, so retry with common levels.
      var lv = ["34", "33", "2a", "28", "1f"];
      for (var li = 0; li < lv.length && !(ds && ds.supported); li++) {
        var alt = { codec: V.codec.slice(0, 11) + lv[li], codedWidth: V.width, codedHeight: V.height, description: V.description };
        try { var d2 = await VideoDecoder.isConfigSupported(alt); if (d2 && d2.supported) { ds = d2; C.decCfg = alt; } } catch (e) { /* next */ }
      }
    }
    if (!ds || !ds.supported) return bail("this phone cannot decode this video (" + V.codec + ")");
    // which frames to decode: from the keyframe at/just before the start, to just past the end
    var st = -1;
    for (i = 0; i < n; i++) if (V.sync[i] && C.vPts[i] <= C.ts + 0.001 && (st < 0 || V.cts[i] >= V.cts[st])) st = i;
    if (st < 0) for (i = 0; i < n; i++) if (V.sync[i]) { st = i; break; }
    if (st < 0) return bail("no starting keyframe");
    var en = st;
    for (i = st; i < n; i++) if (C.vPts[i] < C.te) en = i;
    C.startIdx = st; C.endIdx = Math.min(n - 1, en + 6);
    return C;
  }

  // Make ONE finished .mp4 out of one or more clips, each cut to [start, end]. Several clips are joined into one
  // continuous file (a hard cut from one to the next, no gap, no overlap).
  async function build(specs, opt) {
    if (typeof VideoDecoder === "undefined" || typeof VideoEncoder === "undefined" || typeof VideoFrame === "undefined") return bail("this browser has no video converter");
    window.efShrinkWhy = "";
    var t0Run = Date.now(), i, k, clips = [], origBytes = 0;
    for (i = 0; i < specs.length; i++) {
      var C = await openClip(specs[i].file, specs[i]);
      if (!C) return null;
      clips.push(C); origBytes += specs[i].file.size;
    }
    // the sound has to be the same kind in every clip (or absent from every clip), or it can't be joined
    var hasA = !!clips[0].A;
    for (i = 1; i < clips.length; i++) {
      if (!!clips[i].A !== hasA) return bail("some clips have sound and some don't");
      if (hasA && (clips[i].A.timescale !== clips[0].A.timescale || clips[i].A.channels !== clips[0].A.channels)) return bail("the clips have different sound formats");
    }
    var maxFps = 0; clips.forEach(function (c) { if (c.fps > maxFps) maxFps = c.fps; });
    var out = pickSize(clips[0].sw, clips[0].sh);
    var bitrate = Math.round(Math.max(1000000, Math.min(maxFps > 45 ? 7000000 : 6000000, out.w * out.h * Math.min(maxFps, 60) * BITS_PER_PIXEL)));
    var tries = (opt.outCodecs && opt.outCodecs.length) ? opt.outCodecs : ["avc1.64002A", "avc1.4D402A", "avc1.42E02A"];
    var encCfg = null, outCodec = null;
    for (i = 0; i < tries.length && !encCfg; i++) {
      var cfg = { codec: tries[i], width: out.w, height: out.h, bitrate: bitrate, framerate: Math.round(maxFps * 100) / 100, latencyMode: "quality" };
      if (/^avc1/.test(tries[i])) cfg.avc = { format: "avc" };
      try { var es = await VideoEncoder.isConfigSupported(cfg); if (es && es.supported) { encCfg = es.config || cfg; outCodec = tries[i]; } } catch (e) { /* next */ }
    }
    if (!encCfg) return bail("this phone cannot make H.264 video");
    var isAvcOut = /^avc1/.test(outCodec);

    var canvas = document.createElement("canvas");
    canvas.width = out.w; canvas.height = out.h;
    var ctx = canvas.getContext("2d");
    if (!ctx) return bail("no drawing surface");

    var vOut = [], outConfig = null, failed = null, kept = 0, lastKeyUs = -1e12;
    var totalFeed = 0, fed = 0, wantFrames = 0;
    clips.forEach(function (c) { totalFeed += c.endIdx - c.startIdx + 1; wantFrames += Math.max(1, Math.round((c.te - c.ts) * c.fps)); });

    var encoder = new VideoEncoder({
      output: function (chunk, meta) {
        var buf = new Uint8Array(chunk.byteLength); chunk.copyTo(buf);
        if (meta && meta.decoderConfig && meta.decoderConfig.description && !outConfig) {
          var dsc = meta.decoderConfig.description;
          outConfig = new Uint8Array(dsc instanceof ArrayBuffer ? dsc : dsc.buffer.slice(dsc.byteOffset, dsc.byteOffset + dsc.byteLength));
        }
        vOut.push({ data: buf, pts: chunk.timestamp, key: chunk.type === "key" });
      },
      error: function (e) { failed = failed || e; }
    });
    encoder.configure(encCfg);

    var offsetUs = 0, clipInfo = [];
    for (k = 0; k < clips.length && !failed; k++) {
      var Ck = clips[k], V = Ck.V;
      // how this clip is laid onto the common picture: the same shape = fill it; a different shape = fit it whole (black bars)
      var sameShape = Math.abs((Ck.sw / Ck.sh) / (out.w / out.h) - 1) < 0.04;
      var fit = sameShape ? Math.max(out.w / Ck.sw, out.h / Ck.sh) : Math.min(out.w / Ck.sw, out.h / Ck.sh);
      var cs = { firstUs: -1, lastRel: -1, kept: 0 };
      var tsUs = Ck.ts * 1e6 - 5000, teUs = Ck.te * 1e6 - 5000, frameUs = Math.round(1e6 / Ck.fps), base = offsetUs;
      var decoder = new VideoDecoder({
        output: function (frame) {
          try {
            var t = frame.timestamp;
            if (failed || t < tsUs || t >= teUs) { frame.close(); return; }
            if (cs.firstUs < 0) cs.firstUs = t;
            var rel = t - cs.firstUs;
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            if (!sameShape) { ctx.fillStyle = "#000"; ctx.fillRect(0, 0, out.w, out.h); }
            ctx.translate(out.w / 2, out.h / 2);
            ctx.transform(Ck.ma, Ck.mb, Ck.mc, Ck.md, 0, 0);      // turn it upright the way the phone's file says
            ctx.drawImage(frame, -Ck.cw * fit / 2, -Ck.ch * fit / 2, Ck.cw * fit, Ck.ch * fit);
            var abs = base + rel;
            var nf = new VideoFrame(canvas, { timestamp: abs, duration: frameUs });
            var key = (cs.kept === 0) || (abs - lastKeyUs >= KEYFRAME_EVERY_US);   // every clip starts on a keyframe
            if (key) lastKeyUs = abs;
            encoder.encode(nf, { keyFrame: key });
            nf.close(); frame.close();
            cs.kept++; kept++; cs.lastRel = rel;
            if (opt.onProgress && (kept % 8 === 0)) { try { opt.onProgress(Math.min(0.97, kept / wantFrames * 0.95)); } catch (e) {} }
          } catch (e) { failed = failed || e; try { frame.close(); } catch (e2) {} }
        },
        error: function (e) { failed = failed || e; }
      });
      decoder.configure(Ck.decCfg);
      var idx = Ck.startIdx, BATCH = 24;
      while (idx <= Ck.endIdx && !failed) {
        var last = Math.min(Ck.endIdx, idx + BATCH - 1), lo = Infinity, hi = 0, q;
        for (q = idx; q <= last; q++) { if (V.offset[q] < lo) lo = V.offset[q]; if (V.offset[q] + V.size[q] > hi) hi = V.offset[q] + V.size[q]; }
        var blob = new Uint8Array(await Ck.file.slice(lo, hi).arrayBuffer());
        for (q = idx; q <= last; q++) {
          var o = V.offset[q] - lo;
          decoder.decode(new EncodedVideoChunk({ type: V.sync[q] ? "key" : "delta", timestamp: Math.round(Ck.vPts[q] * 1e6), data: blob.subarray(o, o + V.size[q]) }));
        }
        fed += last - idx + 1; idx = last + 1;
        while (!failed && (decoder.decodeQueueSize > 8 || encoder.encodeQueueSize > 8)) await sleep(4);
        // a phone too slow for this job (would take more than ~5 min): stop early, the originals go up as before
        var spent = Date.now() - t0Run, frac = fed / totalFeed;
        if (spent > 8000 && frac > 0 && spent / frac > (opt.maxWorkMs || 300000)) failed = new Error("too slow on this phone");
      }
      if (!failed) await decoder.flush();
      try { decoder.close(); } catch (e) {}
      if (failed || cs.kept < 2) { failed = failed || new Error("clip " + (k + 1) + " gave no picture"); break; }
      var clipDurUs = cs.lastRel + frameUs;
      clipInfo.push({ firstUs: cs.firstUs, durUs: clipDurUs, offsetUs: offsetUs });
      offsetUs += clipDurUs;
    }
    if (!failed) await encoder.flush();
    try { encoder.close(); } catch (e) {}
    if (failed || vOut.length !== kept || kept < 2) return bail("the conversion stopped: " + ((failed && (failed.message || failed.name)) || ("only " + kept + " frames came out")));
    if (isAvcOut && !outConfig) return bail("the encoder gave no settings");
    for (i = 1; i < vOut.length; i++) if (vOut[i].pts <= vOut[i - 1].pts) return bail("the encoder reordered frames");   // an encoder that reorders frames: don't risk it

    // ---- video track of the new file
    var avgFps = maxFps, vTicks = vOut.map(function (f) { return Math.round(f.pts * VIDEO_TS / 1e6); });
    var vDeltas = [], vSyncs = [];
    for (i = 0; i < vOut.length; i++) {
      vDeltas.push(i + 1 < vOut.length ? Math.max(1, vTicks[i + 1] - vTicks[i]) : Math.max(1, Math.round(VIDEO_TS / Math.max(1, clips[clips.length - 1].fps))));
      if (vOut[i].key) vSyncs.push(i + 1);
    }
    var vHead = cat([zeros(6), w16(1), zeros(16), w16(out.w), w16(out.h), w32(0x480000), w32(0x480000), w32(0), w16(1), zeros(32), w16(0x18), w16(0xffff)]);
    var vEntry;
    if (isAvcOut) vEntry = box("avc1", vHead, box("avcC", outConfig));
    else { // (only used by our own tests, with VP9)
      var mm = /^vp09\.(\d+)\.(\d+)\.(\d+)/.exec(outCodec);
      vEntry = box("vp09", vHead, fullbox("vpcC", 1, 0, new Uint8Array([+mm[1], +mm[2], (+mm[3] << 4) | 0x02, 2, 2, 2, 0, 0])));
    }
    var vDurTicks = vTicks[vTicks.length - 1] + vDeltas[vDeltas.length - 1];
    var durSec = vDurTicks / VIDEO_TS;
    var vTrack = { handler: "vide", timescale: VIDEO_TS, durTicks: vDurTicks, sizes: vOut.map(function (f) { return f.data.length; }), deltas: vDeltas, syncs: vSyncs, chunks: [], entry: vEntry, matrix: null, width: out.w, height: out.h, trackId: 1 };

    // ---- audio track: the sound is copied across clip by clip, each part lined up with its own picture
    var aTrack = null, aSamples = [];
    if (hasA) {
      var aScale = clips[0].A.timescale, audioEnd = 0;       // audioEnd = seconds of sound written so far
      for (k = 0; k < clips.length; k++) {
        var A = clips[k].A, ci = clipInfo[k], aStart = ci.firstUs / 1e6, endTarget = (ci.offsetUs + ci.durUs) / 1e6, picks = [];
        for (i = 0; i < A.n; i++) {
          var at = (A.cts[i] - A.mediaTime) / aScale - aStart;
          if (at < -0.0005) continue;
          if (at >= (ci.durUs / 1e6) + 0.05) break;
          var dsec = A.dur[i] / aScale;
          if (audioEnd + dsec / 2 > endTarget) break;          // keeps the sound from drifting away from the picture, clip after clip
          picks.push(i); audioEnd += dsec;
        }
        var AB = 64, p;
        for (p = 0; p < picks.length; p += AB) {
          var seg = picks.slice(p, p + AB), lo2 = Infinity, hi2 = 0;
          seg.forEach(function (q2) { if (A.offset[q2] < lo2) lo2 = A.offset[q2]; if (A.offset[q2] + A.size[q2] > hi2) hi2 = A.offset[q2] + A.size[q2]; });
          var ab = new Uint8Array(await clips[k].file.slice(lo2, hi2).arrayBuffer());
          seg.forEach(function (q2) { var o2 = A.offset[q2] - lo2; aSamples.push({ data: ab.slice(o2, o2 + A.size[q2]), delta: A.dur[q2] }); });
        }
      }
      if (aSamples.length) {
        var cum = 0; aSamples.forEach(function (s2) { s2.start = cum / aScale; cum += s2.delta; });
        aTrack = { handler: "soun", timescale: aScale, durTicks: cum, sizes: aSamples.map(function (s3) { return s3.data.length; }), deltas: aSamples.map(function (s4) { return s4.delta; }), syncs: null, chunks: [], entry: clips[0].A.entry, matrix: null, trackId: 2 };
      }
    }

    // ---- interleave half-second chunks of video and audio, so it streams smoothly
    var inter = [], vi = 0, ai = 0, w = 0;
    while (vi < vOut.length || (aTrack && ai < aSamples.length)) {
      var wEnd = (w + 1) * CHUNK_SEC, list, bytes, c0;
      c0 = vi; list = []; bytes = 0;
      while (vi < vOut.length && vOut[vi].pts / 1e6 < wEnd) { list.push(vOut[vi].data); bytes += vOut[vi].data.length; vi++; }
      if (list.length) { var ref = { first: c0, count: list.length, offset: 0 }; vTrack.chunks.push(ref); inter.push({ ref: ref, samples: list, bytes: bytes }); }
      if (aTrack) {
        c0 = ai; list = []; bytes = 0;
        while (ai < aSamples.length && aSamples[ai].start < wEnd) { list.push(aSamples[ai].data); bytes += aSamples[ai].data.length; ai++; }
        if (list.length) { var ref2 = { first: c0, count: list.length, offset: 0 }; aTrack.chunks.push(ref2); inter.push({ ref: ref2, samples: list, bytes: bytes }); }
      }
      w++;
      if (w > 100000) return bail("layout error");
    }
    var result = writeMp4(aTrack ? [vTrack, aTrack] : [vTrack], inter, Math.round(durSec * 1000));
    if (!(result.size > 1000)) return bail("empty result");
    var baseName = (specs[0].file.name || "clip").replace(/\.[^.]+$/, "") + ".mp4";
    var newFile;
    try { newFile = new File([result], baseName, { type: "video/mp4", lastModified: Date.now() }); } catch (e) { newFile = result; }
    if (opt.onProgress) { try { opt.onProgress(1); } catch (e) {} }
    return {
      file: newFile, duration: Math.round(durSec * 100) / 100, from: origBytes, to: result.size,
      durations: clipInfo.map(function (c) { return Math.round(c.durUs / 10000) / 100; })      // how long each clip is inside the new file
    };
  }

  function accept(r, opt) {
    // not clearly smaller? then the member's original is already fine: leave it alone
    if (!r) return null;
    if (!(r.to < r.from * 0.75) && !(opt && opt.force)) { window.efShrinkWhy = "the result was not clearly smaller (" + Math.round(r.from / 104857.6) / 10 + " MB -> " + Math.round(r.to / 104857.6) / 10 + " MB)"; return null; }
    window.efShrinkWhy = "ok";
    return r;
  }
  function logSkip(e) { window.efShrinkWhy = "error: " + ((e && (e.message || e.name)) || e); try { if (window.efDbg) window.efDbg("shrink skipped: " + ((e && (e.message || e.name)) || e)); } catch (e2) {} }

  // one clip -> one small file
  window.efShrinkVideo = async function (file, opt) {
    try { opt = opt || {}; return accept(await build([{ file: file, start: opt.start, end: opt.end }], opt), opt); }
    catch (e) { logSkip(e); return null; }
  };
  // several clips -> ONE small file with hard cuts between them. specs = [{ file, start, end }, ...] in play order.
  window.efStitchVideos = async function (specs, opt) {
    try { opt = opt || {}; if (!specs || specs.length < 1) return null; return accept(await build(specs, opt), opt); }
    catch (e) { logSkip(e); return null; }
  };
  window.efShrinkSupported = function () {
    return typeof VideoDecoder !== "undefined" && typeof VideoEncoder !== "undefined" && typeof VideoFrame !== "undefined";
  };
})();
