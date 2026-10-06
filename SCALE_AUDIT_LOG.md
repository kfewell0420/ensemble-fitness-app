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

## 2026-10-06, round 6 — hero subtitle forced to exactly 2 lines

Round 5's re-punctuation wasn't enough — the paragraph was still wrapping
to 3 lines (the first sentence alone was long enough to wrap on its own).
Ken gave the exact 2 sentences this time: "Every post here is from a real
Ensemble Fitness member — the wins, the hard days." / "Everything in
between — share where you're at, and cheer someone else on." — no "And" on
the second one. Rather than keep guessing at wording that happens to wrap
the right way at whatever width someone's viewing it, this now forces the
break explicitly with a `<br>` between the two sentences, so it's always
exactly those two lines regardless of screen width. Also widened the
paragraph's max-width (560px → 640px, so each sentence has room to actually
fit on one line) and tightened its margin and line-height — the shorter,
tighter text block means more of the hero photo shows above the buttons,
which was the other half of Ken's ask ("so we can see the heads of the
characters and the horizon, the sunset").

## 2026-10-06, round 5 — hero subtitle re-punctuated to drop the orphan "on."

The hero subtitle was wrapping to 3 lines on Ken's screen, with "on." left
alone on the third line — "looks a little odd." Re-split into two
sentences instead of one long one: "Every post here is from a real
Ensemble Fitness member — the wins, the hard days. And everything in
between — share where you're at, and cheer someone else on." Same meaning,
same words, just re-punctuated so it reads as two shorter sentences
instead of one that runs long. Shorter text here also means the hero's own
text block takes up less vertical room, so more of the hilltop photo (and
the people in it) shows through above the buttons — the other thing Ken
asked for ("pull all that down so we can actually see the heads of the
people").

## 2026-10-06, round 4 — brought back example cards, one per category

Ken, on the mostly-empty real-journeys grid: "it would be great... even
though they're dummy profiles for right now." Added back 8 placeholder
example cards — one per category pill, so every filter shows something —
clearly tagged "Example" in the corner (not pretending to be real members),
dimmed slightly, and fully static: no clickable reactions, no comment box,
nothing written to Supabase. Real posts always render first (already
newest-first), examples fill in after, so anything a member actually posts
lands above the placeholders, never mixed into them — and the "N shared so
far" count only ever reflects real posts, so it stays honest as the
community grows.

## 2026-10-06, round 3 — "View Recent Journeys" wasn't doing anything

Ken: "The page does not come up. It doesn't load anything." The three hero
buttons (Start Your Journey / View Recent Journeys / See How It Works)
were plain `<button>` elements wired entirely by a JavaScript function
(`wireHeroButtons()`) that ran partway through page setup — if anything
earlier in that setup sequence threw an error, every button after it in
the sequence would silently never get its click handler, with nothing on
screen to explain why. Website-first per Ken's note — he's confirming the
web page before moving to mobile, so this round (and the SQL/migration
guidance) is being verified there first, though the file stays identical
and synced to mobile as always.

Two changes, both defensive rather than chasing one specific cause (since
without seeing Ken's actual browser console, the exact trigger can't be
confirmed from here):

1. The three hero buttons are real links now (`<a href="#fjComposerAnchor">`
   etc.), not JS-only buttons — clicking one jumps to that section natively,
   with zero JavaScript required. The page's script still upgrades that
   into a smooth scroll, but only as an enhancement on top of a click that
   already works on its own.
2. Page setup no longer runs as one unbroken chain. Each independent setup
   step (building the category dropdown, the filter pills, the hero
   buttons, the composer) now runs in its own try/catch, so one broken
   piece can't silently take every step after it down too — including, as
   apparently happened here, the hero buttons and the real-journeys load.

## 2026-10-06, round 2 — real posts weren't showing + dropped the redundant CTA banner

Two fixes from Ken in the same message.

**Real posts showing as "no journeys shared yet."** Ken had posted a
journey or two himself and the page wasn't reflecting them — not even the
count. Root cause: this page's very first query for the real-journeys grid
asks for the `category` column, which only exists once
`sql/run_this_next_journeys_upgrade.sql` has been run in Supabase. Asking
for a column that doesn't exist yet fails the WHOLE query, so every real
post disappeared, not just the category badge — that migration step
matters more than the round-5 delivery note made clear. Fixed properly:
both the real-journeys query and the composer's insert now try with
`category` first, and silently retry without it if that fails, so real
posts show (and can be posted) either way, with or without that SQL step
having been run. The category badge/filter itself still won't work for a
post saved before the migration runs — only visibility was the bug.

**Dropped the "Your journey matters" CTA banner.** Ken: "we have share
your journey in too many areas... that's super redundant." Between the
hero's "Start Your Journey" button, the composer's own "Share Your
Journey" submit button, and this banner's own "Share Your Journey" button
right below it, the same call-to-action appeared 3 times on one screen.
Removed the banner entirely; How It Works now follows directly after the
real-journeys grid (it simply moves up one slot, same as Ken described).

Synced to mobile — same file both places.

## 2026-10-06 — raised the character limits on Activity and How did it feel?

Ken was writing full sentences into both fields ("Today I decided to go to
a park and touch a tree, with both hands, barefooted." / "Excellent. I
closed my eyes in hopes of...") and kept getting cut off well before
filling the box, let alone finishing the thought. Activity was capped at
80 characters, How did it feel? at 40 — fine for the one- or two-word
answers the placeholders suggest ("Leg day" / "Strong, tired, great"), too
short for members who want to actually say something there. Raised to 160
and 120. Database side needed no change — both columns are already a plain
`text` type with no length limit; this was a client-side cap only. Updated
in both the composer and the inline Edit form, and synced to mobile.

## 2026-10-05, round 6 — reordered the new journeys page so real content comes first

Same-day follow-up to round 5, after Ken saw it live. Two changes:

1. Added a third hero button, "View Recent Journeys," next to Start Your
   Journey and See How It Works — jumps straight down to the real-posts
   grid ("the page I provided you with... their profile outline and stuff
   like that").
2. Moved the "How It Works" explainer from right under the hero down to
   the very bottom of the page, under the "Your journey matters" banner.
   Ken's reasoning: "we're trying to get people to click on the site, not
   be deterred from scrolling and scrolling... it has to be quick access
   on the mobile." It's no longer a reveal/hide toggle either — nothing on
   the page is hidden now, the hero's "See How It Works" button just
   scrolls straight to it.

Page order top to bottom is now: hero (3 quick-jump buttons) → composer →
category pills + real-journeys grid → CTA banner → How It Works. Synced to
the mobile app's `www/fitness-journeys.html` — same file both places.

## 2026-10-05, round 5 — "Share Your Journey" rebuilt as the full member feed ⚠️ REQUIRES A SUPABASE STEP

Ken sent three screenshots: how `fitness-journeys.html` looks logged out
(marketing-style, illustrative examples), and a third, much richer mockup —
photo hero, "Real people. Real progress.", category filter pills, and post
cards with real photo avatars, an age next to each name, an activity-icon
badge, a "⋮" menu, a bold headline, an italic quote, reaction pills, named
comment replies, and an "Add a comment…" bar. His ask: "this is what I want
it to look like when you're a member... you can see actual people." He
confirmed via follow-up questions that this should (1) replace the round-3
redesign entirely, not sit alongside it, (2) apply to both the website and
the mobile app, (3) use each member's real uploaded profile photo as their
avatar, and (4) use his exact 9-pill category list. He also supplied the
mountaintop hero photo directly — saved as `assets/journeys-hero.jpg`,
matching the existing `assets/music-library-bg.jpg` convention rather than
starting a new `img/` folder.

What changed in `fitness-journeys.html`:
- New photo hero ("Stronger Together" script overlay, "Real people. Real
  progress." heading, Start Your Journey / See How It Works buttons).
- The round-3 composer (Date/Activity/How it felt/Notes, posts instantly,
  no separate open step) is kept as-is, just with a new required Category
  field added, now sitting under the hero instead of being the whole page.
- Category filter pills (All Journeys + the 8 real categories) filter the
  grid client-side from one fetch — no extra round trip per pill click.
- Post cards: real profile photo avatar (falls back to the existing
  colored-initial circle if a member hasn't uploaded one), name + age,
  "Member since [month/year]", a category icon badge, a "⋮" menu (Edit/
  Delete on your own posts, Report on others', reusing the existing report
  modal), bold headline, italic quote, the existing reactions, and comment
  replies restyled with each replier's own avatar.
- The old "illustrative, not real" 12-card example grid is gone from this
  page — Ken was explicit members should see "actual people," so an empty
  state ("be the first to share in this category") takes its place instead
  of fake content once real posts exist.
- A closing CTA banner ("Your journey matters.") scrolls back to the
  composer, same as the hero's own Start Your Journey button.

⚠️ **Needs a Supabase step before this goes live** — run
`sql/run_this_next_journeys_upgrade.sql` once in the Supabase SQL Editor.
It adds `community_questions.category` (checked against the 8 real category
values) and a new view, `public.profiles_public`, that hands back a
member's AGE as a plain computed number without ever exposing their raw
`date_of_birth` to another member's browser — `profiles.date_of_birth` is
already flagged in `schema.sql` as "never exposed to other members'
clients, only a computed age should ever be," and this view is that
boundary. Posts made before this step has run will have no category (shown
under "All Journeys" only, no icon badge) until edited.

Synced to the mobile app's `www/fitness-journeys.html` and
`www/assets/journeys-hero.jpg` — same file both places, so a `cap sync` +
rebuild picks it up with no separate mobile work needed. `admin.html` was
not touched by this round.

## 2026-10-05, round 4 — added a real Edit to admin.html's Approved Products tab

Same fix as the Quote Library Edit, same day: Ken is about to bulk-load the
Approved Products (Amazon/TikTok picks) tab today and asked for this ahead
of time so a typo doesn't mean deactivating and re-adding a whole pick
(which would also reset its `created_at` and its spot in the list).

Added an "Edit" button next to Deactivate/Reactivate on each pick: swaps
the row into editable fields for name, category, your take, price, and
both links, with Save/Cancel. Save re-runs the same validation the Add form
uses (name + category required, at least one of Amazon/TikTok required,
both links must start with `https://`) so a save can't leave a pick
broken. The product photo itself isn't editable here — re-adding the pick
is still the way to change a photo, everything else can be fixed in place.
This is admin.html only, so nothing to sync to mobile.

## 2026-10-05, round 3 — added a real Edit to admin.html's Quote Library tab

Ken spotted a double "!!" at the end of the live quote of the day and asked
how to fix it. Turned out there was no way to — admin.html's Quote Library
tab could only Add a new quote or Deactivate/Reactivate an existing one,
nothing to fix a typo in place. The workaround (deactivate the broken one,
add a corrected one) would also have reset that quote's `created_at` to
now, bumping it to the back of the daily rotation and shifting which quote
shows as "today's" for every member — not just a cosmetic side effect.

Added a proper "Edit" button next to Deactivate/Reactivate: swaps the row
into two text inputs (quote + author) with Save/Cancel. Save only updates
`quote_text`/`author` — `created_at`, `is_active`, and the quote's spot in
the rotation are all left alone. This is admin.html only, so there's
nothing to sync to mobile (admin.html never ships there, per the standing
rule).

**To fix today's typo**: open admin.html → Quote Library tab, find the one
marked "Today ★", hit Edit, remove the extra "!", hit Save.

## 2026-10-05, round 2 — quote-library.html renamed to "Daily Inspiration" and switched to one quote a day

Ken's ask: the page was dumping every active quote in the `quotes` table at
once — on his own phone it read as "it just literally spreads out
everything I ever wrote," not the calm, one-thought feel the rest of the
inspiration side of the app has. Two changes:

- **Naming**: eyebrow and `<title>` changed from "Quote Library" to "Daily
  Inspiration," matching what feed.html's dashboard panel and find.html's
  Explore list already call it ("Daily Inspiration (Quote)") — "this
  platform should be totally based on inspiration... it should be
  consistent." The heading "Words to carry with you." stays exactly as is —
  Ken's explicit call to keep that one. admin.html's internal "Quote
  Library" tab name is untouched (Ken's own backend tool, not member-facing).
- **Behavior**: now shows exactly one quote — today's — using the identical
  "days since the Unix epoch (UTC), modulo the number of active quotes"
  math feed.html's `loadQuotePanel` already used for its dashboard panel, so
  a member sees the same single line here as on the dashboard, and a new
  one shows up automatically at midnight. The old full-list view and its
  `buildQuoteCard` helper are gone.

Synced to the mobile app's `www/quote-library.html`.

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
