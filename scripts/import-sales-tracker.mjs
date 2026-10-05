// Loads the owner's "Sales Tracker 2026" sheet into the Sales Tracker.
//
//   node scripts/import-sales-tracker.mjs <v1|v2> .sales-import/calls.json
//
// The JSON is an array of sales_calls rows (call_date, name, source, pitch,
// call_minutes, recording_url, outcome, emotions, conclusion, notes, contact).
// Refuses to run if the table already has calls, so it can't double-load.
// .sales-import/ is gitignored: real prospects, never committed or seeded to V2.

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const [target, file] = process.argv.slice(2);
if (!['v1', 'v2'].includes(target) || !file) {
  console.error('Usage: node scripts/import-sales-tracker.mjs <v1|v2> <calls.json>');
  process.exit(1);
}

const env = readFileSync(resolve(__dirname, `../.env.${target}`), 'utf-8')
  .split('\n').filter(l => l && !l.startsWith('#'))
  .reduce((acc, l) => { const [k, ...v] = l.split('='); if (k && v.length) acc[k.trim()] = v.join('=').trim(); return acc; }, {});

const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
const KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const headers = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

const existing = await fetch(`${URL_}/rest/v1/sales_calls?select=id&limit=1`, { headers }).then(r => r.json());
if (!Array.isArray(existing)) { console.error('Could not read sales_calls:', existing); process.exit(1); }
if (existing.length) { console.error('sales_calls already has calls — not importing twice.'); process.exit(1); }

const calls = JSON.parse(readFileSync(resolve(process.cwd(), file), 'utf-8'));
const res = await fetch(`${URL_}/rest/v1/sales_calls`, {
  method: 'POST', headers: { ...headers, Prefer: 'return=minimal' }, body: JSON.stringify(calls),
});
if (!res.ok) { console.error('Insert failed:', await res.text()); process.exit(1); }
console.log(`✓ ${calls.length} calls loaded into ${target}`);
