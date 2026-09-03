// Seeds `zip_creative_attribution`: which ad produced each zip's leads,
// appointments, shows and closes.
//
// The zip Performance view for demo clients reads `zip_performance` — one
// aggregate row per zip, with no record of which creative drove it. This script
// invents a plausible creative bank and splits every zip's existing numbers
// across it, so the per-zip "Ads & creatives" drill-down has something real to
// show. Counts always sum back to the zip's stored figures, so nothing the
// dashboard already displays changes.
//
// Usage:  node scripts/seed-zip-attribution.mjs [--dry-run] [--allow-v1]
//
// Reads whichever Supabase project .env.local currently points at, and refuses
// to touch V1 unless --allow-v1 is passed explicitly.

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const V1_REF = 'fsebiwzgjenjwiyujexl'; // production — never a target for demo data

const env = readFileSync(resolve(__dirname, '../.env.local'), 'utf-8')
  .split('\n')
  .filter(l => l && !l.startsWith('#'))
  .reduce((acc, line) => {
    const [k, ...v] = line.split('=');
    if (k && v.length) acc[k.trim()] = v.join('=').trim();
    return acc;
  }, {});

const URL_BASE = env['NEXT_PUBLIC_SUPABASE_URL'];
const KEY      = env['SUPABASE_SERVICE_ROLE_KEY'];
const REF      = new URL(URL_BASE).hostname.split('.')[0];

const DRY      = process.argv.includes('--dry-run');
const ALLOW_V1 = process.argv.includes('--allow-v1');

if (REF === V1_REF && !ALLOW_V1) {
  console.error(`✗ .env.local points at V1 (${REF}). This seeds demo data — refusing.`);
  console.error('  Run `npm run use:v2` first, or pass --allow-v1 if you really mean it.');
  process.exit(1);
}

// Per client: average project size (mirrors avg_revenue in
// src/lib/mock-generator.ts) and the closed-revenue total the demo should land
// on. Job values stay realistic, so hitting the target means carrying fewer
// closes — the close counts are scaled down to suit, never the ticket price.
// The two targets keep the clients in proportion (BlueSky runs ~4x the zips).
const CLIENTS = {
  'Craftsman Kitchen Group': { avgTicket: 42500, targetRevenue: 3_000_000 },
  'BlueSky Renovations':     { avgTicket: 29500, targetRevenue: 9_370_000 },
};

// One remodel job's contract value. Right-skewed around the client's average:
// most jobs land near it, a few run well over (full gut, high-end selections)
// and a few well under (single bath, refacing). Two decimals — real money.
function jobValue(rng, avg) {
  // Box-Muller normal -> lognormal, so the tail leans high rather than symmetric.
  const u1 = Math.max(rng(), 1e-9), u2 = rng();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  const mult = Math.exp(z * 0.42 - 0.088);   // sigma 0.42, median-corrected
  const clamped = Math.min(2.6, Math.max(0.42, mult));
  return Math.round(avg * clamped * 100) / 100;
}

// ── Creative bank ───────────────────────────────────────────────────────────
// B-roll footage (10), scripts (12 kitchen + 12 bath), still images (20).
// Ad sets are scripts; ads are a script paired with a b-roll cut or a still.

const BROLL = [
  'Demo Day Teardown', 'Cabinet Install Timelapse', 'Countertop Template & Set',
  'Before / After Slider', 'Designer Walkthrough', 'Tile & Backsplash Detail',
  'Drone Neighborhood Open', 'Crew On Site', 'Client Reaction Reveal',
  'Showroom Selection',
];

const KITCHEN_SCRIPTS = [
  'Dated Kitchen Callout', '3-Week Turnaround Promise', 'Financing From $0 Down',
  'Refacing vs Full Gut', 'Free In-Home Design Consult', 'Neighbor Just Remodeled',
  '5 Contractor Mistakes', 'Real Client Testimonial', 'Cost Breakdown Explainer',
  'Small Kitchen Big Impact', 'Permit & Warranty Peace Of Mind', 'Limited Fall Install Slots',
];

const BATH_SCRIPTS = [
  'Tub To Shower Conversion', 'One Day Bath Remodel', 'Walk-In Safety For Parents',
  'Outdated Tile Callout', 'Free Bathroom Design Quote', 'Master Bath Luxury Upgrade',
  'Small Bath Space Saver', 'Mold & Water Damage Fix', 'Real Client Testimonial',
  'Financing From $0 Down', 'Cost Breakdown Explainer', 'Limited Fall Install Slots',
];

const STILLS = [
  'White Shaker Kitchen', 'Quartz Waterfall Island', 'Before/After Split Kitchen',
  'Navy Cabinet Detail', 'Open Concept Wide', 'Farmhouse Sink Closeup',
  'Subway Tile Backsplash', 'Pendant Lighting Detail', 'Walk-In Shower Glass',
  'Freestanding Tub', 'Before/After Split Bath', 'Double Vanity Marble',
  'Tiled Niche Detail', 'Curbless Shower Entry', 'Matte Black Fixtures',
  'Happy Client Portrait', 'Crew Team Photo', 'Design Sketch Overlay',
  'Financing Offer Card', '5-Star Review Card',
];

const pad = n => String(n).padStart(2, '0');

// ── Deterministic RNG ───────────────────────────────────────────────────────
function hash32(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const idFrom = (prefix, str) => `${prefix}${hash32(str).toString().padStart(10, '0')}`;

// ── Build the ad bank for one client ────────────────────────────────────────
// 2 campaigns (kitchen, bath) x 12 ad sets each x 5 ads = 120 ads per client.
function buildBank(clientName) {
  const ads = [];

  for (const vertical of ['Kitchen', 'Bath']) {
    const scripts = vertical === 'Kitchen' ? KITCHEN_SCRIPTS : BATH_SCRIPTS;
    const code    = vertical === 'Kitchen' ? 'KS' : 'BS';
    const campaign_name = `${clientName} | ${vertical} Remodel | Lead Gen`;
    const campaign_id   = idFrom('120', `${clientName}|${vertical}`);

    scripts.forEach((script, si) => {
      const scriptCode  = `${code}${pad(si + 1)}`;
      const adset_name  = `${scriptCode} · ${script}`;
      const adset_id    = idFrom('238', `${clientName}|${vertical}|${scriptCode}`);
      const rng         = mulberry32(hash32(`${clientName}|${scriptCode}`));

      // 3 video cuts (script x b-roll) + 2 statics (script x still)
      const pickN = (arr, n) => {
        const idx = arr.map((_, i) => i).sort((a, b) =>
          hash32(`${clientName}|${scriptCode}|${a}`) - hash32(`${clientName}|${scriptCode}|${b}`));
        return idx.slice(0, n);
      };

      const make = (ad_name, suffix, formatBias) => {
        const ad_id = idFrom('238', `${clientName}|${vertical}|${scriptCode}|${suffix}`);
        // Stable per-ad performance profile — a few winners, a long tail.
        const q = mulberry32(hash32(ad_id));
        ads.push({
          vertical, campaign_id, campaign_name, adset_id, adset_name, ad_id, ad_name,
          ad_platform: 'meta',
          leadWeight:  (0.35 + q() * 1.3) * formatBias,
          apptQuality: 0.6 + q() * 0.9,
          showQuality: 0.6 + q() * 0.9,
          closeQuality:0.6 + q() * 0.9,
        });
      };

      pickN(BROLL, 3).forEach(bi =>
        make(`${scriptCode}×BR${pad(bi + 1)} · ${BROLL[bi]}`, `BR${bi}`, 1.15));
      pickN(STILLS, 2).forEach(ii =>
        make(`${scriptCode}×IMG${pad(ii + 1)} · ${STILLS[ii]}`, `IMG${ii}`, 0.85));

      void rng;
    });
  }

  return ads;
}

// ── Integer allocation: split `total` across items by weight, respecting caps ─
// Always sums to min(total, sum(caps)), so a zip's per-ad counts tie back to
// its stored figure and no stage of the funnel can exceed the one above it.
function allocate(total, weights, caps) {
  const n = weights.length;
  const out = new Array(n).fill(0);
  const capSum = caps.reduce((a, b) => a + b, 0);
  let remaining = Math.min(total, capSum);
  if (remaining <= 0) return out;

  const wsum = weights.reduce((a, b) => a + b, 0) || 1;
  const desired = weights.map(w => (w / wsum) * remaining);

  for (let i = 0; i < n; i++) out[i] = Math.min(caps[i], Math.floor(desired[i]));
  let left = remaining - out.reduce((a, b) => a + b, 0);

  const order = desired
    .map((d, i) => ({ i, frac: d - Math.floor(d) }))
    .sort((a, b) => b.frac - a.frac);

  while (left > 0) {
    let moved = false;
    for (const { i } of order) {
      if (left <= 0) break;
      if (out[i] < caps[i]) { out[i]++; left--; moved = true; }
    }
    if (!moved) break;
  }
  return out;
}

// ── Split one zip's numbers across a subset of the bank ─────────────────────
function attributeZip(clientName, bank, row, jobs) {
  const leads  = Number(row.leads)        || 0;
  const appts  = Number(row.appointments) || 0;
  const shows  = Number(row.shows)        || 0;
  const closes = Number(row.closes)       || 0;
  if (leads <= 0) return [];

  const rng = mulberry32(hash32(`${clientName}|${row.zip_code}`));

  // A zip runs a handful of the bank's ads, not all 120.
  const want = Math.min(Math.max(2, leads), 4 + Math.floor(rng() * 5));
  const chosen = bank
    .map(ad => ({ ad, r: rng() / (0.25 + ad.leadWeight) }))
    .sort((a, b) => a.r - b.r)
    .slice(0, want)
    .map(x => x.ad);

  const INF = Number.MAX_SAFE_INTEGER;
  const jitter = () => 0.6 + rng() * 0.8;

  const lead = allocate(leads, chosen.map(a => a.leadWeight * jitter()), chosen.map(() => INF));
  const appt = allocate(appts,  chosen.map((a, i) => lead[i] * a.apptQuality  * jitter()), lead);
  const show = allocate(shows,  chosen.map((a, i) => appt[i] * a.showQuality  * jitter()), appt);
  const clos = allocate(closes, chosen.map((a, i) => show[i] * a.closeQuality * jitter()), show);

  // Hand the zip's actual jobs out to whichever ad closed them, so each ad's
  // revenue is the sum of real contract values and the zip total ties exactly.
  const rev = [];
  let j = 0;
  for (let i = 0; i < chosen.length; i++) {
    let sum = 0;
    for (let k = 0; k < clos[i]; k++) sum += jobs[j++] ?? 0;
    rev.push(Math.round(sum * 100) / 100);
  }

  const rows = [];
  const push = (metric, counts, revs) => {
    chosen.forEach((ad, i) => {
      if (!counts[i]) return;
      rows.push({
        client_id: row.client_id,
        zip_code:  row.zip_code,
        metric,
        ad_platform:   ad.ad_platform,
        campaign_id:   ad.campaign_id,
        campaign_name: ad.campaign_name,
        adset_id:      ad.adset_id,
        adset_name:    ad.adset_name,
        ad_id:         ad.ad_id,
        ad_name:       ad.ad_name,
        count:   counts[i],
        revenue: revs ? revs[i] : 0,
      });
    });
  };

  push('leads', lead, null);
  push('appointments', appt, null);
  push('shows', show, null);
  push('closes', clos, rev);
  return rows;
}

// ── Supabase REST helpers ───────────────────────────────────────────────────
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

async function rest(path, init = {}) {
  const res = await fetch(`${URL_BASE}/rest/v1/${path}`, { ...init, headers: { ...H, ...(init.headers || {}) } });
  if (!res.ok) throw new Error(`${res.status} ${path}: ${await res.text()}`);
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

async function fetchAll(path) {
  const out = [];
  for (let page = 0; ; page++) {
    const chunk = await rest(`${path}&limit=1000&offset=${page * 1000}`);
    out.push(...chunk);
    if (chunk.length < 1000) break;
  }
  return out;
}

// ── Run ─────────────────────────────────────────────────────────────────────
console.log(`Target: ${REF}${REF === V1_REF ? '  ** V1 PRODUCTION **' : '  (V2 demo)'}`);
console.log(DRY ? 'Mode:   dry run — nothing will be written\n' : 'Mode:   write\n');

// A zip's jobs, priced from a seed that depends only on the client and zip, so
// re-running the script reproduces the same book of business.
const jobsFor = (name, zip, count, avgTicket) => {
  const rng = mulberry32(hash32(`${name}|${zip}|jobs`));
  return Array.from({ length: count }, () => jobValue(rng, avgTicket));
};

let grandRows = 0;

for (const [name, { avgTicket, targetRevenue }] of Object.entries(CLIENTS)) {
  const [client] = await rest(`clients?name=eq.${encodeURIComponent(name)}&select=id,name`);
  if (!client) { console.error(`✗ client not found: ${name}`); process.exit(1); }

  const perf = await fetchAll(
    `zip_performance?client_id=eq.${client.id}&select=client_id,zip_code,leads,appointments,shows,closes,revenue&order=zip_code`
  );

  // Pass 1 — - what the current close counts would be worth at full price.
  const atFullPrice = perf.reduce(
    (n, r) => n + jobsFor(name, r.zip_code, Number(r.closes) || 0, avgTicket).reduce((a, b) => a + b, 0),
    0
  );

  // Pass 2 — scale the closes down to meet the revenue target, spreading the
  // cut across zips in proportion to what each already carries. A first guess
  // off the full-price average lands within ~10%; carrying fewer jobs changes
  // which ones get drawn, so re-solve against the realised figure until the
  // total settles inside 1% of target.
  const closesNow = perf.map(r => Number(r.closes) || 0);
  const totalNow  = closesNow.reduce((a, b) => a + b, 0);

  const revenueOf = counts => perf.reduce(
    (n, r, i) => n + jobsFor(name, r.zip_code, counts[i], avgTicket).reduce((a, b) => a + b, 0),
    0
  );

  let wanted    = Math.max(1, Math.round(totalNow * (targetRevenue / atFullPrice)));
  let closesNew = allocate(wanted, closesNow, closesNow);
  let realised  = revenueOf(closesNew);

  for (let k = 0; k < 8; k++) {
    if (Math.abs(realised - targetRevenue) / targetRevenue < 0.01) break;
    const next = Math.max(1, Math.round(wanted * (targetRevenue / realised)));
    if (next === wanted) break;
    wanted    = next;
    closesNew = allocate(wanted, closesNow, closesNow);
    realised  = revenueOf(closesNew);
  }

  const bank = buildBank(name);
  const rows = [];
  const perfUpdates = [];
  const allJobs = [];

  perf.forEach((r, i) => {
    const closes = closesNew[i];
    const jobs   = jobsFor(name, r.zip_code, closes, avgTicket);
    allJobs.push(...jobs);

    const revenue = Math.round(jobs.reduce((a, b) => a + b, 0) * 100) / 100;
    const row = {
      client_id:    r.client_id,
      zip_code:     r.zip_code,
      leads:        Number(r.leads) || 0,
      appointments: Number(r.appointments) || 0,
      shows:        Number(r.shows) || 0,
      closes,
      revenue,
      updated_at:   new Date().toISOString(),
    };
    perfUpdates.push(row);
    rows.push(...attributeZip(name, bank, row, jobs));
  });

  // Verify the split ties back to the numbers being written.
  const sum = (metric, key = 'count') =>
    rows.filter(r => r.metric === metric).reduce((n, r) => n + r[key], 0);
  const want = k => perfUpdates.reduce((n, r) => n + r[k], 0);
  const newRev  = Math.round(want('revenue') * 100) / 100;
  const attrRev = Math.round(sum('closes', 'revenue') * 100) / 100;

  const checks = [
    ['leads',        sum('leads'),        want('leads')],
    ['appointments', sum('appointments'), want('appointments')],
    ['shows',        sum('shows'),        want('shows')],
    ['closes',       sum('closes'),       want('closes')],
    ['revenue',      attrRev,             newRev],
  ];

  const sorted = [...allJobs].sort((a, b) => a - b);
  const pct = q => sorted[Math.floor(sorted.length * q)] ?? 0;
  const money = n => '$' + n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  console.log(`${name}  (avg ticket ${money(avgTicket)} · target ${money(targetRevenue)})`);
  console.log(`  zips ${perf.length} · bank ${bank.length} ads / ${new Set(bank.map(a => a.adset_id)).size} ad sets · rows ${rows.length}`);
  console.log(`  closes ${totalNow} → ${wanted}   revenue ${money(atFullPrice)} → ${money(newRev)}`);
  console.log(`  jobs ${allJobs.length} · p10 ${money(pct(0.10))} · median ${money(pct(0.50))} · p90 ${money(pct(0.90))} · max ${money(sorted[sorted.length - 1] ?? 0)}`);
  for (const [label, got, w] of checks) {
    const ok = Math.abs(got - w) < 0.011;
    console.log(`  ${ok ? '✓' : '✗'} ${label.padEnd(13)} ${got.toLocaleString()} / ${w.toLocaleString()}`);
    if (!ok) process.exitCode = 1;
  }

  if (!DRY) {
    for (let i = 0; i < perfUpdates.length; i += 500) {
      await rest('zip_performance?on_conflict=client_id,zip_code', {
        method: 'POST',
        headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(perfUpdates.slice(i, i + 500)),
      });
    }
    console.log(`  re-priced ${perfUpdates.length} zips`);

    await rest(`zip_creative_attribution?client_id=eq.${client.id}`, { method: 'DELETE' });
    for (let i = 0; i < rows.length; i += 500) {
      await rest('zip_creative_attribution', {
        method: 'POST',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify(rows.slice(i, i + 500)),
      });
      process.stdout.write(`\r  inserted ${Math.min(i + 500, rows.length)}/${rows.length}`);
    }
    console.log(`\r  inserted ${rows.length}/${rows.length}        `);
  }
  console.log('');
  grandRows += rows.length;
}

console.log(DRY ? `Dry run complete — ${grandRows.toLocaleString()} rows would be written.`
                : `Done — ${grandRows.toLocaleString()} rows written.`);
