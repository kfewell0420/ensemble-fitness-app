-- Healthy Meal Prep: give each meal prep a name (shown on the Explore > Healthy Meal Prep page).
-- Safe to run more than once.
alter table public.media add column if not exists title text;
