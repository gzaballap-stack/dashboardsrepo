// Client Billing: a "billed daily or weekly" setting per client — one new column
// with a default (every client stays daily). Additive and
// idempotent, safe to re-run.
//
//   node scripts/migrate-billing-cycle.mjs v1
//   node scripts/migrate-billing-cycle.mjs v2

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const target = (process.argv[2] ?? '').toLowerCase();
if (!['v1', 'v2'].includes(target)) {
  console.error('Usage: node scripts/migrate-billing-cycle.mjs <v1|v2>');
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

await runSQL(readFileSync(resolve(__dirname, '../supabase/migrations/add_billing_cycle.sql'), 'utf-8'), 'Billing cycle column');

// Proof it is there, and that nobody's billing changed: every client is daily.
const check = await runSQL(`
  select billing_cycle, count(*) as clients from billing_clients group by billing_cycle order by billing_cycle;
`, 'Verify');
console.table(check);
