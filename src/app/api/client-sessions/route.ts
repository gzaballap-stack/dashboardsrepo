import { NextResponse } from 'next/server';
import { getAuthContext, isAuthError } from '@/lib/api-auth';

export async function GET(req: Request) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;

  const { searchParams } = new URL(req.url);
  const client_id = searchParams.get('client_id');

  let query = ctx.service
    .from('client_sessions')
    .select('id, client_id, name, pins, pin_counter, created_at, updated_at, clients(name)')
    .order('updated_at', { ascending: false });
  if (client_id) query = query.eq('client_id', client_id);

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ sessions: data });
}

export async function POST(req: Request) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;

  const body = await req.json();
  const { client_id, name, pins, pin_counter } = body;
  if (!name) {
    return NextResponse.json({ error: 'name is required' }, { status: 400 });
  }

  const { data, error } = await ctx.service
    .from('client_sessions')
    .insert({ client_id: client_id ?? null, name, pins: pins ?? [], pin_counter: pin_counter ?? 0 })
    .select('id, client_id, name, pins, pin_counter, created_at, updated_at, clients(name)')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ session: data });
}
