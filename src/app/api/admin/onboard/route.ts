import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { validateWebhookSecret } from '@/lib/api-auth';
import { geocodeZip, getZctasNearPoint, fetchZipScores } from '@/lib/census';

const PIN_COLOR = '#3b82f6';

// Fired from GHL (via Make) when a sales call is booked.
// Creates an unattributed Zip Tool session for the prospect's territory and
// returns the weakest zip in that radius so the calling scenario can write it
// to a GHL custom field for review during the call.
// No client row is created — if the prospect signs, open the session in the
// Zip Tool and assign it to the new client in two clicks.
export async function POST(req: Request) {
  if (!validateWebhookSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json();
  const contact_name  = body.contact_name?.trim() || body.agency_name?.trim();
  const zip_code      = body.zip_code?.trim();
  const radius_miles  = body.radius_miles;

  if (!contact_name) {
    return NextResponse.json({ error: 'contact_name is required' }, { status: 400 });
  }
  if (!zip_code || !/^\d{5}$/.test(zip_code)) {
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

  const service = createServiceClient();

  const [{ data: session, error: sessionError }, scores] = await Promise.all([
    service
      .from('client_sessions')
      .insert({ client_id: null, name: `${contact_name} (Sales Call)`, pins: [pin], pin_counter: 1 })
      .select('id')
      .single(),
    fetchZipScores(zips),
  ]);

  if (sessionError) return NextResponse.json({ error: sessionError.message }, { status: 500 });

  const scored = Object.entries(scores).sort((a, b) => a[1].score - b[1].score);
  const worst  = scored[0];

  return NextResponse.json({
    success: true,
    session_id: session.id,
    zips_in_radius: zips.length,
    worst_zip:       worst?.[0]          ?? null,
    worst_zip_score: worst?.[1].score    ?? null,
    worst_zip_grade: worst?.[1].grade    ?? null,
  });
}
