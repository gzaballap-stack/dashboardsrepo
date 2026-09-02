import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { validateWebhookSecret } from '@/lib/api-auth';
import { pickAttribution, inheritAttribution } from '@/lib/attribution';
import { resolveClientId } from '@/lib/client-lookup';

const VALID_EVENT_TYPES = [
  'lead',
  'intro_booked', 'intro_shown',
  'sales_call_booked', 'sales_call_shown',
  'close',
  'call',
] as const;

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

    const attribution = await inheritAttribution(service, {
      table: 'b2b_events',
      ghl_contact_id: payload.ghl_contact_id ?? null,
      attr: pickAttribution(payload),
    });

    const eventData = {
      event_type:     payload.event_type,
      occurred_at:    payload.occurred_at || new Date().toISOString(),
      lead_name:      payload.lead_name   ?? null,
      lead_phone:     payload.lead_phone  ?? null,
      lead_email:     payload.lead_email  ?? null,
      ghl_contact_id: payload.ghl_contact_id ?? null,
      external_id:    payload.external_id ?? null,
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

      ...attribution,

      raw:            payload,
    };

    const { error } = payload.external_id
      ? await service.from('b2b_events').upsert(eventData, { onConflict: 'external_id' })
      : await service.from('b2b_events').insert(eventData);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
}
