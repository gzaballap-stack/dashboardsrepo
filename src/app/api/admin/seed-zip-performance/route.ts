import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { validateWebhookSecret } from '@/lib/api-auth';
import { MOCK_CLIENT_CONFIGS } from '@/lib/mock-generator';

const TIGER_BASE = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Current/MapServer/2';

function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Distribute an integer total across N buckets with no rounding loss
function distribute(total: number, fracs: number[]): number[] {
  const raw = fracs.map(f => f * total);
  const floored = raw.map(Math.floor);
  const remainder = total - floored.reduce((a, b) => a + b, 0);
  raw
    .map((v, i) => [v - floored[i], i] as [number, number])
    .sort((a, b) => b[0] - a[0])
    .slice(0, remainder)
    .forEach(([, i]) => floored[i]++);
  return floored;
}

// Distribute an integer total across weighted buckets without exceeding a per-bucket
// cap. Used to keep closes <= shows <= appointments <= leads per zip once each stage
// gets its own weighting: overflow from a capped zip spills to zips with headroom.
function distributeCapped(total: number, weights: number[], caps: number[]): number[] {
  const n = weights.length;
  const out = new Array(n).fill(0);
  let remaining = Math.min(total, caps.reduce((a, b) => a + b, 0));

  for (let pass = 0; pass < 12 && remaining > 0; pass++) {
    let wsum = 0;
    for (let i = 0; i < n; i++) if (out[i] < caps[i] && weights[i] > 0) wsum += weights[i];
    if (wsum <= 0) break;

    const fracs = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      if (out[i] < caps[i] && weights[i] > 0) fracs[i] = weights[i] / wsum;
    }

    const alloc = distribute(remaining, fracs);
    let assigned = 0;
    for (let i = 0; i < n; i++) {
      const give = Math.min(alloc[i], Math.max(0, caps[i] - out[i]));
      out[i] += give;
      assigned += give;
    }
    remaining -= assigned;
    if (assigned === 0) break;
  }

  // Anything still unplaced (all weighted zips capped out) goes wherever there's room.
  for (let i = 0; i < n && remaining > 0; i++) {
    const room = caps[i] - out[i];
    if (room > 0) { const give = Math.min(room, remaining); out[i] += give; remaining -= give; }
  }
  return out;
}

async function getZipsNearPin(lat: number, lng: number, radius: number): Promise<string[]> {
  try {
    const params = new URLSearchParams({
      geometry: JSON.stringify({ x: lng, y: lat, spatialReference: { wkid: 4326 } }),
      geometryType: 'esriGeometryPoint', inSR: '4326',
      distance: String(radius), units: 'esriSRUnit_StatuteMile',
      outFields: 'ZCTA5', returnGeometry: 'false', f: 'json',
    });
    const r = await fetch(`${TIGER_BASE}/query?${params}`);
    const data = await r.json();
    return (data.features ?? []).map((f: any) => f.attributes.ZCTA5 as string);
  } catch { return []; }
}

export async function POST(req: Request) {
  if (!validateWebhookSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const service = createServiceClient();
  const mockNames = MOCK_CLIENT_CONFIGS.map(c => c.name);

  const { data: clients } = await service
    .from('clients').select('id, name').in('name', mockNames);
  if (!clients?.length) {
    return NextResponse.json({ error: 'Mock clients not found' }, { status: 400 });
  }

  const clientIds = clients.map(c => c.id);

  const { data: sessions } = await service
    .from('client_sessions')
    .select('client_id, pins')
    .in('client_id', clientIds);

  let totalRows = 0;
  const log: string[] = [];

  for (const client of clients) {
    const clientIdx = mockNames.indexOf(client.name);

    const [
      { count: leads },
      { count: appointments },
      { count: shows },
      { count: closes },
      { data: closeEvents },
    ] = await Promise.all([
      service.from('events').select('id', { count: 'exact', head: true })
        .eq('client_id', client.id).eq('event_type', 'lead'),
      service.from('events').select('id', { count: 'exact', head: true })
        .eq('client_id', client.id).eq('event_type', 'appointment_booked'),
      service.from('events').select('id', { count: 'exact', head: true })
        .eq('client_id', client.id).eq('event_type', 'show'),
      service.from('events').select('id', { count: 'exact', head: true })
        .eq('client_id', client.id).eq('event_type', 'closed'),
      service.from('events').select('revenue')
        .eq('client_id', client.id).eq('event_type', 'closed'),
    ]);

    const totalLeads   = leads        ?? 0;
    const totalAppts   = appointments ?? 0;
    const totalShows   = shows        ?? 0;
    const totalCloses  = closes       ?? 0;
    const totalRevenue = Math.round((closeEvents ?? []).reduce((s, e) => s + Number(e.revenue), 0));

    if (totalLeads === 0) {
      log.push(`${client.name}: no events — run backfill-history first`);
      continue;
    }

    // Resolve zip codes from territory pins
    const clientSessions = (sessions ?? []).filter((s: any) => s.client_id === client.id);
    const zipSet = new Set<string>();
    await Promise.all(
      clientSessions.flatMap((s: any) =>
        (s.pins ?? [])
          .filter((p: any) => p.type !== 'exclude')
          .map(async (pin: any) => {
            const zips = await getZipsNearPin(pin.lat, pin.lng, pin.radius ?? 35);
            zips.forEach(z => zipSet.add(z));
          })
      )
    );

    if (zipSet.size === 0) {
      log.push(`${client.name}: no zips resolved — run seed-sessions first`);
      continue;
    }

    const zips = Array.from(zipSet);
    const rng  = mulberry32(clientIdx * 9973 + 12345);

    // ── Leads / appointments / shows ──────────────────────────────────────────
    // Every stage gets its own weighting rather than reusing the lead split.
    // Sharing one fraction array made each zip convert at exactly the portfolio
    // average, so the whole territory came out looking hand-made; jittering each
    // stage independently gives zips their own booking, show and close rates.

    // Roughly a quarter to a half of the territory carries the volume, and where
    // that line falls varies by client.
    const activeShare = 0.22 + rng() * 0.24;
    const activeCount = Math.max(1, Math.round(zips.length * activeShare));

    // Exponential weights — a few zips dominate, which is how real territories look.
    const allWeights = zips.map(() => Math.exp(rng() * 3.5)); // range ~[1, 33]
    const zipsByWeight = zips
      .map((zip, i) => ({ zip, i, w: allWeights[i] }))
      .sort((a, b) => b.w - a.w);

    const activeIdx = new Set(zipsByWeight.slice(0, activeCount).map(z => z.i));

    // Quiet zips keep a small random weight instead of a hard zero, so the tail is
    // a scatter of one- and two-lead zips rather than a wall of blanks.
    const leadWeights = zips.map((_, i) =>
      activeIdx.has(i) ? allWeights[i] * (0.55 + rng() * 0.9) : allWeights[i] * 0.05 * rng()
    );
    const leadWeightSum = leadWeights.reduce((a, b) => a + b, 0) || 1;
    const leadDist = distribute(totalLeads, leadWeights.map(w => w / leadWeightSum));

    // Booking rate varies by zip — some neighbourhoods answer the phone, some don't.
    const apptWeights = leadDist.map(l => l * (0.45 + rng() * 1.35));
    const apptDist = distributeCapped(totalAppts, apptWeights, leadDist);

    // Show rate varies independently of booking rate.
    const showWeights = apptDist.map(a => a * (0.5 + rng() * 1.3));
    const showDist = distributeCapped(totalShows, showWeights, apptDist);

    // ── Closes / revenue ──────────────────────────────────────────────────────
    // Distribute closes weighted by shows: a close can only come from a show,
    // so closes follow the same hot-zip distribution and are capped per zip at
    // its own show count. This guarantees closes ≤ shows ≤ appointments ≤ leads.

    const avgJobValue = totalCloses > 0 ? totalRevenue / totalCloses : 25000;

    const closeWeights = showDist.map(sh => sh * (0.35 + rng() * 1.6));
    const closeDist = distributeCapped(totalCloses, closeWeights, showDist);

    const closesPerZip = new Map<string, number>();
    zips.forEach((zip, i) => { if (closeDist[i] > 0) closesPerZip.set(zip, closeDist[i]); });

    // Revenue: generate each close independently with a realistic spread
    // anchored to ±the client's own avg ticket so premium clients stay premium.
    const revenuePerZip = new Map<string, number>();
    for (const [zip, numCloses] of closesPerZip) {
      let rev = 0;
      for (let c = 0; c < numCloses; c++) {
        const t = rng();
        let multiplier: number;
        if      (t < 0.12) multiplier = 0.40 + rng() * 0.35; // ~0.4–0.75× (small partial bath)
        else if (t < 0.45) multiplier = 0.75 + rng() * 0.50; // ~0.75–1.25× (standard)
        else if (t < 0.75) multiplier = 1.25 + rng() * 0.75; // ~1.25–2.0×  (large)
        else               multiplier = 2.00 + rng() * 2.00; // ~2.0–4.0×   (premium)
        rev += avgJobValue * multiplier;
      }
      // To the cent — round thousands across every zip was part of what made the
      // numbers look generated. The column is numeric(12,2).
      revenuePerZip.set(zip, Math.round(rev * 100) / 100);
    }

    const rows = zips.map((zip, i) => ({
      client_id:    client.id,
      zip_code:     zip,
      leads:        leadDist[i],
      appointments: apptDist[i],
      shows:        showDist[i],
      closes:       closeDist[i],
      revenue:      revenuePerZip.get(zip) ?? 0,
    }));

    const { error } = await service
      .from('zip_performance')
      .upsert(rows, { onConflict: 'client_id,zip_code' });

    if (error) {
      log.push(`${client.name}: ERROR — ${error.message}`);
    } else {
      const jobZips   = rows.filter(r => r.closes > 0);
      const maxLeads  = Math.max(...rows.map(r => r.leads));
      const revValues = jobZips.map(r => r.revenue);
      const minRev    = revValues.length ? Math.min(...revValues) : 0;
      const maxRev    = revValues.length ? Math.max(...revValues) : 0;
      log.push(
        `${client.name}: ${zips.length} zips, ${activeCount} lead-active, ${jobZips.length} with jobs — ` +
        `leads 0–${maxLeads}/zip, rev $${Math.round(minRev/1000)}k–$${Math.round(maxRev/1000)}k/job-zip`
      );
      totalRows += rows.length;
    }
  }

  return NextResponse.json({ success: true, log, zip_rows_upserted: totalRows });
}
