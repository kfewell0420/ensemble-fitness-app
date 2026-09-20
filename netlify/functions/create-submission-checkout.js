// Called from submit-book.html after an author has already uploaded their
// manuscript PDF (and optional cover) straight to Supabase Storage from
// their browser. This function creates the actual book_submissions row
// (using the service role key — a browser is never allowed to insert into
// that table directly, so a submission can't exist without a real, current
// review fee attached to it) and a Stripe Checkout Session for that fee.
var lib = require("./_lib");

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

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

  var title = (payload.title || "").trim();
  var authorName = (payload.author_name || "").trim();
  var authorEmail = (payload.author_email || "").trim();
  var authorBio = (payload.author_bio || "").trim();
  var authorLink = (payload.author_link || "").trim();
  var blurb = (payload.blurb || "").trim();
  var suggestedPrice = parseFloat(payload.suggested_price);
  var pdfStoragePath = payload.pdf_storage_path;
  var coverStoragePath = payload.cover_storage_path || null;

  if (!isNonEmptyString(title) || !isNonEmptyString(authorName) || !isNonEmptyString(authorEmail)) {
    return lib.json(400, { error: "Title, author name, and author email are required." });
  }
  if (!isNonEmptyString(pdfStoragePath)) {
    return lib.json(400, { error: "A manuscript PDF is required." });
  }
  if (!suggestedPrice || suggestedPrice <= 0) {
    return lib.json(400, { error: "A suggested price is required." });
  }

  try {
    var feeSetting = await lib.getAppSetting("book_review_fee_cents");
    var reviewFeeCents = parseInt(feeSetting, 10);
    if (!reviewFeeCents || reviewFeeCents <= 0) reviewFeeCents = 700; // fallback: $7

    var submissionRows = await lib.supabaseRest("/book_submissions", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: {
        title: title,
        author_name: authorName,
        author_email: authorEmail,
        author_bio: authorBio || null,
        author_link: authorLink || null,
        blurb: blurb || null,
        suggested_price_cents: Math.round(suggestedPrice * 100),
        pdf_storage_path: pdfStoragePath,
        cover_storage_path: coverStoragePath,
        review_fee_cents: reviewFeeCents,
        status: "awaiting_payment"
      }
    });
    var submission = submissionRows && submissionRows[0];
    if (!submission) throw new Error("Couldn't save your submission — please try again.");

    var siteUrl = process.env.SITE_URL || "https://ensemblefitness.com";

    var session = await lib.stripeRequest("checkout/sessions", {
      mode: "payment",
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: reviewFeeCents,
            product_data: {
              name: "Ensemble Reads review fee — \"" + title + "\"",
              description: "Refunded in full automatically if this book isn't accepted."
            }
          }
        }
      ],
      metadata: { type: "submission", submission_id: submission.id },
      customer_email: authorEmail,
      success_url: siteUrl + "/submit-book.html?submitted=success",
      cancel_url: siteUrl + "/submit-book.html?submitted=cancelled"
    });

    return lib.json(200, { url: session.url });
  } catch (err) {
    return lib.json(500, { error: err.message || "Something went wrong starting checkout." });
  }
};
