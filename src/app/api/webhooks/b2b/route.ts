import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { validateWebhookSecret } from '@/lib/api-auth';

const VALID_EVENT_TYPES = [
  'lead',
  'intro_booked', 'intro_shown',
  'sales_call_booked', 'sales_call_shown',
  'close',
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

    const eventData = {
      event_type:     payload.event_type,
      occurred_at:    payload.occurred_at || new Date().toISOString(),
      lead_name:      payload.lead_name   ?? null,
      lead_phone:     payload.lead_phone  ?? null,
      lead_email:     payload.lead_email  ?? null,
      ghl_contact_id: payload.ghl_contact_id ?? null,
      external_id:    payload.external_id ?? null,
      revenue,
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
