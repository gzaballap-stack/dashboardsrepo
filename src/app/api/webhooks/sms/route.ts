import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { validateWebhookSecret } from '@/lib/api-auth';
import { resolveClientId } from '@/lib/client-lookup';
import { POST as clientWebhook } from '@/app/api/webhooks/route';

// SMS service line — posted STRAIGHT from GHL's Webhook action (no Make).
//
// GHL sends its standard contact payload plus whatever is set as Custom Data.
// Custom data the workflow must carry:
//   event_type   sms_sent   (the blast workflow)   |   sms_reply  (positive reply)
//   client_name  the client exactly as on the Client Roster
//   messages     optional, blast workflow only — how many messages this run sent
//                (omit when the workflow fires once per contact: that's 1 message)
// Header: Authorization: Bearer <ADMIN_WEBHOOK_SECRET>
//
// sms_sent  → one row in sms_sends (deduped so a re-fired webhook can't double count).
// sms_reply → a normal `lead` for that client, tagged utm_source / ad_platform = "sms",
//             so bookings, shows and closes that follow inherit the SMS channel.

type Payload = Record<string, unknown> & { customData?: Record<string, unknown> };

const str = (v: unknown) => (v == null ? '' : String(v).trim());

export async function POST(req: Request) {
  if (!validateWebhookSecret(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let payload: Payload;
  try { payload = await req.json(); } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }
  const cd = (payload.customData ?? {}) as Record<string, unknown>;
  const get = (k: string) => str(cd[k] ?? payload[k]);

  const eventType = get('event_type').toLowerCase();
  const clientName = get('client_name');
  const contactId = get('contact_id') || get('ghl_contact_id');
  const occurredAt = get('occurred_at') || new Date().toISOString();
  const when = new Date(occurredAt);
  if (Number.isNaN(when.getTime())) return NextResponse.json({ error: 'Bad occurred_at' }, { status: 400 });

  if (!['sms_sent', 'sms_reply'].includes(eventType)) {
    return NextResponse.json({ error: 'event_type must be sms_sent or sms_reply' }, { status: 400 });
  }
  if (!clientName) return NextResponse.json({ error: 'client_name is required' }, { status: 400 });

  const service = createServiceClient();
  const clientId = await resolveClientId(service, clientName);
  if (!clientId) {
    console.warn('[webhooks/sms] rejected: unknown client', JSON.stringify({ event_type: eventType, client_name: clientName }));
    return NextResponse.json({ error: `Client "${clientName}" not found` }, { status: 400 });
  }

  if (eventType === 'sms_sent') {
    const messages = Math.max(1, Math.round(Number(get('messages')) || 1));
    const day = when.toISOString().slice(0, 10);
    // Per contact: one row per contact per day. Per blast: one row per run.
    const externalId = get('external_id') || (contactId && messages === 1
      ? `sms:${clientId}:${contactId}:${day}`
      : `sms-blast:${clientId}:${when.toISOString()}`);
    const { error } = await service.from('sms_sends').upsert({
      client_id: clientId, sent_date: day, occurred_at: when.toISOString(), messages,
      external_id: externalId, ghl_contact_id: contactId || null, raw: payload,
    }, { onConflict: 'external_id' });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true, stored: 'sms_sent', messages });
  }

  // Positive reply = a lead on the SMS channel. Reuse the client webhook so
  // dedupe, zip handling, Setup→Live and everything else behave exactly as for
  // any other lead.
  const lead = {
    event_type: 'lead',
    client_id: clientId,
    occurred_at: when.toISOString(),
    ghl_contact_id: contactId || null,
    lead_name: [get('first_name'), get('last_name')].filter(Boolean).join(' ') || get('full_name') || get('lead_name') || null,
    lead_phone: get('phone') || get('lead_phone') || null,
    lead_email: get('email') || get('lead_email') || null,
    postal_code: get('postal_code') || get('zip') || null,
    utm_source: 'sms', ad_platform: 'sms', utm_medium: 'sms',
  };
  const res = await clientWebhook(new Request(new URL('/api/webhooks', req.url), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: req.headers.get('authorization') ?? '' },
    body: JSON.stringify(lead),
  }));
  const body = await res.json().catch(() => ({}));
  return NextResponse.json({ success: res.ok, stored: 'sms_reply', lead: body }, { status: res.ok ? 200 : res.status });
}
