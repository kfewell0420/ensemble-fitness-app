/* Longer on-video labels (Ken, Nov 2026: "there's always time for a beach ride" was cut off at "bea").
   A label may now be up to 56 characters and wraps onto a second line instead of being clipped. Loaded right after
   js/supabaseClient.js on every page that saves or shows labels; it replaces the one function that did the clipping
   (sanitizeTextLabels) and adds the wrapping style. Nothing already saved changes: labels saved shorter look the same. */
(function () {
  var MAX_TEXT = 56;     // two lines of about 28
  var MAX_DETAIL = 18;   // the small second line (sets/reps) is unchanged
  window.sanitizeTextLabels = function (raw) {
    if (!Array.isArray(raw)) return [];
    var maxLabels = (typeof TEXT_LABEL_MAX === "number") ? TEXT_LABEL_MAX : 6;
    var defSecs = (typeof TEXT_LABEL_SECONDS === "number") ? TEXT_LABEL_SECONDS : 2.5;
    var out = [];
    raw.forEach(function (x) {
      if (!x || typeof x !== "object") return;
      var t = String(x.t == null ? "" : x.t).replace(/\s+/g, " ").trim().slice(0, MAX_TEXT);
      var u = String(x.u == null ? "" : x.u).replace(/\s+/g, " ").trim().slice(0, MAX_DETAIL);
      var s = Number(x.s), d = Number(x.d);
      if (!t || !isFinite(s) || s < 0) return;
      if (!isFinite(d) || d < 1 || d > 6) d = defSecs;
      out.push({ t: t, u: u, s: Math.round(s * 10) / 10, d: d });
    });
    out.sort(function (a, b) { return a.s - b.s; });
    return out.slice(0, maxLabels);
  };
  try {
    var st = document.createElement("style");
    st.id = "ef-label-wrap";
    st.textContent =
      ".vl-layer .vl-label{white-space:normal !important;max-width:84% !important;width:max-content;}" +
      ".vl-layer .vl-label .vl-l1{display:block;white-space:normal !important;overflow:visible !important;text-overflow:clip !important;" +
      "overflow-wrap:break-word;word-break:normal;line-height:1.18 !important;max-width:100%;}";
    (document.head || document.documentElement).appendChild(st);
  } catch (e) {}
})();
