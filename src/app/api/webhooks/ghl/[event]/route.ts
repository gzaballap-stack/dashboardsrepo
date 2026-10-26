import { NextResponse } from 'next/server';
import {
  validateDirectToken, field, clientEvent, b2bEvent, CLIENT_EVENTS, B2B_EVENTS, type GhlPayload,
} from '@/lib/ghl-direct';
import { createFromTemplate, replaceText } from '@/lib/google-docs-bridge';
import { POST as clientWebhook } from '@/app/api/webhooks/route';
import { POST as b2bWebhook } from '@/app/api/webhooks/b2b/route';
import { POST as smsWebhook } from '@/app/api/webhooks/sms/route';
import { POST as onboard } from '@/app/api/admin/onboard/route';
import { POST as salesCallGoals } from '@/app/api/admin/sales-call-goals/route';

// One URL per GHL workflow, posted straight from GHL's Webhook action — this is
// what replaced the Make scenarios (NOTES.md 2026-10-26):
//
//   /api/webhooks/ghl/<event>?token=<DIRECT_WEBHOOK_TOKEN>
//
//   client funnel   lead · appointment_booked · show · no_show · dial · callback_booked
//   Tomsi (B2B)     b2b-lead · b2b-sales_call_booked · b2b-sales_call_shown · b2b-close
//                   (b2b-intro_booked / b2b-intro_shown / b2b-spam still accepted)
//   SMS             sms            (custom data event_type = sms_sent | sms_reply)
//   Tomsi sales     territory      (Sales Call Territory Scoring)
//                   sales-call-numbers
//
// Each one hands the existing route the same body Make used to send.

const TERRITORY_TEMPLATE = '1vS4eekVHI2ULhezVGheiCQBJxihqHOctg0kSZmZ3pkE';
const DOC_URL_FIELD = '2iC8q2ndjpWgGd9uqKAl'; // Tomsi contact field "Custom Area Breakdown URL"

type Handler = (req: Request) => Promise<Response>;

function forward(req: Request, handler: Handler, path: string, body: unknown) {
  return handler(new Request(new URL(path, req.url), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.ADMIN_WEBHOOK_SECRET ?? ''}` },
    body: JSON.stringify(body),
  }));
}

async function ghlUpdateContact(contactId: string, customFields: Record<string, string>[]) {
  const key = process.env.GHL_API_KEY_B2B;
  if (!key || !contactId) return false;
  const res = await fetch(`https://services.leadconnectorhq.com/contacts/${encodeURIComponent(contactId)}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${key}`, Version: '2021-07-28', 'Content-Type': 'application/json' },
    body: JSON.stringify({ customFields }),
  }).catch(() => null);
  return !!res?.ok;
}

// Sales Call Territory Scoring: score the territory, write the worst zip back to
// the contact, build the area-breakdown doc from the template, link it on the contact.
async function territory(req: Request, p: GhlPayload) {
  const name = [field(p, 'first_name'), field(p, 'last_name')].filter(Boolean).join(' ');
  const radius = field(p, 'targeting_radius', 'Targeting Radius', 'radius');
  const res = await forward(req, onboard, '/api/admin/onboard', {
    contact_name: name, company_name: field(p, 'company_name'),
    zip_code: field(p, 'postal_code'), zip_code_targeted: field(p, 'zip_code_targeted'),
    zip_code_list: field(p, 'zip_code_list'), radius_miles: radius, targeting_radius: radius,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) return NextResponse.json(data, { status: res.status });

  const contactId = field(p, 'contact_id');
  const zipWritten = data.worst_zip
    ? await ghlUpdateContact(contactId, [{ key: 'worst_performing_zip_code', field_value: String(data.worst_zip) }])
    : false;

  let doc: { id?: string; error?: string } = {};
  if (data.doc) {
    const { title, company, ...rest } = data.doc as Record<string, string>;
    const made = await createFromTemplate(TERRITORY_TEMPLATE, title ?? name, { ...rest, 'contact.company_name': company ?? '' });
    doc = made.ok ? { id: made.id } : { error: made.error };
    if (made.ok && made.id) {
      await ghlUpdateContact(contactId, [{ id: DOC_URL_FIELD, field_value: `https://docs.google.com/document/d/${made.id}/edit` }]);
    }
  }
  if (doc.error) console.warn('[webhooks/ghl] territory doc failed', doc.error);
  return NextResponse.json({ success: true, worst_zip: data.worst_zip ?? null, zip_written: zipWritten, doc });
}

// Sales Call Numbers: compute the goals, then fill them into the contact's doc.
async function salesCallNumbers(req: Request, p: GhlPayload) {
  const res = await forward(req, salesCallGoals, '/api/admin/sales-call-goals', {
    contact_id: field(p, 'contact_id', 'Contact ID'),
    average_job: field(p, 'average_job', 'Average Job'),
    current_revenue: field(p, 'current_revenue', 'Current Revenue'),
    revenue_goal: field(p, 'revenue_goal', 'Revenue Goal'),
    close_rate: field(p, 'close_rate'),
    doc_url: field(p, 'custom_area_breakdown_url', 'Custom Area Breakdown URL'),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.doc_id || !Array.isArray(data.replacements)) return NextResponse.json(data, { status: res.status });
  const filled = await replaceText(data.doc_id, data.replacements);
  if (!filled.ok) console.warn('[webhooks/ghl] sales-call doc fill failed', filled.error);
  return NextResponse.json({ ...data, doc_filled: filled.ok, ...(filled.ok ? {} : { doc_error: filled.error }) });
}

export async function POST(req: Request, { params }: { params: Promise<{ event: string }> }) {
  if (!validateDirectToken(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { event } = await params;

  let p: GhlPayload;
  try { p = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  if ((CLIENT_EVENTS as readonly string[]).includes(event)) {
    return forward(req, clientWebhook, '/api/webhooks', clientEvent(event as (typeof CLIENT_EVENTS)[number], p));
  }
  if (event.startsWith('b2b-') && (B2B_EVENTS as readonly string[]).includes(event.slice(4))) {
    return forward(req, b2bWebhook, '/api/webhooks/b2b', b2bEvent(event.slice(4) as (typeof B2B_EVENTS)[number], p));
  }
  if (event === 'sms') return forward(req, smsWebhook, '/api/webhooks/sms', p);
  if (event === 'territory') return territory(req, p);
  if (event === 'sales-call-numbers') return salesCallNumbers(req, p);

  return NextResponse.json({ error: `Unknown event "${event}"` }, { status: 404 });
}
