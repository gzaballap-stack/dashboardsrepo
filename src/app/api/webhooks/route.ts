import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { validateWebhookSecret } from '@/lib/api-auth';
import { pickAttribution, inheritAttribution, inheritZip } from '@/lib/attribution';
import { normalizeZip } from '@/lib/zip-rollup';
import { resolveClientId } from '@/lib/client-lookup';

const VALID_EVENT_TYPES = ['dial', 'lead', 'appointment_booked', 'show', 'no_show', 'callback_booked', 'closed'] as const;

export async function POST(req: Request) {
  try {
    if (!validateWebhookSecret(req)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payload = await req.json();
    const service = createServiceClient();

    if (!VALID_EVENT_TYPES.includes(payload.event_type)) {
      return NextResponse.json(
        { error: `Invalid event_type. Must be one of: ${VALID_EVENT_TYPES.join(', ')}` },
        { status: 400 }
      );
    }

    // Resolve client_id by name or id
    let client_id = payload.client_id as string | undefined;

    if (!client_id && payload.client_name) {
      const resolved = await resolveClientId(service, payload.client_name);
      if (!resolved) {
        // Make records a rejection as a successful run, so a dropped event is
        // invisible unless we say so here.
        console.warn('[webhooks] rejected: unknown client', JSON.stringify({
          event_type: payload.event_type,
          client_name: payload.client_name,
          keys: Object.keys(payload),
        }));
        return NextResponse.json({ error: `Client "${payload.client_name}" not found` }, { status: 400 });
      }
      client_id = resolved;
    }

    if (!client_id) {
      console.warn('[webhooks] rejected: no client on payload', JSON.stringify({
        event_type: payload.event_type,
        client_name: payload.client_name ?? null,
        keys: Object.keys(payload),
      }));
      return NextResponse.json({ error: 'client_id or client_name is required' }, { status: 400 });
    }

    // Auto-compute speed_to_lead_seconds on the first dial to a contact
    let speed_to_lead_seconds = payload.speed_to_lead_seconds ?? null;
    if (
      payload.event_type === 'dial' &&
      speed_to_lead_seconds === null &&
      payload.ghl_contact_id
    ) {
      const [{ data: priorDial }, { data: leadEvent }] = await Promise.all([
        service
          .from('events')
          .select('id')
          .eq('client_id', client_id)
          .eq('event_type', 'dial')
          .eq('ghl_contact_id', payload.ghl_contact_id)
          .limit(1)
          .maybeSingle(),
        service
          .from('events')
          .select('occurred_at')
          .eq('client_id', client_id)
          .eq('event_type', 'lead')
          .eq('ghl_contact_id', payload.ghl_contact_id)
          .order('occurred_at', { ascending: true })
          .limit(1)
          .maybeSingle(),
      ]);

      // Only set on first dial, and only when we have a lead event to measure from
      if (!priorDial && leadEvent) {
        const dialMs = new Date(payload.occurred_at ?? new Date().toISOString()).getTime();
        const leadMs = new Date(leadEvent.occurred_at).getTime();
        if (dialMs > leadMs) speed_to_lead_seconds = Math.floor((dialMs - leadMs) / 1000);
      }
    }

    // Lead zip: whatever this event carries, else the contact's first known zip.
    // Drives the per-zip performance rollup in the Zip Tool.
    const zip_code = await inheritZip(service, {
      client_id,
      ghl_contact_id: payload.ghl_contact_id ?? null,
      zip: normalizeZip(
        payload.zip_code ?? payload.postal_code ?? payload.postalCode ??
        payload.contact?.postalCode ?? payload.contact?.postal_code ?? null
      ),
    });

    // Ad attribution: use what this event carries, else inherit from the
    // contact's first attributed event (see lib/attribution).
    const attribution = await inheritAttribution(service, {
      table: 'events',
      client_id,
      ghl_contact_id: payload.ghl_contact_id ?? null,
      attr: pickAttribution(payload),
    });

    const eventData = {
      client_id,
      event_type: payload.event_type,
      occurred_at: payload.occurred_at || new Date().toISOString(),
      duration_seconds: payload.duration_seconds ?? null,
      is_pickup: payload.is_pickup ?? null,
      is_conversation: payload.is_conversation ?? null,
      speed_to_lead_seconds,
      ghl_contact_id: payload.ghl_contact_id ?? null,
      scheduled_at: payload.scheduled_at ?? null,
      external_id: payload.external_id ?? null,
      calendar_name: payload.calendar_name ?? null,
      lead_name: payload.lead_name ?? null,
      lead_phone: payload.lead_phone ?? null,
      lead_email: payload.lead_email ?? null,
      agent_name: payload.agent_name ?? null,
      direction: payload.direction ?? null,
      call_status: payload.call_status ?? null,
      recording_url: payload.recording_url ?? null,
      call_summary: payload.call_summary ?? null,
      phone_number_used: payload.phone_number_used ?? null,
      stage_booked: payload.stage_booked ?? null,
      revenue: Number(payload.revenue) || 0,
      zip_code,

      ...attribution,

      raw: payload,
    };

    // Upsert on external_id when provided so rescheduled appointments don't duplicate
    const write = (row: typeof eventData | Omit<typeof eventData, 'zip_code'>) =>
      payload.external_id
        ? service.from('events').upsert(row, { onConflict: 'external_id' })
        : service.from('events').insert(row);

    let { error } = await write(eventData);

    // A database that hasn't had the zip migration applied yet rejects the column
    // outright. Retry without it rather than dropping the event on the floor.
    if (error && /zip_code/.test(error.message)) {
      const { zip_code: _zip, ...withoutZip } = eventData;
      ({ error } = await write(withoutZip));
    }

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
}
