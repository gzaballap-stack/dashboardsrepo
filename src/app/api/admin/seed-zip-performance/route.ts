import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { validateWebhookSecret } from '@/lib/api-auth';
import { MOCK_CLIENT_CONFIGS } from '@/lib/mock-generator';

const TIGER_BASE = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Current/MapServer/2';

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
  if (!clients?.length) return NextResponse.json({ error: 'Mock clients not found' }, { status: 400 });

  const clientIds = clients.map(c => c.id);
  const { data: sessions } = await service
    .from('client_sessions').select('client_id, pins').in('client_id', clientIds);

  let totalRows = 0;

  for (const client of clients) {
    const clientIdx = mockNames.indexOf(client.name);

    // Collect all include pins for this client across all their sessions
    const allPins: { lat: number; lng: number; radius: number }[] = [];
    for (const s of (sessions ?? []).filter((s: any) => s.client_id === client.id)) {
      for (const pin of (s.pins ?? [])) {
        if (pin.type !== 'exclude') allPins.push({ lat: pin.lat, lng: pin.lng, radius: pin.radius ?? 35 });
      }
    }
    if (allPins.length === 0) continue;

    // Resolve zip codes for each pin
    const zipSet = new Set<string>();
    await Promise.all(allPins.map(async (pin) => {
      const zips = await getZipsNearPin(pin.lat, pin.lng, pin.radius);
      zips.forEach(z => zipSet.add(z));
    }));

    if (zipSet.size === 0) continue;

    const rows = Array.from(zipSet).map((zip, i) => {
      const r = () => { let s = (clientIdx * 9973 + i * 1013 + zip.charCodeAt(0) * 7) | 0; s = (s * 1664525 + 1013904223) & 0xffffffff; return (s >>> 0) / 0xffffffff; };
      const leads       = Math.round(3 + r() * 18);
      const appointments = Math.round(leads * (0.35 + r() * 0.25));
      const shows       = Math.round(appointments * (0.75 + r() * 0.2));
      const closes      = Math.round(shows * (0.18 + r() * 0.14));
      const revenue     = closes * Math.round(18000 + r() * 10000);
      return { client_id: client.id, zip_code: zip, leads, appointments, shows, closes, revenue };
    });

    const { error } = await service
      .from('zip_performance')
      .upsert(rows, { onConflict: 'client_id,zip_code' });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    totalRows += rows.length;
  }

  return NextResponse.json({ success: true, rows_upserted: totalRows });
}
