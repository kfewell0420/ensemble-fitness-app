-- =========================================================================
-- Run this in Supabase (Dashboard → SQL Editor → New query → paste → Run).
-- Safe to re-run.
--
-- What this adds, for the new member-view "Share Your Journey" page
-- (Oct 2026, round 4 — the "actual people and their profiles" redesign):
--
-- 1) community_questions.category — the category pill a member picks when
--    posting (Weight Loss / Building Strength / Running / Nutrition /
--    Recovery / Mental Health / Over 40 / Beginners), used for the filter
--    pills on the page and the small activity-icon badge on each card.
--
-- 2) public.profiles_public — a view that hands out a member's AGE as a
--    plain number, without ever handing out their raw date_of_birth to
--    other members' browsers. profiles.date_of_birth is already flagged in
--    schema.sql as "never exposed to other members' clients — only a
--    computed age should ever be" — this view is that computed age. The
--    journeys page (and anything else that wants to show "Name, 34") reads
--    FROM THIS VIEW for other members, never from profiles.date_of_birth
--    directly.
-- =========================================================================

alter table public.community_questions add column if not exists category text;

alter table public.community_questions drop constraint if exists community_questions_category_check;
alter table public.community_questions add constraint community_questions_category_check
  check (category is null or category in (
    'Weight Loss', 'Building Strength', 'Running', 'Nutrition',
    'Recovery', 'Mental Health', 'Over 40', 'Beginners'
  ));

create or replace view public.profiles_public as
select
  id,
  display_name,
  created_at,
  case
    when date_of_birth is null then null
    else floor(extract(year from age(current_date, date_of_birth)))::int
  end as age
from public.profiles;

grant select on public.profiles_public to authenticated, anon;
