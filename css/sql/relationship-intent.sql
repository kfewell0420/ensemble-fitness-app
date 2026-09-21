-- =============================================================================
-- Fitness+ relationship intent — "what are you looking for?"
-- =============================================================================
-- Ken's ask (Sept 2026): Fitness+ matches members on ZIP code and wake-up
-- time, but doesn't say what kind of connection someone actually wants. Add
-- one simple, optional field to the existing profile page — a 3-option
-- dropdown, no new page, no long write-up required to join — so members can
-- optionally flag: Long-term relationship, Dating, or Open to connection.
--
-- This mirrors the existing wake_time_category pattern exactly: one nullable
-- text column, a check constraint limiting it to the allowed values, and a
-- shared options list on the client (see js/supabaseClient.js) so every
-- <select> and every displayed label stay in sync with the values allowed
-- here.
--
-- Intentionally NOT required at signup or on the profile form — it's a
-- Fitness+-flavored preference, not something every member needs to answer,
-- so a member who isn't interested in Fitness+ can just leave it blank.
--
-- Run this in the Supabase SQL editor after schema.sql (and after any other
-- sql/*.sql files already applied) — it only adds one column and is safe to
-- run more than once.
-- =============================================================================

alter table public.profiles add column if not exists relationship_intent text;

alter table public.profiles drop constraint if exists profiles_relationship_intent_valid;
alter table public.profiles add constraint profiles_relationship_intent_valid
  check (relationship_intent is null or relationship_intent in ('long_term', 'dating', 'open_to_connection'));

comment on column public.profiles.relationship_intent is
  'Optional, member-set preference for Fitness+ matching: long_term (Long-term relationship), dating (Dating), or open_to_connection (Open to connection). Null means the member hasn''t said. Set on the My Profile page; surfaced on Fitness+ match cards.';
