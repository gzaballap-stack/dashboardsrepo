import { NextResponse } from 'next/server';
import { getAuthContext, isAuthError } from '@/lib/api-auth';

// Sales Tracker — Tomsi Media's log of sales calls. One shared list for
// everyone who can open the TM Dashboard (gated on b2b_tracking in
// lib/feature-access.ts); it is not scoped per user.

const COLS = 'id, call_date, name, source, pitch, call_minutes, recording_url, outcome, emotions, conclusion, notes, contact, created_at';
const OUTCOMES = ['won', 'lost', 'dq', 'na', 'pending'];
const TEXT_FIELDS = ['name', 'source', 'pitch', 'recording_url', 'emotions', 'conclusion', 'notes', 'contact'];
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const PAGE = 1000;

// Turns a request body into the columns it may set. Anything unreadable is an
// error rather than a silent blank.
function fieldsOf(body: Record<string, unknown>): { patch: Record<string, unknown> } | { error: string } {
  const patch: Record<string, unknown> = {};
  for (const f of TEXT_FIELDS) {
    if (typeof body[f] === 'string') patch[f] = (body[f] as string).trim();
  }
  if ('call_date' in body) {
    const d = body.call_date;
    if (d === null || d === '') patch.call_date = null;
    else if (typeof d === 'string' && DATE.test(d) && !Number.isNaN(Date.parse(d))) patch.call_date = d;
    else return { error: 'Date must be YYYY-MM-DD' };
  }
  if ('call_minutes' in body) {
    const m = body.call_minutes;
    if (m === null || m === '') patch.call_minutes = null;
    else {
      const n = Number(m);
      if (!Number.isFinite(n) || n < 0) return { error: 'Call length must be a number of minutes' };
      patch.call_minutes = Math.round(n);
    }
  }
  if ('outcome' in body) {
    if (!OUTCOMES.includes(body.outcome as string)) return { error: 'Unknown outcome' };
    patch.outcome = body.outcome;
  }
  return { patch };
}

export async function GET() {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;

  const calls: unknown[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await ctx.service
      .from('sales_calls')
      .select(COLS)
      .order('call_date', { ascending: false, nullsFirst: true })
      .order('created_at', { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    calls.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return NextResponse.json({ calls });
}

export async function POST(req: Request) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;

  const parsed = fieldsOf(await req.json());
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const { data, error } = await ctx.service
    .from('sales_calls')
    .insert({ ...parsed.patch, created_by: ctx.userId })
    .select(COLS)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ call: data });
}

export async function PATCH(req: Request) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;

  const body = await req.json();
  if (typeof body.id !== 'string') return NextResponse.json({ error: 'id is required' }, { status: 400 });
  const parsed = fieldsOf(body);
  if ('error' in parsed) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const { data, error } = await ctx.service
    .from('sales_calls')
    .update({ ...parsed.patch, updated_at: new Date().toISOString() })
    .eq('id', body.id)
    .select(COLS)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ call: data });
}

export async function DELETE(req: Request) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;

  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  const { error } = await ctx.service.from('sales_calls').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
