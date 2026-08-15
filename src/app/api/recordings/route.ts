import { NextResponse } from 'next/server';
import { getAuthContext, isAuthError } from '@/lib/api-auth';

export async function GET(req: Request) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;

  const { searchParams } = new URL(req.url);
  const clientId  = searchParams.get('clientId');
  const agentName = searchParams.get('agentName');
  const outcome   = searchParams.get('outcome'); // 'pickup' | 'conversation' | 'all'
  const startDate = searchParams.get('startDate');
  const endDate   = searchParams.get('endDate');
  const page      = Math.max(1, Number(searchParams.get('page') ?? 1));
  const pageSize  = 50;

  let query = ctx.service
    .from('events')
    .select('id, occurred_at, lead_name, lead_phone, agent_name, duration_seconds, is_pickup, is_conversation, call_status, recording_url, clients(name)', { count: 'exact' })
    .eq('event_type', 'dial')
    .not('recording_url', 'is', null)
    .order('occurred_at', { ascending: false })
    .range((page - 1) * pageSize, page * pageSize - 1);

  if (clientId)  query = query.eq('client_id', clientId);
  if (agentName) query = query.eq('agent_name', agentName);
  if (startDate) query = query.gte('occurred_at', `${startDate}T00:00:00.000Z`);
  if (endDate)   query = query.lte('occurred_at', `${endDate}T23:59:59.999Z`);
  if (outcome === 'conversation') query = query.eq('is_conversation', true);
  else if (outcome === 'pickup')  query = query.eq('is_pickup', true);

  const { data, count, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rows: data, total: count ?? 0 });
}
