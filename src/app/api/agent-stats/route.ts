import { NextResponse } from 'next/server';
import { getAuthContext, isAuthError } from '@/lib/api-auth';

export async function GET(req: Request) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;

  const { searchParams } = new URL(req.url);
  const clientId  = searchParams.get('clientId');
  const startDate = searchParams.get('startDate');
  const endDate   = searchParams.get('endDate');

  let baseQuery = ctx.service
    .from('events')
    .select('agent_name, event_type, is_pickup, is_conversation, speed_to_lead_seconds, occurred_at');

  if (clientId)  baseQuery = baseQuery.eq('client_id', clientId);
  if (startDate) baseQuery = baseQuery.gte('occurred_at', `${startDate}T00:00:00.000Z`);
  if (endDate)   baseQuery = baseQuery.lte('occurred_at', `${endDate}T23:59:59.999Z`);

  // Paginate to overcome Supabase's default 1,000-row cap
  const PAGE = 1000;
  type Row = { agent_name: string | null; event_type: string; is_pickup: boolean | null; is_conversation: boolean | null; speed_to_lead_seconds: number | null; occurred_at: string };
  const data: Row[] = [];
  let offset = 0;
  while (true) {
    const { data: batch, error } = await baseQuery.range(offset, offset + PAGE - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!batch || batch.length === 0) break;
    data.push(...(batch as Row[]));
    if (batch.length < PAGE) break;
    offset += PAGE;
  }

  const agentMap = new Map<string, {
    agent_name: string;
    dials: number; pickups: number; conversations: number;
    appointments: number; callbacks: number; shows: number; no_shows: number;
    speed_readings: number[];
  }>();

  const todayStr = new Date().toISOString().split('T')[0];

  const todayMap = new Map<string, { dials: number; pickups: number; appointments: number }>();

  for (const row of data) {
    const name = row.agent_name ?? 'Unassigned';

    if (!agentMap.has(name)) {
      agentMap.set(name, {
        agent_name: name,
        dials: 0, pickups: 0, conversations: 0,
        appointments: 0, callbacks: 0, shows: 0, no_shows: 0,
        speed_readings: [],
      });
    }
    if (!todayMap.has(name)) {
      todayMap.set(name, { dials: 0, pickups: 0, appointments: 0 });
    }

    const a = agentMap.get(name)!;
    const t = todayMap.get(name)!;
    const isToday = row.occurred_at?.startsWith(todayStr);

    if (row.event_type === 'dial') {
      a.dials++;
      if (row.is_pickup) a.pickups++;
      if (row.is_conversation) a.conversations++;
      if (row.speed_to_lead_seconds != null) a.speed_readings.push(Number(row.speed_to_lead_seconds));
      if (isToday) { t.dials++; if (row.is_pickup) t.pickups++; }
    } else if (row.event_type === 'appointment_booked') {
      a.appointments++;
      if (isToday) t.appointments++;
    } else if (row.event_type === 'callback_booked') {
      a.callbacks++;
    } else if (row.event_type === 'show') {
      a.shows++;
    } else if (row.event_type === 'no_show') {
      a.no_shows++;
    }
  }

  const agents = Array.from(agentMap.values()).map(a => {
    const todayStats = todayMap.get(a.agent_name) ?? { dials: 0, pickups: 0, appointments: 0 };
    const avg_speed = a.speed_readings.length > 0
      ? Math.round(a.speed_readings.reduce((x, y) => x + y, 0) / a.speed_readings.length / 60 * 10) / 10
      : null;
    return {
      agent_name: a.agent_name,
      dials: a.dials,
      pickups: a.pickups,
      pickup_rate: a.dials > 0 ? Math.round((a.pickups / a.dials) * 100) : 0,
      conversations: a.conversations,
      conversation_rate: a.dials > 0 ? Math.round((a.conversations / a.dials) * 100) : 0,
      appointments: a.appointments,
      callbacks: a.callbacks,
      shows: a.shows,
      no_shows: a.no_shows,
      show_rate: (a.shows + a.no_shows) > 0 ? Math.round((a.shows / (a.shows + a.no_shows)) * 100) : 0,
      avg_speed_to_lead_min: avg_speed,
      today: todayStats,
    };
  });

  agents.sort((a, b) => b.appointments - a.appointments);
  return NextResponse.json({ agents });
}
