import { NextResponse } from 'next/server';
import { getAuthContext, isAuthError } from '@/lib/api-auth';

const VALID_TYPES = ['call', 'email', 'meeting', 'text', 'other'] as const;

export async function GET(req: Request) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;

  const { searchParams } = new URL(req.url);
  const client_id = searchParams.get('client_id');
  if (!client_id) return NextResponse.json({ error: 'client_id is required' }, { status: 400 });

  const { data, error } = await ctx.service
    .from('client_touchpoints')
    .select('id, client_id, occurred_at, type, summary, csm_name, created_at')
    .eq('client_id', client_id)
    .order('occurred_at', { ascending: false });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ touchpoints: data });
}

export async function POST(req: Request) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;

  const body = await req.json();
  const { client_id, type, summary, csm_name, occurred_at } = body;

  if (!client_id) return NextResponse.json({ error: 'client_id is required' }, { status: 400 });
  if (type && !VALID_TYPES.includes(type)) {
    return NextResponse.json({ error: `type must be one of ${VALID_TYPES.join(', ')}` }, { status: 400 });
  }

  const { data, error } = await ctx.service
    .from('client_touchpoints')
    .insert({
      client_id,
      type: type ?? 'call',
      summary: summary ?? null,
      csm_name: csm_name ?? null,
      occurred_at: occurred_at ?? new Date().toISOString(),
    })
    .select('id, client_id, occurred_at, type, summary, csm_name')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ touchpoint: data });
}

export async function DELETE(req: Request) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;

  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  const { error } = await ctx.service.from('client_touchpoints').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
