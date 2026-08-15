import { NextResponse } from 'next/server';
import { getAuthContext, isAuthError } from '@/lib/api-auth';

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;

  const { id } = await params;
  const body = await req.json();
  const allowed = ['name', 'pins', 'pin_counter', 'client_id'];
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const k of allowed) if (k in body) updates[k] = body[k];

  const { data, error } = await ctx.service
    .from('client_sessions')
    .update(updates)
    .eq('id', id)
    .select('id, client_id, name, pins, pin_counter, created_at, updated_at, clients(name)')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ session: data });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;

  const { id } = await params;
  const { error } = await ctx.service.from('client_sessions').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
