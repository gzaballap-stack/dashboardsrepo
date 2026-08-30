import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const envVars = readFileSync(resolve(__dirname, '../.env.local'), 'utf-8')
  .split('\n')
  .filter(line => line && !line.startsWith('#'))
  .reduce((acc, line) => {
    const [key, ...val] = line.split('=');
    if (key && val.length) acc[key.trim()] = val.join('=').trim();
    return acc;
  }, {});

const PROJECT_REF = new URL(envVars['NEXT_PUBLIC_SUPABASE_URL']).hostname.split('.')[0];
const ACCESS_TOKEN = envVars['SUPABASE_ACCESS_TOKEN'];

async function runSQL(sql, label) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const data = await res.json();
  if (!res.ok) { console.error(`✗ ${label}:`, JSON.stringify(data)); process.exit(1); }
  console.log(`✓ ${label}`);
}

// Run all pending migrations
await runSQL(`
  ALTER TABLE events ADD COLUMN IF NOT EXISTS lead_name text;
  ALTER TABLE events ADD COLUMN IF NOT EXISTS lead_phone text;
  ALTER TABLE events ADD COLUMN IF NOT EXISTS lead_email text;
  ALTER TABLE events ADD COLUMN IF NOT EXISTS agent_name text;
  ALTER TABLE events ADD COLUMN IF NOT EXISTS direction text;
  ALTER TABLE events ADD COLUMN IF NOT EXISTS call_status text;
  ALTER TABLE events ADD COLUMN IF NOT EXISTS recording_url text;
  ALTER TABLE events ADD COLUMN IF NOT EXISTS call_summary text;
  ALTER TABLE events ADD COLUMN IF NOT EXISTS phone_number_used text;
  ALTER TABLE events ADD COLUMN IF NOT EXISTS stage_booked text;
`, 'Add identity + agent + dial fields');

await runSQL(`
  CREATE INDEX IF NOT EXISTS events_agent_name_idx ON events (agent_name) WHERE agent_name IS NOT NULL;
  CREATE INDEX IF NOT EXISTS events_lead_phone_idx ON events (lead_phone) WHERE lead_phone IS NOT NULL;
`, 'Add indexes');

await runSQL(`
  CREATE TABLE IF NOT EXISTS agents (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    phone text NOT NULL UNIQUE,
    name text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS agents_phone_idx ON agents (phone);
`, 'Create agents table');

await runSQL(`
  CREATE TABLE IF NOT EXISTS setter_availability (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    weekday text NOT NULL CHECK (weekday IN ('Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday')),
    time_start time NOT NULL,
    time_end time NOT NULL,
    is_live boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS setter_availability_agent_idx ON setter_availability (agent_id);
  CREATE INDEX IF NOT EXISTS setter_availability_weekday_idx ON setter_availability (weekday);
`, 'Create setter_availability table');

await runSQL(`
  CREATE TABLE IF NOT EXISTS client_calling_windows (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    weekday text NOT NULL CHECK (weekday IN ('Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday')),
    time_slot_1 time,
    time_slot_2 time,
    is_live boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS client_windows_client_idx ON client_calling_windows (client_id);
  CREATE INDEX IF NOT EXISTS client_windows_weekday_idx ON client_calling_windows (weekday);
`, 'Create client_calling_windows table');

await runSQL(`
  CREATE TABLE IF NOT EXISTS pd_schedule (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    agent_id uuid REFERENCES agents(id) ON DELETE SET NULL,
    scheduled_date date NOT NULL,
    slot_time time NOT NULL,
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed','no_leads','no_setters')),
    notes text,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS pd_schedule_date_idx ON pd_schedule (scheduled_date);
  CREATE INDEX IF NOT EXISTS pd_schedule_client_idx ON pd_schedule (client_id);
`, 'Create pd_schedule table');

await runSQL(`
  ALTER TABLE clients ADD COLUMN IF NOT EXISTS is_live boolean NOT NULL DEFAULT true;
`, 'Add is_live to clients');

await runSQL(`
  CREATE TABLE IF NOT EXISTS watch_schedule (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id uuid NOT NULL REFERENCES agents(id) ON DELETE CASCADE,
    scheduled_date date NOT NULL,
    slot_hour int NOT NULL CHECK (slot_hour BETWEEN 8 AND 20),
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (agent_id, scheduled_date, slot_hour)
  );
  CREATE INDEX IF NOT EXISTS watch_schedule_date_idx ON watch_schedule (scheduled_date);
`, 'Create watch_schedule table');

await runSQL(`
  CREATE TABLE IF NOT EXISTS client_sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id uuid NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
    name text NOT NULL,
    pins jsonb NOT NULL DEFAULT '[]'::jsonb,
    pin_counter int NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE INDEX IF NOT EXISTS client_sessions_client_idx ON client_sessions (client_id);
`, 'Create client_sessions table');

await runSQL(`
  CREATE TABLE IF NOT EXISTS client_touchpoints (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    client_id uuid REFERENCES clients(id) ON DELETE CASCADE,
    occurred_at timestamptz DEFAULT now(),
    type text,
    summary text,
    csm_name text,
    created_at timestamptz DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS client_csm_status (
    client_id uuid PRIMARY KEY REFERENCES clients(id) ON DELETE CASCADE,
    cadence_days integer,
    csm_name text,
    left_review boolean,
    review_date date,
    review_platform text,
    review_link text,
    upsell_status text,
    upsell_notes text,
    upsell_date date,
    updated_at timestamptz DEFAULT now()
  );
`, 'Create CSM tables');

await runSQL(`
  ALTER TABLE client_touchpoints ADD COLUMN IF NOT EXISTS recording_url    text;
  ALTER TABLE client_touchpoints ADD COLUMN IF NOT EXISTS duration_seconds int;
  ALTER TABLE client_touchpoints ADD COLUMN IF NOT EXISTS agent_name       text;
  ALTER TABLE client_touchpoints ADD COLUMN IF NOT EXISTS call_status      text;
  ALTER TABLE client_touchpoints ADD COLUMN IF NOT EXISTS external_id      text;
  CREATE UNIQUE INDEX IF NOT EXISTS client_touchpoints_external_id_key
    ON client_touchpoints (external_id) WHERE external_id IS NOT NULL;
  CREATE INDEX IF NOT EXISTS client_touchpoints_recording_idx
    ON client_touchpoints (client_id, occurred_at DESC) WHERE recording_url IS NOT NULL;
  CREATE INDEX IF NOT EXISTS client_touchpoints_csm_idx
    ON client_touchpoints (csm_name) WHERE csm_name IS NOT NULL;
`, 'Add recording fields to CSM touchpoints');

await runSQL(`
  ALTER TABLE events ADD COLUMN IF NOT EXISTS ad_platform text;
  ALTER TABLE events ADD COLUMN IF NOT EXISTS campaign_id text;
  ALTER TABLE events ADD COLUMN IF NOT EXISTS campaign_name text;
  ALTER TABLE events ADD COLUMN IF NOT EXISTS adset_id text;
  ALTER TABLE events ADD COLUMN IF NOT EXISTS adset_name text;
  ALTER TABLE events ADD COLUMN IF NOT EXISTS ad_id text;
  ALTER TABLE events ADD COLUMN IF NOT EXISTS ad_name text;
  ALTER TABLE events ADD COLUMN IF NOT EXISTS utm_source text;
  ALTER TABLE events ADD COLUMN IF NOT EXISTS utm_medium text;
  ALTER TABLE events ADD COLUMN IF NOT EXISTS utm_campaign text;
  ALTER TABLE events ADD COLUMN IF NOT EXISTS utm_content text;
  ALTER TABLE events ADD COLUMN IF NOT EXISTS utm_term text;
  ALTER TABLE events ADD COLUMN IF NOT EXISTS referrer_url text;
  CREATE INDEX IF NOT EXISTS events_campaign_idx ON events (client_id, campaign_id) WHERE campaign_id IS NOT NULL;
  CREATE INDEX IF NOT EXISTS events_adset_idx ON events (client_id, adset_id) WHERE adset_id IS NOT NULL;
  CREATE INDEX IF NOT EXISTS events_ad_idx ON events (client_id, ad_id) WHERE ad_id IS NOT NULL;
  CREATE INDEX IF NOT EXISTS events_utm_campaign_idx ON events (client_id, utm_campaign) WHERE utm_campaign IS NOT NULL;
`, 'Add ad attribution to events');

// The B2B tables exist only in V1 -- V2 (demo) has never had them. Guarded so the
// migration completes on both instead of aborting at the first ALTER.
await runSQL(`
  DO $$
  BEGIN
    IF to_regclass('public.b2b_events') IS NULL THEN
      RAISE NOTICE 'b2b_events not present -- skipping B2B migration';
      RETURN;
    END IF;

    ALTER TABLE b2b_events ADD COLUMN IF NOT EXISTS recording_url    text;
    ALTER TABLE b2b_events ADD COLUMN IF NOT EXISTS duration_seconds int;
    ALTER TABLE b2b_events ADD COLUMN IF NOT EXISTS agent_name       text;
    ALTER TABLE b2b_events ADD COLUMN IF NOT EXISTS call_status      text;
    ALTER TABLE b2b_events ADD COLUMN IF NOT EXISTS call_summary     text;
    ALTER TABLE b2b_events ADD COLUMN IF NOT EXISTS is_pickup        boolean;
    ALTER TABLE b2b_events ADD COLUMN IF NOT EXISTS is_conversation  boolean;
    ALTER TABLE b2b_events ADD COLUMN IF NOT EXISTS csm_name         text;
    ALTER TABLE b2b_events ADD COLUMN IF NOT EXISTS external_id_call text;
    ALTER TABLE b2b_events ADD COLUMN IF NOT EXISTS client_id uuid REFERENCES clients(id) ON DELETE SET NULL;

    ALTER TABLE b2b_events ADD COLUMN IF NOT EXISTS ad_platform text;
    ALTER TABLE b2b_events ADD COLUMN IF NOT EXISTS campaign_id text;
    ALTER TABLE b2b_events ADD COLUMN IF NOT EXISTS campaign_name text;
    ALTER TABLE b2b_events ADD COLUMN IF NOT EXISTS adset_id text;
    ALTER TABLE b2b_events ADD COLUMN IF NOT EXISTS adset_name text;
    ALTER TABLE b2b_events ADD COLUMN IF NOT EXISTS ad_id text;
    ALTER TABLE b2b_events ADD COLUMN IF NOT EXISTS ad_name text;
    ALTER TABLE b2b_events ADD COLUMN IF NOT EXISTS utm_source text;
    ALTER TABLE b2b_events ADD COLUMN IF NOT EXISTS utm_medium text;
    ALTER TABLE b2b_events ADD COLUMN IF NOT EXISTS utm_campaign text;
    ALTER TABLE b2b_events ADD COLUMN IF NOT EXISTS utm_content text;
    ALTER TABLE b2b_events ADD COLUMN IF NOT EXISTS utm_term text;
    ALTER TABLE b2b_events ADD COLUMN IF NOT EXISTS referrer_url text;

    ALTER TABLE b2b_events DROP CONSTRAINT IF EXISTS b2b_events_event_type_check;
    ALTER TABLE b2b_events ADD CONSTRAINT b2b_events_event_type_check CHECK (
      event_type IN ('lead','intro_booked','intro_shown','sales_call_booked','sales_call_shown','close','call')
    );

    CREATE INDEX IF NOT EXISTS b2b_events_recording_idx ON b2b_events (occurred_at DESC) WHERE recording_url IS NOT NULL;
    CREATE INDEX IF NOT EXISTS b2b_events_client_idx ON b2b_events (client_id) WHERE client_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS b2b_events_campaign_idx ON b2b_events (campaign_id) WHERE campaign_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS b2b_events_adset_idx ON b2b_events (adset_id) WHERE adset_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS b2b_events_ad_idx ON b2b_events (ad_id) WHERE ad_id IS NOT NULL;
  END $$;
`, 'Add B2B call recording + attribution fields (skipped where b2b_events absent)');

console.log('\nAll migrations complete.');
