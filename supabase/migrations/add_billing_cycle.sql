-- Client Billing: how often a client is billed.
-- Additive only: one column with a default. No row is changed in meaning —
-- every client stays 'daily', which is how the page has always worked.
--
--   daily   their bookings show in "Track today's appointments" each day
--   weekly  their bookings are kept out of the daily list and shown together
--           at the end of the week (Saturday)

alter table public.billing_clients
  add column if not exists billing_cycle text not null default 'daily';

do $$ begin
  alter table public.billing_clients
    add constraint billing_clients_cycle_check check (billing_cycle in ('daily', 'weekly'));
exception when duplicate_object then null; end $$;

-- So the API sees the new column straight away.
notify pgrst, 'reload schema';
