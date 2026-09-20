// Called from admin.html when you click "Reject" on a pending book
// submission. This is a separate function (rather than admin.html just
// updating the database directly) because rejecting has to also refund the
// author's review fee through Stripe, which needs the secret Stripe API
// key — something a browser must never hold, even an admin's browser.
//
// Security: this only proceeds if the caller's Supabase access token
// belongs to someone actually listed in the admins table. admin.html sends
// that token in the Authorization header automatically.
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

  var submissionId = payload.submission_id;
  var reason = (payload.reason || "").trim();
  if (!submissionId || !reason) {
    return lib.json(400, { error: "submission_id and reason are required." });
  }

  try {
    var rows = await lib.supabaseRest(
      "/book_submissions?id=eq." + encodeURIComponent(submissionId) +
        "&select=id,title,author_name,author_email,stripe_payment_intent_id,status,review_fee_cents"
    );
    var submission = rows && rows[0];
    if (!submission) return lib.json(404, { error: "Submission not found." });
    if (submission.status === "rejected") return lib.json(200, { ok: true }); // already handled

    var refunded = false;
    if (submission.stripe_payment_intent_id) {
      await lib.stripeRequest("refunds", { payment_intent: submission.stripe_payment_intent_id });
      refunded = true;
    }

    await lib.supabaseRest("/book_submissions?id=eq." + encodeURIComponent(submissionId), {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: {
        status: "rejected",
        reject_reason: reason,
        refunded: refunded,
        reviewed_at: new Date().toISOString(),
        reviewed_by: admin.id
      }
    });

    await lib.sendEmail(
      submission.author_email,
      "About your Ensemble Reads submission — \"" + submission.title + "\"",
      "Hi " + (submission.author_name || "there") + ",\n\n" +
        "Thanks so much for submitting \"" + submission.title + "\" to Ensemble Reads. After review, we're not able to " +
        "publish it on the platform right now. Here's the note from our reviewer:\n\n" +
        "\"" + reason + "\"\n\n" +
        (refunded
          ? "Your review fee (" + "$" + (submission.review_fee_cents / 100).toFixed(2) + ") has been fully refunded — you don't owe us anything, and this decision isn't final if you'd like to revise and resubmit down the road.\n\n"
          : "") +
        "We're looking for short-form (30 pages or fewer), on-brand motivational content centered on fitness, health, and mindset. Keep writing — we'd love to see something else from you.\n\n" +
        "The Ensemble Fitness Team"
    );

    return lib.json(200, { ok: true, refunded: refunded });
  } catch (err) {
    return lib.json(500, { error: err.message || "Couldn't process this rejection. Please try again." });
  }
};
