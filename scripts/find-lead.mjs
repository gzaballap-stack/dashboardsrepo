// Read-only: everything the dashboard holds about one lead, by name — every
// event (lead, appointment, show…), which client it sits under, the source it
// was filed as, and where it stands in Client Billing. Changes nothing.
//
//   node scripts/find-lead.mjs v1 duis
//
// Use part of the name: spelling varies ("Duisberg" / "Duisburg").

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const target = (process.argv[2] ?? '').toLowerCase();
const term = process.argv.slice(3).join(' ').replace(/[^\p{L}\p{N} .'-]/gu, '').trim();
if (!['v1', 'v2'].includes(target) || term.length < 3) {
  console.error('Usage: node scripts/find-lead.mjs <v1|v2> <part of the name, 3+ letters>');
  process.exit(1);
}

const readEnv = file => readFileSync(resolve(__dirname, file), 'utf-8')
  .split('\n')
  .filter(line => line && !line.startsWith('#'))
  .reduce((acc, line) => {
    const [key, ...val] = line.split('=');
    if (key && val.length) acc[key.trim()] = val.join('=').trim();
    return acc;
  }, {});

const envVars = readEnv(`../.env.${target}`);
const localVars = readEnv('../.env.local');
const PROJECT_REF = new URL(envVars['NEXT_PUBLIC_SUPABASE_URL']).hostname.split('.')[0];
const ACCESS_TOKEN = envVars['SUPABASE_ACCESS_TOKEN'] ?? localVars['SUPABASE_ACCESS_TOKEN'];
if (!ACCESS_TOKEN) {
  console.error('SUPABASE_ACCESS_TOKEN not found in .env.' + target + ' or .env.local');
  process.exit(1);
}

async function read(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const data = await res.json();
  if (!res.ok) { console.error('✗ Could not read:', JSON.stringify(data)); process.exit(1); }
  return data;
}

const like = `%${term.replace(/'/g, "''")}%`;

// Names and dates only — no phone numbers or emails are printed.
const rows = await read(`
  select e.lead_name as name,
         e.event_type as what,
         to_char(e.occurred_at, 'YYYY-MM-DD') as recorded,
         to_char(e.scheduled_at, 'YYYY-MM-DD') as appointment_day,
         coalesce(c.name, '(no client)') as client,
         coalesce(c.service, '-') as client_service,
         case when c.is_internal then 'yes' else 'no' end as internal,
         coalesce(nullif(e.ad_platform, ''), nullif(e.utm_source, ''), '(none)') as source,
         case
           when b.event_id is null then '-'
           when b.cancelled_at is not null then 'cancelled'
           when b.credited_at is not null then 'credited'
           when b.charge_id is not null then 'billed'
           else 'tracked'
         end as billing
  from events e
  left join clients c on c.id = e.client_id
  left join billing_appointments b on b.event_id = e.id
  where e.lead_name ilike '${like}'
  order by e.occurred_at
  limit 200;
`);

console.log(`Target: ${target} (${PROJECT_REF}) — events whose lead name contains "${term}"\n`);
if (!rows.length) {
  console.log('Nothing found. No lead, appointment or call is stored under that name.');
} else {
  console.table(rows);
  const appts = rows.filter(r => ['appointment_booked', 'show', 'no_show'].includes(r.what));
  console.log(`\n${rows.length} event(s), of which ${appts.length} appointment(s).`);
  if (!appts.length) console.log('No appointment is stored — only the rows above. Client Billing lists appointments only.');
}
