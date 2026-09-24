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
    .select('event_type, revenue, occurred_at, ghl_contact_id, booked_by, progress_pct');

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

  // Some leads never book a 15-minute intro — they get sold on the phone and go
  // straight to a sales call. Counting events alone can't see that, so group the
  // events by contact and look at each person's actual path.
  const paths = new Map<string, Set<string>>();
  for (const e of events ?? []) {
    const id = (e as { ghl_contact_id?: string | null }).ghl_contact_id;
    if (!id) continue;
    const set = paths.get(id) ?? new Set<string>();
    set.add(e.event_type);
    paths.set(id, set);
  }
  const journeys = Array.from(paths.values());
  const tracked_contacts   = journeys.length;
  const direct_sales_calls = journeys.filter(s => s.has('sales_call_booked') && !s.has('intro_booked')).length;
  const sales_calls_via_intro = journeys.filter(s => s.has('sales_call_booked') && s.has('intro_booked')).length;
  const leads_no_intro     = journeys.filter(s => s.has('lead') && !s.has('intro_booked')).length;
  const booking_leads      = journeys.filter(s => s.has('lead') && s.has('sales_call_booked')).length;

  const demosBooked = (events ?? []).filter(e => e.event_type === 'sales_call_booked');
  const self_booked = demosBooked.filter(e => (e as { booked_by?: string|null }).booked_by === 'self').length;
  const team_booked = demosBooked.filter(e => (e as { booked_by?: string|null }).booked_by === 'team').length;

  // ── Funnel engagement (page visits + video watch) ──
  const ev = events ?? [];
  const cnt = (t: string) => ev.filter(e => e.event_type === t).length;
  const landing_visits  = cnt('visit_landing');
  const calendar_visits = cnt('visit_calendar');
  const bookings        = cnt('visit_thankyou');
  // Per-contact furthest watch %, for view + milestone rates.
  const watchers = (type: string) => {
    const m = new Map<string, number>();
    for (const e of ev) {
      if (e.event_type !== type) continue;
      const id = (e as { ghl_contact_id?: string | null }).ghl_contact_id;
      if (!id) continue;
      const p = Number((e as { progress_pct?: number | null }).progress_pct) || 0;
      m.set(id, Math.max(m.get(id) ?? 0, p));
    }
    return m;
  };
  const pc = watchers('precall_watch'), vsl = watchers('vsl_watch');

  // Per-contact watch depth + outcome, for show/close rates by watch behaviour.
  type C = { precall: number; vsl: number; booked: boolean; shown: boolean; closed: boolean };
  const byContact = new Map<string, C>();
  for (const e of ev) {
    const id = (e as { ghl_contact_id?: string | null }).ghl_contact_id;
    if (!id) continue;
    const c = byContact.get(id) ?? { precall: 0, vsl: 0, booked: false, shown: false, closed: false };
    const p = Number((e as { progress_pct?: number | null }).progress_pct) || 0;
    if (e.event_type === 'precall_watch') c.precall = Math.max(c.precall, p);
    if (e.event_type === 'vsl_watch')     c.vsl = Math.max(c.vsl, p);
    if (e.event_type === 'sales_call_booked') c.booked = true;
    if (e.event_type === 'sales_call_shown')  c.shown = true;
    if (e.event_type === 'close')             c.closed = true;
    byContact.set(id, c);
  }
  const contacts = [...byContact.values()];
  const cohort = (f: (c: C) => boolean) => {
    const booked = contacts.filter(c => c.booked && f(c));
    const shown = booked.filter(c => c.shown);
    const closed = shown.filter(c => c.closed);
    return {
      booked: booked.length,
      show_rate: booked.length ? (shown.length / booked.length) * 100 : 0,
      close_rate: shown.length ? (closed.length / shown.length) * 100 : 0,
    };
  };
  const correlation = {
    precall_watched: cohort(c => c.precall >= 25),
    precall_not:     cohort(c => c.precall < 25),
    vsl_watched:     cohort(c => c.vsl >= 25),
    vsl_not:         cohort(c => c.vsl < 25),
    precall_depth: { d25: cohort(c => c.precall >= 25), d50: cohort(c => c.precall >= 50), d75: cohort(c => c.precall >= 75), d100: cohort(c => c.precall >= 100) },
    vsl_depth:     { d25: cohort(c => c.vsl >= 25),     d50: cohort(c => c.vsl >= 50),     d75: cohort(c => c.vsl >= 75),     d100: cohort(c => c.vsl >= 100) },
  };
  const atLeast = (m: Map<string, number>, th: number) => [...m.values()].filter(v => v >= th).length;
  const pct = (num: number, den: number) => den > 0 ? (num / den) * 100 : 0;

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

    // Lead -> sales call, regardless of whether an intro happened in between.
    lead_to_sales_call_rate: leads > 0 ? (count('sales_call_booked') / leads) * 100 : 0,
    lead_to_intro_rate:      leads > 0 ? (introsBooked / leads) * 100 : 0,

    // Funnel engagement
    landing_visits, calendar_visits, bookings,
    lead_page_conversion: pct(leads, landing_visits),
    lead_booking_rate_funnel: pct(bookings, leads),
    landing_to_booking: pct(bookings, landing_visits),
    precall_views: pc.size,
    precall_view_rate: pct(pc.size, bookings),
    precall_25_rate: pct(atLeast(pc, 25), bookings),
    precall_50_rate: pct(atLeast(pc, 50), bookings),
    precall_75_rate: pct(atLeast(pc, 75), bookings),
    precall_100_rate: pct(atLeast(pc, 100), bookings),
    vsl_views: vsl.size,
    vsl_view_rate: pct(vsl.size, bookings),
    vsl_25_rate: pct(atLeast(vsl, 25), bookings),
    vsl_50_rate: pct(atLeast(vsl, 50), bookings),
    vsl_75_rate: pct(atLeast(vsl, 75), bookings),
    vsl_100_rate: pct(atLeast(vsl, 100), bookings),
    correlation,
    // Who booked the demo — share of leads, as requested.
    self_booked, team_booked,
    self_booked_pct: leads > 0 ? (self_booked / leads) * 100 : 0,
    team_booked_pct: leads > 0 ? (team_booked / leads) * 100 : 0,
    // Leads that booked a demo vs leads that didn't.
    booking_leads,
    non_booking_leads: Math.max(0, leads - booking_leads),
    // Per-contact splits — only meaningful once ghl_contact_id is being sent.
    direct_sales_calls,
    sales_calls_via_intro,
    leads_no_intro,
    tracked_contacts,
    cost_per_lead:      leads > 0 ? totalSpend / leads : 0,
    cost_per_close:     closes > 0 ? totalSpend / closes : 0,
    campaigns,
  });
}
