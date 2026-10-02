-- =============================================================================
-- Retire member write-access to the old quote-recording feature
-- =============================================================================
-- Ken's ask (Oct 2026): quotes are now entirely his own curated queue —
-- "remove that from members, that only is to remain with me." The actual
-- "record yourself reading a quote" feature was already pulled from the UI
-- a while back (quote-library.html no longer offers it — see its own
-- comment: "dropped the 'record your own reading' feature entirely"), but
-- the underlying database table (quote_recordings) and storage bucket
-- (quote-voices) still had their original RLS/storage policies letting ANY
-- signed-in member insert a new recording directly through the Supabase API
-- even with no button left anywhere to do it from. This closes that gap so
-- admin is genuinely the only one who can write there, matching what the UI
-- has already implied for a while.
--
-- This does NOT delete the quote_recordings table, the quote-voices bucket,
-- or any recordings members already made — just who can add new ones.
-- Nothing in the current UI reads from either table, so this has no visible
-- effect on quote-library.html, feed.html, or admin.html.
--
-- Safe to run more than once.
-- =============================================================================

drop policy if exists "members record their own reading" on public.quote_recordings;
create policy "only admins add a recording"
  on public.quote_recordings for insert
  with check (public.is_admin());

drop policy if exists "members upload their own quote recording" on storage.objects;
create policy "only admins upload a quote recording file"
  on storage.objects for insert
  with check (
    bucket_id = 'quote-voices'
    and public.is_admin()
  );
