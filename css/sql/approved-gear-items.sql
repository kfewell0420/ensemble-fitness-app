-- =============================================================================
-- Approved Gear — admin-managed picks (replaces hand-editing a JS file)
-- =============================================================================
-- Ken's ask (Sept 2026): a way to add real Approved Gear picks himself —
-- paste an Amazon link, upload a photo, write his note — straight from
-- admin.html, tied into the Fit Marketplace/Approved Gear pages, without
-- ever touching code. This adds the table + storage bucket that powers it.
--
-- Once this table has at least one active row, the public Approved Gear
-- page (approved-gear.html) shows these instead of the EXAMPLE PICK
-- placeholders in js/approved-gear-picks.js — that file stays in place as
-- the fail-open fallback if the database is ever unreachable, so the page
-- never renders empty.
--
-- Run this in the Supabase SQL editor after schema.sql (and after any other
-- sql/*.sql files already applied).
-- =============================================================================

create table if not exists public.approved_gear_items (
  id           uuid primary key default gen_random_uuid(),
  category     text not null,          -- "equipment" | "recovery" | "hydration" | "wearables" (matches js/approved-gear-picks.js keys)
  name         text not null,
  note         text,                   -- Ken's own one-line take on why it made the cut
  price        text,                   -- free text, e.g. "$49.99" — Amazon's own price, never a markup (see below)
  amazon_url   text not null,          -- plain product link; the Associate Tag is appended client-side, same as the static picks
  image_path   text,                   -- storage path in the public "gear-photos" bucket, nullable (falls back to a placeholder icon)
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  created_by   uuid references auth.users (id)
);

-- Deliberately no "markup" or "our price" column: an Amazon Associates link
-- always sends the customer to Amazon's own listed price — there is no
-- point in that flow where a seller-set markup could apply. Charging more
-- than Amazon's price for a product would require actually reselling it
-- (its own inventory/payments/shipping/tax setup), which this table does
-- not model.

alter table public.approved_gear_items enable row level security;

drop policy if exists "approved gear items are publicly readable if active" on public.approved_gear_items;
create policy "approved gear items are publicly readable if active"
  on public.approved_gear_items for select
  using (is_active = true or public.is_admin());

drop policy if exists "only admins manage approved gear items" on public.approved_gear_items;
create policy "only admins manage approved gear items"
  on public.approved_gear_items for insert
  with check (public.is_admin());

drop policy if exists "only admins update approved gear items" on public.approved_gear_items;
create policy "only admins update approved gear items"
  on public.approved_gear_items for update
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "only admins delete approved gear items" on public.approved_gear_items;
create policy "only admins delete approved gear items"
  on public.approved_gear_items for delete
  using (public.is_admin());

-- -------------------------------------------------------------------------
-- Storage bucket for gear photos. PUBLIC (unlike the private "media"
-- bucket) — these are Ken's own official product photos meant to be shown
-- to every visitor, including logged-out ones on the public marketing
-- site, so a plain public URL is simplest (no signed-URL machinery needed).
-- -------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('gear-photos', 'gear-photos', true)
on conflict (id) do nothing;

drop policy if exists "only admins upload gear photos" on storage.objects;
create policy "only admins upload gear photos"
  on storage.objects for insert
  with check (bucket_id = 'gear-photos' and public.is_admin());

drop policy if exists "only admins update gear photos" on storage.objects;
create policy "only admins update gear photos"
  on storage.objects for update
  using (bucket_id = 'gear-photos' and public.is_admin());

drop policy if exists "only admins delete gear photos" on storage.objects;
create policy "only admins delete gear photos"
  on storage.objects for delete
  using (bucket_id = 'gear-photos' and public.is_admin());

-- No public storage.objects select policy is needed: the bucket itself is
-- public, so Supabase serves any object in it via a plain public URL
-- (storage.from('gear-photos').getPublicUrl(path)) regardless of RLS.
