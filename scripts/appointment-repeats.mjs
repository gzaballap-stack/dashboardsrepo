// Read-only. How bookings, reschedules and show / no-show updates actually sit
// in the database over the last 90 days — counts only, no names or numbers.
// It answers what the reschedule fix for the main dashboard has to handle:
// does a reschedule arrive as a second booking, and does a show arrive as a
// row of its own next to the booking? Changes nothing.
//
//   node scripts/appointment-repeats.mjs v1

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const target = (process.argv[2] ?? '').toLowerCase();
if (!['v1', 'v2'].includes(target)) {
  console.error('Usage: node scripts/appointment-repeats.mjs <v1|v2>');
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

async function read(title, sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const data = await res.json();
  console.log(`\n${title}`);
  if (!res.ok) { console.log('  could not be read:', JSON.stringify(data)); return; }
  if (!data.length) { console.log('  (none)'); return; }
  console.table(data);
}

// Every appointment row of the last 90 days, with the lead it belongs to:
// their GHL contact, else the last 10 digits of their phone.
const ROWS = `
  with a as (
    select e.client_id, c.name as client, e.event_type, e.occurred_at, e.scheduled_at, e.external_id,
           coalesce(nullif(e.ghl_contact_id, ''), nullif(right(regexp_replace(coalesce(e.lead_phone, ''), '[^0-9]', '', 'g'), 10), '')) as lead
    from events e join clients c on c.id = e.client_id
    where e.event_type in ('appointment_booked', 'show', 'no_show')
      and e.occurred_at >= now() - interval '90 days'
      and not coalesce(c.is_internal, false)
  )`;

console.log(`Target: ${target} (${PROJECT_REF}) — last 90 days, read-only`);

await read('1. Appointment rows by kind', `${ROWS}
  select event_type as kind, count(*) as rows, count(external_id) as with_appointment_id, count(lead) as with_a_lead
  from a group by 1 order by 2 desc`);

await read('2. What one lead\'s rows look like, in order (most common first)', `${ROWS}
  select pattern, count(*) as leads from (
    select client_id, lead,
           string_agg(case event_type when 'appointment_booked' then 'booked' else event_type end, ' > ' order by occurred_at) as pattern
    from a where lead is not null group by 1, 2
  ) t group by 1 order by 2 desc limit 15`);

await read('3. A lead booking again: when, compared with the appointment they already had', `${ROWS}
  select case when prev_time is null then 'first booking had no time'
              when booked_at < prev_time then 'before the first one was due'
              when booked_at < prev_time + interval '14 days' then 'within 14 days after it was due'
              else 'more than 14 days after' end as booked_again,
         count(*) as times
  from (
    select occurred_at as booked_at,
           lag(scheduled_at) over w as prev_time, lag(occurred_at) over w as prev_booked
    from a where event_type = 'appointment_booked' and lead is not null
    window w as (partition by client_id, lead order by occurred_at)
  ) t where prev_booked is not null group by 1 order by 2 desc`);

await read('4. Per client: bookings against the leads who made them', `${ROWS}
  select client,
         count(*) filter (where event_type = 'appointment_booked') as bookings,
         count(distinct lead) filter (where event_type = 'appointment_booked') as leads_who_booked,
         count(*) filter (where event_type = 'show') as show_rows,
         count(*) filter (where event_type = 'no_show') as no_show_rows
  from a group by 1 order by 2 desc`);
