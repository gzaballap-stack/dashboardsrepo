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
    .select('platform, amount, spend_date, impressions, reach, link_clicks, ctr, cpc, cpm, campaign_id, campaign_name');

  if (start_date) spendQ = spendQ.gte('spend_date', start_date);
  if (end_date)   spendQ = spendQ.lte('spend_date', end_date);

  const [{ data: events, error: evErr }, fullSpendResult] =
    await Promise.all([eventsQ, spendQ]);

  if (evErr) return NextResponse.json({ error: evErr.message }, { status: 500 });

  // Graceful fallback if campaign columns haven't been migrated yet
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let spend: any[] | null = fullSpendResult.data;
  if (fullSpendResult.error?.message?.includes('campaign_id') ||
      fullSpendResult.error?.message?.includes('campaign_name')) {
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
    ctr_sum: number; ctr_weight: number; cpc_sum: number; cpc_weight: number; cpm_sum: number; cpm_weight: number;
  }>();
  for (const row of spend ?? []) {
    const key = row.campaign_id ?? '';
    if (!campaignMap.has(key)) {
      campaignMap.set(key, {
        campaign_id: key, campaign_name: row.campaign_name ?? null,
        spend: 0, impressions: 0, reach: 0, link_clicks: 0,
        ctr_sum: 0, ctr_weight: 0, cpc_sum: 0, cpc_weight: 0, cpm_sum: 0, cpm_weight: 0,
      });
    }
    const c = campaignMap.get(key)!;
    c.spend       += row.amount ?? 0;
    c.impressions += row.impressions ?? 0;
    c.reach       += row.reach ?? 0;
    c.link_clicks += row.link_clicks ?? 0;
    if (row.ctr != null) { c.ctr_sum += row.ctr * (row.impressions ?? 1); c.ctr_weight += row.impressions ?? 1; }
    if (row.cpc != null) { c.cpc_sum += row.cpc * (row.link_clicks ?? 1); c.cpc_weight += row.link_clicks ?? 1; }
    if (row.cpm != null) { c.cpm_sum += row.cpm * (row.impressions ?? 1); c.cpm_weight += row.impressions ?? 1; }
  }
  const campaigns = Array.from(campaignMap.values()).map(c => ({
    campaign_id:   c.campaign_id,
    campaign_name: c.campaign_name,
    spend:         c.spend,
    impressions:   c.impressions,
    reach:         c.reach,
    link_clicks:   c.link_clicks,
    ctr: c.ctr_weight > 0 ? c.ctr_sum / c.ctr_weight : null,
    cpc: c.cpc_weight > 0 ? c.cpc_sum / c.cpc_weight : null,
    cpm: c.cpm_weight > 0 ? c.cpm_sum / c.cpm_weight : null,
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
