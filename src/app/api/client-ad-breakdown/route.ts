import { NextResponse } from 'next/server';
import { getAuthContext, isAuthError } from '@/lib/api-auth';

interface Acc {
  id_field: string; id_val: string; name_val: string | null;
  adset_id: string; adset_name: string | null;
  campaign_id: string; campaign_name: string; platform: string; status: string | null;
  spend: number; impressions: number; reach: number; link_clicks: number;
  unique_clicks: number; leads: number; budget: number | null; objective: string | null;
}

export async function GET(req: Request) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;

  const { searchParams } = new URL(req.url);
  const client_id   = searchParams.get('client_id');
  const level       = searchParams.get('level') as 'adset' | 'ad' | null;
  const start_date  = searchParams.get('start_date');
  const end_date    = searchParams.get('end_date');
  const campaign_id = searchParams.get('campaign_id');

  if (!client_id)                          return NextResponse.json({ error: 'client_id required' }, { status: 400 });
  if (level !== 'adset' && level !== 'ad') return NextResponse.json({ error: "level must be 'adset' or 'ad'" }, { status: 400 });

  let q = ctx.service
    .from('ad_campaigns')
    .select('adset_id,adset_name,ad_id,ad_name,campaign_id,campaign_name,platform,spend,impressions,reach,frequency,link_clicks,unique_clicks,unique_ctr,ctr,cpc,cpm,leads,status,budget,objective')
    .eq('client_id', client_id)
    .eq('level', level);

  if (campaign_id) q = q.eq('campaign_id', campaign_id);
  if (start_date)  q = q.gte('report_date', start_date);
  if (end_date)    q = q.lte('report_date', end_date);

  const { data, error } = await q.order('report_date', { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const byId = new Map<string, Acc>();

  for (const r of data ?? []) {
    const key = level === 'adset' ? (r.adset_id || '') : (r.ad_id || '');
    const ex  = byId.get(key);
    if (!ex) {
      byId.set(key, {
        id_field:    level === 'adset' ? 'adset_id' : 'ad_id',
        id_val:      level === 'adset' ? r.adset_id : r.ad_id,
        name_val:    level === 'adset' ? r.adset_name : r.ad_name,
        adset_id:    r.adset_id,   adset_name:    r.adset_name,
        campaign_id: r.campaign_id, campaign_name: r.campaign_name,
        platform: r.platform, status: r.status,
        spend: r.spend ?? 0, impressions: r.impressions ?? 0, reach: r.reach ?? 0,
        link_clicks: r.link_clicks ?? 0, unique_clicks: r.unique_clicks ?? 0,
        leads: r.leads ?? 0, budget: r.budget ?? null, objective: r.objective ?? null,
      });
    } else {
      ex.spend       += r.spend       ?? 0;
      ex.impressions += r.impressions ?? 0;
      ex.reach       += r.reach       ?? 0;
      ex.link_clicks   += r.link_clicks   ?? 0;
      ex.unique_clicks += r.unique_clicks ?? 0;
      ex.leads         += r.leads         ?? 0;
      // Budget is a property of the entity, not the day — keep the first non-null.
      ex.budget    = ex.budget    ?? r.budget    ?? null;
      ex.objective = ex.objective ?? r.objective ?? null;
    }
  }

  const rows = Array.from(byId.values())
    .map(a => ({
      ...(level === 'adset'
        ? { adset_id: a.id_val, adset_name: a.name_val }
        : { ad_id: a.id_val, ad_name: a.name_val, adset_id: a.adset_id, adset_name: a.adset_name }),
      campaign_id: a.campaign_id, campaign_name: a.campaign_name,
      platform: a.platform, status: a.status,
      spend: a.spend, impressions: a.impressions, reach: a.reach, link_clicks: a.link_clicks,
      budget: a.budget, objective: a.objective,
      unique_clicks: a.unique_clicks,
      ctr: a.impressions > 0 ? (a.link_clicks / a.impressions) * 100 : 0,
      cpc: a.link_clicks > 0 ? a.spend / a.link_clicks : 0,
      cpm: a.impressions > 0 ? (a.spend / a.impressions) * 1000 : 0,
      // Meta defines frequency as impressions/reach and unique CTR over reach.
      frequency:  a.reach > 0 ? a.impressions / a.reach : 0,
      unique_ctr: a.reach > 0 ? (a.unique_clicks / a.reach) * 100 : 0,
      leads: a.leads,
      // CVR is a custom metric: results over unique link clicks.
      cvr: a.unique_clicks > 0 ? (a.leads / a.unique_clicks) * 100 : 0,
      cost_per_result: a.leads > 0 ? a.spend / a.leads : 0,
    }))
    .sort((a, b) => b.spend - a.spend);

  return NextResponse.json({ rows });
}
