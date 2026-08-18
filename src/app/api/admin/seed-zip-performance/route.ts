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
    // Use exponential weights (high variance) assigned only to ~30% of zips.
    // This mirrors reality: a handful of zip codes generate most leads while
    // the majority of the territory is quiet.

    const activeCount = Math.max(1, Math.round(zips.length * 0.30));

    // Generate exponential weights for every zip, then pick the top activeCount
    const allWeights = zips.map(() => Math.exp(rng() * 3.5)); // range ~[1, 33]
    const zipsByWeight = zips
      .map((zip, i) => ({ zip, i, w: allWeights[i] }))
      .sort((a, b) => b.w - a.w);

    const totalActiveWeight = zipsByWeight.slice(0, activeCount).reduce((s, z) => s + z.w, 0);

    // Build fraction array: inactive zips stay at 0
    const fracs = new Array(zips.length).fill(0);
    zipsByWeight.slice(0, activeCount).forEach(z => {
      fracs[z.i] = z.w / totalActiveWeight;
    });

    const leadDist = distribute(totalLeads, fracs);
    const apptDist = distribute(totalAppts, fracs);
    const showDist = distribute(totalShows, fracs);

    // ── Closes / revenue ──────────────────────────────────────────────────────
    // Distribute closes weighted by shows: a close can only come from a show,
    // so closes follow the same hot-zip distribution and are capped per zip at
    // its own show count. This guarantees closes ≤ shows ≤ appointments ≤ leads.

    const avgJobValue = totalCloses > 0 ? totalRevenue / totalCloses : 25000;

    const totalShowCount = showDist.reduce((a: number, b: number) => a + b, 0);
    const showFracs = totalShowCount > 0
      ? showDist.map(s => s / totalShowCount)
      : fracs;

    const rawCloseDist = distribute(Math.min(totalCloses, totalShowCount), showFracs);
    const closeDist = rawCloseDist.map((c, i) => Math.min(c, showDist[i]));

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
        rev += Math.round(avgJobValue * multiplier);
      }
      revenuePerZip.set(zip, rev);
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
