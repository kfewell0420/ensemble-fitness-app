-- =========================================================================
-- Public read access for reactions + comments on real videos
-- =========================================================================
-- Lets a signed-out visitor on the public marketing site (ensemblefitness.com)
-- see the REAL thumbs-up/muscle counts and REAL comments on a real member's
-- video — they still can't post a reaction or comment without signing in
-- (there's no anonymous insert/update/delete policy, and none is added
-- here). This only adds a second, public SELECT policy alongside the
-- existing "signed-in members only" one — it doesn't remove or weaken
-- anything already in place.
-- Run once in the Supabase SQL Editor. Safe to re-run.
-- =========================================================================

drop policy if exists "media_reactions_select_public" on public.media_reactions;
create policy "media_reactions_select_public"
  on public.media_reactions
  for select
  to anon
  using (true);

drop policy if exists "media_comments_select_public" on public.media_comments;
create policy "media_comments_select_public"
  on public.media_comments
  for select
  to anon
  using (true);
