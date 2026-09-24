-- Three-state client status: live | paused | offline.
-- Paused = not churned but not active: kept out of live rollups and stale alerts.
ALTER TABLE clients ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'live';
UPDATE clients SET status = CASE WHEN is_live THEN 'live' ELSE 'offline' END WHERE status IS NULL OR status = 'live' AND NOT is_live;
