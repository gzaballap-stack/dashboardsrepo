import { NextResponse } from 'next/server';
import { getAuthContext, isAuthError } from '@/lib/api-auth';

export async function GET() {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;

  const { data, error } = await ctx.service
    .from('setter_availability')
    .select('id, agent_id, weekday, time_start, time_end, is_live, agents(name)')
    .order('weekday')
    .order('time_start');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rows: data });
}

export async function POST(req: Request) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;

  const { agent_id, weekday, time_start, time_end, is_live } = await req.json();
  if (!agent_id || !weekday || !time_start || !time_end)
    return NextResponse.json({ error: 'agent_id, weekday, time_start, time_end required' }, { status: 400 });

  const { data, error } = await ctx.service
    .from('setter_availability')
    .insert({ agent_id, weekday, time_start, time_end, is_live: is_live ?? true })
    .select('id, agent_id, weekday, time_start, time_end, is_live, agents(name)')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ row: data });
}
