import { NextResponse } from 'next/server';
import { getAuthContext, isAuthError } from '@/lib/api-auth';

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
    .from('watch_schedule')
    .select('id, agent_id, scheduled_date, slot_hour, agents(name)')
    .gte('scheduled_date', week_start)
    .lte('scheduled_date', week_end)
    .order('slot_hour');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rows: data });
}

export async function POST(req: Request) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;

  const { agent_id, scheduled_date, slot_hour } = await req.json();
  if (!agent_id || !scheduled_date || slot_hour === undefined) {
    return NextResponse.json({ error: 'agent_id, scheduled_date, slot_hour required' }, { status: 400 });
  }

  const { data, error } = await ctx.service
    .from('watch_schedule')
    .insert({ agent_id, scheduled_date, slot_hour })
    .select('id, agent_id, scheduled_date, slot_hour, agents(name)')
    .single();

  if (error) {
    if (error.code === '23505') return NextResponse.json({ row: null, duplicate: true });
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ row: data });
}
