// Profit and Loss in euros as well as dollars: adds the currency + rate columns,
// then gives every existing line (all entered in dollars) the USD→EUR rate of
// its own month (ECB reference rate for the 15th, via frankfurter.dev), so
// history reads in euros at the rate of the time, not today's.
//
//   node scripts/migrate-pnl-currency.mjs v1
//   node scripts/migrate-pnl-currency.mjs v2
//
// Safe to re-run: columns are IF NOT EXISTS and only lines without a rate are
// filled in.

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const target = (process.argv[2] ?? '').toLowerCase();
if (!['v1', 'v2'].includes(target)) {
  console.error('Usage: node scripts/migrate-pnl-currency.mjs <v1|v2>');
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

await runSQL(readFileSync(resolve(__dirname, '../supabase/migrations/add_pnl_currency.sql'), 'utf-8'),
  'currency + rate columns');

const months = await runSQL(
  `select distinct to_char(month, 'YYYY-MM') as ym from pnl_lines where usd_eur_rate is null order by 1`,
  'Months still without a rate');

for (const { ym } of months) {
  const res = await fetch(`https://api.frankfurter.dev/v1/${ym}-15?base=USD&symbols=EUR`);
  const body = await res.json();
  const rate = Number(body?.rates?.EUR);
  if (!res.ok || !Number.isFinite(rate)) { console.error(`✗ no rate for ${ym}:`, JSON.stringify(body)); process.exit(1); }
  await runSQL(
    `update pnl_lines set usd_eur_rate = ${rate} where usd_eur_rate is null and to_char(month, 'YYYY-MM') = '${ym}'`,
    `${ym}: 1 USD = ${rate} EUR (${body.date})`);
}

const check = await runSQL(`
  select count(*)::int as lines, count(usd_eur_rate)::int as with_rate,
    count(*) filter (where currency = 'EUR')::int as in_eur
  from pnl_lines;
`, 'Verify');
console.log('\n' + JSON.stringify(check, null, 2));
