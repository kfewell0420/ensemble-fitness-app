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
  var webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!verifyStripeSignature(rawBody, signatureHeader, webhookSecret)) {
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
  }
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
