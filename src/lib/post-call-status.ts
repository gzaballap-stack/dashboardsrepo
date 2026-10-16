// Post-call outcome of demos that showed, read from the GoHighLevel contact
// field "Post-Call Status?" (Close / No Close / Follow Up) on the Tomsi Media
// sub-account. No workflow or Make scenario: the dashboard polls GHL itself,
// at most once an hour, for every contact whose demo showed in the last 90 days,
// and stores the answer on that contact's `sales_call_shown` row.

import { createServiceClient } from './supabase';

const FIELD_ID = 'DWkVhnxJV4Q8ufLrScZ1';          // "Post-Call Status?"
const LOOKBACK_DAYS = 90;
const MIN_INTERVAL_MS = 60 * 60 * 1000;             // hourly
const CONCURRENCY = 4;

export const POST_CALL_STATUSES = ['Close', 'No Close', 'Follow Up'] as const;
export type PostCallStatus = typeof POST_CALL_STATUSES[number];

function normalise(v: unknown): PostCallStatus | null {
  const s = String(v ?? '').trim().toLowerCase();
  if (!s) return null;
  if (s === 'close' || s === 'closed') return 'Close';
  if (s === 'no close' || s === 'no-close' || s === 'not closed') return 'No Close';
  if (s === 'follow up' || s === 'follow-up' || s === 'followup') return 'Follow Up';
  return null;
}

async function readStatus(contactId: string, token: string): Promise<PostCallStatus | null | undefined> {
  const res = await fetch(`https://services.leadconnectorhq.com/contacts/${encodeURIComponent(contactId)}`, {
    headers: { Authorization: `Bearer ${token}`, Version: '2021-07-28', Accept: 'application/json' },
    cache: 'no-store',
  });
  if (!res.ok) return undefined;                    // unknown — leave the row alone
  const json = await res.json() as { contact?: { customFields?: { id: string; value?: unknown }[] } };
  const field = json.contact?.customFields?.find(f => f.id === FIELD_ID);
  return normalise(field?.value);
}

export type PostCallSyncResult = { checked: number; updated: number; skipped?: string };

/** Reads the field for every recent shown demo and stores what changed. */
export async function syncPostCallStatus(service = createServiceClient()): Promise<PostCallSyncResult> {
  const token = process.env.GHL_API_KEY_B2B;
  if (!token) return { checked: 0, updated: 0, skipped: 'GHL_API_KEY_B2B not set' };

  const since = new Date(Date.now() - LOOKBACK_DAYS * 86_400_000).toISOString();
  const { data: rows } = await service.from('b2b_events')
    .select('id, ghl_contact_id, post_call_status')
    .eq('event_type', 'sales_call_shown').gte('occurred_at', since).not('ghl_contact_id', 'is', null);

  const byContact = new Map<string, { id: string; post_call_status: string | null }[]>();
  for (const r of rows ?? []) {
    if (!r.ghl_contact_id) continue;
    const list = byContact.get(r.ghl_contact_id) ?? [];
    list.push({ id: r.id, post_call_status: r.post_call_status });
    byContact.set(r.ghl_contact_id, list);
  }

  const contacts = [...byContact.keys()];
  let updated = 0;
  for (let i = 0; i < contacts.length; i += CONCURRENCY) {
    await Promise.all(contacts.slice(i, i + CONCURRENCY).map(async contactId => {
      let status: PostCallStatus | null | undefined;
      try { status = await readStatus(contactId, token); } catch { status = undefined; }
      if (status === undefined) return;
      for (const row of byContact.get(contactId) ?? []) {
        if ((row.post_call_status ?? null) === status) continue;
        const { error } = await service.from('b2b_events').update({ post_call_status: status }).eq('id', row.id);
        if (!error) updated++;
      }
    }));
  }
  return { checked: contacts.length, updated };
}

// Hourly, in the background, triggered by dashboard reads. One run at a time.
let lastRun = 0;
let running: Promise<PostCallSyncResult> | null = null;

export function maybeSyncPostCallStatus(): void {
  if (running || Date.now() - lastRun < MIN_INTERVAL_MS) return;
  lastRun = Date.now();
  running = syncPostCallStatus().catch(() => ({ checked: 0, updated: 0 })).finally(() => { running = null; });
}
