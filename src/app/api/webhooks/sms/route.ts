import { createHash } from 'node:crypto';
import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { validateWebhookSecret } from '@/lib/api-auth';
import { resolveClientId } from '@/lib/client-lookup';
import { POST as clientWebhook } from '@/app/api/webhooks/route';
import { POST as b2bWebhook } from '@/app/api/webhooks/b2b/route';
import { getTomsiClientId } from '@/lib/tomsi';
import {
  anthropicClient, classifySmsReply, tagGhlContact, smsGhlKey, b2bSmsGhlKey,
  SMS_INTENT_TAGS, type SmsIntent, type SmsClassification,
} from '@/lib/sms-intent';

// SMS service line — posted STRAIGHT from GHL's Webhook action (no Make).
//
// GHL sends its standard contact payload plus whatever is set as Custom Data.
// Custom data the workflow must carry:
//   event_type   sms_sent     (the blast workflow)
//                sms_reply    (a reply a human already judged positive — legacy)
//                sms_inbound  (EVERY reply — the app reads it, tags the contact
//                              in GHL and creates the lead itself if interested)
//   client_name  the client exactly as on the Client Roster
//   messages     optional, blast workflow only — how many messages this run sent
//                (omit when the workflow fires once per contact: that's 1 message)
//   message      sms_inbound only — the reply text ({{message.body}})
//   outbound_message  optional, sms_inbound — the text we sent, for context
//   message_id   optional, sms_inbound — dedupes a re-fired webhook
//   dry_run      optional, sms_inbound — "true" classifies without storing or tagging
// Header: Authorization: Bearer <ADMIN_WEBHOOK_SECRET>
//
// sms_sent    → one row in sms_sends (deduped so a re-fired webhook can't double count).
// sms_reply   → a normal `lead` for that client, tagged utm_source / ad_platform = "sms",
//               so bookings, shows and closes that follow inherit the SMS channel.
// sms_inbound → Claude classifies the reply (src/lib/sms-intent.ts), the row goes in
//               sms_replies, the contact gets one `sms-<intent>` tag in GHL (the GHL
//               workflows keyed on those tags send the follow-up), and an
//               `interested` reply becomes the same lead sms_reply would create.
//
// client_name = "Tomsi Media" is the B2B SMS acquisition system: SMS sent is
// stored the same way, but a positive reply goes through the B2B webhook (a
// `lead` in b2b_events, mirrored under the internal client) with the SMS
// channel on it, the reply is read with the B2B prompt, and the contact is
// tagged in the Tomsi sub-account (GHL_API_KEY_B2B). The B2B Dashboard's
// Ads / SMS switch then splits on that channel.

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

  if (!['sms_sent', 'sms_reply', 'sms_inbound'].includes(eventType)) {
    return NextResponse.json({ error: 'event_type must be sms_sent, sms_reply or sms_inbound' }, { status: 400 });
  }
  if (!clientName) return NextResponse.json({ error: 'client_name is required' }, { status: 400 });

  const service = createServiceClient();
  const clientId = await resolveClientId(service, clientName);
  if (!clientId) {
    console.warn('[webhooks/sms] rejected: unknown client', JSON.stringify({ event_type: eventType, client_name: clientName }));
    return NextResponse.json({ error: `Client "${clientName}" not found` }, { status: 400 });
  }
  const isTomsi = clientId === (await getTomsiClientId(service));

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

  const contact = {
    ghl_contact_id: contactId || null,
    lead_name: [get('first_name'), get('last_name')].filter(Boolean).join(' ') || get('full_name') || get('lead_name') || null,
    lead_phone: get('phone') || get('lead_phone') || null,
    lead_email: get('email') || get('lead_email') || null,
    postal_code: get('postal_code') || get('zip') || null,
  };

  // Positive reply = a lead on the SMS channel. Reuse the client webhook so
  // dedupe, zip handling, Setup→Live and everything else behave exactly as for
  // any other lead.
  //
  // Tomsi Media's own replies are B2B leads: the B2B webhook writes b2b_events
  // and mirrors the row under the internal client, so both the B2B Dashboard
  // (SMS channel) and the demo booked later (which inherits the channel) line up.
  const createLead = async () => {
    const lead = {
      event_type: 'lead', client_id: clientId, occurred_at: when.toISOString(), ...contact,
      utm_source: 'sms', ad_platform: 'sms', utm_medium: 'sms',
    };
    const path = isTomsi ? '/api/webhooks/b2b' : '/api/webhooks';
    const res = await (isTomsi ? b2bWebhook : clientWebhook)(new Request(new URL(path, req.url), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: req.headers.get('authorization') ?? '' },
      body: JSON.stringify(lead),
    }));
    return { ok: res.ok, status: res.status, body: await res.json().catch(() => ({})) };
  };

  if (eventType === 'sms_reply') {
    const lead = await createLead();
    return NextResponse.json({ success: lead.ok, stored: 'sms_reply', lead: lead.body }, { status: lead.ok ? 200 : lead.status });
  }

  // ── sms_inbound: read the reply, tag the contact, create the lead if interested ──
  const message = messageText(payload, cd);
  if (!message) return NextResponse.json({ error: 'message is required for sms_inbound (custom data message = {{message.body}})' }, { status: 400 });
  const dryRun = /^(true|1|yes)$/i.test(get('dry_run'));

  const ai = anthropicClient();
  if (!ai) return NextResponse.json({ error: 'ANTHROPIC_API_KEY is not set — add it in Railway to classify SMS replies' }, { status: 503 });

  const day = when.toISOString().slice(0, 10);
  const externalId = get('message_id')
    ? `sms-in:${clientId}:${get('message_id')}`
    : `sms-in:${clientId}:${contactId || contact.lead_phone || 'anon'}:${createHash('sha1').update(message).digest('hex').slice(0, 16)}:${day}`;

  if (!dryRun) {
    const { data: seen } = await service.from('sms_replies').select('id, intent').eq('external_id', externalId).limit(1);
    if (seen && seen.length) return NextResponse.json({ success: true, stored: 'sms_inbound', deduped: true, intent: seen[0].intent });
  }

  let intent: SmsIntent;
  let result: SmsClassification | null = null;
  let classifierError: string | null = null;
  try {
    result = await classifySmsReply(ai, message, { outboundMessage: get('outbound_message') || null, clientName, audience: isTomsi ? 'b2b' : 'b2c' });
    intent = result.intent;
  } catch (e) {
    classifierError = (e as Error).message;
    intent = 'needs_review';
    console.error('[webhooks/sms] classifier failed', classifierError);
  }
  const needsReview = intent === 'needs_review' || (result ? result.confidence < 0.5 : false);

  if (dryRun) {
    return NextResponse.json({
      success: true, dry_run: true, intent, tag: SMS_INTENT_TAGS[intent], needs_review: needsReview,
      confidence: result?.confidence ?? null, reason: result?.reason ?? classifierError, suggested_reply: result?.suggested_reply ?? null,
    });
  }

  // Tag in GHL. The tag is what drives the reply workflows, so a failure here is
  // reported, not swallowed — but the row is still stored below.
  let tagged = false;
  let tagError: string | null = null;
  const key = isTomsi ? b2bSmsGhlKey() : smsGhlKey();
  if (!key) tagError = isTomsi ? 'GHL_API_KEY_B2B is not set' : 'GHL_API_KEY_SMS is not set';
  else if (!contactId) tagError = 'no contact_id in payload';
  else {
    try { await tagGhlContact(key, contactId, intent, { needsReview }); tagged = true; }
    catch (e) { tagError = (e as Error).message; console.error('[webhooks/sms] tagging failed', tagError); }
  }

  let lead: { ok: boolean; status: number; body: unknown } | null = null;
  if (intent === 'interested') lead = await createLead();

  const row = {
    client_id: clientId, external_id: externalId, occurred_at: when.toISOString(),
    ghl_contact_id: contact.ghl_contact_id, lead_name: contact.lead_name, lead_phone: contact.lead_phone,
    message, outbound_message: get('outbound_message') || null,
    intent, confidence: result?.confidence ?? null, reason: result?.reason ?? classifierError,
    suggested_reply: result?.suggested_reply ?? null,
    tag: SMS_INTENT_TAGS[intent], tagged, tag_error: tagError,
    lead_created: !!lead?.ok, needs_review: needsReview, raw: payload,
  };
  const { error } = await service.from('sms_replies').upsert(row, { onConflict: 'external_id' });
  if (error) console.error('[webhooks/sms] sms_replies write failed', error.message);

  return NextResponse.json({
    success: !classifierError && !tagError && !error,
    stored: 'sms_inbound', intent, tag: row.tag, tagged, tag_error: tagError, needs_review: needsReview,
    confidence: row.confidence, lead_created: row.lead_created, suggested_reply: row.suggested_reply,
    ...(classifierError ? { classifier_error: classifierError } : {}),
    ...(error ? { store_error: error.message } : {}),
  });
}

/** The reply text: custom data `message` (= {{message.body}}), or GHL's own message object. */
function messageText(payload: Payload, cd: Record<string, unknown>): string {
  for (const k of ['message', 'message_body', 'body', 'Message', 'reply']) {
    const v = cd[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  const m = payload.message;
  if (typeof m === 'string' && m.trim()) return m.trim();
  if (m && typeof m === 'object' && typeof (m as { body?: unknown }).body === 'string') return str((m as { body: string }).body);
  return str(payload.body);
}
