// A reschedule is not a new booking.
//
//   node scripts/migrate-reschedules.mjs v1
//       lets the database store a booking as "rescheduled" (additive, safe to
//       re-run), then LISTS the bookings already stored that are a lead booking
//       again within 60 days. It changes none of them.
//
//   node scripts/migrate-reschedules.mjs v1 --fix-existing
//       the same, then relabels the ones listed as "rescheduled" so the
//       dashboards stop counting them as bookings. Nothing is deleted, and each
//       row is stamped so it can be put back:
//         update events set event_type = 'appointment_booked'
//         where raw->>'_retagged_from' = 'appointment_booked';
//       A booking billed, credited or marked not billed in Client Billing is
//       never relabelled.
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const target = (process.argv[2] ?? '').toLowerCase();
if (!['v1', 'v2'].includes(target)) {
  console.error('Usage: node scripts/migrate-reschedules.mjs <v1|v2> [--fix-existing]');
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

const FIX = process.argv.includes('--fix-existing');

async function run(title, sql, { table = true } = {}) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const data = await res.json();
  if (!res.ok) { console.error(`✗ ${title}:`, JSON.stringify(data)); process.exit(1); }
  console.log(`✓ ${title}`);
  if (table && Array.isArray(data) && data.length) console.table(data);
  return data;
}

console.log(`Target: ${target} (${PROJECT_REF})\n`);

await run('"rescheduled" can be stored', readFileSync(resolve(__dirname, '../supabase/migrations/add_rescheduled_type.sql'), 'utf-8'), { table: false });
await run('Check', `
  select position('rescheduled' in pg_get_constraintdef(oid)) > 0 as rescheduled_allowed
  from pg_constraint where conname = 'events_event_type_check' and conrelid = 'public.events'::regclass`);

// The same lead (GHL contact, else the last 10 digits of the phone) booking
// again with the same client within 60 days of their booking before it — the
// rule the app now applies as bookings arrive. Never one Client Billing has
// already dealt with in its own right, and never Tomsi Media's own funnel.
const REPEATS = `
  with a as (
    select e.id, e.client_id, e.occurred_at,
           coalesce(nullif(e.ghl_contact_id, ''), nullif(right(regexp_replace(coalesce(e.lead_phone, ''), '[^0-9]', '', 'g'), 10), '')) as lead
    from events e join clients c on c.id = e.client_id
    where e.event_type = 'appointment_booked' and not coalesce(c.is_internal, false)
  ), r as (
    select id, client_id, occurred_at, lag(occurred_at) over (partition by client_id, lead order by occurred_at) as before
    from a where lead is not null
  ), repeats as (
    select r.id, r.client_id, r.occurred_at, r.before from r
    where r.before is not null and r.occurred_at - r.before <= interval '60 days'
      and not exists (select 1 from billing_appointments b where b.event_id = r.id)
  )`;

const found = await run('Bookings already stored that are a lead booking again', `${REPEATS}
  select c.name as client, repeats.before::date as first_booked, repeats.occurred_at::date as booked_again
  from repeats join clients c on c.id = repeats.client_id order by 3 desc`);
if (!found.length) console.log('  none');

if (!FIX) {
  if (found.length) console.log(`\nNothing was changed. To stop these ${found.length} counting as bookings:\n  node scripts/migrate-reschedules.mjs ${target} --fix-existing`);
} else if (found.length) {
  const done = await run('Relabelled as rescheduled', `${REPEATS}
    update events e
    set event_type = 'rescheduled',
        raw = coalesce(e.raw, '{}'::jsonb) || jsonb_build_object('_retagged_from', 'appointment_booked', '_retagged_at', now())
    from repeats where e.id = repeats.id and e.event_type = 'appointment_booked'
    returning e.id`, { table: false });
  console.log(`  ${done.length} relabelled — no row deleted`);
}
