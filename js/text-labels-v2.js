/* text-labels-v2.js -- Oct 2026 (Ken): exercise labels get a new look and motion. Loaded right after supabaseClient.js
   and only changes how a label LOOKS and how LONG it stays; the drawing code in supabaseClient.js is untouched.
   - Both lines are black text on a white backdrop.
   - The label walks in from the left over 1 second, stays 2 seconds, then walks back out the left side over 1 second
     (before, it faded out in place). Every label, old posts included, runs the same 4 seconds in total.
   - Words show as typed (a capital first letter, then normal letters) instead of ALL CAPS.
   - Change IN / HOLD / OUT below to retime it.
   To undo all of this, remove the <script src="js/text-labels-v2.js"> line from feed.html and upload.html. */
(function () {
  var IN = 1.0, HOLD = 2.0, OUT = 1.0;           // seconds: walks in, stays, walks back out
  var TOTAL = IN + HOLD + OUT;
  window.TEXT_LABEL_SECONDS = TOTAL;

  // Same cleaning as before, except every label now uses the one standard length.
  window.sanitizeTextLabels = function (raw) {
    if (!Array.isArray(raw)) return [];
    var out = [];
    raw.forEach(function (x) {
      if (!x || typeof x !== "object") return;
      var t = String(x.t == null ? "" : x.t).replace(/\s+/g, " ").trim().slice(0, 28);
      var u = String(x.u == null ? "" : x.u).replace(/\s+/g, " ").trim().slice(0, 18);
      var s = Number(x.s);
      if (!t || !isFinite(s) || s < 0) return;
      out.push({ t: t, u: u, s: Math.round(s * 10) / 10, d: TOTAL });
    });
    out.sort(function (a, b) { return a.s - b.s; });
    return out.slice(0, window.TEXT_LABEL_MAX || 6);
  };

  function pct(sec) { return (Math.round(sec / TOTAL * 1000) / 10).toFixed(1); }
  var css =
    ".vl-layer .vl-label{animation-name:vlWalk;animation-timing-function:linear;opacity:1;text-transform:none;letter-spacing:0.02em;font-weight:700}" +
    ".vl-layer .vl-label .vl-l1,.vl-layer .vl-label .vl-l2{background:#fff;color:#111}" +
    "@keyframes vlWalk{" +
      "0%{transform:translateX(calc(-100% - 6cqw));opacity:1;animation-timing-function:cubic-bezier(.2,.8,.25,1)}" +
      pct(IN) + "%{transform:translateX(0);opacity:1}" +
      pct(IN + HOLD) + "%{transform:translateX(0);opacity:1;animation-timing-function:cubic-bezier(.6,0,.85,.35)}" +
      "100%{transform:translateX(calc(-100% - 6cqw));opacity:1}" +
    "}" +
    "@media (prefers-reduced-motion: reduce){@keyframes vlWalk{0%{opacity:0;transform:none}12%{opacity:1;transform:none}85%{opacity:1;transform:none}100%{opacity:0;transform:none}}}";
  var st = document.createElement("style");
  st.id = "vl-v2-style";
  st.textContent = css;
  (document.head || document.documentElement).appendChild(st);
})();
