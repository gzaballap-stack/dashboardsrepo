-- Each client's Meta ad account, so the app can pull spend itself on a schedule
-- (/api/cron/sync-spend) instead of one Make scenario per client carrying its
-- own copy of the account id and the Meta token.
ALTER TABLE clients ADD COLUMN IF NOT EXISTS meta_account_id text;
