/* =========================================================================
   Report + Block — shared across every page that shows another member's
   content (feed, member profile, comments).
   -------------------------------------------------------------------------
   Two independent pieces:

   1. REPORT — inserts a row into public.reports. One shared modal handles
      all four target types (user / photo-or-video / comment / message);
      the caller just says which one via openReportModal(target).

   2. BLOCK — public.blocked_users, enforced server-side for messaging
      (see sql/reports-and-blocks.sql) and client-side everywhere else: a
      page loads the current member's block list once via loadBlockedIds(),
      then filters anything authored by a blocked id out of what it renders.

   Depends on window.sb (see supabaseClient.js) already being configured,
   and on the caller having called setModerationUser(currentUserId) once
   sign-in is confirmed. Include after supabaseClient.js:
     <script src="js/moderation.js"></script>
   ========================================================================= */

var moderationCurrentUserId = null;
var moderationBlockedIds = null; // Set of user ids the current member has blocked — null until loaded.
var moderationReportTarget = null;

function setModerationUser(userId) {
  moderationCurrentUserId = userId;
}

/* ---- Blocking ------------------------------------------------------------ */

/* Loads (and caches) the current member's block list. Call this once during
   a page's init(), after setModerationUser(), before rendering anything
   that needs to filter blocked members out. Safe to call more than once —
   later calls just refresh the cache. */
async function loadBlockedIds() {
  moderationBlockedIds = new Set();
  if (!moderationCurrentUserId) return moderationBlockedIds;
  var { data, error } = await window.sb
    .from("blocked_users")
    .select("blocked_id")
    .eq("blocker_id", moderationCurrentUserId);
  if (!error && data) {
    data.forEach(function (row) { moderationBlockedIds.add(row.blocked_id); });
  }
  return moderationBlockedIds;
}

function isBlocked(userId) {
  return !!(moderationBlockedIds && moderationBlockedIds.has(userId));
}

/* Filters an array of objects down to the ones NOT authored by a blocked
   member. Pass the property name that holds the author's user id (most
   feed/comment rows call it user_id; a couple call it something else). */
function filterOutBlocked(rows, userIdField) {
  if (!moderationBlockedIds || !moderationBlockedIds.size) return rows;
  var field = userIdField || "user_id";
  return (rows || []).filter(function (row) { return !moderationBlockedIds.has(row[field]); });
}

async function blockUser(userId) {
  if (!moderationCurrentUserId || userId === moderationCurrentUserId) return { error: "Can't block that member." };
  var { error } = await window.sb.from("blocked_users").insert({
    blocker_id: moderationCurrentUserId,
    blocked_id: userId
  });
  if (!error && moderationBlockedIds) moderationBlockedIds.add(userId);
  return { error: error ? (error.message || "Couldn't block that member.") : null };
}

async function unblockUser(userId) {
  if (!moderationCurrentUserId) return { error: "Not signed in." };
  var { error } = await window.sb
    .from("blocked_users")
    .delete()
    .eq("blocker_id", moderationCurrentUserId)
    .eq("blocked_id", userId);
  if (!error && moderationBlockedIds) moderationBlockedIds.delete(userId);
  return { error: error ? (error.message || "Couldn't unblock that member.") : null };
}

/* Wires a single button to toggle block state for one member, keeping its
   label/style in sync. Call once per button after the page knows whether
   that member is already blocked (i.e. after loadBlockedIds()).
     wireBlockButton(document.getElementById("blockBtn"), otherUserId, function () { ...refresh UI... }); */
function wireBlockButton(btn, otherUserId, onChange) {
  if (!btn) return;
  function render() {
    var blocked = isBlocked(otherUserId);
    btn.textContent = blocked ? "Unblock" : "Block";
    btn.classList.toggle("btn-danger", !blocked);
    btn.classList.toggle("btn-ghost", blocked);
  }
  render();
  btn.addEventListener("click", async function () {
    btn.disabled = true;
    var blocked = isBlocked(otherUserId);
    var result = blocked ? await unblockUser(otherUserId) : await blockUser(otherUserId);
    btn.disabled = false;
    if (result.error) {
      alert(result.error);
      return;
    }
    render();
    if (onChange) onChange(isBlocked(otherUserId));
  });
}

/* ---- Reporting ------------------------------------------------------------ */

var REPORT_REASONS = [
  "Spam",
  "Harassment or bullying",
  "Inappropriate content",
  "Impersonation",
  "Nudity or sexual content",
  "Other"
];

function injectReportModal() {
  if (document.getElementById("reportModalOverlay")) return;
  var wrap = document.createElement("div");
  var optionsHtml = REPORT_REASONS.map(function (r) { return '<option value="' + r + '">' + r + "</option>"; }).join("");
  wrap.innerHTML =
    '<div class="simple-modal-overlay" id="reportModalOverlay">' +
      '<div class="simple-modal">' +
        '<button type="button" class="simple-modal-close" id="reportModalClose" aria-label="Close">&times;</button>' +
        '<div class="eyebrow">Report</div>' +
        '<h3 id="reportModalTitle" style="margin-bottom:10px;">Report</h3>' +
        '<div class="report-target-preview" id="reportModalPreview"></div>' +
        '<div class="form-msg" id="reportModalMsg"></div>' +
        '<label for="reportReasonSelect">Reason</label>' +
        '<select id="reportReasonSelect">' + optionsHtml + "</select>" +
        '<label for="reportDetailsText">Anything else we should know? (optional)</label>' +
        '<textarea id="reportDetailsText" rows="3" maxlength="500" placeholder="Optional details"></textarea>' +
        '<button type="button" class="btn btn-primary btn-block" id="reportModalSendBtn" style="margin-top:12px;">Submit Report</button>' +
      "</div>" +
    "</div>";
  document.body.appendChild(wrap.firstChild);

  document.getElementById("reportModalClose").addEventListener("click", closeReportModal);
  document.getElementById("reportModalOverlay").addEventListener("click", function (e) {
    if (e.target.id === "reportModalOverlay") closeReportModal();
  });
  document.getElementById("reportModalSendBtn").addEventListener("click", submitReportFromModal);
}

/* target = { type: "user" | "media" | "comment" | "message", id: "<uuid>", label: "what to show in the modal" }
   e.g. openReportModal({ type: "user", id: otherUserId, label: "Jordan Reyes" })
        openReportModal({ type: "media", id: mediaId, label: "this photo" }) */
function openReportModal(target) {
  injectReportModal();
  moderationReportTarget = target;
  document.getElementById("reportModalTitle").textContent =
    target.type === "user" ? "Report this member" :
    target.type === "media" ? "Report this post" :
    target.type === "comment" ? "Report this comment" : "Report this message";
  document.getElementById("reportModalPreview").textContent = target.label || "";
  document.getElementById("reportReasonSelect").value = REPORT_REASONS[0];
  document.getElementById("reportDetailsText").value = "";
  var msg = document.getElementById("reportModalMsg");
  msg.className = "form-msg";
  document.getElementById("reportModalOverlay").classList.add("show");
  document.body.style.overflow = "hidden";
}

function closeReportModal() {
  var overlay = document.getElementById("reportModalOverlay");
  if (overlay) overlay.classList.remove("show");
  document.body.style.overflow = "";
}

async function submitReportFromModal() {
  var msg = document.getElementById("reportModalMsg");
  var btn = document.getElementById("reportModalSendBtn");
  if (!moderationCurrentUserId || !moderationReportTarget) {
    msg.textContent = "Something went wrong — please refresh and try again.";
    msg.className = "form-msg show error";
    return;
  }

  var row = {
    reporter_id: moderationCurrentUserId,
    reason: document.getElementById("reportReasonSelect").value,
    details: document.getElementById("reportDetailsText").value.trim() || null
  };
  var targetColumn = {
    user: "target_user_id",
    media: "target_media_id",
    comment: "target_comment_id",
    message: "target_message_id"
  }[moderationReportTarget.type];
  if (!targetColumn) {
    msg.textContent = "Something went wrong — please refresh and try again.";
    msg.className = "form-msg show error";
    return;
  }
  row[targetColumn] = moderationReportTarget.id;

  btn.disabled = true;
  btn.textContent = "Submitting…";

  var { error } = await window.sb.from("reports").insert(row);

  btn.disabled = false;
  btn.textContent = "Submit Report";

  if (error) {
    msg.textContent = "Couldn't submit that report — please try again.";
    msg.className = "form-msg show error";
    return;
  }

  msg.textContent = "Report submitted — thank you, our team will review it.";
  msg.className = "form-msg show success";
  setTimeout(closeReportModal, 1200);
}
