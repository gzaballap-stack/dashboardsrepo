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
