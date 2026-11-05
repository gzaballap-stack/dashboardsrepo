import { NextResponse } from 'next/server';
import { getAuthContext, isAuthError } from '@/lib/api-auth';
import { getUsdEurRate } from '@/lib/fx';

// Profit and Loss — every line belongs to the signed-in user. Nobody shares a
// sheet, so every query below is pinned to ctx.userId.

const COLS = 'id, month, kind, label, amount, leisure, position';
const KINDS = ['revenue', 'expense', 'personal'];
const MONTH = /^\d{4}-(0[1-9]|1[0-2])-01$/;

// Amounts are stored in dollars. A figure sent with currency "EUR" was typed
// in euros: it is turned into dollars at today's rate here, once, and only the
// dollar figure is kept. Without a rate the save is refused rather than
// storing euros as if they were dollars.
async function inDollars(value: number, currency: unknown): Promise<number | NextResponse> {
  if (currency !== 'EUR') return value;
  const rate = await getUsdEurRate();
  if (!rate) return NextResponse.json({ error: "Couldn't get today's exchange rate — try again in a moment" }, { status: 503 });
  return Math.round((value / rate) * 100) / 100;
}
const PAGE = 1000;

// A figure that can't be read stops the save — it is never quietly stored as 0.
function amount(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const text = v.replace(/[$,\s]/g, '');
  if (!text) return 0;
  const n = Number(text);
  return Number.isFinite(n) ? n : null;
}

export async function GET() {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;

  // Supabase caps a select at 1000 rows; a few years of months goes past that.
  const lines: unknown[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await ctx.service
      .from('pnl_lines')
      .select(COLS)
      .eq('user_id', ctx.userId)
      .order('month', { ascending: true })
      .order('position', { ascending: true })
      .order('created_at', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    lines.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return NextResponse.json({ lines });
}

// Adds one line, or — with { action: "copy", from, to } — starts an empty month
// from another month's clients and business costs.
export async function POST(req: Request) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;

  const body = await req.json();

  if (body.action === 'copy') {
    const to = String(body.to ?? '');
    if (!MONTH.test(to)) return NextResponse.json({ error: 'to must be YYYY-MM-01' }, { status: 400 });
    const ids: string[] | null = Array.isArray(body.ids) ? body.ids.filter((v: unknown) => typeof v === 'string') : null;

    let source;
    if (ids) {
      // Chosen lines, from any month. The page only offers lines this month lacks.
      if (!ids.length) return NextResponse.json({ lines: [] });
      ({ data: source } = await ctx.service
        .from('pnl_lines').select('kind, label, amount, leisure, position')
        .eq('user_id', ctx.userId).in('id', ids));
    } else {
      // A whole month's lines into a month that is still empty — with
      // names_only, every amount is left at 0 for the owner to fill in.
      const from = String(body.from ?? '');
      if (!MONTH.test(from)) return NextResponse.json({ error: 'from must be YYYY-MM-01' }, { status: 400 });
      const { count } = await ctx.service
        .from('pnl_lines').select('id', { count: 'exact', head: true })
        .eq('user_id', ctx.userId).eq('month', to);
      if (count) return NextResponse.json({ error: 'That month already has lines' }, { status: 409 });
      ({ data: source } = await ctx.service
        .from('pnl_lines').select('kind, label, amount, leisure, position')
        .eq('user_id', ctx.userId).eq('month', from)
        .in('kind', body.names_only ? ['revenue', 'expense', 'personal'] : ['revenue', 'expense']));
      if (body.names_only && source) source = source.map(l => ({ ...l, amount: 0 }));
    }
    if (!source?.length) return NextResponse.json({ lines: [] });

    const { data, error } = await ctx.service
      .from('pnl_lines')
      .insert(source.map(l => ({ ...l, user_id: ctx.userId, month: to })))
      .select(COLS);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ lines: data ?? [] });
  }

  const month = String(body.month ?? '');
  if (!MONTH.test(month)) return NextResponse.json({ error: 'month must be YYYY-MM-01' }, { status: 400 });
  if (!KINDS.includes(body.kind)) return NextResponse.json({ error: 'Unknown kind' }, { status: 400 });
  const typed = amount(body.amount ?? 0);
  if (typed === null) return NextResponse.json({ error: 'Amount is not a number' }, { status: 400 });
  const value = await inDollars(typed, body.currency);
  if (value instanceof NextResponse) return value;

  const { data: last } = await ctx.service
    .from('pnl_lines').select('position')
    .eq('user_id', ctx.userId).eq('month', month).eq('kind', body.kind)
    .order('position', { ascending: false }).limit(1);

  const { data, error } = await ctx.service
    .from('pnl_lines')
    .insert({
      user_id: ctx.userId,
      month,
      kind: body.kind,
      label: typeof body.label === 'string' ? body.label.trim() : '',
      amount: value,
      leisure: body.kind === 'personal' && body.leisure === true,
      position: (last?.[0]?.position ?? 0) + 1,
    })
    .select(COLS)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ line: data });
}

export async function PATCH(req: Request) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;

  const body = await req.json();
  if (typeof body.id !== 'string') return NextResponse.json({ error: 'id is required' }, { status: 400 });

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof body.label === 'string') patch.label = body.label.trim();
  if (body.amount !== undefined) {
    const typed = amount(body.amount);
    if (typed === null) return NextResponse.json({ error: 'Amount is not a number' }, { status: 400 });
    const value = await inDollars(typed, body.currency);
    if (value instanceof NextResponse) return value;
    patch.amount = value;
  }
  if (typeof body.leisure === 'boolean') patch.leisure = body.leisure;

  const { data, error } = await ctx.service
    .from('pnl_lines')
    .update(patch)
    .eq('user_id', ctx.userId)
    .eq('id', body.id)
    .select(COLS)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ line: data });
}

export async function DELETE(req: Request) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;

  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  const { error } = await ctx.service
    .from('pnl_lines')
    .delete()
    .eq('user_id', ctx.userId)
    .eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
