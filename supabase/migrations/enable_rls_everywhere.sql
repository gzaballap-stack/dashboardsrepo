-- Every public table is reached only through the server (service-role key,
-- which bypasses RLS). The browser's public key must not be able to read or
-- write any table, so RLS is on everywhere, with no policies — i.e. closed.
-- Supabase's advisor flagged these nine as open (2026-10-17 email).
ALTER TABLE calendar_feeds        ENABLE ROW LEVEL SECURITY;
ALTER TABLE lift_entries          ENABLE ROW LEVEL SECURITY;
ALTER TABLE lift_settings         ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_call_doc_fills  ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms_sends             ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_templates        ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE whoop_connections     ENABLE ROW LEVEL SECURITY;
ALTER TABLE whoop_days            ENABLE ROW LEVEL SECURITY;
