-- =============================================================================
-- "Start the song at …" + artists editing their own songs
-- =============================================================================
-- Ken's request (Oct 2026): some songs have a long intro before the vocals start,
-- so an artist should be able to choose where in the song a post's music begins
-- (at upload, and later from the post's Edit menu), and should be able to fix a
-- song they uploaded (title/tagline, or swap in a better audio file).
--
-- Run once in the Supabase SQL editor. Safe to run more than once. Defaults keep
-- every existing post and song behaving exactly as before.
-- =============================================================================

-- 1) Where in the song a post's music starts (seconds). 0 = the beginning, as before.
alter table public.media add column if not exists music_start_seconds numeric not null default 0;

-- 2) A member may edit THEIR OWN still-active song (title, tagline, audio file, length).
--    They can't take over someone else's song, can't hand it to another member, and can't
--    re-activate a song an admin pulled (is_active must stay true), because both the row
--    being edited and the edited result must still be theirs and active.
drop policy if exists "members edit their own track" on public.tracks;
create policy "members edit their own track"
  on public.tracks for update
  using (submitted_by = auth.uid() and is_active = true)
  with check (submitted_by = auth.uid() and is_active = true);

-- 3) Let a member remove the OLD audio file from their own folder after swapping in a new
--    one (so replaced files don't pile up). Only inside their own folder in the tracks bucket.
drop policy if exists "members remove their own track audio" on storage.objects;
create policy "members remove their own track audio"
  on storage.objects for delete
  using (
    bucket_id = 'tracks'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
