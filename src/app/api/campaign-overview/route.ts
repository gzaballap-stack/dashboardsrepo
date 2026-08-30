import { NextResponse } from 'next/server';
import { getAuthContext, isAuthError } from '@/lib/api-auth';
import { getLiveClientIds, liveClientFilter } from '@/lib/db-helpers';

type CampaignRow = {
  client_id: string;
  campaign_id: string;
  campaign_name: string;
  platform: string;
  status: string | null;
  objective: string | null;
  budget: number | null;
  spend: number;
  impressions: number;
  reach: number;
  frequency: number | null;
  link_clicks: number;
  unique_clicks: number | null;
  unique_ctr: number | null;
  cpm: number | null;
  leads: number | null;
  clients: { name: string } | null;
};

type AdRollup = { spend: number; impressions: number; reach: number; link_clicks: number; unique_clicks: number; ad_leads: number };
type FunnelRollup = { leads: number; appts: number; shows: number; no_shows: number; closes: number };

const EMPTY_AD: AdRollup = { spend: 0, impressions: 0, reach: 0, link_clicks: 0, unique_clicks: 0, ad_leads: 0 };
const EMPTY_FUNNEL: FunnelRollup = { leads: 0, appts: 0, shows: 0, no_shows: 0, closes: 0 };

function median(vals: number[]): number {
  const v = vals.filter(x => x > 0).sort((a, b) => a - b);
  return v.length ? v[Math.floor(v.length / 2)] : 0;
}

// Rules-based bottleneck diagnosis: finds whichever funnel stage (Creative -> CTR,
// Funnel -> CVR, Targeting -> L2A%, Post-Funnel -> close rate) is furthest below the
// portfolio median for that stage, and pairs it with a matching next-step action.
// Not an AI narrative -- deterministic thresholds against this dataset's own benchmarks.
function diagnose(m: {
  leads: number; spend: number; ctr: number; cvr: number; l2a: number; closeRate: number;
}, bench: { ctr: number; cvr: number; l2a: number; closeRate: number }) {
  if (m.spend === 0 && m.leads === 0) {
    return { bottleneck: 'No Data', action: '—', severity: 3 };
  }
  if (m.leads < 5) {
    return { bottleneck: 'Hold', action: 'Insufficient data — still gathering signal (< 5 leads)', severity: 1 };
  }

  const stages = [
    { key: 'Creative',     value: m.ctr,       bench: bench.ctr,       action: 'Refresh ad creative — CTR is below portfolio average' },
    { key: 'Funnel',       value: m.cvr,       bench: bench.cvr,       action: "Improve landing page/lead form — clicks aren't converting to leads" },
    { key: 'Targeting',    value: m.l2a,       bench: bench.l2a,       action: "Refine targeting — leads aren't qualifying into booked appointments" },
    { key: 'Post-Funnel',  value: m.closeRate, bench: bench.closeRate, action: "Review sales process — booked appointments aren't closing at the usual rate" },
  ];

  let worst = stages[0];
  let worstDeviation = -Infinity;
  for (const s of stages) {
    if (s.bench <= 0) continue;
    const deviation = (s.bench - s.value) / s.bench; // positive = below benchmark
    if (deviation > worstDeviation) { worstDeviation = deviation; worst = s; }
  }

  if (worstDeviation <= 0.05) {
    return { bottleneck: 'Healthy', action: 'No action needed — performing at or above portfolio average', severity: 0 };
  }
  const severity = worstDeviation > 0.5 ? 3 : worstDeviation > 0.25 ? 2 : 1;
  return { bottleneck: worst.key, action: worst.action, severity };
}

export async function GET(req: Request) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;

  const { searchParams } = new URL(req.url);
  const start_date = searchParams.get('start_date');
  const end_date = searchParams.get('end_date');

  const liveClientIds = await getLiveClientIds(ctx.service);

  let adQuery = ctx.service
    .from('ad_campaigns')
    .select('client_id, campaign_id, campaign_name, platform, status, objective, budget, spend, impressions, reach, frequency, link_clicks, unique_clicks, unique_ctr, cpm, leads, clients(name)')
    .eq('level', 'campaign')
    .in('client_id', liveClientFilter(liveClientIds));
  if (start_date) adQuery = adQuery.gte('report_date', start_date);
  if (end_date)   adQuery = adQuery.lte('report_date', end_date);

  const { data: adData, error: adError } = await adQuery;
  if (adError) return NextResponse.json({ error: adError.message }, { status: 500 });

  const adRows = (adData ?? []) as unknown as CampaignRow[];
  const clientIds = Array.from(new Set(adRows.map(r => r.client_id)));

  // Campaigns hidden per client -- other agencies'/legacy campaigns sharing the same ad
  // account. Excluded from rollup totals below but still returned per-campaign so the
  // drill-down can show + toggle them.
  const { data: exclusionData, error: exclusionError } = await ctx.service
    .from('ad_campaign_exclusions')
    .select('client_id, campaign_id');
  if (exclusionError) return NextResponse.json({ error: exclusionError.message }, { status: 500 });
  const excluded = new Set((exclusionData ?? []).map(e => `${e.client_id}:${e.campaign_id}`));

  // Real CCM funnel data (leads/appointments/shows/closes), not Meta's own reported
  // "leads" field which is frequently 0/unreliable for these accounts.
  const funnelByClient = new Map<string, FunnelRollup>();
  if (clientIds.length) {
    let evQuery = ctx.service
      .from('events')
      .select('client_id, event_type')
      .in('client_id', clientIds)
      .in('event_type', ['lead', 'appointment_booked', 'show', 'no_show', 'closed']);
    if (start_date) evQuery = evQuery.gte('occurred_at', `${start_date}T00:00:00.000Z`);
    if (end_date)   evQuery = evQuery.lte('occurred_at', `${end_date}T23:59:59.999Z`);

    const PAGE = 1000;
    let offset = 0;
    while (true) {
      const { data, error } = await evQuery.range(offset, offset + PAGE - 1);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      if (!data || data.length === 0) break;
      for (const ev of data as { client_id: string; event_type: string }[]) {
        const f = funnelByClient.get(ev.client_id) ?? { ...EMPTY_FUNNEL };
        if (ev.event_type === 'lead') f.leads++;
        else if (ev.event_type === 'appointment_booked') f.appts++;
        else if (ev.event_type === 'show') f.shows++;
        else if (ev.event_type === 'no_show') f.no_shows++;
        else if (ev.event_type === 'closed') f.closes++;
        funnelByClient.set(ev.client_id, f);
      }
      if (data.length < PAGE) break;
      offset += PAGE;
    }
  }

  const byClient = new Map<string, {
    client_id: string;
    client_name: string;
    ad: AdRollup;
    campaigns: Map<string, AdRollup & { campaign_id: string; campaign_name: string; platform: string; status: string | null; objective: string | null; budget: number | null; excluded: boolean }>;
  }>();

  for (const row of adRows) {
    let c = byClient.get(row.client_id);
    if (!c) {
      c = { client_id: row.client_id, client_name: row.clients?.name ?? 'Unknown', ad: { ...EMPTY_AD }, campaigns: new Map() };
      byClient.set(row.client_id, c);
    }

    const isExcluded = excluded.has(`${row.client_id}:${row.campaign_id}`);
    if (!isExcluded) {
      c.ad.spend += Number(row.spend) || 0;
      c.ad.impressions += row.impressions || 0;
      c.ad.unique_clicks += row.unique_clicks || 0;
      c.ad.ad_leads += row.leads || 0;
      c.ad.reach += row.reach || 0;
      c.ad.link_clicks += row.link_clicks || 0;
    }

    let camp = c.campaigns.get(row.campaign_id);
    if (!camp) {
      camp = { campaign_id: row.campaign_id, campaign_name: row.campaign_name, platform: row.platform, status: row.status, objective: row.objective, budget: row.budget, excluded: isExcluded, ...EMPTY_AD };
      c.campaigns.set(row.campaign_id, camp);
    }
    camp.spend += Number(row.spend) || 0;
    camp.impressions += row.impressions || 0;
    camp.unique_clicks += row.unique_clicks || 0;
    camp.ad_leads += row.leads || 0;
    // Budget/status/objective describe the entity, not the day — keep the first non-null.
    camp.budget    = camp.budget    ?? row.budget    ?? null;
    camp.status    = camp.status    ?? row.status    ?? null;
    camp.objective = camp.objective ?? row.objective ?? null;
    camp.reach += row.reach || 0;
    camp.link_clicks += row.link_clicks || 0;
  }

  // Compute derived metrics per client using real funnel data
  const computed = Array.from(byClient.values()).map(c => {
    const f = funnelByClient.get(c.client_id) ?? { ...EMPTY_FUNNEL };
    const ctr = c.ad.impressions > 0 ? (c.ad.link_clicks / c.ad.impressions) * 100 : 0;
    const cpc = c.ad.link_clicks > 0 ? c.ad.spend / c.ad.link_clicks : 0;
    const cvr = c.ad.link_clicks > 0 ? (f.leads / c.ad.link_clicks) * 100 : 0;
    const cpl = f.leads > 0 ? c.ad.spend / f.leads : 0;
    const l2a = f.leads > 0 ? (f.appts / f.leads) * 100 : 0;
    const cpAppt = f.appts > 0 ? c.ad.spend / f.appts : 0;
    const showRate = f.shows + f.no_shows > 0 ? (f.shows / (f.shows + f.no_shows)) * 100 : 0;
    const closeRate = f.shows > 0 ? (f.closes / f.shows) * 100 : 0;
    return { c, f, ctr, cpc, cvr, cpl, l2a, cpAppt, showRate, closeRate };
  });

  const bench = {
    ctr: median(computed.map(x => x.ctr)),
    cvr: median(computed.map(x => x.cvr)),
    l2a: median(computed.map(x => x.l2a)),
    closeRate: median(computed.map(x => x.closeRate)),
  };

  // Spend-tier rank, top to bottom: Whale (top 20%), Shark (next 30%), Dolphin (next 30%), Shrimp (rest)
  const bySpend = [...computed].sort((a, b) => b.c.ad.spend - a.c.ad.spend);
  const n = bySpend.length;
  const rankFor = (idx: number): string => {
    if (idx < Math.ceil(n * 0.2)) return 'Whale';
    if (idx < Math.ceil(n * 0.5)) return 'Shark';
    if (idx < Math.ceil(n * 0.8)) return 'Dolphin';
    return 'Shrimp';
  };
  const rankByClientId = new Map(bySpend.map((x, idx) => [x.c.client_id, rankFor(idx)]));

  const clientsOut = computed.map(({ c, f, ctr, cpc, cvr, cpl, l2a, cpAppt, showRate, closeRate }) => {
    const diag = diagnose({ leads: f.leads, spend: c.ad.spend, ctr, cvr, l2a, closeRate }, bench);
    const status =
      diag.bottleneck === 'No Data' ? 'no_data' :
      diag.bottleneck === 'Hold' ? 'hold' :
      diag.severity === 3 ? 'critical' :
      diag.severity === 2 ? 'above_target' :
      diag.severity === 1 ? 'on_target' : 'excellent';

    return {
      client_id: c.client_id,
      client_name: c.client_name,
      rank: rankByClientId.get(c.client_id) ?? 'Shrimp',
      status,
      bottleneck: diag.bottleneck,
      action: diag.action,
      spend: c.ad.spend,
      impressions: c.ad.impressions,
      reach: c.ad.reach,
      link_clicks: c.ad.link_clicks,
      ctr, cpc,
      leads: f.leads, cpl, cvr,
      appts: f.appts, cp_appt: cpAppt, l2a_pct: l2a,
      shows: f.shows, no_shows: f.no_shows, show_rate: showRate,
      closes: f.closes, close_rate: closeRate,
      campaigns: Array.from(c.campaigns.values())
        .map(camp => ({
          ...camp,
          leads: camp.ad_leads,
          ctr: camp.impressions > 0 ? (camp.link_clicks / camp.impressions) * 100 : 0,
          cpc: camp.link_clicks > 0 ? camp.spend / camp.link_clicks : 0,
          // Rates derived from summed totals, never averaged per-day rates.
          cpm:        camp.impressions   > 0 ? (camp.spend / camp.impressions) * 1000 : 0,
          frequency:  camp.reach         > 0 ? camp.impressions / camp.reach : 0,
          unique_ctr: camp.reach         > 0 ? (camp.unique_clicks / camp.reach) * 100 : 0,
          cvr:        camp.unique_clicks > 0 ? (camp.ad_leads / camp.unique_clicks) * 100 : 0,
          cost_per_result: camp.ad_leads > 0 ? camp.spend / camp.ad_leads : 0,
        }))
        .sort((a, b) => b.spend - a.spend),
    };
  }).sort((a, b) => b.spend - a.spend);

  return NextResponse.json({ clients: clientsOut, benchmarks: bench });
}
