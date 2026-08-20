import { NextResponse } from 'next/server';
import { getAuthContext, isAuthError } from '@/lib/api-auth';

type CampaignRow = {
  client_id: string;
  campaign_id: string;
  campaign_name: string;
  platform: string;
  status: string | null;
  budget: number | null;
  spend: number;
  impressions: number;
  reach: number;
  link_clicks: number;
  leads: number;
  clients: { name: string } | null;
};

type Rollup = {
  spend: number;
  impressions: number;
  reach: number;
  link_clicks: number;
  leads: number;
};

function withRates<T extends Rollup>(r: T) {
  return {
    ...r,
    ctr: r.impressions > 0 ? (r.link_clicks / r.impressions) * 100 : 0,
    cpc: r.link_clicks > 0 ? r.spend / r.link_clicks : 0,
    cpl: r.leads > 0 ? r.spend / r.leads : 0,
  };
}

export async function GET(req: Request) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;

  const { searchParams } = new URL(req.url);
  const start_date = searchParams.get('start_date');
  const end_date = searchParams.get('end_date');

  let query = ctx.service
    .from('ad_campaigns')
    .select('client_id, campaign_id, campaign_name, platform, status, budget, spend, impressions, reach, link_clicks, leads, clients(name)')
    .eq('level', 'campaign');
  if (start_date) query = query.gte('report_date', start_date);
  if (end_date)   query = query.lte('report_date', end_date);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []) as unknown as CampaignRow[];

  const byClient = new Map<string, {
    client_id: string;
    client_name: string;
    rollup: Rollup;
    campaigns: Map<string, Rollup & { campaign_id: string; campaign_name: string; platform: string; status: string | null; budget: number | null }>;
  }>();

  for (const row of rows) {
    let c = byClient.get(row.client_id);
    if (!c) {
      c = {
        client_id: row.client_id,
        client_name: row.clients?.name ?? 'Unknown',
        rollup: { spend: 0, impressions: 0, reach: 0, link_clicks: 0, leads: 0 },
        campaigns: new Map(),
      };
      byClient.set(row.client_id, c);
    }

    c.rollup.spend += Number(row.spend) || 0;
    c.rollup.impressions += row.impressions || 0;
    c.rollup.reach += row.reach || 0;
    c.rollup.link_clicks += row.link_clicks || 0;
    c.rollup.leads += row.leads || 0;

    let camp = c.campaigns.get(row.campaign_id);
    if (!camp) {
      camp = {
        campaign_id: row.campaign_id,
        campaign_name: row.campaign_name,
        platform: row.platform,
        status: row.status,
        budget: row.budget,
        spend: 0, impressions: 0, reach: 0, link_clicks: 0, leads: 0,
      };
      c.campaigns.set(row.campaign_id, camp);
    }
    camp.spend += Number(row.spend) || 0;
    camp.impressions += row.impressions || 0;
    camp.reach += row.reach || 0;
    camp.link_clicks += row.link_clicks || 0;
    camp.leads += row.leads || 0;
  }

  const clientRollups = Array.from(byClient.values()).map(c => withRates(c.rollup).cpl);
  const validCpls = clientRollups.filter(v => v > 0).sort((a, b) => a - b);
  const medianCpl = validCpls.length
    ? validCpls[Math.floor(validCpls.length / 2)]
    : 0;

  const clientsOut = Array.from(byClient.values()).map(c => {
    const rolled = withRates(c.rollup);
    let status: 'no_data' | 'excellent' | 'on_target' | 'above_target' | 'critical' = 'no_data';
    if (c.rollup.leads > 0 || c.rollup.spend > 0) {
      if (rolled.cpl === 0) status = 'critical';
      else if (medianCpl === 0) status = 'on_target';
      else if (rolled.cpl <= medianCpl * 0.7) status = 'excellent';
      else if (rolled.cpl <= medianCpl * 1.15) status = 'on_target';
      else if (rolled.cpl <= medianCpl * 1.6) status = 'above_target';
      else status = 'critical';
    }
    return {
      client_id: c.client_id,
      client_name: c.client_name,
      status,
      ...rolled,
      campaigns: Array.from(c.campaigns.values())
        .map(camp => withRates(camp))
        .sort((a, b) => b.spend - a.spend),
    };
  }).sort((a, b) => b.spend - a.spend);

  return NextResponse.json({ clients: clientsOut, portfolio_median_cpl: medianCpl });
}
