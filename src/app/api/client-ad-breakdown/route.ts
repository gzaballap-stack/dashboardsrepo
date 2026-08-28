import { NextResponse } from 'next/server';
import { getAuthContext, isAuthError } from '@/lib/api-auth';

interface Acc {
  id_field: string; id_val: string; name_val: string | null;
  adset_id: string; adset_name: string | null;
  campaign_id: string; campaign_name: string; platform: string; status: string | null;
  spend: number; impressions: number; reach: number; link_clicks: number;
  ctr_sum: number; cpc_sum: number; cpm_sum: number; leads: number; rows: number;
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
    .select('adset_id,adset_name,ad_id,ad_name,campaign_id,campaign_name,platform,spend,impressions,reach,link_clicks,ctr,cpc,cpm,leads,status')
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
        link_clicks: r.link_clicks ?? 0, ctr_sum: r.ctr ?? 0, cpc_sum: r.cpc ?? 0,
        cpm_sum: r.cpm ?? 0, leads: r.leads ?? 0, rows: 1,
      });
    } else {
      ex.spend       += r.spend       ?? 0;
      ex.impressions += r.impressions ?? 0;
      ex.reach       += r.reach       ?? 0;
      ex.link_clicks += r.link_clicks ?? 0;
      ex.ctr_sum     += r.ctr         ?? 0;
      ex.cpc_sum     += r.cpc         ?? 0;
      ex.cpm_sum     += r.cpm         ?? 0;
      ex.leads       += r.leads       ?? 0;
      ex.rows++;
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
      ctr: a.rows > 0 ? a.ctr_sum / a.rows : 0,
      cpc: a.rows > 0 ? a.cpc_sum / a.rows : 0,
      cpm: a.rows > 0 ? a.cpm_sum / a.rows : 0,
      leads: a.leads,
    }))
    .sort((a, b) => b.spend - a.spend);

  return NextResponse.json({ rows });
}
