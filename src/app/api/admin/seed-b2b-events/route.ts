import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { validateWebhookSecret } from '@/lib/api-auth';

// Accepts: { events: [{ date: "YYYY-MM-DD", event_type: string, count: number, revenue?: number }] }
// Inserts `count` rows per entry into b2b_events with occurred_at = noon UTC on that date.

const VALID_TYPES = ['lead', 'intro_booked', 'intro_shown', 'sales_call_booked', 'sales_call_shown', 'close'];

export async function POST(req: Request) {
  if (!validateWebhookSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body?.events || !Array.isArray(body.events)) {
    return NextResponse.json({ error: 'Provide { events: [{ date, event_type, count }] }' }, { status: 400 });
  }

  const service = createServiceClient();
  const rows: { event_type: string; occurred_at: string; revenue: number | null }[] = [];

  for (const entry of body.events) {
    const { date, event_type, count, revenue } = entry;
    if (!VALID_TYPES.includes(event_type)) {
      return NextResponse.json({ error: `Invalid event_type: ${event_type}` }, { status: 400 });
    }
    const n = Math.max(0, Math.round(count ?? 0));
    for (let i = 0; i < n; i++) {
      rows.push({
        event_type,
        occurred_at: `${date}T12:00:00.000Z`,
        revenue: revenue ?? 0,
      });
    }
  }

  if (rows.length === 0) return NextResponse.json({ success: true, inserted: 0 });

  const { error } = await service.from('b2b_events').insert(rows);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ success: true, inserted: rows.length });
}
