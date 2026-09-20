// Deletes the signed-in member's own account, permanently. Called by
// profile.html's "Danger Zone" card (member-app, app.ensemblefitness.com) —
// cross-origin, hence the CORS handling in _lib.js, same as every other
// function this member-app calls (payout-status, create-connect-link, etc.).
//
// This exists for App Store / Play Store approval: both platforms require
// that any app supporting account creation also let a member delete their
// account and data from inside the app (Apple Guideline 5.1.1(v); Google
// Play's account deletion policy). Before this function, there was no way
// for a member to do that themselves.
//
// What actually happens, in order:
//   1. Verify the bearer token really belongs to a signed-in member — never
//      trust a client-supplied user id. This function only ever deletes the
//      CALLER's own account, nobody else's.
//   2. Best-effort delete their uploaded files from Storage. Deleting the
//      database rows below cascades automatically, but Postgres foreign
//      keys only ever delete database ROWS — they never touch actual files
//      sitting in Supabase Storage, so those have to be cleaned up here
//      explicitly or they'd be orphaned forever.
//   3. Delete the auth.users row via the Supabase Admin API. Every table
//      that stores a member's own data — profiles, media, journal_entries,
//      follows, messages, media_reactions, media_comments,
//      quote_recordings, reports (as reporter or target), blocked_users,
//      notifications, member_wallets, wallet_transactions — is wired with
//      "on delete cascade" back to profiles.id, which itself cascades from
//      auth.users.id. So this one admin-API call is what actually erases
//      everything else, atomically, inside the database. (Payout account
//      records intentionally use "on delete set null" instead, so Stripe
//      payout history isn't destroyed — see stripe-connect-payouts.sql.)
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
    // Best-effort: a storage cleanup hiccup should never block the actual
    // account deletion, which is the part that matters for compliance.
    await removeAllUnderPrefix("media", user.id + "/");
    await removeAllUnderPrefix("quote-voices", user.id + "/");

    var delRes = await fetch(lib.supabaseUrl() + "/auth/v1/admin/users/" + user.id, {
      method: "DELETE",
      headers: lib.serviceHeaders()
    });
    if (!delRes.ok) {
      var text = await delRes.text().catch(function () { return ""; });
      throw new Error("Couldn't delete account (" + delRes.status + "): " + text);
    }

    return lib.json(200, { ok: true });
  } catch (err) {
    return lib.json(500, { error: err.message || "Something went wrong deleting the account." });
  }
};

// Lists everything directly under "<bucket>/<prefix>" (member uploads live
// at "<user_id>/<uuid>.<ext>", one flat folder per member, per the path
// convention used everywhere in this project) and removes it.
async function removeAllUnderPrefix(bucket, prefix) {
  try {
    var listRes = await fetch(lib.supabaseUrl() + "/storage/v1/object/list/" + bucket, {
      method: "POST",
      headers: lib.serviceHeaders(),
      body: JSON.stringify({ prefix: prefix, limit: 1000 })
    });
    if (!listRes.ok) return;
    var items = await listRes.json().catch(function () { return []; });
    if (!items || !items.length) return;

    var paths = items.map(function (item) { return prefix + item.name; });

    await fetch(lib.supabaseUrl() + "/storage/v1/object/" + bucket, {
      method: "DELETE",
      headers: lib.serviceHeaders(),
      body: JSON.stringify({ prefixes: paths })
    });
  } catch (err) {
    // Best-effort only, as noted above -- swallow and move on.
  }
}
