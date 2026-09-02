import { NextResponse } from 'next/server';
import { getAuthContext, isAuthError } from '@/lib/api-auth';
import { rollupEventZips, type ZipCounts } from '@/lib/zip-rollup';

type StoredRow = { zip_code: string } & Partial<ZipCounts> & Record<string, unknown>;

export async function GET(req: Request) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;

  const { searchParams } = new URL(req.url);
  const client_id = searchParams.get('client_id');
  if (!client_id) return NextResponse.json({ error: 'client_id required' }, { status: 400 });

  // Two sources: rows someone entered/seeded by hand, and the live rollup of the
  // client's own leads/appointments/shows/closes by the zip stamped on each event.
  const [{ data, error }, eventZips] = await Promise.all([
    ctx.service
      .from('zip_performance')
      .select('*')
      .eq('client_id', client_id)
      .order('zip_code'),
    rollupEventZips(ctx.service, client_id),
  ]);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const stored = new Map<string, StoredRow>();
  for (const row of (data ?? []) as StoredRow[]) stored.set(row.zip_code, row);

  // Where both exist, take the higher figure per metric: automatic attribution can
  // only ever add to a zip, never quietly erase numbers a team already recorded.
  const performance = [...new Set([...stored.keys(), ...Object.keys(eventZips)])]
    .sort()
    .map(zip_code => {
      const row = stored.get(zip_code);
      const live = eventZips[zip_code];
      if (!live) return { ...row, source: 'manual' as const };
      return {
        ...(row ?? { client_id, zip_code }),
        zip_code,
        leads:        Math.max(row?.leads        ?? 0, live.leads),
        appointments: Math.max(row?.appointments ?? 0, live.appointments),
        shows:        Math.max(row?.shows        ?? 0, live.shows),
        closes:       Math.max(row?.closes       ?? 0, live.closes),
        revenue:      Math.max(Number(row?.revenue ?? 0), live.revenue),
        source: 'events' as const,
      };
    });

  return NextResponse.json({ performance });
}

export async function PATCH(req: Request) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;

  const body = await req.json();
  const { client_id, zip_code, leads, appointments, shows, closes, revenue, notes } = body;

  if (!client_id || !zip_code) {
    return NextResponse.json({ error: 'client_id and zip_code are required' }, { status: 400 });
  }

  const { data, error } = await ctx.service
    .from('zip_performance')
    .upsert(
      {
        client_id,
        zip_code,
        leads:        leads        ?? 0,
        appointments: appointments ?? 0,
        shows:        shows        ?? 0,
        closes:       closes       ?? 0,
        revenue:      revenue      ?? 0,
        notes:        notes        ?? null,
        updated_at:   new Date().toISOString(),
      },
      { onConflict: 'client_id,zip_code' }
    )
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ record: data });
}
