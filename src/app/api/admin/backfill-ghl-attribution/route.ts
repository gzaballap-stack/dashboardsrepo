import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { validateWebhookSecret } from '@/lib/api-auth';
import { ATTRIBUTION_FIELDS } from '@/lib/attribution';
import { fetchGhlAttribution } from '@/lib/ghl-attribution';

/**
 * Backfill ad attribution onto existing events from GoHighLevel.
 *
 * GHL stores campaign/ad-set/ad IDs on the contact itself, including for Meta
 * lead-form leads that never touched a landing page. Every event already carries
 * a ghl_contact_id, so history can be attributed retroactively — one API call
 * per unique contact, applied to all of that contact's events.
 *
 * POST { dry_run?: boolean, table?: 'events'|'b2b_events', limit?: number, only_missing?: boolean }
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
  const table       = body.table === 'b2b_events' ? 'b2b_events' : 'events';
  const onlyMissing = body.only_missing !== false;
  const limit       = Math.min(Number(body.limit) || DEFAULT_LIMIT, 5000);

  const service = createServiceClient();

  // Every event that could gain attribution, newest first.
  let q = service
    .from(table)
    .select('id, ghl_contact_id, campaign_id, adset_id, ad_id')
    .not('ghl_contact_id', 'is', null)
    .order('occurred_at', { ascending: false })
    .limit(limit);

  if (onlyMissing) q = q.is('campaign_id', null);

  const { data: rows, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!rows?.length) {
    return NextResponse.json({ dry_run: dryRun, table, events_considered: 0, message: 'Nothing to backfill' });
  }

  // One lookup per contact, not per event — 1,158 events collapse to ~309 calls.
  const contactIds = [...new Set(rows.map(r => r.ghl_contact_id as string))];

  const attrByContact = new Map<string, Record<string, unknown>>();
  const failures: Array<{ contact_id: string; status: number; error: string }> = [];
  let attributed = 0;

  for (let i = 0; i < contactIds.length; i += GHL_CONCURRENCY) {
    const batch = contactIds.slice(i, i + GHL_CONCURRENCY);
    await Promise.all(batch.map(async cid => {
      const res = await fetchGhlAttribution(cid, apiKey);
      if (!res.ok) {
        failures.push({ contact_id: cid, status: res.status, error: res.error });
        return;
      }
      const hasAny = ATTRIBUTION_FIELDS.some(f => res.attribution[f]);
      const hasLast = res.lastTouch && ATTRIBUTION_FIELDS.some(f => res.lastTouch![f]);
      if (hasAny || hasLast) {
        // Last touch rides along in a json column; first touch fills the columns.
        attrByContact.set(cid, {
          ...(hasAny ? res.attribution : {}),
          ...(hasLast ? { last_touch: res.lastTouch } : {}),
        });
        attributed++;
      }
    }));
    if (i + GHL_CONCURRENCY < contactIds.length) {
      await new Promise(r => setTimeout(r, BATCH_PAUSE_MS));
    }
  }

  // Apply to every event belonging to an attributed contact.
  const updates = rows.filter(r => attrByContact.has(r.ghl_contact_id as string));

  let written = 0;
  const writeErrors: string[] = [];

  if (!dryRun) {
    for (const row of updates) {
      const attr = attrByContact.get(row.ghl_contact_id as string)!;
      const { error: ue } = await service.from(table).update(attr).eq('id', row.id);
      if (ue) writeErrors.push(`${row.id}: ${ue.message}`);
      else written++;
    }
  }

  const sample = updates.slice(0, 3).map(r => ({
    event_id: r.id,
    ...attrByContact.get(r.ghl_contact_id as string),
  }));

  return NextResponse.json({
    dry_run: dryRun,
    table,
    events_considered:   rows.length,
    unique_contacts:     contactIds.length,
    contacts_attributed: attributed,
    events_that_would_update: updates.length,
    events_written: dryRun ? 0 : written,
    lookup_failures: failures.length,
    failure_sample: failures.slice(0, 5),
    write_errors: writeErrors.slice(0, 5),
    sample,
  });
}
