import { timingSafeEqual } from 'node:crypto';

// GHL workflows post straight to the app (no Make). GHL's Webhook action sends
// its standard contact payload — flat contact fields (contact_id, first_name,
// last_name, email, phone, date_created, postal_code, custom fields by key…)
// plus the workflow's Custom Data under `customData`. These builders turn that
// into exactly the body the retired Make scenarios used to post, so the
// existing webhook routes receive the same thing they always did.
//
// Auth: `?token=<DIRECT_WEBHOOK_TOKEN>` in the URL, so a GHL workflow only needs
// its URL changed — no header. See NOTES.md 2026-10-26.

export type GhlPayload = Record<string, unknown> & { customData?: Record<string, unknown> };

export function validateDirectToken(req: Request): boolean {
  const expected = process.env.DIRECT_WEBHOOK_TOKEN;
  const got = new URL(req.url).searchParams.get('token');
  if (!expected || !got) return false;
  const a = Buffer.from(got), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const str = (v: unknown) => (v == null ? '' : String(v).trim());

/** A Custom Data value, falling back to a top-level field of the same name. */
export function field(p: GhlPayload, ...keys: string[]): string {
  const cd = (p.customData ?? {}) as Record<string, unknown>;
  for (const k of keys) {
    const v = str(cd[k]) || str(p[k]);
    if (v) return v;
  }
  return '';
}

const orNull = (v: string) => v || null;
const now = () => new Date().toISOString();

function when(v: string): string {
  if (!v) return now();
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? now() : d.toISOString();
}

// The GHL custom-data names for ad attribution (CLAUDE.md "Ad attribution").
const ATTRIBUTION: Record<string, string[]> = {
  ad_platform:   ['ad_platform', 'Ad Platform'],
  campaign_id:   ['campaign_id', 'Campaign ID'],
  campaign_name: ['campaign_name', 'Campaign Name'],
  adset_id:      ['adset_id', 'Ad Set ID'],
  adset_name:    ['adset_name', 'Ad Set Name'],
  ad_id:         ['ad_id', 'Ad ID'],
  ad_name:       ['ad_name', 'Ad Name'],
  utm_source:    ['utm_source', 'UTM Source'],
  utm_medium:    ['utm_medium', 'UTM Medium'],
  utm_campaign:  ['utm_campaign', 'UTM Campaign'],
  utm_content:   ['utm_content', 'UTM Content'],
  utm_term:      ['utm_term', 'UTM Term'],
  referrer_url:  ['referrer_url', 'Referrer URL'],
};

function attribution(p: GhlPayload): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, names] of Object.entries(ATTRIBUTION)) {
    const v = field(p, ...names);
    if (v) out[k] = v;
  }
  return out;
}

function contact(p: GhlPayload) {
  return {
    ghl_contact_id: orNull(str(p.contact_id)),
    lead_name: orNull([str(p.first_name), str(p.last_name)].filter(Boolean).join(' ') || str(p.full_name)),
    lead_phone: orNull(str(p.phone)),
    lead_email: orNull(str(p.email)),
    postal_code: orNull(str(p.postal_code)),
  };
}

export const CLIENT_EVENTS = ['lead', 'appointment_booked', 'show', 'no_show', 'dial', 'callback_booked'] as const;
export const B2B_EVENTS = ['lead', 'intro_booked', 'intro_shown', 'sales_call_booked', 'sales_call_shown', 'close', 'spam'] as const;

/** Body for /api/webhooks — mirrors the retired "CCM - … → Supabase" scenarios. */
export function clientEvent(event: (typeof CLIENT_EVENTS)[number], p: GhlPayload): Record<string, unknown> {
  const body: Record<string, unknown> = {
    event_type: event,
    client_name: field(p, 'client_name', 'Client Name'),
    occurred_at: now(),
    ...contact(p),
    ...attribution(p),
  };
  if (event === 'lead') body.occurred_at = when(str(p.date_created));
  if (event === 'appointment_booked') body.external_id = orNull(field(p, 'appointment_id'));
  if (event === 'dial') {
    const secs = Number(field(p, 'Call Duration', 'call_duration')) || 0;
    body.occurred_at = when(field(p, 'Phone Call Start Time', 'phone_call_start_time'));
    body.duration_seconds = secs;
    body.is_pickup = secs >= 40;
    body.is_conversation = secs >= 120;
    for (const [k, names] of Object.entries({
      call_status: ['Call Status', 'call_status'], agent_name: ['Agent Name', 'agent_name'],
      call_summary: ['Call Summary', 'call_summary'], direction: ['direction', 'Direction'],
    })) { const v = field(p, ...names); if (v) body[k] = v; }
  }
  return body;
}

/** Body for /api/webhooks/b2b — mirrors the retired "CCM - B2B … → Supabase" scenarios. */
export function b2bEvent(event: (typeof B2B_EVENTS)[number], p: GhlPayload): Record<string, unknown> {
  const body: Record<string, unknown> = {
    event_type: event,
    occurred_at: now(),
    external_id: orNull(event === 'lead' ? field(p, 'lead_id') : field(p, 'appointment_id')),
    ...contact(p),
    ...attribution(p),
  };
  const revenue = event === 'close' ? field(p, 'cash_collected') : field(p, 'revenue');
  if (revenue) body.revenue = revenue;
  if (event === 'sales_call_booked') { const by = field(p, 'booked_by'); if (by) body.booked_by = by; }
  return body;
}
