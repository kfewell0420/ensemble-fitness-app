-- =========================================================================
-- Allow multiple simultaneous reactions per person per post
-- =========================================================================
-- Today media_reactions has one row per (media_id, user_id) — so a member
-- can only ever have ONE reaction type active on a given post at a time;
-- picking a different one (e.g. 💪 after 👍) replaces it instead of adding
-- to it. This migration widens the primary key to (media_id, user_id,
-- reaction_type) so each reaction type is tracked independently, letting
-- someone have 👍 AND 💪 (and ❤️) all active on the same post at once.
--
-- Safe to run on existing data: every current row already has at most one
-- reaction type per (media_id, user_id), so nothing is deleted or changed
-- — this only relaxes the constraint going forward.
--
-- Run once in the Supabase SQL Editor. Safe to re-run.
-- =========================================================================

alter table public.media_reactions
  drop constraint if exists media_reactions_pkey;

alter table public.media_reactions
  add constraint media_reactions_pkey
  primary key (media_id, user_id, reaction_type);
