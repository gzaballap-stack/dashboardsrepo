import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { validateWebhookSecret } from '@/lib/api-auth';
import { normalizeZip } from '@/lib/zip-rollup';

/**
 * Give every client a territory session in the Zip Tool.
 *
 * A client's territory is drawn from where their leads actually came from: the
 * zips on their own events, reduced to a centre point and a radius wide enough
 * to cover them. A client with no zip data yet still gets a session, just an
 * empty one, so they show up in the tool ready for pins to be dropped by hand.
 *
 * POST { dry_run?: boolean, coverage?: number, radius_cap?: number }
 *
 * dry_run defaults to TRUE. Clients that already have a session are left alone.
 */

const TIGER_BASE = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Current/MapServer/2';
const PIN_COLOR   = '#000000';
const GEO_CHUNK   = 60;
const MIN_RADIUS  = 10;
const MAX_RADIUS  = 75;

type LatLng = { lat: number; lng: number };

// Centroids for many zips in one TIGER call rather than one call per zip.
async function geocodeZips(zips: string[]): Promise<Map<string, LatLng>> {
  const out = new Map<string, LatLng>();

  for (let i = 0; i < zips.length; i += GEO_CHUNK) {
    const chunk = zips.slice(i, i + GEO_CHUNK);
    const params = new URLSearchParams({
      where: `ZCTA5 IN (${chunk.map(z => `'${z}'`).join(',')})`,
      outSR: '4326',
      outFields: 'ZCTA5',
      returnCentroid: 'true',
      returnGeometry: 'false',
      resultRecordCount: String(GEO_CHUNK),
      f: 'json',
    });

    try {
      const r = await fetch(`${TIGER_BASE}/query?${params}`);
      if (!r.ok) continue;
      const data = await r.json();
      for (const feat of data.features ?? []) {
        const zip = feat?.attributes?.ZCTA5;
        const c   = feat?.centroid;
        if (zip && c) out.set(String(zip), { lat: c.y, lng: c.x });
      }
    } catch {
      // A chunk that fails just leaves those zips ungeocoded; the rest still place.
    }
  }

  return out;
}

function milesBetween(a: LatLng, b: LatLng): number {
  const R = 3958.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export async function POST(req: Request) {
  if (!validateWebhookSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({}));
  const dryRun    = body.dry_run !== false;
  // How much of a client's lead volume the circle has to reach. Leaving a tail
  // out keeps one far-flung lead from stretching a territory across a state.
  const coverage  = Math.min(Math.max(Number(body.coverage) || 0.9, 0.5), 1);
  const radiusCap = Math.min(Number(body.radius_cap) || MAX_RADIUS, MAX_RADIUS);

  const service = createServiceClient();

  const { data: clients, error: ce } = await service
    .from('clients')
    .select('id, name')
    .order('name');
  if (ce) return NextResponse.json({ error: ce.message }, { status: 500 });
  if (!clients?.length) return NextResponse.json({ message: 'No clients' });

  // Clients that already have a session keep it — this never overwrites.
  const { data: existing } = await service
    .from('client_sessions')
    .select('client_id')
    .not('client_id', 'is', null);
  const hasSession = new Set((existing ?? []).map(s => s.client_id as string));

  // Every zip each client's own funnel has touched, weighted by event count.
  const zipsByClient = new Map<string, Map<string, number>>();
  for (let page = 0; page < 50; page++) {
    const { data, error } = await service
      .from('events')
      .select('client_id, zip_code')
      .not('zip_code', 'is', null)
      .range(page * 1000, page * 1000 + 999);
    if (error || !data?.length) break;

    for (const row of data as { client_id: string; zip_code: string }[]) {
      const zip = normalizeZip(row.zip_code);
      if (!zip) continue;
      const counts = zipsByClient.get(row.client_id) ?? new Map<string, number>();
      counts.set(zip, (counts.get(zip) ?? 0) + 1);
      zipsByClient.set(row.client_id, counts);
    }

    if (data.length < 1000) break;
  }

  const allZips = [...new Set([...zipsByClient.values()].flatMap(m => [...m.keys()]))];
  const geo = await geocodeZips(allZips);

  const planned: Array<Record<string, unknown>> = [];
  const skipped: Array<{ client: string; reason: string }> = [];

  for (const client of clients) {
    if (hasSession.has(client.id)) {
      skipped.push({ client: client.name, reason: 'already has a session' });
      continue;
    }

    const counts = zipsByClient.get(client.id);
    const points = [...(counts ?? new Map<string, number>()).entries()]
      .flatMap(([zip, n]) => {
        const p = geo.get(zip);
        return p ? [{ zip, n, ...p }] : [];
      });

    // No zip data — still give them a session, just without pins.
    if (!points.length) {
      planned.push({ client: client.name, client_id: client.id, pins: 0, zips: 0 });
      continue;
    }

    const total = points.reduce((s, p) => s + p.n, 0);
    const centre: LatLng = {
      lat: points.reduce((s, p) => s + p.lat * p.n, 0) / total,
      lng: points.reduce((s, p) => s + p.lng * p.n, 0) / total,
    };

    // Smallest radius that still reaches the requested share of their leads.
    const byDistance = points
      .map(p => ({ n: p.n, d: milesBetween(centre, p) }))
      .sort((a, b) => a.d - b.d);

    let reached = 0;
    let radius = MIN_RADIUS;
    for (const p of byDistance) {
      reached += p.n;
      radius = p.d;
      if (reached / total >= coverage) break;
    }

    radius = Math.min(Math.max(Math.ceil((radius + 2) / 5) * 5, MIN_RADIUS), radiusCap);

    planned.push({
      client: client.name,
      client_id: client.id,
      pins: 1,
      zips: points.length,
      events: total,
      centre: { lat: Number(centre.lat.toFixed(4)), lng: Number(centre.lng.toFixed(4)) },
      radius,
    });
  }

  let created = 0;
  const writeErrors: string[] = [];

  if (!dryRun) {
    for (const row of planned) {
      const pins = row.pins === 1
        ? [{
            id: 'pin-1',
            lat: (row.centre as LatLng).lat,
            lng: (row.centre as LatLng).lng,
            label: `${row.client} Territory`,
            radius: row.radius as number,
            type: 'include',
            color: PIN_COLOR,
          }]
        : [];

      const { error } = await service.from('client_sessions').insert({
        client_id:   row.client_id as string,
        name:        `${row.client} — Territory`,
        pins,
        pin_counter: pins.length,
      });

      if (error) writeErrors.push(`${row.client}: ${error.message}`);
      else created++;
    }
  }

  return NextResponse.json({
    dry_run: dryRun,
    clients_total:      clients.length,
    sessions_planned:   planned.length,
    sessions_created:   dryRun ? 0 : created,
    with_territory:     planned.filter(p => p.pins === 1).length,
    without_zip_data:   planned.filter(p => p.pins === 0).length,
    skipped:            skipped.length,
    skipped_sample:     skipped.slice(0, 10),
    planned,
    write_errors:       writeErrors.slice(0, 5),
  });
}
