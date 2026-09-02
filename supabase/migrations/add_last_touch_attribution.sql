-- Last-touch attribution.
--
-- GoHighLevel returns `lastAttributionSource` alongside `attributionSource` on
-- every contact, at no extra cost. First touch credits the ad that created the
-- lead; last touch credits the ad they interacted with most recently before
-- converting. Both are useful and they routinely disagree.
--
-- Stored as one json column rather than 13 more columns: the reporting routes
-- aggregate in application code, so there is nothing to gain from separate
-- columns, and this keeps the migration to a single additive statement.
--
-- Shape matches lib/attribution's ATTRIBUTION_FIELDS:
--   { ad_platform, campaign_id, campaign_name, adset_id, adset_name,
--     ad_id, ad_name, utm_source, utm_medium, utm_campaign,
--     utm_content, utm_term, referrer_url }
--
-- b2b_events is guarded: V2 has not run the b2b migration, so the table may not
-- exist there. Skipping it is correct; failing the whole migration is not.

alter table events add column if not exists last_touch jsonb;

do $$
begin
  if to_regclass('public.b2b_events') is not null then
    alter table b2b_events add column if not exists last_touch jsonb;
  end if;
end $$;

-- Partial indexes: most rows have no last touch, and every query that uses it
-- filters on it being present first.
create index if not exists events_last_touch_ad
  on events ((last_touch->>'ad_id')) where last_touch is not null;
create index if not exists events_last_touch_adset
  on events ((last_touch->>'adset_id')) where last_touch is not null;
create index if not exists events_last_touch_campaign
  on events ((last_touch->>'campaign_id')) where last_touch is not null;
