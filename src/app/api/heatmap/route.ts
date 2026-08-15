import { NextResponse } from 'next/server';
import { getAuthContext, isAuthError } from '@/lib/api-auth';
import { getLiveClientIds, liveClientFilter } from '@/lib/db-helpers';

// Returns a 24×7 grid (hour-of-day × day-of-week) for heat map display.
// type: new_leads | pickup_rate | show_rate
// grid[hour][day] = value  (day 0=Sun … 6=Sat, hour 0=midnight … 23=11pm)
// -1 = no data for that slot
export async function GET(req: Request) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;

  const { searchParams } = new URL(req.url);
  const type = searchParams.get('type');
  const client_id = searchParams.get('client_id');
  const live_only = searchParams.get('live_only') === 'true';
  const start_date = searchParams.get('start_date');
  const end_date = searchParams.get('end_date');

  if (!type) return NextResponse.json({ error: 'type is required' }, { status: 400 });

  let liveClientIds: string[] | null = null;
  if (live_only && !client_id) {
    liveClientIds = await getLiveClientIds(ctx.service);
  }

  function applyClientFilter<T extends object>(q: T): T {
    if (client_id) return (q as any).eq('client_id', client_id);
    if (liveClientIds) return (q as any).in('client_id', liveClientFilter(liveClientIds));
    return q;
  }

  async function fetchAllPages<T>(baseQuery: any): Promise<T[]> {
    const PAGE = 1000;
    const all: T[] = [];
    let offset = 0;
    while (true) {
      const { data, error } = await baseQuery.range(offset, offset + PAGE - 1);
      if (error) throw new Error(error.message);
      if (!data || data.length === 0) break;
      all.push(...data);
      if (data.length < PAGE) break;
      offset += PAGE;
    }
    return all;
  }

  const empty24x7 = () => Array.from({ length: 24 }, () => new Array(7).fill(0));

  try {
    if (type === 'new_leads') {
      let q = applyClientFilter(ctx.service.from('events').select('occurred_at').eq('event_type', 'lead'));
      if (start_date) q = q.gte('occurred_at', `${start_date}T00:00:00.000Z`);
      if (end_date)   q = q.lte('occurred_at', `${end_date}T23:59:59.999Z`);

      const data = await fetchAllPages<{ occurred_at: string }>(q);
      const grid = empty24x7();
      for (const e of data) {
        const d = new Date(e.occurred_at);
        grid[d.getUTCHours()][d.getUTCDay()]++;
      }
      return NextResponse.json({ grid });
    }

    if (type === 'pickup_rate') {
      let q = applyClientFilter(ctx.service.from('events').select('occurred_at, is_pickup').eq('event_type', 'dial'));
      if (start_date) q = q.gte('occurred_at', `${start_date}T00:00:00.000Z`);
      if (end_date)   q = q.lte('occurred_at', `${end_date}T23:59:59.999Z`);

      const data = await fetchAllPages<{ occurred_at: string; is_pickup: boolean | null }>(q);
      const dials = empty24x7();
      const pickups = empty24x7();
      for (const e of data) {
        const d = new Date(e.occurred_at);
        const h = d.getUTCHours(), day = d.getUTCDay();
        dials[h][day]++;
        if (e.is_pickup) pickups[h][day]++;
      }
      const grid = dials.map((row, h) =>
        row.map((t, d) => t > 0 ? Math.round((pickups[h][d] / t) * 100) : -1)
      );
      return NextResponse.json({ grid });
    }

    if (type === 'show_rate') {
      let q = applyClientFilter(
        ctx.service.from('events')
          .select('scheduled_at, event_type')
          .in('event_type', ['show', 'no_show'])
          .not('scheduled_at', 'is', null)
      );
      if (start_date) q = q.gte('scheduled_at', `${start_date}T00:00:00.000Z`);
      if (end_date)   q = q.lte('scheduled_at', `${end_date}T23:59:59.999Z`);

      const data = await fetchAllPages<{ scheduled_at: string; event_type: string }>(q);
      const total = empty24x7();
      const shows = empty24x7();
      for (const e of data) {
        const d = new Date(e.scheduled_at);
        const h = d.getUTCHours(), day = d.getUTCDay();
        total[h][day]++;
        if (e.event_type === 'show') shows[h][day]++;
      }
      const grid = total.map((row, h) =>
        row.map((t, d) => t > 0 ? Math.round((shows[h][d] / t) * 100) : -1)
      );
      return NextResponse.json({ grid });
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }

  return NextResponse.json({ error: 'Invalid type' }, { status: 400 });
}
