import { NextResponse } from 'next/server';
import { getAuthContext, isAuthError } from '@/lib/api-auth';

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function getWeekDates(weekStart: string) {
  const dates: { date: string; weekday: string }[] = [];
  const start = new Date(weekStart + 'T12:00:00Z');
  for (let i = 0; i < 7; i++) {
    const d = new Date(start.getTime() + i * 86400000);
    dates.push({
      date: d.toISOString().split('T')[0],
      weekday: WEEKDAY_NAMES[d.getUTCDay()],
    });
  }
  return dates;
}

export async function GET(req: Request) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;

  const { searchParams } = new URL(req.url);
  const week_start = searchParams.get('week_start');
  if (!week_start) return NextResponse.json({ error: 'week_start required' }, { status: 400 });

  const weekEnd = new Date(week_start + 'T12:00:00Z');
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
  const week_end = weekEnd.toISOString().split('T')[0];

  const { data, error } = await ctx.service
    .from('pd_schedule')
    .select('id, client_id, agent_id, scheduled_date, slot_time, status, notes, clients(name), agents(name)')
    .gte('scheduled_date', week_start)
    .lte('scheduled_date', week_end)
    .order('scheduled_date')
    .order('slot_time');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rows: data });
}

export async function POST(req: Request) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;

  const { week_start } = await req.json();
  if (!week_start) return NextResponse.json({ error: 'week_start required' }, { status: 400 });

  const weekDates = getWeekDates(week_start);
  const weekEnd = weekDates[6].date;

  // Delete existing schedule for this week
  await ctx.service
    .from('pd_schedule')
    .delete()
    .gte('scheduled_date', week_start)
    .lte('scheduled_date', weekEnd);

  // Fetch watch schedule entries for this week + live client windows
  const [{ data: watchEntries }, { data: allWindows }] = await Promise.all([
    ctx.service
      .from('watch_schedule')
      .select('agent_id, scheduled_date, slot_hour')
      .gte('scheduled_date', week_start)
      .lte('scheduled_date', weekEnd),
    ctx.service
      .from('client_calling_windows')
      .select('client_id, weekday, time_slot_1, time_slot_2')
      .eq('is_live', true),
  ]);

  if (!watchEntries || !allWindows) return NextResponse.json({ error: 'Failed to fetch schedule data' }, { status: 500 });

  // Build lookup: date → slot_hour → agent_ids[]
  const watchMap: Record<string, Record<number, string[]>> = {};
  for (const e of watchEntries) {
    if (!watchMap[e.scheduled_date]) watchMap[e.scheduled_date] = {};
    if (!watchMap[e.scheduled_date][e.slot_hour]) watchMap[e.scheduled_date][e.slot_hour] = [];
    watchMap[e.scheduled_date][e.slot_hour].push(e.agent_id);
  }

  const inserts: {
    client_id: string;
    agent_id: string | null;
    scheduled_date: string;
    slot_time: string;
    status: string;
  }[] = [];

  for (const { date, weekday } of weekDates) {
    const dateWatch = watchMap[date] ?? {};
    const dayWindows = allWindows.filter(w => w.weekday === weekday);
    // Track assignment index per hour to distribute setters across clients
    const hourIdx: Record<number, number> = {};

    for (const win of dayWindows) {
      const slots = [win.time_slot_1, win.time_slot_2].filter(Boolean) as string[];
      for (const slot of slots) {
        const slotHour = parseInt(slot.split(':')[0], 10);
        const agentIds = shuffle(dateWatch[slotHour] ?? []);

        if (agentIds.length === 0) {
          inserts.push({ client_id: win.client_id, agent_id: null, scheduled_date: date, slot_time: slot, status: 'no_setters' });
        } else {
          const idx = hourIdx[slotHour] ?? 0;
          hourIdx[slotHour] = idx + 1;
          inserts.push({ client_id: win.client_id, agent_id: agentIds[idx % agentIds.length], scheduled_date: date, slot_time: slot, status: 'pending' });
        }
      }
    }
  }

  if (inserts.length === 0) return NextResponse.json({ rows: [], message: 'No schedule generated — assign setters to the Watch Schedule first' });

  const { data, error } = await ctx.service
    .from('pd_schedule')
    .insert(inserts)
    .select('id, client_id, agent_id, scheduled_date, slot_time, status, notes, clients(name), agents(name)');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rows: data });
}
