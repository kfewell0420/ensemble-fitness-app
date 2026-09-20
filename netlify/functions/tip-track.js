// Called from music-library.html when a member taps a tip amount on a
// track. Deducts from their wallet balance (atomically, via the
// spend_from_wallet DB function, so two taps can't double-spend) and pays
// the artist immediately if they've linked a bank account — otherwise the
// tip sits "blocked" until they do, same as book payouts, and gets paid
// out retroactively the moment their account finishes onboarding (see
// payOutBlockedTips in stripe-webhook.js).
var lib = require("./_lib");

// Kept intentionally small and gentle — this is a "support the artist"
// gesture, not a purchase. Never trust an amount the browser sends outside
// this list.
var ALLOWED_AMOUNTS_CENTS = [50, 100, 200];

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

  var trackId = payload.track_id;
  var amountCents = parseInt(payload.amount_cents, 10);
  if (!trackId) return lib.json(400, { error: "track_id is required" });
  if (ALLOWED_AMOUNTS_CENTS.indexOf(amountCents) === -1) {
    return lib.json(400, { error: "Please choose one of the listed tip amounts." });
  }

  try {
    var tracks = await lib.supabaseRest(
      "/tracks?id=eq." + encodeURIComponent(trackId) + "&is_active=eq.true&select=id,title,artist_name,artist_email"
    );
    var track = tracks && tracks[0];
    if (!track) return lib.json(404, { error: "That track isn't available right now." });

    var newBalance = await lib.rpc("spend_from_wallet", { p_profile_id: user.id, p_amount_cents: amountCents });
    if (newBalance === null) {
      return lib.json(402, { error: "Not enough balance — add funds to tip this track.", insufficient_funds: true });
    }

    var payoutStatus = "blocked";
    var stripeTransferId = null;
    var paidOutAt = null;

    if (track.artist_email) {
      var payoutAccounts = await lib.supabaseRest(
        "/creator_payout_accounts?email=eq." + encodeURIComponent(track.artist_email) +
          "&select=stripe_connect_account_id,payouts_enabled"
      );
      var payoutAccount = payoutAccounts && payoutAccounts[0];

      if (payoutAccount && payoutAccount.payouts_enabled && payoutAccount.stripe_connect_account_id) {
        try {
          var transfer = await lib.stripeRequest("transfers", {
            amount: amountCents,
            currency: "usd",
            destination: payoutAccount.stripe_connect_account_id,
            transfer_group: "tip_track_" + trackId
          });
          payoutStatus = "paid";
          stripeTransferId = transfer.id;
          paidOutAt = new Date().toISOString();
        } catch (transferErr) {
          console.error("Tip transfer failed for track " + trackId + ": " + transferErr.message);
          payoutStatus = "unpaid"; // linked, but the transfer itself failed — needs manual follow-up
        }
      }
    }

    await lib.supabaseRest("/wallet_transactions", {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: {
        profile_id: user.id,
        type: "tip",
        amount_cents: amountCents,
        track_id: trackId,
        payout_status: payoutStatus,
        stripe_transfer_id: stripeTransferId,
        paid_out_at: paidOutAt
      }
    });

    await lib.rpc("increment_track_tip", { p_track_id: trackId, p_amount_cents: amountCents });

    return lib.json(200, {
      balance_cents: newBalance,
      artist_name: track.artist_name,
      payout_status: payoutStatus
    });
  } catch (err) {
    return lib.json(500, { error: err.message || "Something went wrong sending that tip." });
  }
};
