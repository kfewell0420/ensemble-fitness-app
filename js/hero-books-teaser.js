// "Motivational Short Books" card in the homepage hero — rotates through
// the newest books on Ensemble Reads one at a time (like a small showcase),
// with a low-key price badge instead of any "for sale" language. Clicking
// anywhere on the card (heading, cover, or footer link) stays on-site,
// heading to the full shelf at books.html rather than off to Stripe, so
// browsing here doesn't send anyone away from ensemblefitness.com.
(function () {
  var SUPABASE_URL = "https://wgrldwdgvvlhcmlyoxrl.supabase.co";
  var SUPABASE_ANON_KEY = "sb_publishable_4sbGE70Sh5gkgpmBqdGVBg_VkqjzJVx";
  var ROTATE_MS = 3800;
  var FADE_MS = 300;

  // Stand-in covers so the rotation, cover size, and spacing can be reviewed
  // before real books are published — real photos of an open book with a
  // motivational line on the page, not drawn art. This list is only ever
  // used when the live "books" table comes back empty — the moment a
  // single real book goes live, real covers take over automatically.
  var PLACEHOLDER_BOOKS = [
    { title: "The Morning Mile", author_name: "J. Rivera", price_cents: 499, img: "assets/book-placeholders/sample-book-2.jpg" },
    { title: "Small Wins Every Day", author_name: "T. Brooks", price_cents: 399, img: "assets/book-placeholders/sample-book-3.jpg" },
    { title: "Rebuild: A Comeback Story", author_name: "M. Alvarez", price_cents: 599, img: "assets/book-placeholders/sample-book-5.jpg" },
    { title: "Breathe. Move. Begin.", author_name: "K. Chen", price_cents: 299, img: "assets/book-placeholders/sample-book-2.jpg" },
    { title: "The Discipline Habit", author_name: "A. Okafor", price_cents: 449, img: "assets/book-placeholders/sample-book-4.jpg" },
    { title: "Strong Is a Decision", author_name: "R. Patel", price_cents: 349, img: "assets/book-placeholders/sample-book-1.jpg" }
  ];

  function escapeHtml(str) {
    var div = document.createElement("div");
    div.textContent = str || "";
    return div.innerHTML;
  }

  function renderFeature(stage, book) {
    var coverUrl = book.cover_storage_path
      ? SUPABASE_URL + "/storage/v1/object/public/book-covers/" + book.cover_storage_path
      : book.img || "";

    var cover = coverUrl
      ? '<span class="hero-books-feature-cover' + (book.img ? ' landscape' : '') + '"><img src="' + coverUrl + '" alt="" /></span>'
      : '<span class="hero-books-feature-cover">📖</span>';

    stage.innerHTML =
      '<div class="hero-books-feature">' +
        cover +
        '<span class="hero-books-feature-title">' + escapeHtml(book.title) + '</span>' +
        '<span class="hero-books-feature-author">' + escapeHtml(book.author_name) + '</span>' +
        '<span class="hero-books-price">$' + (book.price_cents / 100).toFixed(2) + '</span>' +
      '</div>';
  }

  function startRotation(stage, books) {
    if (!books || books.length === 0) {
      stage.innerHTML = '<div class="hero-books-empty">New short motivational books from independent authors are landing soon.</div>';
      return;
    }

    var index = 0;
    renderFeature(stage, books[0]);
    if (books.length < 2) return;

    setInterval(function () {
      var current = stage.querySelector(".hero-books-feature");
      if (current) current.classList.add("fading");

      setTimeout(function () {
        index = (index + 1) % books.length;
        renderFeature(stage, books[index]);
      }, FADE_MS);
    }, ROTATE_MS);
  }

  document.addEventListener("DOMContentLoaded", function () {
    var stage = document.getElementById("heroBooksBody");
    if (!stage) return;

    if (!window.supabase) {
      startRotation(stage, PLACEHOLDER_BOOKS);
      return;
    }

    var sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    sb.from("books")
      .select("id, title, author_name, price_cents, cover_storage_path")
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(8)
      .then(function (res) {
        var data = res.data;
        var books = (data && data.length > 0) ? data : PLACEHOLDER_BOOKS;
        startRotation(stage, books);
      })
      .catch(function () {
        startRotation(stage, PLACEHOLDER_BOOKS);
      });
  });
})();
