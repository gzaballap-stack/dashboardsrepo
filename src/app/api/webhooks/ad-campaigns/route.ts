import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { validateWebhookSecret } from '@/lib/api-auth';

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

// Fed by Make.com pulling each platform's native ads-reporting module (see
// ccm-ad-campaigns.blueprint.json) — one call per sync, carrying every
// campaign/ad-set/ad row for that run. Accepts a single row or a { rows: [...] }
// batch, matching how Make's iterator naturally produces one bundle per entity.
export async function POST(req: Request) {
  if (!validateWebhookSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json();
  const rows: IncomingRow[] = Array.isArray(body) ? body : Array.isArray(body.rows) ? body.rows : [body];

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
        const { data: client } = await service.from('clients').select('id').eq('name', row.client_name).maybeSingle();
        if (!client?.id) {
          errors.push(`row ${i}: client "${row.client_name}" not found`);
          continue;
        }
        client_id = client.id;
        clientCache.set(row.client_name, client.id);
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
