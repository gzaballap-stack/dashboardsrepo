import { NextResponse } from 'next/server';
import { getAuthContext, isAuthError } from '@/lib/api-auth';

export async function GET(req: Request) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;

  const { searchParams } = new URL(req.url);
  const client_id = searchParams.get('client_id');
  if (!client_id) return NextResponse.json({ error: 'client_id required' }, { status: 400 });

  const { data, error } = await ctx.service
    .from('zip_performance')
    .select('*')
    .eq('client_id', client_id)
    .order('zip_code');

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ performance: data });
}

export async function PATCH(req: Request) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;

  const body = await req.json();
  const { client_id, zip_code, leads, appointments, shows, closes, revenue, notes } = body;

  if (!client_id || !zip_code) {
    return NextResponse.json({ error: 'client_id and zip_code are required' }, { status: 400 });
  }

  const { data, error } = await ctx.service
    .from('zip_performance')
    .upsert(
      {
        client_id,
        zip_code,
        leads:        leads        ?? 0,
        appointments: appointments ?? 0,
        shows:        shows        ?? 0,
        closes:       closes       ?? 0,
        revenue:      revenue      ?? 0,
        notes:        notes        ?? null,
        updated_at:   new Date().toISOString(),
      },
      { onConflict: 'client_id,zip_code' }
    )
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ record: data });
}
