import { NextResponse } from 'next/server';
import { getAuthContext, isAuthError } from '@/lib/api-auth';

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;

  const { id } = await params;
  const body = await req.json();
  const allowed = ['weekday', 'time_slot_1', 'time_slot_2', 'is_live'];
  const updates: Record<string, unknown> = {};
  for (const k of allowed) if (k in body) updates[k] = body[k] || null;
  if ('is_live' in body) updates['is_live'] = body['is_live'];

  const { data, error } = await ctx.service
    .from('client_calling_windows')
    .update(updates)
    .eq('id', id)
    .select('id, client_id, weekday, time_slot_1, time_slot_2, is_live, clients(name)')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ row: data });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;

  const { id } = await params;
  const { error } = await ctx.service.from('client_calling_windows').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
