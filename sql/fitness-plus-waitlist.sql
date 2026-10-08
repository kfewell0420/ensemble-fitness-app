-- ============================================================================
-- Fitness+ Waitlist
-- ----------------------------------------------------------------------------
-- Ken's ask (Oct 2026): until Ensemble Fitness has enough members for the
-- matches grid to actually mean something, fitness-plus.html stops asking
-- for the $14.99/month founding rate up front and instead shows a free
-- "Coming Soon" card people can register early interest in — no payment,
-- no Stripe link, just a name on a list Ken can look at (and the "we'll
-- email you when it opens" promise it implies). This table is that list.
--
-- Deliberately separate from `profiles.fitness_plus_active` (the real,
-- paid flag the Stripe webhook sets) — joining this waitlist never grants
-- real Fitness+ access on its own, it's just interest/lead capture. Same
-- direct-client + RLS pattern as follows/messages (sql/follows-and-messages.sql)
-- since this doesn't touch money either.
--
-- Run this once in the Supabase SQL Editor for the Ensemble Fitness project.
-- ============================================================================

create table if not exists public.fitness_plus_waitlist (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.fitness_plus_waitlist enable row level security;

drop policy if exists "fp_waitlist_select_own" on public.fitness_plus_waitlist;
drop policy if exists "fp_waitlist_select_admin" on public.fitness_plus_waitlist;
drop policy if exists "fp_waitlist_insert_own" on public.fitness_plus_waitlist;

-- A member can see whether THEY already joined (so the page can show "You're
-- on the list" instead of the join button again on a later visit).
create policy "fp_waitlist_select_own"
  on public.fitness_plus_waitlist
  for select
  to authenticated
  using (auth.uid() = user_id);

-- Admins can see the whole list (for whenever Ken wants a count or an export
-- — no admin UI for this yet, just leaving the door open the same way every
-- other admin-gated table here does).
create policy "fp_waitlist_select_admin"
  on public.fitness_plus_waitlist
  for select
  to authenticated
  using (exists (select 1 from public.admins a where a.user_id = auth.uid()));

-- A member can only ever add THEMSELVES to the list, once (the primary key
-- on user_id makes joining twice a harmless no-op conflict, not a duplicate
-- row) — never on someone else's behalf.
create policy "fp_waitlist_insert_own"
  on public.fitness_plus_waitlist
  for insert
  to authenticated
  with check (auth.uid() = user_id);
