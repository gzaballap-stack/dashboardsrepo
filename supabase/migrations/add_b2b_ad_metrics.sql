-- Budget + engagement/result metrics on the B2B ad tables, matching what the
-- client-side ad_campaigns table already carries.
--
-- B2B tables exist only in V1 (the demo environment has no B2B model), so the
-- runner guards this block on b2b_events being present.
DO $$
BEGIN
  IF to_regclass('public.b2b_ad_spend') IS NULL THEN
    RAISE NOTICE 'b2b tables not present -- skipping';
    RETURN;
  END IF;

  ALTER TABLE b2b_ad_spend ADD COLUMN IF NOT EXISTS frequency     numeric;
  ALTER TABLE b2b_ad_spend ADD COLUMN IF NOT EXISTS unique_clicks integer;
  ALTER TABLE b2b_ad_spend ADD COLUMN IF NOT EXISTS unique_ctr    numeric;
  ALTER TABLE b2b_ad_spend ADD COLUMN IF NOT EXISTS leads         integer NOT NULL DEFAULT 0;
  ALTER TABLE b2b_ad_spend ADD COLUMN IF NOT EXISTS budget        numeric;
  ALTER TABLE b2b_ad_spend ADD COLUMN IF NOT EXISTS objective     text;
  ALTER TABLE b2b_ad_spend ADD COLUMN IF NOT EXISTS status        text;

  ALTER TABLE b2b_ad_sets ADD COLUMN IF NOT EXISTS frequency     numeric;
  ALTER TABLE b2b_ad_sets ADD COLUMN IF NOT EXISTS unique_clicks integer;
  ALTER TABLE b2b_ad_sets ADD COLUMN IF NOT EXISTS unique_ctr    numeric;
  ALTER TABLE b2b_ad_sets ADD COLUMN IF NOT EXISTS leads         integer NOT NULL DEFAULT 0;
  ALTER TABLE b2b_ad_sets ADD COLUMN IF NOT EXISTS budget        numeric;

  ALTER TABLE b2b_ads ADD COLUMN IF NOT EXISTS frequency     numeric;
  ALTER TABLE b2b_ads ADD COLUMN IF NOT EXISTS unique_clicks integer;
  ALTER TABLE b2b_ads ADD COLUMN IF NOT EXISTS unique_ctr    numeric;
  ALTER TABLE b2b_ads ADD COLUMN IF NOT EXISTS leads         integer NOT NULL DEFAULT 0;
END $$;
