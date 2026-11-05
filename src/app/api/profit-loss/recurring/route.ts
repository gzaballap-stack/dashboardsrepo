import { NextResponse } from 'next/server';
import { getAuthContext, isAuthError } from '@/lib/api-auth';

// Profit and Loss — expenses that come back every month (rent, GHL…). One row
// per name, per user; the page offers each one blank on every month until an
// amount is typed. Nothing here touches the month lines themselves.

const COLS = 'id, kind, label, leisure';
const KINDS = ['expense', 'personal'];

export async function GET() {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;

  const { data, error } = await ctx.service
    .from('pnl_recurring').select(COLS).eq('user_id', ctx.userId).order('created_at');
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ items: data ?? [] });
}

export async function POST(req: Request) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;

  const body = await req.json();
  const label = typeof body.label === 'string' ? body.label.trim() : '';
  if (!label) return NextResponse.json({ error: 'label is required' }, { status: 400 });
  if (!KINDS.includes(body.kind)) return NextResponse.json({ error: 'kind must be expense or personal' }, { status: 400 });

  const { data, error } = await ctx.service
    .from('pnl_recurring')
    .upsert(
      { user_id: ctx.userId, kind: body.kind, label, label_key: label.toLowerCase(), leisure: body.kind === 'personal' && body.leisure === true },
      { onConflict: 'user_id,kind,label_key' },
    )
    .select(COLS)
    .single();
  if (error) {
    const missing = /pnl_recurring/.test(error.message) && /not exist|schema cache/.test(error.message);
    return NextResponse.json(
      { error: missing ? 'Repeating expenses need a one-off database update first' : error.message },
      { status: missing ? 503 : 500 });
  }
  return NextResponse.json({ item: data });
}

export async function DELETE(req: Request) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;

  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  const { error } = await ctx.service
    .from('pnl_recurring').delete().eq('user_id', ctx.userId).eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
