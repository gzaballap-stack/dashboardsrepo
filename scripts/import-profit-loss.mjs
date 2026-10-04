// Loads Profit and Loss lines (extracted from the owner's Google Sheet) into
// one account. V1 only — these are real finances and never belong in the demo.
//
//   node scripts/import-profit-loss.mjs <email> <path/to/lines.json>
//
// The JSON is a list of { month, kind, label, amount, leisure, position }.
// It is never committed. Refuses to run if the account already has lines, so
// running it twice cannot double the numbers.

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const [email, file] = process.argv.slice(2);
if (!email || !file) {
  console.error('Usage: node scripts/import-profit-loss.mjs <email> <path/to/lines.json>');
  process.exit(1);
}

const readEnv = name => readFileSync(resolve(__dirname, name), 'utf-8')
  .split('\n')
  .filter(line => line && !line.startsWith('#'))
  .reduce((acc, line) => {
    const [key, ...val] = line.split('=');
    if (key && val.length) acc[key.trim()] = val.join('=').trim();
    return acc;
  }, {});

const envVars = readEnv('../.env.v1');
const localVars = readEnv('../.env.local');

const PROJECT_REF = new URL(envVars['NEXT_PUBLIC_SUPABASE_URL']).hostname.split('.')[0];
const ACCESS_TOKEN = envVars['SUPABASE_ACCESS_TOKEN'] ?? localVars['SUPABASE_ACCESS_TOKEN'];

async function runSQL(sql, label) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const data = await res.json();
  if (!res.ok) { console.error(`✗ ${label}:`, JSON.stringify(data)); process.exit(1); }
  return data;
}

// The sheet's own "Client (clean)" rules, so one client isn't counted as two.
const cleanClient = name => name
  .replace(' (M2 Bathworks)', '')
  .replace(/^\s*stay.?fly.*$/i, 'Justin StayFLy')
  .trim();

const lines = JSON.parse(readFileSync(resolve(file), 'utf-8')).map(l => ({
  month: l.month,
  kind: l.kind,
  label: l.kind === 'revenue' ? cleanClient(l.label) : String(l.label).trim(),
  amount: Number(l.amount),
  leisure: l.kind === 'personal' && l.leisure === true,
  position: Number(l.position) || 0,
}));

const bad = lines.filter(l =>
  !/^\d{4}-(0[1-9]|1[0-2])-01$/.test(l.month)
  || !['revenue', 'expense', 'personal'].includes(l.kind)
  || !Number.isFinite(l.amount));
if (bad.length) { console.error('Unreadable lines:', bad.slice(0, 5)); process.exit(1); }

console.log(`Target: v1 (${PROJECT_REF}) — ${lines.length} lines for ${email}\n`);

const users = await runSQL(
  `select id from auth.users where lower(email) = lower('${email.replace(/'/g, "''")}')`, 'Find account');
if (users.length !== 1) { console.error(`✗ No single account for ${email}`); process.exit(1); }
const userId = users[0].id;

const existing = await runSQL(`select count(*)::int as n from pnl_lines where user_id = '${userId}'`, 'Check');
if (existing[0].n > 0) {
  console.error(`✗ This account already has ${existing[0].n} lines — nothing imported.`);
  process.exit(1);
}

await runSQL(`
  insert into pnl_lines (user_id, month, kind, label, amount, leisure, position)
  select '${userId}', x.month::date, x.kind, x.label, x.amount, x.leisure, x.position
  from jsonb_to_recordset($pnl_import$${JSON.stringify(lines)}$pnl_import$::jsonb)
    as x(month text, kind text, label text, amount numeric, leisure boolean, position int);
`, 'Import');

const check = await runSQL(`
  select count(*)::int as lines, count(distinct month)::int as months,
    sum(amount) filter (where kind = 'revenue')  as revenue,
    sum(amount) filter (where kind = 'expense')  as expenses,
    sum(amount) filter (where kind = 'personal') as personal
  from pnl_lines where user_id = '${userId}';
`, 'Verify');

console.log('✓ Imported\n' + JSON.stringify(check, null, 2));
