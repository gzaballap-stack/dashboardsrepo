import { NextResponse } from 'next/server';
import { getAuthContext, isAuthError } from '@/lib/api-auth';

export async function GET() {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;

  const { data, error } = await ctx.service
    .from('agents')
    .select('id, phone, name, created_at')
    .order('name');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ agents: data });
}

export async function POST(req: Request) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;

  const { phone, name } = await req.json();
  if (!phone || !name) return NextResponse.json({ error: 'phone and name are required' }, { status: 400 });

  const { data, error } = await ctx.service
    .from('agents')
    .insert({ phone: phone.trim(), name: name.trim() })
    .select('id, phone, name, created_at')
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ agent: data });
}
