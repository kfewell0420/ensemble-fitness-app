// Called from books.html when someone clicks "Buy Now" on a book. Looks the
// book up in Supabase (never trusts a price sent from the browser), creates
// a Stripe Checkout Session for that price, and hands back the URL to
// redirect to. The actual sale only gets recorded once Stripe confirms
// payment via the webhook — this function never touches the database to
// write anything.
//
// Nov 2026, Ken's ask: Ensemble Reads is now also browsable *inside* the
// member app (app.ensemblefitness.com/books.html), not just the public
// marketing site (ensemblefitness.com/books.html) — same "no leaving the
// app" reasoning that already applies to Music Library's tipping/top-up
// flow (see wallet-topup.js). The app's books.html sends `app: true` in
// the request body so Stripe sends the buyer back to THIS app instead of
// the marketing site once Checkout finishes, and — since that request
// comes from a signed-in member, unlike the public storefront's anonymous
// visitors — its Authorization bearer token is used to prefill the buyer's
// email on the Checkout page, same as wallet-topup.js already does for the
// wallet top-up flow. The public site's own call (no `app` flag, no auth
// header) behaves exactly as it always has — this is purely additive.
var lib = require("./_lib");

exports.handler = async function (event) {
  var preflight = lib.handlePreflight(event);
  if (preflight) return preflight;

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

    var fromApp = payload.app === true;
    var returnBaseUrl = fromApp
      ? (process.env.APP_URL || "https://app.ensemblefitness.com")
      : (process.env.SITE_URL || "https://ensemblefitness.com");

    // Best-effort only: a signed-in member's email prefills the Checkout
    // page so they don't have to retype it, but a missing or invalid token
    // never blocks the purchase itself — the public storefront has never
    // required a login at all, and this shouldn't either.
    var customerEmail = null;
    if (fromApp) {
      var authHeader = event.headers["authorization"] || event.headers["Authorization"];
      var user = await lib.getAuthedUser(authHeader);
      if (user) customerEmail = user.email;
    }

    var sessionParams = {
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
      success_url: returnBaseUrl + "/books.html?purchase=success&session_id={CHECKOUT_SESSION_ID}",
      cancel_url: returnBaseUrl + "/books.html?purchase=cancelled"
    };
    if (customerEmail) sessionParams.customer_email = customerEmail;

    var session = await lib.stripeRequest("checkout/sessions", sessionParams);

    return lib.json(200, { url: session.url });
  } catch (err) {
    return lib.json(500, { error: err.message || "Something went wrong starting checkout." });
  }
};