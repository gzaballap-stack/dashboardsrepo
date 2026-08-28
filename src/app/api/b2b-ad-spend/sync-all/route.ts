import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { validateWebhookSecret } from '@/lib/api-auth';

// Single-shot sync: fetches ad-level data from Meta, aggregates to adset + campaign,
// and upserts all three tables in one request. Replaces the 6-module Make blueprint.
// Body: { date, platform, meta_token, account_id? }

const DEFAULT_ACCOUNT = 'act_1080664784142903';

export async function POST(req: Request) {
  try {
    if (!validateWebhookSecret(req)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payload = await req.json();
    const { date, platform, meta_token, account_id } = payload;

    if (!date || !platform)    return NextResponse.json({ error: 'date and platform required' }, { status: 400 });
    if (!meta_token)           return NextResponse.json({ error: 'meta_token required' }, { status: 400 });
    if (!['meta', 'google', 'local_services'].includes(platform)) {
      return NextResponse.json({ error: 'invalid platform' }, { status: 400 });
    }

    const acct = account_id || DEFAULT_ACCOUNT;

    // ── 1. Fetch ad-level insights from Meta ────────────────────────────
    const params = new URLSearchParams({
      fields: 'ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,spend,impressions,reach,inline_link_clicks,ctr,cpc,cpm',
      time_range: JSON.stringify({ since: date, until: date }),
      level: 'ad',
      access_token: meta_token,
    });

    const metaRes = await fetch(`https://graph.facebook.com/v19.0/${acct}/insights?${params}`);
    const metaJson = await metaRes.json() as {
      data?: Record<string, string>[];
      error?: { message: string };
    };

    if (metaJson.error) {
      return NextResponse.json({ error: `Meta API: ${metaJson.error.message}` }, { status: 502 });
    }

    const adRows = metaJson.data ?? [];
    if (adRows.length === 0) {
      return NextResponse.json({ success: true, note: 'No data from Meta for this date', campaigns: 0, adsets: 0, ads: 0 });
    }

    // ── 2. Aggregate to campaign and adset levels ───────────────────────
    type CampAcc  = { campaign_id: string; campaign_name: string; spend: number; impressions: number; reach: number; link_clicks: number };
    type AdSetAcc = { campaign_id: string; campaign_name: string; adset_id: string; adset_name: string; spend: number; impressions: number; reach: number; link_clicks: number };

    const campaigns = new Map<string, CampAcc>();
    const adsets    = new Map<string, AdSetAcc>();

    const ads = adRows.map(r => {
      const spend       = parseFloat(r.spend        ?? '0') || 0;
      const impressions = parseInt(r.impressions     ?? '0', 10);
      const reach       = parseInt(r.reach           ?? '0', 10);
      const link_clicks = parseInt(r.inline_link_clicks ?? r.link_clicks ?? '0', 10);

      // campaign rollup
      const cId = r.campaign_id ?? '';
      const cc  = campaigns.get(cId);
      if (!cc) campaigns.set(cId, { campaign_id: cId, campaign_name: r.campaign_name ?? '', spend, impressions, reach, link_clicks });
      else     { cc.spend += spend; cc.impressions += impressions; cc.reach += reach; cc.link_clicks += link_clicks; }

      // adset rollup
      const aId = r.adset_id ?? '';
      const ac  = adsets.get(aId);
      if (!ac) adsets.set(aId, { campaign_id: cId, campaign_name: r.campaign_name ?? '', adset_id: aId, adset_name: r.adset_name ?? '', spend, impressions, reach, link_clicks });
      else     { ac.spend += spend; ac.impressions += impressions; ac.reach += reach; ac.link_clicks += link_clicks; }

      return {
        spend_date: date, platform,
        campaign_id: cId, campaign_name: r.campaign_name ?? null,
        adset_id: aId,   adset_name:    r.adset_name    ?? null,
        ad_id:    r.ad_id ?? '', ad_name: r.ad_name ?? null,
        spend,
        impressions: impressions || null,
        reach:       reach       || null,
        link_clicks: link_clicks || null,
        ctr: r.ctr ? parseFloat(r.ctr) : null,
        cpc: r.cpc ? parseFloat(r.cpc) : null,
        cpm: r.cpm ? parseFloat(r.cpm) : null,
      };
    });

    // Derive CTR/CPC/CPM from totals (more accurate than averaging rates)
    const toMetrics = (spend: number, impressions: number, link_clicks: number) => ({
      ctr: impressions > 0 ? (link_clicks / impressions) * 100 : null,
      cpc: link_clicks > 0 ? spend / link_clicks : null,
      cpm: impressions > 0 ? (spend / impressions) * 1000 : null,
    });

    const campaignRecords = Array.from(campaigns.values()).map(c => ({
      spend_date: date, platform,
      campaign_id: c.campaign_id, campaign_name: c.campaign_name,
      amount: c.spend,
      impressions: c.impressions || null, reach: c.reach || null, link_clicks: c.link_clicks || null,
      ...toMetrics(c.spend, c.impressions, c.link_clicks),
    }));

    const adsetRecords = Array.from(adsets.values()).map(a => ({
      spend_date: date, platform,
      campaign_id: a.campaign_id, campaign_name: a.campaign_name,
      adset_id: a.adset_id, adset_name: a.adset_name,
      spend: a.spend,
      impressions: a.impressions || null, reach: a.reach || null, link_clicks: a.link_clicks || null,
      ...toMetrics(a.spend, a.impressions, a.link_clicks),
    }));

    // ── 3. Upsert all three tables ──────────────────────────────────────
    const service = createServiceClient();

    const [campErr, adsetErr, adErr] = await Promise.all([
      service.from('b2b_ad_spend').upsert(campaignRecords, { onConflict: 'spend_date,platform,campaign_id' }).then(r => r.error),
      service.from('b2b_ad_sets').upsert(adsetRecords,    { onConflict: 'spend_date,platform,campaign_id,adset_id' }).then(r => r.error),
      service.from('b2b_ads').upsert(ads,                 { onConflict: 'spend_date,platform,campaign_id,adset_id,ad_id' }).then(r => r.error),
    ]);

    const errors = [campErr, adsetErr, adErr].filter(Boolean).map(e => e!.message);
    if (errors.length) return NextResponse.json({ error: errors.join('; ') }, { status: 500 });

    return NextResponse.json({
      success: true,
      campaigns: campaignRecords.length,
      adsets:    adsetRecords.length,
      ads:       ads.length,
    });
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
}
