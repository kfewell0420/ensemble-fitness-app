// Reads payout-linking status from creator_payout_accounts — a table no
// browser can query directly (see stripe-connect-payouts.sql), since it
// holds a Stripe account ID and a bearer-style setup_token. Two modes:
//   - An admin token + a list of emails → bulk status for admin.html's
//     Book Sales & Payouts and Music Library lists.
//   - Any other signed-in member's own token → just their own status, for
//     the Payouts card on profile.html.
var lib = require("./_lib");

exports.handler = async function (event) {
  var preflight = lib.handlePreflight(event);
  if (preflight) return preflight;

  if (event.httpMethod !== "POST") {
    return lib.json(405, { error: "Method not allowed" });
  }

  var authHeader = event.headers["authorization"] || event.headers["Authorization"];

  var payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (e) {
    return lib.json(400, { error: "Invalid request body" });
  }

  try {
    var admin = await lib.verifyAdmin(authHeader);
    if (admin && Array.isArray(payload.emails)) {
      var emails = payload.emails.filter(function (e) { return typeof e === "string" && e.trim(); });
      if (emails.length === 0) return lib.json(200, { statuses: {} });

      var orFilter = "(" + emails.map(function (e) { return "email.eq." + encodeURIComponent(e); }).join(",") + ")";
      var rows = await lib.supabaseRest("/creator_payout_accounts?or=" + orFilter + "&select=email,payouts_enabled,onboarding_link_sent_at");

      var statuses = {};
      (rows || []).forEach(function (row) {
        statuses[row.email] = { payouts_enabled: row.payouts_enabled, onboarding_link_sent_at: row.onboarding_link_sent_at };
      });
      return lib.json(200, { statuses: statuses });
    }

    var user = await lib.getAuthedUser(authHeader);
    if (!user) return lib.json(401, { error: "Sign in required." });

    var mine = await lib.supabaseRest(
      "/creator_payout_accounts?email=eq." + encodeURIComponent(user.email) + "&select=payouts_enabled,onboarding_link_sent_at,stripe_connect_account_id"
    );
    var row = mine && mine[0];
    var enabled = row ? !!row.payouts_enabled : false;

    // Safety net (Oct 2026): our payouts_enabled flag is only flipped by
    // Stripe's account.updated webhook, and if that message is late (or a
    // Connect webhook isn't set up) an artist who really did finish linking
    // their bank is stuck on the "link your bank" screen. So when our flag
    // says no, ask Stripe directly. This is READ-ONLY on purpose — it never
    // writes the flag or pays anything out; the webhook stays the only place
    // that flips payouts_enabled and releases blocked tips.
    if (row && !enabled && row.stripe_connect_account_id) {
      try {
        var live = await lib.stripeGet("accounts/" + encodeURIComponent(row.stripe_connect_account_id));
        if (live && live.payouts_enabled) enabled = true;
      } catch (e) {
        // Stripe hiccup — fall back to what our own record says.
      }
    }

    return lib.json(200, {
      has_account: !!row,
      payouts_enabled: enabled
    });
  } catch (err) {
    return lib.json(500, { error: err.message || "Couldn't check payout status." });
  }
};
