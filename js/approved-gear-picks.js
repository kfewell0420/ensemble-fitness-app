/* ==========================================================================
   Approved Gear — pick data
   ==========================================================================
   This is the ONLY file Ken should need to touch to update Approved Gear.
   The rendering/filtering logic lives in js/approved-gear.js and reads
   whatever is in window.APPROVED_GEAR_ITEMS below — add, remove, or edit
   picks here and the page updates automatically. No HTML editing required.

   HOW TO ADD A REAL PICK:
   1. Find the product on Amazon and copy its product URL.
   2. Fill in a new object below, copying the shape of an existing one.
   3. Leave the "url" field as the plain Amazon product link — the
      AMAZON_ASSOCIATE_TAG below gets appended automatically by
      js/approved-gear.js, so you never have to hand-edit tracking tags
      into individual links.
   4. Set "img" to a product photo URL (Amazon listing images work) or
      leave it blank to show a simple placeholder icon instead.

   REPLACE_WITH_YOUR_AMAZON_ASSOCIATE_TAG:
   Once approved for the Amazon Associates program, put your real
   Associate Tag (looks like "yourname-20") in place of the placeholder
   string below. Every outbound link on the page is built from this one
   value, so this is the only place the tag needs to be entered.
   ========================================================================== */

window.AMAZON_ASSOCIATE_TAG = "REPLACE_WITH_YOUR_AMAZON_ASSOCIATE_TAG";

/* Category keys used for filtering. Keep these short — they double as the
   little pill label shown on each card's thumbnail. */
window.APPROVED_GEAR_CATEGORIES = [
  { key: "equipment", label: "Home Equipment" },
  { key: "recovery", label: "Recovery" },
  { key: "hydration", label: "Hydration" },
  { key: "wearables", label: "Wearables" }
];

/* EXAMPLE PICKS — placeholders only, clearly marked, so the page's layout
   and filtering can be reviewed before Ken's real picks replace them. Swap
   each "url" for a real Amazon product link and each "note" for Ken's own
   one-line take on why it made the cut.

   Ken's call (Sept 2026): one example per category, not two — streamlined
   down so the page doesn't feel padded before real picks replace these.
   Meal Prep was dropped as a category entirely (not just trimmed to one). */
window.APPROVED_GEAR_ITEMS = [
  {
    category: "equipment",
    name: "EXAMPLE PICK — Adjustable Dumbbell Set",
    note: "Placeholder — replace with Ken's real pick and his own one-line take.",
    price: "$—",
    url: "https://www.amazon.com/REPLACE_WITH_REAL_PRODUCT_LINK",
    img: ""
  },
  {
    category: "recovery",
    name: "EXAMPLE PICK — Foam Roller",
    note: "Placeholder — replace with Ken's real pick and his own one-line take.",
    price: "$—",
    url: "https://www.amazon.com/REPLACE_WITH_REAL_PRODUCT_LINK",
    img: ""
  },
  {
    category: "hydration",
    name: "EXAMPLE PICK — Insulated Water Bottle",
    note: "Placeholder — replace with Ken's real pick and his own one-line take.",
    price: "$—",
    url: "https://www.amazon.com/REPLACE_WITH_REAL_PRODUCT_LINK",
    img: ""
  },
  {
    category: "wearables",
    name: "EXAMPLE PICK — Fitness Tracker Watch",
    note: "Placeholder — replace with Ken's real pick and his own one-line take.",
    price: "$—",
    url: "https://www.amazon.com/REPLACE_WITH_REAL_PRODUCT_LINK",
    img: ""
  }
];
