-- =========================================================================
-- Ensemble Fitness — Member Uploads schema
-- Run this once in your Supabase project's SQL Editor (Dashboard → SQL Editor
-- → New query → paste this whole file → Run).
-- Safe to re-run: uses "if not exists" / "or replace" everywhere it can.
-- =========================================================================

create extension if not exists pgcrypto;

-- -------------------------------------------------------------------------
-- 1. PROFILES  (one row per member, mirrors auth.users)
-- -------------------------------------------------------------------------
create table if not exists public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  display_name  text,
  bio           text,
  date_of_birth date,        -- required at signup; see handle_new_user() below. Never exposed to
                              -- other members' clients — only a computed "age" should ever be.
  zip_code      text,        -- required at signup; see handle_new_user() below. Intentionally
                              -- public (same select policy as the rest of this table) so members
                              -- can find each other on the Find Members page.
  wake_time_category text,   -- required at signup; see handle_new_user() below. One of the five
                              -- buckets in js/supabaseClient.js's WAKE_TIME_OPTIONS. Intentionally
                              -- public, like zip_code, so members can match on it too.
  created_at    timestamptz not null default now()
);

-- If this table already existed before these columns were added, this picks them up.
alter table public.profiles add column if not exists date_of_birth date;
alter table public.profiles add column if not exists zip_code text;
alter table public.profiles add column if not exists wake_time_category text;

-- Defense in depth: the database itself refuses to store an under-18 birth date, no matter what
-- inserted/updated the row. Existing rows with no birth date on file (null) are left alone.
alter table public.profiles drop constraint if exists profiles_date_of_birth_18plus;
alter table public.profiles add constraint profiles_date_of_birth_18plus
  check (date_of_birth is null or date_of_birth <= (current_date - interval '18 years')::date);

-- Same defense-in-depth pattern for ZIP code: must be a plain 5-digit US ZIP when present.
-- Existing rows from before this was added (null) are left alone until the member fills theirs in.
alter table public.profiles drop constraint if exists profiles_zip_code_format;
alter table public.profiles add constraint profiles_zip_code_format
  check (zip_code is null or zip_code ~ '^[0-9]{5}$');

-- Same pattern again for wake-up time: must be one of the five known buckets when present.
-- Existing rows from before this was added (null) are left alone until the member fills theirs in.
alter table public.profiles drop constraint if exists profiles_wake_time_category_valid;
alter table public.profiles add constraint profiles_wake_time_category_valid
  check (wake_time_category is null or wake_time_category in ('early_bird', 'early_riser', 'standard', 'late_riser', 'night_owl'));

alter table public.profiles enable row level security;

drop policy if exists "profiles are publicly readable" on public.profiles;
create policy "profiles are publicly readable"
  on public.profiles for select
  using (true);

drop policy if exists "users can insert their own profile" on public.profiles;
create policy "users can insert their own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

drop policy if exists "users can update their own profile" on public.profiles;
create policy "users can update their own profile"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Auto-create a profile row the moment someone signs up. Date of birth, ZIP code, and wake-up
-- time are all required and enforced HERE, at the database layer — not just in the signup form's
-- UI. The app passes them as signup metadata (options.data.date_of_birth / .zip_code /
-- .wake_time_category); if any is missing or invalid, the whole signup is rejected and no account
-- is created, regardless of what the client sent.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  dob date;
  zip text;
  wake_time text;
  api_key   text;
  notify_to text;
  from_addr text;
begin
  dob := nullif(new.raw_user_meta_data->>'date_of_birth', '')::date;
  zip := nullif(new.raw_user_meta_data->>'zip_code', '');
  wake_time := nullif(new.raw_user_meta_data->>'wake_time_category', '');

  if dob is null then
    raise exception 'Date of birth is required to create a Ensemble Fitness account.';
  end if;

  if dob > (current_date - interval '18 years')::date then
    raise exception 'You must be at least 18 years old to join Ensemble Fitness.';
  end if;

  if zip is null or zip !~ '^[0-9]{5}$' then
    raise exception 'A valid 5-digit ZIP code is required to create a Ensemble Fitness account.';
  end if;

  if wake_time is null or wake_time not in ('early_bird', 'early_riser', 'standard', 'late_riser', 'night_owl') then
    raise exception 'Your natural wake-up time is required to create a Ensemble Fitness account.';
  end if;

  insert into public.profiles (id, display_name, date_of_birth, zip_code, wake_time_category)
  values (new.id, split_part(new.email, '@', 1), dob, zip, wake_time)
  on conflict (id) do nothing;

  -- Optional "someone new joined" notification to YOU (the admin) — same
  -- Resend setup as the other notification triggers below (section
  -- 7a/7b/7c). Reads app_settings directly with an exception handler
  -- around it so that even if something about the notification itself
  -- goes wrong, account creation is never blocked by it.
  begin
    select value into api_key   from public.app_settings where key = 'resend_api_key';
    select value into notify_to from public.app_settings where key = 'notify_email';
    select value into from_addr from public.app_settings where key = 'resend_from';

    if api_key is not null and api_key <> 'PASTE_YOUR_RESEND_API_KEY_HERE' then
      perform net.http_post(
        url := 'https://api.resend.com/emails',
        headers := jsonb_build_object('Authorization', 'Bearer ' || api_key, 'Content-Type', 'application/json'),
        body := jsonb_build_object(
          'from', from_addr,
          'to', notify_to,
          'subject', 'New member signed up — Ensemble Fitness',
          'text', new.email || ' just created an Ensemble Fitness account (ZIP ' || zip || ').' || chr(10) || chr(10) ||
                  'There''s no approval step for regular sign-ups — they''re already live. To find them, open admin.html and click the "Members" tab: https://app.ensemblefitness.com/admin.html?tab=members'
        )
      );
    end if;
  exception when others then
    null; -- never let a notification hiccup block someone from signing up.
  end;

  -- Welcome email to the MEMBER themselves — separate from the admin
  -- notification above and from Supabase's own "confirm your email"
  -- message (which still sends independently and still has to be clicked
  -- before they can sign in). This fires every time this trigger fires,
  -- which is every time a brand-new auth.users row is created — including
  -- when someone had to have their old account deleted (e.g. a forgotten
  -- password) and signs up again from scratch, so it isn't a one-time,
  -- first-ever-signup-only thing. Same exception handling as above.
  begin
    if api_key is not null and api_key <> 'PASTE_YOUR_RESEND_API_KEY_HERE' then
      perform net.http_post(
        url := 'https://api.resend.com/emails',
        headers := jsonb_build_object('Authorization', 'Bearer ' || api_key, 'Content-Type', 'application/json'),
        body := jsonb_build_object(
          'from', from_addr,
          'to', new.email,
          'subject', 'Welcome to Ensemble Fitness!',
          'text', 'Hi ' || split_part(new.email, '@', 1) || ',' || chr(10) || chr(10) ||
                  'Welcome to Ensemble Fitness — we''re so glad you''re here!' || chr(10) || chr(10) ||
                  'If you haven''t already, check your email for a separate confirmation link so you can sign in and get started.' || chr(10) || chr(10) ||
                  'Once you''re in: fill out your profile, find members near you, and see what Ensemble Fitness+ is all about.' || chr(10) || chr(10) ||
                  'Glad to have you.' || chr(10) ||
                  'The Ensemble Fitness Team'
        )
      );
    end if;
  exception when others then
    null; -- never let a notification hiccup block someone from signing up.
  end;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- -------------------------------------------------------------------------
-- 2. ADMINS  (allowlist of member user_ids who can moderate)
--    There is no client-facing insert/update policy on purpose — the only
--    way to add an admin is you, manually, in the Supabase Table Editor.
-- -------------------------------------------------------------------------
create table if not exists public.admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.admins enable row level security;

drop policy if exists "a user can check their own admin status" on public.admins;
create policy "a user can check their own admin status"
  on public.admins for select
  using (auth.uid() = user_id);

-- Small helper so later policies stay readable.
create or replace function public.is_admin()
returns boolean
language sql
security definer set search_path = public
stable
as $$
  select exists (select 1 from public.admins a where a.user_id = auth.uid());
$$;

-- -------------------------------------------------------------------------
-- 3. MEDIA  (one row per uploaded photo/video, with moderation status)
-- -------------------------------------------------------------------------
-- user_id references public.profiles (not auth.users directly) so that
-- PostgREST/Supabase can embed profile info in the same query the app uses
-- to show "who uploaded this" in the review queue (media.select("...profiles(display_name)")).
-- profiles.id is always kept in lockstep with auth.users.id by the trigger above.
create table if not exists public.media (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  kind         text not null check (kind in ('photo', 'video', 'audio')),
  storage_path text not null unique,       -- e.g. "<user_id>/<uuid>.mp4"
  caption      text,
  workout_type text,
  location     text,                       -- free-text, member-entered, e.g. "Gold's Gym, Dallas"
  narration_path text,                     -- optional recorded voiceover, plays over a video instead of its own sound
  is_profile_photo boolean not null default false,
  status       text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reject_reason text,
  created_at   timestamptz not null default now(),
  reviewed_at  timestamptz,
  reviewed_by  uuid references auth.users (id)
);

-- If this table already existed before location was added, this picks up the new column.
alter table public.media add column if not exists location text;

-- If this table already existed before voice narration was added, this picks up the new column.
alter table public.media add column if not exists narration_path text;

-- A small JPEG still frame captured client-side at upload time, shown as
-- the video's poster so the feed has something to display instantly
-- instead of a black box while the actual video streams in. Null for
-- older rows uploaded before this existed, and for photos/audio, which
-- don't need one.
alter table public.media add column if not exists poster_path text;

-- Non-destructive video trim points (seconds). Null/null means "play the full
-- video" — the original upload is never altered, this is just a start/end
-- window applied at playback time so members can skip the setup/cooldown
-- and only publish the good part of a longer clip.
alter table public.media add column if not exists trim_start numeric;
alter table public.media add column if not exists trim_end numeric;
alter table public.media drop constraint if exists media_trim_end_after_start;
alter table public.media add constraint media_trim_end_after_start
  check (trim_start is null or trim_end is null or trim_end > trim_start);

-- If this table already existed with the old kind check (photo/video only), widen it
-- to also allow 'audio' — voice updates members record about their day or journey,
-- uploaded the same way as a photo or video and reviewed through the same queue.
alter table public.media drop constraint if exists media_kind_check;
alter table public.media add constraint media_kind_check check (kind in ('photo', 'video', 'audio'));

alter table public.media enable row level security;

drop policy if exists "media is visible if approved, owned, or admin" on public.media;
create policy "media is visible if approved, owned, or admin"
  on public.media for select
  using (
    status = 'approved'
    or auth.uid() = user_id
    or public.is_admin()
  );

-- Feed photos, videos, and audio/voice clips all go into the pending review
-- queue — every upload gets a human look before it's public, so nothing
-- off-brand slips through. (Audio used to publish instantly and skip review
-- entirely; that changed after an unreviewed audio clip went live on its
-- own.) Profile photos (is_profile_photo = true) are the one exception that
-- still publishes immediately — an admin can still remove one after the
-- fact from the review queue's approved-media view / Table Editor.
drop policy if exists "members can upload their own media" on public.media;
create policy "members can upload their own media"
  on public.media for insert
  with check (
    auth.uid() = user_id
    and (
      (kind in ('video', 'audio') and coalesce(is_profile_photo, false) = false and status = 'pending')
      or (kind = 'photo' and coalesce(is_profile_photo, false) = true and status = 'approved')
      or (kind = 'photo' and coalesce(is_profile_photo, false) = false and status = 'pending')
    )
  );

-- Belt-and-suspenders on top of the insert policy above: no row, from any
-- write path (including the admin/service role, which bypasses RLS), can
-- ever be flagged as someone's profile photo unless it's actually a photo.
-- This is what stops a video or voice recording from ending up shown in the
-- circular avatar slot on the profile page.
update public.media set is_profile_photo = false where kind <> 'photo' and coalesce(is_profile_photo, false) = true;
alter table public.media drop constraint if exists media_profile_photo_requires_photo_kind;
alter table public.media add constraint media_profile_photo_requires_photo_kind
  check (not coalesce(is_profile_photo, false) or kind = 'photo');

drop policy if exists "owners can delete their own media" on public.media;
create policy "owners can delete their own media"
  on public.media for delete
  using (auth.uid() = user_id or public.is_admin());

drop policy if exists "only admins can review media" on public.media;
create policy "only admins can review media"
  on public.media for update
  using (public.is_admin())
  with check (public.is_admin());

-- -------------------------------------------------------------------------
-- 4. STORAGE BUCKET + POLICIES
--    Creates a private bucket called "media". Files are only reachable
--    through short-lived signed URLs generated by the app (never a public,
--    guessable URL), and only for people the policies below allow.
-- -------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('media', 'media', false)
on conflict (id) do nothing;

drop policy if exists "members upload into their own folder" on storage.objects;
create policy "members upload into their own folder"
  on storage.objects for insert
  with check (
    bucket_id = 'media'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "media files visible if approved, owned, or admin" on storage.objects;
create policy "media files visible if approved, owned, or admin"
  on storage.objects for select
  using (
    bucket_id = 'media'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.is_admin()
      or exists (
        select 1 from public.media m
        where m.storage_path = storage.objects.name
          and m.status = 'approved'
      )
    )
  );

drop policy if exists "members delete their own files" on storage.objects;
create policy "members delete their own files"
  on storage.objects for delete
  using (
    bucket_id = 'media'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or public.is_admin()
    )
  );

-- -------------------------------------------------------------------------
-- 5. JOURNAL ENTRIES  (Fitness Journey — private per-member workout/progress log)
-- -------------------------------------------------------------------------
create table if not exists public.journal_entries (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles (id) on delete cascade,
  entry_date date not null default current_date,
  activity   text,             -- e.g. "Leg day", "5k run", "Rest day"
  notes      text,
  mood       text,             -- free-text, e.g. "Strong", "Tired", "Great"
  created_at timestamptz not null default now()
);

alter table public.journal_entries enable row level security;

drop policy if exists "members see their own journal entries" on public.journal_entries;
create policy "members see their own journal entries"
  on public.journal_entries for select
  using (auth.uid() = user_id or public.is_admin());

drop policy if exists "members insert their own journal entries" on public.journal_entries;
create policy "members insert their own journal entries"
  on public.journal_entries for insert
  with check (auth.uid() = user_id);

drop policy if exists "members update their own journal entries" on public.journal_entries;
create policy "members update their own journal entries"
  on public.journal_entries for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "members delete their own journal entries" on public.journal_entries;
create policy "members delete their own journal entries"
  on public.journal_entries for delete
  using (auth.uid() = user_id);

-- -------------------------------------------------------------------------
-- 6. COMMUNITY STORIES  ("Share Your Journey" homepage box)
--    Only signed-in, actual members can post — no anonymous strangers — so
--    a post publishes instantly, with no admin approval wait. Admins keep
--    the ability to delete a post after the fact (see the delete policy
--    below) in case something inappropriate gets shared.
-- -------------------------------------------------------------------------
create table if not exists public.community_questions (
  id            uuid primary key default gen_random_uuid(),
  asker_name    text,
  question_text text not null,
  status        text not null default 'pending',
  created_at    timestamptz not null default now(),
  reviewed_at   timestamptz,
  reviewed_by   uuid references auth.users (id)
);

-- Upgrading from the earlier single-answer version of this feature: drop the
-- old answer columns (replies now live in their own table, below) and fold
-- any already-answered rows into "approved" so nothing already live vanishes.
alter table public.community_questions drop column if exists answer_text;
alter table public.community_questions drop column if exists answered_at;
alter table public.community_questions drop column if exists answered_by;
update public.community_questions set status = 'approved' where status = 'answered';
alter table public.community_questions drop constraint if exists community_questions_status_check;
alter table public.community_questions add constraint community_questions_status_check
  check (status in ('pending', 'approved', 'rejected'));

-- Upgrading again: posting used to be open to anyone and held for admin
-- approval. Now it's members-only and auto-publishes, so nobody should be
-- left stuck waiting in the old queue — fold any leftover pending posts
-- (like ones submitted before this change) straight into "approved".
update public.community_questions set status = 'approved' where status = 'pending';

-- Which member posted it — nullable so older, pre-this-change rows (posted
-- before an account was required) don't break.
alter table public.community_questions add column if not exists user_id uuid references public.profiles (id) on delete set null;

alter table public.community_questions enable row level security;

drop policy if exists "answered questions are publicly readable" on public.community_questions;
drop policy if exists "approved stories are publicly readable" on public.community_questions;
create policy "approved stories are publicly readable"
  on public.community_questions for select
  using (status = 'approved' or public.is_admin());

drop policy if exists "anyone can ask a question" on public.community_questions;
drop policy if exists "anyone can post a story" on public.community_questions;
drop policy if exists "members can post a story" on public.community_questions;
create policy "members can post a story"
  on public.community_questions for insert
  with check (
    auth.uid() = user_id
    and status = 'approved'
  );

drop policy if exists "only admins can answer questions" on public.community_questions;
drop policy if exists "only admins can review stories" on public.community_questions;
create policy "only admins can review stories"
  on public.community_questions for update
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "admins can delete stories" on public.community_questions;
create policy "admins can delete stories"
  on public.community_questions for delete
  using (public.is_admin());

-- -------------------------------------------------------------------------
-- 6b. STORY REPLIES  — only signed-in members (real accounts) can reply,
--     and only to a story that's already approved and public.
-- -------------------------------------------------------------------------
create table if not exists public.story_replies (
  id          uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.community_questions (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  reply_text  text not null,
  created_at  timestamptz not null default now()
);

alter table public.story_replies enable row level security;

drop policy if exists "replies visible if parent story is approved" on public.story_replies;
create policy "replies visible if parent story is approved"
  on public.story_replies for select
  using (
    public.is_admin()
    or exists (select 1 from public.community_questions q where q.id = question_id and q.status = 'approved')
  );

drop policy if exists "members can reply to an approved story" on public.story_replies;
create policy "members can reply to an approved story"
  on public.story_replies for insert
  with check (
    auth.uid() = user_id
    and exists (select 1 from public.community_questions q where q.id = question_id and q.status = 'approved')
  );

drop policy if exists "admins can delete replies" on public.story_replies;
create policy "admins can delete replies"
  on public.story_replies for delete
  using (public.is_admin());

-- -------------------------------------------------------------------------
-- 6c. STORY REACTIONS  — instant, one-tap "I see you" support (clap / heart /
--     thumbs up) on a story. Same rule as replies: only signed-in, real
--     members can react, and only to a story that's already approved and
--     public. A member can give a story any/all of the three reactions, but
--     only once each (the unique constraint below is what the app uses to
--     toggle a reaction on/off).
-- -------------------------------------------------------------------------
create table if not exists public.story_reactions (
  id          uuid primary key default gen_random_uuid(),
  question_id uuid not null references public.community_questions (id) on delete cascade,
  user_id     uuid not null references public.profiles (id) on delete cascade,
  reaction    text not null check (reaction in ('clap', 'heart', 'thumbs_up')),
  created_at  timestamptz not null default now(),
  unique (question_id, user_id, reaction)
);

alter table public.story_reactions enable row level security;

drop policy if exists "reactions visible if parent story is approved" on public.story_reactions;
create policy "reactions visible if parent story is approved"
  on public.story_reactions for select
  using (
    public.is_admin()
    or exists (select 1 from public.community_questions q where q.id = question_id and q.status = 'approved')
  );

drop policy if exists "members can react to an approved story" on public.story_reactions;
create policy "members can react to an approved story"
  on public.story_reactions for insert
  with check (
    auth.uid() = user_id
    and exists (select 1 from public.community_questions q where q.id = question_id and q.status = 'approved')
  );

drop policy if exists "members can remove their own reaction" on public.story_reactions;
create policy "members can remove their own reaction"
  on public.story_reactions for delete
  using (auth.uid() = user_id);

-- -------------------------------------------------------------------------
-- 7. CHARTER MEMBER ENROLLMENT  (homepage "Become A Member" / "Join The
--    Community" form). Anyone can submit one — these are prospective
--    members who don't have an account yet — but only an admin can ever
--    read the list, and only an admin can approve or deny one. Nothing is
--    a public waitlist anyone can browse.
-- -------------------------------------------------------------------------
create table if not exists public.charter_enrollments (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  email        text not null,
  zip          text,
  wants_tester boolean not null default false,
  status       text not null default 'pending' check (status in ('pending', 'approved', 'denied')),
  created_at   timestamptz not null default now(),
  reviewed_at  timestamptz,
  reviewed_by  uuid references auth.users (id)
);

alter table public.charter_enrollments enable row level security;

drop policy if exists "only admins can see enrollments" on public.charter_enrollments;
create policy "only admins can see enrollments"
  on public.charter_enrollments for select
  using (public.is_admin());

drop policy if exists "anyone can submit an enrollment" on public.charter_enrollments;
create policy "anyone can submit an enrollment"
  on public.charter_enrollments for insert
  with check (
    status = 'pending'
    and reviewed_at is null
    and reviewed_by is null
  );

drop policy if exists "only admins can review enrollments" on public.charter_enrollments;
create policy "only admins can review enrollments"
  on public.charter_enrollments for update
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "admins can delete enrollments" on public.charter_enrollments;
create policy "admins can delete enrollments"
  on public.charter_enrollments for delete
  using (public.is_admin());

-- -------------------------------------------------------------------------
-- 7a. EMAIL NOTIFICATIONS for new pending photos/videos (optional — safe to
--    skip). Same pg_net + Resend pattern as 7b/7c below — reuses the same
--    app_settings row, so if you've already got a real API key in there,
--    this just works too. Audio never lands here since it auto-approves
--    and skips the review queue entirely.
-- -------------------------------------------------------------------------
create extension if not exists pg_net;

create table if not exists public.app_settings (
  key   text primary key,
  value text
);

alter table public.app_settings enable row level security;
-- Intentionally no select/insert/update policies for anon/authenticated —
-- only this table's owner (via the Table Editor) or a security-definer
-- function (below) can read or write it.

insert into public.app_settings (key, value) values
  ('resend_api_key', 'PASTE_YOUR_RESEND_API_KEY_HERE'),
  ('notify_email', 'ken.fewell@gmail.com'),
  ('resend_from', 'onboarding@resend.dev')
on conflict (key) do nothing;

create or replace function public.notify_new_pending_media()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  api_key     text;
  notify_to   text;
  from_addr   text;
  poster_name text;
begin
  -- Fires for any photo, video, or audio clip actually waiting in the
  -- queue (anything inserted as anything other than 'pending' — just a
  -- profile photo today — skips this notification, same as before).
  if new.status <> 'pending' then
    return new;
  end if;

  select value into api_key   from public.app_settings where key = 'resend_api_key';
  select value into notify_to from public.app_settings where key = 'notify_email';
  select value into from_addr from public.app_settings where key = 'resend_from';

  if api_key is null or api_key = 'PASTE_YOUR_RESEND_API_KEY_HERE' then
    return new; -- Resend not configured yet — skip silently.
  end if;

  select display_name into poster_name from public.profiles where id = new.user_id;

  perform net.http_post(
    url := 'https://api.resend.com/emails',
    headers := jsonb_build_object('Authorization', 'Bearer ' || api_key, 'Content-Type', 'application/json'),
    body := jsonb_build_object(
      'from', from_addr,
      'to', notify_to,
      'subject', 'New ' || new.kind || ' pending review — Ensemble Fitness',
      'text', coalesce(nullif(poster_name, ''), 'A member') || ' just uploaded a ' || new.kind || ' that''s waiting on your review.' || chr(10) || chr(10) ||
              'Open the Review Queue: https://app.ensemblefitness.com/admin.html'
    )
  );
  return new;
end;
$$;

drop trigger if exists on_new_pending_media_notify on public.media;
create trigger on_new_pending_media_notify
  after insert on public.media
  for each row execute procedure public.notify_new_pending_media();

create or replace function public.notify_new_question()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  api_key   text;
  notify_to text;
  from_addr text;
begin
  select value into api_key   from public.app_settings where key = 'resend_api_key';
  select value into notify_to from public.app_settings where key = 'notify_email';
  select value into from_addr from public.app_settings where key = 'resend_from';

  if api_key is null or api_key = 'PASTE_YOUR_RESEND_API_KEY_HERE' then
    return new; -- Resend not configured yet — skip silently.
  end if;

  perform net.http_post(
    url := 'https://api.resend.com/emails',
    headers := jsonb_build_object('Authorization', 'Bearer ' || api_key, 'Content-Type', 'application/json'),
    body := jsonb_build_object(
      'from', from_addr,
      'to', notify_to,
      'subject', 'New Live Chat question on Ensemble Fitness',
      'text', coalesce(nullif(new.asker_name, ''), 'A visitor') || ' asked: ' || new.question_text
    )
  );
  return new;
end;
$$;

drop trigger if exists on_new_question_notify on public.community_questions;
create trigger on_new_question_notify
  after insert on public.community_questions
  for each row execute procedure public.notify_new_question();

-- -------------------------------------------------------------------------
-- 7c. EMAIL NOTIFICATIONS for charter member enrollment (same optional
--     Resend setup as above — reuses the same app_settings row, so if
--     you've already pasted in a real API key, both features just work).
--
--     Two emails, both automatic:
--       1. You get pinged the moment someone new enrolls, so you know to
--          go review it in admin.html.
--       2. The MEMBER gets a generic "Welcome to the community" email the
--          instant you click Approve in admin.html — you never have to
--          send it by hand.
-- -------------------------------------------------------------------------
create or replace function public.notify_new_charter_enrollment()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  api_key   text;
  notify_to text;
  from_addr text;
begin
  select value into api_key   from public.app_settings where key = 'resend_api_key';
  select value into notify_to from public.app_settings where key = 'notify_email';
  select value into from_addr from public.app_settings where key = 'resend_from';

  if api_key is null or api_key = 'PASTE_YOUR_RESEND_API_KEY_HERE' then
    return new; -- Resend not configured yet — skip silently.
  end if;

  perform net.http_post(
    url := 'https://api.resend.com/emails',
    headers := jsonb_build_object('Authorization', 'Bearer ' || api_key, 'Content-Type', 'application/json'),
    body := jsonb_build_object(
      'from', from_addr,
      'to', notify_to,
      'subject', 'New charter member enrollment — Ensemble Fitness',
      'text', coalesce(nullif(new.name, ''), 'Someone') || ' (' || new.email || ') just submitted a charter member enrollment.' || chr(10) || chr(10) ||
              'Open the Review Queue — it''s right there under Pending Review, alongside anything else waiting on you: https://app.ensemblefitness.com/admin.html'
    )
  );
  return new;
end;
$$;

drop trigger if exists on_new_charter_enrollment_notify on public.charter_enrollments;
create trigger on_new_charter_enrollment_notify
  after insert on public.charter_enrollments
  for each row execute procedure public.notify_new_charter_enrollment();

create or replace function public.notify_charter_enrollment_approved()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  api_key   text;
  from_addr text;
begin
  if new.status = 'approved' and old.status is distinct from 'approved' then
    select value into api_key   from public.app_settings where key = 'resend_api_key';
    select value into from_addr from public.app_settings where key = 'resend_from';

    if api_key is null or api_key = 'PASTE_YOUR_RESEND_API_KEY_HERE' then
      return new; -- Resend not configured yet — skip silently.
    end if;

    perform net.http_post(
      url := 'https://api.resend.com/emails',
      headers := jsonb_build_object('Authorization', 'Bearer ' || api_key, 'Content-Type', 'application/json'),
      body := jsonb_build_object(
        'from', from_addr,
        'to', new.email,
        'subject', 'Welcome to Ensemble Fitness!',
        'text', 'Hi ' || coalesce(nullif(new.name, ''), 'there') || ',' || chr(10) || chr(10) ||
                'You''re officially a charter member of Ensemble Fitness — welcome to the community!' || chr(10) || chr(10) ||
                'Create your username and password to get started: https://app.ensemblefitness.com/login.html?mode=signup' || chr(10) || chr(10) ||
                'The Ensemble Fitness Team'
      )
    );
  end if;
  return new;
end;
$$;

drop trigger if exists on_charter_enrollment_approved on public.charter_enrollments;
create trigger on_charter_enrollment_approved
  after update on public.charter_enrollments
  for each row execute procedure public.notify_charter_enrollment_approved();

-- -------------------------------------------------------------------------
-- 7d. EMAIL NOTIFICATION for rejected/removed media. Fires any time a photo,
--     video, or voice update's status becomes "rejected" — whether that's
--     the admin clicking Reject in the Pending Review queue, or clicking
--     Remove on something that was already live in the feed. Sends the
--     member a friendly, specific note using whatever reason text the admin
--     typed in, so they always know why and never just see their content
--     silently disappear.
-- -------------------------------------------------------------------------
create or replace function public.notify_member_media_rejected()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  api_key      text;
  from_addr    text;
  member_email text;
  member_name  text;
  reason_text  text;
begin
  if new.status <> 'rejected' or old.status = 'rejected' then
    return new;
  end if;

  select value into api_key   from public.app_settings where key = 'resend_api_key';
  select value into from_addr from public.app_settings where key = 'resend_from';

  if api_key is null or api_key = 'PASTE_YOUR_RESEND_API_KEY_HERE' then
    return new; -- Resend not configured yet — skip silently.
  end if;

  select email into member_email from auth.users where id = new.user_id;
  if member_email is null then
    return new;
  end if;

  select display_name into member_name from public.profiles where id = new.user_id;
  reason_text := coalesce(nullif(trim(new.reject_reason), ''), 'it didn''t quite fit our community guidelines');

  perform net.http_post(
    url := 'https://api.resend.com/emails',
    headers := jsonb_build_object('Authorization', 'Bearer ' || api_key, 'Content-Type', 'application/json'),
    body := jsonb_build_object(
      'from', from_addr,
      'to', member_email,
      'subject', 'A quick note about your recent ' || new.kind || ' — Ensemble Fitness',
      'text', 'Hi ' || coalesce(nullif(member_name, ''), 'there') || ',' || chr(10) || chr(10) ||
              'Thanks so much for sharing on Ensemble Fitness — we love seeing our members show up and stay active!' || chr(10) || chr(10) ||
              'After a quick review, we weren''t able to keep your recent ' || new.kind || ' up in the community feed. Here''s why:' || chr(10) ||
              '"' || reason_text || '"' || chr(10) || chr(10) ||
              'Just a reminder of what we love to see in the feed: content centered on fitness and health — workouts, movement, meals, progress, that kind of thing — rather than posing-style photos or anything off-topic. This isn''t a reflection on you, just us keeping the feed focused and welcoming for everyone in the community.' || chr(10) || chr(10) ||
              'We''d genuinely love for you to share something new — hop back in anytime: https://app.ensemblefitness.com/profile.html' || chr(10) || chr(10) ||
              'Thanks for being part of the community,' || chr(10) ||
              'The Ensemble Fitness Team'
    )
  );
  return new;
end;
$$;

drop trigger if exists on_media_rejected_notify on public.media;
create trigger on_media_rejected_notify
  after update on public.media
  for each row execute procedure public.notify_member_media_rejected();

-- -------------------------------------------------------------------------
-- 8. MUSIC LIBRARY  (unsigned-artist tracks members can add to their videos)
--    Admins add tracks in admin.html (title, artist name/bio/link, audio
--    file). Members then pick one — instead of or alongside recording their
--    own voiceover — when uploading a video in profile.html. Deactivating a
--    track just hides it from that picker going forward; it never breaks a
--    video that already used it (music_track_id below just goes null if a
--    track is ever fully deleted).
-- -------------------------------------------------------------------------
create table if not exists public.tracks (
  id               uuid primary key default gen_random_uuid(),
  title            text not null,
  artist_name      text not null,
  artist_bio       text,
  artist_link      text,
  storage_path     text not null,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now()
);

alter table public.tracks enable row level security;

drop policy if exists "signed-in members browse active tracks" on public.tracks;
create policy "signed-in members browse active tracks"
  on public.tracks for select
  using (auth.uid() is not null and is_active);

drop policy if exists "admins manage tracks" on public.tracks;
create policy "admins manage tracks"
  on public.tracks for all
  using (public.is_admin())
  with check (public.is_admin());

insert into storage.buckets (id, name, public)
values ('tracks', 'tracks', false)
on conflict (id) do nothing;

drop policy if exists "signed-in members read active track audio" on storage.objects;
create policy "signed-in members read active track audio"
  on storage.objects for select
  using (
    bucket_id = 'tracks'
    and (
      public.is_admin()
      or exists (
        select 1 from public.tracks t
        where t.storage_path = storage.objects.name
          and t.is_active
      )
    )
  );

drop policy if exists "admins manage track audio files" on storage.objects;
create policy "admins manage track audio files"
  on storage.objects for all
  using (bucket_id = 'tracks' and public.is_admin())
  with check (bucket_id = 'tracks' and public.is_admin());

alter table public.media add column if not exists music_track_id uuid references public.tracks (id) on delete set null;

-- -------------------------------------------------------------------------
-- 9. ENSEMBLE READS  (short-form motivational book marketplace)
--    Public storefront lives on ensemblefitness.com (books.html). Anyone can
--    submit a short-form (30 pages or fewer) motivational book for review
--    on submit-book.html, paying a small non-refundable-only-if-published
--    review fee up front — it's automatically refunded if the book isn't
--    accepted, so nobody pays for a "no." Once approved, the book goes
--    live for sale at whatever price the author suggested (admin can
--    adjust); every sale splits 75% to the author / 25% to Ensemble
--    Fitness, tracked here for you to pay out by hand each month.
--
--    The actual money-moving (Stripe Checkout + refunds) happens in
--    Netlify Functions on the marketing site (see netlify/functions/),
--    since that needs a secret Stripe API key that must never reach a
--    browser. Those functions talk to this database using the Supabase
--    service role key, which bypasses RLS entirely — the policies below
--    are what everyone else (the public storefront, and you as admin)
--    is allowed to do directly.
-- -------------------------------------------------------------------------

-- Admins can read/update app_settings from admin.html directly (e.g. to
-- change the review fee) — everyone else still has zero access, same as
-- before.
drop policy if exists "admins manage app settings" on public.app_settings;
create policy "admins manage app settings"
  on public.app_settings for select
  using (public.is_admin());

drop policy if exists "admins update app settings" on public.app_settings;
create policy "admins update app settings"
  on public.app_settings for update
  using (public.is_admin())
  with check (public.is_admin());

insert into public.app_settings (key, value) values
  ('book_review_fee_cents', '700')
on conflict (key) do nothing;

-- Submissions: an aspiring author's book, waiting on your review. Nobody
-- can read or write this table directly from the browser — not even to
-- create the initial row — because the review fee has to actually clear
-- first. The create-submission-checkout Netlify Function creates the row
-- (using the service role key) once it's built the Stripe Checkout
-- Session; the webhook flips it from "awaiting_payment" to "pending" once
-- Stripe confirms the fee was paid. You review "pending" ones in
-- admin.html.
create table if not exists public.book_submissions (
  id                       uuid primary key default gen_random_uuid(),
  title                    text not null,
  author_name              text not null,
  author_email             text not null,
  author_bio               text,
  author_link              text,
  blurb                    text,
  suggested_price_cents    integer not null check (suggested_price_cents > 0),
  pdf_storage_path         text not null,
  cover_storage_path       text,
  review_fee_cents         integer not null,
  stripe_payment_intent_id text,
  status                   text not null default 'awaiting_payment'
                             check (status in ('awaiting_payment', 'pending', 'approved', 'rejected')),
  reject_reason            text,
  refunded                 boolean not null default false,
  published_book_id        uuid,
  reviewed_at              timestamptz,
  reviewed_by              uuid references auth.users (id),
  created_at               timestamptz not null default now()
);

alter table public.book_submissions enable row level security;
-- Intentionally no insert/select/delete policy for anon/authenticated —
-- only the service role (Netlify Functions) or an admin session can touch
-- this table at all.

drop policy if exists "admins view book submissions" on public.book_submissions;
create policy "admins view book submissions"
  on public.book_submissions for select
  using (public.is_admin());

drop policy if exists "admins review book submissions" on public.book_submissions;
create policy "admins review book submissions"
  on public.book_submissions for update
  using (public.is_admin())
  with check (public.is_admin());

-- The live catalog. Anyone (including anonymous visitors on the public
-- site) can browse active books; only admins can add/edit/deactivate one
-- directly. In practice almost every row here gets created by you clicking
-- Approve on a submission above, but you can also add one by hand in
-- admin.html if you want to seed the shelf yourself.
create table if not exists public.books (
  id                 uuid primary key default gen_random_uuid(),
  title              text not null,
  author_name        text not null,
  author_bio         text,
  author_link        text,
  author_email       text,
  blurb              text,
  price_cents        integer not null check (price_cents > 0),
  cover_storage_path text,
  pdf_storage_path   text not null,
  is_active          boolean not null default true,
  created_at         timestamptz not null default now()
);

alter table public.books enable row level security;

drop policy if exists "anyone can browse active books" on public.books;
create policy "anyone can browse active books"
  on public.books for select
  using (is_active or public.is_admin());

drop policy if exists "admins manage books" on public.books;
create policy "admins manage books"
  on public.books for all
  using (public.is_admin())
  with check (public.is_admin());

-- Adds the FK now that both tables exist.
alter table public.book_submissions
  drop constraint if exists book_submissions_published_book_id_fkey;
alter table public.book_submissions
  add constraint book_submissions_published_book_id_fkey
  foreign key (published_book_id) references public.books (id);

-- Every completed sale. Created by the Stripe webhook the moment a buyer's
-- payment clears — never by a browser directly. "payout_status" is what
-- you flip to "paid" in admin.html once you've actually sent that author
-- their 75% for the month.
create table if not exists public.book_orders (
  id                   uuid primary key default gen_random_uuid(),
  book_id              uuid not null references public.books (id),
  stripe_session_id    text unique not null,
  buyer_email          text not null,
  amount_cents         integer not null,
  author_payout_cents  integer not null,
  platform_fee_cents   integer not null,
  payout_status        text not null default 'unpaid' check (payout_status in ('unpaid', 'paid')),
  paid_out_at          timestamptz,
  created_at           timestamptz not null default now()
);

alter table public.book_orders enable row level security;

drop policy if exists "admins view book orders" on public.book_orders;
create policy "admins view book orders"
  on public.book_orders for select
  using (public.is_admin());

drop policy if exists "admins update book order payouts" on public.book_orders;
create policy "admins update book order payouts"
  on public.book_orders for update
  using (public.is_admin())
  with check (public.is_admin());

-- Storage: three buckets.
--   book-submissions — private. Anyone can upload a manuscript/cover here
--     (that's how a stranger submits without an account), but only admins
--     can read it back, to review before it's ever published.
--   book-covers — public. Cover art for LIVE books, shown on the public
--     storefront without needing a signed URL.
--   books — private. The actual manuscript PDF for a published book —
--     only reachable through a short-lived signed link the Stripe webhook
--     hands a buyer after their payment clears.
insert into storage.buckets (id, name, public) values ('book-submissions', 'book-submissions', false) on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('book-covers', 'book-covers', true) on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('books', 'books', false) on conflict (id) do nothing;

drop policy if exists "anyone can submit a manuscript" on storage.objects;
create policy "anyone can submit a manuscript"
  on storage.objects for insert
  with check (bucket_id = 'book-submissions');

drop policy if exists "admins read submitted manuscripts" on storage.objects;
create policy "admins read submitted manuscripts"
  on storage.objects for select
  using (bucket_id = 'book-submissions' and public.is_admin());

drop policy if exists "admins manage submitted manuscripts" on storage.objects;
create policy "admins manage submitted manuscripts"
  on storage.objects for all
  using (bucket_id = 'book-submissions' and public.is_admin())
  with check (bucket_id = 'book-submissions' and public.is_admin());

drop policy if exists "anyone can view book covers" on storage.objects;
create policy "anyone can view book covers"
  on storage.objects for select
  using (bucket_id = 'book-covers');

drop policy if exists "admins manage book covers" on storage.objects;
create policy "admins manage book covers"
  on storage.objects for all
  using (bucket_id = 'book-covers' and public.is_admin())
  with check (bucket_id = 'book-covers' and public.is_admin());

drop policy if exists "admins manage published book files" on storage.objects;
create policy "admins manage published book files"
  on storage.objects for all
  using (bucket_id = 'books' and public.is_admin())
  with check (bucket_id = 'books' and public.is_admin());

-- Emails you the moment a submission's review fee actually clears (so you
-- know to go review it) — mirrors notify_new_pending_media above.
create or replace function public.notify_new_book_submission()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  api_key   text;
  notify_to text;
  from_addr text;
begin
  if new.status <> 'pending' or old.status = 'pending' then
    return new;
  end if;

  select value into api_key   from public.app_settings where key = 'resend_api_key';
  select value into notify_to from public.app_settings where key = 'notify_email';
  select value into from_addr from public.app_settings where key = 'resend_from';

  if api_key is null or api_key = 'PASTE_YOUR_RESEND_API_KEY_HERE' then
    return new;
  end if;

  perform net.http_post(
    url := 'https://api.resend.com/emails',
    headers := jsonb_build_object('Authorization', 'Bearer ' || api_key, 'Content-Type', 'application/json'),
    body := jsonb_build_object(
      'from', from_addr,
      'to', notify_to,
      'subject', 'New book submission for review — Ensemble Reads',
      'text', new.author_name || ' just paid the review fee and submitted "' || new.title || '" for Ensemble Reads.' || chr(10) || chr(10) ||
              'Review it in the Review Queue: https://app.ensemblefitness.com/admin.html'
    )
  );
  return new;
end;
$$;

drop trigger if exists on_new_book_submission_notify on public.book_submissions;
create trigger on_new_book_submission_notify
  after update on public.book_submissions
  for each row execute procedure public.notify_new_book_submission();

-- Emails the author the moment you approve their book — congrats note with
-- a link to it live on the storefront. Mirrors notify_charter_enrollment_approved
-- above. (Rejections are handled by the refund-submission Netlify Function
-- instead of a trigger, since that flow also has to call Stripe to issue
-- the refund before it can honestly tell the author it's been refunded.)
create or replace function public.notify_book_submission_approved()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  api_key   text;
  from_addr text;
begin
  if new.status = 'approved' and old.status is distinct from 'approved' then
    select value into api_key   from public.app_settings where key = 'resend_api_key';
    select value into from_addr from public.app_settings where key = 'resend_from';

    if api_key is null or api_key = 'PASTE_YOUR_RESEND_API_KEY_HERE' then
      return new;
    end if;

    perform net.http_post(
      url := 'https://api.resend.com/emails',
      headers := jsonb_build_object('Authorization', 'Bearer ' || api_key, 'Content-Type', 'application/json'),
      body := jsonb_build_object(
        'from', from_addr,
        'to', new.author_email,
        'subject', 'Your book is live on Ensemble Reads!',
        'text', 'Hi ' || coalesce(nullif(new.author_name, ''), 'there') || ',' || chr(10) || chr(10) ||
                'Great news — "' || new.title || '" passed review and is officially live on Ensemble Reads!' || chr(10) || chr(10) ||
                'See it here: https://ensemblefitness.com/books.html' || chr(10) || chr(10) ||
                'You''ll earn 75% of every sale. We track that automatically and pay out monthly to the email/contact you gave us at submission — reach out anytime if you have questions about a payout.' || chr(10) || chr(10) ||
                'Thanks for sharing your work with our community,' || chr(10) ||
                'The Ensemble Fitness Team'
      )
    );
  end if;
  return new;
end;
$$;

drop trigger if exists on_book_submission_approved on public.book_submissions;
create trigger on_book_submission_approved
  after update on public.book_submissions
  for each row execute procedure public.notify_book_submission_approved();

-- -------------------------------------------------------------------------
-- 10. POST NOTE + SIGNATURE
--     Lets the OWNER of a post add a short personal note and "sign" it —
--     either by typing their name (rendered client-side in a cursive font)
--     or by hand-drawing a signature with a mouse/touchpad/finger. This is
--     the member's own authenticity mark on their post ("this is really my
--     meal, in my words, and I'm signing off on it"), not a moderation
--     step, so it's editable by the owner any time — re-signing just
--     replaces the old note/signature. A hand-drawn signature is stored as
--     a small base64 PNG directly in signature_data (no separate storage
--     file/policy needed — it's typically only a few KB).
-- -------------------------------------------------------------------------
alter table public.media add column if not exists note text;
alter table public.media add column if not exists signature_type text check (signature_type in ('typed', 'drawn'));
alter table public.media add column if not exists signature_name text;
alter table public.media add column if not exists signature_data text;
alter table public.media add column if not exists signed_at timestamptz;

-- Belt-and-suspenders: guards which columns a NON-admin can change through
-- the owner-update policy below. Without this, the RLS policy alone would
-- let an owner update any column on their own row (including status),
-- since a permissive row policy can't restrict individual columns on its
-- own — only a trigger comparing OLD vs NEW can.
create or replace function public.enforce_media_owner_signature_only()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_admin() then
    return new;
  end if;
  if new.status is distinct from old.status
     or new.kind is distinct from old.kind
     or new.storage_path is distinct from old.storage_path
     or new.caption is distinct from old.caption
     or new.workout_type is distinct from old.workout_type
     or new.location is distinct from old.location
     or new.narration_path is distinct from old.narration_path
     or new.is_profile_photo is distinct from old.is_profile_photo
     or new.reject_reason is distinct from old.reject_reason
     or new.reviewed_at is distinct from old.reviewed_at
     or new.reviewed_by is distinct from old.reviewed_by
     or new.user_id is distinct from old.user_id
     or new.trim_start is distinct from old.trim_start
     or new.trim_end is distinct from old.trim_end
     or new.music_track_id is distinct from old.music_track_id
  then
    raise exception 'members can only update the note and signature on their own posts';
  end if;
  return new;
end;
$$;

drop trigger if exists on_media_owner_update_guard on public.media;
create trigger on_media_owner_update_guard
  before update on public.media
  for each row execute procedure public.enforce_media_owner_signature_only();

drop policy if exists "owners can sign their own media" on public.media;
create policy "owners can sign their own media"
  on public.media for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- =========================================================================
-- Done. Next: Storage → confirm a bucket named "media" exists (private).
-- Then grab Project URL + anon public key from Settings → API and send
-- both back so the app can be wired up and deployed.
--
-- To turn on real Live Chat email alerts later: create a free account at
-- resend.com, verify a sending domain (or use their onboarding@resend.dev
-- test address to start), copy your API key, then run:
--   update public.app_settings set value = 'your-real-api-key-here' where key = 'resend_api_key';
-- =========================================================================
