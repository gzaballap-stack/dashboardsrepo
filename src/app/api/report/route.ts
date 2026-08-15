import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { calculateMetrics } from '@/lib/metrics';

// Public endpoint — authenticated by share_token, no user session required.
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get('token');
  const start_date = searchParams.get('start_date');
  const end_date = searchParams.get('end_date');

  if (!token) return NextResponse.json({ error: 'token is required' }, { status: 400 });

  const service = createServiceClient();

  const { data: client } = await service
    .from('clients')
    .select('id, name')
    .eq('share_token', token)
    .single();

  if (!client) return NextResponse.json({ error: 'Invalid token' }, { status: 404 });

  let eventsQuery = service
    .from('events')
    .select('event_type, is_pickup, is_conversation, speed_to_lead_seconds')
    .eq('client_id', client.id);

  if (start_date) eventsQuery = eventsQuery.gte('occurred_at', `${start_date}T00:00:00.000Z`);
  if (end_date)   eventsQuery = eventsQuery.lte('occurred_at', `${end_date}T23:59:59.999Z`);

  let spendQuery = service.from('ad_spend').select('amount').eq('client_id', client.id);
  if (start_date) spendQuery = spendQuery.gte('spend_date', start_date);
  if (end_date)   spendQuery = spendQuery.lte('spend_date', end_date);

  const [{ data: events }, { data: spendRows }] = await Promise.all([eventsQuery, spendQuery]);

  return NextResponse.json({
    client_name: client.name,
    ...calculateMetrics(events ?? [], spendRows ?? []),
  });
}
