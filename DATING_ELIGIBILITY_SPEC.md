# Dating Eligibility, Age Verification & Discovery Filters — Engineering Addendum

This is a short addendum to `Ensemble Fitness — Developer Build Package v5`, alongside the existing
`FEED_SPEC.md` addendum. It captures product decisions for **Dating Mode** — the adult-only,
opt-in layer of the app that is separate from the general fitness/community experience — made
after the main build package was written.

## 1. Scope: Dating Mode is a separate system, not a feature flag on the main app

Ensemble Fitness has two experiences sharing one account:

- **Community/Fitness** — workouts, check-ins, the home feed, fitness partner matching. Open to
  any verified adult member (existing rules from the main build package apply).
- **Dating Mode** — romantic/relationship discovery. 18+ only, opt-in, with its own eligibility
  gate, its own filters, and its own visibility rules.

Signing up for Ensemble Fitness, or being active in the fitness community, must never by itself place
a member into Dating discovery. The two are permissioned independently (see §3).

## 2. Age comes from verified identity, not a typed profile field

- Store a single source of truth: `profiles.verified_date_of_birth`. This field is written only
  by the identity/age-verification step of onboarding (the same verification pipeline already
  responsible for account trust/photo moderation in the main build package) — never by a
  free-text "Birthday" field the member can edit themselves.
- If a member has not completed identity verification, they have no `verified_date_of_birth` and
  are therefore not dating-eligible (see §3) — verification-incomplete and under-18 are treated
  identically by every check in this document.
- Compute **age** from `verified_date_of_birth` at read/query time (or via a nightly batch job
  that refreshes a materialized value). Never store age as a separately-editable number that could
  drift from the verified birth date.
- **Never send `verified_date_of_birth` to any client app.** Every API response a client can see —
  profile cards, discovery results, match details, admin tooling included — exposes only the
  computed integer `age` (e.g., `42`), never the underlying date. This is a response-shaping rule,
  not just a UI rule: the field should not exist in the payload at all.

## 3. Dating Mode is its own permission, gated by age

- Add `profiles.dating_mode_enabled` (boolean, default `false`).
- Turning this on requires, in order:
  1. `verified_date_of_birth` is present.
  2. Computed age ≥ 18.
  3. The member explicitly taps a "Turn on Dating Mode" control and accepts dating-specific terms
     (this is a distinct action from anything in fitness-community onboarding).
- If either (1) or (2) fails, the Dating Mode toggle is not just disabled in the UI — the endpoint
  that would enable it must reject the request server-side regardless of what the client sends.
- Turning Dating Mode **off** must immediately remove the member from every other member's
  discovery feed, search index, and match suggestions — not just stop surfacing new matches to
  them. Treat it the same as a hard delete from the dating index, reversible only by opting back
  in.

## 4. Mutual age eligibility (the core discovery rule)

Each member sets their own dating age-range preference:

- `dating_preferences.age_pref_min`, `dating_preferences.age_pref_max` — e.g. 35–50.

Two members are only shown to each other when the ranges overlap **in both directions**:

- Viewer's computed age falls within Candidate's `[age_pref_min, age_pref_max]`, **and**
- Candidate's computed age falls within Viewer's `[age_pref_min, age_pref_max]`.

Both conditions must hold. A one-directional match (Viewer wants to see Candidate's age bracket,
but Candidate's own preference excludes Viewer's age) must never surface either person to the
other. This is a symmetric filter, not two independent filters applied separately to two feeds.

Implement this as a query-level condition (a `WHERE`/join predicate, or a database view/function)
in the discovery and search service — not a filter applied to results after they've already been
fetched. Doing it at the query layer keeps it fast at scale and makes it the same code path every
caller uses, which matters for §7.

## 5. Additional dating-specific filters

Alongside the mutual age-eligibility rule, Dating Mode discovery supports independently-set
filters, combined with AND logic against the base eligible set:

| Filter | Example values |
|---|---|
| Distance | 5 / 10 / 20 / 50+ miles |
| Gender preference | who the member is interested in meeting |
| Relationship intent | Long-term relationship / Dating / Open to connection |
| Workout schedule | mornings / evenings / weekends, etc. |
| Fitness interests | strength training, running, pickleball, yoga, etc. |
| Lifestyle habits | smoking, drinking, diet preference, etc. |

These live in `dating_preferences` alongside `age_pref_min`/`age_pref_max`, and are edited from the
same "Who are you interested in meeting?" screen (§6). None of them substitute for or weaken the
age-eligibility rule in §4 — age is enforced first and independently of every other filter.

## 6. UI: "Who are you interested in meeting?"

Keep the primary controls simple and visual — this is the whole surface most members will touch:

```
Who are you interested in meeting?

Age:        35 ─────●───────● 50
Distance:   20 miles
Looking for: ○ Long-term relationship   ● Dating   ○ Open to connection
```

- Age is a min–max range control, not a single value.
- This screen edits `dating_preferences` only. It must never read, display, or allow editing of
  `verified_date_of_birth` — members change their own age range preference here, not their age.

## 7. Under-18 protection — defense in depth

A minor (no verified DOB, or computed age < 18) must never:

- Appear as a candidate in another member's Dating discovery feed or search results.
- Be able to open Dating Mode screens at all, even by direct URL/deep link.
- Send or receive a dating-channel message (dating messaging should be a distinct
  channel/table from general fitness-community messaging, gated by the same age + opt-in check —
  do not reuse the fitness messaging thread table for dating conversations).
- Appear in any dating-related push notification, digest email, or admin/moderation dating report.

Because a bug in any single endpoint could otherwise leak a minor into one of these surfaces,
enforce eligibility at the data layer, not per-endpoint:

- If on Postgres/Supabase (as the member-app already is), add **Row Level Security policies** on
  the dating-visibility tables/views that hard-bake "age ≥ 18 AND dating_mode_enabled AND mutual
  age-range overlap" into the database itself. A misconfigured or future endpoint querying that
  table directly still cannot return an ineligible row, even if it forgets to re-check.
- Run a recurring job that re-validates eligibility (e.g., a birthday just crossed 18, or
  moderation later determines an account belongs to a minor) and immediately revokes
  `dating_mode_enabled` plus purges that member from any cached discovery/search indexes.

## 8. Server-side enforcement is non-negotiable

The UI hides the Dating Mode toggle and filters controls from ineligible members, but **the
server is the actual gate**, not the screen. Every dating-related endpoint — discovery feed,
search, profile view, match creation, messaging — must independently verify, on every request:

1. Viewer has a verified DOB and computed age ≥ 18.
2. Viewer has `dating_mode_enabled = true`.
3. Candidate has a verified DOB and computed age ≥ 18.
4. Candidate has `dating_mode_enabled = true`.
5. Mutual age-range overlap (§4) and any other active filters (§5).

Implement this once as a shared server-side helper (a single query/view/function that every dating
endpoint calls) rather than re-implementing the checks per-endpoint — the goal is that the rule
lives in exactly one place, so it can't quietly drift out of sync between, say, the discovery feed
and the search endpoint.

## 9. Suggested data model additions

```
profiles
  verified_date_of_birth   date        -- write-only by the identity verification service
  dating_mode_enabled      boolean     -- default false

dating_preferences
  user_id                  uuid        -- references profiles(id)
  age_pref_min             int
  age_pref_max             int
  distance_pref_miles      int
  relationship_intent      text/enum   -- long_term | dating | open_to_connection
  gender_pref              text/enum[]
  workout_schedule_pref    text/enum[]
  fitness_interests        text[]
  lifestyle_habits         jsonb
```

`age` itself is never stored as a raw editable column — always computed from
`verified_date_of_birth` at query/render time.

## 10. QA checklist before Dating Mode ships

- [ ] A verified 17-year-old cannot see the Dating Mode toggle, cannot reach any dating screen by
      direct link, and does not appear in any other member's discovery results.
- [ ] A member with no completed identity verification is treated identically to an under-18
      member for every check above.
- [ ] Two 40-year-olds with age ranges 35–50 and 45–60 do **not** see each other (35–50 excludes
      45; the overlap must be mutual, not just one-directional).
- [ ] Two 42- and 47-year-olds with ranges 35–50 and 40–55 **do** see each other.
- [ ] Turning Dating Mode off immediately removes the member from another active member's
      discovery feed on their next refresh — not just from future match suggestions.
- [ ] No API response reachable by a client (profile card, discovery feed, match detail, admin
      tooling) ever contains `verified_date_of_birth` — only the computed `age`.
- [ ] Directly querying the dating-visibility table/view with a client that bypasses the app's own
      endpoints (e.g., a raw Supabase query with an anon key) still cannot return an ineligible row
      — confirms the rule is enforced by RLS/database, not only application code.
