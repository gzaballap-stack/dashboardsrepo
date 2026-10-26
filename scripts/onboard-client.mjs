#!/usr/bin/env node
// Onboard a new client on V1 (production):
//   1. add the client row (clients.name) on the V1 database
//   2. store its Meta ad account, so the app's scheduled spend sync covers it
//   3. optionally backfill Meta spend for the last N days
//
// Usage:
//   node scripts/onboard-client.mjs --name "Client Name" --account act_1234567890 [--backfill 30] [--dry-run]
//
// Reads V1 Supabase creds from .env.v1 and the admin secret from .env.local.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const V1_URL        = 'https://app.tomsimedia.com';

function readEnv(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].trim();
  }
  return out;
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const v1   = readEnv(path.join(root, '.env.v1'));
const loc  = readEnv(path.join(root, '.env.local'));

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const name     = opt('--name')?.trim();
const account  = opt('--account')?.trim();
const backfill = Number(opt('--backfill') ?? 0);
const dryRun   = args.includes('--dry-run');

if (!name || !account) { console.error('need --name and --account'); process.exit(1); }
if (!/^act_\d+$/.test(account)) { console.error(`account id must look like act_123456 (got "${account}")`); process.exit(1); }

const SB_URL = v1.NEXT_PUBLIC_SUPABASE_URL, SB_KEY = v1.SUPABASE_SERVICE_ROLE_KEY;
const ADMIN = loc.ADMIN_WEBHOOK_SECRET;
for (const [k, v] of Object.entries({ SB_URL, SB_KEY, ADMIN })) if (!v) { console.error(`missing ${k}`); process.exit(1); }

const sb = (p, init = {}) => fetch(`${SB_URL}/rest/v1/${p}`, { ...init, headers: { apikey: SB_KEY, 'Content-Type': 'application/json', Prefer: 'return=representation', ...(init.headers || {}) } });

// ── 1. client row ─────────────────────────────────────────────────────────
const existing = await (await sb(`clients?select=id,name,status&name=eq.${encodeURIComponent(name)}`)).json();
let clientId = existing[0]?.id;
if (clientId) console.log(`client row: already exists (${existing[0].status})`);
else if (dryRun) console.log('client row: would create');
else {
  const r = await sb('clients', { method: 'POST', body: JSON.stringify({ name, is_live: true, status: 'live', meta_account_id: account }) });
  const j = await r.json();
  if (!r.ok) { console.error('client insert failed:', j); process.exit(1); }
  clientId = j[0].id; console.log('client row: created');
}

// ── 2. Meta ad account ────────────────────────────────────────────────────
// The app's scheduled spend sync (/api/cron/sync-spend) picks up every client
// with a meta_account_id — no Make scenario needed.
if (clientId && !dryRun) {
  const r = await sb(`clients?id=eq.${clientId}`, { method: 'PATCH', body: JSON.stringify({ meta_account_id: account }) });
  if (!r.ok) { console.error('setting meta_account_id failed:', await r.text()); process.exit(1); }
  console.log(`meta account: ${account} set — spend syncs 3x a day from now on`);
} else console.log(`meta account: would set ${account}`);

// ── 3. backfill ───────────────────────────────────────────────────────────
if (backfill > 0) {
  let total = 0, days = 0;
  for (let i = 1; i <= backfill; i++) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    if (dryRun) { console.log(`backfill: would sync ${d}`); continue; }
    const r = await fetch(`${V1_URL}/api/ad-spend/sync-all`, { method: 'POST', headers: { Authorization: `Bearer ${ADMIN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ client_name: name, date: d, platform: 'meta', account_id: account }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { console.error(`backfill ${d}: ${j.error || r.status}`); if (r.status === 502) break; continue; }
    if (j.ads) { days++; total += Number(j.total_spend ?? 0); }
  }
  if (!dryRun) console.log(`backfill: ${days}/${backfill} days had spend`);
}
console.log('done');
