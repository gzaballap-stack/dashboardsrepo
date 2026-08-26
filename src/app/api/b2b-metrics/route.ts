import { NextResponse } from 'next/server';
import { getAuthContext, isAuthError } from '@/lib/api-auth';

export async function GET(req: Request) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;

  const { searchParams } = new URL(req.url);
  const start_date = searchParams.get('start_date');
  const end_date   = searchParams.get('end_date');

  let eventsQ = ctx.service
    .from('b2b_events')
    .select('event_type, revenue, occurred_at');

  if (start_date) eventsQ = eventsQ.gte('occurred_at', `${start_date}T00:00:00.000Z`);
  if (end_date)   eventsQ = eventsQ.lte('occurred_at', `${end_date}T23:59:59.999Z`);

  let spendQ = ctx.service
    .from('b2b_ad_spend')
    .select('platform, amount, spend_date, impressions, reach, link_clicks, ctr, cpc, cpm');

  if (start_date) spendQ = spendQ.gte('spend_date', start_date);
  if (end_date)   spendQ = spendQ.lte('spend_date', end_date);

  const [{ data: events, error: evErr }, { data: spend, error: spErr }] =
    await Promise.all([eventsQ, spendQ]);

  if (evErr) return NextResponse.json({ error: evErr.message }, { status: 500 });
  if (spErr) return NextResponse.json({ error: spErr.message }, { status: 500 });

  const count = (type: string) => events?.filter(e => e.event_type === type).length ?? 0;
  const totalRevenue = (type: string) =>
    events?.filter(e => e.event_type === type).reduce((s, e) => s + (e.revenue ?? 0), 0) ?? 0;

  const totalSpend      = spend?.reduce((s, r) => s + (r.amount      ?? 0), 0) ?? 0;
  const totalImpressions = spend?.reduce((s, r) => s + (r.impressions ?? 0), 0) ?? 0;
  const totalReach      = spend?.reduce((s, r) => s + (r.reach       ?? 0), 0) ?? 0;
  const totalLinkClicks = spend?.reduce((s, r) => s + (r.link_clicks ?? 0), 0) ?? 0;

  // Weighted averages for rates (weight by impressions; fall back to simple average)
  const rowsWithCtr = spend?.filter(r => r.ctr != null && r.impressions != null) ?? [];
  const avgCtr = rowsWithCtr.length > 0
    ? rowsWithCtr.reduce((s, r) => s + (r.ctr! * (r.impressions ?? 1)), 0) /
      rowsWithCtr.reduce((s, r) => s + (r.impressions ?? 1), 0)
    : null;

  const rowsWithCpc = spend?.filter(r => r.cpc != null && r.link_clicks != null) ?? [];
  const avgCpc = rowsWithCpc.length > 0
    ? rowsWithCpc.reduce((s, r) => s + (r.cpc! * (r.link_clicks ?? 1)), 0) /
      rowsWithCpc.reduce((s, r) => s + (r.link_clicks ?? 1), 0)
    : null;

  const rowsWithCpm = spend?.filter(r => r.cpm != null && r.impressions != null) ?? [];
  const avgCpm = rowsWithCpm.length > 0
    ? rowsWithCpm.reduce((s, r) => s + (r.cpm! * (r.impressions ?? 1)), 0) /
      rowsWithCpm.reduce((s, r) => s + (r.impressions ?? 1), 0)
    : null;

  const closes       = count('close');
  const cash         = totalRevenue('close');
  const leads        = count('lead');
  const introsBooked = count('intro_booked');

  return NextResponse.json({
    ad_spend:           totalSpend,
    leads,
    intros_booked:      introsBooked,
    intros_shown:       count('intro_shown'),
    sales_calls_booked: count('sales_call_booked'),
    sales_calls_shown:  count('sales_call_shown'),
    closes,
    cash_collected:     cash,
    impressions:        totalImpressions,
    reach:              totalReach,
    link_clicks:        totalLinkClicks,
    ctr:                avgCtr,
    cpc:                avgCpc,
    cpm:                avgCpm,
    intro_show_rate:    introsBooked > 0 ? count('intro_shown') / introsBooked : 0,
    cost_per_lead:      leads > 0 ? totalSpend / leads : 0,
    cost_per_close:     closes > 0 ? totalSpend / closes : 0,
  });
}
