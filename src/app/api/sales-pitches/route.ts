import { NextResponse } from 'next/server';
import { getAuthContext, isAuthError } from '@/lib/api-auth';

// Sales Tracker — the catalogue of pricing / pitches. One shared list (gated
// on b2b_tracking). `active` is what the By pricing panel shows; an inactive
// pitch is hidden there but stays in the catalogue and in its calls.
//   GET            → { pitches: [{ name, active }] }
//   PUT { pitches } → replaces the catalogue whole, in the order given
//   PATCH { from, to } → renames a pitch everywhere: catalogue and every call

const key = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
const clean = (s: string) => s.trim().replace(/\s+/g, ' ');

export async function GET() {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;

  const { data, error } = await ctx.service
    .from('sales_pitches')
    .select('name, active')
    .order('position', { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ pitches: data ?? [] });
}

export async function PUT(req: Request) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;

  const body = await req.json();
  if (!Array.isArray(body.pitches)) return NextResponse.json({ error: 'pitches must be a list' }, { status: 400 });

  // Drop blanks and repeats that differ only by case or spacing.
  const seen = new Set<string>();
  const rows: { name: string; active: boolean; position: number }[] = [];
  for (const p of body.pitches) {
    const raw = typeof p === 'string' ? p : p?.name;
    if (typeof raw !== 'string') continue;
    const name = clean(raw);
    if (!name || seen.has(key(name))) continue;
    seen.add(key(name));
    rows.push({ name, active: typeof p === 'string' ? true : p.active !== false, position: rows.length });
  }

  const { error: delError } = await ctx.service.from('sales_pitches').delete().not('id', 'is', null);
  if (delError) return NextResponse.json({ error: delError.message }, { status: 500 });
  if (rows.length) {
    const { error } = await ctx.service.from('sales_pitches').insert(rows);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ pitches: rows.map(r => ({ name: r.name, active: r.active })) });
}

export async function PATCH(req: Request) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;

  const body = await req.json();
  const from = typeof body.from === 'string' ? clean(body.from) : '';
  const to = typeof body.to === 'string' ? clean(body.to) : '';
  if (!from || !to) return NextResponse.json({ error: 'from and to are required' }, { status: 400 });

  // Calls match on the normalised key, so "5 ppa x 200" renames with "5 PPA x 200".
  const { data: calls, error: readError } = await ctx.service.from('sales_calls').select('id, pitch').neq('pitch', '');
  if (readError) return NextResponse.json({ error: readError.message }, { status: 500 });
  const ids = (calls ?? []).filter(c => key(c.pitch) === key(from)).map(c => c.id);
  if (ids.length) {
    const { error } = await ctx.service.from('sales_calls')
      .update({ pitch: to, updated_at: new Date().toISOString() }).in('id', ids);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const { data: pitches } = await ctx.service.from('sales_pitches').select('id, name');
  const hit = (pitches ?? []).find(p => key(p.name) === key(from));
  if (hit) {
    const clash = (pitches ?? []).find(p => p.id !== hit.id && key(p.name) === key(to));
    // Renaming onto an existing pitch merges into it.
    if (clash) await ctx.service.from('sales_pitches').delete().eq('id', hit.id);
    else await ctx.service.from('sales_pitches').update({ name: to }).eq('id', hit.id);
  }
  return NextResponse.json({ renamed: ids.length });
}
