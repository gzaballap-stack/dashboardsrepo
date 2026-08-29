import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const campaign_id = searchParams.get('campaign_id');
  const start_date  = searchParams.get('start_date');
  const end_date    = searchParams.get('end_date');

  const service = createServiceClient();
  let q = service.from('b2b_ad_sets').select('*').order('spend_date', { ascending: false });

  if (campaign_id) q = q.eq('campaign_id', campaign_id);
  if (start_date)  q = q.gte('spend_date', start_date);
  if (end_date)    q = q.lte('spend_date', end_date);

  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Aggregate by adset_id across the date range
  const byAdSet = new Map<string, {
    adset_id: string; adset_name: string | null; campaign_id: string; campaign_name: string | null;
    spend: number; impressions: number; reach: number; link_clicks: number;
  }>();

  for (const r of data ?? []) {
    const key = r.adset_id || r.id;
    const ex = byAdSet.get(key);
    if (!ex) {
      byAdSet.set(key, {
        adset_id: r.adset_id, adset_name: r.adset_name, campaign_id: r.campaign_id, campaign_name: r.campaign_name,
        spend: r.spend ?? 0, impressions: r.impressions ?? 0, reach: r.reach ?? 0, link_clicks: r.link_clicks ?? 0,
      });
    } else {
      ex.spend       += r.spend       ?? 0;
      ex.impressions += r.impressions ?? 0;
      ex.reach       += r.reach       ?? 0;
      ex.link_clicks += r.link_clicks ?? 0;
    }
  }

  const adsets = Array.from(byAdSet.values()).map(a => ({
    adset_id:     a.adset_id,
    adset_name:   a.adset_name,
    campaign_id:  a.campaign_id,
    campaign_name: a.campaign_name,
    spend:        a.spend,
    impressions:  a.impressions,
    reach:        a.reach,
    link_clicks:  a.link_clicks,
    ctr: a.impressions > 0 ? (a.link_clicks / a.impressions) * 100 : 0,
    cpc: a.link_clicks  > 0 ? a.spend / a.link_clicks : 0,
    cpm: a.impressions  > 0 ? (a.spend / a.impressions) * 1000 : 0,
  })).sort((a, b) => b.spend - a.spend);

  return NextResponse.json({ adsets });
}
