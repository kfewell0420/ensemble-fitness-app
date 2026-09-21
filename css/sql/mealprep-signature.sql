-- =============================================================================
-- Healthy Meal Prep — signature field
-- =============================================================================
-- Ken's ask (Sept 2026): let a member "sign" their Healthy Meal Prep post,
-- like a personal recipe card — shown in a script font under their write-up
-- in the Healthy Meal Prep profile view on feed.html, mirroring the
-- "Signed, {name}" touch on the public Healthy Meal Prep marketing page.
-- Optional, and only ever shown for posts tagged workout_type = 'Meal Prep'
-- (the stored category value stays "Meal Prep" everywhere on purpose — see
-- feed.html/admin.html's categoryLabel() — this migration doesn't touch it).
--
-- Run this in the Supabase SQL editor after schema.sql (and after any other
-- sql/*.sql files already applied) — it only adds one column and is safe to
-- run more than once.
-- =============================================================================

alter table public.media add column if not exists signature text;

comment on column public.media.signature is
  'Optional name a member types to "sign" a post, shown in a script font under the write-up — currently only surfaced for Healthy Meal Prep (workout_type = ''Meal Prep'') posts.';
