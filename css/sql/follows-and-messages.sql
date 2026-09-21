-- ============================================================================
-- Follows + Messages
-- ----------------------------------------------------------------------------
-- Adds real person-level "Follow" relationships (follow the person, not a
-- single video/photo) and a simple one-way message ("Good job. Keep going.")
-- that lands in the recipient's inbox. No two-way chat thread, no service
-- role / Netlify Function needed — this follows the same direct-client +
-- RLS pattern already used for reactions/notes on the `media` table, since
-- neither table touches money (unlike the wallet tables, which are
-- zero-policy / service-role-only).
--
-- Run this once in the Supabase SQL Editor for the Ensemble Fitness project.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- FOLLOWS
-- ---------------------------------------------------------------------------
create table if not exists public.follows (
  follower_id uuid not null references public.profiles(id) on delete cascade,
  followee_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, followee_id),
  constraint no_self_follow check (follower_id <> followee_id)
);

alter table public.follows enable row level security;

drop policy if exists "follows_select_authenticated" on public.follows;
drop policy if exists "follows_insert_own" on public.follows;
drop policy if exists "follows_delete_own" on public.follows;

-- Any signed-in member can read the follows table — needed so anyone's
-- profile can show accurate follower/following counts and lists, and so a
-- member can tell at a glance whether they're already following someone.
create policy "follows_select_authenticated"
  on public.follows
  for select
  to authenticated
  using (true);

-- A member can only ever create a follow row where THEY are the follower.
create policy "follows_insert_own"
  on public.follows
  for insert
  to authenticated
  with check (follower_id = auth.uid());

-- A member can only remove their own follow (unfollow).
create policy "follows_delete_own"
  on public.follows
  for delete
  to authenticated
  using (follower_id = auth.uid());

create index if not exists follows_followee_idx on public.follows (followee_id);
create index if not exists follows_follower_idx on public.follows (follower_id);

-- ---------------------------------------------------------------------------
-- MESSAGES  (simple one-way note — not a two-way chat thread)
-- ---------------------------------------------------------------------------
create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  constraint no_self_message check (sender_id <> recipient_id),
  constraint message_body_length check (char_length(body) > 0 and char_length(body) <= 500)
);

alter table public.messages enable row level security;

drop policy if exists "messages_select_own" on public.messages;
drop policy if exists "messages_insert_own" on public.messages;
drop policy if exists "messages_update_recipient" on public.messages;

-- A member can see a message only if they sent it or received it.
create policy "messages_select_own"
  on public.messages
  for select
  to authenticated
  using (auth.uid() = sender_id or auth.uid() = recipient_id);

-- A member can only ever send a message as themselves.
create policy "messages_insert_own"
  on public.messages
  for insert
  to authenticated
  with check (auth.uid() = sender_id);

-- Only the recipient can mark a message they received as read.
create policy "messages_update_recipient"
  on public.messages
  for update
  to authenticated
  using (auth.uid() = recipient_id)
  with check (auth.uid() = recipient_id);

create index if not exists messages_recipient_idx on public.messages (recipient_id, created_at desc);
create index if not exists messages_sender_idx on public.messages (sender_id);

-- ---------------------------------------------------------------------------
-- MEDIA REACTIONS  (👍 thumbs up / 💪 muscle / ❤️ heart — one active
-- reaction per person per post; tapping the same one again removes it,
-- tapping a different one switches it)
-- ---------------------------------------------------------------------------
create table if not exists public.media_reactions (
  media_id uuid not null references public.media(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  reaction_type text not null check (reaction_type in ('thumbs_up', 'muscle', 'heart')),
  created_at timestamptz not null default now(),
  primary key (media_id, user_id)
);

alter table public.media_reactions enable row level security;

drop policy if exists "media_reactions_select_authenticated" on public.media_reactions;
drop policy if exists "media_reactions_insert_own" on public.media_reactions;
drop policy if exists "media_reactions_update_own" on public.media_reactions;
drop policy if exists "media_reactions_delete_own" on public.media_reactions;

-- Anyone signed in can see reaction counts/who-reacted-what on any post.
create policy "media_reactions_select_authenticated"
  on public.media_reactions
  for select
  to authenticated
  using (true);

-- A member can only react as themselves.
create policy "media_reactions_insert_own"
  on public.media_reactions
  for insert
  to authenticated
  with check (user_id = auth.uid());

-- A member can change their own reaction (tap a different emoji).
create policy "media_reactions_update_own"
  on public.media_reactions
  for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- A member can remove their own reaction (tap the same emoji again).
create policy "media_reactions_delete_own"
  on public.media_reactions
  for delete
  to authenticated
  using (user_id = auth.uid());

create index if not exists media_reactions_media_idx on public.media_reactions (media_id);

-- ---------------------------------------------------------------------------
-- MEDIA COMMENTS  (public comments on a post, visible to every member —
-- separate from the post owner's own private "note & signature" feature)
-- ---------------------------------------------------------------------------
create table if not exists public.media_comments (
  id uuid primary key default gen_random_uuid(),
  media_id uuid not null references public.media(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now(),
  constraint comment_body_length check (char_length(body) > 0 and char_length(body) <= 300)
);

alter table public.media_comments enable row level security;

drop policy if exists "media_comments_select_authenticated" on public.media_comments;
drop policy if exists "media_comments_insert_own" on public.media_comments;
drop policy if exists "media_comments_delete_own" on public.media_comments;

-- Anyone signed in can read comments on any post.
create policy "media_comments_select_authenticated"
  on public.media_comments
  for select
  to authenticated
  using (true);

-- A member can only post a comment as themselves.
create policy "media_comments_insert_own"
  on public.media_comments
  for insert
  to authenticated
  with check (user_id = auth.uid());

-- A member can delete their own comment (e.g. typo, changed their mind).
create policy "media_comments_delete_own"
  on public.media_comments
  for delete
  to authenticated
  using (user_id = auth.uid());

create index if not exists media_comments_media_idx on public.media_comments (media_id, created_at asc);
