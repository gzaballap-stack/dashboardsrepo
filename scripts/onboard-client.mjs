#!/usr/bin/env node
// Onboard a new client on V1 (production):
//   1. add the client row (clients.name) on the V1 database
//   2. clone the live "CCM - Meta Spend → <client>" Make scenario for it and switch it on
//   3. optionally backfill Meta spend for the last N days
//
// Usage:
//   node scripts/onboard-client.mjs --name "Client Name" --account act_1234567890 [--backfill 30] [--dry-run]
//
// Reads V1 Supabase creds from .env.v1 and Make / admin creds from .env.local.
// Make team, folder and template scenario are the live ones (see NOTES.md).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const MAKE_TEAM_ID  = 875675;
const MAKE_FOLDER   = 356178;
const TEMPLATE_ID   = 7137679;           // CCM - Meta Spend → D and B Construction
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
const MK_KEY = loc.MAKE_API_KEY, MK_REGION = loc.MAKE_REGION || 'eu1', ADMIN = loc.ADMIN_WEBHOOK_SECRET;
for (const [k, v] of Object.entries({ SB_URL, SB_KEY, MK_KEY, ADMIN })) if (!v) { console.error(`missing ${k}`); process.exit(1); }

const sb = (p, init = {}) => fetch(`${SB_URL}/rest/v1/${p}`, { ...init, headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...(init.headers || {}) } });
const mk = (p, init = {}) => fetch(`https://${MK_REGION}.make.com/api/v2/${p}`, { ...init, headers: { Authorization: `Token ${MK_KEY}`, 'Content-Type': 'application/json', ...(init.headers || {}) } });

// ── 1. client row ─────────────────────────────────────────────────────────
const existing = await (await sb(`clients?select=id,name,status&name=eq.${encodeURIComponent(name)}`)).json();
let clientId = existing[0]?.id;
if (clientId) console.log(`client row: already exists (${existing[0].status})`);
else if (dryRun) console.log('client row: would create');
else {
  const r = await sb('clients', { method: 'POST', body: JSON.stringify({ name, is_live: true, status: 'live' }) });
  const j = await r.json();
  if (!r.ok) { console.error('client insert failed:', j); process.exit(1); }
  clientId = j[0].id; console.log('client row: created');
}

// ── 2. Make scenario ──────────────────────────────────────────────────────
const scenarioName = `CCM - Meta Spend → ${name}`;
const list = await (await mk(`scenarios?teamId=${MAKE_TEAM_ID}&pg[limit]=500`)).json();
const dup = (list.scenarios || []).find(s => s.name === scenarioName);
if (dup) console.log(`make scenario: already exists (${dup.id}, ${dup.isActive ? 'on' : 'off'})`);
else {
  const tpl = await (await mk(`scenarios/${TEMPLATE_ID}/blueprint`)).json();
  const tplScenario = await (await mk(`scenarios/${TEMPLATE_ID}`)).json();
  const bp = tpl.response.blueprint;
  bp.name = scenarioName;
  const http = bp.flow.find(m => m.module === 'http:ActionSendData');
  const data = JSON.parse(http.mapper.data);
  if (!data.client_name || !data.account_id) { console.error('template shape changed — check scenario', TEMPLATE_ID); process.exit(1); }
  data.client_name = name; data.account_id = account;
  http.mapper.data = JSON.stringify(data);
  if (!http.mapper.url.startsWith(V1_URL)) { console.error('template does not point at V1:', http.mapper.url); process.exit(1); }
  const scheduling = tplScenario.scenario.scheduling;
  if (dryRun) console.log(`make scenario: would create "${scenarioName}" → ${account}, schedule ${JSON.stringify(scheduling)}`);
  else {
    const r = await mk('scenarios', { method: 'POST', body: JSON.stringify({ teamId: MAKE_TEAM_ID, folderId: MAKE_FOLDER, blueprint: JSON.stringify(bp), scheduling: JSON.stringify(scheduling) }) });
    const j = await r.json();
    if (!r.ok) { console.error('make create failed:', j); process.exit(1); }
    const id = j.scenario.id;
    const s = await mk(`scenarios/${id}/start`, { method: 'POST' });
    console.log(`make scenario: created ${id}, ${s.ok ? 'switched on' : 'CREATED BUT NOT SWITCHED ON — turn it on in Make'}`);
  }
}

// ── 3. backfill ───────────────────────────────────────────────────────────
if (backfill > 0) {
  const token = loc.META_ACCESS_TOKEN;
  if (!token) { console.error('backfill needs META_ACCESS_TOKEN in .env.local'); process.exit(1); }
  let total = 0, days = 0;
  for (let i = 1; i <= backfill; i++) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    if (dryRun) { console.log(`backfill: would sync ${d}`); continue; }
    const r = await fetch(`${V1_URL}/api/ad-spend/sync-all`, { method: 'POST', headers: { Authorization: `Bearer ${ADMIN}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ client_name: name, date: d, platform: 'meta', meta_token: token, account_id: account }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { console.error(`backfill ${d}: ${j.error || r.status}`); if (r.status === 502) break; continue; }
    if (j.ads) { days++; total += Number(j.total_spend ?? 0); }
  }
  if (!dryRun) console.log(`backfill: ${days}/${backfill} days had spend`);
}
console.log('done');
