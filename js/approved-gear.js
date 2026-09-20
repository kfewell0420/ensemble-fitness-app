/* ==========================================================================
   Approved Gear — rendering & filtering
   ==========================================================================
   Reads window.APPROVED_GEAR_ITEMS / window.APPROVED_GEAR_CATEGORIES /
   window.AMAZON_ASSOCIATE_TAG from js/approved-gear-picks.js (loaded first)
   and renders the filter chips + product grid on approved-gear.html.
   Editing picks never requires touching this file.
   ========================================================================== */
(function () {
  function escapeHtml(str) {
    var div = document.createElement("div");
    div.textContent = str || "";
    return div.innerHTML;
  }

  /* Appends the Amazon Associates tracking tag to a product URL without
     clobbering any query string the link already has, and without ever
     producing a double "?". Falls back to returning the URL unchanged if
     it isn't a well-formed absolute URL (so a placeholder link doesn't
     throw and blank the whole grid). */
  function withAssociateTag(rawUrl) {
    var tag = window.AMAZON_ASSOCIATE_TAG;
    try {
      var u = new URL(rawUrl);
      if (tag && tag.indexOf("REPLACE_WITH") !== 0) {
        u.searchParams.set("tag", tag);
      }
      return u.toString();
    } catch (e) {
      return rawUrl;
    }
  }

  var fallbackIcon =
    '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"></path><path d="M3 6h18"></path><path d="M16 10a4 4 0 0 1-8 0"></path></svg>';

  function categoryLabel(key) {
    var cats = window.APPROVED_GEAR_CATEGORIES || [];
    for (var i = 0; i < cats.length; i++) {
      if (cats[i].key === key) return cats[i].label;
    }
    return key;
  }

  function renderFilters() {
    var wrap = document.getElementById("gearFilters");
    if (!wrap) return;
    var cats = window.APPROVED_GEAR_CATEGORIES || [];
    var html = '<button type="button" class="gear-filter-chip active" data-cat="all">All Picks</button>';
    cats.forEach(function (c) {
      html += '<button type="button" class="gear-filter-chip" data-cat="' + escapeHtml(c.key) + '">' + escapeHtml(c.label) + "</button>";
    });
    wrap.innerHTML = html;

    wrap.querySelectorAll(".gear-filter-chip").forEach(function (chip) {
      chip.addEventListener("click", function () {
        wrap.querySelectorAll(".gear-filter-chip").forEach(function (c) { c.classList.remove("active"); });
        chip.classList.add("active");
        renderGrid(chip.getAttribute("data-cat"));
      });
    });
  }

  function renderGrid(filterKey) {
    var grid = document.getElementById("gearGrid");
    if (!grid) return;
    var items = window.APPROVED_GEAR_ITEMS || [];
    var shown = filterKey && filterKey !== "all"
      ? items.filter(function (item) { return item.category === filterKey; })
      : items;

    if (!shown.length) {
      grid.innerHTML = '<div class="gear-empty">No picks in this category yet — check back soon.</div>';
      return;
    }

    grid.innerHTML = shown.map(function (item) {
      var thumb = item.img
        ? '<img src="' + escapeHtml(item.img) + '" alt="' + escapeHtml(item.name) + '" loading="lazy" />'
        : fallbackIcon;
      var link = withAssociateTag(item.url);
      return (
        '<div class="gear-card">' +
          '<div class="gear-thumb">' +
            '<span class="gear-card-cat">' + escapeHtml(categoryLabel(item.category)) + "</span>" +
            thumb +
          "</div>" +
          '<div class="gear-card-body">' +
            '<p class="gear-card-name">' + escapeHtml(item.name) + "</p>" +
            '<p class="gear-card-note">' + escapeHtml(item.note) + "</p>" +
            '<a class="btn btn-primary btn-sm gear-card-cta" href="' + escapeHtml(link) + '" target="_blank" rel="sponsored nofollow noopener">' +
              (item.price && item.price !== "$—" ? "Buy on Amazon &middot; " + escapeHtml(item.price) : "View on Amazon") +
            "</a>" +
          "</div>" +
        "</div>"
      );
    }).join("");
  }

  // Exposed so js/approved-gear-live.js can re-render once real picks come
  // back from the database, without this file needing to know anything
  // about Supabase.
  window.rerenderApprovedGear = function () {
    if (!document.getElementById("gearGrid")) return;
    renderFilters();
    renderGrid("all");
  };

  document.addEventListener("DOMContentLoaded", window.rerenderApprovedGear);
})();
