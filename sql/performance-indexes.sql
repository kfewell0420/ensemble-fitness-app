-- =============================================================================
-- Performance indexes — scale-readiness pass (Oct 2026)
-- =============================================================================
-- Ken's ask: "double check speed... before we start having hundreds, if not
-- thousands, of people on it." Postgres does NOT automatically index a
-- foreign key or a column just because it's filtered on — only primary keys
-- and columns with an explicit `unique`/`references` get one for free. A
-- handful of the busiest tables in this schema (media, profiles,
-- journal_entries, story_replies, community_questions, quote_recordings)
-- never got a matching `create index` when they were created, which means
-- every feed load, every "Find Members" search, and every RLS check against
-- them is currently a full table scan — cheap today with a small member
-- base, but it gets slower every single day as rows accumulate, and that
-- slowdown would land hardest exactly when Ken wants the app to feel fastest
-- (a big batch of new members joining at once).
--
-- This file is purely additive: every statement is `create index if not
-- exists`, so it only ever adds something new — it never drops, alters, or
-- touches a single row of actual data, and it's safe to run more than once
-- or alongside any other migration in this folder, in any order.
--
-- Other tables (follows, messages, media_reactions, media_comments,
-- notifications, reports, blocked_users) already have their own indexes —
-- see follows-and-messages.sql / notifications.sql / reports-and-blocks.sql.
-- This file fills in the ones that were missed.
-- =============================================================================

-- public.media — the core content table. Every feed/review-queue query
-- filters on status, every "my own uploads" check filters on user_id, and
-- feed ordering uses created_at — and status is also read on every single
-- row by the "media is visible if approved, owned, or admin" RLS policy.
create index if not exists media_status_created_idx on public.media (status, created_at desc);
create index if not exists media_user_id_idx on public.media (user_id);

-- public.profiles — this is a dating-app matching table at heart: zip_code
-- and wake_time_category are the "Find Members" matching columns (see the
-- comments on those columns above), and fitness_plus_active gates the
-- Fitness+ matches list. All three get scanned member-base-wide today.
create index if not exists profiles_zip_code_idx on public.profiles (zip_code);
create index if not exists profiles_wake_time_category_idx on public.profiles (wake_time_category);
create index if not exists profiles_fitness_plus_active_idx on public.profiles (fitness_plus_active) where fitness_plus_active;

-- public.journal_entries — every select/insert/update/delete RLS policy
-- filters on user_id ("auth.uid() = user_id"), and so does every "show my
-- journal" query from the app itself.
create index if not exists journal_entries_user_id_idx on public.journal_entries (user_id);

-- public.community_questions — the "Share Your Journey" homepage feed reads
-- status = 'approved' ordered by created_at, and the RLS select policy
-- checks status on every row too.
create index if not exists community_questions_status_created_idx on public.community_questions (status, created_at desc);

-- public.story_replies — replies are fetched and ordered per story
-- (question_id), and both the select and insert RLS policies look up the
-- parent story by question_id as well.
create index if not exists story_replies_question_id_idx on public.story_replies (question_id, created_at asc);

-- public.quote_recordings — browsing the Quote Voiceover Library filters by
-- quote_id, and the select RLS policy's "or auth.uid() = user_id" branch
-- filters by user_id.
create index if not exists quote_recordings_quote_id_idx on public.quote_recordings (quote_id);
create index if not exists quote_recordings_user_id_idx on public.quote_recordings (user_id);
