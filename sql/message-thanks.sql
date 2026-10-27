-- Item 9 (Oct 27): profile messages get a quiet thumbs-up ("got it, thanks") and a Sent view.
-- Safe to run more than once.
alter table public.messages add column if not exists thanked_at timestamptz;

-- Lets a member read the messages they SENT (needed for the Sent tab).
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'messages'
                 and policyname = 'Senders can read their sent messages') then
    create policy "Senders can read their sent messages" on public.messages
      for select using (auth.uid() = sender_id);
  end if;
end $$;
