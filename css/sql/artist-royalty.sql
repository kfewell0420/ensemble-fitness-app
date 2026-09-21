-- =============================================================================
-- Artist royalty flag — "100% Royalties" badge
-- =============================================================================
-- Ken's policy: independent/unsigned artists (no label or publisher contract
-- covering the track) keep 100% of any future royalties on music posted to
-- Ensemble Fitness. This adds the flag admins check when adding a track in
-- admin.html, so the Music Library (music-library.html) can show a "100%
-- Royalties" badge on qualifying tracks — a visible hook for the "freelance
-- artist" pitch Ken wants front-and-center.
--
-- Run this in the Supabase SQL editor after schema.sql (and after any other
-- sql/*.sql files already applied) — it only adds one column and is safe to
-- run more than once.
-- =============================================================================

alter table public.tracks
  add column if not exists is_independent_artist boolean not null default false;

comment on column public.tracks.is_independent_artist is
  'Set true when the admin confirms, at submission time, that the artist is not signed to a label or publisher for this track — those artists keep 100% of any future royalties. Drives the "100% Royalties" badge in the Music Library.';
