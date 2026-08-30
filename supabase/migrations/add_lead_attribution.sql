-- Ad attribution on funnel events.
--
-- ad_campaigns knows what each campaign/ad set/ad SPENT, and events knows what
-- the funnel PRODUCED, but nothing joined the two: events carried no campaign
-- reference at all. These columns let a lead, appointment, show or close be
-- traced back to the exact ad that generated it, on both the B2C (events) and
-- B2B (b2b_events) sides.
--
-- Values arrive from GHL's contact attribution via the Make webhooks. UTM fields
-- are kept alongside the Meta IDs because GHL populates them far more reliably —
-- a lead often has a utm_campaign when the numeric ad_id is missing.

-- ── B2C funnel events ────────────────────────────────────────────────
ALTER TABLE events ADD COLUMN IF NOT EXISTS ad_platform   text;   -- meta | google | tiktok | other
ALTER TABLE events ADD COLUMN IF NOT EXISTS campaign_id   text;
ALTER TABLE events ADD COLUMN IF NOT EXISTS campaign_name text;
ALTER TABLE events ADD COLUMN IF NOT EXISTS adset_id      text;
ALTER TABLE events ADD COLUMN IF NOT EXISTS adset_name    text;
ALTER TABLE events ADD COLUMN IF NOT EXISTS ad_id         text;
ALTER TABLE events ADD COLUMN IF NOT EXISTS ad_name       text;
ALTER TABLE events ADD COLUMN IF NOT EXISTS utm_source    text;
ALTER TABLE events ADD COLUMN IF NOT EXISTS utm_medium    text;
ALTER TABLE events ADD COLUMN IF NOT EXISTS utm_campaign  text;
ALTER TABLE events ADD COLUMN IF NOT EXISTS utm_content   text;
ALTER TABLE events ADD COLUMN IF NOT EXISTS utm_term      text;
ALTER TABLE events ADD COLUMN IF NOT EXISTS referrer_url  text;

CREATE INDEX IF NOT EXISTS events_campaign_idx
  ON events (client_id, campaign_id) WHERE campaign_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS events_adset_idx
  ON events (client_id, adset_id) WHERE adset_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS events_ad_idx
  ON events (client_id, ad_id) WHERE ad_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS events_utm_campaign_idx
  ON events (client_id, utm_campaign) WHERE utm_campaign IS NOT NULL;

-- ── B2B funnel events ────────────────────────────────────────────────
ALTER TABLE b2b_events ADD COLUMN IF NOT EXISTS ad_platform   text;
ALTER TABLE b2b_events ADD COLUMN IF NOT EXISTS campaign_id   text;
ALTER TABLE b2b_events ADD COLUMN IF NOT EXISTS campaign_name text;
ALTER TABLE b2b_events ADD COLUMN IF NOT EXISTS adset_id      text;
ALTER TABLE b2b_events ADD COLUMN IF NOT EXISTS adset_name    text;
ALTER TABLE b2b_events ADD COLUMN IF NOT EXISTS ad_id         text;
ALTER TABLE b2b_events ADD COLUMN IF NOT EXISTS ad_name       text;
ALTER TABLE b2b_events ADD COLUMN IF NOT EXISTS utm_source    text;
ALTER TABLE b2b_events ADD COLUMN IF NOT EXISTS utm_medium    text;
ALTER TABLE b2b_events ADD COLUMN IF NOT EXISTS utm_campaign  text;
ALTER TABLE b2b_events ADD COLUMN IF NOT EXISTS utm_content   text;
ALTER TABLE b2b_events ADD COLUMN IF NOT EXISTS utm_term      text;
ALTER TABLE b2b_events ADD COLUMN IF NOT EXISTS referrer_url  text;

CREATE INDEX IF NOT EXISTS b2b_events_campaign_idx
  ON b2b_events (campaign_id) WHERE campaign_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS b2b_events_adset_idx
  ON b2b_events (adset_id) WHERE adset_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS b2b_events_ad_idx
  ON b2b_events (ad_id) WHERE ad_id IS NOT NULL;
