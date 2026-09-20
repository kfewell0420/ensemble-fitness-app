// Creates (or reuses) a Stripe Express connected account for a creator —
// a book author or music artist — and returns a one-time Stripe-hosted
// onboarding link where they enter their own bank details directly with
// Stripe. Ensemble Fitness never sees or stores an account or routing
// number, only the Stripe account ID this returns.
//
// Called two ways:
//   1. From profile.html, by a signed-in member who checked "I'm an
//      artist" at signup — sends their Supabase session token.
//   2. From connect-setup.html, by anyone who clicked the "set up your
//      payouts" link emailed to them after a book/track was approved —
//      sends the setup_token from that email instead, since they may not
//      have (or want) a full member account.
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

  try {
    var account = await findOrCreateAccountRow(event, payload);
    if (!account) return lib.json(401, { error: "Couldn't verify who this payout setup link belongs to." });

    if (!account.stripe_connect_account_id) {
      var stripeAccount = await lib.stripeRequest("accounts", {
        type: "express",
        email: account.email,
        capabilities: { transfers: { requested: true } },
        business_type: "individual"
      });
      account = await patchAccount(account.id, { stripe_connect_account_id: stripeAccount.id });
    }

    // Someone who already finished bank-linking (payouts_enabled, kept in
    // sync by stripe-webhook.js's account.updated handler) doesn't need the
    // guided setup wizard again — that's slow and feels like "starting
    // over." Send them straight to their Stripe Express Dashboard instead,
    // where they can see balance/payouts or update their bank details in
    // one click. Same "Manage Payout Account" button on profile.html either
    // way — this is just a faster destination for a returning artist.
    if (account.stripe_connect_account_id && account.payouts_enabled) {
      var loginLink = await lib.stripeRequest(
        "accounts/" + account.stripe_connect_account_id + "/login_links",
        {}
      );
      return lib.json(200, { url: loginLink.url });
    }

    var siteUrl = process.env.SITE_URL || "https://ensemblefitness.com";
    var refreshUrl = siteUrl + "/connect-setup.html?token=" + encodeURIComponent(account.setup_token);
    var returnUrl = siteUrl + "/connect-onboarding-complete.html";

    var accountLink = await lib.stripeRequest("account_links", {
      account: account.stripe_connect_account_id,
      refresh_url: refreshUrl,
      return_url: returnUrl,
      type: "account_onboarding"
    });

    return lib.json(200, { url: accountLink.url });
  } catch (err) {
    return lib.json(500, { error: err.message || "Couldn't start bank account setup. Please try again." });
  }
};

// Resolves which creator_payout_accounts row this request is for, either
// by a signed-in member's own email (creating the row if this is their
// first time, e.g. they checked "I'm an artist" before a submission ever
// created one) or by the setup_token from an emailed link.
async function findOrCreateAccountRow(event, payload) {
  var authHeader = event.headers["authorization"] || event.headers["Authorization"];

  if (authHeader) {
    var user = await lib.getAuthedUser(authHeader);
    if (!user) return null;

    var existingRows = await lib.supabaseRest(
      "/creator_payout_accounts?email=eq." + encodeURIComponent(user.email) + "&select=*"
    );
    if (existingRows && existingRows[0]) return existingRows[0];

    var createdRows = await lib.supabaseRest("/creator_payout_accounts", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: { email: user.email, profile_id: user.id }
    });
    return createdRows && createdRows[0];
  }

  var token = (payload.token || "").trim();
  if (!token) return null;

  var rows = await lib.supabaseRest(
    "/creator_payout_accounts?setup_token=eq." + encodeURIComponent(token) + "&select=*"
  );
  return rows && rows[0];
}

async function patchAccount(id, fields) {
  var rows = await lib.supabaseRest("/creator_payout_accounts?id=eq." + encodeURIComponent(id), {
    method: "PATCH",
    headers: { Prefer: "return=representation" },
    body: Object.assign({}, fields, { updated_at: new Date().toISOString() })
  });
  return rows && rows[0];
}
