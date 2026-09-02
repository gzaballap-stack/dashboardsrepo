import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { validateWebhookSecret } from '@/lib/api-auth';
import { resolveClientId } from '@/lib/client-lookup';

const PLATFORMS = ['meta', 'google', 'local_services'] as const;
const LEVELS = ['campaign', 'adset', 'ad'] as const;

type IncomingRow = {
  client_id?: string;
  client_name?: string;
  report_date: string;
  platform: typeof PLATFORMS[number];
  level: typeof LEVELS[number];
  campaign_id: string;
  campaign_name: string;
  adset_id?: string;
  adset_name?: string;
  ad_id?: string;
  ad_name?: string;
  status?: string;
  objective?: string;
  budget?: number;
  spend?: number;
  impressions?: number;
  reach?: number;
  frequency?: number;
  link_clicks?: number;
  unique_clicks?: number;
  cpm?: number;
  cpc?: number;
  ctr?: number;
  unique_ctr?: number;
  leads?: number;
};

const META_FIELDS = 'campaign_id,campaign_name,spend,impressions,reach,frequency,inline_link_clicks,unique_inline_link_clicks,cpm,cpc,ctr,unique_link_clicks_ctr';

// Same pattern as /api/ad-spend's meta_entity_id/meta_access_token fetch: rather
// than requiring Make to iterate the Meta API's response array itself (fragile to
// hand-author in a blueprint), we take the account id + token straight from the
// existing ad-spend scenario's fields and pull + upsert every campaign server-side.
async function fetchMetaCampaignRows(entityId: string, accessToken: string, date: string) {
  const params = new URLSearchParams({
    fields: META_FIELDS,
    time_range: JSON.stringify({ since: date, until: date }),
    level: 'campaign',
    access_token: accessToken,
  });
  const res = await fetch(`https://graph.facebook.com/v19.0/${entityId}/insights?${params}`);
  const json = await res.json() as { data?: Record<string, string>[]; error?: { message: string } };
  if (json.error) throw new Error(`Meta API: ${json.error.message}`);

  return (json.data ?? []).map((d): IncomingRow => ({
    report_date: date,
    platform: 'meta',
    level: 'campaign',
    campaign_id: d.campaign_id,
    campaign_name: d.campaign_name,
    spend: Number(d.spend) || 0,
    impressions: Number(d.impressions) || 0,
    reach: Number(d.reach) || 0,
    frequency: d.frequency ? Number(d.frequency) : undefined,
    link_clicks: Number(d.inline_link_clicks) || 0,
    unique_clicks: d.unique_inline_link_clicks ? Number(d.unique_inline_link_clicks) : undefined,
    cpm: d.cpm ? Number(d.cpm) : undefined,
    cpc: d.cpc ? Number(d.cpc) : undefined,
    ctr: d.ctr ? Number(d.ctr) : undefined,
    unique_ctr: d.unique_link_clicks_ctr ? Number(d.unique_link_clicks_ctr) : undefined,
  }));
}

// Fed by Make.com — either a { rows: [...] } / single-row batch already carrying
// campaign data, or { client_name, date, meta_entity_id, meta_access_token } to have
// this route pull campaign-level insights from Meta itself (mirrors /api/ad-spend).
export async function POST(req: Request) {
  if (!validateWebhookSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json();
  let rows: IncomingRow[];

  if (body.meta_entity_id && body.meta_access_token) {
    const date = body.date || new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    try {
      rows = (await fetchMetaCampaignRows(body.meta_entity_id, body.meta_access_token, date))
        .map(r => ({ ...r, client_name: body.client_name, client_id: body.client_id }));
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : 'Meta fetch failed' }, { status: 502 });
    }
  } else {
    rows = Array.isArray(body) ? body : Array.isArray(body.rows) ? body.rows : [body];
  }

  if (!rows.length) {
    return NextResponse.json({ error: 'No rows provided' }, { status: 400 });
  }

  const service = createServiceClient();
  const clientCache = new Map<string, string>();
  const upserts: Record<string, unknown>[] = [];
  const errors: string[] = [];

  for (const [i, row] of rows.entries()) {
    if (!row.report_date || !row.platform || !row.level || !row.campaign_id || !row.campaign_name) {
      errors.push(`row ${i}: report_date, platform, level, campaign_id, campaign_name are required`);
      continue;
    }
    if (!PLATFORMS.includes(row.platform)) {
      errors.push(`row ${i}: platform must be one of ${PLATFORMS.join(', ')}`);
      continue;
    }
    if (!LEVELS.includes(row.level)) {
      errors.push(`row ${i}: level must be one of ${LEVELS.join(', ')}`);
      continue;
    }

    let client_id = row.client_id;
    if (!client_id && row.client_name) {
      client_id = clientCache.get(row.client_name);
      if (!client_id) {
        const resolved = await resolveClientId(service, row.client_name);
        if (!resolved) {
          errors.push(`row ${i}: client "${row.client_name}" not found`);
          continue;
        }
        client_id = resolved;
        clientCache.set(row.client_name, resolved);
      }
    }
    if (!client_id) {
      errors.push(`row ${i}: client_id or client_name is required`);
      continue;
    }

    upserts.push({
      client_id,
      report_date: row.report_date,
      platform: row.platform,
      level: row.level,
      campaign_id: row.campaign_id,
      campaign_name: row.campaign_name,
      adset_id: row.adset_id ?? '',
      adset_name: row.adset_name ?? null,
      ad_id: row.ad_id ?? '',
      ad_name: row.ad_name ?? null,
      status: row.status ?? null,
      objective: row.objective ?? null,
      budget: row.budget ?? null,
      spend: row.spend ?? 0,
      impressions: row.impressions ?? 0,
      reach: row.reach ?? 0,
      frequency: row.frequency ?? null,
      link_clicks: row.link_clicks ?? 0,
      unique_clicks: row.unique_clicks ?? null,
      cpm: row.cpm ?? null,
      cpc: row.cpc ?? null,
      ctr: row.ctr ?? null,
      unique_ctr: row.unique_ctr ?? null,
      leads: row.leads ?? 0,
      updated_at: new Date().toISOString(),
    });
  }

  if (!upserts.length) {
    return NextResponse.json({ error: 'No valid rows', row_errors: errors }, { status: 400 });
  }

  const { error } = await service
    .from('ad_campaigns')
    .upsert(upserts, { onConflict: 'client_id,report_date,platform,level,campaign_id,adset_id,ad_id' });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    success: true,
    rows_upserted: upserts.length,
    row_errors: errors.length ? errors : undefined,
  });
}
