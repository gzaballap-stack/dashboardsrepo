import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { validateWebhookSecret } from '@/lib/api-auth';
import { geocodeZip, getZctasNearPoint, fetchZipMetrics, type ScoredZipMetrics } from '@/lib/census';

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
// The session is named "<company> (Custom Area Breakdown)" — it gets shown to the
// prospect, so it must never read as internal sales language.
export async function POST(req: Request) {
  if (!validateWebhookSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json();

  // Support GHL native webhook format ({ contact: { ... } }) and flat format
  const ghlContact = body.contact ?? body.Contact ?? null;
  const customFields: GHLCustomField[] = ghlContact?.customField ?? [];

  // Session name: the prospect's company if we have one, otherwise the person.
  // These sessions sit unattached in the Zip Tool until someone links them to a
  // client, so the name is the only thing identifying whose territory it is.
  const company_name = (
    body.company_name?.trim() ||
    body.agency_name?.trim() ||
    ghlContact?.companyName?.trim() ||
    ghlContact?.company_name?.trim() ||
    extractCustomField(customFields, 'company_name') ||
    extractCustomField(customFields, 'business_name') ||
    ''
  );

  const person_name = (
    body.contact_name?.trim() ||
    ghlContact?.name?.trim() ||
    `${ghlContact?.firstName ?? ''} ${ghlContact?.lastName ?? ''}`.trim() ||
    ''
  );

  const contact_name = company_name || person_name || 'Unknown';

  // The radius can arrive under several names depending on how the GHL workflow's
  // custom data was labelled. Try them all before falling back to the default —
  // and say which one won, so a silent fallback to 35 can't pass for a real value.
  const customData = (body.customData ?? body.custom_data ?? {}) as Record<string, unknown>;
  const radiusCandidates: Array<[string, unknown]> = [
    ['radius_miles',               body.radius_miles],
    ['targeting_radius',           body.targeting_radius],
    ['Targeting Radius',           body['Targeting Radius']],
    ['radius',                     body.radius],
    ['customData.targeting_radius', customData.targeting_radius],
    ['customData.Targeting Radius', customData['Targeting Radius']],
    ['customData.radius_miles',    customData.radius_miles],
    ['contact.customField',        extractCustomField(customFields, 'targeting_radius')],
  ];
  const radiusHit = radiusCandidates.find(([, v]) => Number.isFinite(parseFloat(String(v ?? ''))));
  const radius_source = radiusHit ? radiusHit[0] : 'default';
  const radius = Math.min(
    Math.max(radiusHit ? parseFloat(String(radiusHit[1])) : 35, 5),
    75
  );

  if (!radiusHit) {
    console.warn('[onboard] no usable radius on payload, defaulting to 35', JSON.stringify({
      keys: Object.keys(body),
      customDataKeys: Object.keys(customData),
    }));
  }

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

  const [{ data: session, error: sessionError }, metrics] = await Promise.all([
    service
      .from('client_sessions')
      .insert({
        client_id: null,
        name: `${contact_name} (Custom Area Breakdown)`,
        pins,
        pin_counter: pins.length,
      })
      .select('id')
      .single(),
    fetchZipMetrics(allZips),
  ]);

  if (sessionError) return NextResponse.json({ error: sessionError.message }, { status: 500 });

  // PO-box style ZCTAs report no income or home value — nothing honest to grade,
  // and one of them ranking "worst" would put a nonsense zip in front of the prospect.
  const scored = (Object.values(metrics) as ScoredZipMetrics[])
    .filter(m => m.median_income > 0 && m.home_value > 0)
    .sort((a, b) => b.score - a.score || a.zip.localeCompare(b.zip));

  const worst = scored[scored.length - 1];

  // ── Fields for the Custom Area Breakdown doc ──────────────────────────────
  // Flat strings, one per {{tag}} in the Google Docs template, so Make can map
  // them straight across without touching the content.
  const money  = (n: number) => `$${Math.round(n / 1000)}k`;
  const detail = (m: ScoredZipMetrics) =>
    `${m.zip} — ZipScore ${m.score} · income ${money(m.median_income)} · home value ${money(m.home_value)} · ${Math.round(m.owner_pct)}% owner-occupied`;
  const byTier = (t: ScoredZipMetrics['grade']) => scored.filter(m => m.grade === t).map(m => m.zip);
  const list   = (zips: string[]) => zips.length ? zips.join(', ') : 'None';

  const top5    = scored.slice(0, 5);
  const bottom5 = scored.slice(-5).reverse();
  const tiers   = { green: byTier('A'), blue: byTier('B'), yellow: byTier('C'), red: byTier('D') };

  const service_area =
    zipList.length > 0     ? `${allZips.length} selected zip codes` :
    targetedZips.length > 0 ? `${radius} miles around ${targetedZips.join(' and ')}` :
                              `${radius} miles around ${singleZip}`;

  const doc = {
    title:          `${contact_name} Custom Area Breakdown`,
    company:        contact_name,
    service_area,
    date:           new Date().toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' }),
    scored_count:   String(scored.length),
    top5:           list(top5.map(m => m.zip)),
    top5_detail:    top5.map(detail).join('\n'),
    bottom5:        list(bottom5.map(m => m.zip)),
    bottom5_detail: bottom5.map(detail).join('\n'),
    green:          list(tiers.green),  green_count:  String(tiers.green.length),
    blue:           list(tiers.blue),   blue_count:   String(tiers.blue.length),
    yellow:         list(tiers.yellow), yellow_count: String(tiers.yellow.length),
    red:            list(tiers.red),    red_count:    String(tiers.red.length),
    // One tag per figure for each of the top five, so the template can lay them
    // out as nested bullets — a single multi-line value can't carry that structure.
    ...Object.fromEntries(
      [0, 1, 2, 3, 4].flatMap(i => {
        const m = top5[i];
        const n = i + 1;
        return [
          [`top${n}_zip`,        m ? m.zip : '—'],
          [`top${n}_score`,      m ? String(m.score) : '—'],
          [`top${n}_income`,     m ? money(m.median_income) : '—'],
          [`top${n}_home_value`, m ? money(m.home_value) : '—'],
          [`top${n}_owner`,      m ? `${Math.round(m.owner_pct)}%` : '—'],
        ];
      })
    ),
  };

  return NextResponse.json({
    success: true,
    session_id:      session.id,
    scenario:        zipList.length > 0 ? 'zip_list' : targetedZips.length > 0 ? 'multi_zip' : 'single_zip',
    radius_miles:    radius,
    radius_source,
    zips_in_radius:  allZips.length,
    worst_zip:       worst?.zip   ?? null,
    worst_zip_score: worst?.score ?? null,
    worst_zip_grade: worst?.grade ?? null,
    doc,
  });
}
