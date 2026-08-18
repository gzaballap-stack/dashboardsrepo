import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { validateWebhookSecret } from '@/lib/api-auth';
import { geocodeZip, getZctasNearPoint, fetchZipScores } from '@/lib/census';

const PIN_COLOR = '#3b82f6';

// Fired from GHL (via ccm-onboarding.blueprint.json) when a new client is booked in.
// Optionally takes the zip code + service radius given on the initial call: if present,
// creates their first ZIP-tool territory session and reports back the weakest zip in that
// radius (by Census/demographic score, not lead history -- a brand-new client has none yet)
// so the calling scenario can write it to a GHL custom field and prompt the client to confirm
// whether to keep or drop it from their target area.
export async function POST(req: Request) {
  if (!validateWebhookSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json();
  const agency_name = body.agency_name?.trim();
  const zip_code = body.zip_code?.trim();
  const radius_miles = body.radius_miles;

  if (!agency_name) {
    return NextResponse.json({ error: 'agency_name is required' }, { status: 400 });
  }

  const service = createServiceClient();

  let { data: client } = await service
    .from('clients')
    .select('id')
    .eq('name', agency_name)
    .maybeSingle();

  if (!client) {
    const { data: created, error } = await service
      .from('clients')
      .insert({ name: agency_name, is_live: true })
      .select('id')
      .single();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    client = created;
  }

  if (!zip_code && !radius_miles) {
    return NextResponse.json({ success: true, client_id: client.id });
  }

  if (!/^\d{5}$/.test(zip_code ?? '')) {
    return NextResponse.json({ error: 'zip_code must be a 5-digit US zip' }, { status: 400 });
  }
  const radius = Math.min(Math.max(Number(radius_miles) || 35, 5), 75);

  const geo = await geocodeZip(zip_code);
  if (!geo) return NextResponse.json({ error: `Zip code "${zip_code}" not found` }, { status: 404 });

  const zips = await getZctasNearPoint(geo.lat, geo.lng, radius);
  if (!zips.length) {
    return NextResponse.json({ error: 'No zip codes found in that radius' }, { status: 404 });
  }

  const pin = {
    id: 'pin-1',
    lat: geo.lat,
    lng: geo.lng,
    label: `${zip_code} Territory`,
    radius,
    type: 'include' as const,
    color: PIN_COLOR,
  };

  const [{ data: session, error: sessionError }, scores] = await Promise.all([
    service
      .from('client_sessions')
      .insert({ client_id: client.id, name: 'Initial Territory (GHL)', pins: [pin], pin_counter: 1 })
      .select('id')
      .single(),
    fetchZipScores(zips),
  ]);

  if (sessionError) return NextResponse.json({ error: sessionError.message }, { status: 500 });

  const scored = Object.entries(scores).sort((a, b) => a[1].score - b[1].score);
  const worst = scored[0];

  return NextResponse.json({
    success: true,
    client_id: client.id,
    session_id: session.id,
    zips_in_radius: zips.length,
    worst_zip: worst?.[0] ?? null,
    worst_zip_score: worst?.[1].score ?? null,
    worst_zip_grade: worst?.[1].grade ?? null,
  });
}
