import { NextResponse } from 'next/server';
import { validateWebhookSecret } from '@/lib/api-auth';
import { computeGoals, parseDocId, GOAL_TAGS } from '@/lib/goal-math';

type GHLCustomField = { key?: string; id?: string; value: string };

// Tomsi Media sub-account custom fields (ids are stable, keys are not sent by
// the contact API). Looked up 2026-10-08 via /locations/{id}/customFields.
const GHL_FIELD_IDS = {
  doc_url:         '2iC8q2ndjpWgGd9uqKAl', // Custom Area Breakdown URL
  average_job:     'OEFTmQgo0w1aJZ6IQMBS',
  current_revenue: 'gqnInqYlelNjoTivzOVk',
  revenue_goal:    'ZlYCAvDygY4tHTrJYIWX',
} as const;

// Read the contact straight from GHL so Make only has to send the contact id.
async function fetchContactFields(contactId: string): Promise<Partial<Record<keyof typeof GHL_FIELD_IDS, string>> | null> {
  const key = process.env.GHL_API_KEY_B2B;
  if (!key) return null;
  try {
    const res = await fetch(`https://services.leadconnectorhq.com/contacts/${encodeURIComponent(contactId)}`, {
      headers: { Authorization: `Bearer ${key}`, Version: '2021-07-28' },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const json = await res.json();
    const fields: GHLCustomField[] = json?.contact?.customFields ?? [];
    const out: Partial<Record<keyof typeof GHL_FIELD_IDS, string>> = {};
    for (const [name, id] of Object.entries(GHL_FIELD_IDS) as [keyof typeof GHL_FIELD_IDS, string][]) {
      const v = fields.find(f => f.id === id)?.value;
      if (v != null && String(v).trim() !== '') out[name] = String(v);
    }
    return out;
  } catch {
    return null;
  }
}

// Fired from the GHL "Client's Numbers Submitted" workflow. Returns the derived
// figures plus a ready-made find/replace list, so Make can write them into the
// existing Custom Area Breakdown doc with one "Replace a Text" step.
//
// Accepts the flat shape ({ average_job, ... }), GHL customData, or the native
// GHL webhook shape ({ contact: { customField: [...] } }). Anything missing from
// the payload is read off the contact in GHL when `contact_id` is present.
export async function POST(req: Request) {
  if (!validateWebhookSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const customData = (body.customData ?? body.custom_data ?? {}) as Record<string, unknown>;
  const ghlContact = (body.contact ?? body.Contact ?? null) as { id?: string; customField?: GHLCustomField[] } | null;
  const fields: GHLCustomField[] = ghlContact?.customField ?? [];

  const pick = (...keys: string[]) => {
    for (const k of keys) {
      const v = body[k] ?? customData[k] ?? fields.find(f => f.key === k)?.value;
      if (v != null && String(v).trim() !== '') return v;
    }
    return undefined;
  };

  const contact_id = String(pick('contact_id', 'Contact ID', 'contactId', 'id') ?? ghlContact?.id ?? '').trim() || null;

  let average_job     = pick('average_job', 'Average Job', 'avg_job');
  let current_revenue = pick('current_revenue', 'Current Revenue');
  let revenue_goal    = pick('revenue_goal', 'Revenue Goal');
  const close_rate    = pick('close_rate', 'Close Rate');
  let docRaw          = pick('doc_id', 'doc_url', 'Doc URL', 'custom_area_breakdown_url', 'Custom Area Breakdown URL', 'document_url');

  let contact_source = false;
  if (contact_id && (!average_job || !current_revenue || !revenue_goal || !docRaw)) {
    const c = await fetchContactFields(contact_id);
    if (c) {
      contact_source = true;
      average_job     ??= c.average_job;
      current_revenue ??= c.current_revenue;
      revenue_goal    ??= c.revenue_goal;
      docRaw          ??= c.doc_url;
    }
  }

  const result = computeGoals({ average_job, current_revenue, revenue_goal, close_rate });
  const doc_id = parseDocId(docRaw);

  // Make's Google Docs "Replace a Text in a Document" takes old/new text pairs.
  const replacements = GOAL_TAGS.map(t => ({
    find: `{{${t}}}`, replace: result.doc[t],
    oldText: `{{${t}}}`, newText: result.doc[t],
  }));

  return NextResponse.json({
    success: true,
    complete: result.complete,
    missing: result.missing,
    contact_id,
    contact_source,
    doc_id,
    doc_url: doc_id ? `https://docs.google.com/document/d/${doc_id}/edit` : null,
    ...result.doc,
    numbers: result.numbers,
    replacements,
  });
}
