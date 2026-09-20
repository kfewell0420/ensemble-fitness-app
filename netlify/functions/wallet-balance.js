// Called from music-library.html to show a signed-in member their current
// wallet balance (and a short recent-tips history). Reads through the
// service role key because member_wallets/wallet_transactions have RLS
// enabled with zero policies — no browser client can read them directly,
// on purpose, since a balance is effectively money.
var lib = require("./_lib");

exports.handler = async function (event) {
  var preflight = lib.handlePreflight(event);
  if (preflight) return preflight;

  if (event.httpMethod !== "POST") {
    return lib.json(405, { error: "Method not allowed" });
  }

  var authHeader = event.headers["authorization"] || event.headers["Authorization"];
  var user = await lib.getAuthedUser(authHeader);
  if (!user) return lib.json(401, { error: "Please sign in again." });

  try {
    var wallets = await lib.supabaseRest(
      "/member_wallets?profile_id=eq." + encodeURIComponent(user.id) + "&select=balance_cents"
    );
    var balanceCents = (wallets && wallets[0] && wallets[0].balance_cents) || 0;

    var tips = await lib.supabaseRest(
      "/wallet_transactions?profile_id=eq." + encodeURIComponent(user.id) +
        "&type=eq.tip&select=amount_cents,payout_status,created_at,tracks(title,artist_name)" +
        "&order=created_at.desc&limit=10"
    );

    return lib.json(200, { balance_cents: balanceCents, recent_tips: tips || [] });
  } catch (err) {
    return lib.json(500, { error: err.message || "Couldn't load your wallet right now." });
  }
};
