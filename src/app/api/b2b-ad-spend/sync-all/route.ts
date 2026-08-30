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
      fields: 'ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,spend,impressions,reach,frequency,inline_link_clicks,unique_inline_link_clicks,unique_link_clicks_ctr,ctr,cpc,cpm,actions,cost_per_action_type',
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

    // Budget/status/objective are entity fields, not insights — separate call.
    const campaignMeta = new Map<string, { budget: number | null; status: string | null; objective: string | null }>();
    try {
      const mp = new URLSearchParams({ fields: 'id,name,daily_budget,lifetime_budget,status,objective', limit: '500', access_token: meta_token });
      const cRes = await fetch(`https://graph.facebook.com/v19.0/${acct}/campaigns?${mp}`);
      const cJson = await cRes.json() as { data?: Record<string, string>[] };
      for (const c of cJson.data ?? []) {
        const daily = c.daily_budget ? Number(c.daily_budget) / 100 : null;
        const life  = c.lifetime_budget ? Number(c.lifetime_budget) / 100 : null;
        campaignMeta.set(c.id, { budget: daily ?? life ?? null, status: c.status ?? null, objective: c.objective ?? null });
      }
    } catch { /* budget stays null */ }

    // ── 2. Aggregate to campaign and adset levels ───────────────────────
    type CampAcc  = { campaign_id: string; campaign_name: string; spend: number; impressions: number; reach: number; link_clicks: number; unique_clicks: number; leads: number };
    type AdSetAcc = { campaign_id: string; campaign_name: string; adset_id: string; adset_name: string; spend: number; impressions: number; reach: number; link_clicks: number; unique_clicks: number; leads: number };

    const LEAD_ACTIONS = new Set(['lead', 'offsite_conversion.fb_pixel_lead', 'onsite_conversion.lead_grouped']);
    const leadsFrom = (row: Record<string, unknown>) => {
      const actions = row.actions as { action_type?: string; value?: string }[] | undefined;
      if (!Array.isArray(actions)) return 0;
      return actions.filter(a => a.action_type && LEAD_ACTIONS.has(a.action_type))
        .reduce((sum, a) => sum + (parseInt(a.value ?? '0', 10) || 0), 0);
    };

    const campaigns = new Map<string, CampAcc>();
    const adsets    = new Map<string, AdSetAcc>();

    const ads = adRows.map(r => {
      const spend       = parseFloat(r.spend        ?? '0') || 0;
      const impressions = parseInt(r.impressions     ?? '0', 10);
      const reach       = parseInt(r.reach           ?? '0', 10);
      const link_clicks = parseInt(r.inline_link_clicks ?? r.link_clicks ?? '0', 10);
      const unique_clicks = parseInt(r.unique_inline_link_clicks ?? '0', 10) || 0;
      const leads = leadsFrom(r as unknown as Record<string, unknown>);

      // campaign rollup
      const cId = r.campaign_id ?? '';
      const cc  = campaigns.get(cId);
      if (!cc) campaigns.set(cId, { campaign_id: cId, campaign_name: r.campaign_name ?? '', spend, impressions, reach, link_clicks, unique_clicks, leads });
      else     { cc.spend += spend; cc.impressions += impressions; cc.reach += reach; cc.link_clicks += link_clicks; cc.unique_clicks += unique_clicks; cc.leads += leads; }

      // adset rollup
      const aId = r.adset_id ?? '';
      const ac  = adsets.get(aId);
      if (!ac) adsets.set(aId, { campaign_id: cId, campaign_name: r.campaign_name ?? '', adset_id: aId, adset_name: r.adset_name ?? '', spend, impressions, reach, link_clicks, unique_clicks, leads });
      else     { ac.spend += spend; ac.impressions += impressions; ac.reach += reach; ac.link_clicks += link_clicks; ac.unique_clicks += unique_clicks; ac.leads += leads; }

      return {
        spend_date: date, platform,
        campaign_id: cId, campaign_name: r.campaign_name ?? null,
        adset_id: aId,   adset_name:    r.adset_name    ?? null,
        ad_id:    r.ad_id ?? '', ad_name: r.ad_name ?? null,
        spend,
        impressions: impressions || null,
        reach:       reach       || null,
        link_clicks: link_clicks || null,
        frequency:     r.frequency ? parseFloat(r.frequency) : (reach > 0 ? impressions / reach : null),
        unique_clicks: unique_clicks || null,
        unique_ctr:    r.unique_link_clicks_ctr ? parseFloat(r.unique_link_clicks_ctr) : (reach > 0 ? (unique_clicks / reach) * 100 : null),
        leads,
        ctr: r.ctr ? parseFloat(r.ctr) : null,
        cpc: r.cpc ? parseFloat(r.cpc) : null,
        cpm: r.cpm ? parseFloat(r.cpm) : null,
      };
    });

    // Derive CTR/CPC/CPM from totals (more accurate than averaging rates)
    const toMetrics = (a: { spend: number; impressions: number; reach: number; link_clicks: number; unique_clicks: number; leads: number }) => ({
      ctr:           a.impressions > 0 ? (a.link_clicks / a.impressions) * 100 : null,
      cpc:           a.link_clicks > 0 ? a.spend / a.link_clicks : null,
      cpm:           a.impressions > 0 ? (a.spend / a.impressions) * 1000 : null,
      frequency:     a.reach       > 0 ? a.impressions / a.reach : null,
      unique_clicks: a.unique_clicks || null,
      unique_ctr:    a.reach       > 0 ? (a.unique_clicks / a.reach) * 100 : null,
      leads:         a.leads,
    });

    const campaignRecords = Array.from(campaigns.values()).map(c => ({
      spend_date: date, platform,
      campaign_id: c.campaign_id, campaign_name: c.campaign_name,
      amount: c.spend,
      impressions: c.impressions || null, reach: c.reach || null, link_clicks: c.link_clicks || null,
      ...toMetrics(c),
      budget:    campaignMeta.get(c.campaign_id)?.budget    ?? null,
      status:    campaignMeta.get(c.campaign_id)?.status    ?? null,
      objective: campaignMeta.get(c.campaign_id)?.objective ?? null,
    }));

    const adsetRecords = Array.from(adsets.values()).map(a => ({
      spend_date: date, platform,
      campaign_id: a.campaign_id, campaign_name: a.campaign_name,
      adset_id: a.adset_id, adset_name: a.adset_name,
      spend: a.spend,
      impressions: a.impressions || null, reach: a.reach || null, link_clicks: a.link_clicks || null,
      ...toMetrics(a),
    }));

    // ── 3. Upsert all three tables ──────────────────────────────────────
    const service = createServiceClient();

    // Remove any pre-migration "total" row (campaign_id='') for this date/platform
    // so it doesn't double-count against the per-campaign rows we're about to write.
    await service.from('b2b_ad_spend').delete()
      .eq('spend_date', date).eq('platform', platform).eq('campaign_id', '');

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
