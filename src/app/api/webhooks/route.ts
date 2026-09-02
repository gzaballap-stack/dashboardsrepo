import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { validateWebhookSecret } from '@/lib/api-auth';
import { pickAttribution, inheritAttribution } from '@/lib/attribution';
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
        return NextResponse.json({ error: `Client "${payload.client_name}" not found` }, { status: 400 });
      }
      client_id = resolved;
    }

    if (!client_id) {
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

      ...attribution,

      raw: payload,
    };

    // Upsert on external_id when provided so rescheduled appointments don't duplicate
    const { error } = payload.external_id
      ? await service.from('events').upsert(eventData, { onConflict: 'external_id' })
      : await service.from('events').insert(eventData);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
}
