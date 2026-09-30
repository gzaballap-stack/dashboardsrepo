import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { validateWebhookSecret } from '@/lib/api-auth';
import { pickAttribution, inheritAttribution, hasAttribution } from '@/lib/attribution';
import { fetchGhlAttribution } from '@/lib/ghl-attribution';
import { getTomsiClientId } from '@/lib/tomsi';
import { ensureLeadForContact, removeSyntheticLead } from '@/lib/funnel-integrity';
import { resolveClientId } from '@/lib/client-lookup';

const VALID_EVENT_TYPES = [
  'lead',
  'intro_booked', 'intro_shown',
  'sales_call_booked', 'sales_call_shown',
  'close',
  'call',
  'funnel_visit', 'vsl_watch', 'precall_watch',
  'visit_landing', 'visit_calendar', 'visit_thankyou',
  'spam', 'spam_lead', 'spam_appointment',
] as const;

// A fake / funnel-hacker contact: flip everything it produced to the spam
// states in both tables. Nothing is deleted, nothing counts. If the contact has
// no rows yet, record one spam lead so the fake still shows in the spam tally.
async function markSpam(service: ReturnType<typeof createServiceClient>, payload: Record<string, unknown>) {
  const cid = (payload.ghl_contact_id as string | undefined) || null;
  if (!cid) return NextResponse.json({ error: 'ghl_contact_id is required to mark spam' }, { status: 400 });
  const tomsiId = await getTomsiClientId(service);
  const flip = async (table: 'events' | 'b2b_events', from: string[], to: string, clientId?: string | null) => {
    let q = service.from(table).update({ event_type: to }).eq('ghl_contact_id', cid).in('event_type', from);
    if (clientId) q = q.eq('client_id', clientId);
    const { data } = await q.select('id');
    return data?.length ?? 0;
  };
  const b2bLeads = await flip('b2b_events', ['lead'], 'spam_lead');
  const b2bAppts = await flip('b2b_events', ['sales_call_booked', 'sales_call_shown'], 'spam_appointment');
  let mirLeads = 0, mirAppts = 0;
  if (tomsiId) {
    mirLeads = await flip('events', ['lead'], 'spam_lead', tomsiId);
    mirAppts = await flip('events', ['appointment_booked', 'show', 'no_show'], 'spam_appointment', tomsiId);
  }
  if (b2bLeads + b2bAppts === 0) {
    const row = { event_type: 'spam_lead', occurred_at: new Date().toISOString(), ghl_contact_id: cid,
      lead_name: (payload.lead_name as string) ?? null, lead_email: (payload.lead_email as string) ?? null, revenue: 0, raw: payload };
    await service.from('b2b_events').insert(row);
    if (tomsiId) await service.from('events').insert({ ...row, client_id: tomsiId });
  }
  return NextResponse.json({ success: true, spam: { b2b_leads: b2bLeads, b2b_appointments: b2bAppts, mirror_leads: mirLeads, mirror_appointments: mirAppts } });
}

export async function POST(req: Request) {
  try {
    if (!validateWebhookSecret(req)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payload = await req.json();
    const service = createServiceClient();

    // A direct GHL webhook nests its custom fields under customData; lift them
    // to the top level when the top-level key is absent.
    if (payload.customData && typeof payload.customData === 'object') {
      for (const [k, v] of Object.entries(payload.customData as Record<string, unknown>)) {
        if (payload[k] === undefined || payload[k] === '') payload[k] = v;
      }
    }
    if (payload.event_type === 'spam') return markSpam(service, payload);

    // B2B is a one-call process: the old "intro" stage is gone. Any booking that
    // still arrives tagged as an intro is treated as the demo (sales call).
    if (payload.event_type === 'intro_booked') payload.event_type = 'sales_call_booked';
    if (payload.event_type === 'intro_shown')  payload.event_type = 'sales_call_shown';

    if (!VALID_EVENT_TYPES.includes(payload.event_type)) {
      return NextResponse.json(
        { error: `Invalid event_type. Must be one of: ${VALID_EVENT_TYPES.join(', ')}` },
        { status: 400 }
      );
    }

    const revenue = parseFloat(payload.revenue) || 0;

    // A B2B call can name an existing client, which is what pulls the
    // conversation onto that client's CSM history. Unresolvable names are left
    // null rather than rejected — the call still belongs in the CSM list, just
    // grouped under the lead name instead.
    let client_id = (payload.client_id as string | undefined) ?? null;
    if (!client_id && payload.client_name) {
      client_id = await resolveClientId(service, payload.client_name);
    }

    const duration = payload.duration_seconds !== undefined && payload.duration_seconds !== null
      ? Number(payload.duration_seconds)
      : null;

    let attribution = await inheritAttribution(service, {
      table: 'b2b_events',
      ghl_contact_id: payload.ghl_contact_id ?? null,
      attr: pickAttribution(payload),
    });
    // Live attribution: when nothing is known for this contact yet (first touch,
    // or a lead the webhook never saw), read it from the Tomsi GHL sub-account
    // right now instead of waiting for a batch pull. Best-effort and bounded —
    // a slow or failing GHL must never delay or fail the booking itself; the
    // row simply lands unattributed and the next pull fills it.
    const b2bKey = process.env.GHL_API_KEY_B2B;
    if (b2bKey && payload.ghl_contact_id && !hasAttribution(attribution)) {
      try {
        const live = await Promise.race([
          fetchGhlAttribution(String(payload.ghl_contact_id), b2bKey),
          new Promise<null>(resolve => setTimeout(() => resolve(null), 4000)),
        ]);
        if (live && live.ok && hasAttribution(live.attribution)) attribution = live.attribution;
      } catch { /* attribution is secondary */ }
    }

    // A contact already flagged as fake stays fake: anything new it produces is
    // stored straight into the spam states rather than the real funnel.
    if (payload.ghl_contact_id && ['lead', 'sales_call_booked', 'sales_call_shown'].includes(payload.event_type)) {
      const { data: flagged } = await service.from('b2b_events').select('id').eq('ghl_contact_id', payload.ghl_contact_id).in('event_type', ['spam_lead', 'spam_appointment']).limit(1);
      if (flagged?.length) payload.event_type = payload.event_type === 'lead' ? 'spam_lead' : 'spam_appointment';
    }

    const eventData = {
      event_type:     payload.event_type,
      occurred_at:    payload.occurred_at || new Date().toISOString(),
      lead_name:      payload.lead_name   ?? null,
      lead_phone:     payload.lead_phone  ?? null,
      lead_email:     payload.lead_email  ?? null,
      ghl_contact_id: payload.ghl_contact_id ?? null,
      external_id:    payload.external_id || null,   // '' from GHL must be NULL, not a collidable key
      revenue,
      client_id,
      csm_name:         payload.csm_name       ?? null,
      agent_name:       payload.agent_name     ?? null,
      recording_url:    payload.recording_url  ?? null,
      duration_seconds: Number.isFinite(duration) ? duration : null,
      call_status:      payload.call_status    ?? null,
      call_summary:     payload.call_summary   ?? null,
      is_pickup:        payload.is_pickup       ?? null,
      is_conversation:  payload.is_conversation ?? null,
      progress_pct:     payload.progress_pct != null ? Number(payload.progress_pct) : null,
      // 'self'/'client' = the lead booked through the calendar link; 'team' = we booked it.
      booked_by:        (() => {
        const v = String(payload.booked_by||'').toLowerCase();
        if (v === 'client' || v === 'self') return 'self';
        if (v === 'team') return 'team';
        return null;
      })(),

      ...attribution,

      raw:            payload,
    };

    // One lead per contact — GHL can fire New Lead twice. A lead has no
    // external_id, so dedupe on the contact.
    if (payload.event_type === 'lead' && payload.ghl_contact_id) {
      const { data: dupe } = await service
        .from('b2b_events').select('id')
        .eq('event_type', 'lead').eq('ghl_contact_id', payload.ghl_contact_id).limit(1);
      if (dupe && dupe.length) return NextResponse.json({ success: true, deduped: true });
    }

    // A demo shows once. GHL re-fires "shown" (bulk status edits, re-runs), and
    // the shown event carries no appointment id — so a repeat is recognised by
    // the contact: it already has a shown demo and no newer booking since.
    if (payload.event_type === 'sales_call_shown' && payload.ghl_contact_id) {
      const { data: hist } = await service.from('b2b_events').select('event_type, occurred_at')
        .eq('ghl_contact_id', payload.ghl_contact_id).in('event_type', ['sales_call_booked', 'sales_call_shown'])
        .order('occurred_at', { ascending: false }).limit(1);
      if (hist?.[0]?.event_type === 'sales_call_shown') return NextResponse.json({ success: true, deduped: true });
    }

    const { error } = (payload.external_id || null)
      ? await service.from('b2b_events').upsert(eventData, { onConflict: 'external_id' })
      : await service.from('b2b_events').insert(eventData);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Mirror into the client-side events table under the internal "Tomsi Media"
    // client, so every client dashboard view (KPIs, raw data, heat maps, goals)
    // works for B2B unchanged. Best-effort: never fails the B2B write.
    try {
      const tomsiId = await getTomsiClientId(service);
      const MIRROR: Record<string, string> = {
        lead: 'lead', sales_call_booked: 'appointment_booked', sales_call_shown: 'show', close: 'closed', call: 'dial',
        funnel_visit: 'funnel_visit', vsl_watch: 'vsl_watch', precall_watch: 'precall_watch',
        visit_landing: 'visit_landing', visit_calendar: 'visit_calendar', visit_thankyou: 'visit_thankyou',
        spam_lead: 'spam_lead', spam_appointment: 'spam_appointment',
      };
      const mirrored = MIRROR[payload.event_type];
      if (tomsiId && mirrored) {
        const extId = (payload.external_id || null) as string | null;
        const row = {
          client_id: tomsiId, event_type: mirrored, occurred_at: eventData.occurred_at,
          ghl_contact_id: eventData.ghl_contact_id, external_id: extId,
          lead_name: eventData.lead_name, lead_phone: eventData.lead_phone, lead_email: eventData.lead_email,
          agent_name: eventData.agent_name, duration_seconds: eventData.duration_seconds,
          is_pickup: eventData.is_pickup, is_conversation: eventData.is_conversation,
          call_status: eventData.call_status, progress_pct: eventData.progress_pct, revenue, ...attribution, raw: payload,
        };
        if (mirrored === 'show') {
          // A demo that showed is the booked appointment changing state, as on
          // the client side. Match the appointment id when GHL sends one; the
          // shown workflow usually doesn't, so fall back to the contact's latest
          // booking (a no-show corrected to a show flips too). Already a show →
          // nothing to do, never a second row.
          let flipped = 0;
          if (extId) {
            const { data } = await service.from('events').update({ event_type: 'show' })
              .eq('external_id', extId).eq('client_id', tomsiId).select('id');
            flipped = data?.length ?? 0;
          }
          if (!flipped && eventData.ghl_contact_id) {
            const { data: latest } = await service.from('events').select('id, event_type')
              .eq('client_id', tomsiId).eq('ghl_contact_id', eventData.ghl_contact_id)
              .in('event_type', ['appointment_booked', 'no_show', 'show'])
              .order('occurred_at', { ascending: false }).limit(1);
            const cur = latest?.[0];
            if (cur?.event_type === 'show') flipped = 1;
            else if (cur) {
              const { data } = await service.from('events').update({ event_type: 'show' }).eq('id', cur.id).select('id');
              flipped = data?.length ?? 0;
            }
          }
          if (!flipped) await service.from('events').insert(row);
        } else if (extId) {
          await service.from('events').upsert(row, { onConflict: 'external_id' });
        } else {
          await service.from('events').insert(row);
        }
        if (mirrored === 'lead') await removeSyntheticLead(service, tomsiId, eventData.ghl_contact_id);
        else if (!mirrored.startsWith('spam_')) await ensureLeadForContact(service, {
          client_id: tomsiId, ghl_contact_id: eventData.ghl_contact_id, event_type: mirrored,
          occurred_at: eventData.occurred_at, lead_name: eventData.lead_name,
          lead_phone: eventData.lead_phone, lead_email: eventData.lead_email, attribution,
        });
      }
    } catch { /* mirroring is secondary */ }

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
}
