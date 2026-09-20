/* =========================================================================
   Members directory (members.html)
   -----------------------------------------------------------------------
   Real, opted-in members who have actually signed up are pulled from
   Supabase (profiles table, which is publicly readable — see sql/schema.sql)
   and shown first, each with their uploaded profile photo when they have
   one approved. Demo/illustrative profiles (the same roster used in the
   homepage "Active Members" rail in js/main.js) fill out the rest of the
   grid so it never looks sparse while the community is still small — this
   mirrors the same "real data blended with demo placeholders" pattern
   already used for videos on the homepage (see js/hero-live-feed.js).

   Real profiles don't have an activity type, location, or "active now"
   status yet (those fields don't exist on public.profiles) — so real
   cards show a "Founding Member" badge instead of an activity tag/distance
   until that data exists.
   ========================================================================= */
(function () {
  var SUPABASE_URL = "https://wgrldwdgvvlhcmlyoxrl.supabase.co";
  var SUPABASE_ANON_KEY = "sb_publishable_4sbGE70Sh5gkgpmBqdGVBg_VkqjzJVx";
  var GRAD_CLASSES = ["g1", "g2", "g3", "g4", "g5", "g6"];
  var TOTAL_GRID_SIZE = 16;

  var DEMO_MEMBERS = [
    { name: "Jessica R.", initials: "JR", grad: "g1", activity: "Gym — Legs", distance: "1.8 mi • Arlington", isActiveNow: true },
    { name: "Marcus T.", initials: "MT", grad: "g2", activity: "Run", distance: "2.4 mi • Fort Worth", isActiveNow: false },
    { name: "Aaliyah K.", initials: "AK", grad: "g3", activity: "Cycling", distance: "3.1 mi • Grapevine", isActiveNow: true },
    { name: "David P.", initials: "DP", grad: "g4", activity: "Pickleball", distance: "4.0 mi • Arlington", isActiveNow: false },
    { name: "Sofia M.", initials: "SM", grad: "g5", activity: "Yoga", distance: "Dallas–Fort Worth", isActiveNow: false },
    { name: "Chris B.", initials: "CB", grad: "g6", activity: "Hiking", distance: "5.6 mi • Southlake", isActiveNow: false },
    { name: "Priya N.", initials: "PN", grad: "g1", activity: "Swim", distance: "2.9 mi • Irving", isActiveNow: true },
    { name: "Ethan W.", initials: "EW", grad: "g3", activity: "Gym — Full Body", distance: "1.2 mi • Dallas", isActiveNow: false },
    { name: "Brittany L.", initials: "BL", grad: "g4", activity: "Walk", distance: "Dallas–Fort Worth", isActiveNow: false },
    { name: "Miguel A.", initials: "MA", grad: "g2", activity: "Tennis", distance: "3.7 mi • Plano", isActiveNow: false },
    { name: "Hannah G.", initials: "HG", grad: "g5", activity: "Pilates", distance: "2.1 mi • Frisco", isActiveNow: false },
    { name: "Tyler J.", initials: "TJ", grad: "g6", activity: "Basketball", distance: "1.5 mi • Arlington", isActiveNow: true },
    { name: "Nicole F.", initials: "NF", grad: "g1", activity: "Volleyball", distance: "Dallas–Fort Worth", isActiveNow: false },
    { name: "Omar S.", initials: "OS", grad: "g2", activity: "Surf", distance: "6.8 mi • Corpus Christi", isActiveNow: false },
    { name: "Grace L.", initials: "GL", grad: "g3", activity: "Gym — Strength", distance: "2.6 mi • Arlington", isActiveNow: false },
    { name: "Jordan H.", initials: "JH", grad: "g4", activity: "Run", distance: "3.4 mi • Fort Worth", isActiveNow: false }
  ];

  function playIconSVG(size) {
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + size + '" height="' + size +
      '" viewBox="0 0 24 24" fill="currentColor"><polygon points="6 3 20 12 6 21 6 3"></polygon></svg>';
  }

  function initialsFrom(name) {
    var parts = (name || "?").trim().split(/\s+/);
    var initials = parts[0] ? parts[0].charAt(0) : "?";
    if (parts.length > 1) initials += parts[parts.length - 1].charAt(0);
    return initials.toUpperCase();
  }

  function buildMemberCard(person) {
    var card = document.createElement("article");
    card.className = "member-card";
    card.setAttribute("data-active", person.isActiveNow ? "true" : "false");
    card.setAttribute("data-real", person.isReal ? "true" : "false");

    var ring = document.createElement("div");
    ring.className = "story-ring" + (person.isActiveNow ? " active-ring" : "");

    var frame = document.createElement("div");
    frame.className = "story-avatar-frame";

    var grad = document.createElement("div");
    grad.className = "story-avatar-gradient " + person.grad;

    if (person.photoUrl) {
      var img = document.createElement("img");
      img.src = person.photoUrl;
      img.alt = person.name;
      img.style.cssText = "width:100%;height:100%;border-radius:50%;object-fit:cover;";
      grad.appendChild(img);
    } else {
      grad.textContent = person.initials;
    }

    var badge = document.createElement("div");
    if (person.isActiveNow) {
      badge.className = "story-play-badge active-badge";
      badge.innerHTML = '<span class="pulse-ring"></span>';
    } else {
      badge.className = "story-play-badge";
      badge.innerHTML = playIconSVG(11);
    }
    grad.appendChild(badge);
    frame.appendChild(grad);
    ring.appendChild(frame);

    var name = document.createElement("div");
    name.className = "member-name";
    name.textContent = person.name;

    var status = document.createElement("div");
    status.className = "member-status" + (person.isActiveNow ? " live" : "");
    status.textContent = person.isActiveNow ? "Active Now" : (person.statusText || person.distance);

    var tags = document.createElement("div");
    tags.className = "member-tags";
    var activityTag = document.createElement("span");
    activityTag.className = "video-tag" + (person.isReal ? " reason" : "");
    activityTag.textContent = person.activity;
    tags.appendChild(activityTag);

    var actions = document.createElement("div");
    actions.className = "member-actions";

    // No login/session exists on the public marketing site — Follow and
    // Message both send a visitor to sign in, where the real feature lives
    // in the member app.
    function goToMemberSignIn() {
      window.location.href = "https://app.ensemblefitness.com/login.html";
    }

    var followBtn = document.createElement("button");
    followBtn.type = "button";
    followBtn.className = "btn btn-ghost-light btn-follow";
    followBtn.textContent = "Follow";
    followBtn.addEventListener("click", goToMemberSignIn);

    var connectBtn = document.createElement("button");
    connectBtn.type = "button";
    connectBtn.className = "btn btn-ghost-light";
    connectBtn.textContent = "Message";
    connectBtn.addEventListener("click", goToMemberSignIn);

    actions.appendChild(followBtn);
    actions.appendChild(connectBtn);

    card.appendChild(ring);
    card.appendChild(name);
    card.appendChild(status);
    card.appendChild(tags);
    card.appendChild(actions);
    return card;
  }

  function render(list, filter) {
    var grid = document.getElementById("memberGrid");
    if (!grid) return;
    grid.innerHTML = "";
    var filtered = list.filter(function (m) {
      return filter === "active" ? m.isActiveNow : true;
    });
    filtered.forEach(function (person) {
      grid.appendChild(buildMemberCard(person));
    });
  }

  async function loadRealMembers() {
    if (!window.supabase) return [];
    try {
      var sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

      var profilesRes = await sb
        .from("profiles")
        .select("id, display_name, created_at")
        .order("created_at", { ascending: true })
        .limit(TOTAL_GRID_SIZE);

      var profiles = profilesRes.data;
      if (profilesRes.error || !profiles || profiles.length === 0) return [];

      var ids = profiles.map(function (p) { return p.id; });

      var photosByUser = {};
      var mediaRes = await sb
        .from("media")
        .select("user_id, storage_path")
        .eq("kind", "photo")
        .eq("is_profile_photo", true)
        .eq("status", "approved")
        .in("user_id", ids);

      if (!mediaRes.error && mediaRes.data) {
        for (var i = 0; i < mediaRes.data.length; i++) {
          photosByUser[mediaRes.data[i].user_id] = mediaRes.data[i].storage_path;
        }
      }

      var realMembers = [];
      for (var j = 0; j < profiles.length; j++) {
        var p = profiles[j];
        var name = p.display_name || "A member";
        var photoUrl = null;
        var storagePath = photosByUser[p.id];
        if (storagePath) {
          var signedRes = await sb.storage.from("media").createSignedUrl(storagePath, 3600);
          if (signedRes.data) photoUrl = signedRes.data.signedUrl;
        }
        realMembers.push({
          name: name,
          initials: initialsFrom(name),
          grad: GRAD_CLASSES[j % GRAD_CLASSES.length],
          activity: "Founding Member",
          statusText: "Ensemble Fitness member",
          isActiveNow: false,
          isReal: true,
          photoUrl: photoUrl
        });
      }
      return realMembers;
    } catch (err) {
      return []; // Never break the page over a network/query hiccup — just show demo cards.
    }
  }

  document.addEventListener("DOMContentLoaded", async function () {
    var realMembers = await loadRealMembers();
    var demoFill = DEMO_MEMBERS.slice(0, Math.max(0, TOTAL_GRID_SIZE - realMembers.length));
    var combined = realMembers.concat(demoFill);

    render(combined, "all");

    var bar = document.getElementById("memberFilterBar");
    if (!bar) return;
    bar.addEventListener("click", function (e) {
      var chip = e.target.closest(".member-filter-chip");
      if (!chip) return;
      bar.querySelectorAll(".member-filter-chip").forEach(function (c) {
        c.classList.remove("active");
      });
      chip.classList.add("active");
      render(combined, chip.getAttribute("data-filter"));
    });
  });
})();
