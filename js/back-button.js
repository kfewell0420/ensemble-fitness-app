/* Back arrow for the phone top bar (Ken, Oct 2026).
   Pages you reach from Explore or a link (Meal Prep, Challenges, Music, Members, Fitness+, Journeys, ...) get a
   "‹" at the left of the top bar that goes back one step. The five tab pages (Home, Explore, Post, Profile,
   Products) don't need one, so they are skipped. Phones only. Add to any page with:
   <script src="js/back-button.js"></script>   (anywhere before </body>) */
(function () {
  try {
    var page = (location.pathname.split("/").pop() || "index.html").toLowerCase();
    var tabPages = ["feed.html", "find.html", "upload.html", "profile.html", "gear.html", "index.html", "login.html", ""];
    if (tabPages.indexOf(page) !== -1) return;
    var header = document.querySelector("header.app-nav") || document.getElementById("rpAppNav");
    if (!header || header.querySelector(".ef-back")) return;

    var css = document.createElement("style");
    css.textContent =
      ".ef-back{display:none;order:-1;flex:0 0 auto;align-items:center;justify-content:center;width:40px;height:40px;margin:0 2px 0 -8px;padding:0;" +
      "background:none;border:0;color:#fff;cursor:pointer;-webkit-tap-highlight-color:transparent;}" +
      ".ef-back svg{display:block;width:26px;height:26px;}" +
      ".ef-back:active{opacity:.6;}" +
      "@media (max-width:899px){.ef-back{display:flex;}header.ef-has-back{justify-content:flex-start !important;}}";
    document.head.appendChild(css);

    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "ef-back";
    btn.setAttribute("aria-label", "Back");
    btn.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M15 4.5 7.5 12l7.5 7.5"/></svg>';
    btn.addEventListener("click", function () {
      if (window.history.length > 1) window.history.back();
      else window.location.href = "find.html";
    });
    header.classList.add("ef-has-back");
    header.insertBefore(btn, header.firstChild);
  } catch (e) { /* the back arrow is a convenience; never break a page over it */ }
})();
