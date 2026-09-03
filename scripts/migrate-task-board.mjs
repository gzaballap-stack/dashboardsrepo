// Applies supabase/migrations/add_task_origin.sql to BOTH environments.
// Additive only — creates the `tasks` table. Nothing existing is modified.
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const env = (file) =>
  readFileSync(resolve(root, file), 'utf-8')
    .split('\n')
    .filter((l) => l && !l.startsWith('#'))
    .reduce((acc, l) => {
      const [k, ...v] = l.split('=');
      if (k && v.length) acc[k.trim()] = v.join('=').trim();
      return acc;
    }, {});

const TOKEN = env('.env.local')['SUPABASE_ACCESS_TOKEN'];
const sql = readFileSync(resolve(root, 'supabase/migrations/add_task_origin.sql'), 'utf-8');

for (const file of ['.env.v1', '.env.v2']) {
  const ref = new URL(env(file)['NEXT_PUBLIC_SUPABASE_URL']).hostname.split('.')[0];
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const body = await res.text();
  console.log(res.ok ? `✓ ${file} (${ref})` : `✗ ${file} (${ref}): ${body}`);
}
