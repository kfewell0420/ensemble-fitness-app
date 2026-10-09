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

## 2026-10-09, round 23 — small leftover: cards flashing empty for a frame or two after the swap

Ken: round 22 "was much better." The follow-up recording (7:27 PM) shows
the long black stretch gone; what remains is one or two frames (~0.25s at
most) where a card's header and reaction bar are painted but its picture
isn't yet — on a filter switch to Working Out and on the Home landing.
Cause: the pictures are downloaded by then (round 22 waits for them) but
not yet decoded, and first-screen photos were still `loading="lazy"`.

Fix (`feed.html` + mobile mirror): `preloadFirstRealMedia()` now also
awaits `img.decode()` after each picture loads (falls back to plain load
where unsupported), and the first 8 cards' photos use `loading="eager"`
instead of lazy; later cards stay lazy. Regression harnesses for rounds
19, 20, 22 and the frozen-video check all pass. Honest limit: this
shrinks the gap, but I can't prove from a sandbox it reaches zero on
Ken's real devices.

## 2026-10-09, round 22 — the black flash is the swap for cards AFTER the first; round 21's font change reverted

Ken, after round 21: "it is now slower. See video." A desktop screen
recording (frame-by-frame at 4fps) shows the real sequence on Home after
Share Your Journey: skeleton, then the cached flash paints with pictures,
then ~0.75-1s where the top-right video card and the bottom-left card
turn solid black while the first card stays fine, then everything fills in.
Nothing in the recording shows a stall before first paint, and his Network
tab shows the Google Fonts file at 0 ms (cached) — so round 21's font
theory was not supported by the evidence and I reverted it on both pages
(`feed.html`, `fitness-journeys.html`), since a swapped-in font after
first paint can only add visible movement.

Root cause of the black cards: `preloadFirstRealMedia()` (round 14, widened
in 19 and 20) only ever waited for `items[0]`'s picture. The desktop grid
shows ~6 cards at once and each gets a fresh signed URL on the real fetch,
so cards 2..n swap in as empty dark boxes until their own picture arrives.

Fix: `preloadFirstRealMedia()` now takes the whole batch and waits for the
first screenful in parallel (8 on wide layout, 3 on phone layout) under
one shared 1.2s cap. Both call sites (cache flash in `init()`, and
`loadMoreReel()`) pass the full list. Verified with a 6-post, 1400px-wide
harness (`run_round22_wide.js`): old code preloads 1 image, new code
preloads 6 and the swap lands only after all settle. Rounds 19 first-load,
19 filter-switch, 20 cache-flash and the base cache harness still pass.

## 2026-10-08, round 21 — a render-blocking third-party stylesheet, not a reel-level race, on full page navigations

Ken, after round 20: "I hate to disappoint, but that didn't fix it
either." I asked for deployment confirmation plus a fresh, precisely-
targeted recording. What came back instead was two DevTools Network-tab
screenshots with: "Here's from the latest launch going from workout,
share your journey back to that home button." I don't actually have
those two screenshots in view in this session — they didn't carry over
through a context handoff on my end — so rather than guess at what they
showed, I used the one fact in that sentence I could verify directly:
the trigger is "Working Out -> Share Your Journey -> Home," and every
leg of that is a full page navigation (`fitness-journeys.html` and a
plain `<a href="feed.html">` Home link), not an in-page filter switch.

That's a meaningfully different situation from everything rounds 14-20
fixed. Those were all races INSIDE one already-loaded page (the cache
flash, a filter click, `resetReel()`). A full navigation tears the whole
document down and starts over — and I found something upstream of all
of that reel logic: both `feed.html` and `fitness-journeys.html` load
their custom fonts with a plain `<link rel="stylesheet"
href="https://fonts.googleapis.com/...">`. A `<link rel="stylesheet">`
to any origin, including a third party like Google Fonts, is render-
blocking by default — the browser won't paint anything on the new
document, not even the skeleton that round 16 hoisted all the way above
the Supabase script tag specifically so it couldn't be blocked by a slow
network call, until that external CSS fetch finishes. Round 16 solved
"blocked by a slow script tag"; it never touched this earlier, equally
blocking stylesheet link sitting two lines above it. On a cold cache or
a flaky connection (which the screen recording evidence across rounds
has consistently suggested is part of what Ken's hitting — Working Out
videos specifically being a heavier load than photos), that's a real,
visible stall on every single full page load, immune to any in-page JS
fix because it happens before this page's own script ever gets to run.

Fix (`member-app/feed.html`, `member-app/fitness-journeys.html`, mirrored
byte-identical into `ensemble-fitness-mobile/www/`): switched both
pages' Google Fonts link to the standard "preload, then promote to
stylesheet on load" pattern (`<link rel="preload" as="style" ...
onload="this.onload=null;this.rel='stylesheet'">` plus a `<noscript>`
fallback) — the same technique web.dev recommends for exactly this. The
page now paints immediately with fallback fonts and swaps to the real
ones the moment that stylesheet arrives, instead of blocking first paint
on a third-party round trip. `display=swap` (already in that URL) only
ever covered the font FILES once the stylesheet was already applied; it
never made the stylesheet fetch itself non-blocking, which is the actual
gap this closes.

Verified with a new isolated harness (`run_round21_fontblock.js`):
intercepts the `fonts.googleapis.com` request and delays its response by
2.5s, then measures when the skeleton is actually laid out on screen
(non-zero size via `getBoundingClientRect`, not just present in the
DOM). Revert-checked first: with the old plain blocking `<link>`, the
skeleton doesn't paint until ~2527ms — visibly waiting on the delayed
font request. With the fix, it paints at ~28ms regardless of the font
delay. Also re-ran every prior round's regression harness (12 through
20) — all still pass.

Flagged honestly: this explains the exact trigger Ken's last message
described (a full navigation chain), but it's independent of — not a
replacement for — rounds 14/16/19/20's reel-level fixes, which address a
different class of race inside an already-loaded page and remain
necessary for filter-switch and cache-flash scenarios. If the symptom
persists after this round deploys, the next most useful thing isn't
another guess here: it's that same screen recording ask from last round
(Network tab visible, narrated trigger), resent, since the screenshots
didn't make it into this session.

---

## 2026-10-08, round 20 — the fourth (and, by elimination, most-hit) spot with the same bug: the cache flash's own first paint

Ken: "Yes, unfortunately, it is still doing it. It is a bug that we have
not found yet" — no new recording this time. Rather than ask him for
another one right away, I did the full top-to-bottom pass over every
place this page transitions the reel between states that I flagged as
overdue at the end of round 19, searching the code directly for every
`clearReelSkeleton()` call site instead of waiting on another video.

Found a fourth one, in `init()`'s "paint last visit's screenful instantly"
block — the cache-flash mechanism round 12 originally built. It called
`clearReelSkeleton()` unconditionally, the instant there was ANY cache
hit for this user+filter, before ever checking whether the cached item's
own picture was actually ready to paint. This is the exact same bug
shape as round 14 (which fixed the FLASH-TO-REAL swap) and round 19's fix
B (which fixed plain first-loads and filter switches) — just one step
earlier in the sequence: painting the flash itself, not replacing it.

This one matters more than the other three, structurally: it's the
code path that runs on every Home visit where the cache is still fresh
(the common case for anyone clicking Home repeatedly within the same
browser tab, which is exactly Ken's pattern). In the typical case the
browser still has that picture's bytes hot from the prior visit and this
is invisible — which is almost certainly why round 12 never caught it.
But the signed URL baked into the cache has its own expiry
(`SIGNED_URL_TTL_SECONDS`), and separately the browser can simply evict
image bytes it decoded a while ago under memory pressure — either way,
the skeleton vanished first regardless, with nothing checking whether
there was actually a picture ready to replace it with.

Fix (member-app/feed.html + ensemble-fitness-mobile/www/feed.html, byte-
identical, no intentional divergence in this file): `init()` now calls
`await preloadFirstRealMedia(cachedFeed.items[0])` before clearing the
skeleton for the cache-flash path, same 1.2s cap as everywhere else this
pattern is used. The sub-case where a cache hit has Meal Prep items but
no main reel items still clears immediately, same as before — nothing to
wait for there.

Verified with a new, isolated harness: seeds `sessionStorage` directly
with a crafted cache entry (so this exact path can be tested without
needing to organically build up a cache first) pointing the cached
item's photo at a deliberately slow-loading URL, standing in for "the
browser no longer has this one hot." Confirmed via a revert-first check
that the test genuinely catches the bug (without the fix: skeleton
clears and the flash paints immediately, before the image is ready, at
~300ms; with the fix: both wait for the image, landing together around
900ms). Re-ran every regression harness from rounds 12-19 — all still
pass, including `run.js`'s own cache-flash check, which still lands in
~60ms in the normal case (confirming this doesn't add any real delay
when the image is already warm, which is the common case).

With four of these found and fixed across rounds 14, 16, 19 and 20, I
looked specifically for a fifth and didn't find one: I traced every
`clearReelSkeleton()` / skeleton-related call site in the file
(`resetReel`, `loadMoreReel`, `showEmptyReelMessage`, `appendItem`,
`checkForLiveUpdates`, and this cache-flash block) and the live-update
poll (`checkForLiveUpdates`) is the only other thing that touches the
reel's contents outside a full reload or filter switch — it only ever
inserts new items ABOVE existing content without removing or clearing
anything, so it has no equivalent gap to close. If this exact symptom
comes back a fifth time, it's likely either a genuinely new mechanism or
something specific to Ken's own network/device conditions that a
sandboxed test can't reach — at that point the most useful next thing
from Ken would be the Network tab's **timing** waterfall for one slow
load (not just a screen recording) so I can see which particular request
is actually the slow one in production.

## 2026-10-08, round 19 — the real cause of "loads, black screen, loads again" on Home: two more mechanisms, both different from rounds 14 and 16

Ken sent a fresh screen recording (desktop, the wide grid view) after
asking whether round 16 was actually deployed before he last saw this.
Rather than guess at the deployment question, I analyzed the new
recording the same way as round 16 — frame-by-frame, `ffmpeg blackdetect`
for exact timestamps — and it answered the question directly: this is
real, reproducible behavior in the current code, not a stale-deployment
illusion. It's also NOT the same bug as before — two further, genuinely
different mechanisms behind the same "loads, black screen, loads again"
description Ken keeps (accurately) using for what are turning out to be
several distinct causes.

**Mechanism 1 — switching filter chips shows nothing at all while the new
filter loads.** The recording shows Ken tapping "Walking" then back to
"Working Out," and the entire reel area going solid black for close to 2
full seconds — not even the loading skeleton, just bare background.
Reading the code confirmed why: round 12's skeleton only ever gets
painted once, by the page's very first script block, for the initial
load. `resetReel()` (called every time a filter chip is clicked) clears
the reel and goes straight to re-fetching — nothing ever re-shows the
skeleton for a filter switch, so the reel just sits empty for however
long that fetch takes. This is a plain gap in coverage, not a timing
race like the other rounds' bugs.

**Mechanism 2 — the skeleton clears the instant data arrives, not the
instant the picture is actually ready.** The same recording shows a
second, shorter (~180ms) black flash right as Home first loads (after
navigating from Fitness Journeys): the skeleton disappears and the real
card's photo visibly pops in a beat later. This is the SAME underlying
problem round 14 already solved — swapping away a visible loading state
before the real image has actually painted — but round 14's fix
(`preloadFirstRealMedia`) was only ever wired to run `if
(cacheFlashNodes.length)`, i.e. only when replacing a stale cache flash
from a previous visit. On a genuinely fresh load (or right after a
filter switch, once mechanism 1 above is fixed and a skeleton is on
screen again), that condition is false, so the wait never happens and
`appendItem()` clears the skeleton and inserts the real card the moment
the DATA is back — picture loaded or not.

Fix (member-app/feed.html + ensemble-fitness-mobile/www/feed.html, byte-
identical, no intentional divergence in this file):

- `resetReel()` now calls `clearReelSkeleton(); renderReelSkeleton(3);`
  right before `loadMoreReel()`, so every filter switch shows the same
  "something is loading" skeleton the first visit already gets, instead
  of going blank. (Meal Prep's own skeleton isn't touched here — that
  strip doesn't change per filter, so there's nothing to re-show.)
- `loadMoreReel()`'s preload guard is now `if (cacheFlashNodes.length ||
  document.querySelector(".rp-skeleton-placeholder"))` instead of just
  `cacheFlashNodes.length` — covers the cache-flash-replacement case
  exactly as before, PLUS any other moment a skeleton is genuinely on
  screen about to be cleared (first load, or a filter switch now that
  the fix above puts one back up).

Verified with two new, separately-reasoned harnesses (not combined into
one, since they test different mechanisms): one drives an actual filter
chip click with a slowed-down fetch and confirms the reel never goes
fully blank (confirmed this test genuinely catches the bug by reverting
just this fix in a scratch copy first — it does, a clean ~380ms blank
window appears without it); the other drives a plain first load with a
deliberately slow-loading image and confirms `preloadFirstRealMedia` is
actually invoked and waited on before the first real card lands — same
revert-first check, same result (without the fix, the preload is never
even attempted; the swap happens immediately on data-arrival instead).
Re-ran every regression harness from rounds 12-18 — all still pass.
Static checks (div balance, JS syntax, CSS braces) clean.

I want to be upfront about something here: three "rounds" in a row now
(16, 18, 19) have each turned out to be a different bug wearing the same
"loads, black screen, loads again" description, which is a genuinely
confusing pattern to be on the receiving end of as someone not reading
the code. Each one has been real and independently confirmed (video
evidence plus a reproducible test, not just a guess), and each fix has
held up under re-test against every prior round's own test suite — but
I'm flagging the pattern itself in case another black-screen report comes
in: at this point it's worth a fresh, full top-to-bottom pass over every
place this reel transitions between states (skeleton / cache flash / real
content / empty message) rather than chasing another one-off instance,
since this is now the fourth distinct mechanism found in that same area.

## 2026-10-08, round 18 — round 17 itself introduced a frozen-video regression; fixed

Ken, immediately after round 17 shipped: "when I click on workout videos,
all those videos are frozen," plus an Elements-panel screenshot showing a
`<video>` with a perfectly normal-looking `poster` and `src` — nothing
visibly wrong in the markup, which is exactly what a race condition looks
like from the outside. (He also reported Home still double-loading; see
the note at the end of this entry on that.)

This one was a real regression I introduced, not a pre-existing bug Ken
was newly spotting — worth saying plainly. Root cause: round 17 split one
job across two separate IntersectionObservers watching the same card —
the existing `reelObserver` (plays a video once it's 60%+ visible) and
the new `videoSrcObserver` (assigns the real `src` once it's within
400px). Two different observer instances firing on the same element have
no guaranteed order between them. For any card already on screen the
instant it's added — the first row the user sees right after switching
filters, exactly what Ken was looking at — both can fire on the same
frame. When `reelObserver` happened to run first, it called `.play()` on
a video that still only had `data-src` (no real `src` yet), which the
browser silently does nothing with — no error, just never starts. Because
`reelObserver` only fires again on a NEW visibility-threshold crossing,
nothing ever came back to call `.play()` once `videoSrcObserver` assigned
the real `src` a moment later. The video sat there fully formed —
poster, correct src, no console error — just permanently paused.

Reproduced this directly rather than guessing: a Playwright harness that
loads the "Working Out" filter fresh (same conditions as switching
filters) and checks every well-visible (>60%) video's actual play state
a couple seconds later. Against round 17 alone, it intermittently (not
every run — exactly the "no guaranteed order between two observers"
signature) found fully-visible cards stuck paused despite having a valid
`src` and a fully-loaded `readyState`; digging one level deeper by
instrumenting `.play()` itself caught the actual browser error on the
frozen card: `AbortError: The play() request was interrupted by a new
load request` — the smoking gun for "`.play()` was called while `src`
was still being swapped in."

Fix (member-app/feed.html + ensemble-fitness-mobile/www/feed.html, byte-
identical, no intentional divergence in this file): `reelObserver`'s
play-triggering branch now assigns the real `src` itself first (pulling
it from `data-src` if it's still sitting there) before ever calling
`.play()`, regardless of which observer happened to run first. This
closes the race outright instead of just making it less likely —
whichever of the two observers fires first for a given card, the video
always has its real source in place before playback is attempted.
`videoSrcObserver` still does the actual early-loading work for the
common case (a card approaching the viewport during normal scrolling,
well before it crosses 60%) — this is purely a safety net for the
simultaneous-on-load case.

Verified: ran the same harness 6 times against round 17 alone (intermittently
reproduced the frozen state, confirming the test is meaningful and not a
false alarm) and 6 times against this fix (zero frozen videos, every run).
Re-ran round 17's own lazy-loading proof (cards below the fold still don't
fire a network request until they're actually close) to confirm this fix
didn't quietly undo that savings. Re-ran every regression harness from
rounds 12-16 — all still pass. Static checks (div balance, JS syntax,
CSS braces) clean.

**On "Home still double-loads":** I tested this specific mechanism
thoroughly in round 16 and it held up again in this round's regression
pass — so before assuming the round 16 fix itself is incomplete, I need
to rule out a simpler explanation first: whether the round 16 zip was
actually merged into the combined repo and pushed (so Netlify rebuilt
and it's genuinely live) before that retest happened, versus Ken testing
against a browser/CDN cache of what was there before. Flagging this
rather than guessing further — will ask directly and, if it's confirmed
deployed and still happening, treat it as a fresh investigation (another
screen recording, same methodology as round 16) rather than assume
round 16's fix was wrong.

## 2026-10-08, round 17 — "Working Out" filter's heavy video loading, investigated and fixed

Ken, following up on the item flagged at the end of round 16: the "Working
Out" filter's Network tab showed 206 requests, 47.4MB, over a 2.5 minute
browsing session, with a lot of entries showing a cancelled status (one
specific request Ken pointed to, "under a BB8D4564 code," had several
cancels). Asked to dig in properly this time rather than leave it flagged.

Built a Playwright harness that serves a real, range-seekable test video
through the exact same code path (not a screenshot guess) to see what's
actually happening at the network level when this page loads videos.

First finding, and important to say plainly: a SINGLE cancelled request per
video turned out to be completely normal browser behavior, not a bug in
this code at all. Every `<video>` tag on the open web does this — Chrome
makes an initial plain request, notices the server supports byte-range
requests (any Supabase Storage signed URL does), cancels that first one,
and immediately reissues a real range request instead. That's almost
certainly most of what Ken saw next to each individual video in the
Network tab, and it would show up identically on Instagram, YouTube, or
any other video-heavy site. Confirmed this with the harness: it happens
every single time, from a correctly-working page, with nothing to fix.

Second finding, and this part WAS a real, worth-fixing issue: every
video's real `src` was being set the instant its card was inserted into
the reel, not the instant it was actually about to be seen. loadMoreReel
fetches a fresh page of 8 posts somewhat ahead of the user actually
scrolling there (by design — see round "Oct 2026" hiccup fix elsewhere in
this file), and when that batch of 8 lands, ALL 8 cards' videos used to
immediately start their metadata fetch (and the cancel/range dance above)
together, regardless of whether a given card was right in front of the
user or three screens below. Confirmed with a focused test: loaded the
first page of 8 "Working Out" posts with zero scrolling, and checked
network activity against each card's actual on-screen position — before
this fix, all 8 cards fired a video request immediately, including ones
sitting 500-1100px below the fold; after, only the 4 cards actually
on-screen fired immediately, with the other 4 correctly waiting.

Fix (member-app/feed.html + ensemble-fitness-mobile/www/feed.html, byte-
identical, no intentional divergence in this file): `buildSlide()` now
puts a video's real URL in a `data-src` attribute instead of `src`, so
the browser has nothing to fetch yet. A new `videoSrcObserver`
(IntersectionObserver, 400px margin) assigns the real `src` — once, the
first time a card gets within 400px of the viewport — then stops
watching that card. This only changes WHEN a video's first network
request happens, not how many videos can play at once simultaneously
once visible, which Ken already confirmed is intentional (several cards
legitimately playing together on the wide desktop grid, see the existing
comment by `reelObserver`). Confirmed via the same harness that playback
and looping behave identically once a card is actually visible — nothing
about the play/pause/mute logic changed.

Deliberately NOT touched: the Meal Prep strip's own small video grid
(`renderMealPrepSkeleton`, a separate markup path) — it only ever shows 5
items, a much smaller blast radius, and this fix was scoped to the one
place Ken actually flagged.

Verified: static checks (div balance, JS syntax with HTML comments
stripped — same false-alarm note as round 16 applies here too, the
checker still trips on literal "<script>"-looking text inside long
comments — and CSS braces) all clean. Re-ran every existing regression
harness from rounds 12-16 (cold load, cache-hit reload, slow-image swap
timing, the hoisted-skeleton timing check) — all still pass unchanged.
Built a before/after comparison (a scratch copy with this fix reverted,
run through the identical test) specifically to make sure this write-up
isn't just asserting an improvement without showing it.

## 2026-10-08, round 16 — the "black screen, then loads again" glitch was back, for a different reason than round 14

Ken, after round 14 shipped: "I'm sending you this screenshot because we're
having some load issues again... I don't think we've debugged that glitch
on refreshing correctly. I think something else is still missing." Same
symptom description as round 14 (loads, black screen, loads again), but
this time it was a genuinely different bug wearing the same costume —
round 14's fix was confirmed still live and working throughout this
investigation.

Ruled out the obvious suspects one at a time with Ken's help, each via a
specific DevTools check: no JS errors in Console (clean); not a literal
double page load (Network showed exactly 1 request for feed.html, not 2);
not a stale/undeployed fix (searched the live page's source for
`preloadFirstRealMedia` and found it exactly where round 14 put it). None
of that explained a real, visible black stretch, which meant the bug had
to be something a screenshot can't capture — a timing issue that needed to
be watched happening. Asked Ken for a short screen recording of the glitch.

Analyzed that recording with `ffmpeg`'s `blackdetect` filter (frame-by-
frame, not by eye) and found a genuine ~290ms fully-black window in the
reel area, starting the moment Ken navigated back to Home. Pulled the
individual frames from that window and confirmed something more specific
than "no real content yet": the loading skeleton itself — the gray
shimmer cards built in round 12 specifically so the reel never sits
blank — was completely absent during that window, even though other
static parts of the page (header, sidebar copy) had already painted.

Root cause, found by reading the code with that clue in hand:
feed.html's skeleton-painting code
(`renderReelSkeleton()`/`clearReelSkeleton()`/`renderMealPrepSkeleton()`,
plus the initial calls that fire them) lived inside the page's main inline
`<script>` block, which comes AFTER a run of plain (non-`defer`/`async`)
`<script src>` tags — including the Supabase SDK, fetched fresh from a
CDN every load. A plain `<script src>` blocks the HTML parser from running
anything after it until that script finishes downloading and executing, so
on any load where the CDN fetch wasn't instant (slower connection, nothing
cached), the skeleton — built to run "instantly, before a single network
request goes out" — was itself stuck waiting on a network call it never
actually needed. That's the real mechanism behind "quick load, black
screen, load again": the skeleton's own code hadn't run yet.

Fix (member-app/feed.html + ensemble-fitness-mobile/www/feed.html, byte-
identical, no intentional divergence in this file): moved the skeleton
function definitions and their initial `renderReelSkeleton(3)` /
`renderMealPrepSkeleton(5)` calls into their own `<script>` block, placed
before the Supabase CDN `<script src>` tag (and every other `<script
src>` on the page). Confirmed via code read that these functions touch
nothing from the blocked scripts — no `window.sb`, no Supabase client, just
plain DOM calls — so nothing downstream breaks by them running earlier.
Everything that calls them later (`appendItem`, `showEmptyReelMessage`, the
cache-flash check in `init()`) still finds them exactly as before, since
plain global function declarations work the same regardless of which
`<script>` tag defines them. Left a marker comment at the old location
pointing to the new one, so a future search for "round 12" or "skeleton"
in that spot doesn't look like the code vanished.

Verified three ways before delivery: (1) static checks — div-tag balance,
JS-syntax-parse of every inline `<script>` block (with HTML comments
stripped first, since my own explanatory comment happens to contain the
literal text `<script>` and tripped the naive check otherwise — a false
alarm from the checker, not a real bug, confirmed by re-running the check
with comments stripped), and CSS brace balance — all clean. (2) A new
Playwright harness that intercepts the Supabase CDN request and delays it
by 800ms on purpose, then timestamps exactly when the skeleton first
appears in the DOM versus when that delayed script finally executes: the
skeleton now paints at ~280ms, a full ~550ms before the delayed CDN script
even finishes — proof the skeleton is no longer blocked behind it. (3)
Re-ran every existing regression harness from rounds 12-14 (cold load,
cache-hit reload, slow-image swap timing) — all still pass unchanged,
confirming this fix didn't disturb the earlier ones.

Also fixed in the same pass: the first version of this edit only added the
new, earlier copy of the skeleton code without removing the original copy
further down the file — caught before any testing or delivery, since
leaving both in would have painted the skeleton correctly the first time
but then inserted a second, duplicate set of skeleton cards once the
(now-unblocked) external scripts finished loading a moment later. Removed
the stale duplicate; only one copy of this code exists now.

**Still open, not yet investigated** — flagged by Ken in the same batch of
screenshots but set aside to focus on the black-screen glitch first: the
"Working Out" filter view showed unusually heavy video loading in the
Network tab (206 requests, 47.4MB, repeated cancelled range-requests for
what looked like the same video). Worth a dedicated look next, once
confirmed with Ken that it's still happening.

## 2026-10-08, round 15 — Fitness+ switched to a free "Coming Soon" waitlist

Ken, after researching how other apps handle this: "Keep the Fitness+ tab
visible, but instead of immediately asking for $14.99, present this
invitation" — a free early-access waitlist card instead of a live payment
ask, preserving the $14.99 founding price as what people are signing up
for later rather than abandoning it. Same underlying decision as round 13's
check-in (don't restrict/charge before there's a real population), applied
to the one place on the site that was already asking for money today.

Before this, fitness-plus.html opened with a live Stripe "Get the Founding
Rate" button for every non-subscriber, every time — and if they paid,
there was a real chance of an empty or near-empty matches grid waiting for
them, by far the worst version of this feature's first impression.

Changes (member-app/fitness-plus.html + ensemble-fitness-mobile/www/
fitness-plus.html, byte-identical, no intentional divergence in this
file):

- An already-active (paid) Fitness+ member sees NO change at all — same
  upgrade card, same live Stripe link, same real matches grid. Checked via
  `profiles.fitness_plus_active`, same flag the page already gated on.
- Everyone else now sees a "❤️ FITNESS+ · COMING SOON" card (adapted from
  Ken's reference screenshot, restyled to match the site's existing card
  language) with a free "Join the waitlist — it's free" button — no
  Stripe link anywhere on the page for them. The $14.99 founding price is
  still shown, framed as "locked in when Fitness+ opens."
- The "Your matches" section is hidden entirely for non-subscribers
  instead of showing the old "Subscribe above to unlock" message, since
  there's no subscribe button left on the page to point at.
- New table `fitness_plus_waitlist` (sql/fitness-plus-waitlist.sql, Ken
  needs to run this once in the Supabase SQL Editor — same as every other
  new-table migration in this folder) captures signups. Deliberately
  separate from `fitness_plus_active` — joining the waitlist is pure
  interest capture, it never grants real paid access. RLS: a member can
  insert/see only their own row; admins can see all rows (no admin UI for
  this yet, just leaving the door open the way other admin-gated tables
  here already do). A returning waitlisted member sees "You're on the
  list" instead of the button again.

Verified with a Playwright harness covering all three states (active
paying member / new visitor joining live / returning already-joined
visitor) before delivery — each renders exactly the intended card, the
live Stripe link is absent whenever it should be, and the join click
correctly writes `{ user_id }` and flips to the confirmed state.

## 2026-10-07, round 14 — fixed the "loads quickly, black screen, loads again" glitch on Home

Ken, after applying round 12/13: "I'm reloading the page on the website, and
I'm also doing it on my cell phone... it loads quickly, but then black
screen, then loads again. So it's doing a double load." Reproducible on both
the website and the phone, which pointed at the shared feed.html logic, not
anything platform-specific.

Root cause: round 12's stale-while-revalidate cache flash shows a
photo/video the browser already downloaded and decoded on a PRIOR visit, so
it paints instantly. But Supabase signed URLs aren't stable across visits —
the real fetch always gets a freshly-signed URL for the same storage file,
so even the exact same photo has to be downloaded again from scratch. The
swap from flash to real used to happen the instant the real DATA came back
from the database, not the instant the real PICTURE had actually finished
downloading — so for however long that fresh image took to load, the swap
traded an already-loaded, visible flash card for a card whose <img>/<video>
hadn't painted anything yet, showing nothing but the slide's own dark
background. Right after the snappy flash, that reads exactly as Ken
described it: quick load, then black, then load again.

Confirmed this empirically before touching anything: wrote a Playwright
harness that logs the exact frame-by-frame DOM state across a reload with
the cache flash active — found ZERO frames where the reel's child count
ever dropped to zero, which ruled out a DOM-removal-without-replacement bug
and pointed specifically at image-paint timing (not something a DOM-count
check alone would ever catch) as the real mechanism. Then built a second
harness that simulates a slow-to-load "freshly signed" image distinct from
an instant cached one, to directly measure when the swap happens relative
to when the real image is actually ready.

Fix (member-app/feed.html + ensemble-fitness-mobile/www/feed.html,
byte-identical, no intentional divergence in this file): added
`preloadFirstRealMedia(item)` — when there's an actual cache flash on
screen to replace, the real fetch's first item's photo (or video poster) is
preloaded and awaited before the flash is cleared, capped at 1.2s so a slow
connection never leaves stale content on screen indefinitely. The swap now
always trades one loaded picture for another loaded picture, never for a
blank one. Verified with the second harness: swap now happens at the
simulated image's actual ready time (~785ms with a 700ms simulated decode
delay), not at data-arrival time (~250ms) as before. Re-ran the existing
round-12/13 regression harnesses (cold load, cache-hit reload, genuinely-
empty real result after a flash) — all still pass with no duplication, no
leaked skeleton, no behavior change outside of the one timing fix.

Also hardened, while in there (found via code audit, not a reported
symptom, but worth closing while this file was already open): the cache-
flash render loop (`cachedFeed.items.forEach(appendItem)`) now runs inside
try/finally when resetting `renderingCacheFlash`. Previously, if a single
cached item ever threw while rendering (e.g. a stale shape left over from
an old `FEED_CACHE_VERSION`), that flag would stay stuck `true` for the
rest of the session, silently disabling `clearCacheFlash()` forever — real
new posts would start piling up below the stale flash instead of ever
replacing it. Not something that was observed happening, just a real gap
closed defensively.

## 2026-10-07, round 13 — squeezed the first (cold) Home load too

Immediate follow-up to round 12. Ken, on hearing that one lever was left
unpulled: "definitely if we can squeeze, we should squeeze... we are going
to be in competition with other sites, especially dating sites. The ease
and speed of the site is crucial." So this pulls it — the thing round 12
flagged but skipped: the very first Home load of a browser session (before
the new cache has anything to show yet) still had to wait on a member's
avatar photo before their post could render at all.

Same pattern this file already uses for reaction/comment counts
(`actionCountsCache`/`renderActions`, the Oct 2026 fix): a post no longer
waits on `attachAvatarUrls()` to render. It shows up immediately with the
plain colored-initial circle (the same fallback this app has always shown
for a member with no photo at all — nothing new there), tagged
`rp-avatar-pending` with a `data-avatar-user` attribute and a very subtle
pulse so it reads as "loading," not "broken." `attachAvatarUrls()` still
runs, just unawaited now (new `hydrateAvatars()`), and the instant it
resolves it finds every still-pending card for that member and swaps in
the real photo — same idea as `preloadActionCounts` already uses, just for
avatars instead of counts. Applied everywhere a post renders: the main
`buildItems()` path (used by both the Meal Prep strip and the general
reel) and `fetchJournalBatch()` (the "Journeys" filter's own query, which
had the exact same blocking call). Reaction/comment counts were
deliberately left blocking, unlike avatars — `renderActions()`'s own
per-item fallback query only stays out of the picture when the batched
preload actually finishes BEFORE a card asks for it; letting it run
unawaited would silently bring back the "16 round trips for 8 posts"
problem that Oct 2026 fix eliminated in the first place. Avatars don't
have that problem: there's always a correct, already-existing fallback
(the colored initial) to show in the meantime, so there's nothing to get
wrong by not waiting.

Net effect: the very first Home load of a session — the one case round
12's cache can't help, since there's nothing cached yet — now renders
posts roughly one round trip sooner than before. Every Home visit after
that first one is still the near-instant cache flash from round 12
regardless.

**Verified** the same way as round 12, with the fake-Supabase test
harness, specifically giving one mock member a profile photo and one
none: confirmed posts render before the avatar fetch resolves; confirmed
the member WITH a photo gets it swapped in correctly once it's ready;
confirmed the member withOUT one stays on the colored-initial fallback
indefinitely, exactly as it always has; and re-ran the full round-12
regression suite (skeleton, cache flash + replace, and the genuinely-empty
edge case) to confirm none of that broke. Website and mobile copies
confirmed byte-identical after the change, and the usual div-balance/
script-syntax/CSS-brace checks are clean on both.

---

## 2026-10-07, round 12 — Home's load time, fixed properly (not just faster-feeling)

Follow-up to the "why does Home take a second to fill in" question from
earlier today. Ken's call once he heard the diagnosis: "if you're going to
fix it, you might as well fix it right... we can't think one through ten
people using the site, we have to think ten to ten thousand." So this
isn't the quick cosmetic patch floated earlier — it's the real fix, built
and tested to hold up as the member base grows, not just to feel faster
for one person right now.

**What was actually slow, confirmed from the code (feed.html = Home):**
every page in this app is its own separate HTML file, so every tap on
Home is a genuinely fresh page load — nothing carries over from the page
you were just on. Once that fresh load starts, before a single real post
can appear it has to make a chain of database/storage round trips where
each one waits on the last: confirm sign-in, fetch the batch of posts,
generate fresh secure viewing links for every photo/video (a separate,
slower call to Supabase's storage-signing service), then pull avatars and
reaction/comment counts. Roughly 4 round trips, each ~150-300ms, stacking
up to right around the one second Ken was seeing — and the content area
sat completely blank the whole time, which read as "stuck" rather than
"working."

**Three changes, all in `feed.html` (website + mobile — identical file,
copied straight across to `ensemble-fitness-mobile/www/feed.html` same as
always):**

1. **Instant loading skeleton.** Shimmering placeholder cards (new
   `.rp-skeleton-*` CSS) render in the reel and the Meal Prep strip the
   moment the script starts running — before requireAuth, before a single
   network call goes out. `clearReelSkeleton()` removes them the instant
   real content (or a real "nothing here" message) is ready, from
   whichever path gets there first. Cosmetic, but it means there is never
   another silent blank gap again, on any connection speed, at any load.

2. **Stale-while-revalidate cache (the real fix).** The last screenful of
   posts this browser tab successfully loaded now gets saved to
   `sessionStorage` (keyed per member + active filter, `efit_feed_cache_
   v1:<userId>:<filter>`) right after a normal load finishes. The next
   time Home loads in that same tab — exactly Ken's "bouncing between
   Music Library, Fitness Journeys, and Home" scenario — that cached
   screenful paints INSTANTLY, with zero network calls, while the real,
   authoritative fetch still runs in the background exactly as it always
   has and silently replaces the cached content the moment it's ready
   (`clearCacheFlash()`, called from `appendItem`/`showEmptyReelMessage`
   the instant real data — or a real empty state — arrives, so a cache hit
   never lingers or risks showing something stale forever). The cache is
   intentionally short-lived (10 minutes, `FEED_CACHE_MAX_AGE_MS`) and
   scoped to the one browser tab (`sessionStorage`, not `localStorage` —
   gone the moment the tab closes), so it's never trusted for long. This
   is also the part that matters at Ken's stated scale: it's a genuine cut
   in how many fresh database/storage round trips Home makes per visit,
   not a trick that only changes how fast one visit *feels* — fewer
   repeated queries per member per session is exactly what keeps this
   holding up as the member count grows from ten toward ten thousand,
   where the earlier Sept 2026 "speed pass" (parallelizing queries that
   used to run one after another) had already gotten as far as
   query-ordering alone could take it.

3. Left on the table for now, noted here in case it's wanted later: the
   avatar photo is still one of the things the FIRST (cold, no-cache)
   load of a session has to wait on before a post can render — reaction/
   comment counts already hydrate in separately after the post appears
   (an existing pattern, `actionCountsCache`/`renderActions`), but the
   avatar image is still baked into the card's initial HTML. Decoupling
   it the same way reaction counts already work would shave roughly one
   more round trip off just the very first Home visit of a session (every
   visit after that is already instant via the cache above regardless).
   Smaller win, more surgical surgery on a very large file — skipped this
   round to keep this change reviewable and well-tested; flagging it as
   the next lever if Ken wants the first-ever load tightened up too.

**Verified** with a headless-browser test harness (a fake Supabase client
with artificial network delay standing in for the real one, since this
sandbox has no live Supabase access): confirmed skeleton cards appear
before any network call resolves; confirmed a cold first load correctly
writes the cache after rendering; confirmed a second visit in the same
tab paints the cached screenful in well under 100ms, before the (mocked)
real fetch could possibly have returned; confirmed the real fetch then
replaces the flash with zero duplicate cards; and confirmed the edge
case where the real fetch comes back genuinely empty still correctly
clears the stale flash and shows the real "nothing here" message rather
than leaving stale cards stranded on screen. Also re-ran the usual
div-balance / inline-script-syntax / CSS-brace-balance checks on both the
website and mobile copies, and confirmed the two files are still
byte-identical after the change.

---

## 2026-10-07, round 11 — Real Journeys card text brightened (website + mobile)

Ken, comparing a desktop screenshot against an actual-phone screenshot of
the same cards: "those icons need to be brighter. You can't really make
them out... I also think we should do the writing in bright white, just
like the member profile names... that light gray, you can't make it
out... you can read it on a computer, but it would be better if it's just
white, and you definitely can't make it out on a cell phone."

Four elements in the Real Journeys cards were sitting at the same dim
secondary-metadata gray as "Member since" — too low-contrast for content
that's the actual point of the card, worse on a phone screen:

- The small round category icon badge (e.g. the 🧠/⚖️/💪 circle next to
  the ⋮ menu) — background bumped from `rgba(255,255,255,0.08)` with no
  border to `rgba(255,255,255,0.16)` with a visible border, plus a
  slightly larger icon, so the badge itself has enough contrast to read
  against the dark card.
- The category pill text ("Mental Health", "Weight Loss", etc., the
  `.fj-cat-chip`) — text color `var(--muted-invert)` → `#fff`, to match
  the brightness of the member's name as Ken asked, plus a slightly
  stronger pill background/border.
- The italic quote on illustrative example cards (`.fj-quote`, e.g. "22
  pounds down, but honestly the sleep improvement is the real win.") —
  `var(--muted-invert)` → `#fff`.
- The date/mood line on real posts (`.fj-meta-line`, e.g. "Tue, Oct 6 ·
  Felt Excellent...") — `var(--faint-invert)` → `rgba(255,255,255,0.92)`.

Scoped to just these four classes inside `fitness-journeys.html`'s own
`<style>` block — didn't touch the shared `--muted-invert`/`--faint-invert`
variables in `css/app.css`, so secondary metadata elsewhere ("Member
since", reply timestamps, etc.) is unchanged, on this page and everywhere
else in the member app. This part of the file is shared between web and
mobile (it's outside the round-8 hero divergence), so the same fix was
applied to both `member-app/fitness-journeys.html` and `ensemble-fitness-
mobile/www/fitness-journeys.html` identically. Verified by injecting
sample real + example cards into a headless-browser render of the updated
file — icon badge, category pill, quote, and meta line all render clearly
brighter than before.

---

## 2026-10-06, round 10 — fitness-journeys.html widened for desktop/website

Ken compared the member (logged-in) view of `fitness-journeys.html` against
the public marketing site's own journeys page (`marketing-site/fitness-
journey.html`, shown to visitors who aren't signed in) and flagged that the
member version "narrows... it's set up like a cell phone shot" on a normal
desktop browser, where the marketing page uses the site's full width. Two
concrete asks: widen the page overall, and show the real-journeys grid 4
cards across instead of 2 — "ultimately this could be thousands of
journals a day... we need to widen our platform here once you're a member."

Root cause: every member-app page shares one `.app-shell` container class
(`css/app.css`) capped at `max-width: 720px` — right for a single centered
form page like `profile.html` or `feed.html`, but too narrow for this
page's photo hero and multi-card grid. `.fj-grid` was already
`grid-template-columns: repeat(auto-fit, minmax(320px, 1fr))` — it was
always capable of showing more columns, it just never had the room.

Fix, scoped to this page only (did not touch the shared `css/app.css`, so
no other member page changed width): `fitness-journeys.html` now overrides
`.app-shell` to `max-width: 1440px` in its own `<style>` block. The hero
and the real-journeys grid use the full new width (the grid now lays out
4 columns at normal desktop widths, confirmed with a headless-browser
check). The composer form and the "How It Works" card are wrapped in a new
`.fj-narrow` class (`max-width: 760px`, centered) so form inputs don't
stretch edge-to-edge and the 3-step "How It Works" grid doesn't fan out
into 6+ skinny columns — both looked wrong at the full 1440px width in
testing. `marketing-site/` itself was not touched; it was only the visual
reference for what Ken wanted this page to resemble.

Ken was explicit this is a website-only fix: "that narrow view may be
perfect for the mobile phone. But not for the website." On an actual phone
screen `.app-shell`'s max-width never kicks in anyway — the screen itself
is already narrower than even the old 720px cap — so this change has zero
visual effect on the mobile app. The same CSS was still mirrored into
`ensemble-fitness-mobile/www/fitness-journeys.html` purely so the two
files don't drift apart more than necessary; the mobile file's round-8
hero divergence (no photo hero, no quick-jump buttons) is unchanged and
is still the only thing that actually looks different on a phone.

---

## 2026-10-06, round 9 — feed.html "Share Your Journey" sidebar panel copy update

Small wording fix to the `rpJourneyPanel` sidebar panel on `feed.html` (the
dark card with the 🌱 icon, "SHARE YOUR JOURNEY" heading, and the
"Share Your Journey →" link to `fitness-journeys.html`). Ken sent a
screenshot and asked to drop the "live the moment you share it" clause and
split the line into two sentences instead.

Old: "Post a win, a struggle, or a question — visible to the whole
community, live the moment you share it."

New: "Post a win, a struggle, or a question — visible to the whole
community. Your journey may be exactly what someone else needs today."

This panel has always been a straight byte-for-byte copy between
`member-app/feed.html` and `ensemble-fitness-mobile/www/feed.html` (unlike
`fitness-journeys.html`, which now intentionally diverges — see round 8
below), so the same edit was applied to both files identically. Verified
with a diff that the two files still match outside this one line, and ran
the usual div-balance / inline-script-syntax / CSS-brace-balance checks on
both — all clean.

---

## 2026-10-06, round 8 — mobile app's journeys page now diverges from the website's, on purpose

⚠️ **Maintenance note for future rounds**: `fitness-journeys.html` was
copied straight across to mobile, byte-for-byte, every round up through
round 7. **That's no longer true for the top section of the page.** Ken,
after seeing the mobile app's actual Share Your Journey screen: "we don't
want our members scrolling at all... let's remove stronger together, real
people, real progress, every post, the start your journey tab, the view
recent journey tab, see how it works tab." His reasoning: the mobile app
already has its own bottom-nav tab for Journeys, so the website's photo
hero and 3 quick-jump buttons (useful on a long page with a nav bar at the
top, not the bottom) are just extra scrolling to get through on mobile
before reaching the actual form. Explicitly website-only for the hero:
"this is for the mobile app only."

So, mobile app's `www/fitness-journeys.html` now has NO photo hero and NO
hero buttons. In their place: "Stronger Together" (same orange script
style) directly above a bold "Share Your Journey" heading, then straight
into the Date/Category/Activity/… form — no subtitle text either, per
Ken's "we literally want them to have the date and category, activity, and
so on" right under the heading. Everything else in the file — the composer
form itself, the category pills, the real-journeys grid, the example
cards, How It Works at the bottom, and every line of CSS and JavaScript —
is still identical to the website's and still gets copied across the same
way as always. Only that one top section is now hand-maintained separately
for mobile. **Future rounds**: when editing `member-app/fitness-
journeys.html`, do NOT blindly overwrite `ensemble-fitness-mobile/www/
fitness-journeys.html` with a straight file copy anymore — diff the two
first, re-apply this mobile-specific header swap on top of whatever
changed, same as this entry describes.

## 2026-10-06, round 7 — hero subtitle: Ken sent the exact final wording

Rounds 5 and 6 were both reasonable guesses at restructuring the sentence
to control the line break — Ken settled it by sending a screenshot of the
exact text and line break he wanted, so this round just matches it exactly
rather than guessing again. Final text, with the line break exactly where
he placed it:

"Every post here is from a real Ensemble Fitness member — the wins, the
hard days, [line break] and everything in between. Share where you're at,
and cheer someone else on."

This is actually the same wording the page launched with in round 4/5 —
the `<br>` just now sits at the exact point Ken wants the wrap to happen,
same forced-break approach as round 6 so it doesn't depend on guessing
screen width.

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
