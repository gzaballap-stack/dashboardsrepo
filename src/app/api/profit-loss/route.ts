import { NextResponse } from 'next/server';
import { getAuthContext, isAuthError } from '@/lib/api-auth';
import { getUsdEurRate } from '@/lib/fx';

// Profit and Loss — every line belongs to the signed-in user. Nobody shares a
// sheet, so every query below is pinned to ctx.userId.

const COLS = 'id, month, kind, label, amount, leisure, position, currency, usd_eur_rate';
const CURRENCIES = ['USD', 'EUR'];

// A database that hasn't had the currency migration yet rejects the two new
// columns. Reads and writes fall back to the old shape rather than breaking
// the page; such lines read as dollars with no rate.
const LEGACY_COLS = 'id, month, kind, label, amount, leisure, position';
const missingCurrency = (e: { message?: string } | null) => !!e && /currency|usd_eur_rate/.test(e.message ?? '');
const withoutCurrency = (row: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(row).filter(([k]) => k !== 'currency' && k !== 'usd_eur_rate'));
type SourceRows = { data: Record<string, unknown>[] | null; error: { message?: string } | null };
const KINDS = ['revenue', 'expense', 'personal'];
const MONTH = /^\d{4}-(0[1-9]|1[0-2])-01$/;
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
  let cols = COLS;
  for (let from = 0; ; from += PAGE) {
    const page = () => ctx.service
      .from('pnl_lines')
      .select(cols)
      .eq('user_id', ctx.userId)
      .order('month', { ascending: true })
      .order('position', { ascending: true })
      .order('created_at', { ascending: true })
      .range(from, from + PAGE - 1);
    let { data, error } = await page();
    if (missingCurrency(error)) { cols = LEGACY_COLS; ({ data, error } = await page()); }
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

    let source: Record<string, unknown>[] | null;
    if (ids) {
      // Chosen lines, from any month. The page only offers lines this month lacks.
      if (!ids.length) return NextResponse.json({ lines: [] });
      let res: SourceRows = await ctx.service
        .from('pnl_lines').select('kind, label, amount, leisure, position, currency')
        .eq('user_id', ctx.userId).in('id', ids);
      if (missingCurrency(res.error)) {
        res = await ctx.service
          .from('pnl_lines').select('kind, label, amount, leisure, position')
          .eq('user_id', ctx.userId).in('id', ids);
      }
      source = res.data;
    } else {
      // A whole month's clients and business costs, into a month that is still empty.
      const from = String(body.from ?? '');
      if (!MONTH.test(from)) return NextResponse.json({ error: 'from must be YYYY-MM-01' }, { status: 400 });
      const { count } = await ctx.service
        .from('pnl_lines').select('id', { count: 'exact', head: true })
        .eq('user_id', ctx.userId).eq('month', to);
      if (count) return NextResponse.json({ error: 'That month already has lines' }, { status: 409 });
      let res: SourceRows = await ctx.service
        .from('pnl_lines').select('kind, label, amount, leisure, position, currency')
        .eq('user_id', ctx.userId).eq('month', from).in('kind', ['revenue', 'expense']);
      if (missingCurrency(res.error)) {
        res = await ctx.service
          .from('pnl_lines').select('kind, label, amount, leisure, position')
          .eq('user_id', ctx.userId).eq('month', from).in('kind', ['revenue', 'expense']);
      }
      source = res.data;
    }
    if (!source?.length) return NextResponse.json({ lines: [] });

    // Copied lines are new entries: they take today's rate, not the old month's.
    const rate = await getUsdEurRate(ctx.service);
    const rows = source.map(l => ({ ...l, user_id: ctx.userId, month: to, usd_eur_rate: rate }));
    let { data, error } = await ctx.service.from('pnl_lines').insert(rows).select(COLS);
    if (missingCurrency(error)) {
      ({ data, error } = await ctx.service.from('pnl_lines').insert(rows.map(withoutCurrency)).select(LEGACY_COLS));
    }
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ lines: data ?? [] });
  }

  const month = String(body.month ?? '');
  if (!MONTH.test(month)) return NextResponse.json({ error: 'month must be YYYY-MM-01' }, { status: 400 });
  if (!KINDS.includes(body.kind)) return NextResponse.json({ error: 'Unknown kind' }, { status: 400 });
  const value = amount(body.amount ?? 0);
  if (value === null) return NextResponse.json({ error: 'Amount is not a number' }, { status: 400 });
  const currency = CURRENCIES.includes(body.currency) ? body.currency : 'USD';
  const rate = await getUsdEurRate(ctx.service);

  const { data: last } = await ctx.service
    .from('pnl_lines').select('position')
    .eq('user_id', ctx.userId).eq('month', month).eq('kind', body.kind)
    .order('position', { ascending: false }).limit(1);

  const row = {
    user_id: ctx.userId,
    month,
    kind: body.kind,
    label: typeof body.label === 'string' ? body.label.trim() : '',
    amount: value,
    leisure: body.kind === 'personal' && body.leisure === true,
    position: (last?.[0]?.position ?? 0) + 1,
    currency,
    usd_eur_rate: rate,
  };
  let { data, error } = await ctx.service.from('pnl_lines').insert(row).select(COLS).single();
  if (missingCurrency(error)) {
    ({ data, error } = await ctx.service.from('pnl_lines').insert(withoutCurrency(row)).select(LEGACY_COLS).single());
  }
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
    const value = amount(body.amount);
    if (value === null) return NextResponse.json({ error: 'Amount is not a number' }, { status: 400 });
    patch.amount = value;
  }
  if (typeof body.leisure === 'boolean') patch.leisure = body.leisure;
  // Switching a line's currency keeps its rate: the rate belongs to the day it
  // was entered, not to the unit it was typed in.
  if (CURRENCIES.includes(body.currency)) patch.currency = body.currency;

  const update = (cols: string) => ctx.service
    .from('pnl_lines')
    .update(patch)
    .eq('user_id', ctx.userId)
    .eq('id', body.id)
    .select(cols)
    .single();
  let { data, error } = await update(COLS);
  if (missingCurrency(error) && !('currency' in patch)) ({ data, error } = await update(LEGACY_COLS));
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
