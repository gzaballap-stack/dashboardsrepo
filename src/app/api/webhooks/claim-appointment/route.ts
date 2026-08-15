import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { validateWebhookSecret } from '@/lib/api-auth';

// Called by Make when an agent claims an appointment via the agent form.
// Looks up agent name by phone in the agents table, then assigns it to the most
// recent appointment_booked or callback_booked event for that lead.
// Body: { lead_phone: string, agent_phone: string }
export async function POST(req: Request) {
  try {
    if (!validateWebhookSecret(req)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { lead_phone, agent_phone } = await req.json();

    if (!lead_phone) {
      return NextResponse.json({ error: 'lead_phone is required' }, { status: 400 });
    }
    if (!agent_phone) {
      return NextResponse.json({ error: 'agent_phone is required' }, { status: 400 });
    }

    const service = createServiceClient();

    // Resolve agent name from phone
    const { data: agent } = await service
      .from('agents')
      .select('name')
      .eq('phone', agent_phone.trim())
      .single();

    if (!agent) {
      return NextResponse.json(
        { error: `No agent found with phone "${agent_phone}"` },
        { status: 404 }
      );
    }

    // Find most recent appointment or callback for this lead
    const { data: event, error: findError } = await service
      .from('events')
      .select('id')
      .eq('lead_phone', lead_phone)
      .in('event_type', ['appointment_booked', 'callback_booked'])
      .order('occurred_at', { ascending: false })
      .limit(1)
      .single();

    if (findError || !event) {
      return NextResponse.json(
        { error: `No appointment or callback found for phone "${lead_phone}"` },
        { status: 404 }
      );
    }

    const { error: updateError } = await service
      .from('events')
      .update({ agent_name: agent.name })
      .eq('id', event.id);

    if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 });

    return NextResponse.json({ success: true, updated_id: event.id, agent_name: agent.name });
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
}
