-- =============================================================================
-- Reports & Blocked Members
-- =============================================================================
-- Needed before submitting to the App Store: Apple requires any app with
-- user-generated content and member-to-member messaging to let people
-- report objectionable content and block abusive members. This adds both.
--
-- Reporting: a member can report another member directly, or report a
-- specific photo/video/comment/message. Reports go into one table with a
-- few nullable "target" columns (only one is ever filled in per report) so
-- admin.html can show one unified queue instead of four separate ones.
--
-- Blocking: a member can block another member. Blocking is enforced in two
-- ways — (1) at the database level, neither person can message the other
-- anymore once blocked (the highest-priority case Apple checks for), and
-- (2) the app's own pages (feed, member directory, comments) filter out a
-- blocked member's content client-side once they load your block list.
--
-- Run this in the Supabase SQL editor after schema.sql, follows-and-messages.sql,
-- and any other sql/*.sql files already applied.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- REPORTS
-- ---------------------------------------------------------------------------
create table if not exists public.reports (
  id                uuid primary key default gen_random_uuid(),
  reporter_id       uuid not null references public.profiles (id) on delete cascade,

  -- Exactly one of these four should be set, depending on what's being
  -- reported. Nullable rather than a single polymorphic column so each one
  -- can be a real foreign key (and admin.html can join straight to it).
  target_user_id    uuid references public.profiles (id) on delete cascade,
  target_media_id   uuid references public.media (id) on delete cascade,
  target_comment_id uuid references public.media_comments (id) on delete cascade,
  target_message_id uuid references public.messages (id) on delete cascade,

  reason            text not null check (reason in (
                       'Spam', 'Harassment or bullying', 'Inappropriate content',
                       'Impersonation', 'Nudity or sexual content', 'Other'
                     )),
  details           text,                          -- optional free-text elaboration
  status            text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  created_at        timestamptz not null default now(),
  resolved_at       timestamptz,
  resolved_by       uuid references public.profiles (id),

  constraint reports_exactly_one_target check (
    (case when target_user_id is not null then 1 else 0 end) +
    (case when target_media_id is not null then 1 else 0 end) +
    (case when target_comment_id is not null then 1 else 0 end) +
    (case when target_message_id is not null then 1 else 0 end) = 1
  )
);

alter table public.reports enable row level security;

drop policy if exists "members report as themselves" on public.reports;
create policy "members report as themselves"
  on public.reports for insert
  to authenticated
  with check (reporter_id = auth.uid());

drop policy if exists "reporters see their own reports, admins see all" on public.reports;
create policy "reporters see their own reports, admins see all"
  on public.reports for select
  to authenticated
  using (reporter_id = auth.uid() or public.is_admin());

drop policy if exists "only admins update reports" on public.reports;
create policy "only admins update reports"
  on public.reports for update
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "only admins delete reports" on public.reports;
create policy "only admins delete reports"
  on public.reports for delete
  using (public.is_admin());

create index if not exists reports_status_idx on public.reports (status, created_at desc);

-- ---------------------------------------------------------------------------
-- BLOCKED USERS
-- ---------------------------------------------------------------------------
create table if not exists public.blocked_users (
  id          uuid primary key default gen_random_uuid(),
  blocker_id  uuid not null references public.profiles (id) on delete cascade,
  blocked_id  uuid not null references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now(),
  constraint no_self_block check (blocker_id <> blocked_id),
  unique (blocker_id, blocked_id)
);

alter table public.blocked_users enable row level security;

drop policy if exists "members see their own block list" on public.blocked_users;
create policy "members see their own block list"
  on public.blocked_users for select
  to authenticated
  using (blocker_id = auth.uid() or public.is_admin());

drop policy if exists "members block as themselves" on public.blocked_users;
create policy "members block as themselves"
  on public.blocked_users for insert
  to authenticated
  with check (blocker_id = auth.uid());

drop policy if exists "members unblock their own blocks" on public.blocked_users;
create policy "members unblock their own blocks"
  on public.blocked_users for delete
  to authenticated
  using (blocker_id = auth.uid() or public.is_admin());

create index if not exists blocked_users_blocker_idx on public.blocked_users (blocker_id);
create index if not exists blocked_users_blocked_idx on public.blocked_users (blocked_id);

-- ---------------------------------------------------------------------------
-- Enforce blocking where it matters most: nobody can message someone who
-- has blocked them, or someone they've blocked, in either direction. This
-- replaces the messages table's existing insert policy (follows-and-
-- messages.sql) with the same check plus this one extra condition.
-- ---------------------------------------------------------------------------
drop policy if exists "messages_insert_own" on public.messages;
create policy "messages_insert_own"
  on public.messages
  for insert
  to authenticated
  with check (
    auth.uid() = sender_id
    and not exists (
      select 1 from public.blocked_users b
      where (b.blocker_id = sender_id and b.blocked_id = recipient_id)
         or (b.blocker_id = recipient_id and b.blocked_id = sender_id)
    )
  );
