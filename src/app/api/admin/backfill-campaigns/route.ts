import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { validateWebhookSecret } from '@/lib/api-auth';
import { MOCK_CLIENT_CONFIGS, generateCampaignsForSpend, seedForDay } from '@/lib/mock-generator';

// One-off backfill: populates ad_campaigns for V2 demo clients' already-existing
// ad_spend history. generateDayData now generates campaigns for new days going
// forward automatically, but seed-daily's "already seeded" guard means it never
// re-runs for past dates, so historical days need this instead. Reads existing
// ad_spend rows directly rather than regenerating events/spend at all.
export async function POST(req: Request) {
  if (!validateWebhookSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const service = createServiceClient();

  const { data: clients, error: clientErr } = await service
    .from('clients')
    .select('id, name')
    .in('name', MOCK_CLIENT_CONFIGS.map(c => c.name));

  if (clientErr || !clients?.length) {
    return NextResponse.json({ error: 'Mock clients not found' }, { status: 400 });
  }
  const clientIndexByName = new Map(MOCK_CLIENT_CONFIGS.map((c, i) => [c.name, i]));
  const clientIdToIndex = new Map(clients.map(c => [c.id, clientIndexByName.get(c.name)!]));

  const clientIds = clients.map(c => c.id);
  const PAGE = 1000;
  const allSpend: { client_id: string; spend_date: string; platform: string; amount: number }[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await service
      .from('ad_spend')
      .select('client_id, spend_date, platform, amount')
      .in('client_id', clientIds)
      .range(offset, offset + PAGE - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data || data.length === 0) break;
    allSpend.push(...data);
    if (data.length < PAGE) break;
    offset += PAGE;
  }

  // Group by client_id + spend_date
  const groups = new Map<string, { client_id: string; date: string; rows: typeof allSpend }>();
  for (const row of allSpend) {
    const key = `${row.client_id}|${row.spend_date}`;
    const g = groups.get(key) ?? { client_id: row.client_id, date: row.spend_date, rows: [] };
    g.rows.push(row);
    groups.set(key, g);
  }

  let totalCampaigns = 0;
  const upserts: unknown[] = [];

  for (const g of groups.values()) {
    const clientIndex = clientIdToIndex.get(g.client_id);
    if (clientIndex === undefined) continue;
    const rng = seedForDay(g.date, clientIndex);
    const campaigns = generateCampaignsForSpend(g.client_id, clientIndex, g.date, g.rows, rng);
    upserts.push(...campaigns);
  }

  const BATCH = 500;
  for (let i = 0; i < upserts.length; i += BATCH) {
    const batch = upserts.slice(i, i + BATCH);
    const { error } = await service
      .from('ad_campaigns')
      .upsert(batch as never, { onConflict: 'client_id,report_date,platform,level,campaign_id,adset_id,ad_id' });
    if (error) return NextResponse.json({ error: error.message, inserted_so_far: totalCampaigns }, { status: 500 });
    totalCampaigns += batch.length;
  }

  return NextResponse.json({ success: true, spend_rows_processed: allSpend.length, campaigns_upserted: totalCampaigns });
}
