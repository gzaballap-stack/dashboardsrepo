import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { validateWebhookSecret } from '@/lib/api-auth';
import { fetchGhlAttribution } from '@/lib/ghl-attribution';
import { normalizeZip } from '@/lib/zip-rollup';

/**
 * Backfill the lead's zip code onto existing events from GoHighLevel.
 *
 * GHL holds the postal code on the contact, and every event already carries a
 * ghl_contact_id — so history can be placed on the map retroactively: one API
 * call per unique contact, applied to all of that contact's events.
 *
 * POST { dry_run?: boolean, limit?: number, only_missing?: boolean, client_id?: string }
 *
 * dry_run defaults to TRUE. Nothing is written unless dry_run is explicitly false.
 */

const GHL_CONCURRENCY = 3;   // GHL 429s readily; the lib also retries with backoff
const BATCH_PAUSE_MS  = 200;
const DEFAULT_LIMIT   = 1000;

export async function POST(req: Request) {
  if (!validateWebhookSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const apiKey = process.env.GHL_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'GHL_API_KEY is not set' }, { status: 503 });
  }

  const body = await req.json().catch(() => ({}));
  const dryRun      = body.dry_run !== false;
  const onlyMissing = body.only_missing !== false;
  const clientId    = typeof body.client_id === 'string' ? body.client_id : null;
  const limit       = Math.min(Number(body.limit) || DEFAULT_LIMIT, 5000);

  const service = createServiceClient();

  // Only the events a zip actually places on the map — dials aren't part of the
  // per-zip funnel.
  let q = service
    .from('events')
    .select('id, ghl_contact_id, zip_code')
    .not('ghl_contact_id', 'is', null)
    .in('event_type', ['lead', 'appointment_booked', 'show', 'closed'])
    .order('occurred_at', { ascending: false })
    .limit(limit);

  if (onlyMissing) q = q.is('zip_code', null);
  if (clientId)    q = q.eq('client_id', clientId);

  const { data: rows, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!rows?.length) {
    return NextResponse.json({ dry_run: dryRun, events_considered: 0, message: 'Nothing to backfill' });
  }

  // One lookup per contact, not per event.
  const contactIds = [...new Set(rows.map(r => r.ghl_contact_id as string))];

  const zipByContact = new Map<string, string>();
  const failures: Array<{ contact_id: string; status: number; error: string }> = [];
  let noZip = 0;

  for (let i = 0; i < contactIds.length; i += GHL_CONCURRENCY) {
    const batch = contactIds.slice(i, i + GHL_CONCURRENCY);
    await Promise.all(batch.map(async cid => {
      const res = await fetchGhlAttribution(cid, apiKey);
      if (!res.ok) {
        failures.push({ contact_id: cid, status: res.status, error: res.error });
        return;
      }
      const zip = normalizeZip(res.zip);
      if (zip) zipByContact.set(cid, zip);
      else noZip++;
    }));
    if (i + GHL_CONCURRENCY < contactIds.length) {
      await new Promise(r => setTimeout(r, BATCH_PAUSE_MS));
    }
  }

  const updates = rows.filter(r => zipByContact.has(r.ghl_contact_id as string));

  let written = 0;
  const writeErrors: string[] = [];

  if (!dryRun) {
    for (const row of updates) {
      const zip_code = zipByContact.get(row.ghl_contact_id as string)!;
      const { error: ue } = await service.from('events').update({ zip_code }).eq('id', row.id);
      if (ue) writeErrors.push(`${row.id}: ${ue.message}`);
      else written++;
    }
  }

  // How the backfilled events land across zips — a sanity check before writing.
  const zipSpread: Record<string, number> = {};
  for (const row of updates) {
    const zip = zipByContact.get(row.ghl_contact_id as string)!;
    zipSpread[zip] = (zipSpread[zip] ?? 0) + 1;
  }
  const topZips = Object.entries(zipSpread)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([zip, count]) => ({ zip, events: count }));

  return NextResponse.json({
    dry_run: dryRun,
    events_considered:        rows.length,
    unique_contacts:          contactIds.length,
    contacts_with_zip:        zipByContact.size,
    contacts_without_zip:     noZip,
    events_that_would_update: updates.length,
    events_written: dryRun ? 0 : written,
    distinct_zips:  Object.keys(zipSpread).length,
    top_zips:       topZips,
    lookup_failures: failures.length,
    failure_sample:  failures.slice(0, 5),
    write_errors:    writeErrors.slice(0, 5),
  });
}
