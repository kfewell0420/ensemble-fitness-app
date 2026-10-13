-- =============================================================================
-- New-enrollment email now links straight to the one-screen approval page
-- =============================================================================
-- Ken's ask (Oct 2026): the "New charter member enrollment" email used to open
-- admin.html (whole app menu + side menu + a tab). It now opens approve.html:
-- just the people waiting, with Approve / Deny. The link also carries the new
-- enrollment's id so that person is shown first.
--
-- Run once in the Supabase SQL editor AFTER approve.html is live on the website.
-- Safe to re-run. Nothing else changes (same trigger, same Resend settings).
-- =============================================================================
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
              'Tap here to approve or deny: https://app.ensemblefitness.com/approve.html?id=' || new.id::text
    )
  );
  return new;
end;
$$;
