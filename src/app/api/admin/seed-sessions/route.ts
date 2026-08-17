import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { validateWebhookSecret } from '@/lib/api-auth';
import { MOCK_CLIENT_CONFIGS } from '@/lib/mock-generator';

const TIGER_BASE = 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Current/MapServer/2';
const PIN_COLORS = ['#3b82f6','#10b981','#f59e0b','#ec4899','#8b5cf6','#06b6d4','#f97316','#84cc16'];

// One distinct US metro per mock client (same order as MOCK_CLIENT_CONFIGS)
const CLIENT_LOCATIONS = [
  { lat: 33.49,  lng: -111.93, radius: 35 }, // Premier Bath & Kitchen      → Phoenix/Scottsdale AZ
  { lat: 33.75,  lng: -84.39,  radius: 35 }, // BrightSpace Interiors        → Atlanta GA
  { lat: 32.78,  lng: -96.80,  radius: 35 }, // Heritage Kitchens            → Dallas TX
  { lat: 35.23,  lng: -80.84,  radius: 35 }, // Skyline Bath Co              → Charlotte NC
  { lat: 27.95,  lng: -82.46,  radius: 35 }, // Coastal Living Renovations   → Tampa FL
  { lat: 39.74,  lng: -104.99, radius: 35 }, // Peak Home Services           → Denver CO
  { lat: 36.17,  lng: -86.78,  radius: 35 }, // Sunrise Home Renovations     → Nashville TN
  { lat: 36.17,  lng: -115.14, radius: 35 }, // ProCraft Remodeling          → Las Vegas NV
  { lat: 29.76,  lng: -95.37,  radius: 35 }, // Elite Kitchen & Bath         → Houston TX
  { lat: 39.95,  lng: -75.17,  radius: 35 }, // Harmony Homes                → Philadelphia PA
  { lat: 47.61,  lng: -122.33, radius: 35 }, // Apex Renovation Group        → Seattle WA
  { lat: 44.98,  lng: -93.27,  radius: 35 }, // Prestige Home Upgrades       → Minneapolis MN
  { lat: 42.36,  lng: -71.06,  radius: 35 }, // LuxBath Solutions            → Boston MA
  { lat: 38.90,  lng: -77.04,  radius: 35 }, // Renewal Contracting          → Washington DC
  { lat: 35.47,  lng: -97.52,  radius: 35 }, // Sterling Remodeling          → Oklahoma City OK
  { lat: 41.49,  lng: -81.69,  radius: 35 }, // Cascade Home Renovations     → Cleveland OH
];

async function getZips(lat: number, lng: number, radius: number): Promise<string[]> {
  try {
    const params = new URLSearchParams({
      geometry: JSON.stringify({ x: lng, y: lat, spatialReference: { wkid: 4326 } }),
      geometryType: 'esriGeometryPoint', inSR: '4326',
      distance: String(radius), units: 'esriSRUnit_StatuteMile',
      outFields: 'ZCTA5', returnGeometry: 'false', f: 'json',
    });
    const r = await fetch(`${TIGER_BASE}/query?${params}`);
    const d = await r.json();
    return (d.features ?? []).map((f: any) => f.attributes.ZCTA5 as string);
  } catch { return []; }
}

export async function POST(req: Request) {
  if (!validateWebhookSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const service = createServiceClient();
  const mockNames = MOCK_CLIENT_CONFIGS.map(c => c.name);

  // 1. Fetch all mock clients
  const { data: clients, error: ce } = await service
    .from('clients').select('id, name').in('name', mockNames);
  if (ce || !clients?.length) return NextResponse.json({ error: ce?.message ?? 'No mock clients' }, { status: 400 });

  // 2. Fetch all their sessions
  const { data: allSessions } = await service
    .from('client_sessions')
    .select('id, client_id, name, pins, pin_counter')
    .in('client_id', clients.map(c => c.id));

  const sessions = allSessions ?? [];
  const pinsLog: string[] = [];

  // 3. For each client, ensure at least one session has a pin
  for (const client of clients) {
    const idx = mockNames.indexOf(client.name);
    const loc = CLIENT_LOCATIONS[idx] ?? CLIENT_LOCATIONS[0];
    const clientSessions = sessions.filter(s => s.client_id === client.id);
    const hasPins = clientSessions.some((s: any) => s.pins?.length > 0);

    if (hasPins) {
      pinsLog.push(`${client.name}: already has pins`);
      continue;
    }

    const pin = {
      id: 'pin-1', lat: loc.lat, lng: loc.lng,
      label: 'Pin 1', radius: loc.radius, type: 'include', color: PIN_COLORS[0],
    };

    if (clientSessions.length === 0) {
      await service.from('client_sessions').insert({
        client_id: client.id, name: 'Primary Territory',
        pins: [pin], pin_counter: 1,
      });
      pinsLog.push(`${client.name}: created session with pin`);
    } else {
      await service.from('client_sessions')
        .update({ pins: [pin], pin_counter: 1 })
        .eq('id', clientSessions[0].id);
      pinsLog.push(`${client.name}: added pin to existing session`);
    }
  }

  // 4. Reload sessions after patching
  const { data: updatedSessions } = await service
    .from('client_sessions').select('id, client_id, pins').in('client_id', clients.map(c => c.id));

  // 5. Resolve zip codes and seed zip_performance
  let totalZipRows = 0;
  for (const client of clients) {
    const idx = mockNames.indexOf(client.name);
    const clientSessions2 = (updatedSessions ?? []).filter((s: any) => s.client_id === client.id);
    const zipSet = new Set<string>();

    await Promise.all(
      clientSessions2.flatMap((s: any) =>
        (s.pins ?? [])
          .filter((p: any) => p.type !== 'exclude')
          .map(async (pin: any) => {
            const zips = await getZips(pin.lat, pin.lng, pin.radius ?? 35);
            zips.forEach(z => zipSet.add(z));
          })
      )
    );

    if (zipSet.size === 0) continue;

    const rows = Array.from(zipSet).map((zip, i) => {
      const r = () => {
        let s = (idx * 9973 + i * 1013 + zip.charCodeAt(0) * 7) | 0;
        s = (s * 1664525 + 1013904223) & 0xffffffff;
        return (s >>> 0) / 0xffffffff;
      };
      const leads        = Math.round(3 + r() * 18);
      const appointments = Math.round(leads * (0.35 + r() * 0.25));
      const shows        = Math.round(appointments * (0.75 + r() * 0.2));
      const closes       = Math.round(shows * (0.18 + r() * 0.14));
      const revenue      = closes * Math.round(18000 + r() * 10000);
      return { client_id: client.id, zip_code: zip, leads, appointments, shows, closes, revenue };
    });

    const { error } = await service
      .from('zip_performance').upsert(rows, { onConflict: 'client_id,zip_code' });
    if (!error) totalZipRows += rows.length;
  }

  return NextResponse.json({ success: true, pins_log: pinsLog, zip_rows_upserted: totalZipRows });
}
