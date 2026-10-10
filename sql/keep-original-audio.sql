-- =============================================================================
-- Keep a video's own sound when a music track is added
-- =============================================================================
-- Artist request (Oct 2026): a workout video that already has music and the
-- member talking in it should keep that sound, with an added track playing
-- softly underneath, instead of the track REPLACING it (the old behavior).
-- Defaults to false, so every existing post behaves exactly as before.
--
-- Run once in the Supabase SQL editor. Safe to run more than once. Until you do,
-- the "Keep my video's own sound" checkbox simply doesn't save (the upload page
-- tells the member) and nothing else breaks.
-- =============================================================================

alter table public.media add column if not exists keep_original_audio boolean not null default false;
