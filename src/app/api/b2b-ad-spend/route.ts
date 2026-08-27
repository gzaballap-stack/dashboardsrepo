import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { validateWebhookSecret } from '@/lib/api-auth';

export async function POST(req: Request) {
  try {
    if (!validateWebhookSecret(req)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const payload = await req.json();
    const { date, platform } = payload;
    const service = createServiceClient();

    let amount: number;
    let impressions: number | undefined;
    let reach: number | undefined;
    let link_clicks: number | undefined;
    let ctr: number | undefined;
    let cpc: number | undefined;
    let cpm: number | undefined;

    // Path A: Make sends pre-fetched Meta data directly (preferred)
    if (payload.spend !== undefined) {
      amount = parseFloat(String(payload.spend)) || 0;
      impressions  = payload.impressions  != null ? parseInt(String(payload.impressions),  10) : undefined;
      reach        = payload.reach        != null ? parseInt(String(payload.reach),        10) : undefined;
      link_clicks  = payload.link_clicks  != null ? parseInt(String(payload.link_clicks),  10) : undefined;
      ctr          = payload.ctr          != null ? parseFloat(String(payload.ctr))            : undefined;
      cpc          = payload.cpc          != null ? parseFloat(String(payload.cpc))            : undefined;
      cpm          = payload.cpm          != null ? parseFloat(String(payload.cpm))            : undefined;
    }
    // Path B: legacy — credentials passed in, fetch spend server-side
    else if (payload.meta_entity_id && payload.meta_access_token) {
      const spendDate = (date as string) || new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      const params = new URLSearchParams({
        fields: 'spend,impressions,reach,link_clicks,ctr,cpc,cpm',
        time_range: JSON.stringify({ since: spendDate, until: spendDate }),
        level: 'account',
        access_token: payload.meta_access_token,
      });
      const metaRes = await fetch(
        `https://graph.facebook.com/v19.0/${payload.meta_entity_id}/insights?${params}`
      );
      const metaJson = await metaRes.json() as { data?: Record<string, string>[]; error?: { message: string } };
      if (metaJson.error) {
        return NextResponse.json({ error: `Meta API: ${metaJson.error.message}` }, { status: 502 });
      }
      const row = metaJson.data?.[0] ?? {};
      amount      = parseFloat(row.spend      ?? '0') || 0;
      impressions = row.impressions  != null ? parseInt(row.impressions,  10) : undefined;
      reach       = row.reach        != null ? parseInt(row.reach,        10) : undefined;
      link_clicks = row.link_clicks  != null ? parseInt(row.link_clicks,  10) : undefined;
      ctr         = row.ctr          != null ? parseFloat(row.ctr)            : undefined;
      cpc         = row.cpc          != null ? parseFloat(row.cpc)            : undefined;
      cpm         = row.cpm          != null ? parseFloat(row.cpm)            : undefined;
    }
    // Path C: explicit amount passed
    else if (payload.amount !== undefined) {
      amount = parseFloat(String(payload.amount)) || 0;
    } else {
      return NextResponse.json({ error: 'Provide spend, amount, or meta_entity_id+meta_access_token' }, { status: 400 });
    }

    if (!date || !platform) {
      return NextResponse.json({ error: 'date and platform are required' }, { status: 400 });
    }
    if (!['meta', 'google', 'local_services'].includes(platform)) {
      return NextResponse.json({ error: 'platform must be "meta", "google", or "local_services"' }, { status: 400 });
    }

    const campaign_id   = payload.campaign_id   ? String(payload.campaign_id)   : '';
    const campaign_name = payload.campaign_name ? String(payload.campaign_name) : null;

    const record: Record<string, unknown> = { spend_date: date, platform, amount, campaign_id };
    if (campaign_name !== null) record.campaign_name = campaign_name;
    if (impressions !== undefined) record.impressions = impressions;
    if (reach       !== undefined) record.reach       = reach;
    if (link_clicks !== undefined) record.link_clicks = link_clicks;
    if (ctr         !== undefined) record.ctr         = ctr;
    if (cpc         !== undefined) record.cpc         = cpc;
    if (cpm         !== undefined) record.cpm         = cpm;

    const { error } = await service
      .from('b2b_ad_spend')
      .upsert(record, { onConflict: 'spend_date,platform,campaign_id' });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ success: true, date, platform, amount });
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
}
