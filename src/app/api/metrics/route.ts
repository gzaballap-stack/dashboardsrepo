import { NextResponse } from 'next/server';
import { getAuthContext, isAuthError } from '@/lib/api-auth';
import { calculateMetrics } from '@/lib/metrics';
import { getLiveClientIds, liveClientFilter } from '@/lib/db-helpers';
import { getExcludedSpend } from '@/lib/exclusions';

type EventRow = { event_type: string; is_pickup: boolean | null; is_conversation: boolean | null; speed_to_lead_seconds: number | null; revenue: number | null };

export async function GET(req: Request) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;

  const { searchParams } = new URL(req.url);
  const client_id = searchParams.get('client_id');
  const live_only = searchParams.get('live_only') === 'true';
  const start_date = searchParams.get('start_date');
  const end_date = searchParams.get('end_date');

  let liveClientIds: string[] | null = null;
  if (live_only && !client_id) {
    liveClientIds = await getLiveClientIds(ctx.service);
  }

  // Build base events query (no execute yet — we'll paginate below)
  let eventsBase = ctx.service
    .from('events')
    .select('event_type, is_pickup, is_conversation, speed_to_lead_seconds, revenue');
  if (client_id) eventsBase = eventsBase.eq('client_id', client_id);
  else if (liveClientIds) eventsBase = eventsBase.in('client_id', liveClientFilter(liveClientIds));
  if (start_date) eventsBase = eventsBase.gte('occurred_at', `${start_date}T00:00:00.000Z`);
  if (end_date)   eventsBase = eventsBase.lte('occurred_at', `${end_date}T23:59:59.999Z`);

  // Paginate to overcome Supabase's default 1,000-row cap
  const PAGE = 1000;
  const allEvents: EventRow[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await eventsBase.range(offset, offset + PAGE - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data || data.length === 0) break;
    allEvents.push(...(data as EventRow[]));
    if (data.length < PAGE) break;
    offset += PAGE;
  }

  let spendQuery = ctx.service.from('ad_spend').select('client_id, spend_date, amount');
  if (client_id) spendQuery = spendQuery.eq('client_id', client_id);
  else if (liveClientIds) spendQuery = spendQuery.in('client_id', liveClientFilter(liveClientIds));
  if (start_date) spendQuery = spendQuery.gte('spend_date', start_date);
  if (end_date)   spendQuery = spendQuery.lte('spend_date', end_date);

  const { data: spendRows, error: spendError } = await spendQuery;
  if (spendError) return NextResponse.json({ error: spendError.message }, { status: 500 });

  const excludedSpend = await getExcludedSpend(ctx.service, spendRows ?? [], {
    client_id,
    client_ids: client_id ? null : liveClientIds,
  });

  return NextResponse.json(calculateMetrics(allEvents, spendRows ?? [], excludedSpend));
}
