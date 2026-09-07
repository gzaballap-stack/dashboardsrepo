// Applies the Lifting Tracker tables and the per-user feature-access column.
//
// Both databases have to be migrated separately — deploying does not touch
// schema. Run it once per environment:
//
//   node scripts/migrate-lift-and-access.mjs v1
//   node scripts/migrate-lift-and-access.mjs v2
//
// Additive only, and safe to re-run: every statement is IF NOT EXISTS, and the
// new `profiles.allowed_views` column is left NULL, which every code path reads
// as "no restriction". Nobody's access changes until an admin narrows it by hand.

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const target = (process.argv[2] ?? '').toLowerCase();
if (!['v1', 'v2'].includes(target)) {
  console.error('Usage: node scripts/migrate-lift-and-access.mjs <v1|v2>');
  process.exit(1);
}

const envPath = resolve(__dirname, `../.env.${target}`);
const envVars = readFileSync(envPath, 'utf-8')
  .split('\n')
  .filter(line => line && !line.startsWith('#'))
  .reduce((acc, line) => {
    const [key, ...val] = line.split('=');
    if (key && val.length) acc[key.trim()] = val.join('=').trim();
    return acc;
  }, {});

// SUPABASE_ACCESS_TOKEN is a personal token and lives in .env.local, not the
// per-environment files.
const localVars = readFileSync(resolve(__dirname, '../.env.local'), 'utf-8')
  .split('\n')
  .filter(line => line && !line.startsWith('#'))
  .reduce((acc, line) => {
    const [key, ...val] = line.split('=');
    if (key && val.length) acc[key.trim()] = val.join('=').trim();
    return acc;
  }, {});

const PROJECT_REF = new URL(envVars['NEXT_PUBLIC_SUPABASE_URL']).hostname.split('.')[0];
const ACCESS_TOKEN = envVars['SUPABASE_ACCESS_TOKEN'] ?? localVars['SUPABASE_ACCESS_TOKEN'];

if (!ACCESS_TOKEN) {
  console.error('SUPABASE_ACCESS_TOKEN not found in .env.' + target + ' or .env.local');
  process.exit(1);
}

async function runSQL(sql, label) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const data = await res.json();
  if (!res.ok) { console.error(`✗ ${label}:`, JSON.stringify(data)); process.exit(1); }
  console.log(`✓ ${label}`);
  return data;
}

console.log(`Target: ${target} (${PROJECT_REF})\n`);

await runSQL(readFileSync(resolve(__dirname, '../supabase/migrations/add_lift_tracker.sql'), 'utf-8'),
  'Lifting Tracker tables');

await runSQL(readFileSync(resolve(__dirname, '../supabase/migrations/add_user_feature_access.sql'), 'utf-8'),
  'profiles.allowed_views');

await runSQL(readFileSync(resolve(__dirname, '../supabase/migrations/add_health_plans.sql'), 'utf-8'),
  'Diet plan + gym split columns');

const check = await runSQL(`
  select
    (select count(*) from information_schema.tables
      where table_schema = 'public' and table_name in ('lift_entries','lift_settings')) as lift_tables,
    (select count(*) from information_schema.columns
      where table_schema = 'public' and table_name = 'profiles' and column_name = 'allowed_views') as access_column,
    (select count(*) from profiles where allowed_views is not null) as restricted_accounts;
`, 'Verify');

console.log('\n' + JSON.stringify(check, null, 2));
console.log('\nDone. `restricted_accounts` should be 0 — nobody has been narrowed yet.');
