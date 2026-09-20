/* =========================================================================
   "Real people. Real products." — Fit Marketplace proof-in-action grid
   -------------------------------------------------------------------------
   Ken's ask (Sept 2026): the 4 boxes at the top of marketplace.html start
   out as placeholder gradient squares (see the static markup in the
   #proof-in-action section), but once members start tagging their own
   photos with a product name (profile.html's upload form → product_tag
   column, approved through the normal admin.html review queue), this
   swaps those placeholders for real member photos.

   Same pattern as js/journey-real-posts.js: read-only, public anon key,
   only ever shows rows where status = 'approved' (RLS on public.media and
   storage.objects already restricts this — see sql/product-tag.sql), and
   fails open into the existing static markup if the CDN or the query
   doesn't come through, so a network hiccup never leaves the section blank.
   ========================================================================= */
(function () {
  var SUPABASE_URL = "https://wgrldwdgvvlhcmlyoxrl.supabase.co";
  var SUPABASE_ANON_KEY = "sb_publishable_4sbGE70Sh5gkgpmBqdGVBg_VkqjzJVx";
  var MAX_PHOTOS = 4;

  if (!window.supabase) return; // CDN didn't load — keep the static placeholder boxes as-is.
  var sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  function escapeHtml(str) {
    var div = document.createElement("div");
    div.textContent = str == null ? "" : str;
    return div.innerHTML;
  }

  function boxHtml(url, caption) {
    return (
      '<div>' +
        '<div class="proof-photo-box" style="background:#0b0f1a;">' +
          '<img src="' + escapeHtml(url) + '" alt="' + escapeHtml(caption) + '" style="width:100%; height:100%; object-fit:cover;" loading="lazy" />' +
        '</div>' +
        '<div class="proof-photo-caption">' + escapeHtml(caption) + '</div>' +
      '</div>'
    );
  }

  document.addEventListener("DOMContentLoaded", async function () {
    var grid = document.querySelector(".proof-photo-grid");
    if (!grid) return;

    try {
      var { data, error } = await sb
        .from("media")
        .select("id, storage_path, product_tag")
        .eq("kind", "photo")
        .eq("status", "approved")
        .not("product_tag", "is", null)
        .order("created_at", { ascending: false })
        .limit(MAX_PHOTOS);

      if (error) throw error;
      if (!data || !data.length) return; // No real tagged photos approved yet — leave the placeholders showing.

      var boxes = [];
      for (var i = 0; i < data.length; i++) {
        var item = data[i];
        var { data: signed } = await sb.storage.from("media").createSignedUrl(item.storage_path, 3600);
        if (signed && signed.signedUrl) {
          boxes.push(boxHtml(signed.signedUrl, item.product_tag));
        }
      }

      if (boxes.length) grid.innerHTML = boxes.join("");
    } catch (e) {
      // Leave the static placeholder boxes in place — never show a broken/empty grid.
    }
  });
})();
