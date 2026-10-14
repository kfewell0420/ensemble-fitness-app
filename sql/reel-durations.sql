-- Several videos in one post (Oct 2026): remembers how long each clip is, in order, so ONE song
-- can run across the whole set of clips. One line — safe to run more than once.
-- (Posts that don't have it still play their clips back to back; they just don't carry a song across them.)
alter table public.media add column if not exists clip_durations numeric[];
