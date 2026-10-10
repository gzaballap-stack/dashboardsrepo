// Applies supabase/migrations/add_sales_call_doc_fills.sql to V1 and V2.
// Usage: node scripts/migrate-sales-call-doc-fills.mjs
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sql = readFileSync(resolve(root, 'supabase/migrations/add_sales_call_doc_fills.sql'), 'utf-8');

function env(file) {
  return readFileSync(resolve(root, file), 'utf-8').split('\n').reduce((acc, line) => {
    const [k, ...v] = line.split('=');
    if (k && v.length && !k.startsWith('#')) acc[k.trim()] = v.join('=').trim();
    return acc;
  }, {});
}
const token = env('.env.local').SUPABASE_ACCESS_TOKEN;

for (const file of ['.env.v1', '.env.v2']) {
  const ref = new URL(env(file).NEXT_PUBLIC_SUPABASE_URL).hostname.split('.')[0];
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const body = await res.text();
  console.log(res.ok ? `✓ ${file} (${ref})` : `✗ ${file} (${ref}): ${body}`);
  if (!res.ok) process.exit(1);
}
