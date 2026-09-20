// Called from admin.html right after you approve a book submission or add
// a track to the Music Library. Makes sure a creator_payout_accounts row
// exists for that person's email (creating one with a fresh setup_token if
// this is their first time), and emails them a link to set up direct bank
// payouts. Safe to call again later as a "Resend setup link" action —
// it reuses the same row and token rather than creating a duplicate.
var lib = require("./_lib");

exports.handler = async function (event) {
  var preflight = lib.handlePreflight(event);
  if (preflight) return preflight;

  if (event.httpMethod !== "POST") {
    return lib.json(405, { error: "Method not allowed" });
  }

  var admin = await lib.verifyAdmin(event.headers["authorization"] || event.headers["Authorization"]);
  if (!admin) return lib.json(403, { error: "Admins only." });

  var payload;
  try {
    payload = JSON.parse(event.body || "{}");
  } catch (e) {
    return lib.json(400, { error: "Invalid request body" });
  }

  var email = (payload.email || "").trim();
  var name = (payload.name || "").trim();
  var context = payload.context === "music" ? "music" : "book";
  var title = (payload.title || "").trim();

  if (!email) return lib.json(400, { error: "email is required." });

  try {
    var existing = await lib.supabaseRest(
      "/creator_payout_accounts?email=eq." + encodeURIComponent(email) + "&select=*"
    );
    var account = existing && existing[0];

    if (!account) {
      var created = await lib.supabaseRest("/creator_payout_accounts", {
        method: "POST",
        headers: { Prefer: "return=representation" },
        body: { email: email, name: name || null }
      });
      account = created && created[0];
    } else if (name && !account.name) {
      var updated = await lib.supabaseRest("/creator_payout_accounts?id=eq." + encodeURIComponent(account.id), {
        method: "PATCH",
        headers: { Prefer: "return=representation" },
        body: { name: name }
      });
      account = (updated && updated[0]) || account;
    }
    if (!account) throw new Error("Couldn't create a payout account record.");

    await lib.supabaseRest("/creator_payout_accounts?id=eq." + encodeURIComponent(account.id), {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: { onboarding_link_sent_at: new Date().toISOString() }
    });

    var siteUrl = process.env.SITE_URL || "https://ensemblefitness.com";
    var link = siteUrl + "/connect-setup.html?token=" + encodeURIComponent(account.setup_token);

    var whatFor = context === "music"
      ? "so tips from members can be paid straight to you"
      : "so your 75% share of book sales can be paid straight to you";

    await lib.sendEmail(
      email,
      context === "music" ? "Set up payouts for your music on Ensemble Fitness" : "Set up payouts for \"" + title + "\" on Ensemble Fitness",
      "Hi " + (name || "there") + ",\n\n" +
        (context === "music"
          ? "Your track is in (or about to be added to) the Ensemble Fitness Music Library. "
          : "\"" + title + "\" is officially live on Ensemble Reads! ") +
        "One more step " + whatFor + " — link a bank account through Stripe (it takes a few minutes, and Ensemble Fitness never sees your account details, only Stripe does):\n\n" +
        link + "\n\n" +
        "Until you complete this, any money owed to you will sit safely on hold rather than going anywhere.\n\n" +
        "The Ensemble Fitness Team"
    );

    return lib.json(200, { ok: true });
  } catch (err) {
    return lib.json(500, { error: err.message || "Couldn't send the payout setup email. Please try again." });
  }
};
