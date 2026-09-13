import { NextResponse } from 'next/server';
import { getAuthContext, isAuthError } from '@/lib/api-auth';
import { parseDecimal } from '@/lib/health-tracker';

const COLS = 'id, week_start, weight_1, weight_2, weight_3, waist, bicep, lifts, notes, updated_at';

// Thrown for anything typed that isn't a number. Blank is fine and clears the
// field; junk used to be turned into null and written over what was there,
// which lost the measurement without ever saying so.
class BadNumber extends Error {
  constructor(public field: string) { super(`${field} is not a number`); }
}

function num(v: unknown, field: string): number | null {
  const parsed = parseDecimal(v);
  if (!parsed.ok) throw new BadNumber(field);
  return parsed.value;
}

// { "Bicep Curl": { load, reps } } — a lift with neither figure is dropped, but
// a figure that can't be read stops the save like any other.
function cleanLifts(v: unknown): Record<string, { load: number | null; reps: number | null }> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
  const out: Record<string, { load: number | null; reps: number | null }> = {};
  for (const [name, raw] of Object.entries(v as Record<string, unknown>)) {
    if (!name.trim() || !raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const load = num(r.load, `${name} load`);
    const reps = num(r.reps, `${name} reps`);
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

  let row;
  try {
    row = {
      user_id: ctx.userId,
      week_start: weekStart,
      weight_1: num(body.weight_1, 'Weigh-in 1'),
      weight_2: num(body.weight_2, 'Weigh-in 2'),
      weight_3: num(body.weight_3, 'Weigh-in 3'),
      waist: num(body.waist, 'Waist'),
      bicep: num(body.bicep, 'Bicep'),
      lifts: cleanLifts(body.lifts),
      notes: typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null,
      updated_at: new Date().toISOString(),
    };
  } catch (e) {
    if (e instanceof BadNumber) {
      return NextResponse.json({ error: `${e.field} is not a number` }, { status: 400 });
    }
    throw e;
  }

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
