import { NextResponse } from 'next/server';
import { getAuthContext, isAuthError } from '@/lib/api-auth';

export async function GET() {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;

  const [{ data: clients, error: clientError }, { data: recentEvents, error: eventsError }] =
    await Promise.all([
      ctx.service.from('clients').select('id, name').eq('is_live', true),
      // Single query for latest appointment per client — avoids one query per client
      ctx.service
        .from('events')
        .select('client_id, occurred_at')
        .in('event_type', ['appointment_booked', 'callback_booked'])
        .order('occurred_at', { ascending: false }),
    ]);

  if (clientError) return NextResponse.json({ error: clientError.message }, { status: 500 });
  if (eventsError) return NextResponse.json({ error: eventsError.message }, { status: 500 });

  // Build map of client_id -> most recent appointment date (first occurrence wins, list is DESC)
  const latestByClient = new Map<string, string>();
  for (const row of recentEvents ?? []) {
    if (!latestByClient.has(row.client_id)) {
      latestByClient.set(row.client_id, row.occurred_at);
    }
  }

  const results = (clients ?? []).map(client => {
    const lastBookedAt = latestByClient.get(client.id) ?? null;
    const daysSince = lastBookedAt
      ? Math.floor((Date.now() - new Date(lastBookedAt).getTime()) / 86400000)
      : null;
    return {
      client_id: client.id,
      client_name: client.name,
      last_booked_at: lastBookedAt,
      days_since_booking: daysSince,
      is_stale: daysSince === null || daysSince >= 3,
    };
  });

  return NextResponse.json({ alerts: results.filter(r => r.is_stale), all: results });
}
