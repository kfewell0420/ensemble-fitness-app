-- ============================================================================
-- Notifications — "you're part of a vibrant, connected community"
-- ----------------------------------------------------------------------------
-- Today a reaction, comment, follow, or message just gets saved quietly —
-- the person on the receiving end has no way to know unless they happen to
-- reopen that exact post or check their inbox. This adds:
--
--   1. A `notifications` table the member app's bell icon reads from
--      (js/notifications.js), so opening the app shows "you got 3 reactions
--      and a new follower" right away.
--   2. An email for each event, reusing the exact same pg_net + Resend +
--      app_settings pattern already used for your own admin alerts in
--      schema.sql (search for "resend_api_key") — if you've already got a
--      real Resend API key in app_settings, this just works too.
--
-- Rows in `notifications` are only ever written by the SECURITY DEFINER
-- trigger functions below (owned by the table's creator, so they bypass
-- RLS the same way the existing email-notification functions do) — there
-- is deliberately no INSERT policy for members themselves, so nobody can
-- forge a fake "so-and-so reacted to your post" notification that never
-- actually happened.
--
-- Run once in the Supabase SQL Editor, after schema.sql, multi-reactions.sql,
-- and follows-and-messages.sql. Safe to re-run.
-- ============================================================================

create table if not exists public.notifications (
  id            uuid primary key default gen_random_uuid(),
  recipient_id  uuid not null
                constraint notifications_recipient_id_fkey
                references public.profiles(id) on delete cascade,
  actor_id      uuid
                constraint notifications_actor_id_fkey
                references public.profiles(id) on delete set null,
  type          text not null check (type in ('reaction', 'comment', 'follow', 'message')),
  media_id      uuid references public.media(id) on delete cascade,
  reaction_type text check (reaction_type in ('thumbs_up', 'muscle', 'heart')),
  preview       text,  -- short snippet of a comment/message body, for the bell's list
  created_at    timestamptz not null default now(),
  read_at       timestamptz
);

alter table public.notifications enable row level security;

drop policy if exists "notifications_select_own" on public.notifications;
create policy "notifications_select_own"
  on public.notifications
  for select
  to authenticated
  using (recipient_id = auth.uid());

-- Lets a member mark their own notifications read (or unread) — never anyone else's.
drop policy if exists "notifications_update_own" on public.notifications;
create policy "notifications_update_own"
  on public.notifications
  for update
  to authenticated
  using (recipient_id = auth.uid())
  with check (recipient_id = auth.uid());

-- Lets a member clear/dismiss their own notifications.
drop policy if exists "notifications_delete_own" on public.notifications;
create policy "notifications_delete_own"
  on public.notifications
  for delete
  to authenticated
  using (recipient_id = auth.uid());

-- Intentionally NO insert policy for anon/authenticated — see note up top.

create index if not exists notifications_recipient_idx on public.notifications (recipient_id, created_at desc);
create index if not exists notifications_recipient_unread_idx on public.notifications (recipient_id) where read_at is null;

-- pg_net + the app_settings/resend_api_key row already exist if you've run
-- section 7a of schema.sql — this just re-declares both defensively so this
-- file also works standalone.
create extension if not exists pg_net;

create table if not exists public.app_settings (
  key   text primary key,
  value text
);

alter table public.app_settings enable row level security;

insert into public.app_settings (key, value) values
  ('resend_api_key', 'PASTE_YOUR_RESEND_API_KEY_HERE'),
  ('notify_email', 'ken.fewell@gmail.com'),
  ('resend_from', 'onboarding@resend.dev')
on conflict (key) do nothing;

-- ----------------------------------------------------------------------------
-- Shared helper: has Resend actually been configured? Every notify_* function
-- below checks this before trying to send anything, exactly like the
-- existing admin-alert emails do — so this whole feature degrades gracefully
-- (in-app bell still works, email just quietly skips) until a real API key
-- is pasted into app_settings.
-- ----------------------------------------------------------------------------

-- ----------------------------------------------------------------------------
-- 1. REACTIONS (👍 / 💪 / ❤️)
-- ----------------------------------------------------------------------------
create or replace function public.notify_media_reaction()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  owner_id       uuid;
  media_kind     text;
  actor_name     text;
  owner_name     text;
  owner_email    text;
  api_key        text;
  from_addr      text;
  reaction_label text;
  reaction_emoji text;
begin
  select user_id, kind into owner_id, media_kind from public.media where id = new.media_id;

  -- Post no longer exists, or reacting to your own post — nothing to tell anyone.
  if owner_id is null or owner_id = new.user_id then
    return new;
  end if;

  select display_name into actor_name from public.profiles where id = new.user_id;

  insert into public.notifications (recipient_id, actor_id, type, media_id, reaction_type)
  values (owner_id, new.user_id, 'reaction', new.media_id, new.reaction_type);

  select value into api_key   from public.app_settings where key = 'resend_api_key';
  select value into from_addr from public.app_settings where key = 'resend_from';
  if api_key is null or api_key = 'PASTE_YOUR_RESEND_API_KEY_HERE' then
    return new; -- Resend not configured yet — in-app notification above still happened.
  end if;

  select email into owner_email from auth.users where id = owner_id;
  if owner_email is null then
    return new;
  end if;
  select display_name into owner_name from public.profiles where id = owner_id;

  reaction_label := case new.reaction_type
    when 'muscle' then 'muscle'
    when 'heart'  then 'heart'
    else 'thumbs up'
  end;
  reaction_emoji := case new.reaction_type
    when 'muscle' then '💪'
    when 'heart'  then '❤️'
    else '👍'
  end;

  perform net.http_post(
    url := 'https://api.resend.com/emails',
    headers := jsonb_build_object('Authorization', 'Bearer ' || api_key, 'Content-Type', 'application/json'),
    body := jsonb_build_object(
      'from', from_addr,
      'to', owner_email,
      'subject', reaction_emoji || ' ' || coalesce(nullif(actor_name, ''), 'Someone') || ' reacted to your ' || media_kind || ' — Ensemble Fitness',
      'text', 'Hi ' || coalesce(nullif(owner_name, ''), 'there') || ',' || chr(10) || chr(10) ||
              coalesce(nullif(actor_name, ''), 'A member') || ' just gave your ' || media_kind || ' a ' || reaction_label || ' ' || reaction_emoji || ' on Ensemble Fitness!' || chr(10) || chr(10) ||
              'Come see what''s happening in the community: https://app.ensemblefitness.com/feed.html' || chr(10) || chr(10) ||
              'Keep it up,' || chr(10) ||
              'The Ensemble Fitness Team'
    )
  );
  return new;
end;
$$;

drop trigger if exists on_media_reaction_notify on public.media_reactions;
create trigger on_media_reaction_notify
  after insert on public.media_reactions
  for each row execute procedure public.notify_media_reaction();

-- ----------------------------------------------------------------------------
-- 2. COMMENTS
-- ----------------------------------------------------------------------------
create or replace function public.notify_media_comment()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  owner_id    uuid;
  media_kind  text;
  actor_name  text;
  owner_name  text;
  owner_email text;
  api_key     text;
  from_addr   text;
  snippet     text;
begin
  select user_id, kind into owner_id, media_kind from public.media where id = new.media_id;

  if owner_id is null or owner_id = new.user_id then
    return new; -- post gone, or commenting on your own post
  end if;

  select display_name into actor_name from public.profiles where id = new.user_id;
  snippet := left(new.body, 140);

  insert into public.notifications (recipient_id, actor_id, type, media_id, preview)
  values (owner_id, new.user_id, 'comment', new.media_id, snippet);

  select value into api_key   from public.app_settings where key = 'resend_api_key';
  select value into from_addr from public.app_settings where key = 'resend_from';
  if api_key is null or api_key = 'PASTE_YOUR_RESEND_API_KEY_HERE' then
    return new;
  end if;

  select email into owner_email from auth.users where id = owner_id;
  if owner_email is null then
    return new;
  end if;
  select display_name into owner_name from public.profiles where id = owner_id;

  perform net.http_post(
    url := 'https://api.resend.com/emails',
    headers := jsonb_build_object('Authorization', 'Bearer ' || api_key, 'Content-Type', 'application/json'),
    body := jsonb_build_object(
      'from', from_addr,
      'to', owner_email,
      'subject', '💬 ' || coalesce(nullif(actor_name, ''), 'Someone') || ' commented on your ' || media_kind || ' — Ensemble Fitness',
      'text', 'Hi ' || coalesce(nullif(owner_name, ''), 'there') || ',' || chr(10) || chr(10) ||
              coalesce(nullif(actor_name, ''), 'A member') || ' just commented on your ' || media_kind || ' on Ensemble Fitness:' || chr(10) || chr(10) ||
              '"' || snippet || '"' || chr(10) || chr(10) ||
              'See the full conversation: https://app.ensemblefitness.com/feed.html' || chr(10) || chr(10) ||
              'Keep it up,' || chr(10) ||
              'The Ensemble Fitness Team'
    )
  );
  return new;
end;
$$;

drop trigger if exists on_media_comment_notify on public.media_comments;
create trigger on_media_comment_notify
  after insert on public.media_comments
  for each row execute procedure public.notify_media_comment();

-- ----------------------------------------------------------------------------
-- 3. NEW FOLLOWERS
-- ----------------------------------------------------------------------------
create or replace function public.notify_new_follow()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  actor_name    text;
  followee_name text;
  followee_email text;
  api_key       text;
  from_addr     text;
begin
  if new.follower_id = new.followee_id then
    return new; -- can't actually happen (DB constraint blocks it) — defensive only
  end if;

  select display_name into actor_name from public.profiles where id = new.follower_id;

  insert into public.notifications (recipient_id, actor_id, type)
  values (new.followee_id, new.follower_id, 'follow');

  select value into api_key   from public.app_settings where key = 'resend_api_key';
  select value into from_addr from public.app_settings where key = 'resend_from';
  if api_key is null or api_key = 'PASTE_YOUR_RESEND_API_KEY_HERE' then
    return new;
  end if;

  select email into followee_email from auth.users where id = new.followee_id;
  if followee_email is null then
    return new;
  end if;
  select display_name into followee_name from public.profiles where id = new.followee_id;

  perform net.http_post(
    url := 'https://api.resend.com/emails',
    headers := jsonb_build_object('Authorization', 'Bearer ' || api_key, 'Content-Type', 'application/json'),
    body := jsonb_build_object(
      'from', from_addr,
      'to', followee_email,
      'subject', '🎉 ' || coalesce(nullif(actor_name, ''), 'Someone') || ' started following you — Ensemble Fitness',
      'text', 'Hi ' || coalesce(nullif(followee_name, ''), 'there') || ',' || chr(10) || chr(10) ||
              coalesce(nullif(actor_name, ''), 'A member') || ' just started following you on Ensemble Fitness!' || chr(10) || chr(10) ||
              'See their profile: https://app.ensemblefitness.com/member.html?id=' || new.follower_id || chr(10) || chr(10) ||
              'Keep it up,' || chr(10) ||
              'The Ensemble Fitness Team'
    )
  );
  return new;
end;
$$;

drop trigger if exists on_new_follow_notify on public.follows;
create trigger on_new_follow_notify
  after insert on public.follows
  for each row execute procedure public.notify_new_follow();

-- ----------------------------------------------------------------------------
-- 4. MESSAGES  (the one-way "Good job, keep going" note — read in profile.html's Inbox)
-- ----------------------------------------------------------------------------
create or replace function public.notify_new_message()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  actor_name       text;
  recipient_name   text;
  recipient_email  text;
  api_key          text;
  from_addr        text;
  snippet          text;
begin
  if new.sender_id = new.recipient_id then
    return new; -- can't actually happen (DB constraint blocks it) — defensive only
  end if;

  select display_name into actor_name from public.profiles where id = new.sender_id;
  snippet := left(new.body, 140);

  insert into public.notifications (recipient_id, actor_id, type, preview)
  values (new.recipient_id, new.sender_id, 'message', snippet);

  select value into api_key   from public.app_settings where key = 'resend_api_key';
  select value into from_addr from public.app_settings where key = 'resend_from';
  if api_key is null or api_key = 'PASTE_YOUR_RESEND_API_KEY_HERE' then
    return new;
  end if;

  select email into recipient_email from auth.users where id = new.recipient_id;
  if recipient_email is null then
    return new;
  end if;
  select display_name into recipient_name from public.profiles where id = new.recipient_id;

  perform net.http_post(
    url := 'https://api.resend.com/emails',
    headers := jsonb_build_object('Authorization', 'Bearer ' || api_key, 'Content-Type', 'application/json'),
    body := jsonb_build_object(
      'from', from_addr,
      'to', recipient_email,
      'subject', '✉️ ' || coalesce(nullif(actor_name, ''), 'Someone') || ' sent you a message — Ensemble Fitness',
      'text', 'Hi ' || coalesce(nullif(recipient_name, ''), 'there') || ',' || chr(10) || chr(10) ||
              coalesce(nullif(actor_name, ''), 'A member') || ' just sent you a message on Ensemble Fitness:' || chr(10) || chr(10) ||
              '"' || snippet || '"' || chr(10) || chr(10) ||
              'Read it in your Inbox: https://app.ensemblefitness.com/profile.html' || chr(10) || chr(10) ||
              'Keep it up,' || chr(10) ||
              'The Ensemble Fitness Team'
    )
  );
  return new;
end;
$$;

drop trigger if exists on_new_message_notify on public.messages;
create trigger on_new_message_notify
  after insert on public.messages
  for each row execute procedure public.notify_new_message();
