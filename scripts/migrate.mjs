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

console.log('\nAll migrations complete.');
