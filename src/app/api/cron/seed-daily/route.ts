import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { validateWebhookSecret } from '@/lib/api-auth';
import { MOCK_CLIENT_CONFIGS, generateDayData } from '@/lib/mock-generator';

export async function POST(req: Request) {
  if (!validateWebhookSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Allow override via body: { "date": "YYYY-MM-DD" } for backfilling
  let dateStr: string;
  try {
    const body = await req.json().catch(() => ({}));
    if (body.date && /^\d{4}-\d{2}-\d{2}$/.test(body.date)) {
      dateStr = body.date;
    } else {
      const yesterday = new Date();
      yesterday.setUTCDate(yesterday.getUTCDate() - 1);
      yesterday.setUTCHours(0, 0, 0, 0);
      dateStr = yesterday.toISOString().slice(0, 10);
    }
  } catch {
    const yesterday = new Date();
    yesterday.setUTCDate(yesterday.getUTCDate() - 1);
    dateStr = yesterday.toISOString().slice(0, 10);
  }

  const service = createServiceClient();

  // Fetch mock client IDs
  const { data: clients, error: clientErr } = await service
    .from('clients')
    .select('id, name')
    .in('name', MOCK_CLIENT_CONFIGS.map(c => c.name));

  if (clientErr || !clients?.length) {
    return NextResponse.json(
      { error: 'Mock clients not found — run POST /api/admin/seed-v2 first.' },
      { status: 400 },
    );
  }

  // Guard: skip if this date is already seeded for any mock client
  const { count: existing } = await service
    .from('events')
    .select('id', { count: 'exact', head: true })
    .in('client_id', clients.map(c => c.id))
    .gte('occurred_at', `${dateStr}T00:00:00Z`)
    .lte('occurred_at', `${dateStr}T23:59:59Z`);

  if ((existing ?? 0) > 0) {
    return NextResponse.json({ message: `Already seeded for ${dateStr}`, existing });
  }

  let totalEvents = 0;
  let totalSpends = 0;
  let totalCampaigns = 0;

  for (let ci = 0; ci < MOCK_CLIENT_CONFIGS.length; ci++) {
    const config = MOCK_CLIENT_CONFIGS[ci];
    const client = clients.find(c => c.name === config.name);
    if (!client) continue;

    const { events, spends, campaigns } = generateDayData(dateStr, client.id, ci, config);

    if (events.length > 0) {
      const { error } = await service.from('events').insert(events as never);
      if (error) return NextResponse.json({ error: `Events for ${config.name}: ${error.message}` }, { status: 500 });
      totalEvents += events.length;
    }

    if (spends.length > 0) {
      const { error } = await service
        .from('ad_spend')
        .upsert(spends as never, { onConflict: 'client_id,spend_date,platform' });
      if (error) return NextResponse.json({ error: `Spend for ${config.name}: ${error.message}` }, { status: 500 });
      totalSpends += spends.length;
    }

    if (campaigns.length > 0) {
      const { error } = await service
        .from('ad_campaigns')
        .upsert(campaigns as never, { onConflict: 'client_id,report_date,platform,level,campaign_id,adset_id,ad_id' });
      if (error) return NextResponse.json({ error: `Campaigns for ${config.name}: ${error.message}` }, { status: 500 });
      totalCampaigns += campaigns.length;
    }
  }

  return NextResponse.json({ success: true, date: dateStr, events: totalEvents, spends: totalSpends, campaigns: totalCampaigns });
}
