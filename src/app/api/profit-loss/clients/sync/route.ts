import { NextResponse } from 'next/server';
import { getAuthContext, isAuthError } from '@/lib/api-auth';

// Puts Profit and Loss clients on the Client Roster, so every client who has
// ever paid has one roster record and the two lists agree.
//
// POST { names?: string[], status?: "live" | "offline" }
//   names  — the sheet names to handle; omitted = every unlinked P&L client.
//   status — for roster records that have to be created. Omitted: a client
//            who paid in the latest month logged is Live, anyone else Offline.
// A name that already matches a roster client is linked, never duplicated.

const PAGE = 1000;
const keyOf = (name: string) => name.trim().toLowerCase();

export async function POST(req: Request) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;

  const body = await req.json().catch(() => ({}));
  const wanted: string[] | null = Array.isArray(body.names)
    ? body.names.filter((v: unknown) => typeof v === 'string' && v.trim()).map((v: string) => v.trim())
    : null;
  const forced: 'live' | 'offline' | null = body.status === 'live' || body.status === 'offline' ? body.status : null;

  // Every client name on the sheet, and the latest month each one paid in.
  const lastPaid = new Map<string, string>();
  const spelling = new Map<string, string>();
  let latestMonth = '';
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await ctx.service
      .from('pnl_lines').select('label, month, amount')
      .eq('user_id', ctx.userId).eq('kind', 'revenue')
      .order('month').range(from, from + PAGE - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    for (const l of data ?? []) {
      const k = keyOf(l.label);
      if (!k) continue;
      if (!spelling.has(k)) spelling.set(k, l.label.trim());
      if (Number(l.amount)) {
        if (!lastPaid.has(k) || l.month > lastPaid.get(k)!) lastPaid.set(k, l.month);
        if (l.month > latestMonth) latestMonth = l.month;
      }
    }
    if (!data || data.length < PAGE) break;
  }

  const { data: profiles, error: profileError } = await ctx.service
    .from('pnl_clients').select('name_key, name, client_id').eq('user_id', ctx.userId);
  if (profileError) {
    const missing = /client_id/.test(profileError.message);
    return NextResponse.json(
      { error: missing ? 'Linking to the Client Roster needs a one-off database update first' : profileError.message },
      { status: missing ? 503 : 500 });
  }
  const profileByKey = new Map((profiles ?? []).map(p => [p.name_key as string, p]));

  const { data: roster, error: rosterError } = await ctx.service
    .from('clients').select('id, name').eq('is_internal', false);
  if (rosterError) return NextResponse.json({ error: rosterError.message }, { status: 500 });
  const rosterByKey = new Map((roster ?? []).map(c => [keyOf(c.name), c]));

  const keys = wanted ? wanted.map(keyOf) : [...spelling.keys()];
  const created: string[] = [], linked: string[] = [], skipped: string[] = [];

  for (const k of keys) {
    const profile = profileByKey.get(k);
    if (profile?.client_id) { skipped.push(spelling.get(k) ?? k); continue; }
    const name = profile?.name ?? spelling.get(k) ?? (wanted?.find(w => keyOf(w) === k) ?? k);

    let clientId = rosterByKey.get(k)?.id ?? null;
    if (!clientId) {
      const status = forced ?? (lastPaid.get(k) && lastPaid.get(k) === latestMonth ? 'live' : 'offline');
      const { data: row, error } = await ctx.service
        .from('clients')
        .insert({ name, status, is_live: status === 'live' })
        .select('id, name')
        .single();
      if (error) return NextResponse.json({ error: `${name}: ${error.message}`, created, linked }, { status: 500 });
      clientId = row.id;
      rosterByKey.set(k, row);
      created.push(name);
    } else {
      linked.push(name);
    }

    const { error } = await ctx.service
      .from('pnl_clients')
      .upsert({ user_id: ctx.userId, name_key: k, name, client_id: clientId, updated_at: new Date().toISOString() },
        { onConflict: 'user_id,name_key' });
    if (error) return NextResponse.json({ error: `${name}: ${error.message}`, created, linked }, { status: 500 });
  }

  return NextResponse.json({ created, linked, skipped });
}
