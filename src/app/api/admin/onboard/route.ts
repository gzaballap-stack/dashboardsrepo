import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { validateWebhookSecret } from '@/lib/api-auth';
import { geocodeZip, getZctasNearPoint, fetchZipScores } from '@/lib/census';

const PIN_COLOR = '#000000';

type GHLCustomField = { key: string; value: string };

function extractCustomField(fields: GHLCustomField[] | undefined, key: string): string {
  return fields?.find(f => f.key === key)?.value?.trim() ?? '';
}

function parseZipList(raw: string): string[] {
  return raw
    .split(/[\n,\s]+/)
    .map(z => z.replace(/\D/g, '').slice(0, 5))
    .filter(z => /^\d{5}$/.test(z));
}

// Fired from GHL workflow when a sales call is booked.
// Detects which territory scenario applies:
//   1. Single zip + radius  → postal_code + targeting_radius
//   2. Two zips + radius    → zip_code_targeted (comma/space separated) + targeting_radius
//   3. Explicit zip list    → zip_code_list (multiline)
// Creates an unattributed Zip Tool session and returns worst_zip for GHL to write back.
export async function POST(req: Request) {
  if (!validateWebhookSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json();

  // Support GHL native webhook format ({ contact: { ... } }) and flat format
  const ghlContact = body.contact ?? body.Contact ?? null;
  const customFields: GHLCustomField[] = ghlContact?.customField ?? [];

  const contact_name = (
    body.contact_name?.trim() ||
    body.agency_name?.trim() ||
    ghlContact?.name?.trim() ||
    `${ghlContact?.firstName ?? ''} ${ghlContact?.lastName ?? ''}`.trim() ||
    'Unknown'
  );

  const radius = Math.min(
    Math.max(
      parseFloat(body.radius_miles ?? extractCustomField(customFields, 'targeting_radius')) || 35,
      5
    ),
    75
  );

  // ── Determine scenario ────────────────────────────────────────────────────

  // Scenario 3: explicit zip list (multi-line field)
  const rawList = body.zip_code_list ?? extractCustomField(customFields, 'zip_code_list');
  const zipList = parseZipList(rawList);

  // Scenario 2: two zips (comma/space separated)
  const rawTargeted = body.zip_code_targeted ?? extractCustomField(customFields, 'zip_code_targeted');
  const targetedZips = parseZipList(rawTargeted);

  // Scenario 1: single postal code
  const singleZip = (
    body.zip_code?.trim() ||
    ghlContact?.postalCode?.trim() ||
    ghlContact?.postal_code?.trim() ||
    extractCustomField(customFields, 'postal_code') ||
    ''
  ).replace(/\D/g, '').slice(0, 5);

  // ── Build territory ───────────────────────────────────────────────────────

  let allZips: string[] = [];
  let pins: object[] = [];

  if (zipList.length > 0) {
    // Scenario 3 — explicit list, no radius lookup needed
    allZips = zipList;
    // No pins — territory is defined by the explicit list itself

  } else if (targetedZips.length > 0) {
    // Scenario 2 — one or two center zips + radius
    const geos = await Promise.all(targetedZips.map(z => geocodeZip(z)));
    const zipSets = await Promise.all(
      geos.map((geo, i) => geo ? getZctasNearPoint(geo.lat, geo.lng, radius) : Promise.resolve([]))
    );
    allZips = [...new Set(zipSets.flat())];
    pins = geos
      .flatMap((geo, i) => geo ? [{
        id: `pin-${i + 1}`,
        lat: geo.lat,
        lng: geo.lng,
        label: `${targetedZips[i]} Territory`,
        radius,
        type: 'include' as const,
        color: PIN_COLOR,
      }] : []);

  } else if (/^\d{5}$/.test(singleZip)) {
    // Scenario 1 — single zip + radius
    const geo = await geocodeZip(singleZip);
    if (!geo) return NextResponse.json({ error: `Zip code "${singleZip}" not found` }, { status: 404 });
    const zips = await getZctasNearPoint(geo.lat, geo.lng, radius);
    allZips = zips;
    pins = [{
      id: 'pin-1',
      lat: geo.lat,
      lng: geo.lng,
      label: `${singleZip} Territory`,
      radius,
      type: 'include' as const,
      color: PIN_COLOR,
    }];

  } else {
    return NextResponse.json(
      { error: 'No zip code provided. Fill postal_code, zip_code_targeted, or zip_code_list on the contact.' },
      { status: 400 }
    );
  }

  if (allZips.length === 0) {
    return NextResponse.json({ error: 'No zip codes found for this territory' }, { status: 404 });
  }

  // ── Score & create session ────────────────────────────────────────────────

  const service = createServiceClient();

  const [{ data: session, error: sessionError }, scores] = await Promise.all([
    service
      .from('client_sessions')
      .insert({
        client_id: null,
        name: `${contact_name} (Sales Call)`,
        pins,
        pin_counter: pins.length,
      })
      .select('id')
      .single(),
    fetchZipScores(allZips),
  ]);

  if (sessionError) return NextResponse.json({ error: sessionError.message }, { status: 500 });

  const scored = Object.entries(scores).sort((a, b) => a[1].score - b[1].score);
  const worst  = scored[0];

  return NextResponse.json({
    success: true,
    session_id:      session.id,
    scenario:        zipList.length > 0 ? 'zip_list' : targetedZips.length > 0 ? 'multi_zip' : 'single_zip',
    zips_in_radius:  allZips.length,
    worst_zip:       worst?.[0]          ?? null,
    worst_zip_score: worst?.[1].score    ?? null,
    worst_zip_grade: worst?.[1].grade    ?? null,
  });
}
