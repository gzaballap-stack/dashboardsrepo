-- SMS sent per client over a stretch of days, added up in the database.
-- Additive only: one read-only function. No table, row or index is touched.
--
-- `sms_sends` holds a row per text sent. Client Billing only needs the total
-- per client; downloading every row to add them up took several seconds.
--
--   select * from sms_totals('2026-11-01', '2026-11-30');          -- every client
--   select * from sms_totals('2026-11-01', '2026-11-30', '<id>');  -- one client

create or replace function public.sms_totals(
  p_start  date default null,
  p_end    date default null,
  p_client uuid default null
)
returns table (client_id uuid, messages bigint)
language sql
stable
as $$
  select s.client_id, coalesce(sum(s.messages), 0)::bigint as messages
  from public.sms_sends s
  where (p_start  is null or s.sent_date >= p_start)
    and (p_end    is null or s.sent_date <= p_end)
    and (p_client is null or s.client_id = p_client)
  group by s.client_id
$$;

-- Only the server reads it, like the table itself.
revoke all on function public.sms_totals(date, date, uuid) from public, anon, authenticated;
grant execute on function public.sms_totals(date, date, uuid) to service_role;

-- So the API sees the new function straight away.
notify pgrst, 'reload schema';

-- 2026-11-23: adding up a month of texts scanned the whole table (139 MB — each
-- row carries its raw payload) and took ~6 s, past the 8 s limit under load, so
-- the Clients dashboard's SMS view came back as zeros. This index holds just
-- what the totals need, so they are answered from it alone (~0.3 s).
-- On a live database build it with CONCURRENTLY (not inside a transaction) so
-- incoming texts are not blocked; V1 was done that way on 2026-11-23.
create index if not exists sms_sends_date_totals_idx on public.sms_sends (sent_date, client_id) include (messages);
