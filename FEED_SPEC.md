# Home Feed & Active Members — Engineering Addendum

This is a short addendum to `Ensemble Fitness — Developer Build Package v5`, covering the home feed
behavior previewed on the marketing site (`index.html`, "Active Members" rail and "Latest
Workouts" video grid). It captures product decisions made after that document was written.

## 1. Two statuses that must never be conflated

Every member surfaced in the feed has two independent signals. The UI must always be able to show
either one without implying the other:

| Signal | Meaning | UI treatment |
|---|---|---|
| **Active Now** | The member is currently checked in / live, right now, via Check-In. | Bright green indicator, pulsing dot, label reads exactly "Active Now" — never a timestamp. |
| **Posted \<time\> ago** | How long ago a specific video/post was uploaded. | Neutral dark pill on the video card, e.g. "Posted 8m ago" — always present, independent of live status. |

A member can be:
- Active Now with no recent post (just checked in, hasn't posted a video).
- Posted-only (uploaded a video, not currently checked in).
- Both at once (checked in right now *and* has a recent video attached).

**Do not** replace a "Posted 8m ago" label with "Active Now," and do not show "Active Now" based on
post recency. They come from different systems (Check-In service vs. Feed/Media service) and can
disagree — e.g. someone posted 5 minutes ago but has since ended their check-in.

## 2. Active Members rail (top of home)

- Horizontally scrolling row of circular member avatars, Stories-style.
- Sort order: **Active Now members first** (by check-in recency), then everyone else by post
  recency. Active-now members always outrank posted-only members regardless of post age.
- Ring treatment: bright green ring + pulsing badge for Active Now. Gradient/accent ring for
  members with an unseen recent post. Neutral gray ring once the viewer has seen that post.
- Tapping a bubble opens the same story-style viewer used by the video grid (see §4).

## 3. Latest Workouts video feed (below the rail)

- Initial paint shows 6–10 videos without any interaction. Additional videos load in batches
  (pagination or infinite scroll) rather than a hard cap — the marketing-site demo uses a "Load
  More" button in batches of 8 as a stand-in for real infinite scroll.
- Each card shows: member (avatar + name, tap → profile), workout type, "Posted \<time\> ago",
  approximate area *only if the member chose to share it* (omit the chip entirely otherwise — do
  not show a fuzzy default), and a video duration badge.
- Card actions: **Watch** (tap the thumbnail), **Follow** (toggle), **View Profile** (tap
  avatar/name), and a primary action that's context-dependent:
  - **Join Workout** (primary/filled button) when the poster is Active Now.
  - **Connect** (secondary/outline button) when they're not currently active.
- A card's own post-age never blocks Join Workout / Connect from being available if the person is
  presently Active Now, and never implies Active Now if they're not.

## 4. Shared story viewer

- Full-screen-ish modal, IG-Stories style: progress bar, name, activity + "posted X ago" (+
  "Active now" only when true), video area, two quick stats, caption.
- Auto-advances on a timer; pauses while pressed/held; swipe/click zones and arrow-key navigation
  move through the same ordering as the Active Members rail (§2), regardless of whether the viewer
  was opened from the rail or a grid card.

## 5. Ranking model (feed order)

Not purely reverse-chronological. Intent, in priority order once there's enough signal:

1. **Active Now boost** — people currently checked in surface higher, especially in the rail.
2. **Recency** — newer posts generally rank higher, with decay over hours, not a hard cutoff.
3. **Proximity** — posts from members within the viewer's search radius rank higher than
   far-away posts of similar age/quality.
4. **Activity affinity** — posts matching the viewer's selected activities/interests (from their
   profile and Fitness Partner search history) rank higher than off-interest content, even if
   newer. Example: a strength-training + pickleball user should not see a feed dominated by
   running videos just because those happened to post most recently.
5. **Follows** — posts from people the viewer follows or has connected with get a further boost.
6. **Engagement** — watch-through rate, replies, and connect/join actions feed back in as a
   secondary signal once there's enough volume to measure it.

Cold-start behavior (new user, no history yet): weight recency + proximity most heavily, since
affinity/follow signals don't exist yet. Re-weight toward affinity/follows as the account accrues
activity. This should be a server-side ranking service, not client-side sorting — the marketing
site's `FEED_ORDER` array is a static, hand-picked approximation for demo purposes only.

## 6. Privacy notes carried over from the main build package

- Approximate area is opt-in per post/check-in and should reuse the existing general-area /
  radius logic already specified for Active Now — never plot an exact address on a card or in the
  story viewer.
- "Active Now" in the feed context must respect the same visibility settings (Everyone Nearby /
  Verified Users / Matches / Fitness Partners Only) already specified for check-ins. A video card
  should not surface an Active Now badge to a viewer who wouldn't otherwise be allowed to see that
  member's check-in.
