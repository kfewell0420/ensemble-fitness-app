-- Initial Connection Status badges (run AFTER sql/connection-status.sql).
-- Safe to rerun. Step 1 is a preview only; step 2 changes data.

-- STEP 1: preview — check these are the right people (matches are by display name, ignoring capitals).
select id, display_name, connection_status
from public.profiles
where lower(display_name) in ('shampagne88', 'inspired365network', 'fitnessdev', 'lorrainewhittington1', 'donato thegift')
order by display_name;

-- STEP 2: set the badges that are confirmed so far.
-- 💍 Taken — the only married member.
update public.profiles
set connection_status = 'taken'
where lower(display_name) = 'shampagne88';

-- 💗 Open to Connect — Ken (Inspired365Network), single.
update public.profiles
set connection_status = 'open_to_connect'
where lower(display_name) = 'inspired365network';

-- Still waiting on Ken's confirmation (not applied yet):
--   💗 open_to_connect  — the other male members (FitnessDeV, Donato TheGift?)
--   💗 / 🤝            — the Fitness+ women (lorrainewhittington1 + one more)
