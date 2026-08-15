import https from 'https';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const envPath = resolve(__dirname, '../.env.local');
const envVars = readFileSync(envPath, 'utf-8')
  .split('\n')
  .filter(line => line && !line.startsWith('#'))
  .reduce((acc, line) => {
    const [key, ...val] = line.split('=');
    if (key && val.length) acc[key.trim()] = val.join('=').trim();
    return acc;
  }, {});

const SUPABASE_URL = envVars['NEXT_PUBLIC_SUPABASE_URL'];
const SERVICE_KEY = envVars['SUPABASE_SERVICE_ROLE_KEY'];
const SUPABASE_HOST = new URL(SUPABASE_URL).hostname;
const SUPABASE_IP = '104.18.38.10'; // Bypasses broken local DNS

// ── HTTP helpers ─────────────────────────────────────────────────────────────

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const req = https.request({
      host: SUPABASE_IP,
      servername: SUPABASE_HOST,
      path,
      method,
      headers: {
        host: SUPABASE_HOST,
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, data }); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const get = path => request('GET', path);
const post = (path, body) => request('POST', path, body);

// ── Seed clients ──────────────────────────────────────────────────────────────

const CLIENT_NAMES = [
  'Call Center Mastery',
  'Sooth Spa',
  'Simple Solar',
  'Jet Fast Medspa',
  'Warm HVAC',
  'Beast Pest Control',
];

async function getOrCreateOrg() {
  // Check if org exists
  const { data: orgs } = await get('/rest/v1/organizations?select=id&limit=1');
  if (Array.isArray(orgs) && orgs.length) return orgs[0].id;

  // Create a dummy org for TFU AI
  const { status, data } = await post('/rest/v1/organizations', {
    name: 'TFU AI',
    contact_email: 'admin@tfuai.com',
    status: 'active',
  });
  if (status >= 300) throw new Error(`Failed to create org: ${JSON.stringify(data)}`);
  console.log('  ✓ Created TFU AI org');
  return Array.isArray(data) ? data[0].id : data.id;
}

async function seedClients() {
  console.log('Seeding clients...');
  const orgId = await getOrCreateOrg();

  const { data: existing } = await get('/rest/v1/clients?select=name');
  const existingNames = new Set((Array.isArray(existing) ? existing : []).map(c => c.name));

  for (const name of CLIENT_NAMES) {
    if (existingNames.has(name)) { console.log(`  → ${name} already exists`); continue; }
    const { status, data } = await post('/rest/v1/clients', { name, org_id: orgId });
    if (status >= 300) console.log(`  ✗ ${name}: ${JSON.stringify(data)}`);
    else console.log(`  ✓ ${name}`);
  }
}

// ── Seed events & spend ───────────────────────────────────────────────────────

function rand(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function randFloat(min, max) { return Math.random() * (max - min) + min; }

const CLIENT_PROFILES = {
  'Call Center Mastery':  { leads: [8,15],  dials: [40,80],  bookRate: 0.55, showRate: 0.70, spend: [800,1500] },
  'Sooth Spa':            { leads: [5,12],  dials: [25,50],  bookRate: 0.45, showRate: 0.65, spend: [400,900] },
  'Simple Solar':         { leads: [3,8],   dials: [30,60],  bookRate: 0.35, showRate: 0.60, spend: [1200,2500] },
  'Jet Fast Medspa':      { leads: [6,14],  dials: [30,65],  bookRate: 0.50, showRate: 0.68, spend: [600,1200] },
  'Warm HVAC':            { leads: [4,10],  dials: [25,55],  bookRate: 0.40, showRate: 0.62, spend: [500,1000] },
  'Beast Pest Control':   { leads: [7,16],  dials: [35,70],  bookRate: 0.48, showRate: 0.66, spend: [450,950] },
};

async function seedData() {
  console.log('\nSeeding events & ad spend...');

  const { data: clients } = await get('/rest/v1/clients?select=id,name');
  if (!Array.isArray(clients) || !clients.length) { console.log('No clients found'); return; }

  const today = new Date();

  // Clear existing events to avoid duplicates on re-run
  for (const client of clients) {
    await request('DELETE', `/rest/v1/events?client_id=eq.${client.id}`);
    await request('DELETE', `/rest/v1/ad_spend?client_id=eq.${client.id}`);
  }

  for (const client of clients) {
    const profile = CLIENT_PROFILES[client.name];
    if (!profile) continue;
    console.log(`  Seeding ${client.name}...`);

    const events = [];
    const spends = [];

    for (let d = 60; d >= 0; d--) {
      const date = new Date(today);
      date.setDate(today.getDate() - d);
      const dateStr = date.toISOString().split('T')[0];
      if (date.getDay() === 0 && Math.random() < 0.3) continue;

      const leads    = rand(...profile.leads);
      const dials    = rand(...profile.dials);
      const booked   = Math.round(leads * profile.bookRate * randFloat(0.8, 1.2));
      const shows    = Math.round(booked * profile.showRate * randFloat(0.8, 1.2));
      const noShows  = Math.max(0, booked - shows - rand(0, 2));
      const callbacks = Math.round(leads * 0.15 * randFloat(0.5, 1.5));
      const pickupRate = randFloat(0.35, 0.55);
      const convRate   = randFloat(0.55, 0.75);
      const spend = randFloat(...profile.spend);

      // All events use same keys (PostgREST requires uniform keys in batch inserts)
      const baseEvent = (type, hour1, hour2) => {
        const t = new Date(date); t.setHours(rand(hour1,hour2), rand(0,59), rand(0,59));
        return { client_id: client.id, event_type: type, occurred_at: t.toISOString(),
          duration_seconds: null, is_pickup: null, is_conversation: null, speed_to_lead_seconds: null };
      };

      for (let i = 0; i < leads; i++) events.push(baseEvent('lead', 8, 18));
      for (let i = 0; i < dials; i++) {
        const e = baseEvent('dial', 8, 18);
        const isP = Math.random() < pickupRate;
        const isC = isP && Math.random() < convRate;
        e.duration_seconds = isP ? rand(40,600) : rand(5,39);
        e.is_pickup = isP; e.is_conversation = isC;
        e.speed_to_lead_seconds = rand(60,900);
        events.push(e);
      }
      for (let i = 0; i < booked; i++) events.push(baseEvent('appointment_booked', 8, 18));
      for (let i = 0; i < shows; i++) events.push(baseEvent('show', 9, 19));
      for (let i = 0; i < noShows; i++) events.push(baseEvent('no_show', 9, 19));
      for (let i = 0; i < callbacks; i++) events.push(baseEvent('callback_booked', 8, 17));
      spends.push({ client_id: client.id, spend_date: dateStr, platform: 'meta',   amount: Math.round(spend * 0.6 * 100) / 100 });
      spends.push({ client_id: client.id, spend_date: dateStr, platform: 'google', amount: Math.round(spend * 0.4 * 100) / 100 });
    }

    // Insert events in batches of 500
    for (let i = 0; i < events.length; i += 500) {
      const { status, data } = await post('/rest/v1/events', events.slice(i, i + 500));
      if (status >= 300) console.log(`    events error: ${JSON.stringify(data)}`);
    }
    // Upsert spend
    for (let i = 0; i < spends.length; i += 500) {
      const { status, data } = await request('POST', '/rest/v1/ad_spend?on_conflict=client_id,spend_date,platform', spends.slice(i, i + 500));
      if (status >= 300) console.log(`    spend error: ${JSON.stringify(data)}`);
    }

    console.log(`    → ${events.length} events, ${spends.length} spend rows`);
  }
}

await seedClients();
await seedData();
console.log('\nDone!');
