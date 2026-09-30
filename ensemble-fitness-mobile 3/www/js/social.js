// Shared "Message" helpers — a simple one-way note (not a two-way chat
// thread) that a member can send to another member, e.g. "Good job. Keep
// going." Used from the feed lightbox and from a member's profile page.
//
// Depends on window.sb (see supabaseClient.js) already being configured.
// Include this file on any page that shows a "Message" button, after
// config.js/supabaseClient.js:
//   <script src="js/social.js"></script>
// Then call setMessageSender(currentUserId) once you know who's signed in,
// and openMessageModal(recipientId, recipientName) from a button handler.

var messageModalSenderId = null;
var messageModalRecipientId = null;

function setMessageSender(userId) {
  messageModalSenderId = userId;
}

function injectMessageModal() {
  if (document.getElementById("messageModalOverlay")) return;
  var wrap = document.createElement("div");
  wrap.innerHTML =
    '<div class="simple-modal-overlay" id="messageModalOverlay">' +
      '<div class="simple-modal">' +
        '<button type="button" class="simple-modal-close" id="messageModalClose" aria-label="Close">&times;</button>' +
        '<div class="eyebrow">Send a Message</div>' +
        '<h3 id="messageModalTitle" style="margin-bottom:10px;">Message</h3>' +
        '<div class="form-msg" id="messageModalMsg"></div>' +
        '<textarea id="messageModalText" rows="4" maxlength="500" placeholder="Say something encouraging — e.g. &quot;Good job. Keep going.&quot;"></textarea>' +
        '<button type="button" class="btn btn-primary btn-block" id="messageModalSendBtn" style="margin-top:12px;">Send Message</button>' +
      "</div>" +
    "</div>";
  document.body.appendChild(wrap.firstChild);

  document.getElementById("messageModalClose").addEventListener("click", closeMessageModal);
  document.getElementById("messageModalOverlay").addEventListener("click", function (e) {
    if (e.target.id === "messageModalOverlay") closeMessageModal();
  });
  document.getElementById("messageModalSendBtn").addEventListener("click", sendMessageFromModal);
}

function openMessageModal(recipientId, recipientName) {
  injectMessageModal();
  messageModalRecipientId = recipientId;
  document.getElementById("messageModalTitle").textContent = "Message " + (recipientName || "this member");
  document.getElementById("messageModalText").value = "";
  var msg = document.getElementById("messageModalMsg");
  msg.className = "form-msg";
  document.getElementById("messageModalOverlay").classList.add("show");
  document.body.style.overflow = "hidden";
  setTimeout(function () {
    var textEl = document.getElementById("messageModalText");
    if (textEl) textEl.focus();
  }, 50);
}

function closeMessageModal() {
  var overlay = document.getElementById("messageModalOverlay");
  if (overlay) overlay.classList.remove("show");
  document.body.style.overflow = "";
}

async function sendMessageFromModal() {
  var textEl = document.getElementById("messageModalText");
  var msg = document.getElementById("messageModalMsg");
  var btn = document.getElementById("messageModalSendBtn");
  var body = textEl.value.trim();

  if (!body) {
    msg.textContent = "Type a quick message first.";
    msg.className = "form-msg show error";
    return;
  }
  if (!messageModalSenderId || !messageModalRecipientId) {
    msg.textContent = "Something went wrong — please refresh and try again.";
    msg.className = "form-msg show error";
    return;
  }

  btn.disabled = true;
  btn.textContent = "Sending…";

  var { error } = await window.sb.from("messages").insert({
    sender_id: messageModalSenderId,
    recipient_id: messageModalRecipientId,
    body: body
  });

  btn.disabled = false;
  btn.textContent = "Send Message";

  if (error) {
    msg.textContent = "Couldn't send that — please try again.";
    msg.className = "form-msg show error";
    return;
  }

  msg.textContent = "Sent!";
  msg.className = "form-msg show success";
  setTimeout(closeMessageModal, 900);
}
