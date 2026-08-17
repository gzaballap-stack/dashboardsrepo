import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { validateWebhookSecret } from '@/lib/api-auth';
import { MOCK_CLIENT_CONFIGS, generateDayData } from '@/lib/mock-generator';

// How far back each client's history should go — ordered to match MOCK_CLIENT_CONFIGS
const CLIENT_START_DAYS = [
  720, // Premier Bath & Kitchen      → ~2 years
  660, // Coastal Renovations LLC     → ~22 months
  600, // Heritage Home Remodeling    → ~20 months
  540, // Modern Living Spaces        → ~18 months
  510, // Elite Kitchen & Bath        → ~17 months
  480, // Prestige Kitchen Designs    → ~16 months
  450, // Diamond Bath Solutions      → ~15 months
  420, // Sunrise Home Renovations    → ~14 months
  390, // ProCraft Remodeling         → ~13 months
  360, // Apex Home Improvements      → ~12 months
  330, // BlueSky Renovations         → ~11 months
  300, // Golden Gate Remodeling      → ~10 months
  270, // Signature Bath Co           → ~9 months
  240, // American Dream Renovations  → ~8 months
  210, // Summit Home Solutions       → ~7 months
  195, // Craftsman Kitchen Group     → ~6.5 months
  180, // Lakeside Renovations        → 6 months
];

const BATCH = 500;

export async function POST(req: Request) {
  if (!validateWebhookSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const service = createServiceClient();

  const { data: clients, error: ce } = await service
    .from('clients')
    .select('id, name')
    .in('name', MOCK_CLIENT_CONFIGS.map(c => c.name));

  if (ce || !clients?.length) {
    return NextResponse.json({ error: ce?.message ?? 'No mock clients found' }, { status: 400 });
  }

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const log: string[] = [];
  let totalEvents = 0;

  for (let ci = 0; ci < MOCK_CLIENT_CONFIGS.length; ci++) {
    const config = MOCK_CLIENT_CONFIGS[ci];
    const client = clients.find(c => c.name === config.name);
    if (!client) { log.push(`${config.name}: not found in DB`); continue; }

    const targetDaysAgo = CLIENT_START_DAYS[ci] ?? 180;
    const targetStart = new Date(today);
    targetStart.setUTCDate(targetStart.getUTCDate() - targetDaysAgo);

    // Find this client's earliest existing event to avoid duplicates
    const { data: earliest } = await service
      .from('events')
      .select('occurred_at')
      .eq('client_id', client.id)
      .order('occurred_at', { ascending: true })
      .limit(1)
      .maybeSingle();

    // Backfill ends the day before their earliest existing event
    let backfillEnd: Date;
    if (earliest?.occurred_at) {
      backfillEnd = new Date(earliest.occurred_at.slice(0, 10) + 'T00:00:00Z');
      backfillEnd.setUTCDate(backfillEnd.getUTCDate() - 1);
    } else {
      backfillEnd = new Date(today);
      backfillEnd.setUTCDate(backfillEnd.getUTCDate() - 1);
    }

    // Always stamp the client's created_at to match their target start
    await service
      .from('clients')
      .update({ created_at: targetStart.toISOString() })
      .eq('id', client.id);

    if (targetStart > backfillEnd) {
      log.push(`${config.name}: already backfilled (earliest event: ${earliest?.occurred_at?.slice(0, 10) ?? 'none'})`);
      continue;
    }

    // Generate events for each missing day, one client at a time to keep memory low
    const events: object[] = [];
    const spends: object[] = [];

    const d = new Date(targetStart);
    while (d <= backfillEnd) {
      const dateStr = d.toISOString().slice(0, 10);
      const { events: dayEvents, spends: daySpends } = generateDayData(dateStr, client.id, ci, config);
      events.push(...dayEvents);
      spends.push(...daySpends);
      d.setUTCDate(d.getUTCDate() + 1);
    }

    // Ensure every event row has revenue set — PostgREST normalises mixed
    // arrays by filling absent fields with null, which trips the NOT NULL constraint.
    const safeEvents = events.map((e: any) => ({ revenue: 0, ...e }));

    let insertOk = true;
    for (let i = 0; i < safeEvents.length; i += BATCH) {
      const { error } = await service
        .from('events')
        .insert(safeEvents.slice(i, i + BATCH) as never);
      if (error) {
        log.push(`${config.name}: ERROR inserting events — ${error.message}`);
        insertOk = false;
        break;
      }
    }

    if (insertOk) {
      for (let i = 0; i < spends.length; i += BATCH) {
        await service
          .from('ad_spend')
          .upsert(spends.slice(i, i + BATCH) as never, { onConflict: 'client_id,spend_date,platform' });
      }

      const days = Math.round((backfillEnd.getTime() - targetStart.getTime()) / 86_400_000) + 1;
      log.push(`${config.name}: +${days} days, ${events.length} events (history starts ${targetStart.toISOString().slice(0, 10)})`);
      totalEvents += events.length;
    }
  }

  return NextResponse.json({ success: true, log, total_events_inserted: totalEvents });
}
