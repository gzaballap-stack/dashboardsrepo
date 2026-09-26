#!/usr/bin/env node
// Narrow, guarded data-cleanup trigger.
//
// This is the ONLY way this project runs a data cleanup. It cannot touch the
// database directly — it just calls the guarded /api/admin/data-cleanup endpoint,
// which allows only two named, preview-first operations and caps how much it can
// change. Dry-run by default; pass --apply to actually change data.
//
//   node scripts/run-cleanup.mjs <op>            # preview only
//   node scripts/run-cleanup.mjs <op> --apply    # make the change
//
//   <op> = relabel_intros_to_demos | dedupe_bookings
//   --v2 targets the demo environment instead of production.

import fs from 'fs';

const OPS = ['relabel_intros_to_demos', 'dedupe_bookings', 'restore_early_intros', 'reconcile_b2b'];
const op = process.argv[2];
const apply = process.argv.includes('--apply');
const v2 = process.argv.includes('--v2');

if (!OPS.includes(op)) {
  console.error(`Unknown op "${op || ''}". Allowed: ${OPS.join(', ')}`);
  process.exit(1);
}

function envVal(key) {
  for (const f of ['.env.local', '.env.v1']) {
    try {
      const m = fs.readFileSync(f, 'utf8').match(new RegExp('^' + key + '=(.*)$', 'm'));
      if (m) return m[1].trim().replace(/^["']|["']$/g, '');
    } catch { /* ignore */ }
  }
  return null;
}

const secret = envVal('ADMIN_WEBHOOK_SECRET');
if (!secret) { console.error('ADMIN_WEBHOOK_SECRET not found in .env.local/.env.v1'); process.exit(1); }

const base = v2 ? 'https://dashboards.tomsimedia.com' : 'https://app.tomsimedia.com';

const res = await fetch(base + '/api/admin/data-cleanup', {
  method: 'POST',
  headers: { Authorization: 'Bearer ' + secret, 'Content-Type': 'application/json' },
  body: JSON.stringify({ op, dry_run: !apply }),
});
const body = await res.json().catch(() => ({}));
console.log(`${apply ? 'APPLIED' : 'PREVIEW'} · ${op} · ${v2 ? 'V2' : 'V1'} · status ${res.status}`);
console.log(JSON.stringify(body, null, 2));
