#!/usr/bin/env node
// Sets how often the Make ad-spend scenarios run (12 clients + B2B).
// Only touches scenarios named "CCM - Meta Spend → …" / "CCM - B2B Meta Spend → …",
// and only their schedule — never the blueprint.
//
//   node scripts/set-spend-schedule.mjs            # preview
//   node scripts/set-spend-schedule.mjs --apply    # change the schedules

import fs from 'fs';

const TIMES = ['07:00', '13:00', '19:00'];   // Make organisation time
const apply = process.argv.includes('--apply');

function envVal(key) {
  for (const f of ['.env.local', '.env.v1']) {
    try {
      for (const l of fs.readFileSync(f, 'utf8').split('\n')) {
        const i = l.indexOf('=');
        if (i > 0 && l.slice(0, i).trim() === key) return l.slice(i + 1).trim().replace(/^["']|["']$/g, '');
      }
    } catch { /* ignore */ }
  }
  return null;
}

const key = envVal('MAKE_API_KEY');
if (!key) { console.error('MAKE_API_KEY not found'); process.exit(1); }
const base = 'https://eu1.make.com/api/v2';
const H = { Authorization: 'Token ' + key, 'Content-Type': 'application/json' };
const plus1 = t => { const [h, m] = t.split(':').map(Number); return `${String(h).padStart(2, '0')}:${String(m + 1).padStart(2, '0')}`; };

const list = await (await fetch(`${base}/scenarios?teamId=875675&pg[limit]=200`, { headers: H })).json();
const targets = (list.scenarios ?? []).filter(s => /^CCM - (B2B )?Meta Spend → /.test(s.name));

const scheduling = {
  type: 'indefinitely', interval: 900,
  restrict: TIMES.map(t => ({ days: [0, 1, 2, 3, 4, 5, 6], time: [t, plus1(t)] })),
};

console.log(`${apply ? 'APPLYING' : 'PREVIEW'} · ${targets.length} scenarios · runs at ${TIMES.join(', ')}`);
for (const s of targets) {
  const now = (s.scheduling?.restrict ?? []).map(r => r.time?.[0]).join(', ') || s.scheduling?.type;
  if (!apply) { console.log(`  ${s.name}  (now: ${now})`); continue; }
  const r = await fetch(`${base}/scenarios/${s.id}`, { method: 'PATCH', headers: H, body: JSON.stringify({ scheduling: JSON.stringify(scheduling) }) });
  const j = await r.json().catch(() => ({}));
  const after = (j.scenario?.scheduling?.restrict ?? []).map(x => x.time?.[0]).join(', ');
  console.log(`  ${r.status} ${s.name}  → ${after || JSON.stringify(j).slice(0, 200)}`);
}
