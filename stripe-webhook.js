// The single Stripe webhook endpoint for both flows on this site: a book
// SALE (buyer paying for a published book) and a submission REVIEW FEE
// (an aspiring author paying to have their manuscript reviewed). Stripe
// calls this the moment a Checkout Session actually finishes — this is the
// ONLY place either a book_orders row or a "paid" submission gets created,
// so nobody can fake a purchase or a submission by just hitting these
// functions directly without actually paying Stripe.
//
// Set this function's URL as a webhook endpoint in the Stripe Dashboard
// (Developers → Webhooks → Add endpoint) listening for the
// "checkout.session.completed" event, and put its Signing secret in the
// STRIPE_WEBHOOK_SECRET environment variable — see BOOKS-SETUP.md.
var crypto = require("crypto");
var lib = require("./_lib");

function verifyStripeSignature(rawBody, signatureHeader, secret) {
  if (!signatureHeader) return false;
  var parts = signatureHeader.split(",").reduce(function (acc, part) {
    var kv = part.split("=");
    if (kv[0] === "t") acc.timestamp = kv[1];
    if (kv[0] === "v1") acc.signatures.push(kv[1]);
    return acc;
  }, { timestamp: null, signatures: [] });

  if (!parts.timestamp || parts.signatures.length === 0) return false;

  var expected = crypto
    .createHmac("sha256", secret)
    .update(parts.timestamp + "." + rawBody, "utf8")
    .digest("hex");

  return parts.signatures.some(function (sig) {
    try {
      return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
    } catch (e) {
      return false;
    }
  });
}

exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method not allowed" };
  }

  var rawBody = event.isBase64Encoded
    ? Buffer.from(event.body || "", "base64").toString("utf8")
    : (event.body || "");

  var signatureHeader = event.headers["stripe-signature"] || event.headers["Stripe-Signature"];
  // Stripe gives every webhook endpoint its OWN signing secret, and it keeps
  // "events on your account" (checkout.session.completed) and "events on
  // connected accounts" (account.updated — an artist finishing their bank
  // link) as two separate endpoints. Both can point at this same function;
  // each signs with its own secret, so accept either one. The second secret
  // is optional — until STRIPE_CONNECT_WEBHOOK_SECRET is set this behaves
  // exactly as before.
  var webhookSecrets = [process.env.STRIPE_WEBHOOK_SECRET, process.env.STRIPE_CONNECT_WEBHOOK_SECRET].filter(Boolean);
  var signatureOk = webhookSecrets.some(function (secret) {
    return verifyStripeSignature(rawBody, signatureHeader, secret);
  });

  if (!signatureOk) {
    return { statusCode: 400, body: "Invalid signature" };
  }

  var stripeEvent;
  try {
    stripeEvent = JSON.parse(rawBody);
  } catch (e) {
    return { statusCode: 400, body: "Invalid payload" };
  }

  try {
    if (stripeEvent.type === "checkout.session.completed") {
      var session = stripeEvent.data.object;
      var metadataType = session.metadata && session.metadata.type;
      if (metadataType === "sale") {
        await handleBookSale(session);
      } else if (metadataType === "submission") {
        await handleSubmissionPaid(session);
      } else if (metadataType === "wallet_topup") {
        await handleWalletTopup(session);
      } else if (metadataType === "fitness_plus") {
        await handleFitnessPlusSignup(session);
      }
    } else if (stripeEvent.type === "account.updated") {
      await handleConnectAccountUpdated(stripeEvent.data.object);
    } else {
      return { statusCode: 200, body: "Ignored (unhandled event type)" };
    }
    return { statusCode: 200, body: "ok" };
  } catch (err) {
    console.error(err);
    // Returning 500 tells Stripe to retry the webhook later, which is what
    // we want if something transient (like a DB hiccup) went wrong.
    return { statusCode: 500, body: "Webhook handler error" };
  }
};

// Fires whenever a connected creator's Stripe Express account changes —
// in particular, the moment they finish onboarding and Stripe turns on
// payouts. This is the ONLY place payouts_enabled gets set to true, so a
// creator can't be marked "linked" without Stripe actually confirming it.
// Register this event on the same webhook endpoint as checkout.session.completed
// (see STRIPE-CONNECT-SETUP.md) — Stripe sends both to the same URL.
async function handleConnectAccountUpdated(account) {
  var rows = await lib.supabaseRest(
    "/creator_payout_accounts?stripe_connect_account_id=eq." + encodeURIComponent(account.id) + "&select=id,payouts_enabled"
  );
  var row = rows && rows[0];
  if (!row) return; // some other platform's connected account — not ours

  var nowEnabled = !!account.payouts_enabled;
  if (nowEnabled === row.payouts_enabled) return; // no change, nothing to do

  await lib.supabaseRest("/creator_payout_accounts?id=eq." + encodeURIComponent(row.id), {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: { payouts_enabled: nowEnabled, updated_at: new Date().toISOString() }
  });

  // A creator who just finished onboarding might have book sales — or
  // music tips — sitting "blocked" from before they linked a bank. Pay
  // those out now instead of making them wait for the next sale/tip.
  if (nowEnabled) {
    var email = await lookupPayoutAccountEmail(account.id);
    if (email) {
      await payOutBlockedOrders(account.id, email);
      await payOutBlockedTips(account.id, email);
    }
  }
}

async function lookupPayoutAccountEmail(connectAccountId) {
  var accountRows = await lib.supabaseRest(
    "/creator_payout_accounts?stripe_connect_account_id=eq." + encodeURIComponent(connectAccountId) + "&select=email"
  );
  return accountRows && accountRows[0] && accountRows[0].email;
}

async function payOutBlockedOrders(connectAccountId, email) {
  var books = await lib.supabaseRest("/books?author_email=eq." + encodeURIComponent(email) + "&select=id");
  var bookIds = (books || []).map(function (b) { return b.id; });
  if (bookIds.length === 0) return;

  var orFilter = "(" + bookIds.map(function (id) { return "book_id.eq." + id; }).join(",") + ")";
  var blockedOrders = await lib.supabaseRest(
    "/book_orders?payout_status=eq.blocked&or=" + orFilter + "&select=id,author_payout_cents"
  );

  for (var i = 0; i < (blockedOrders || []).length; i++) {
    await transferOrderPayout(blockedOrders[i].id, blockedOrders[i].author_payout_cents, connectAccountId);
  }
}

// Same idea as payOutBlockedOrders, but for tips sitting against this
// artist's tracks instead of book sales.
async function payOutBlockedTips(connectAccountId, email) {
  var tracks = await lib.supabaseRest("/tracks?artist_email=eq." + encodeURIComponent(email) + "&select=id");
  var trackIds = (tracks || []).map(function (t) { return t.id; });
  if (trackIds.length === 0) return;

  var orFilter = "(" + trackIds.map(function (id) { return "track_id.eq." + id; }).join(",") + ")";
  var blockedTips = await lib.supabaseRest(
    "/wallet_transactions?type=eq.tip&payout_status=eq.blocked&or=" + orFilter + "&select=id,amount_cents,track_id"
  );

  for (var i = 0; i < (blockedTips || []).length; i++) {
    await transferTipPayout(blockedTips[i].id, blockedTips[i].amount_cents, blockedTips[i].track_id, connectAccountId);
  }
}

async function transferTipPayout(tipId, amountCents, trackId, connectAccountId) {
  try {
    var transfer = await lib.stripeRequest("transfers", {
      amount: amountCents,
      currency: "usd",
      destination: connectAccountId,
      transfer_group: "tip_track_" + trackId
    });
    await lib.supabaseRest("/wallet_transactions?id=eq." + encodeURIComponent(tipId), {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: { payout_status: "paid", stripe_transfer_id: transfer.id, paid_out_at: new Date().toISOString() }
    });
  } catch (err) {
    console.error("Tip transfer failed for wallet_transactions " + tipId + ": " + err.message);
    // This is the retroactive payout an artist's blocked tips get the
    // moment they finish linking their bank (see handleConnectAccountUpdated
    // above) — if it fails too, that's a second silent failure on top of
    // the original one, so it gets the same admin alert as every other
    // transfer failure below rather than only living in function logs.
    await notifyAdminOfTransferFailure(
      "Retry payout failed — tip " + tipId,
      "A blocked tip (wallet_transactions id " + tipId + ", $" + (amountCents / 100).toFixed(2) + ") was retried " +
        "right after the artist finished linking their bank, but the Stripe transfer failed again:\n\n" + err.message
    ).catch(function () {});
  }
}

async function transferOrderPayout(orderId, amountCents, connectAccountId) {
  try {
    var transfer = await lib.stripeRequest("transfers", {
      amount: amountCents,
      currency: "usd",
      destination: connectAccountId,
      transfer_group: "book_order_" + orderId
    });
    await lib.supabaseRest("/book_orders?id=eq." + encodeURIComponent(orderId), {
      method: "PATCH",
      headers: { Prefer: "return=minimal" },
      body: { payout_status: "paid", stripe_transfer_id: transfer.id, paid_out_at: new Date().toISOString() }
    });
  } catch (err) {
    // Leave it as unpaid/blocked — admin.html still shows it and you (or
    // the next webhook retry) can sort it out by hand if a transfer keeps
    // failing (e.g. the connected account has restrictions on it).
    console.error("Transfer failed for order " + orderId + ": " + err.message);
    await notifyAdminOfTransferFailure(
      "Retry payout failed — order " + orderId,
      "A blocked book order (id " + orderId + ", $" + (amountCents / 100).toFixed(2) + ") was retried right after " +
        "the author finished linking their bank, but the Stripe transfer failed again:\n\n" + err.message
    ).catch(function () {});
  }
}

// Shared by every transfer call site in this file (and mirrored in
// tip-track.js for the immediate, non-webhook payout path) — one place a
// failed artist/author payout gets emailed to you instead of only ever
// showing up if someone happens to check function logs or admin.html's
// payout badges. Uses the same "notify_email" app setting as the existing
// new-sale alert below, so there's nothing new to configure.
async function notifyAdminOfTransferFailure(subject, detail) {
  var notifyTo = await lib.getAppSetting("notify_email");
  if (!notifyTo) return;
  await lib.sendEmail(notifyTo, "⚠️ " + subject, detail);
}

async function handleBookSale(session) {
  // Idempotency: Stripe can send the same event more than once. If we've
  // already recorded this session, don't email the buyer twice.
  var existing = await lib.supabaseRest(
    "/book_orders?stripe_session_id=eq." + encodeURIComponent(session.id) + "&select=id"
  );
  if (existing && existing.length > 0) return;

  var bookId = session.metadata.book_id;
  var books = await lib.supabaseRest("/books?id=eq." + encodeURIComponent(bookId) + "&select=id,title,author_name,author_email,pdf_storage_path");
  var book = books && books[0];
  if (!book) throw new Error("Sale webhook: book " + bookId + " not found");

  var amountCents = session.amount_total;
  var authorPayoutCents = Math.round(amountCents * 0.75);
  var platformFeeCents = amountCents - authorPayoutCents;
  var buyerEmail = (session.customer_details && session.customer_details.email) || session.customer_email;

  // Does this author have a bank account linked yet? If so, pay them
  // immediately via a Stripe Transfer; if not, the order sits "blocked"
  // until they complete setup (handleConnectAccountUpdated pays it out
  // retroactively the moment they do).
  var payoutStatus = "blocked";
  var stripeTransferId = null;
  var paidOutAt = null;

  var payoutAccounts = await lib.supabaseRest(
    "/creator_payout_accounts?email=eq." + encodeURIComponent(book.author_email) + "&select=stripe_connect_account_id,payouts_enabled"
  );
  var payoutAccount = payoutAccounts && payoutAccounts[0];

  if (payoutAccount && payoutAccount.payouts_enabled && payoutAccount.stripe_connect_account_id) {
    try {
      var transfer = await lib.stripeRequest("transfers", {
        amount: authorPayoutCents,
        currency: "usd",
        destination: payoutAccount.stripe_connect_account_id,
        transfer_group: "book_order_" + session.id
      });
      payoutStatus = "paid";
      stripeTransferId = transfer.id;
      paidOutAt = new Date().toISOString();
    } catch (transferErr) {
      console.error("Transfer failed for session " + session.id + ": " + transferErr.message);
      payoutStatus = "unpaid"; // linked, but the transfer itself failed — surface for manual follow-up, not "no bank on file"
      await notifyAdminOfTransferFailure(
        "Payout failed — " + book.author_name,
        "A $" + (authorPayoutCents / 100).toFixed(2) + " payout for the sale of \"" + book.title + "\" to " + buyerEmail +
          " was supposed to go to " + book.author_name + " (" + book.author_email + "), but the Stripe transfer failed:\n\n" +
          transferErr.message
      ).catch(function () {});
    }
  }

  await lib.supabaseRest("/book_orders", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: {
      book_id: book.id,
      stripe_session_id: session.id,
      buyer_email: buyerEmail,
      amount_cents: amountCents,
      author_payout_cents: authorPayoutCents,
      platform_fee_cents: platformFeeCents,
      payout_status: payoutStatus,
      stripe_transfer_id: stripeTransferId,
      paid_out_at: paidOutAt
    }
  });

  var downloadUrl = await lib.signStorageUrl("books", book.pdf_storage_path, 7 * 24 * 60 * 60);

  await lib.sendEmail(
    buyerEmail,
    "Your download: " + book.title,
    "Thanks so much for supporting an independent author on Ensemble Fitness!\n\n" +
      "Here's your download link for \"" + book.title + "\" by " + book.author_name + " (valid for 7 days):\n" +
      downloadUrl + "\n\n" +
      "Enjoy, and thanks for backing independent creators,\n" +
      "The Ensemble Fitness Team"
  );

  var notifyTo = await lib.getAppSetting("notify_email");
  if (notifyTo) {
    await lib.sendEmail(
      notifyTo,
      "New Ensemble Reads sale — " + book.title,
      "$" + (amountCents / 100).toFixed(2) + " sale of \"" + book.title + "\" by " + book.author_name + ".\n" +
        "Author is owed $" + (authorPayoutCents / 100).toFixed(2) + " — see Book Sales & Payouts in the Review Queue."
    );
  }
}

async function handleSubmissionPaid(session) {
  var submissionId = session.metadata.submission_id;
  var submissions = await lib.supabaseRest(
    "/book_submissions?id=eq." + encodeURIComponent(submissionId) + "&select=id,status"
  );
  var submission = submissions && submissions[0];
  if (!submission) throw new Error("Submission webhook: submission " + submissionId + " not found");
  if (submission.status !== "awaiting_payment") return; // already processed — avoid double-notifying

  await lib.supabaseRest("/book_submissions?id=eq." + encodeURIComponent(submissionId), {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: {
      status: "pending",
      stripe_payment_intent_id: session.payment_intent
    }
  });
  // The admin "new submission" email is sent by a database trigger that
  // fires on this exact status change — see notify_new_book_submission()
  // in the schema. Nothing else to do here.
}

// A member's wallet top-up finished paying. Credit their balance and log
// the ledger row — this is the ONLY place a wallet balance goes up, so a
// member can't grant themselves tipping funds without actually paying.
async function handleWalletTopup(session) {
  // Idempotency: Stripe can send the same event more than once.
  var existing = await lib.supabaseRest(
    "/wallet_transactions?stripe_session_id=eq." + encodeURIComponent(session.id) + "&select=id"
  );
  if (existing && existing.length > 0) return;

  var profileId = session.metadata.profile_id;
  var amountCents = session.amount_total;
  if (!profileId || !amountCents) throw new Error("Wallet top-up webhook: missing profile_id/amount on session " + session.id);

  await lib.rpc("credit_wallet", { p_profile_id: profileId, p_amount_cents: amountCents });

  await lib.supabaseRest("/wallet_transactions", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: {
      profile_id: profileId,
      type: "topup",
      amount_cents: amountCents,
      stripe_session_id: session.id
    }
  });

  var buyerEmail = (session.customer_details && session.customer_details.email) || session.customer_email;
  if (buyerEmail) {
    await lib.sendEmail(
      buyerEmail,
      "You added $" + (amountCents / 100).toFixed(2) + " to your Ensemble Fitness wallet",
      "Thanks! $" + (amountCents / 100).toFixed(2) + " is ready in your wallet — head over to the Music Library " +
        "any time to support an independent artist whose track you enjoy.\n\n" +
        "The Ensemble Fitness Team"
    );
  }
}

// Oct 2026, Ken's ask: require height specifically for Fitness+ (the dating
// side of the app), not for general charter-member sign-up. Fitness+ is
// sold through a Stripe Payment Link (fitness-plus.html's "Get the Founding
// Rate" button), not a Checkout Session this codebase creates itself — so
// this is the ONLY place a Fitness+ purchase actually reaches the app at
// all right now. Two things happen here: (1) the buyer gets flagged as an
// active Fitness+ member for the first time, and (2) their height — a
// custom field configured directly on the Payment Link in the Stripe
// Dashboard, no code involved in collecting it — gets parsed and saved to
// their profile. Two one-time settings on the Payment Link itself, done by
// hand in the Stripe Dashboard (no code):
//   1. Advanced options → Metadata → add a key "type" with value
//      "fitness_plus", so this dispatches the same clean way every other
//      checkout type here does.
//   2. Advanced options → Collect additional information → Custom fields
//      → add a required field for height (a dropdown with options like
//      5'0", 5'1", ... works well) so extractHeightFromCustomFields below
//      has something to read.
async function handleFitnessPlusSignup(session) {
  var email = (session.customer_details && session.customer_details.email) || session.customer_email;
  if (!email) {
    await notifyAdminOfTransferFailure(
      "Fitness+ signup couldn't be matched to a member",
      "A Fitness+ payment came through (session " + session.id + ") with no email on the checkout session at all, " +
        "so there's nothing to match it to a member account with. This needs a manual look in Stripe."
    ).catch(function () {});
    return;
  }

  var userId = await lib.getUserIdByEmail(email);
  if (!userId) {
    await notifyAdminOfTransferFailure(
      "Fitness+ signup couldn't be matched to a member",
      email + " just paid for Fitness+ (session " + session.id + "), but there's no Ensemble Fitness member account " +
        "with that email — they may have used a different email at checkout than the one they signed up with. " +
        "Their subscription is real and active in Stripe; they just need to be linked up by hand, or asked to " +
        "re-checkout with their member email."
    ).catch(function () {});
    return;
  }

  var heightInches = extractHeightFromCustomFields(session.custom_fields);

  var updates = {
    fitness_plus_active: true,
    fitness_plus_started_at: new Date().toISOString()
  };
  if (heightInches) updates.height_inches = heightInches;

  await lib.supabaseRest("/profiles?id=eq." + encodeURIComponent(userId), {
    method: "PATCH",
    headers: { Prefer: "return=minimal" },
    body: updates
  });

  if (!heightInches) {
    await notifyAdminOfTransferFailure(
      "Fitness+ signup — height couldn't be read",
      email + " just paid for Fitness+ (session " + session.id + ") and is now marked active, but their height " +
        "answer on the payment page couldn't be understood as a height, so it wasn't saved. Worth checking the " +
        "raw answer in Stripe (Payments → this session → additional details) and adding it to their profile by hand."
    ).catch(function () {});
  }
}

// Looks for whichever custom field on the Payment Link is the height
// question (matched by its label or key containing "height", rather than
// assuming an exact spelling — Stripe auto-generates the field's "key" from
// whatever label text is typed into the Dashboard, so this doesn't rely on
// getting that exact slug right).
function extractHeightFromCustomFields(customFields) {
  if (!Array.isArray(customFields)) return null;
  var field = customFields.find(function (f) {
    var labelText = (f.label && (f.label.custom || f.label.text)) || "";
    return (f.key && f.key.toLowerCase().indexOf("height") !== -1) ||
      (typeof labelText === "string" && labelText.toLowerCase().indexOf("height") !== -1);
  });
  if (!field) return null;

  var raw =
    (field.dropdown && field.dropdown.value) ||
    (field.text && field.text.value) ||
    (field.numeric && field.numeric.value);

  return parseHeightToInches(raw);
}

// Confirmed by pulling the actual raw webhook event for a real test
// purchase (Sep 27, 2026): when a dropdown option's label has punctuation
// Stripe can't put in an internal value (apostrophes, quote marks, spaces,
// dashes), Stripe silently strips ALL of that out to build the "value" it
// actually sends — so the option labeled "5'2\"-5'3\"" arrives here as the
// plain string "5253", "Under 5'0\"" arrives as "under50", and "6'4\" and Up"
// arrives as "64andup". That's a different shape than a display label, so a
// regex built around apostrophes/dashes (like the one below) never matches
// it — which is exactly why every real signup was saving height as null.
// This table is a direct, confirmed mapping from those exact values (as
// configured on the live Fitness+ Payment Link right now) to one
// representative number of inches per bucket, using each range's lower
// bound. If the dropdown's options are ever edited in the Stripe Dashboard,
// grab a fresh test event's custom_fields (Developers -> Webhooks -> this
// endpoint -> Events) and update this table to match.
var HEIGHT_OPTION_TO_INCHES = {
  under50: 59,    // "Under 5'0""
  "5051": 60,     // "5'0"-5'1""
  "5253": 62,     // "5'2"-5'3""
  "5455": 64,     // "5'4"-5'5""
  "5657": 66,     // "5'6"-5'7""
  "5859": 68,     // "5'8"-5'9""
  "510511": 70,   // "5'10"-5'11""
  "6061": 72,     // "6'0"-6'1""
  "6263": 74,     // "6'2"-6'3""
  "64andup": 76   // "6'4" and Up"
};

// Checks the confirmed lookup table above first (the normal path for every
// real signup through the current dropdown), then falls back to a looser,
// best-effort parse for anything else — a plain already-in-inches number, or
// a value that does still contain a recognizable separator. Returns null
// (rather than a wrong guess) for anything it can't confidently parse — the
// caller alerts an admin when that happens so it gets a human's attention
// instead of silently saving nothing.
function parseHeightToInches(raw) {
  if (raw === null || raw === undefined) return null;
  var s = String(raw).trim();
  if (!s) return null;

  var mapped = HEIGHT_OPTION_TO_INCHES[s.toLowerCase()];
  if (mapped) return mapped;

  if (/^\d{2,3}$/.test(s)) {
    var direct = parseInt(s, 10);
    if (direct >= 36 && direct <= 96) return direct;
  }

  var m = s.match(/(\d)\s*(?:'|ft|-|_)\s*(\d{1,2})/i);
  if (m) {
    var total = parseInt(m[1], 10) * 12 + parseInt(m[2], 10);
    if (total >= 36 && total <= 96) return total;
  }

  return null;
}
