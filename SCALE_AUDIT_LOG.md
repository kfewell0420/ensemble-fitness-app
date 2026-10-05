# Scale & Bug Audit Log

Running record of the weekly platform health check Ken asked for (started Oct
2026). Each entry is one audit pass across the website (`member-app/`), the
mobile app wrapper (`ensemble-fitness-mobile/`), and the Supabase schema
(`member-app/sql/`). Newest entry on top.

Read this file at the start of every audit so it builds on the last one
instead of re-discovering (and re-explaining at length) the same "flagged
for later" items every week. Still-outstanding items can be mentioned
briefly as a reminder; only new findings need the full writeup.

---

## 2026-10-05 — Music Library's "How It Works" rewritten for listeners, not artists

Ken's ask, prompted by a conversation with an artist: the "How It Works"
card on `music-library.html` still explained how to UPLOAD a track (Prep
your track / Give it a title / Upload it right here / You're live
instantly) — left over from "when we first started our site." That's not
what a typical member needs explained; it's how tipping/the wallet works.
Rewritten from the listener's side:

1. Add to Your Wallet — add $1/$2/$5+ so you're ready to tip.
2. Listen & Discover — browse the Music Library for independent artists.
3. Tip an Artist — send a tip straight from the wallet with one tap.
4. 100% Goes to the Artist — Ensemble Fitness takes no cut.

Plus one closing line under the four steps: "Good music moves us.
Supporting the people who create it moves us forward."

Deliberately no mention of Stripe or artist payout setup anywhere in these
four steps — Ken's explicit call: a listener shouldn't need to understand
Stripe, and payout setup is handled entirely on the artist side already.
To a member it should just feel like add money → find music → tip artist →
artist gets the support.

Synced to the mobile app's `www/music-library.html`.

**Still open:** Ken also wants the line directly under "Your Wallet" (the
balance) reworded away from "Add to your wallet to tip artists" — his
message cut off before the replacement text. Waiting on that before
touching it.

## 2026-10-04, round 3 — Share Your Journey redesigned to match the old private journal's layout ⚠️ REQUIRES A SUPABASE STEP

Same-day follow-up again. Ken sent a screenshot of the old private-journal
form/history layout and asked for "Share Your Journey" to use that exact
wording and layout: structured Date/Activity/How did it feel/Notes fields
(date auto-fills to today) instead of one free-text box, a dark background
instead of the white marketing-style page it had, a single button that
posts immediately, and a "History" list of who's posted — capped at the
latest 4.

**⚠️ Action needed before this works: run `sql/run_this_first_journey_columns.sql`
in the Supabase SQL editor.** The new composer inserts `entry_date`,
`activity`, `mood`, and `notes` columns that don't exist on
`community_questions` yet — until that migration runs, every new post will
fail with a "column does not exist" error. It's additive and nullable
(safe to run anytime, doesn't touch existing rows); the same statements are
also folded into the main `sql/schema.sql` for the record.

**Changed (`fitness-journeys.html`):**
- Dropped the forced-white `.fj-page` theme entirely — this page now uses
  the app's normal dark theme like everywhere else, built on the same
  shared `.app-shell`/`.card`/`.eyebrow`/`.field`/`.review-row` classes the
  old `journey.html` private journal used (Ken explicitly asked for "this
  exact layout" from a screenshot of that page).
- Removed the hero banner and the old "click to reveal the composer" step
  — the form is just always on the page now, matching the private
  journal's pattern. Posting still goes live instantly (no change to that
  behavior, see the Oct 2026 composer entry above).
- History list now shows every member's name (it's public now, so "who
  posted" matters) and is capped at the latest 4 posts — fetches a few
  extra under the hood so a member with some posters blocked still sees a
  full 4 where possible, and shows the true total count ("N shared so far
  — showing the latest 4") above the list.
- Reactions and replies (👏❤️👍, inline reply box) are unchanged
  functionally, just re-themed dark to match.
- Own-post Delete button added to each history row (admins already had
  this via admin.html's Journeys tab; members can now remove their own
  post the same way they could in the old private journal).
- The illustrative "not real" examples panel is unchanged other than a
  dark re-theme — still clearly labeled as illustrative, still below the
  real History list.

Synced to the mobile app's `www/fitness-journeys.html`.

## 2026-10-04, round 2 — Merged the two "journey" features into one

Same-day follow-up to the entry directly below. After seeing the new
composer in place, Ken's call was to go further: "share your journey and
fitness journey should be one and the same... there should be no fitness
journey anywhere... no private journal... everyone can see it and then
motivate you to continue." Combined the two features into exactly one,
public, live-the-moment-you-post feature, branded "Share Your Journey"
everywhere, on both the website and the mobile app.

**Removed:**
- The private per-member workout journal (`journal_entries` table,
  previously `journey.html` / "My Workout Journal" / "My Journey") no
  longer exists as a feature. `journey.html` is kept only as a redirect to
  `fitness-journeys.html`, so any old bookmark, nav shortcut, or the
  login-redirect allowlist in `login.html` that still points at it lands
  safely on the real page instead of a dead link. Nothing anywhere reads or
  writes `journal_entries` anymore.
  - Members' old private entries are still sitting in that table,
    untouched — they were written under a privacy promise, so they are
    NOT surfaced anywhere now that the feature is public. No UI exists
    anymore to view, add to, or delete them (Supabase dashboard only, same
    as before).

**Renamed "Fitness Journeys" → "Share Your Journey" everywhere a member
can see it:**
- `fitness-journeys.html`: page title, hero eyebrow.
- `feed.html`: the "Journeys" filter chip's visible label; the sidebar
  panel that used to promote the private journal now promotes this page
  instead ("Share Your Journey →", links to `fitness-journeys.html`).
- `find.html`: the Explore list used to have two separate rows ("My
  Journey" and "Fitness Journeys") — collapsed into one "Share Your
  Journey" row.
- `books.html`, `member.html`, `music-library.html`, `profile.html`,
  `admin.html`: top nav's "My Journey" link now reads "Share Your Journey"
  and points at `fitness-journeys.html`.
- `admin.html`'s Journeys tab already said "Share Your Journey" in its
  eyebrow and already manages the public posts (`community_questions`) —
  no change needed there besides the nav link above.

**Unchanged (already matched what Ken asked for):** posting on
`fitness-journeys.html` was already public and lived instantly with no
moderation queue (see the in-app composer added earlier today) — that
behavior didn't need to change, only the fact that it's now the only
journey feature, and its name everywhere it's shown to a member.

Synced to the mobile app's `www/` folder: `journey.html`,
`fitness-journeys.html`, `feed.html`, `find.html`, `books.html`,
`member.html`, `music-library.html`, `profile.html`. `admin.html` is
internal-only and never ships to mobile, per the standing rule.

## 2026-10-04 — Naming clarity, alignment fix, and in-app journey composer

Not a scheduled weekly check — picking up same-day feature/bug work reported
by Ken.

**Fixed (naming collision, real-user confusion):**
- The app had two different "journey" features with near-identical names:
  "Start Your Journey" (private per-member log, `journal_entries` table,
  `journey.html`) and "Fitness Journeys" (public long-form community
  stories, `community_questions` table, `fitness-journeys.html`). Ken
  himself posted to the private one expecting it to show up on the public
  one. Renamed every headline/button on the private flow away from the word
  "journey" (`journey.html`: eyebrow → "Private Journal", heading → "Your
  private journal", submit button → "Add Entry", added an inline link over
  to Fitness Journeys for anyone who meant to post publicly) and renamed the
  public flow's duplicate "Start Your Journey" button to "Share Your
  Journey" (`feed.html`, `fitness-journeys.html`) to match its sibling
  link's existing text.

**Fixed (layout):**
- fitness-journeys.html: hero section used `max-width: 880px` while the
  section below it used `1080px`, so the hero's left edge didn't line up
  with the content beneath (Ken flagged via an annotated screenshot).
  Matched the hero to `1080px`.

**Fixed (cross-domain login bug, real bug report):**
- Ken reported that clicking "Share Your Journey" while already logged into
  the app sent him to a login page. Root cause: that button linked out to
  the separate marketing site (`ensemblefitness.com/share-your-journey.html`),
  a different domain that can't see the app's Supabase session — browsers
  don't share localStorage/auth across origins, so an already-signed-in
  member looked logged-out there. That page is a separate codebase outside
  this workspace, so it can't be patched directly. Fix: built a real
  composer right inside `fitness-journeys.html` — "Share Your Journey" and
  "Share your own journey →" now open an in-page textarea that posts
  straight to `community_questions` using the session already open in the
  app (`status: "approved"`, matching the existing RLS insert policy), then
  refreshes the list and scrolls to it. No more hand-off to another domain
  for this flow.
  - Also fixed a leftover bug from the same edit: `init()` still referenced
    the old `EXTERNAL_SHARE_URL` variable removed when the composer was
    added — would have thrown on every page load before the composer code
    ever reached `requireAuth()`'s callers. Replaced with a `profiles`
    lookup for the signer's display name (used as the post's `asker_name`)
    and a call to wire up the composer's open/cancel/post handlers.

**Still open, flagged not actioned:**
- A separate ask ("all the members need to have their stuff visible when
  they post," re: private `journal_entries`) had a draft RLS policy change
  started in `sql/schema.sql` to make journal entries fully public, but it
  was put on hold mid-edit pending whether the new Fitness Journeys composer
  above already covers the real need. Not delivered, not applied — needs a
  decision before continuing.

## 2026-10-03 — Branding pass (not a full weekly audit)

Not a scheduled weekly check — picking up one incidental finding from
today's feature work so it doesn't get lost before next Monday's pass.

**Flagged, NOT yet fixed:**
- music-library.html: has one more `<div>` than `</div>` (confirmed
  pre-existing — the mobile app's untouched copy has the same mismatch, so
  this predates today's changes and wasn't introduced by them). Didn't
  track down which tag is unclosed yet since it wasn't part of what Ken
  asked for today; worth a real look on the next full audit pass.

**Fixed (real-device bug report, same day):**
- feed.html: Ken's Android phone hit a reproducible split-second scroll
  hiccup right at the PAGE_SIZE boundary (reported as "between frame 8 and
  9" — PAGE_SIZE is 8). Cause: `loadMoreObserver` had no `rootMargin`, so
  the next batch's Supabase fetch didn't start until the 1px sentinel had
  already scrolled fully into view — nothing left below it to scroll into
  until that fetch resolved. Added `rootMargin: "0px 0px 900px 0px"` so the
  fetch starts a post and a half early and is normally done before anyone
  scrolls that far.

## 2026-10-02 — Initial audit

**Fixed and delivered:**
- admin.html: stored-XSS gaps — several tabs rendered member-submitted text
  (captions, names, bios, blurbs, links) straight into innerHTML with no
  escaping. Added `escapeAttrAdmin()` alongside the existing
  `escapeHtmlAdmin()` for attribute contexts (hrefs, data-* attributes),
  and applied both everywhere they were missing.
- admin.html: Recent Videos/Photos tabs sorted uncategorized items to the
  top (nullsFirst) ABOVE a limit(30) cutoff — once the uncategorized
  backlog passed 30, truly recent tagged content stopped appearing at all.
  Now sorts by plain recency; the "needs a category" count comes from its
  own unlimited count query instead.
- feed.html: `fetchBatch`/`loadMoreReel` computed pagination offset and
  "reached end" from the post-block-filter row count instead of the raw
  query row count — any member who'd blocked someone could hit a false
  early "end of feed" and see duplicate/skipped posts. Now returns
  `{rows, rawCount}` and paginates off `rawCount`.
- feed.html: `loadFitPlusPanel` fetched EVERY other member's profile to
  count ZIP/wake-time matches client-side. Replaced with three targeted
  `count: exact, head: true` queries.
- feed.html: `toggleReaction` had no in-flight guard — a fast double-tap
  could fire overlapping insert/delete calls that resolve out of order.
- fitness-plus.html (`loadMatches`), members.html (`runSearch`),
  member.html (`loadMemberMedia`): each awaited one signed-URL/avatar
  fetch per row inside a loop, serially. Converted to `Promise.all` so
  rows resolve concurrently.
- members.html: `runSearch` also had no re-entrancy guard (double
  click/Enter could interleave two searches) and no `.limit()` — both
  fixed.
- profile.html: saving the profile form (and even just loading the page)
  wiped the 📷 avatar upload badge via `avatarCircle.textContent =`
  before any photo was ever uploaded. Added a dedicated
  `#avatarInitialText` span so updating the initial letter no longer
  nukes the badge. Also added an upload re-entrancy guard and orphaned-
  storage-object cleanup if the DB insert fails after the file uploads.
- upload.html: same orphaned-storage-object cleanup added to both the
  song/audio upload path and the main photo/video upload path.
- js/notifications.js: the "mark all read" button and the 1.5s
  auto-mark-read timer could both fire for the same ids — harmless but
  wasteful at scale. Now the click cancels the pending timer.
- login.html: `resetPasswordForEmail`'s redirectTo used
  `window.location.origin`, which is `capacitor://localhost` /
  `https://localhost` inside the mobile app, not the real site — anyone
  resetting their password from inside the app got a dead link.
  Hardcoded to `https://app.ensemblefitness.com/reset-password.html`.
- sql/performance-indexes.sql (NEW): added missing indexes on
  `media(status, created_at)` / `media(user_id)`,
  `profiles(zip_code)` / `(wake_time_category)` / `(fitness_plus_active)`,
  `journal_entries(user_id)`, `story_replies(question_id)`,
  `community_questions(status, created_at)`,
  `quote_recordings(quote_id)` / `(user_id)`. Purely additive — Ken still
  needs to run this one in the Supabase SQL editor.

**Flagged, NOT yet fixed (bigger/riskier — needs more thought or Ken's input):**
- admin.html: almost every approve/reject/toggle handler reloads its
  entire tab's list from scratch instead of patching the one changed row.
  Fine today, gets slower as review-queue volume grows into the
  thousands. Fixing this broadly across every tab is a real refactor,
  not a quick patch.
- admin.html: `init()` awaits 16 tab loaders sequentially instead of
  `Promise.all` — adds up page-load latency but isn't broken.
- admin.html: book-approval flow (PDF/cover copy, books insert,
  book_submissions update, email) is several un-transacted steps — a
  failure partway through could leave a submission "pending" with an
  orphaned duplicate book if Approve is clicked again. Needs either a
  server-side transaction (edge function) or an idempotency check.
- music-library.html: `subscribeToTrackChanges` reacts to ANY insert/
  update/delete on the `tracks` table by refetching the ENTIRE table for
  every open session — a "thundering herd" once there are many
  concurrent users. Needs the realtime handler to patch just the changed
  row instead of a full reload.
- upload.html, profile.html (`loadMyMedia`), music-library.html
  (`loadTracks`): no pagination on these growing lists — added a
  `.limit(200)` safety cap to members.html's search, but these haven't
  gotten the same treatment yet and would benefit from real
  paginate-as-you-scroll instead of a fetch-everything-at-once pattern.
- upload.html: no upload progress bar on large video files — just a
  static "Uploading…" label. Not a bug, but worth it for UX once more
  people are uploading bigger files on slower connections.
- fitness-journeys.html (`wireRealCard`): fires 2 queries per journey
  card (up to ~40 total) instead of 2 batched `.in()` queries total.
- fitness-plus.html (`loadMatches`): still fetches every
  `fitness_plus_active` profile in one unbounded query (the avatar-fetch
  part is now parallelized, but the base query itself has no limit or
  pagination) — fine at current scale, worth revisiting once Fitness+
  has hundreds of active subscribers.

**Not a bug, deliberately left alone:**
- `escapeHtmlAdmin(...)`-into-`data-title="..."` pattern on the book
  Approve button already manually escapes `"` separately — safe as-is.
- `js/vendor/` is an intentionally-empty leftover directory (Supabase is
  loaded from CDN, never self-hosted) — referenced only in comments.
