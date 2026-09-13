-- Tomsi Media is modelled as an internal client so the whole client dashboard
-- (KPIs, campaign overview, leaderboard, goals, raw data, heat maps) can be
-- reused for B2B. Internal clients are excluded from client-facing lists.
ALTER TABLE clients ADD COLUMN IF NOT EXISTS is_internal boolean NOT NULL DEFAULT false;
INSERT INTO clients (name, is_live, is_internal) VALUES ('Tomsi Media', true, true)
  ON CONFLICT (name) DO UPDATE SET is_internal = true;
