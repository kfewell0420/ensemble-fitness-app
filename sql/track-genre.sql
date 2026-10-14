-- Song categories (Oct 2026): artists pick one when they upload, members filter by it in the
-- "Music tracks" list. One line — safe to run more than once.
alter table public.tracks add column if not exists genre text;
