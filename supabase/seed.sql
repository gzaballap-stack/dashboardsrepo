-- ============================================================
-- TFU AI Dashboard — Schema Migration + Seed Data
-- Paste this entire file into Supabase SQL Editor and run it
-- ============================================================

-- 1. Schema migrations
ALTER TABLE clients DROP COLUMN IF EXISTS org_id;
ALTER TABLE clients DROP CONSTRAINT IF EXISTS clients_org_name_key;
ALTER TABLE clients ADD CONSTRAINT IF NOT EXISTS clients_name_key UNIQUE (name);
ALTER TABLE profiles DROP COLUMN IF EXISTS org_id;
ALTER TABLE ad_spend DROP CONSTRAINT IF EXISTS ad_spend_platform_check;
ALTER TABLE ad_spend ADD CONSTRAINT ad_spend_platform_check CHECK (platform IN ('meta', 'google', 'local_services'));

-- Rename is_super_admin to is_admin (skip if already done)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='profiles' AND column_name='is_super_admin') THEN
    ALTER TABLE profiles RENAME COLUMN is_super_admin TO is_admin;
  END IF;
END$$;

-- Drop organizations table if it exists
DROP TABLE IF EXISTS organizations CASCADE;

-- 2. Seed clients
INSERT INTO clients (id, name, created_at) VALUES
  ('a1000000-0000-0000-0000-000000000001', 'Call Center Mastery', now()),
  ('a1000000-0000-0000-0000-000000000002', 'Sooth Spa', now()),
  ('a1000000-0000-0000-0000-000000000003', 'Simple Solar', now()),
  ('a1000000-0000-0000-0000-000000000004', 'Jet Fast Medspa', now()),
  ('a1000000-0000-0000-0000-000000000005', 'Warm HVAC', now()),
  ('a1000000-0000-0000-0000-000000000006', 'Beast Pest Control', now())
ON CONFLICT (name) DO NOTHING;

-- 3. Seed events (last 60 days, realistic data per client)
DO $$
DECLARE
  client_ids uuid[] := ARRAY[
    'a1000000-0000-0000-0000-000000000001'::uuid,
    'a1000000-0000-0000-0000-000000000002'::uuid,
    'a1000000-0000-0000-0000-000000000003'::uuid,
    'a1000000-0000-0000-0000-000000000004'::uuid,
    'a1000000-0000-0000-0000-000000000005'::uuid,
    'a1000000-0000-0000-0000-000000000006'::uuid
  ];
  -- leads_per_day, dials_per_day, book_rate, show_rate
  leads_min int[]  := ARRAY[8, 5, 3, 6, 4, 7];
  leads_max int[]  := ARRAY[15,12, 8,14,10,16];
  dials_min int[]  := ARRAY[40,25,30,30,25,35];
  dials_max int[]  := ARRAY[80,50,60,65,55,70];
  book_rate float[] := ARRAY[0.55, 0.45, 0.35, 0.50, 0.40, 0.48];
  show_rate float[] := ARRAY[0.70, 0.65, 0.60, 0.68, 0.62, 0.66];
  spend_min float[] := ARRAY[800,400,1200,600,500,450];
  spend_max float[] := ARRAY[1500,900,2500,1200,1000,950];

  ci int;
  cid uuid;
  d int;
  the_date date;
  leads int; dials int; booked int; shows int; noshows int; callbacks int;
  pickup_rate float; conv_rate float;
  spend float;
  i int;
  t timestamptz;
  is_p bool; is_c bool;
BEGIN
  FOR ci IN 1..6 LOOP
    cid := client_ids[ci];

    FOR d IN 0..59 LOOP
      the_date := current_date - d;

      -- Skip ~30% of Sundays for variation
      IF extract(dow from the_date) = 0 AND random() < 0.3 THEN CONTINUE; END IF;

      leads    := leads_min[ci] + floor(random() * (leads_max[ci] - leads_min[ci] + 1))::int;
      dials    := dials_min[ci] + floor(random() * (dials_max[ci] - dials_min[ci] + 1))::int;
      booked   := round(leads * book_rate[ci] * (0.8 + random() * 0.4))::int;
      shows    := round(booked * show_rate[ci] * (0.8 + random() * 0.4))::int;
      noshows  := greatest(0, booked - shows - floor(random() * 3)::int);
      callbacks := greatest(0, round(leads * 0.15 * (0.5 + random()))::int);
      pickup_rate := 0.35 + random() * 0.20;
      conv_rate   := 0.55 + random() * 0.20;
      spend := spend_min[ci] + random() * (spend_max[ci] - spend_min[ci]);

      -- Leads
      FOR i IN 1..leads LOOP
        t := the_date::timestamptz + (8 * 3600 + floor(random() * 36000)::int) * interval '1 second';
        INSERT INTO events (client_id, event_type, occurred_at) VALUES (cid, 'lead', t);
      END LOOP;

      -- Dials
      FOR i IN 1..dials LOOP
        t := the_date::timestamptz + (8 * 3600 + floor(random() * 36000)::int) * interval '1 second';
        is_p := random() < pickup_rate;
        is_c := is_p AND random() < conv_rate;
        INSERT INTO events (client_id, event_type, occurred_at, duration_seconds, is_pickup, is_conversation, speed_to_lead_seconds)
        VALUES (cid, 'dial', t,
          CASE WHEN is_p THEN 40 + floor(random()*560)::int ELSE 5 + floor(random()*34)::int END,
          is_p, is_c,
          60 + floor(random()*840)::int);
      END LOOP;

      -- Appointments booked
      FOR i IN 1..booked LOOP
        t := the_date::timestamptz + (8 * 3600 + floor(random() * 36000)::int) * interval '1 second';
        INSERT INTO events (client_id, event_type, occurred_at) VALUES (cid, 'appointment_booked', t);
      END LOOP;

      -- Shows
      FOR i IN 1..shows LOOP
        t := the_date::timestamptz + (9 * 3600 + floor(random() * 36000)::int) * interval '1 second';
        INSERT INTO events (client_id, event_type, occurred_at) VALUES (cid, 'show', t);
      END LOOP;

      -- No shows
      FOR i IN 1..noshows LOOP
        t := the_date::timestamptz + (9 * 3600 + floor(random() * 36000)::int) * interval '1 second';
        INSERT INTO events (client_id, event_type, occurred_at) VALUES (cid, 'no_show', t);
      END LOOP;

      -- Callbacks
      FOR i IN 1..callbacks LOOP
        t := the_date::timestamptz + (8 * 3600 + floor(random() * 32400)::int) * interval '1 second';
        INSERT INTO events (client_id, event_type, occurred_at) VALUES (cid, 'callback_booked', t);
      END LOOP;

      -- Ad spend (meta 60% / google 40%)
      INSERT INTO ad_spend (client_id, spend_date, platform, amount)
      VALUES
        (cid, the_date, 'meta',   round((spend * 0.6)::numeric, 2)),
        (cid, the_date, 'google', round((spend * 0.4)::numeric, 2))
      ON CONFLICT (client_id, spend_date, platform) DO NOTHING;

    END LOOP;
  END LOOP;
END$$;

-- Verify
SELECT 'clients' as tbl, count(*) FROM clients
UNION ALL SELECT 'events', count(*) FROM events
UNION ALL SELECT 'ad_spend', count(*) FROM ad_spend;
