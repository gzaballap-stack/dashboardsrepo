import { NextResponse } from 'next/server';
import { getAuthContext, isAuthError } from '@/lib/api-auth';
import { calculateMetrics } from '@/lib/metrics';
import { getLiveClientIds, liveClientFilter, getInternalClientIds } from '@/lib/db-helpers';
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
  // Channel: "ads" = everything except SMS (the default view), "sms" = leads that
  // came in as SMS positive replies and what followed them. Absent = all, as before.
  const channel = searchParams.get('channel');

  let liveClientIds: string[] | null = null;
  if (live_only && !client_id) {
    liveClientIds = await getLiveClientIds(ctx.service);
  }

  // Build base events query (no execute yet — we'll paginate below)
  let eventsBase = ctx.service
    .from('events')
    .select('event_type, is_pickup, is_conversation, speed_to_lead_seconds, duration_seconds, revenue');
  // "All clients" must never include the internal Tomsi Media row: its B2B
  // funnel is mirrored into these tables so its own dashboard can reuse the
  // client views, but it is not a client. (Live-only already excludes it.)
  const internalIds = !client_id && !liveClientIds ? await getInternalClientIds(ctx.service) : [];
  const notInternal = internalIds.length ? `client_id.is.null,client_id.not.in.(${internalIds.join(',')})` : null;

  if (client_id) eventsBase = eventsBase.eq('client_id', client_id);
  else if (liveClientIds) eventsBase = eventsBase.in('client_id', liveClientFilter(liveClientIds));
  else if (notInternal) eventsBase = eventsBase.or(notInternal);
  if (start_date) eventsBase = eventsBase.gte('occurred_at', `${start_date}T00:00:00.000Z`);
  if (end_date)   eventsBase = eventsBase.lte('occurred_at', `${end_date}T23:59:59.999Z`);
  if (channel === 'sms') eventsBase = eventsBase.eq('ad_platform', 'sms');
  else if (channel === 'ads') eventsBase = eventsBase.or('ad_platform.is.null,ad_platform.neq.sms');

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
  else if (notInternal) spendQuery = spendQuery.or(notInternal);
  if (start_date) spendQuery = spendQuery.gte('spend_date', start_date);
  if (end_date)   spendQuery = spendQuery.lte('spend_date', end_date);

  // SMS channel: the "spend" is messages sent × the per-message rate, so every
  // cost KPI (CPL, cost per appointment, CPS…) is the SMS cost, not ad spend.
  if (channel === 'sms') {
    // `sms_sends` holds a row per text sent — tens of thousands a month. Reading
    // them all here to add them up ran into the database's 8-second limit and
    // the whole SMS view came back as zeros (2026-11-23). The database adds
    // them up instead (`sms_totals`, one row per client); where that function
    // does not exist yet, the rows are still read.
    let sms_sent = 0;
    const totals = await ctx.service.rpc('sms_totals', { p_start: start_date, p_end: end_date, p_client: client_id });
    if (!totals.error && Array.isArray(totals.data)) {
      const live = liveClientIds ? new Set(liveClientIds) : null;
      const internal = new Set(internalIds);
      for (const r of totals.data as { client_id: string | null; messages: number | string | null }[]) {
        if (!client_id && (live ? !r.client_id || !live.has(r.client_id) : !!r.client_id && internal.has(r.client_id))) continue;
        sms_sent += Number(r.messages) || 0;
      }
    } else {
      let smsQ = ctx.service.from('sms_sends').select('client_id, sent_date, messages');
      if (client_id) smsQ = smsQ.eq('client_id', client_id);
      else if (liveClientIds) smsQ = smsQ.in('client_id', liveClientFilter(liveClientIds));
      else if (notInternal) smsQ = smsQ.or(notInternal);
      if (start_date) smsQ = smsQ.gte('sent_date', start_date);
      if (end_date)   smsQ = smsQ.lte('sent_date', end_date);
      const { data: smsRows, error: smsErr } = await smsQ;
      if (smsErr) return NextResponse.json({ error: smsErr.message }, { status: 500 });
      sms_sent = (smsRows ?? []).reduce((n, r) => n + (Number(r.messages) || 0), 0);
    }
    const rate = Number(process.env.SMS_COST_PER_MESSAGE ?? '0.01') || 0;
    const sms_cost = sms_sent * rate;
    return NextResponse.json({
      ...calculateMetrics(allEvents, [{ amount: sms_cost }], 0),
      channel: 'sms', sms_sent, sms_cost, sms_cost_per_message: rate,
    });
  }

  const { data: spendRows, error: spendError } = await spendQuery;
  if (spendError) return NextResponse.json({ error: spendError.message }, { status: 500 });

  const excludedSpend = await getExcludedSpend(ctx.service, spendRows ?? [], {
    client_id,
    client_ids: client_id ? null : liveClientIds,
  });

  return NextResponse.json({ ...calculateMetrics(allEvents, spendRows ?? [], excludedSpend), channel: channel === 'ads' ? 'ads' : 'all' });
}
