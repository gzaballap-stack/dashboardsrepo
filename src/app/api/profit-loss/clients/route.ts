import { NextResponse } from 'next/server';
import { getAuthContext, isAuthError } from '@/lib/api-auth';

// Profit and Loss — what we know about a client beyond the name on their
// payment lines. A client is whoever a revenue line names; `name_key` (the name
// lower-cased and trimmed) is what ties the two together. A profile may point
// at a Client Roster record (`client_id`); that record's name then shows
// everywhere on Profit and Loss.

const COLS = 'name_key, name, contact_name, company, email, phone, website, notes, client_id';
// A database without the roster link yet still answers, minus that column.
const LEGACY_COLS = 'name_key, name, contact_name, company, email, phone, website, notes';
const FIELDS = ['contact_name', 'company', 'email', 'phone', 'website', 'notes'] as const;
const PAGE = 1000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const keyOf = (name: string) => name.trim().toLowerCase();
const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const missingLink = (e: { message?: string } | null) => !!e && /client_id/.test(e.message ?? '');
type Rows = { data: Record<string, unknown>[] | null; error: { message?: string } | null };

export async function GET() {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;

  let res: Rows = await ctx.service.from('pnl_clients').select(COLS).eq('user_id', ctx.userId);
  if (missingLink(res.error)) res = await ctx.service.from('pnl_clients').select(LEGACY_COLS).eq('user_id', ctx.userId);
  if (res.error) return NextResponse.json({ error: res.error.message }, { status: 500 });
  return NextResponse.json({ clients: res.data ?? [] });
}

// Saves a client's details. `current` is the name their lines carry now; if
// `name` differs, every one of their lines is renamed with it, so the history
// stays attached. Renaming onto another client's name merges the two.
// `client_id` (a roster client's id, or null) links or unlinks the profile.
export async function PUT(req: Request) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;

  const body = await req.json();
  const current = typeof body.current === 'string' ? body.current.trim() : '';
  const name = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : current;
  if (!current) return NextResponse.json({ error: 'current is required' }, { status: 400 });
  const oldKey = keyOf(current), newKey = keyOf(name);

  let clientId: string | null | undefined;
  if ('client_id' in body) {
    if (body.client_id === null || body.client_id === '') clientId = null;
    else if (typeof body.client_id === 'string' && UUID.test(body.client_id)) clientId = body.client_id;
    else return NextResponse.json({ error: 'client_id must be a roster client id or null' }, { status: 400 });
  }
  if (clientId) {
    const { data: roster } = await ctx.service.from('clients').select('id').eq('id', clientId).eq('is_internal', false).maybeSingle();
    if (!roster) return NextResponse.json({ error: 'That roster client does not exist' }, { status: 400 });
  }

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
  let existing: Record<string, unknown>[] | null = null;
  {
    let res: Rows = await ctx.service.from('pnl_clients').select(COLS).eq('user_id', ctx.userId).in('name_key', [oldKey, newKey]);
    if (missingLink(res.error)) res = await ctx.service.from('pnl_clients').select(LEGACY_COLS).eq('user_id', ctx.userId).in('name_key', [oldKey, newKey]);
    existing = res.data as Record<string, unknown>[] | null;
  }
  const mine = existing?.find(c => c.name_key === oldKey) ?? null;
  const target = newKey === oldKey ? null : existing?.find(c => c.name_key === newKey) ?? null;

  const row: Record<string, unknown> = {
    user_id: ctx.userId, name_key: newKey, name, updated_at: new Date().toISOString(),
  };
  for (const f of FIELDS) row[f] = text(body[f]) ?? target?.[f] ?? null;
  // An unmentioned link is kept (own, else the merge target's); a mentioned one wins.
  const keptLink = (mine?.client_id as string | null | undefined) ?? (target?.client_id as string | null | undefined) ?? null;
  const link = clientId === undefined ? keptLink : clientId;
  if (link !== null || clientId !== undefined) row.client_id = link;

  let { data, error }: { data: Record<string, unknown> | null; error: { message?: string } | null } = await ctx.service
    .from('pnl_clients').upsert(row, { onConflict: 'user_id,name_key' }).select(COLS).single();
  if (missingLink(error)) {
    if (clientId !== undefined) {
      return NextResponse.json({ error: 'Linking to the Client Roster needs a one-off database update first' }, { status: 503 });
    }
    delete row.client_id;
    ({ data, error } = await ctx.service
      .from('pnl_clients').upsert(row, { onConflict: 'user_id,name_key' }).select(LEGACY_COLS).single());
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  if (newKey !== oldKey) {
    await ctx.service.from('pnl_clients').delete().eq('user_id', ctx.userId).eq('name_key', oldKey);
  }
  return NextResponse.json({ client: data, renamed: ids.length });
}
