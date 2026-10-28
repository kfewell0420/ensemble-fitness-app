-- Oct 28: a "we removed your song / video" note is a NOTIFICATION (the bell), not a message in Messages.
-- Safe to run more than once.

-- 1) allow a new notification type, "removal" (keeps reaction / comment / follow / message)
do $$
declare c text;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'public.notifications'::regclass and contype = 'c'
      and pg_get_constraintdef(oid) like 'CHECK ((type = ANY%'
  loop
    execute format('alter table public.notifications drop constraint %I', c);
  end loop;
end $$;
alter table public.notifications
  add constraint notifications_type_check
  check (type in ('reaction', 'comment', 'follow', 'message', 'removal')) not valid;

-- 2) only an admin can send one (members can never write notifications directly)
create or replace function public.send_removal_notice(p_recipient uuid, p_text text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.admins where user_id = auth.uid()) then
    raise exception 'not allowed';
  end if;
  if p_text is null or length(trim(p_text)) = 0 then
    return;
  end if;
  insert into public.notifications (recipient_id, actor_id, type, preview)
  values (p_recipient, auth.uid(), 'removal', left(trim(p_text), 300));
end;
$$;
revoke all on function public.send_removal_notice(uuid, text) from public;
grant execute on function public.send_removal_notice(uuid, text) to authenticated;
