-- =============================================================================
-- Track tagline + duration
-- =============================================================================
-- Ken's ask (Sept 2026): the Music Library's track list was showing title +
-- artist name + a "100% Royalties" badge — he wants it lighter than that: a
-- short, motivating one-line tagline about the track instead of the artist's
-- name, plus the track's length, iTunes-style but with less clutter. Artist
-- name/bio/link still show on the track's own full page (track.html).
--
-- Run this in the Supabase SQL editor after schema.sql and artist-royalty.sql
-- (and any other sql/*.sql files already applied) — it only adds columns and
-- is safe to run more than once.
-- =============================================================================

alter table public.tracks
  add column if not exists tagline text,
  add column if not exists duration_seconds integer;

comment on column public.tracks.tagline is
  'A short, motivating one-liner about the track (e.g. "Turn this up when the workout gets hard") — shown in the Music Library''s track list in place of the artist name, to keep that list light. Optional.';

comment on column public.tracks.duration_seconds is
  'Track length in whole seconds, read from the audio file automatically when it''s added (in admin.html, either through "Add Track" or "Add to Music Library"). Shown in the track list, iTunes-style. Null for any track added before this column existed.';
