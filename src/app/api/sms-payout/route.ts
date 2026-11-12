import { NextResponse } from 'next/server';
import { getAuthContext, isAuthError, type AuthContext } from '@/lib/api-auth';
import {
  DEFAULT_PCT, clampPct, computeRow, dayOf, isDay, suggestClient, totals,
  type Charge, type PayoutRow,
} from '@/lib/sms-payout';

// Johnny's payout (SMS Dashboard) — see lib/sms-payout.ts for the rules.
//
//   GET ?start_date&end_date   clients signed in the period (sms_payouts rows),
//                              each with its 30-day window, revenue and payout;
//                              plus the SMS closes in the period not yet tied to
//                              a client, and the roster to tie them to.
//   POST { action: 'link',  close_event_id, client_id }   an SMS close became this client
//        { action: 'add',   client_id }                   a client signed without a close row
//        { action: 'update', id, pct?, started_on?, notes? }   started_on null = back to the first blast
//        { action: 'remove', id }
//        { action: 'default_pct', pct }                    the % new rows start from
//
// Tables sms_payouts + app_settings (migrations/add_sms_payouts.sql). Without
// them the GET answers { ready: false } and the panel says what to run.

type Service = AuthContext['service'];
type Row = Record<string, unknown>;

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });
const missing = (e: { message?: string } | null | undefined) => !!e && /does not exist|schema cache|Could not find the table/i.test(e.message ?? '');
const NEEDS_SETUP = { ready: false, error: "Johnny's payout needs a one-off database update first (node scripts/migrate-sms-payouts.mjs v1)" };
const todayUtc = () => new Date().toISOString().slice(0, 10);

async function readDefaultPct(service: Service): Promise<number> {
  const { data } = await service.from('app_settings').select('value').eq('key', 'sms_payout_pct').maybeSingle();
  return clampPct((data as { value?: unknown } | null)?.value, DEFAULT_PCT);
}

async function roster(service: Service) {
  const { data } = await service.from('clients').select('id, name, is_internal').order('name');
  const clients = ((data ?? []) as Row[]).filter(c => !c.is_internal).map(c => ({ id: String(c.id), name: String(c.name) }));
  // P&L profile emails help match an SMS close to a roster client.
  const emails = new Map<string, string>();
  const { data: profiles, error } = await service.from('pnl_clients').select('client_id, email');
  if (!error) for (const p of (profiles ?? []) as Row[]) if (p.client_id && p.email) emails.set(String(p.client_id), String(p.email));
  return clients.map(c => ({ ...c, email: emails.get(c.id) ?? null }));
}

/** B2B closes on the SMS channel in the period (what signs a client). */
async function smsCloses(service: Service, start: string | null, end: string | null) {
  let q = service.from('b2b_events')
    .select('id, occurred_at, lead_name, lead_email, lead_phone, revenue, client_id')
    .eq('event_type', 'close').eq('ad_platform', 'sms')
    .order('occurred_at', { ascending: false }).limit(1000);
  if (start) q = q.gte('occurred_at', `${start}T00:00:00.000Z`);
  if (end)   q = q.lte('occurred_at', `${end}T23:59:59.999Z`);
  const { data, error } = await q;
  if (error) return missing(error) ? [] : Promise.reject(new Error(error.message));
  return (data ?? []) as Row[];
}

export async function GET(req: Request) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;
  const { service } = ctx;
  const { searchParams } = new URL(req.url);
  const start = searchParams.get('start_date') || null;
  const end = searchParams.get('end_date') || null;
  if ((start && !isDay(start)) || (end && !isDay(end))) return bad('Dates must be YYYY-MM-DD');

  try {
    const [closes, clients, default_pct] = await Promise.all([smsCloses(service, start, end), roster(service), readDefaultPct(service).catch(() => DEFAULT_PCT)]);

    // Every payout row ever (small table) — the period filter is on signed_on,
    // and a close already tied to a client must not show as unlinked again.
    const { data: allRows, error } = await service.from('sms_payouts').select('*').order('signed_on', { ascending: false });
    if (error) return missing(error) ? NextResponse.json(NEEDS_SETUP) : bad(error.message, 500);
    let rows = (allRows ?? []) as Row[];

    // A close that already names its roster client (GHL sent client_name) is
    // tied on its own, once.
    const linkedCloses = new Set(rows.map(r => String(r.close_event_id ?? '')));
    const linkedClients = new Set(rows.map(r => String(r.client_id)));
    for (const c of closes) {
      const cid = c.client_id ? String(c.client_id) : null;
      if (!cid || linkedCloses.has(String(c.id)) || linkedClients.has(cid) || !clients.some(k => k.id === cid)) continue;
      const { data: made } = await service.from('sms_payouts')
        .insert({ client_id: cid, close_event_id: c.id, signed_on: dayOf(String(c.occurred_at)) ?? todayUtc(), pct: default_pct }).select('*');
      if (made?.[0]) { rows = [made[0] as Row, ...rows]; linkedCloses.add(String(c.id)); linkedClients.add(cid); }
    }

    const inPeriod = rows.filter(r => (!start || String(r.signed_on) >= start) && (!end || String(r.signed_on) <= end));
    const ids = inPeriod.map(r => String(r.client_id));

    // First blast per client, and the client's paid charges (any period — the
    // window is the client's own 30 days, not the page's range).
    const firstBlast = new Map<string, string>();
    await Promise.all(ids.map(async id => {
      const { data } = await service.from('sms_sends').select('sent_date').eq('client_id', id).order('sent_date', { ascending: true }).limit(1);
      const d = (data as Row[] | null)?.[0]?.sent_date;
      if (d) firstBlast.set(id, String(d));
    }));
    let charges: Charge[] = [];
    if (ids.length) {
      const { data, error: cErr } = await service.from('billing_charges').select('client_id, total, status, paid_at, created_at').in('client_id', ids).eq('status', 'paid').limit(5000);
      if (!cErr) charges = (data ?? []) as Charge[];
    }
    const closeById = new Map(closes.map(c => [String(c.id), c]));
    const nameOf = new Map(clients.map(c => [c.id, c.name]));
    const today = todayUtc();
    const out: PayoutRow[] = inPeriod.map(r => {
      const cid = String(r.client_id);
      const close = r.close_event_id ? closeById.get(String(r.close_event_id)) : undefined;
      return computeRow({
        id: String(r.id), client_id: cid, client_name: nameOf.get(cid) ?? 'Client no longer on the roster',
        close_event_id: r.close_event_id ? String(r.close_event_id) : null,
        signed_on: String(r.signed_on), started_on: r.started_on ? String(r.started_on) : null,
        pct: clampPct(r.pct, default_pct), notes: r.notes ? String(r.notes) : null,
        cash_at_close: Number(close?.revenue) || 0,
      }, firstBlast.get(cid) ?? null, charges, today);
    });

    const unlinked = closes.filter(c => !linkedCloses.has(String(c.id))).map(c => ({
      id: String(c.id), occurred_at: String(c.occurred_at), lead_name: (c.lead_name as string | null) ?? null,
      lead_email: (c.lead_email as string | null) ?? null, lead_phone: (c.lead_phone as string | null) ?? null,
      revenue: Number(c.revenue) || 0,
      suggested_client_id: suggestClient({ lead_name: c.lead_name as string | null, lead_email: c.lead_email as string | null }, clients.filter(k => !linkedClients.has(k.id))),
    }));

    return NextResponse.json({
      ready: true, default_pct, rows: out, totals: totals(out), unlinked,
      clients: clients.map(c => ({ id: c.id, name: c.name, linked: linkedClients.has(c.id) })),
    });
  } catch (e) {
    return bad(e instanceof Error ? e.message : String(e), 500);
  }
}

export async function POST(req: Request) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;
  const { service } = ctx;
  let body: Row;
  try { body = await req.json(); } catch { return bad('Invalid JSON'); }
  const action = String(body.action ?? '');
  const str = (k: string) => (body[k] == null ? null : String(body[k]).trim() || null);

  const result = (res: { data: unknown; error: { message?: string } | null }) =>
    res.error ? (missing(res.error) ? NextResponse.json(NEEDS_SETUP, { status: 409 }) : bad(res.error.message ?? 'Database error', 500)) : NextResponse.json({ ok: true, row: Array.isArray(res.data) ? res.data[0] ?? null : res.data });

  if (action === 'default_pct') {
    const pct = clampPct(body.pct, NaN);
    if (!Number.isFinite(pct)) return bad('pct must be a number between 0 and 100');
    return result(await service.from('app_settings').upsert({ key: 'sms_payout_pct', value: pct, updated_at: new Date().toISOString() }, { onConflict: 'key' }).select('value'));
  }

  if (action === 'link' || action === 'add') {
    const client_id = str('client_id');
    if (!client_id) return bad('client_id is required');
    const { data: client } = await service.from('clients').select('id, is_internal').eq('id', client_id).maybeSingle();
    if (!client || (client as Row).is_internal) return bad('Pick a client from the roster');
    const { data: dupe } = await service.from('sms_payouts').select('id').eq('client_id', client_id).maybeSingle();
    if (dupe) return bad('That client is already on the payout tracker', 409);
    const pct = await readDefaultPct(service).catch(() => DEFAULT_PCT);
    let signed_on = todayUtc(); let close_event_id: string | null = null;
    if (action === 'link') {
      close_event_id = str('close_event_id');
      if (!close_event_id) return bad('close_event_id is required');
      const { data: close, error } = await service.from('b2b_events').select('id, occurred_at, event_type').eq('id', close_event_id).maybeSingle();
      if (error) return bad(error.message, 500);
      if (!close || (close as Row).event_type !== 'close') return bad('That close could not be found');
      const { data: taken } = await service.from('sms_payouts').select('id').eq('close_event_id', close_event_id).maybeSingle();
      if (taken) return bad('That close is already tied to a client', 409);
      signed_on = dayOf(String((close as Row).occurred_at)) ?? signed_on;
    } else if (isDay(body.signed_on)) {
      signed_on = body.signed_on;
    }
    return result(await service.from('sms_payouts').insert({ client_id, close_event_id, signed_on, pct }).select('*'));
  }

  if (action === 'update') {
    const id = str('id');
    if (!id) return bad('id is required');
    const patch: Row = { updated_at: new Date().toISOString() };
    if ('pct' in body) { const pct = clampPct(body.pct, NaN); if (!Number.isFinite(pct)) return bad('pct must be a number between 0 and 100'); patch.pct = pct; }
    if ('started_on' in body) {
      if (body.started_on === null || body.started_on === '') patch.started_on = null;
      else if (isDay(body.started_on)) patch.started_on = body.started_on;
      else return bad('started_on must be YYYY-MM-DD or empty');
    }
    if ('signed_on' in body) { if (!isDay(body.signed_on)) return bad('signed_on must be YYYY-MM-DD'); patch.signed_on = body.signed_on; }
    if ('notes' in body) patch.notes = str('notes');
    return result(await service.from('sms_payouts').update(patch).eq('id', id).select('*'));
  }

  if (action === 'remove') {
    const id = str('id');
    if (!id) return bad('id is required');
    return result(await service.from('sms_payouts').delete().eq('id', id).select('id'));
  }

  return bad('Unknown action');
}
