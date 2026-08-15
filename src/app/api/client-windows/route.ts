import { NextResponse } from 'next/server';
import { getAuthContext, isAuthError } from '@/lib/api-auth';

export async function GET() {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;

  const { data, error } = await ctx.service
    .from('client_calling_windows')
    .select('id, client_id, weekday, time_slot_1, time_slot_2, is_live, clients(name)')
    .order('weekday')
    .order('time_slot_1');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ rows: data });
}

export async function POST(req: Request) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;

  const { client_id, weekday, time_slot_1, time_slot_2, is_live } = await req.json();
  if (!client_id || !weekday)
    return NextResponse.json({ error: 'client_id and weekday required' }, { status: 400 });

  const { data, error } = await ctx.service
    .from('client_calling_windows')
    .insert({ client_id, weekday, time_slot_1: time_slot_1 || null, time_slot_2: time_slot_2 || null, is_live: is_live ?? true })
    .select('id, client_id, weekday, time_slot_1, time_slot_2, is_live, clients(name)')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ row: data });
}
