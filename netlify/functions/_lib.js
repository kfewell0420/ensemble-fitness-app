// Shared helpers for the Ensemble Reads Netlify Functions. Plain Node, no
// npm dependencies on purpose — that way this whole site (including these
// functions) can keep deploying as a single drag-and-drop zip to Netlify,
// exactly like it always has, with nothing to "npm install" first.
//
// Required environment variables (set these in Netlify → Site settings →
// Environment variables, NOT in this file):
//   SUPABASE_URL                — e.g. https://xxxx.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY   — Supabase → Settings → API → service_role key
//                                  (this bypasses RLS — never expose it to a
//                                  browser, it only ever lives here)
//   STRIPE_SECRET_KEY           — Stripe → Developers → API keys → Secret key
//   STRIPE_WEBHOOK_SECRET       — Stripe → Developers → Webhooks → (your
//                                  endpoint) → Signing secret
//   SITE_URL                    — https://ensemblefitness.com

function supabaseUrl() {
  return String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
}

function serviceHeaders(extra) {
  var key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return Object.assign(
    {
      apikey: key,
      Authorization: "Bearer " + key,
      "Content-Type": "application/json"
    },
    extra || {}
  );
}

// Thin wrapper around Supabase's PostgREST API using the service role key,
// which bypasses every RLS policy — this is how these server-side functions
// are allowed to do things no browser client is allowed to do directly.
async function supabaseRest(path, options) {
  options = options || {};
  var res = await fetch(supabaseUrl() + "/rest/v1" + path, {
    method: options.method || "GET",
    headers: serviceHeaders(options.headers),
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  if (!res.ok) {
    var text = await res.text().catch(function () { return ""; });
    throw new Error("Supabase REST " + options.method + " " + path + " failed (" + res.status + "): " + text);
  }
  var contentLength = res.headers.get("content-length");
  if (contentLength === "0") return null;
  return res.json().catch(function () { return null; });
}

async function getAppSetting(key) {
  var rows = await supabaseRest("/app_settings?key=eq." + encodeURIComponent(key) + "&select=value");
  return rows && rows[0] ? rows[0].value : null;
}

// Creates a short-lived signed download URL for a private storage object.
async function signStorageUrl(bucket, path, expiresInSeconds) {
  var res = await fetch(
    supabaseUrl() + "/storage/v1/object/sign/" + bucket + "/" + path,
    {
      method: "POST",
      headers: serviceHeaders(),
      body: JSON.stringify({ expiresIn: expiresInSeconds || 604800 })
    }
  );
  if (!res.ok) {
    var text = await res.text().catch(function () { return ""; });
    throw new Error("Couldn't sign storage URL for " + bucket + "/" + path + ": " + text);
  }
  var data = await res.json();
  return supabaseUrl() + "/storage/v1" + data.signedURL;
}

// Verifies a Supabase access token (from the Authorization header of an
// admin.html request) belongs to a real, logged-in admin. Used by any
// function that needs to trust "this call really came from an admin" —
// e.g. issuing a refund.
async function verifyAdmin(authHeader) {
  var token = (authHeader || "").replace(/^Bearer\s+/i, "");
  if (!token) return null;

  var userRes = await fetch(supabaseUrl() + "/auth/v1/user", {
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: "Bearer " + token
    }
  });
  if (!userRes.ok) return null;
  var user = await userRes.json();
  if (!user || !user.id) return null;

  var adminRows = await supabaseRest("/admins?user_id=eq." + encodeURIComponent(user.id) + "&select=user_id");
  if (!adminRows || adminRows.length === 0) return null;
  return user;
}

// Like verifyAdmin, but for "is this a real signed-in member at all" rather
// than "is this an admin" — used by the payout endpoints, since any member
// (not just admins) needs to manage their own payout setup.
async function getAuthedUser(authHeader) {
  var token = (authHeader || "").replace(/^Bearer\s+/i, "");
  if (!token) return null;

  var userRes = await fetch(supabaseUrl() + "/auth/v1/user", {
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: "Bearer " + token
    }
  });
  if (!userRes.ok) return null;
  var user = await userRes.json();
  if (!user || !user.id || !user.email) return null;
  return user;
}

// Stripe's REST API only reliably accepts classic form-encoded bodies (its
// documented, guaranteed format for over a decade) — so this always posts
// application/x-www-form-urlencoded, never JSON, using Stripe's bracket
// syntax for nested fields (e.g. "line_items[0][quantity]").
function toFormBody(obj, prefix, out) {
  out = out || [];
  Object.keys(obj).forEach(function (key) {
    var value = obj[key];
    var field = prefix ? prefix + "[" + key + "]" : key;
    if (value === undefined || value === null) return;
    if (typeof value === "object" && !Array.isArray(value)) {
      toFormBody(value, field, out);
    } else if (Array.isArray(value)) {
      value.forEach(function (item, i) {
        if (item && typeof item === "object") {
          toFormBody(item, field + "[" + i + "]", out);
        } else {
          out.push(encodeURIComponent(field + "[" + i + "]") + "=" + encodeURIComponent(item));
        }
      });
    } else {
      out.push(encodeURIComponent(field) + "=" + encodeURIComponent(value));
    }
  });
  return out;
}

async function stripeRequest(endpoint, params) {
  var body = toFormBody(params).join("&");
  var res = await fetch("https://api.stripe.com/v1/" + endpoint, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(process.env.STRIPE_SECRET_KEY + ":").toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: body
  });
  var data = await res.json().catch(function () { return {}; });
  if (!res.ok) {
    throw new Error("Stripe " + endpoint + " failed: " + (data.error ? data.error.message : res.status));
  }
  return data;
}

// Calls a Postgres function (an RPC) exposed via Supabase's PostgREST API,
// using the service role key. Used for the handful of operations — moving
// money between a wallet and a tip, incrementing a track's tip counters —
// that need to happen as one atomic statement in the database rather than
// a read-then-write from JS, which could race under concurrent requests.
async function rpc(fn, args) {
  var res = await fetch(supabaseUrl() + "/rest/v1/rpc/" + fn, {
    method: "POST",
    headers: serviceHeaders(),
    body: JSON.stringify(args || {})
  });
  if (!res.ok) {
    var text = await res.text().catch(function () { return ""; });
    throw new Error("Supabase RPC " + fn + " failed (" + res.status + "): " + text);
  }
  var contentLength = res.headers.get("content-length");
  if (contentLength === "0") return null;
  return res.json().catch(function () { return null; });
}

async function sendEmail(to, subject, text) {
  var apiKey = await getAppSetting("resend_api_key");
  var fromAddr = await getAppSetting("resend_from");
  if (!apiKey || apiKey === "PASTE_YOUR_RESEND_API_KEY_HERE") return; // not configured yet — skip silently

  await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + apiKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ from: fromAddr, to: to, subject: subject, text: text })
  });
}

// admin.html lives on app.ensemblefitness.com, a different origin from where
// these functions are deployed (ensemblefitness.com) — so the one function
// admin.html calls directly (refund-submission) needs CORS headers and to
// answer the browser's OPTIONS preflight request. The public-site pages
// (books.html, submit-book.html) call these functions same-origin and
// don't strictly need this, but it's harmless to include everywhere.
// Allow-Origin is "*" (not a specific hardcoded domain) since the caller
// never sends cookies/credentials — just a Bearer token — so this stays
// correct through any future domain change without needing another edit.
var CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};

function handlePreflight(event) {
  if (event.httpMethod === "OPTIONS") {
    return { statusCode: 204, headers: CORS_HEADERS, body: "" };
  }
  return null;
}

function json(statusCode, body) {
  return {
    statusCode: statusCode,
    headers: Object.assign({ "Content-Type": "application/json" }, CORS_HEADERS),
    body: JSON.stringify(body)
  };
}

module.exports = {
  supabaseUrl: supabaseUrl,
  serviceHeaders: serviceHeaders,
  supabaseRest: supabaseRest,
  getAppSetting: getAppSetting,
  signStorageUrl: signStorageUrl,
  verifyAdmin: verifyAdmin,
  getAuthedUser: getAuthedUser,
  stripeRequest: stripeRequest,
  rpc: rpc,
  sendEmail: sendEmail,
  json: json,
  handlePreflight: handlePreflight
};
