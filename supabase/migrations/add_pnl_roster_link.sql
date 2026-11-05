-- Profit and Loss client profiles can point at a Client Roster record.
-- Additive only. A profile linked to a roster client takes that client's name
-- everywhere on Profit and Loss; profiles with no link (past clients kept out
-- of the roster on purpose) stand on their own.

ALTER TABLE pnl_clients ADD COLUMN IF NOT EXISTS client_id uuid REFERENCES clients(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS pnl_clients_client_idx ON pnl_clients (client_id) WHERE client_id IS NOT NULL;

-- Profiles whose name already is a roster client's name are linked outright.
UPDATE pnl_clients p
SET client_id = c.id
FROM clients c
WHERE p.client_id IS NULL
  AND NOT c.is_internal
  AND lower(trim(c.name)) = p.name_key;
