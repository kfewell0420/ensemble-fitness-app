// Called from books.html when someone clicks "Buy Now" on a book. Looks the
// book up in Supabase (never trusts a price sent from the browser), creates
// a Stripe Checkout Session for that price, and hands back the URL to
// redirect to. The actual sale only gets recorded once Stripe confirms
// payment via the webhook — this function never touches the database to
// write anything.
var lib = require("./_lib");

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return lib.json(405, { error: "Method not allowed" });
  }

  var payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (e) {
    return lib.json(400, { error: "Invalid request body" });
  }

  var bookId = payload.book_id;
  if (!bookId) return lib.json(400, { error: "book_id is required" });

  try {
    var books = await lib.supabaseRest(
      "/books?id=eq." + encodeURIComponent(bookId) + "&is_active=eq.true&select=id,title,price_cents"
    );
    var book = books && books[0];
    if (!book) return lib.json(404, { error: "That book isn't available right now." });

    var siteUrl = process.env.SITE_URL || "https://ensemblefitness.com";

    var session = await lib.stripeRequest("checkout/sessions", {
      mode: "payment",
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: book.price_cents,
            product_data: { name: book.title }
          }
        }
      ],
      metadata: { type: "sale", book_id: book.id },
      success_url: siteUrl + "/books.html?purchase=success&session_id={CHECKOUT_SESSION_ID}",
      cancel_url: siteUrl + "/books.html?purchase=cancelled"
    });

    return lib.json(200, { url: session.url });
  } catch (err) {
    return lib.json(500, { error: err.message || "Something went wrong starting checkout." });
  }
};
