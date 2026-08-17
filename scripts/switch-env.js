const fs = require('fs');
const path = require('path');

const version = process.argv[2];
if (!['v1', 'v2'].includes(version)) {
  console.error('Usage: node scripts/switch-env.js v1|v2');
  process.exit(1);
}

const root = path.join(__dirname, '..');
const envLocal = path.join(root, '.env.local');
const envVersion = path.join(root, `.env.${version}`);

const versionVars = Object.fromEntries(
  fs.readFileSync(envVersion, 'utf8')
    .split('\n')
    .filter(l => l.includes('='))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);

let local = fs.readFileSync(envLocal, 'utf8');
for (const [key, val] of Object.entries(versionVars)) {
  local = local.replace(new RegExp(`^${key}=.*`, 'm'), `${key}=${val}`);
}

fs.writeFileSync(envLocal, local);
console.log(`✓ Switched to ${version} (${versionVars['NEXT_PUBLIC_SUPABASE_URL']})`);
