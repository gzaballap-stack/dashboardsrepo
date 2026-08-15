import { NextResponse } from 'next/server';
import { getAuthContext, isAuthError } from '@/lib/api-auth';
import { getLiveClientIds, liveClientFilter } from '@/lib/db-helpers';

export async function GET(req: Request) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;

  const { searchParams } = new URL(req.url);
  const type = searchParams.get('type'); // leads | dials | appointments | speed_to_lead | ad_spend
  const client_id = searchParams.get('client_id');
  const live_only = searchParams.get('live_only') === 'true';
  const start_date = searchParams.get('start_date');
  const end_date = searchParams.get('end_date');
  const page = parseInt(searchParams.get('page') ?? '1');
  const limit = 100;
  const offset = (page - 1) * limit;

  if (!type) return NextResponse.json({ error: 'type is required' }, { status: 400 });

  let liveClientIds: string[] | null = null;
  if (live_only && !client_id) {
    liveClientIds = await getLiveClientIds(ctx.service);
  }

  if (type === 'ad_spend') {
    let q = ctx.service
      .from('ad_spend')
      .select('id, spend_date, platform, amount, clients(name)', { count: 'exact' })
      .order('spend_date', { ascending: false })
      .range(offset, offset + limit - 1);

    if (client_id) q = q.eq('client_id', client_id);
    else if (liveClientIds) q = q.in('client_id', liveClientFilter(liveClientIds));
    if (start_date) q = q.gte('spend_date', start_date);
    if (end_date)   q = q.lte('spend_date', end_date);

    const { data, error, count } = await q;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ rows: data, total: count });
  }

  const eventTypeMap: Record<string, string[]> = {
    leads:          ['lead'],
    dials:          ['dial'],
    appointments:   ['appointment_booked', 'show', 'no_show', 'callback_booked'],
    speed_to_lead:  ['dial'],
  };

  const eventTypes = eventTypeMap[type];
  if (!eventTypes) return NextResponse.json({ error: 'Invalid type' }, { status: 400 });

  let q = ctx.service
    .from('events')
    .select('id, event_type, occurred_at, duration_seconds, is_pickup, is_conversation, speed_to_lead_seconds, lead_name, lead_phone, lead_email, agent_name, direction, call_status, recording_url, phone_number_used, calendar_name, stage_booked, scheduled_at, clients(name)', { count: 'exact' })
    .in('event_type', eventTypes)
    .order('occurred_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (client_id) q = q.eq('client_id', client_id);
  else if (liveClientIds) q = q.in('client_id', liveClientFilter(liveClientIds));
  if (start_date) q = q.gte('occurred_at', `${start_date}T00:00:00.000Z`);
  if (end_date)   q = q.lte('occurred_at', `${end_date}T23:59:59.999Z`);

  if (type === 'speed_to_lead') q = q.not('speed_to_lead_seconds', 'is', null);

  const { data, error, count } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rows: data, total: count });
}
