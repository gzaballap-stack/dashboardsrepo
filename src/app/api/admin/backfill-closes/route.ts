import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { validateWebhookSecret } from '@/lib/api-auth';
import { MOCK_CLIENT_CONFIGS } from '@/lib/mock-generator';

const CLOSE_RATE = 0.24;
const AVG_REVENUE = 23000;

function seededRng(seed: number) {
  let s = seed;
  return () => { s = (s * 1664525 + 1013904223) & 0xffffffff; return (s >>> 0) / 0xffffffff; };
}

export async function POST(req: Request) {
  if (!validateWebhookSecret(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const service = createServiceClient();
  const mockNames = MOCK_CLIENT_CONFIGS.map(c => c.name);

  const { data: clients, error: ce } = await service
    .from('clients').select('id').in('name', mockNames);
  if (ce || !clients?.length) return NextResponse.json({ error: 'Mock clients not found' }, { status: 400 });

  const clientIds = clients.map(c => c.id);

  // Fetch all existing show events for mock clients
  const { data: shows, error: se } = await service
    .from('events')
    .select('id, client_id, occurred_at')
    .in('client_id', clientIds)
    .eq('event_type', 'show');
  if (se) return NextResponse.json({ error: se.message }, { status: 500 });

  // Remove any existing close events first to avoid duplicates
  await service.from('events').delete().in('client_id', clientIds).eq('event_type', 'closed');

  // Generate closes for ~27% of shows
  const closes = (shows ?? [])
    .map((show, i) => {
      const rng = seededRng(i * 7919 + 42);
      if (rng() >= CLOSE_RATE) return null;
      const revenue = Math.round(AVG_REVENUE * (0.8 + rng() * 0.4));
      const t = new Date(show.occurred_at);
      t.setMinutes(t.getMinutes() + Math.floor(rng() * 60) + 30);
      return { client_id: show.client_id, event_type: 'closed', occurred_at: t.toISOString(), revenue };
    })
    .filter(Boolean);

  const CHUNK = 500;
  for (let i = 0; i < closes.length; i += CHUNK) {
    const { error } = await service.from('events').insert(closes.slice(i, i + CHUNK) as never);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, shows: shows?.length ?? 0, closes_inserted: closes.length });
}
