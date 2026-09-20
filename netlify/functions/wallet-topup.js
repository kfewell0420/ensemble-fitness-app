// Called from music-library.html when a member clicks "Add Funds." Creates
// a Stripe Checkout Session for one of a fixed set of top-up amounts (never
// trusts an amount the browser might send outside that list) and hands back
// the URL to redirect to. The balance itself is only ever credited once
// Stripe confirms the charge, via the webhook's handleWalletTopup — this
// function never touches member_wallets.
var lib = require("./_lib");

// Presets only, on purpose — never trust an amount the browser might send
// outside this list.
var ALLOWED_AMOUNTS_CENTS = [100, 200, 500, 1000];

exports.handler = async function (event) {
  var preflight = lib.handlePreflight(event);
  if (preflight) return preflight;

  if (event.httpMethod !== "POST") {
    return lib.json(405, { error: "Method not allowed" });
  }

  var authHeader = event.headers["authorization"] || event.headers["Authorization"];
  var user = await lib.getAuthedUser(authHeader);
  if (!user) return lib.json(401, { error: "Please sign in again." });

  var payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (e) {
    return lib.json(400, { error: "Invalid request body" });
  }

  var amountCents = parseInt(payload.amount_cents, 10);
  if (ALLOWED_AMOUNTS_CENTS.indexOf(amountCents) === -1) {
    return lib.json(400, { error: "Please choose one of the listed top-up amounts." });
  }

  try {
    var appUrl = process.env.APP_URL || "https://app.ensemblefitness.com";

    var session = await lib.stripeRequest("checkout/sessions", {
      mode: "payment",
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: amountCents,
            product_data: {
              name: "Ensemble Fitness wallet — $" + (amountCents / 100).toFixed(2),
              description: "Adds to your balance for supporting Music Library artists."
            }
          }
        }
      ],
      metadata: { type: "wallet_topup", profile_id: user.id, amount_cents: amountCents },
      customer_email: user.email,
      success_url: appUrl + "/music-library.html?topup=success",
      cancel_url: appUrl + "/music-library.html?topup=cancelled"
    });

    return lib.json(200, { url: session.url });
  } catch (err) {
    return lib.json(500, { error: err.message || "Something went wrong starting checkout." });
  }
};
