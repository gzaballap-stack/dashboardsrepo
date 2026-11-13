// Marking a signed client as closed in GoHighLevel (the Tomsi Media
// sub-account), from the new client survey.
//
// "Closed" here is the contact field the owner already fills in after a demo —
// "Post-Call Status?" = Close (see post-call-status.ts, which reads it). The
// contact is found by the survey's emails, then its phone numbers. A note says
// what was collected, so the reason is visible on the contact.
//
// Best effort and bounded: GoHighLevel being slow, down, or not knowing the
// contact must never stop a survey from saving. Nothing here records a close or
// cash on the dashboard — that still arrives from GHL's own close workflow.

const BASE = 'https://services.leadconnectorhq.com';
const VERSION = '2021-07-28';
const LOCATION = process.env.GHL_LOCATION_B2B || 'jdBERcRjjBJ8dkPT9AOu';   // Tomsi Media
const POST_CALL_STATUS = 'DWkVhnxJV4Q8ufLrScZ1';                           // "Post-Call Status?"
const TIMEOUT_MS = 6000;

export type GhlCloseResult =
  | { marked: true; contact_id: string; noted: boolean }
  | { marked: false; why: 'not_connected' | 'no_contact_details' | 'not_found' | 'failed'; detail?: string };

const key = () => (process.env.GHL_API_KEY_B2B ?? '').trim();

async function call(method: 'GET' | 'PUT' | 'POST', path: string, body?: unknown): Promise<{ ok: boolean; json: Record<string, unknown> | null }> {
  try {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${key()}`, Version: VERSION, Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS), cache: 'no-store',
    });
    let json: Record<string, unknown> | null = null;
    try { json = await res.json(); } catch { /* not JSON */ }
    return { ok: res.ok, json };
  } catch {
    return { ok: false, json: null };
  }
}

/** "+15551234567" from whatever was typed; null when it isn't a phone number. */
export function e164(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  if (raw.trim().startsWith('+') && digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  return null;
}

async function lookup(param: 'email' | 'number', value: string): Promise<string | null> {
  const q = new URLSearchParams({ locationId: LOCATION, [param]: value });
  const { ok, json } = await call('GET', `/contacts/search/duplicate?${q}`);
  const contact = ok ? (json?.contact as { id?: unknown } | null | undefined) : null;
  return contact && typeof contact.id === 'string' ? contact.id : null;
}

/** The contact in the Tomsi Media account with one of these emails or phones. */
export async function findB2bContact(emails: string[], phones: string[]): Promise<string | null> {
  for (const email of [...new Set(emails.map(e => e.trim().toLowerCase()).filter(Boolean))]) {
    const id = await lookup('email', email);
    if (id) return id;
  }
  for (const phone of [...new Set(phones.map(e164).filter((p): p is string => !!p))]) {
    const id = await lookup('number', phone);
    if (id) return id;
  }
  return null;
}

/** Sets Post-Call Status to Close on their GHL contact and leaves a note. */
export async function markClosedInGhl(opts: { emails: string[]; phones: string[]; note?: string }): Promise<GhlCloseResult> {
  if (!key()) return { marked: false, why: 'not_connected' };
  const emails = opts.emails.filter(e => e.trim()), phones = opts.phones.filter(p => p.trim());
  if (!emails.length && !phones.length) return { marked: false, why: 'no_contact_details' };

  const contactId = await findB2bContact(emails, phones);
  if (!contactId) return { marked: false, why: 'not_found' };

  const set = await call('PUT', `/contacts/${encodeURIComponent(contactId)}`, {
    customFields: [{ id: POST_CALL_STATUS, field_value: 'Close' }],
  });
  if (!set.ok) return { marked: false, why: 'failed', detail: String((set.json?.message as string | undefined) ?? '').slice(0, 200) };

  let noted = false;
  if (opts.note) noted = (await call('POST', `/contacts/${encodeURIComponent(contactId)}/notes`, { body: opts.note.slice(0, 2000) })).ok;
  return { marked: true, contact_id: contactId, noted };
}
