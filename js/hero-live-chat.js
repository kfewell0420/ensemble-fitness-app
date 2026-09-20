/* =========================================================================
   Hero "Share Your Journey" widget (homepage) — a small community box that
   sits above the phone floater. Posting, replying, and reacting all require
   a real, signed-in Ensemble Fitness member — no anonymous strangers. A
   member's post publishes instantly (no admin approval wait); an admin can
   still delete a post afterward from admin.html if something inappropriate
   gets shared. Stories are marked with an orange dot, replies with a blue
   dot and the real member's name.

   Reactions (👏 clap / ❤️ heart / 👍 thumbs up) give people quick, one-tap
   encouragement — "instant validation" that doesn't require writing a full
   reply. Posting, replying, and reacting are all enforced server-side by
   RLS as auth.uid() = user_id (see sql/schema.sql sections 6, 6b, and 6c),
   so this widget includes a compact inline sign-in form that appears
   exactly when it's needed — as the default view for a signed-out visitor,
   or mid-reply/react if their session has lapsed. A visitor who isn't a
   member yet is shown a "Create a member account" link instead of a
   compose box.

   New stories also (optionally) trigger an email to the site owner — see
   sql/schema.sql section 7 for how that's wired up.

   NOTE: sql/schema.sql was restructured for this — community_questions
   dropped its old answer_text/answered_at/answered_by columns, gained a
   user_id column and a status of 'pending' | 'approved' | 'rejected'
   (posts insert directly as 'approved' now), and new story_replies and
   story_reactions tables were added. The full schema.sql needs to be
   re-run in Supabase's SQL editor for this widget to work.
   ========================================================================= */
(function () {
  var SUPABASE_URL = "https://wgrldwdgvvlhcmlyoxrl.supabase.co";
  var SUPABASE_ANON_KEY = "sb_publishable_4sbGE70Sh5gkgpmBqdGVBg_VkqjzJVx";
  var MAX_SHOWN = 6;
  var REFRESH_MS = 45000;
  var REACTIONS = [
    { key: "clap", icon: "👏" },
    { key: "heart", icon: "❤️" },
    { key: "thumbs_up", icon: "👍" }
  ];

  if (!window.supabase) return; // CDN didn't load — the widget just stays on its empty state.
  var sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // pendingAction is set whenever the visitor tried to reply or react but
  // isn't signed in yet — it's what to do once they sign in via the inline
  // form. { type: "reply", id, name } or { type: "react", id, reaction }.
  var pendingAction = null;
  var hasSession = false;
  var myUserId = null;

  function escapeHtml(str) {
    var div = document.createElement("div");
    div.textContent = str == null ? "" : str;
    return div.innerHTML;
  }

  function reactionCounts(reactions) {
    var counts = { clap: 0, heart: 0, thumbs_up: 0 };
    var mine = { clap: false, heart: false, thumbs_up: false };
    (reactions || []).forEach(function (r) {
      if (counts.hasOwnProperty(r.reaction)) counts[r.reaction]++;
      if (myUserId && r.user_id === myUserId) mine[r.reaction] = true;
    });
    return { counts: counts, mine: mine };
  }

  function renderMessages(rows, body) {
    if (!rows || rows.length === 0) {
      body.innerHTML = '<div class="hero-live-chat-empty">Share something from your fitness journey — a win, a struggle, a question — and the community replies. <span style="color:#ff5a1f;">●</span> orange = a story, <span style="color:#1d4ed8;">●</span> blue = a reply.</div>';
      return;
    }
    var html = "";
    rows.forEach(function (row) {
      var name = escapeHtml(row.asker_name || "A member");
      html += '<div class="hero-live-chat-msg story"><span class="dot"></span><span>' +
        '<span class="who">' + name + '</span>' + escapeHtml(row.question_text) +
        '<button type="button" class="reply-link" data-story-id="' + row.id + '" data-story-name="' + name + '">Reply</button>' +
        '</span></div>';

      var rc = reactionCounts(row.story_reactions);
      html += '<div class="hero-live-chat-reactions" data-story-id="' + row.id + '">';
      REACTIONS.forEach(function (r) {
        var active = rc.mine[r.key];
        html += '<button type="button" class="reaction-btn' + (active ? ' active' : '') + '" data-story-id="' + row.id + '" data-reaction="' + r.key + '" data-active="' + (active ? "1" : "0") + '">' + r.icon + ' <span>' + rc.counts[r.key] + '</span></button>';
      });
      html += '</div>';

      (row.story_replies || []).forEach(function (reply) {
        var replyName = escapeHtml((reply.profiles && reply.profiles.display_name) || "A member");
        html += '<div class="hero-live-chat-msg reply"><span class="dot"></span><span><span class="who">' + replyName + '</span>' + escapeHtml(reply.reply_text) + '</span></div>';
      });
    });
    body.innerHTML = html;
    body.scrollTop = body.scrollHeight;
  }

  async function loadStories(body) {
    try {
      var { data, error } = await sb
        .from("community_questions")
        .select("id, asker_name, question_text, created_at, story_replies(id, reply_text, created_at, profiles(display_name)), story_reactions(reaction, user_id)")
        .eq("status", "approved")
        .order("created_at", { ascending: false })
        .order("created_at", { ascending: true, foreignTable: "story_replies" })
        .limit(MAX_SHOWN);
      if (error || !data) return;
      renderMessages(data.slice().reverse(), body);
    } catch (err) {
      // Network hiccup — leave whatever is currently shown as-is.
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    var widget = document.getElementById("heroLiveChat");
    var body = document.getElementById("heroLiveChatBody");
    var form = document.getElementById("heroLiveChatForm");
    var input = document.getElementById("heroLiveChatInput");
    var replyBar = document.getElementById("heroLiveChatReplyBar");
    var replyBarText = document.getElementById("heroLiveChatReplyBarText");
    var cancelBtn = document.getElementById("heroLiveChatCancelReply");
    var authForm = document.getElementById("heroLiveChatAuthForm");
    var authEmail = document.getElementById("heroLiveChatAuthEmail");
    var authPassword = document.getElementById("heroLiveChatAuthPassword");
    var authError = document.getElementById("heroLiveChatAuthError");
    var postStatus = document.getElementById("heroLiveChatPostStatus");
    if (!widget || !body || !form || !input) return;

    function showPostStatus(message, isError) {
      if (!postStatus) return;
      postStatus.textContent = message;
      postStatus.className = "hero-live-chat-poststatus" + (isError ? " is-error" : "");
      postStatus.style.display = "block";
    }

    function clearPostStatus() {
      if (!postStatus) return;
      postStatus.style.display = "none";
    }

    input.addEventListener("input", clearPostStatus);

    sb.auth.getSession().then(function (res) {
      var session = res && res.data && res.data.session;
      hasSession = !!session;
      myUserId = session ? session.user.id : null;
      refreshFormMode();
    });

    sb.auth.onAuthStateChange(async function (_event, session) {
      hasSession = !!session;
      myUserId = session ? session.user.id : null;
      if (hasSession && authError) authError.textContent = "";

      if (hasSession && pendingAction && pendingAction.type === "react") {
        await sendReaction(pendingAction.id, pendingAction.reaction, false);
        pendingAction = null;
        await loadStories(body);
      }
      refreshFormMode();
    });

    function refreshFormMode() {
      // mode: "post" (default, signed in), "signin" (default, signed out),
      // "reply", or "react" (the latter two only while pendingAction is set).
      var mode = pendingAction ? pendingAction.type : (hasSession ? "post" : "signin");

      if (replyBar) {
        replyBar.style.display = (mode === "signin" || mode === "reply" || mode === "react") ? "flex" : "none";
        if (cancelBtn) cancelBtn.style.display = pendingAction ? "inline" : "none";
      }
      if (replyBarText) {
        if (mode === "signin") replyBarText.textContent = "Sign in to share your journey";
        else if (mode === "reply") replyBarText.textContent = "Replying to " + pendingAction.name + "'s story";
        else if (mode === "react") replyBarText.textContent = "Sign in to react";
      }

      if (mode === "post") {
        if (authForm) authForm.style.display = "none";
        form.style.display = "flex";
        input.placeholder = "Share your journey…";
      } else if (mode === "signin" || mode === "react") {
        form.style.display = "none";
        if (authForm) authForm.style.display = "flex";
      } else if (mode === "reply") {
        if (hasSession) {
          if (authForm) authForm.style.display = "none";
          form.style.display = "flex";
          input.placeholder = "Write a reply…";
        } else {
          form.style.display = "none";
          if (authForm) authForm.style.display = "flex";
        }
      }
    }

    function exitPendingAction() {
      pendingAction = null;
      input.value = "";
      refreshFormMode();
    }

    if (cancelBtn) {
      cancelBtn.addEventListener("click", function () {
        exitPendingAction();
      });
    }

    async function sendReaction(storyId, reaction, currentlyActive) {
      try {
        if (currentlyActive) {
          await sb.from("story_reactions").delete()
            .eq("question_id", storyId)
            .eq("user_id", myUserId)
            .eq("reaction", reaction);
        } else {
          await sb.from("story_reactions").insert({
            question_id: storyId,
            user_id: myUserId,
            reaction: reaction
          });
        }
      } catch (err) {
        // Swallow — a failed reaction toggle just leaves the count as-is.
      }
    }

    body.addEventListener("click", async function (e) {
      var replyBtn = e.target.closest(".reply-link");
      if (replyBtn) {
        clearPostStatus();
        pendingAction = { type: "reply", id: replyBtn.getAttribute("data-story-id"), name: replyBtn.getAttribute("data-story-name") };
        refreshFormMode();
        input.focus();
        return;
      }

      var reactBtn = e.target.closest(".reaction-btn");
      if (reactBtn) {
        var storyId = reactBtn.getAttribute("data-story-id");
        var reaction = reactBtn.getAttribute("data-reaction");
        var active = reactBtn.getAttribute("data-active") === "1";
        if (!hasSession) {
          pendingAction = { type: "react", id: storyId, reaction: reaction };
          refreshFormMode();
          return;
        }
        reactBtn.disabled = true;
        await sendReaction(storyId, reaction, active);
        await loadStories(body);
      }
    });

    if (authForm) {
      authForm.addEventListener("submit", async function (e) {
        e.preventDefault();
        var email = authEmail.value.trim();
        var password = authPassword.value;
        if (!email || !password) return;
        var submitBtn = authForm.querySelector(".hero-live-chat-auth-submit");
        if (submitBtn) submitBtn.disabled = true;
        if (authError) authError.textContent = "";
        try {
          var { error } = await sb.auth.signInWithPassword({ email: email, password: password });
          if (error) {
            if (authError) authError.textContent = "Couldn't sign in — check your email and password.";
          } else {
            authPassword.value = "";
            // onAuthStateChange picks it up from here — completes any pending
            // reaction, or flips the form over to the reply box.
          }
        } catch (err) {
          if (authError) authError.textContent = "Couldn't sign in just now — please try again.";
        } finally {
          if (submitBtn) submitBtn.disabled = false;
        }
      });
    }

    loadStories(body);
    setInterval(function () { loadStories(body); }, REFRESH_MS);

    form.addEventListener("submit", async function (e) {
      e.preventDefault();
      var text = input.value.trim();
      if (!text) return;

      var button = form.querySelector("button");
      if (button) button.disabled = true;

      try {
        if (pendingAction && pendingAction.type === "reply") {
          var sessionRes = await sb.auth.getSession();
          var session = sessionRes && sessionRes.data && sessionRes.data.session;
          if (!session) {
            hasSession = false;
            refreshFormMode();
            return;
          }
          var { error: replyError } = await sb.from("story_replies").insert({
            question_id: pendingAction.id,
            user_id: session.user.id,
            reply_text: text
          });
          input.value = "";
          if (!replyError) {
            exitPendingAction();
            showPostStatus("Reply posted!", false);
            await loadStories(body);
          } else {
            showPostStatus("Couldn't post that reply just now — please try again in a moment.", true);
          }
        } else {
          // Posting a new story — requires a signed-in member; publishes instantly.
          var sessionRes2 = await sb.auth.getSession();
          var session2 = sessionRes2 && sessionRes2.data && sessionRes2.data.session;
          if (!session2) {
            hasSession = false;
            refreshFormMode();
            return;
          }
          var askerName = null;
          try {
            var profileRes = await sb.from("profiles").select("display_name").eq("id", session2.user.id).single();
            askerName = (profileRes.data && profileRes.data.display_name) || null;
          } catch (profileErr) {
            // No display name on file — falls back to "A member" when shown.
          }
          var { error } = await sb.from("community_questions").insert({
            question_text: text,
            user_id: session2.user.id,
            asker_name: askerName,
            status: "approved"
          });
          input.value = "";
          if (!error) {
            showPostStatus("Posted! Thanks for sharing your journey.", false);
            await loadStories(body);
          } else {
            showPostStatus("Couldn't post that just now — please try again in a moment.", true);
          }
        }
      } catch (err) {
        // Swallow — the box stays usable even if this one submit failed.
      } finally {
        if (button) button.disabled = false;
      }
    });
  });
})();
