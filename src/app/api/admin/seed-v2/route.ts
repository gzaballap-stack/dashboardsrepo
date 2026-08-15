import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { validateWebhookSecret } from '@/lib/api-auth';
import { MOCK_CLIENT_CONFIGS, generateDayData } from '@/lib/mock-generator';

const BATCH = 500;

export async function POST(req: Request) {
  if (!validateWebhookSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const force = searchParams.get('force') === 'true';

  const service = createServiceClient();

  // 1. Upsert mock clients
  const clientRows: { id: string; name: string }[] = [];
  for (const config of MOCK_CLIENT_CONFIGS) {
    const { data, error } = await service
      .from('clients')
      .upsert({ name: config.name, is_live: true }, { onConflict: 'name' })
      .select('id, name')
      .single();
    if (error || !data) {
      return NextResponse.json({ error: `Client upsert failed: ${error?.message}` }, { status: 500 });
    }
    clientRows.push(data);
  }

  // 2. Guard against double-seeding unless ?force=true
  const { count } = await service
    .from('events')
    .select('id', { count: 'exact', head: true })
    .in('client_id', clientRows.map(c => c.id));

  if ((count ?? 0) > 0 && !force) {
    return NextResponse.json({
      message: 'Already seeded. Add ?force=true to wipe and re-seed.',
      event_count: count,
    });
  }

  if ((count ?? 0) > 0 && force) {
    const { error } = await service
      .from('events')
      .delete()
      .in('client_id', clientRows.map(c => c.id));
    if (error) return NextResponse.json({ error: `Delete failed: ${error.message}` }, { status: 500 });

    await service
      .from('ad_spend')
      .delete()
      .in('client_id', clientRows.map(c => c.id));
  }

  // 3. Generate 90 days of history (oldest → yesterday)
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const allEvents: object[] = [];
  const allSpends: object[] = [];

  for (let daysAgo = 90; daysAgo >= 1; daysAgo--) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - daysAgo);
    const dateStr = d.toISOString().slice(0, 10);

    for (let ci = 0; ci < MOCK_CLIENT_CONFIGS.length; ci++) {
      const { events, spends } = generateDayData(dateStr, clientRows[ci].id, ci, MOCK_CLIENT_CONFIGS[ci]);
      allEvents.push(...events);
      allSpends.push(...spends);
    }
  }

  // 4. Batch-insert events
  for (let i = 0; i < allEvents.length; i += BATCH) {
    const { error } = await service.from('events').insert(allEvents.slice(i, i + BATCH) as never);
    if (error) return NextResponse.json({ error: `Events batch ${i}: ${error.message}` }, { status: 500 });
  }

  // 5. Batch-upsert ad_spend
  for (let i = 0; i < allSpends.length; i += BATCH) {
    const { error } = await service
      .from('ad_spend')
      .upsert(allSpends.slice(i, i + BATCH) as never, { onConflict: 'client_id,spend_date,platform' });
    if (error) return NextResponse.json({ error: `Spend batch ${i}: ${error.message}` }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    clients: clientRows.map(c => c.name),
    events_inserted: allEvents.length,
    spends_inserted: allSpends.length,
    days_seeded: 90,
  });
}
