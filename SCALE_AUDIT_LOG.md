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

## 2026-10-03 — Branding pass (not a full weekly audit)

Not a scheduled weekly check — picking up one incidental finding from
today's feature work so it doesn't get lost before next Monday's pass.

**Flagged, NOT yet fixed:**
- music-library.html: has one more `<div>` than `</div>` (confirmed
  pre-existing — the mobile app's untouched copy has the same mismatch, so
  this predates today's changes and wasn't introduced by them). Didn't
  track down which tag is unclosed yet since it wasn't part of what Ken
  asked for today; worth a real look on the next full audit pass.

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
