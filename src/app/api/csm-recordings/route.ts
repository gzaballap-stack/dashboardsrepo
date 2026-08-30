import { NextResponse } from 'next/server';
import { getAuthContext, isAuthError } from '@/lib/api-auth';

// Conversations with clients, attributed to a CSM.
//
// Two sources feed the same list: CSM touchpoints logged against an existing
// client, and B2B calls. A B2B call only carries a client_id once that lead has
// converted, so unconverted B2B calls surface with a null client and are
// grouped under the lead name instead.

type Row = {
  id: string;
  source: 'client' | 'b2b';
  occurred_at: string;
  client_id: string | null;
  client_name: string | null;
  csm_name: string | null;
  agent_name: string | null;
  counterparty: string | null;
  duration_seconds: number | null;
  call_status: string | null;
  summary: string | null;
  recording_url: string;
};

export async function GET(req: Request) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;

  const { searchParams } = new URL(req.url);
  const csm_name   = searchParams.get('csm_name');
  const client_id  = searchParams.get('client_id');
  const start_date = searchParams.get('start_date');
  const end_date   = searchParams.get('end_date');
  const source     = searchParams.get('source'); // 'client' | 'b2b' | null for both

  const startTs = start_date ? `${start_date}T00:00:00.000Z` : null;
  const endTs   = end_date   ? `${end_date}T23:59:59.999Z`   : null;

  let tpQuery = ctx.service
    .from('client_touchpoints')
    .select('id, client_id, occurred_at, type, summary, csm_name, recording_url, duration_seconds, agent_name, call_status, clients(name)')
    .not('recording_url', 'is', null);

  if (csm_name)  tpQuery = tpQuery.eq('csm_name', csm_name);
  if (client_id) tpQuery = tpQuery.eq('client_id', client_id);
  if (startTs)   tpQuery = tpQuery.gte('occurred_at', startTs);
  if (endTs)     tpQuery = tpQuery.lte('occurred_at', endTs);

  let b2bQuery = ctx.service
    .from('b2b_events')
    .select('id, client_id, occurred_at, lead_name, call_summary, csm_name, recording_url, duration_seconds, agent_name, call_status')
    .eq('event_type', 'call')
    .not('recording_url', 'is', null);

  if (csm_name)  b2bQuery = b2bQuery.eq('csm_name', csm_name);
  if (client_id) b2bQuery = b2bQuery.eq('client_id', client_id);
  if (startTs)   b2bQuery = b2bQuery.gte('occurred_at', startTs);
  if (endTs)     b2bQuery = b2bQuery.lte('occurred_at', endTs);

  const [tpRes, b2bRes, clientRes] = await Promise.all([
    source === 'b2b'    ? Promise.resolve({ data: [], error: null }) : tpQuery,
    source === 'client' ? Promise.resolve({ data: [], error: null }) : b2bQuery,
    ctx.service.from('clients').select('id, name'),
  ]);

  if (tpRes.error) return NextResponse.json({ error: tpRes.error.message }, { status: 500 });
  // b2b_events exists only in V1 — V2 has no B2B model at all. A failure here
  // means "no B2B calls", not a broken request, so the client-side touchpoint
  // recordings still come through.
  const b2bRows = b2bRes.error ? [] : (b2bRes.data ?? []);

  const nameById = new Map<string, string>((clientRes.data ?? []).map(c => [c.id as string, c.name as string]));

  const rows: Row[] = [];

  for (const t of (tpRes.data ?? []) as Record<string, unknown>[]) {
    const joined = t.clients as { name?: string } | { name?: string }[] | null;
    const joinedName = Array.isArray(joined) ? joined[0]?.name : joined?.name;
    rows.push({
      id: t.id as string,
      source: 'client',
      occurred_at: t.occurred_at as string,
      client_id: (t.client_id as string) ?? null,
      client_name: joinedName ?? nameById.get(t.client_id as string) ?? null,
      csm_name: (t.csm_name as string) ?? null,
      agent_name: (t.agent_name as string) ?? null,
      counterparty: joinedName ?? nameById.get(t.client_id as string) ?? null,
      duration_seconds: (t.duration_seconds as number) ?? null,
      call_status: (t.call_status as string) ?? null,
      summary: (t.summary as string) ?? null,
      recording_url: t.recording_url as string,
    });
  }

  for (const b of b2bRows as Record<string, unknown>[]) {
    const cid = (b.client_id as string) ?? null;
    rows.push({
      id: b.id as string,
      source: 'b2b',
      occurred_at: b.occurred_at as string,
      client_id: cid,
      client_name: cid ? nameById.get(cid) ?? null : null,
      csm_name: (b.csm_name as string) ?? null,
      agent_name: (b.agent_name as string) ?? null,
      counterparty: (cid ? nameById.get(cid) : null) ?? (b.lead_name as string) ?? null,
      duration_seconds: (b.duration_seconds as number) ?? null,
      call_status: (b.call_status as string) ?? null,
      summary: (b.call_summary as string) ?? null,
      recording_url: b.recording_url as string,
    });
  }

  rows.sort((a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime());

  // Roll up so the CSM view can show who spoke to whom without a second query.
  const byCsm = new Map<string, { csm_name: string; calls: number; total_seconds: number; clients: Set<string> }>();
  for (const r of rows) {
    const key = r.csm_name ?? 'Unassigned';
    const acc = byCsm.get(key) ?? { csm_name: key, calls: 0, total_seconds: 0, clients: new Set<string>() };
    acc.calls++;
    acc.total_seconds += r.duration_seconds ?? 0;
    if (r.counterparty) acc.clients.add(r.counterparty);
    byCsm.set(key, acc);
  }

  return NextResponse.json({
    rows,
    total: rows.length,
    by_csm: Array.from(byCsm.values())
      .map(a => ({ csm_name: a.csm_name, calls: a.calls, total_seconds: a.total_seconds, clients: a.clients.size }))
      .sort((a, b) => b.calls - a.calls),
  });
}
