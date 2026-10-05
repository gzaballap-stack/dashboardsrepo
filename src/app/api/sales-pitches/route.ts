import { NextResponse } from 'next/server';
import { getAuthContext, isAuthError } from '@/lib/api-auth';

// Sales Tracker — the pricing / pitches on offer right now. One shared list
// (gated on b2b_tracking); PUT replaces it whole, in the order given.

export async function GET() {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;

  const { data, error } = await ctx.service
    .from('sales_pitches')
    .select('name')
    .order('position', { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ pitches: (data ?? []).map(p => p.name) });
}

export async function PUT(req: Request) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;

  const body = await req.json();
  if (!Array.isArray(body.pitches)) return NextResponse.json({ error: 'pitches must be a list' }, { status: 400 });

  // Drop blanks and repeats that differ only by case or spacing.
  const seen = new Set<string>();
  const names: string[] = [];
  for (const p of body.pitches) {
    if (typeof p !== 'string') continue;
    const name = p.trim().replace(/\s+/g, ' ');
    const key = name.toLowerCase();
    if (!name || seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }

  const { error: delError } = await ctx.service.from('sales_pitches').delete().not('id', 'is', null);
  if (delError) return NextResponse.json({ error: delError.message }, { status: 500 });
  if (names.length) {
    const { error } = await ctx.service
      .from('sales_pitches')
      .insert(names.map((name, position) => ({ name, position })));
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ pitches: names });
}
