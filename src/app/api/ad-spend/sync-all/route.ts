import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { validateWebhookSecret } from '@/lib/api-auth';

// Single-shot client sync: fetches ad-level data from Meta once, aggregates to
// adset + campaign levels server-side, and upserts ad_spend + ad_campaigns
// (all three levels) in one request. Replaces the 3-module per-client Make blueprint.
// Body: { client_name, date, platform, meta_token, account_id }

export async function POST(req: Request) {
  try {
    if (!validateWebhookSecret(req)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payload = await req.json();
    const { client_name, date, platform, meta_token, account_id } = payload;

    if (!client_name)  return NextResponse.json({ error: 'client_name required' }, { status: 400 });
    if (!date || !platform) return NextResponse.json({ error: 'date and platform required' }, { status: 400 });
    if (!meta_token)   return NextResponse.json({ error: 'meta_token required' }, { status: 400 });
    if (!account_id)   return NextResponse.json({ error: 'account_id required' }, { status: 400 });
    if (!['meta', 'google', 'local_services'].includes(platform)) {
      return NextResponse.json({ error: 'invalid platform' }, { status: 400 });
    }

    const service = createServiceClient();

    // ── Resolve client_id from name ─────────────────────────────────────
    const { data: client } = await service.from('clients').select('id').eq('name', client_name).single();
    if (!client) return NextResponse.json({ error: `Client "${client_name}" not found` }, { status: 400 });
    const client_id = client.id as string;

    // ── Fetch ad-level insights from Meta ───────────────────────────────
    const params = new URLSearchParams({
      fields: 'ad_id,ad_name,adset_id,adset_name,campaign_id,campaign_name,spend,impressions,reach,frequency,inline_link_clicks,unique_inline_link_clicks,unique_link_clicks_ctr,ctr,cpc,cpm,actions,cost_per_action_type',
      time_range: JSON.stringify({ since: date, until: date }),
      level: 'ad',
      access_token: meta_token,
    });

    const metaRes = await fetch(`https://graph.facebook.com/v19.0/${account_id}/insights?${params}`);
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

    // ── Campaign entities: budget / status / objective ──────────────────
    // These are not insights fields, so they need a separate call. Treated as
    // best-effort — a failure here must not lose the spend data we already have.
    const campaignMeta = new Map<string, { budget: number | null; status: string | null; objective: string | null }>();
    try {
      const metaParams = new URLSearchParams({
        fields: 'id,name,daily_budget,lifetime_budget,status,objective',
        limit: '500',
        access_token: meta_token,
      });
      const cRes = await fetch(`https://graph.facebook.com/v19.0/${account_id}/campaigns?${metaParams}`);
      const cJson = await cRes.json() as { data?: Record<string, string>[]; error?: unknown };
      for (const c of cJson.data ?? []) {
        // Meta returns budgets in minor units (cents).
        const daily    = c.daily_budget    ? Number(c.daily_budget) / 100 : null;
        const lifetime = c.lifetime_budget ? Number(c.lifetime_budget) / 100 : null;
        campaignMeta.set(c.id, {
          budget: daily ?? lifetime ?? null,
          status: c.status ?? null,
          objective: c.objective ?? null,
        });
      }
    } catch {
      // Leave campaignMeta empty; budget/status/objective stay null.
    }

    // ── Aggregate to campaign and adset levels ──────────────────────────
    type Acc = {
      campaign_id: string; campaign_name: string; adset_id?: string; adset_name?: string;
      spend: number; impressions: number; reach: number; link_clicks: number;
      unique_clicks: number; leads: number;
    };

    // Meta reports conversions in an `actions` array; which action_type carries a
    // lead depends on whether the client uses an on-Meta lead form or a pixel.
    const LEAD_ACTIONS = new Set([
      'lead',
      'offsite_conversion.fb_pixel_lead',
      'onsite_conversion.lead_grouped',
    ]);
    const leadsFrom = (row: Record<string, unknown>) => {
      const actions = row.actions as { action_type?: string; value?: string }[] | undefined;
      if (!Array.isArray(actions)) return 0;
      return actions
        .filter(a => a.action_type && LEAD_ACTIONS.has(a.action_type))
        .reduce((sum, a) => sum + (parseInt(a.value ?? '0', 10) || 0), 0);
    };

    const campaigns = new Map<string, Acc>();
    const adsets    = new Map<string, Acc>();
    let totalSpend  = 0;

    const adCampaignRows: Record<string, unknown>[] = adRows.map(r => {
      const spend       = parseFloat(r.spend ?? '0') || 0;
      const impressions = parseInt(r.impressions ?? '0', 10);
      const reach       = parseInt(r.reach ?? '0', 10);
      const link_clicks = parseInt(r.inline_link_clicks ?? r.link_clicks ?? '0', 10);
      const unique_clicks = parseInt(r.unique_inline_link_clicks ?? '0', 10) || 0;
      const leads       = leadsFrom(r as unknown as Record<string, unknown>);
      totalSpend += spend;

      const cId = r.campaign_id ?? '';
      const cc  = campaigns.get(cId);
      if (!cc) campaigns.set(cId, { campaign_id: cId, campaign_name: r.campaign_name ?? '', spend, impressions, reach, link_clicks, unique_clicks, leads });
      else { cc.spend += spend; cc.impressions += impressions; cc.reach += reach; cc.link_clicks += link_clicks; cc.unique_clicks += unique_clicks; cc.leads += leads; }

      const aId = r.adset_id ?? '';
      const ac  = adsets.get(aId);
      if (!ac) adsets.set(aId, { campaign_id: cId, campaign_name: r.campaign_name ?? '', adset_id: aId, adset_name: r.adset_name ?? '', spend, impressions, reach, link_clicks, unique_clicks, leads });
      else { ac.spend += spend; ac.impressions += impressions; ac.reach += reach; ac.link_clicks += link_clicks; ac.unique_clicks += unique_clicks; ac.leads += leads; }

      return {
        client_id, report_date: date, platform, level: 'ad',
        campaign_id: cId, campaign_name: r.campaign_name ?? '',
        adset_id: r.adset_id ?? '', adset_name: r.adset_name ?? null,
        ad_id: r.ad_id ?? '', ad_name: r.ad_name ?? null,
        spend,
        impressions: impressions || 0, reach: reach || 0, link_clicks: link_clicks || 0,
        frequency:     r.frequency ? parseFloat(r.frequency) : (reach > 0 ? impressions / reach : null),
        unique_clicks: unique_clicks || 0,
        unique_ctr:    r.unique_link_clicks_ctr ? parseFloat(r.unique_link_clicks_ctr) : (reach > 0 ? (unique_clicks / reach) * 100 : null),
        leads,
        ctr: r.ctr ? parseFloat(r.ctr) : null,
        cpc: r.cpc ? parseFloat(r.cpc) : null,
        cpm: r.cpm ? parseFloat(r.cpm) : null,
      };
    });

    // Rates at rolled-up levels come from summed totals, never from averaging the
    // per-ad rates. Meta's unique CTR is unique link clicks over reach.
    const derived = (a: Acc) => ({
      ctr:        a.impressions > 0 ? (a.link_clicks / a.impressions) * 100 : null,
      cpc:        a.link_clicks  > 0 ? a.spend / a.link_clicks : null,
      cpm:        a.impressions  > 0 ? (a.spend / a.impressions) * 1000 : null,
      frequency:  a.reach        > 0 ? a.impressions / a.reach : null,
      unique_ctr: a.reach        > 0 ? (a.unique_clicks / a.reach) * 100 : null,
      unique_clicks: a.unique_clicks,
      leads:      a.leads,
    });

    const campaignRows = Array.from(campaigns.values()).map(c => ({
      client_id, report_date: date, platform, level: 'campaign',
      campaign_id: c.campaign_id, campaign_name: c.campaign_name,
      adset_id: '', adset_name: null, ad_id: '', ad_name: null,
      budget:    campaignMeta.get(c.campaign_id)?.budget    ?? null,
      status:    campaignMeta.get(c.campaign_id)?.status    ?? null,
      objective: campaignMeta.get(c.campaign_id)?.objective ?? null,
      spend: c.spend, impressions: c.impressions, reach: c.reach, link_clicks: c.link_clicks,
      ...derived(c),
    }));

    const adsetRows = Array.from(adsets.values()).map(a => ({
      client_id, report_date: date, platform, level: 'adset',
      campaign_id: a.campaign_id, campaign_name: a.campaign_name,
      adset_id: a.adset_id!, adset_name: a.adset_name ?? null, ad_id: '', ad_name: null,
      spend: a.spend, impressions: a.impressions, reach: a.reach, link_clicks: a.link_clicks,
      ...derived(a),
    }));

    // ── Upsert all tables in parallel ───────────────────────────────────
    const allCampaignRows = [...campaignRows, ...adsetRows, ...adCampaignRows];
    const [spendErr, campErr] = await Promise.all([
      service.from('ad_spend').upsert(
        { client_id, spend_date: date, platform, amount: totalSpend },
        { onConflict: 'client_id,spend_date,platform' }
      ).then(r => r.error),
      service.from('ad_campaigns').upsert(allCampaignRows, {
        onConflict: 'client_id,report_date,platform,level,campaign_id,adset_id,ad_id',
      }).then(r => r.error),
    ]);

    const errors = [spendErr, campErr].filter(Boolean).map(e => e!.message);
    if (errors.length) return NextResponse.json({ error: errors.join('; ') }, { status: 500 });

    return NextResponse.json({
      success: true,
      total_spend: totalSpend,
      campaigns: campaignRows.length,
      adsets:    adsetRows.length,
      ads:       adCampaignRows.length,
    });
  } catch (e) {
    return NextResponse.json({ error: `Invalid request: ${e}` }, { status: 400 });
  }
}
