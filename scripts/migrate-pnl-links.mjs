// Profit and Loss: the client → Client Roster link. Idempotent, safe to re-run.
//
//   node scripts/migrate-pnl-links.mjs v1
//   node scripts/migrate-pnl-links.mjs v2

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const target = (process.argv[2] ?? '').toLowerCase();
if (!['v1', 'v2'].includes(target)) {
  console.error('Usage: node scripts/migrate-pnl-links.mjs <v1|v2>');
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

await runSQL(readFileSync(resolve(__dirname, '../supabase/migrations/add_pnl_roster_link.sql'), 'utf-8'),
  'Client profile → roster link');

const check = await runSQL(`
  select
    (select count(*) from information_schema.columns
      where table_schema = 'public' and table_name = 'pnl_clients' and column_name = 'client_id') as link_column,
    (select count(*) from pnl_clients) as profiles,
    (select count(*) from pnl_clients where client_id is not null) as linked_to_roster;
`, 'Verify');
console.log('\n' + JSON.stringify(check, null, 2));
