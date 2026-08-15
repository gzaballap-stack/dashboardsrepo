import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { phone, name } = await req.json();
  if (!phone && !name) {
    return NextResponse.json({ error: 'phone or name is required' }, { status: 400 });
  }
  const updates: Record<string, string> = {};
  if (phone) updates.phone = phone.trim();
  if (name) updates.name = name.trim();

  const service = createServiceClient();
  const { data, error } = await service
    .from('agents')
    .update(updates)
    .eq('id', id)
    .select('id, phone, name, created_at')
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ agent: data });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const service = createServiceClient();
  const { error } = await service.from('agents').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
