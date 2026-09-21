-- =============================================================================
-- Product photo tagging — "Real people. Real products." on Fit Marketplace
-- =============================================================================
-- Ken's ask (Sept 2026): let members tag a photo upload with the product
-- they're using in it (running shoes, recovery oils, protein, etc.), so the
-- marketing site's Fit Marketplace page can show real member photos instead
-- of placeholder gradient boxes — but only ever approved ones, same
-- moderation queue as every other photo/video (admin.html), so it stays
-- "healthy" per Ken's own words.
--
-- This only adds one nullable column. No new table, no new bucket, no RLS
-- changes needed: the existing "media is visible if approved, owned, or
-- admin" policies on public.media and storage.objects already allow anyone
-- (including a logged-out visitor on the marketing site) to read a row/file
-- once its status is 'approved' — that's exactly what the marketplace page
-- needs and already has, for free.
--
-- Run this in the Supabase SQL editor after schema.sql (and after any other
-- sql/*.sql files already applied) — it only adds one column and is safe to
-- run more than once.
-- =============================================================================

alter table public.media add column if not exists product_tag text;

comment on column public.media.product_tag is
  'Optional free-text product name a member attaches to a photo upload (e.g. "Running shoes", "Recovery oil", "Protein powder"). Only meaningful for kind = ''photo''. Surfaced on the Fit Marketplace "Real people. Real products." section once the row is approved.';
