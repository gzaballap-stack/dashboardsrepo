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
    .select('platform, amount, spend_date, impressions, reach, frequency, link_clicks, unique_clicks, unique_ctr, ctr, cpc, cpm, leads, budget, objective, status, campaign_id, campaign_name');

  if (start_date) spendQ = spendQ.gte('spend_date', start_date);
  if (end_date)   spendQ = spendQ.lte('spend_date', end_date);

  const [{ data: events, error: evErr }, fullSpendResult] =
    await Promise.all([eventsQ, spendQ]);

  if (evErr) return NextResponse.json({ error: evErr.message }, { status: 500 });

  // Graceful fallback if campaign columns haven't been migrated yet
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let spend: any[] | null = fullSpendResult.data;
  // Any not-yet-migrated column degrades to the base column set rather than 500ing.
  if (fullSpendResult.error && /column|schema cache/i.test(fullSpendResult.error.message ?? '')) {
    let fallbackQ = ctx.service
      .from('b2b_ad_spend')
      .select('platform, amount, spend_date, impressions, reach, link_clicks, ctr, cpc, cpm');
    if (start_date) fallbackQ = fallbackQ.gte('spend_date', start_date);
    if (end_date)   fallbackQ = fallbackQ.lte('spend_date', end_date);
    const { data: fbData, error: fbErr } = await fallbackQ;
    if (fbErr) return NextResponse.json({ error: fbErr.message }, { status: 500 });
    spend = fbData;
  } else if (fullSpendResult.error) {
    return NextResponse.json({ error: fullSpendResult.error.message }, { status: 500 });
  }

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

  // Per-campaign breakdown for the table
  const campaignMap = new Map<string, {
    campaign_id: string; campaign_name: string | null;
    spend: number; impressions: number; reach: number; link_clicks: number;
    unique_clicks: number; leads: number; budget: number | null; objective: string | null; status: string | null;
  }>();
  for (const row of spend ?? []) {
    const key = row.campaign_id ?? '';
    if (!campaignMap.has(key)) {
      campaignMap.set(key, {
        campaign_id: key, campaign_name: row.campaign_name ?? null,
        spend: 0, impressions: 0, reach: 0, link_clicks: 0,
        unique_clicks: 0, leads: 0, budget: null, objective: null, status: null,
      });
    }
    const c = campaignMap.get(key)!;
    c.spend       += row.amount ?? 0;
    c.impressions += row.impressions ?? 0;
    c.reach       += row.reach ?? 0;
    c.link_clicks += row.link_clicks ?? 0;
    c.unique_clicks += row.unique_clicks ?? 0;
    c.leads       += row.leads ?? 0;
    c.budget    = c.budget    ?? row.budget    ?? null;
    c.objective = c.objective ?? row.objective ?? null;
    c.status    = c.status    ?? row.status    ?? null;
  }
  const campaigns = Array.from(campaignMap.values()).map(c => ({
    campaign_id:   c.campaign_id,
    campaign_name: c.campaign_name,
    spend:         c.spend,
    impressions:   c.impressions,
    reach:         c.reach,
    link_clicks:   c.link_clicks,
    budget:        c.budget,
    objective:     c.objective,
    status:        c.status,
    unique_clicks: c.unique_clicks,
    leads:         c.leads,
    // Derived from summed totals, not weighted averages of per-day rates.
    ctr:        c.impressions   > 0 ? (c.link_clicks / c.impressions) * 100 : null,
    cpc:        c.link_clicks   > 0 ? c.spend / c.link_clicks : null,
    cpm:        c.impressions   > 0 ? (c.spend / c.impressions) * 1000 : null,
    frequency:  c.reach         > 0 ? c.impressions / c.reach : null,
    unique_ctr: c.reach         > 0 ? (c.unique_clicks / c.reach) * 100 : null,
    cvr:        c.unique_clicks > 0 ? (c.leads / c.unique_clicks) * 100 : null,
    cost_per_result: c.leads    > 0 ? c.spend / c.leads : null,
  }));

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
    campaigns,
  });
}
