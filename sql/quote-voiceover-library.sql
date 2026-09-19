-- =============================================================================
-- Quote Voiceover Library
-- =============================================================================
-- Ken curates the quotes (admin.html, same pattern as adding a Music Library
-- track). Members then pick a quote and record themselves reading it aloud —
-- building a library of different members' voices reading the same quotes,
-- browsable on quote-library.html. Recordings publish immediately, same
-- trust model as the existing "Voice Updates" feature (members are trusted
-- to share positive content; an admin can remove one after the fact from
-- admin.html's Community tab if it ever doesn't fit).
--
-- Modeled directly on the Music Library tables (schema.sql, section 8) —
-- same shape, same RLS pattern, just a second table linking recordings to
-- a quote and a member instead of one flat "tracks" table.
--
-- Run this in the Supabase SQL editor after schema.sql (and after any other
-- sql/*.sql files already applied).
-- =============================================================================

create table if not exists public.quotes (
  id           uuid primary key default gen_random_uuid(),
  quote_text   text not null,
  author       text,                   -- optional — who said/wrote it, if known
  is_active    boolean not null default true,
  created_at   timestamptz not null default now()
);

alter table public.quotes enable row level security;

drop policy if exists "signed-in members browse active quotes" on public.quotes;
create policy "signed-in members browse active quotes"
  on public.quotes for select
  using (auth.uid() is not null and is_active);

drop policy if exists "admins manage quotes" on public.quotes;
create policy "admins manage quotes"
  on public.quotes for all
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------

create table if not exists public.quote_recordings (
  id           uuid primary key default gen_random_uuid(),
  quote_id     uuid not null references public.quotes (id) on delete cascade,
  user_id      uuid not null references public.profiles (id) on delete cascade,
  storage_path text not null unique,      -- e.g. "<user_id>/<uuid>.webm"
  is_active    boolean not null default true,
  created_at   timestamptz not null default now()
);

alter table public.quote_recordings enable row level security;

-- Same "publish immediately, spot-checkable" visibility as voice updates:
-- any signed-in member sees active recordings (everyone's, so the library
-- actually works), a member always sees their own even if later removed,
-- and admins see everything.
drop policy if exists "quote recordings visible if active, owned, or admin" on public.quote_recordings;
create policy "quote recordings visible if active, owned, or admin"
  on public.quote_recordings for select
  using (
    (auth.uid() is not null and is_active)
    or auth.uid() = user_id
    or public.is_admin()
  );

drop policy if exists "members record their own reading" on public.quote_recordings;
create policy "members record their own reading"
  on public.quote_recordings for insert
  with check (auth.uid() = user_id and is_active = true);

drop policy if exists "owners or admins remove a recording" on public.quote_recordings;
create policy "owners or admins remove a recording"
  on public.quote_recordings for delete
  using (auth.uid() = user_id or public.is_admin());

drop policy if exists "only admins deactivate a recording" on public.quote_recordings;
create policy "only admins deactivate a recording"
  on public.quote_recordings for update
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- Storage bucket for the spoken-word recordings. Private, same shape as the
-- "tracks" bucket — any signed-in member can read an active recording (or
-- their own), so the library actually plays for everyone, but nothing is
-- guessable/public.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('quote-voices', 'quote-voices', false)
on conflict (id) do nothing;

drop policy if exists "members upload their own quote recording" on storage.objects;
create policy "members upload their own quote recording"
  on storage.objects for insert
  with check (
    bucket_id = 'quote-voices'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "signed-in members read active quote recordings" on storage.objects;
create policy "signed-in members read active quote recordings"
  on storage.objects for select
  using (
    bucket_id = 'quote-voices'
    and (
      public.is_admin()
      or (storage.foldername(name))[1] = auth.uid()::text
      or exists (
        select 1 from public.quote_recordings r
        where r.storage_path = storage.objects.name
          and r.is_active
          and auth.uid() is not null
      )
    )
  );

drop policy if exists "owners or admins delete quote recording files" on storage.objects;
create policy "owners or admins delete quote recording files"
  on storage.objects for delete
  using (
    bucket_id = 'quote-voices'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.is_admin()
    )
  );
