// node scripts/migrate-share-links.mjs <v1|v2> — creates the share_links table.
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const which = process.argv[2];
if (!['v1', 'v2'].includes(which)) { console.error('usage: node scripts/migrate-share-links.mjs v1|v2'); process.exit(1); }
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const env = f => Object.fromEntries(readFileSync(resolve(root, f), 'utf8').split('\n').filter(l => l.includes('=') && !l.startsWith('#'))
  .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')]; }));
const target = env(`.env.${which}`), local = env('.env.local');
const ref = new URL(target.NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0];
const sql = readFileSync(resolve(root, 'supabase/migrations/add_share_links.sql'), 'utf8');
const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
  method: 'POST', headers: { Authorization: `Bearer ${local.SUPABASE_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: sql }),
});
const out = await res.text();
if (!res.ok) { console.error(`✗ ${which} (${ref}):`, out); process.exit(1); }
console.log(`✓ ${which} (${ref}): share_links ready`);
