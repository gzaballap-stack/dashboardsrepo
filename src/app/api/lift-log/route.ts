import { NextResponse } from 'next/server';
import { getAuthContext, isAuthError } from '@/lib/api-auth';

const COLS = 'id, week_start, weight_1, weight_2, weight_3, waist, bicep, lifts, notes, updated_at';

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// { "Bicep Curl": { load, reps } } — silently drops anything malformed rather
// than failing the whole save.
function cleanLifts(v: unknown): Record<string, { load: number | null; reps: number | null }> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const out: Record<string, { load: number | null; reps: number | null }> = {};
  for (const [name, raw] of Object.entries(v as Record<string, unknown>)) {
    if (!name.trim() || !raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const load = num(r.load);
    const reps = num(r.reps);
    if (load === null && reps === null) continue;
    out[name] = { load, reps };
  }
  return out;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: Request) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;

  const { searchParams } = new URL(req.url);
  const from = searchParams.get('from');
  const to = searchParams.get('to');

  let q = ctx.service.from('lift_entries').select(COLS).eq('user_id', ctx.userId);
  if (from && ISO_DATE.test(from)) q = q.gte('week_start', from);
  if (to && ISO_DATE.test(to)) q = q.lte('week_start', to);

  const { data, error } = await q.order('week_start', { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ entries: data ?? [] });
}

// One row per week — saving the same week again overwrites it.
export async function POST(req: Request) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;

  const body = await req.json();
  const weekStart = typeof body.week_start === 'string' ? body.week_start : '';
  if (!ISO_DATE.test(weekStart)) {
    return NextResponse.json({ error: 'week_start must be YYYY-MM-DD' }, { status: 400 });
  }

  const row = {
    user_id: ctx.userId,
    week_start: weekStart,
    weight_1: num(body.weight_1),
    weight_2: num(body.weight_2),
    weight_3: num(body.weight_3),
    waist: num(body.waist),
    bicep: num(body.bicep),
    lifts: cleanLifts(body.lifts),
    notes: typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await ctx.service
    .from('lift_entries')
    .upsert(row, { onConflict: 'user_id,week_start' })
    .select(COLS)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ entry: data });
}

export async function DELETE(req: Request) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;

  const { searchParams } = new URL(req.url);
  const weekStart = searchParams.get('week_start') ?? '';
  if (!ISO_DATE.test(weekStart)) {
    return NextResponse.json({ error: 'week_start is required' }, { status: 400 });
  }

  const { error } = await ctx.service
    .from('lift_entries')
    .delete()
    .eq('user_id', ctx.userId)
    .eq('week_start', weekStart);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
