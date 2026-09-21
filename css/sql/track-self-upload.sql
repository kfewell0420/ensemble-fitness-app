-- =============================================================================
-- Track self-upload (artists add straight into the Music Library)
-- =============================================================================
-- Ken's ask (Sept 2026): with artists uploading songs in bulk (20+ at a time),
-- an admin manually retyping title/artist name/artist email/tagline for every
-- single one doesn't scale. New flow: when an artist uploads audio from their
-- own Profile page, it publishes straight to the Music Library automatically
-- (title comes from a "Song title" field they fill in themselves; artist name
-- and email are read from their own account — no admin typing required).
-- Ken reviews the list whenever he gets a chance (weekly or so) and can pull
-- anything that doesn't fit; pulling a self-submitted track sends the artist
-- a friendly note through the existing messages/notifications system.
--
-- This file is safe to run more than once, and safe to run even if you never
-- got around to running the older sql/track-tagline-and-duration.sql — every
-- column here is added with "if not exists", so this one file covers both.
--
-- Run this in the Supabase SQL editor before deploying the matching code.
-- =============================================================================

alter table public.tracks
  add column if not exists tagline text,
  add column if not exists duration_seconds integer,
  add column if not exists artist_email text,
  add column if not exists submitted_by uuid references public.profiles(id) on delete set null;

comment on column public.tracks.tagline is
  'A short, motivating one-liner about the track — shown in the Music Library''s track list in place of the artist name, to keep that list light. Optional.';

comment on column public.tracks.duration_seconds is
  'Track length in whole seconds, read from the audio file automatically when it''s added. Shown in the track list, iTunes-style. Null for any track added before this column existed.';

comment on column public.tracks.artist_email is
  'The artist''s email, so Ken can send a payout/bank-linking setup link. Filled in automatically from the uploader''s own account for a self-submitted track, or typed by Ken for one he adds manually.';

comment on column public.tracks.submitted_by is
  'The member (profiles.id) who uploaded this track themselves through their Profile page, if any. Used so Ken can send that member a friendly note through the normal messages/notifications system if the track is ever pulled for not fitting the community guidelines. Null for a track Ken added himself through the admin "Add Track" form.';

-- ---------------------------------------------------------------------------
-- Let a signed-in member publish their own track (previously only Ken/admin
-- could insert into tracks or upload into the 'tracks' storage bucket at
-- all). A member can only ever insert a row crediting themselves
-- (submitted_by = their own id) — they still can't edit or deactivate any
-- track afterward (including their own); that stays admin-only, same as
-- before, through the existing "admins manage tracks" policy.
-- ---------------------------------------------------------------------------
drop policy if exists "members publish their own track" on public.tracks;
create policy "members publish their own track"
  on public.tracks for insert
  with check (auth.uid() is not null and submitted_by = auth.uid());

drop policy if exists "members upload their own track audio" on storage.objects;
create policy "members upload their own track audio"
  on storage.objects for insert
  with check (
    bucket_id = 'tracks'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

