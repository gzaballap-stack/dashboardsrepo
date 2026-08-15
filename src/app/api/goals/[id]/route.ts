import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const service = createServiceClient();
  const { error } = await service.from('goals').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
