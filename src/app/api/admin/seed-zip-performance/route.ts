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

    // Pull real performance totals from the events table
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

    // Seeded RNG — same index always produces the same distribution
    const rng = mulberry32(clientIdx * 9973 + 12345);

    // ── Leads / appointments / shows ──────────────────────────────────────────
    // Performance is scored primarily on L/A/S so spread these across the
    // whole territory (every zip gets prospecting activity).
    const weights = zips.map(() => 0.3 + rng() * 0.7);
    const totalWeight = weights.reduce((a, b) => a + b, 0);
    const fracs = weights.map(w => w / totalWeight);

    const leadDist = distribute(totalLeads, fracs);
    const apptDist = distribute(totalAppts, fracs);
    const showDist = distribute(totalShows, fracs);

    // ── Closes / revenue ──────────────────────────────────────────────────────
    // Only a subset of zips ever generates a closed job. A client with 6 closes
    // has ~5 job zips; one with 53 closes has ~45 job zips. Revenue per zip
    // = closes_in_zip × avg_job_value (derived from actual event revenue),
    // keeping each zip's value realistically in the $10k–$80k range.

    // Number of unique zips that get at least one job
    const jobZipCount = totalCloses === 0 ? 0 : Math.min(
      Math.max(1, Math.round(totalCloses * 0.88)),
      zips.length,
    );

    // Fisher-Yates shuffle to pick which zips are "job zips"
    const shuffled = [...zips];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    const jobZipArr = shuffled.slice(0, jobZipCount);

    // Assign 1 close to each job zip, then spread remaining closes (cap at 3/zip)
    const closesPerZip = new Map<string, number>();
    for (const zip of jobZipArr) closesPerZip.set(zip, 1);

    let extra = totalCloses - jobZipCount;
    let attempts = 0;
    while (extra > 0 && attempts < jobZipArr.length * 10) {
      const zip = jobZipArr[Math.floor(rng() * jobZipArr.length)];
      if ((closesPerZip.get(zip) ?? 0) < 3) {
        closesPerZip.set(zip, (closesPerZip.get(zip) ?? 0) + 1);
        extra--;
      }
      attempts++;
    }

    // Revenue per zip = closes × avg job value from real data
    const avgJobValue = totalCloses > 0 ? totalRevenue / totalCloses : 0;

    // Build final rows
    const rows = zips.map((zip, i) => {
      const zipCloses = closesPerZip.get(zip) ?? 0;
      return {
        client_id:    client.id,
        zip_code:     zip,
        leads:        leadDist[i],
        appointments: apptDist[i],
        shows:        showDist[i],
        closes:       zipCloses,
        revenue:      Math.round(zipCloses * avgJobValue),
      };
    });

    const { error } = await service
      .from('zip_performance')
      .upsert(rows, { onConflict: 'client_id,zip_code' });

    if (error) {
      log.push(`${client.name}: ERROR — ${error.message}`);
    } else {
      const jobZips = rows.filter(r => r.closes > 0).length;
      const avgRev  = jobZips > 0 ? Math.round(totalRevenue / jobZips) : 0;
      log.push(
        `${client.name}: ${zips.length} zips, ${jobZips} with jobs — ` +
        `avg $${avgRev.toLocaleString()}/job-zip, ` +
        `L:${totalLeads} A:${totalAppts} S:${totalShows} C:${totalCloses} R:$${totalRevenue.toLocaleString()}`
      );
      totalRows += rows.length;
    }
  }

  return NextResponse.json({ success: true, log, zip_rows_upserted: totalRows });
}
