import { NextResponse } from 'next/server';
import { getAuthContext, isAuthError } from '@/lib/api-auth';

type Section = 'clients_dashboard' | 'tomsi_media' | 'tools';
type Alert = {
  id: string; section: Section; title: string; message: string;
  client_id?: string; client_name?: string; days_since_booking?: number | null;
};

// Monday (UTC) of the current week as YYYY-MM-DD.
function currentWeekStart(): string {
  const d = new Date();
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().split('T')[0];
}

export async function GET() {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;

  const [{ data: clients }, { data: recentEvents }, latestLift, thisWeekLift] = await Promise.all([
    // Only live clients get stale-booking alerts — paused and offline are skipped.
    ctx.service.from('clients').select('id, name, is_internal').eq('is_live', true),
    ctx.service.from('events').select('client_id, occurred_at')
      .in('event_type', ['appointment_booked', 'callback_booked'])
      .order('occurred_at', { ascending: false }),
    ctx.service.from('lift_entries').select('updated_at').eq('user_id', ctx.userId)
      .order('updated_at', { ascending: false }).limit(1).maybeSingle(),
    ctx.service.from('lift_entries').select('id').eq('user_id', ctx.userId)
      .eq('week_start', currentWeekStart()).maybeSingle(),
  ]);

  const latestByClient = new Map<string, string>();
  for (const row of recentEvents ?? []) {
    if (!latestByClient.has(row.client_id)) latestByClient.set(row.client_id, row.occurred_at);
  }

  const alerts: Alert[] = [];

  for (const c of clients ?? []) {
    const last = latestByClient.get(c.id) ?? null;
    const days = last ? Math.floor((Date.now() - new Date(last).getTime()) / 86400000) : null;
    if (days !== null && days < 3) continue;
    const section: Section = c.is_internal ? 'tomsi_media' : 'clients_dashboard';
    alerts.push({
      id: `booking:${c.id}`, section, title: c.name, client_id: c.id, client_name: c.name,
      days_since_booking: days,
      message: `hasn't had a booked appointment in ${days === null ? 'an unknown number of' : days} days`,
    });
  }

  // Tools: the Health Tracker has gone quiet.
  const lastLift = (latestLift.data as { updated_at?: string } | null)?.updated_at ?? null;
  const liftDays = lastLift ? Math.floor((Date.now() - new Date(lastLift).getTime()) / 86400000) : null;
  if (liftDays === null || liftDays >= 3) {
    alerts.push({
      id: 'tracker:stale', section: 'tools', title: 'Health Tracker',
      message: lastLift ? `no new entries in ${liftDays} days` : 'no entries logged yet',
    });
  }
  if (!thisWeekLift.data) {
    alerts.push({
      id: 'tracker:emptyweek', section: 'tools', title: 'Health Tracker',
      message: "this week's tracker is still empty",
    });
  }

  return NextResponse.json({ alerts });
}
