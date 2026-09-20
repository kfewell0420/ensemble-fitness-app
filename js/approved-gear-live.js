/* =========================================================================
   Approved Gear — live picks from admin.html
   -------------------------------------------------------------------------
   js/approved-gear-picks.js seeds window.APPROVED_GEAR_ITEMS /
   window.APPROVED_GEAR_CATEGORIES with placeholder EXAMPLE PICKs so the
   page never renders empty, and js/approved-gear.js renders that
   immediately on DOMContentLoaded. This file runs after that first paint
   and, if Ken has added any real picks from admin.html's "Approved Gear"
   tab, swaps them in and re-renders — same fail-open shape as
   js/journey-real-posts.js and js/marketplace-proof-photos.js: any error
   here just leaves the placeholder picks showing instead of breaking the
   page.

   Categories are whatever free text Ken typed per pick (fitness, home,
   health care — anything), not a fixed list, so the filter tabs here are
   built from whatever distinct categories actually exist in the live data.
   ========================================================================= */
(function () {
  var SUPABASE_URL = "https://wgrldwdgvvlhcmlyoxrl.supabase.co";
  var SUPABASE_ANON_KEY = "sb_publishable_4sbGE70Sh5gkgpmBqdGVBg_VkqjzJVx";

  if (!window.supabase) return; // CDN didn't load — keep the placeholder picks.
  var sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  function categoryKey(label) {
    return (label || "").trim().toLowerCase().replace(/\s+/g, "-");
  }

  document.addEventListener("DOMContentLoaded", async function () {
    if (!document.getElementById("gearGrid")) return;

    try {
      var { data, error } = await sb
        .from("approved_gear_items")
        .select("category, name, note, price, amazon_url, image_path")
        .eq("is_active", true)
        .order("created_at", { ascending: false });

      if (error) throw error;
      if (!data || !data.length) return; // No real picks yet — leave the placeholders showing.

      var seenCategories = {};
      var categories = [];
      var items = data.map(function (row) {
        var key = categoryKey(row.category);
        if (!seenCategories[key]) {
          seenCategories[key] = true;
          categories.push({ key: key, label: row.category });
        }
        var imgUrl = "";
        if (row.image_path) {
          var pub = sb.storage.from("gear-photos").getPublicUrl(row.image_path);
          imgUrl = (pub && pub.data && pub.data.publicUrl) || "";
        }
        return {
          category: key,
          name: row.name,
          note: row.note || "",
          price: row.price || "$—",
          url: row.amazon_url,
          img: imgUrl
        };
      });

      window.APPROVED_GEAR_ITEMS = items;
      window.APPROVED_GEAR_CATEGORIES = categories;
      if (window.rerenderApprovedGear) window.rerenderApprovedGear();
    } catch (e) {
      // Leave the placeholder picks in place — never show a broken/empty grid.
    }
  });
})();
