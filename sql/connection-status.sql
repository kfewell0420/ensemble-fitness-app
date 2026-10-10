-- =============================================================================
-- Connection Status — a tiny optional badge beside a member's name
-- =============================================================================
-- Ken's ask (Oct 2026): let members signal, at a glance, how they're here —
-- like the wristband at a gathering — so nobody has to message a stranger
-- just to find out. Optional; NULL means "no badge shown".
--
--   open_to_connect  💗  single and open to meeting someone
--   taken            💍  married / in a relationship
--   community        🤝  here for friends, workout partners, motivation only
--
-- Run this once in the Supabase SQL editor. Safe to run more than once. Until
-- you run it the app keeps working exactly as before (every page that reads
-- or saves this field does so separately, and quietly ignores a missing
-- column) — the badges simply won't appear or save yet.
-- =============================================================================

alter table public.profiles add column if not exists connection_status text;

alter table public.profiles drop constraint if exists profiles_connection_status_valid;
alter table public.profiles add constraint profiles_connection_status_valid
  check (connection_status is null or connection_status in ('open_to_connect', 'taken', 'community'));

-- Applies the choice someone made on the JOIN form. Deliberately a SEPARATE
-- trigger from handle_new_user() (which creates the profile row and enforces
-- age/ZIP/wake-time) so that function is left completely untouched, and so
-- anything going wrong here can never block a signup: the whole body is
-- wrapped in an exception handler. Trigger names fire alphabetically on the
-- same event, and this name sorts after "on_auth_user_created", so the
-- profile row already exists by the time this runs.
create or replace function public.apply_signup_connection_status()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  chosen text;
begin
  begin
    chosen := nullif(new.raw_user_meta_data->>'connection_status', '');
    if chosen in ('open_to_connect', 'taken', 'community') then
      update public.profiles set connection_status = chosen where id = new.id;
    end if;
  exception when others then
    null; -- never block account creation over an optional badge
  end;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created_z_connection_status on auth.users;
create trigger on_auth_user_created_z_connection_status
  after insert on auth.users
  for each row execute function public.apply_signup_connection_status();
