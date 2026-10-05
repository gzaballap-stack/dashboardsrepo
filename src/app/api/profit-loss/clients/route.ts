import { NextResponse } from 'next/server';
import { getAuthContext, isAuthError } from '@/lib/api-auth';

// Profit and Loss — what we know about a client beyond the name on their
// payment lines. A client is whoever a revenue line names; `name_key` (the name
// lower-cased and trimmed) is what ties the two together.

const COLS = 'name_key, name, contact_name, company, email, phone, website, notes';
const FIELDS = ['contact_name', 'company', 'email', 'phone', 'website', 'notes'] as const;
const PAGE = 1000;

const keyOf = (name: string) => name.trim().toLowerCase();
const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

export async function GET() {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;

  const { data, error } = await ctx.service
    .from('pnl_clients').select(COLS).eq('user_id', ctx.userId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ clients: data ?? [] });
}

// Saves a client's details. `current` is the name their lines carry now; if
// `name` differs, every one of their lines is renamed with it, so the history
// stays attached. Renaming onto another client's name merges the two.
export async function PUT(req: Request) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;

  const body = await req.json();
  const current = typeof body.current === 'string' ? body.current.trim() : '';
  const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : current;
  if (!current) return NextResponse.json({ error: 'current is required' }, { status: 400 });
  const oldKey = keyOf(current), newKey = keyOf(name);

  // Rename the lines first: if this fails, nothing else has changed.
  const ids: string[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await ctx.service
      .from('pnl_lines').select('id, label')
      .eq('user_id', ctx.userId).eq('kind', 'revenue')
      .order('id').range(from, from + PAGE - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    for (const l of data ?? []) if (keyOf(l.label) === oldKey && l.label !== name) ids.push(l.id);
    if (!data || data.length < PAGE) break;
  }
  if (ids.length) {
    const { error } = await ctx.service
      .from('pnl_lines').update({ label: name, updated_at: new Date().toISOString() })
      .eq('user_id', ctx.userId).in('id', ids);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // When two clients are merged, a detail left blank here keeps the other's.
  const { data: existing } = await ctx.service
    .from('pnl_clients').select(COLS).eq('user_id', ctx.userId).in('name_key', [oldKey, newKey]);
  const target = newKey === oldKey ? null : existing?.find(c => c.name_key === newKey) ?? null;

  const row: Record<string, unknown> = {
    user_id: ctx.userId, name_key: newKey, name, updated_at: new Date().toISOString(),
  };
  for (const f of FIELDS) row[f] = text(body[f]) ?? target?.[f] ?? null;

  const { data, error } = await ctx.service
    .from('pnl_clients').upsert(row, { onConflict: 'user_id,name_key' }).select(COLS).single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (newKey !== oldKey) {
    await ctx.service.from('pnl_clients').delete().eq('user_id', ctx.userId).eq('name_key', oldKey);
  }
  return NextResponse.json({ client: data, renamed: ids.length });
}
