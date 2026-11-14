#!/usr/bin/env node
// Funnel drafts from a Claude session: the "AI edits" of the funnel builder,
// done in chat instead of through a paid API call inside the dashboard.
//
// Claude reads the funnel's wording, changes it as the user asked, and saves it
// as a DRAFT. It cannot make anything live: the user opens the draft in
// Tomsi Media > Funnels, checks it, and presses Make live.
//
//   node scripts/funnel-draft.mjs get [--out <file>]                 list versions; --out writes the live version's wording to a file
//   node scripts/funnel-draft.mjs get --number 3 --out <file>         write that version's wording to a file
//   node scripts/funnel-draft.mjs create --file <content.json> --name "Shorter headline" [--notes "..."] [--from 2]
//   node scripts/funnel-draft.mjs update --number 3 --file <content.json> [--name "..."] [--notes "..."]
//
//   --slug <funnel> (default check-your-market) · --v2 targets the demo environment.
//
// The wording file is the content object described in src/lib/funnel-content.ts
// ({ landing: [...sections], form: {...}, booked: [...sections] }).

import fs from 'fs';

const args = process.argv.slice(2);
const cmd = args[0];
const opt = (k) => { const i = args.indexOf('--' + k); return i === -1 ? undefined : args[i + 1]; };
const slug = opt('slug') ?? 'check-your-market';
const base = (args.includes('--v2') ? 'https://dashboards.tomsimedia.com' : 'https://app.tomsimedia.com') + '/api/webhooks/funnel/draft';

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
const headers = { Authorization: 'Bearer ' + secret, 'Content-Type': 'application/json' };

if (cmd === 'get') {
  const res = await fetch(`${base}?slug=${slug}`, { headers });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) { console.error(res.status, body); process.exit(1); }
  for (const v of body.versions) console.log(`V${v.number} · ${v.status}${v.locked ? ' (frozen)' : ''} · ${v.name}${v.notes ? ' · ' + v.notes.split('\n')[0] : ''}`);
  const out = opt('out');
  if (out) {
    const want = opt('number');
    const v = want ? body.versions.find(x => x.number === Number(want)) : body.versions.find(x => x.status === 'live') ?? body.versions[0];
    if (!v) { console.error('No such version'); process.exit(1); }
    fs.writeFileSync(out, JSON.stringify(v.content, null, 2));
    console.log(`Wrote version ${v.number}'s wording to ${out}`);
  }
} else if (cmd === 'create' || cmd === 'update') {
  const file = opt('file');
  const content = file ? JSON.parse(fs.readFileSync(file, 'utf8')) : undefined;
  if (cmd === 'create' && !content) { console.error('create needs --file <content.json>'); process.exit(1); }
  const payload = { slug, content, name: opt('name'), notes: opt('notes') };
  if (cmd === 'update') payload.number = Number(opt('number'));
  else if (opt('from')) payload.from = Number(opt('from'));
  const res = await fetch(base, { method: 'POST', headers, body: JSON.stringify(payload) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) { console.error(res.status, body); process.exit(1); }
  console.log(`${cmd === 'create' ? 'Created' : 'Updated'} draft version ${body.number}. Preview: ${body.preview}`);
} else {
  console.error('usage: node scripts/funnel-draft.mjs get|create|update  (see the top of this file)');
  process.exit(1);
}
