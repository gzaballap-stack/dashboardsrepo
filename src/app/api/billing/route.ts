import { NextResponse } from 'next/server';
import { getAuthContext, isAuthError, type AuthContext } from '@/lib/api-auth';
import {
  APPOINTMENT_TYPES, LIVE_CHARGE_STATUSES, STRIPE_MINIMUM,
  canBill, creditBalance, creditInAppointments, isMissingColumn, isMissingTable, oldestOpenCredit, paidByCredit,
  namesNote, planCharge, planCovers, returnsBySource, round2, sourceOf, toCents,
  type BillingState, type Source,
} from '@/lib/billing';
import {
  StripeError, stripeStatus, getCustomer, createDraftInvoice, finalizeInvoice,
  payInvoice, sendInvoice, getInvoice, voidInvoice, deleteDraftInvoice, notePayment,
} from '@/lib/stripe';

// Client Billing — which appointments each client has been charged for, which
// were credited, the charges themselves and the credit each client holds.
//
//   GET                      every client, with their figures for the period
//   GET ?client_id=          one client: appointments, charges, credits
//   GET ?view=recent&from=&to=   every client's appointments booked in that stretch
//   POST { action: ... }     settings | profile | charge | void | credit |
//                            uncredit | cancel | uncancel | add_credit |
//                            delete_credit
//
// Charges go through Stripe (saved card, or an emailed invoice) or are recorded
// by hand. Nothing here ever charges without an explicit `charge` action.
//
// Credit a client holds is spent for them: their next booking after the credit
// was issued is marked "covered by credit" (a charge of 0, paid in full by the
// credit) and is never billed. See coverWithCredit.

type Service = AuthContext['service'];
type Row = Record<string, unknown>;

const PAGE = 1000;
const NEEDS_SETUP = { ready: false, error: 'Client Billing needs a one-off database update first' };
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const CHARGE_COLS = 'id, client_id, client_name, kind, description, appointment_count, subtotal, credit_applied, total, method, status, stripe_invoice_id, stripe_invoice_url, error, created_at, paid_at';
// Every column: a database that has not had `cancelled_at` added yet still
// answers, and simply has nothing cancelled.
const APPT_COLS = '*';

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });

async function guard(): Promise<AuthContext | NextResponse> {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;
  if (!(await canBill(ctx))) return bad('Client Billing is not enabled for this account', 403);
  return ctx;
}

// Supabase caps a select at 1000 rows; read on until a short page.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function readAll(build: (from: number, to: number) => any, maxPages = 40): Promise<{ rows: Row[]; error: { code?: string; message?: string } | null }> {
  const rows: Row[] = [];
  for (let page = 0; page < maxPages; page++) {
    const { data, error } = await build(page * PAGE, page * PAGE + PAGE - 1);
    if (error) return { rows, error };
    rows.push(...((data ?? []) as Row[]));
    if (!data || data.length < PAGE) break;
  }
  return { rows, error: null };
}

const chunks = <T,>(list: T[], size = 150): T[][] =>
  Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, i * size + size));

const num = (v: unknown) => Number(v ?? 0) || 0;

// A figure that can't be read stops the save — never quietly stored as 0.
function amount(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? round2(v) : null;
  if (typeof v !== 'string') return null;
  const text = v.replace(/[$,\s]/g, '');
  if (!text) return null;
  const n = Number(text);
  return Number.isFinite(n) ? round2(n) : null;
}

const strings = (v: unknown): string[] =>
  Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && x.length > 0))] : [];

async function balanceOf(service: Service, clientId: string): Promise<number> {
  const [appts, credits, charges] = await Promise.all([
    readAll((a, b) => service.from('billing_appointments').select('credit_amount').eq('client_id', clientId).gt('credit_amount', 0).range(a, b)),
    readAll((a, b) => service.from('billing_credits').select('amount').eq('client_id', clientId).range(a, b)),
    readAll((a, b) => service.from('billing_charges').select('credit_applied, status').eq('client_id', clientId).gt('credit_applied', 0).range(a, b)),
  ]);
  return creditBalance(
    appts.rows as { credit_amount: number }[],
    credits.rows as { amount: number }[],
    charges.rows as { credit_applied: number; status: string }[],
  );
}

// A charge that didn't happen lets go of its appointments: the ones only it
// held go back to "not charged"; ones credited meanwhile stay credited, worth 0.
async function release(service: Service, chargeId: string) {
  await service.from('billing_appointments').delete().eq('charge_id', chargeId).is('credited_at', null);
  await service.from('billing_appointments')
    .update({ charge_id: null, credit_amount: 0, updated_at: new Date().toISOString() })
    .eq('charge_id', chargeId);
}

async function setCharge(service: Service, id: string, patch: Row) {
  const { data } = await service.from('billing_charges').update(patch).eq('id', id).select(CHARGE_COLS).single();
  return data as Row | null;
}

// Marks a client's next bookings as covered by the credit they hold. Each cover
// is a charge of 0 paid in full by credit, holding that one appointment — the
// same record a hand-made "use credit" charge leaves, so everything that reads
// charges and credit already understands it. Safe to call at any time; does
// nothing unless they hold at least one appointment's price and have a booking
// made since that credit was issued. Returns how many it covered.
const COVER = 'cover:';

async function coverWithCredit(service: Service, clientId: string): Promise<number> {
  const { data: s } = await service.from('billing_clients').select('price_per_appointment').eq('client_id', clientId).maybeSingle();
  const price = num(s?.price_per_appointment);
  if (price <= 0) return 0;

  const [appts, credits, charges] = await Promise.all([
    readAll((a, b) => service.from('billing_appointments').select('event_id, credit_amount, credited_at').eq('client_id', clientId).range(a, b)),
    readAll((a, b) => service.from('billing_credits').select('amount, created_at').eq('client_id', clientId).range(a, b)),
    readAll((a, b) => service.from('billing_charges').select('credit_applied, status').eq('client_id', clientId).gt('credit_applied', 0).range(a, b)),
  ]);
  if (appts.error || credits.error || charges.error) return 0;

  const entries = [
    ...appts.rows.filter(a => num(a.credit_amount) > 0 && a.credited_at).map(a => ({ at: a.credited_at as string, amount: num(a.credit_amount) })),
    ...credits.rows.filter(c => num(c.amount) > 0).map(c => ({ at: c.created_at as string, amount: num(c.amount) })),
  ];
  const used = round2(charges.rows.filter(c => LIVE_CHARGE_STATUSES.includes(c.status as string)).reduce((t, c) => t + num(c.credit_applied), 0));
  const since = oldestOpenCredit(entries, used);
  if (!since) return 0;

  const { data: events, error } = await service.from('events')
    .select('id, lead_name, scheduled_at, occurred_at')
    .eq('client_id', clientId).in('event_type', APPOINTMENT_TYPES)
    .gte('occurred_at', since).order('occurred_at', { ascending: true }).limit(500);
  if (error || !events?.length) return 0;

  const tracked = new Set(appts.rows.map(a => a.event_id as string));
  const open = events.filter(e => !tracked.has(e.id as string));
  const plan = planCovers({ credits: entries, used, price, candidates: open.map(e => ({ id: e.id as string, at: e.occurred_at as string })) });
  if (!plan.length) return 0;

  const { data: client } = await service.from('clients').select('name').eq('id', clientId).maybeSingle();
  const made: string[] = [];
  for (const id of plan) {
    const e = open.find(x => x.id === id)!;
    const stamp = new Date().toISOString();
    const { data: charge, error: chargeError } = await service.from('billing_charges').insert({
      client_id: clientId, client_name: client?.name ?? '',
      kind: 'appointments', description: 'Covered by credit', appointment_count: 1,
      subtotal: price, credit_applied: price, total: 0,
      method: 'manual', status: 'paid', paid_at: stamp,
      request_id: `${COVER}${id}:${Date.now()}`,
    }).select('id').single();
    if (chargeError || !charge) break;
    const { error: rowError } = await service.from('billing_appointments').insert({
      client_id: clientId, event_id: id, lead_name: e.lead_name,
      appointment_at: e.scheduled_at ?? e.occurred_at, charge_id: charge.id, price,
    });
    // Someone charged or credited it in the same moment: leave it to them.
    if (rowError) { await service.from('billing_charges').delete().eq('id', charge.id); continue; }
    made.push(charge.id as string);
  }

  // Two loads at once must never spend the same credit twice.
  while (made.length && (await balanceOf(service, clientId)) < -0.005) {
    const last = made.pop()!;
    await service.from('billing_appointments').delete().eq('charge_id', last);
    await service.from('billing_charges').delete().eq('id', last);
  }
  return made.length;
}

// Taking a credit back needs that much credit unspent. Where it has already
// gone on covered bookings, those go back to "to bill" (newest first) to free
// it. false = it was spent on a real charge, or on a booking since credited.
async function freeCredit(service: Service, clientId: string, needed: number): Promise<boolean> {
  let balance = await balanceOf(service, clientId);
  if (balance - needed >= -0.005) return true;

  const { data: covers } = await service.from('billing_charges')
    .select('id, credit_applied').eq('client_id', clientId).eq('status', 'paid')
    .like('request_id', `${COVER}%`).order('created_at', { ascending: false });
  const undo: string[] = [];
  for (const c of covers ?? []) {
    const { data: held } = await service.from('billing_appointments').select('credited_at').eq('charge_id', c.id);
    if ((held ?? []).some(h => h.credited_at)) continue;
    undo.push(c.id as string);
    balance += num(c.credit_applied);
    if (balance - needed >= -0.005) break;
  }
  if (balance - needed < -0.005) return false;
  for (const id of undo) {
    await service.from('billing_appointments').delete().eq('charge_id', id);
    await service.from('billing_charges').delete().eq('id', id);
  }
  return true;
}

/* ── what each source cost ── */

// Only SMS costs Tomsi Media anything: messages sent × the per-message rate,
// the Clients dashboard's Total SMS Cost. Ad spend is paid by the client, so
// Facebook Ads appointments carry no cost here. A table that can't be read
// counts as nothing spent rather than failing the page.
// `sms_sends` holds a row per text sent — tens of thousands a month. Reading
// them a thousand at a time to add them up was what made this page take
// several seconds, so the database adds them up instead (`sms_totals`, one row
// per client). Until that function exists on a database, the rows are still
// read here, but in as few trips as the database allows.
async function readSms(service: Service, opts: { clientId?: string; start: string | null; end: string | null }): Promise<Row[]> {
  try {
    const { data, error } = await service.rpc('sms_totals', { p_start: opts.start, p_end: opts.end, p_client: opts.clientId ?? null });
    if (!error && Array.isArray(data)) return data as Row[];
  } catch { /* not there yet — read the rows */ }

  const WIDE = 50_000;
  const rows: Row[] = [];
  for (let trip = 0; trip < 60; trip++) {
    let q = service.from('sms_sends').select('client_id, messages').order('sent_date').order('id').range(rows.length, rows.length + WIDE - 1);
    if (opts.clientId) q = q.eq('client_id', opts.clientId);
    if (opts.start) q = q.gte('sent_date', opts.start);
    if (opts.end) q = q.lte('sent_date', opts.end);
    const { data, error } = await q;
    if (error) return [];
    // A short answer may be the database's own cap rather than the end, so
    // only an empty one ends it.
    if (!data?.length) break;
    rows.push(...(data as Row[]));
  }
  return rows;
}

function smsCost(rows: Row[], skip?: Set<string>) {
  const sent = rows.filter(r => !!r.client_id && !skip?.has(r.client_id as string)).reduce((t, r) => t + num(r.messages), 0);
  const rate = Number(process.env.SMS_COST_PER_MESSAGE ?? '0.01') || 0;
  return { ads: 0, sms: round2(sent * rate), sms_sent: sent };
}

const ATTRIBUTION = 'ad_platform, utm_source, utm_medium, utm_campaign, campaign_id, adset_id, ad_id';

/* ── the client's profile, shared with Profit and Loss ── */

// Contact details live in one place — the Profit and Loss client profile
// (pnl_clients, the signed-in user's), tied to the roster client by its link
// or, failing that, by name. Billing shows and edits that same record.
const PROFILE_COLS = 'name_key, name, contact_name, email, phone, website, notes, client_id';
const nameKey = (name: string) => name.trim().toLowerCase();

async function profileFor(ctx: AuthContext, client: { id: string; name: string }) {
  const { data, error } = await ctx.service.from('pnl_clients').select(PROFILE_COLS).eq('user_id', ctx.userId);
  if (error) return { available: false, profile: null, paid: 0, months: 0, last_month: null as string | null, key: nameKey(client.name) };
  const rows = (data ?? []) as Row[];
  const profile = rows.find(r => r.client_id === client.id) ?? rows.find(r => r.name_key === nameKey(client.name)) ?? null;
  const keys = new Set([nameKey(client.name), ...(profile ? [profile.name_key as string] : [])]);

  // What they have paid, per the Profit and Loss sheet.
  const lines = await readAll((a, b) => ctx.service.from('pnl_lines').select('label, amount, month')
    .eq('user_id', ctx.userId).eq('kind', 'revenue').order('month').range(a, b));
  const mine = lines.error ? [] : lines.rows.filter(l => keys.has(nameKey(String(l.label ?? ''))) && num(l.amount) > 0);
  const months = [...new Set(mine.map(l => String(l.month)))].sort();
  return {
    available: true, profile,
    paid: round2(mine.reduce((t, l) => t + num(l.amount), 0)),
    months: months.length, last_month: months[months.length - 1] ?? null,
    key: (profile?.name_key as string | undefined) ?? nameKey(client.name),
  };
}

const tryCover = async (service: Service, clientId: string) => {
  try { return await coverWithCredit(service, clientId); } catch { return 0; }
};

// Bring charges still waiting on Stripe up to date: an emailed invoice that got
// paid, one cancelled in Stripe, or a charge interrupted half-way.
async function syncWithStripe(service: Service, clientId: string) {
  const { data: open } = await service.from('billing_charges')
    .select('id, status, method, stripe_invoice_id, created_at')
    .eq('client_id', clientId).in('status', ['draft', 'pending'])
    .order('created_at', { ascending: false }).limit(15);

  for (const c of open ?? []) {
    const stale = Date.now() - new Date(c.created_at as string).getTime() > 3 * 60_000;
    if (!c.stripe_invoice_id) {
      // Never reached Stripe (manual charges are paid at once, so this is a
      // card / invoice charge that stopped before the invoice existed).
      if (c.status === 'draft' && stale) {
        await setCharge(service, c.id, { status: 'failed', error: 'Interrupted before reaching Stripe — nothing was charged' });
        await release(service, c.id);
      }
      continue;
    }
    if (!stripeStatus().configured) continue;
    try {
      const inv = await getInvoice(c.stripe_invoice_id as string);
      if (inv.status === 'paid') {
        await setCharge(service, c.id, { status: 'paid', paid_at: new Date().toISOString(), stripe_invoice_url: inv.url, error: null });
      } else if (inv.status === 'void' || inv.status === 'uncollectible') {
        await setCharge(service, c.id, { status: 'void', error: inv.status === 'void' ? 'Cancelled in Stripe' : 'Marked uncollectible in Stripe' });
        await release(service, c.id);
      } else if (inv.status === 'draft' && stale) {
        // Created but never finalized: nobody was charged or emailed.
        await deleteDraftInvoice(inv.id);
        await setCharge(service, c.id, { status: 'failed', error: 'Interrupted before it was sent — nothing was charged' });
        await release(service, c.id);
      } else if (inv.status === 'open' && c.status === 'draft') {
        await setCharge(service, c.id, { status: 'pending', stripe_invoice_url: inv.url });
      }
    } catch { /* Stripe unreachable — leave as is, try again next load */ }
  }
}

// Where one appointment stands, for the screen. null = not tracked.
function billingView(a: Row | undefined, charge: Row | undefined) {
  if (!a) return null;
  return {
    // covered = paid in full by their credit: a free appointment, never billed.
    state: a.cancelled_at ? 'cancelled' : a.credited_at ? 'credited' : charge && paidByCredit(charge) ? 'covered' : 'charged',
    price: num(a.price),
    charged: !!a.charge_id,
    charge_id: (a.charge_id as string | null) ?? null,
    charge_status: (charge?.status as string | undefined) ?? null,
    credit_amount: num(a.credit_amount),
    credited_at: (a.credited_at as string | null) ?? null,
    credit_reason: (a.credit_reason as string | null) ?? null,
    cancelled_at: (a.cancelled_at as string | null) ?? null,
  };
}

/* ── GET ──────────────────────────────────────────────────────────────────── */

// Each view asks for everything it needs at once — the access check included —
// and answers nothing until that check is back.
export async function GET(req: Request) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;
  const service = ctx.service;

  const params = new URL(req.url).searchParams;
  const clientId = params.get('client_id');
  const start = DAY.test(params.get('start') ?? '') ? params.get('start')! : null;
  const end = DAY.test(params.get('end') ?? '') ? params.get('end')! : null;
  const from = start ? `${start}T00:00:00.000Z` : null;
  const to = end ? `${end}T23:59:59.999Z` : null;
  const inPeriod = (iso: unknown) => {
    if (typeof iso !== 'string') return false;
    const t = new Date(iso).getTime();
    return (!from || t >= new Date(from).getTime()) && (!to || t <= new Date(to).getTime());
  };
  const stripe = stripeStatus();
  // The backlog view: the period's appointments, plus every SMS appointment
  // booked before it. Those older ones only add to what is listed and counted
  // as not tracked — money figures and the return by source stay the period's.
  const smsAll = params.get('sms_all') === '1' && !!from;
  const none = Promise.resolve({ rows: [] as Row[], error: null as { code?: string; message?: string } | null });

  const readSettings = () => service.from('billing_clients').select('client_id, price_per_appointment, stripe_customer_id');
  type Settings = Awaited<ReturnType<typeof readSettings>>;
  const refuse = (allowed: boolean, probe: Settings) => {
    if (!allowed) return bad('Client Billing is not enabled for this account', 403);
    if (probe.error) return isMissingTable(probe.error) ? NextResponse.json({ ...NEEDS_SETUP, stripe }) : bad(probe.error.message, 500);
    return null;
  };
  const settingsOf = (probe: Settings) => new Map((probe.data ?? []).map(s => [s.client_id as string, s]));

  /* ── the last few days, every client: what was booked and where each stands ── */
  if (params.get('view') === 'recent') {
    const at = (v: string | null) => { const t = v ? new Date(v).getTime() : NaN; return Number.isFinite(t) ? t : null; };
    const toMs = at(params.get('to')) ?? Date.now();
    // Never more than a month back, whatever is asked for.
    const fromMs = Math.max(at(params.get('from')) ?? toMs - 7 * 86_400_000, toMs - 31 * 86_400_000);

    const [allowed, probe, clients, events] = await Promise.all([
      canBill(ctx), readSettings(),
      service.from('clients').select('id, name, service, is_internal'),
      readAll((a, b) => service.from('events')
        .select(`id, client_id, event_type, occurred_at, scheduled_at, lead_name, lead_phone, calendar_name, ${ATTRIBUTION}`)
        .in('event_type', APPOINTMENT_TYPES)
        .gte('occurred_at', new Date(fromMs).toISOString()).lte('occurred_at', new Date(toMs).toISOString())
        .order('occurred_at', { ascending: false }).range(a, b), 5),
    ]);
    const refused = refuse(allowed, probe);
    if (refused) return refused;
    const settings = settingsOf(probe);
    const failed = clients.error ?? events.error;
    if (failed) return bad(failed.message ?? 'Could not load appointments', 500);

    const known = new Map((clients.data ?? []).filter(c => !c.is_internal).map(c => [c.id as string, c]));
    const mine = events.rows.filter(e => e.client_id && known.has(e.client_id as string));
    const tracked = await trackedRows(service, mine.map(e => e.id as string));
    if (tracked.error) return isMissingTable(tracked.error) ? NextResponse.json({ ...NEEDS_SETUP, stripe }) : bad(tracked.error.message ?? 'Could not load billing', 500);
    const apptByEvent = new Map(tracked.rows.map(a => [a.event_id as string, a]));

    const chargeById = new Map<string, Row>();
    const chargeIds = [...new Set(tracked.rows.map(a => a.charge_id as string | null).filter((id): id is string => !!id))];
    const found = await Promise.all(chunks(chargeIds).map(part => service.from('billing_charges').select('id, status, total, credit_applied').in('id', part)));
    for (const { data } of found) for (const c of (data ?? []) as Row[]) chargeById.set(c.id as string, c);

    return NextResponse.json({
      ready: true, stripe,
      appointments: mine.map(e => {
        const client = known.get(e.client_id as string)!;
        const a = apptByEvent.get(e.id as string);
        return {
          event_id: e.id, client_id: client.id, client_name: client.name,
          price: num(settings.get(client.id as string)?.price_per_appointment),
          outcome: e.event_type, booked_at: e.occurred_at, scheduled_at: e.scheduled_at,
          lead_name: e.lead_name, lead_phone: e.lead_phone, calendar: e.calendar_name,
          source: sourceOf(e, client.service as string | null),
          billing: billingView(a, a?.charge_id ? chargeById.get(a.charge_id as string) : undefined),
        };
      }),
    });
  }

  /* ── one client ── */
  if (clientId) {
    const [allowed, probe, { data: client }] = await Promise.all([
      canBill(ctx), readSettings(),
      service.from('clients').select('id, name, status, service').eq('id', clientId).maybeSingle(),
    ]);
    const refused = refuse(allowed, probe);
    if (refused) return refused;
    const settings = settingsOf(probe);
    if (!client) return bad('Client not found', 404);

    // Their card in Stripe, the SMS cost and their profile don't depend on the
    // billing records, so they are fetched while those are brought up to date.
    const s = settings.get(clientId);
    const readCustomer = async () => {
      if (!stripe.configured || !s?.stripe_customer_id) return { customer: null, customerError: null as string | null };
      try {
        const customer = await getCustomer(s.stripe_customer_id as string);
        return { customer, customerError: customer ? null : 'This Stripe customer no longer exists — link another' };
      } catch (e) { return { customer: null, customerError: e instanceof Error ? e.message : "Couldn't reach Stripe" }; }
    };
    const readRecords = async () => {
      await syncWithStripe(service, clientId);
      await tryCover(service, clientId);
      return Promise.all([
      readAll((a, b) => {
        let q = service.from('events')
          .select(`id, event_type, occurred_at, scheduled_at, lead_name, lead_phone, calendar_name, ${ATTRIBUTION}`)
          .eq('client_id', clientId).in('event_type', APPOINTMENT_TYPES)
          .order('occurred_at', { ascending: false }).range(a, b);
        if (from) q = q.gte('occurred_at', from);
        if (to) q = q.lte('occurred_at', to);
        return q;
      }, 10),
      readAll((a, b) => service.from('billing_appointments').select(APPT_COLS).eq('client_id', clientId).range(a, b)),
      readAll((a, b) => service.from('billing_charges').select(CHARGE_COLS).eq('client_id', clientId).order('created_at', { ascending: false }).range(a, b), 2),
        readAll((a, b) => service.from('billing_credits').select('id, amount, reason, created_at').eq('client_id', clientId).order('created_at', { ascending: false }).range(a, b), 2),
        // Their appointments from before the period; the SMS ones are kept below.
        smsAll ? readAll((a, b) => service.from('events')
          .select(`id, event_type, occurred_at, scheduled_at, lead_name, lead_phone, calendar_name, ${ATTRIBUTION}`)
          .eq('client_id', clientId).in('event_type', APPOINTMENT_TYPES).lt('occurred_at', from!)
          .order('occurred_at', { ascending: false }).range(a, b), 10) : none,
      ]);
    };
    const [[periodEvents, appts, charges, credits, older], { customer, customerError }, smsRows, shared] = await Promise.all([
      readRecords(), readCustomer(), readSms(service, { clientId, start, end }), profileFor(ctx, client),
    ]);
    const costs = smsCost(smsRows);
    const failed = periodEvents.error ?? appts.error ?? charges.error ?? credits.error;
    if (failed) return isMissingTable(failed) ? NextResponse.json({ ...NEEDS_SETUP, stripe }) : bad(failed.message ?? 'Could not load billing', 500);
    // Older SMS appointments are an extra: if they can't be read the page still answers.
    const olderSms = older.error ? [] : older.rows.filter(e => sourceOf(e, client.service as string | null) === 'sms');
    const events = { rows: [...periodEvents.rows, ...olderSms] };

    const chargeById = new Map(charges.rows.map(c => [c.id as string, c]));
    const apptByEvent = new Map(appts.rows.map(a => [a.event_id as string, a]));

    const billingOf = (a: Row | undefined) => billingView(a, a?.charge_id ? chargeById.get(a.charge_id as string) : undefined);

    const price = num(s?.price_per_appointment);
    const balance = creditBalance(
      appts.rows as { credit_amount: number }[],
      credits.rows as { amount: number }[],
      charges.rows as { credit_applied: number; status: string }[],
    );

    // The credit ledger: every credit issued, and every time credit was used.
    const apptsByCharge = new Map<string, Row[]>();
    for (const a of appts.rows) {
      if (!a.charge_id) continue;
      const list = apptsByCharge.get(a.charge_id as string) ?? [];
      list.push(a);
      apptsByCharge.set(a.charge_id as string, list);
    }
    const ledger = [
      ...appts.rows.filter(a => a.credited_at).map(a => ({
        type: 'issued', source: 'appointment', id: a.event_id, at: a.credited_at,
        amount: num(a.credit_amount), lead_name: a.lead_name, appointment_at: a.appointment_at, reason: a.credit_reason,
      })),
      ...credits.rows.map(c => ({
        type: 'issued', source: 'manual', id: c.id, at: c.created_at,
        amount: num(c.amount), lead_name: null, appointment_at: null, reason: c.reason,
      })),
      ...charges.rows.filter(c => num(c.credit_applied) > 0 && LIVE_CHARGE_STATUSES.includes(c.status as string)).map(c => {
        const held = apptsByCharge.get(c.id as string) ?? [];
        return {
          type: 'used', source: paidByCredit(c) ? 'cover' : 'charge', id: c.id, at: c.created_at,
          amount: num(c.credit_applied), lead_name: held.length === 1 ? held[0].lead_name : null,
          appointment_at: held.length === 1 ? held[0].appointment_at : null,
          reason: paidByCredit(c) && held.length <= 1 ? null : c.description,
        };
      }),
    ].sort((a, b) => new Date(b.at as string).getTime() - new Date(a.at as string).getTime());

    // Each appointment's source, and what each source cost and returns.
    const sources = new Map<string, Source>(events.rows.map(e => [e.id as string, sourceOf(e, client.service as string | null)]));
    const returns = returnsBySource(periodEvents.rows.map(e => {
      const b = billingOf(apptByEvent.get(e.id as string));
      return { source: sources.get(e.id as string)!, state: (b ? b.state : 'to_bill') as BillingState, price: b?.price ?? 0, clientPrice: price };
    }), costs);

    return NextResponse.json({
      ready: true, stripe,
      client,
      profile: shared.profile, profile_available: shared.available, profile_key: shared.key,
      pnl: { paid: shared.paid, months: shared.months, last_month: shared.last_month },
      returns: { ...returns, sms_sent: costs.sms_sent },
      settings: { price, stripe_customer_id: (s?.stripe_customer_id as string | null) ?? null },
      customer, customer_error: customerError,
      balance,
      // What they are still owed, in appointments: bookings that won't be billed.
      credits_owed: creditInAppointments(balance, price),
      appointments: events.rows.map(e => ({
        event_id: e.id, outcome: e.event_type, booked_at: e.occurred_at, scheduled_at: e.scheduled_at,
        lead_name: e.lead_name, lead_phone: e.lead_phone, calendar: e.calendar_name,
        source: sources.get(e.id as string),
        billing: billingOf(apptByEvent.get(e.id as string)),
      })),
      ledger,
      // Charges that billed something. Bookings covered by credit are in the ledger.
      charges: charges.rows.filter(c => !paidByCredit(c)),
    });
  }

  /* ── every client ── */
  const readBilling = () => Promise.all([
    readAll((a, b) => service.from('billing_charges').select('id, client_id, total, credit_applied, status, created_at').range(a, b)),
    readAll((a, b) => service.from('billing_appointments').select(APPT_COLS).range(a, b)),
    readAll((a, b) => service.from('billing_credits').select('client_id, amount').range(a, b)),
  ]);
  const olderEvents = () => service.from('events').select(`id, client_id, ${ATTRIBUTION}`)
    .in('event_type', APPOINTMENT_TYPES).lt('occurred_at', from!).order('occurred_at', { ascending: false });
  const [allowed, probe, clients, periodEvents, billing, smsRows, olderFiled] = await Promise.all([
    canBill(ctx), readSettings(),
    service.from('clients').select('id, name, status, service, is_internal').order('name'),
    readAll((a, b) => {
      let q = service.from('events').select(`id, client_id, ${ATTRIBUTION}`).in('event_type', APPOINTMENT_TYPES).order('occurred_at', { ascending: false }).range(a, b);
      if (from) q = q.gte('occurred_at', from);
      if (to) q = q.lte('occurred_at', to);
      return q;
    }),
    readBilling(),
    readSms(service, { start, end }),
    // Older appointments filed as SMS, whichever client they belong to.
    smsAll ? readAll((a, b) => olderEvents().or('ad_platform.ilike.sms,utm_source.ilike.sms,utm_medium.ilike.sms').range(a, b)) : none,
  ]);
  const refused = refuse(allowed, probe);
  if (refused) return refused;
  const settings = settingsOf(probe);
  let [charges, appts, credits] = billing;
  const failed = clients.error ?? charges.error ?? appts.error ?? credits.error ?? periodEvents.error;
  if (failed) return isMissingTable(failed) ? NextResponse.json({ ...NEEDS_SETUP, stripe }) : bad(failed.message ?? 'Could not load billing', 500);

  // …and every older appointment of a client who is on SMS only, where a
  // booking with no recorded source still counts as SMS.
  const smsOnly = (clients.data ?? []).filter(c => !c.is_internal && c.service === 'sms').map(c => c.id as string);
  const olderOnSms = smsAll && smsOnly.length ? await readAll((a, b) => olderEvents().in('client_id', smsOnly).range(a, b)) : await none;
  // An extra: if the older ones can't be read, the page still answers — and says so.
  const olderFailed = !!(olderFiled.error ?? olderOnSms.error);
  const serviceByClient = new Map((clients.data ?? []).map(c => [c.id as string, c.service as string | null]));
  const inPeriodIds = new Set(periodEvents.rows.map(e => e.id as string));
  const olderSms = [...new Map([...(olderFiled.error ? [] : olderFiled.rows), ...(olderOnSms.error ? [] : olderOnSms.rows)].map(e => [e.id as string, e])).values()]
    .filter(e => !inPeriodIds.has(e.id as string) && !!e.client_id && sourceOf(e, serviceByClient.get(e.client_id as string)) === 'sms');
  const olderIds = new Set(olderSms.map(e => e.id as string));
  const events = { rows: [...periodEvents.rows, ...olderSms] };

  const by = <T extends Row>(rows: T[]) => {
    const map = new Map<string, T[]>();
    for (const r of rows) {
      const id = r.client_id as string | null;
      if (!id) continue;
      if (!map.has(id)) map.set(id, []);
      map.get(id)!.push(r);
    }
    return map;
  };
  let chargesBy = by(charges.rows), apptsBy = by(appts.rows), creditsBy = by(credits.rows);
  const eventsBy = by(events.rows);
  const balanceFor = (id: string) => creditBalance(
    (apptsBy.get(id) ?? []) as { credit_amount: number }[],
    (creditsBy.get(id) ?? []) as { amount: number }[],
    (chargesBy.get(id) ?? []) as { credit_applied: number; status: string }[],
  );

  // Clients holding at least one appointment's worth of credit: mark any new
  // bookings as covered before the figures are worked out.
  let covered = 0;
  for (const c of clients.data ?? []) {
    const price = num(settings.get(c.id)?.price_per_appointment);
    if (c.is_internal || price <= 0 || balanceFor(c.id) < price) continue;
    covered += await tryCover(service, c.id);
  }
  if (covered > 0) {
    [charges, appts, credits] = await readBilling();
    if (!charges.error && !appts.error && !credits.error) {
      chargesBy = by(charges.rows); apptsBy = by(appts.rows); creditsBy = by(credits.rows);
    }
  }
  const tracked = new Set(appts.rows.map(a => a.event_id as string));
  const chargeById = new Map(charges.rows.map(c => [c.id as string, c]));

  // Every appointment in the period with its source and where it stands, for
  // the return on each source across all clients.
  const apptByEvent = new Map(appts.rows.map(a => [a.event_id as string, a]));
  const stateOf = (a: Row | undefined): BillingState => {
    if (!a) return 'to_bill';
    if (a.cancelled_at) return 'cancelled';
    if (a.credited_at) return 'credited';
    const charge = a.charge_id ? chargeById.get(a.charge_id as string) : undefined;
    return charge && paidByCredit(charge) ? 'covered' : 'charged';
  };
  const internal = new Set((clients.data ?? []).filter(c => c.is_internal).map(c => c.id as string));
  const serviceOf = new Map((clients.data ?? []).map(c => [c.id as string, c.service as string | null]));
  const sourced = events.rows.filter(e => e.client_id && !internal.has(e.client_id as string)).map(e => {
    const a = apptByEvent.get(e.id as string);
    return {
      client_id: e.client_id as string,
      source: sourceOf(e, serviceOf.get(e.client_id as string)),
      state: stateOf(a), price: num(a?.price),
      clientPrice: num(settings.get(e.client_id as string)?.price_per_appointment),
      older: olderIds.has(e.id as string),
    };
  });
  const costs = smsCost(smsRows, internal);
  // Cost is the period's, so the return is worked out on the period's appointments only.
  const returns = returnsBySource(sourced.filter(a => !a.older), costs);
  const sourcedBy = new Map<string, typeof sourced>();
  for (const a of sourced) sourcedBy.set(a.client_id, [...(sourcedBy.get(a.client_id) ?? []), a]);

  const rows = (clients.data ?? []).filter(c => !c.is_internal).map(c => {
    const s = settings.get(c.id);
    const price = num(s?.price_per_appointment);
    const mine = chargesBy.get(c.id) ?? [];
    const myAppts = apptsBy.get(c.id) ?? [];
    const bySource = sourcedBy.get(c.id) ?? [];
    const uncharged = (eventsBy.get(c.id) ?? []).filter(e => !tracked.has(e.id as string)).length;
    const sum = (list: Row[]) => round2(list.reduce((t, r) => t + num(r.total), 0));
    return {
      id: c.id, name: c.name, status: c.status, service: c.service ?? null,
      price,
      stripe_linked: !!s?.stripe_customer_id,
      appointments: (eventsBy.get(c.id) ?? []).length,
      sms_appointments: bySource.filter(a => a.source === 'sms').length,
      ads_appointments: bySource.filter(a => a.source === 'ads').length,
      unknown_appointments: bySource.filter(a => a.source === 'unknown').length,
      uncharged,
      uncharged_value: round2(uncharged * price),
      charged: sum(mine.filter(r => ['pending', 'paid'].includes(r.status as string) && inPeriod(r.created_at))),
      paid: sum(mine.filter(r => r.status === 'paid' && inPeriod(r.created_at))),
      outstanding: sum(mine.filter(r => r.status === 'pending')),
      credited: myAppts.filter(a => a.credited_at && inPeriod(a.credited_at)).length,
      cancelled: myAppts.filter(a => a.cancelled_at && inPeriod(a.cancelled_at)).length,
      // Bookings not billed because their credit paid for them.
      covered: myAppts.filter(a => {
        const charge = a.charge_id ? chargeById.get(a.charge_id as string) : undefined;
        return !a.credited_at && !a.cancelled_at && !!charge && paidByCredit(charge) && inPeriod(a.created_at);
      }).length,
      balance: balanceFor(c.id),
      credits_owed: creditInAppointments(balanceFor(c.id), price),
    };
  });

  return NextResponse.json({
    ready: true, stripe, clients: rows, returns: { ...returns, sms_sent: costs.sms_sent }, covered,
    // SMS appointments from before the period that are included; null = they couldn't be read.
    older_sms: !smsAll ? 0 : olderFailed ? null : olderSms.filter(e => !internal.has(e.client_id as string)).length,
  });
}

/* ── POST ─────────────────────────────────────────────────────────────────── */

async function loadAppointments(service: Service, clientId: string, ids: string[]) {
  const found: Row[] = [];
  for (const part of chunks(ids)) {
    const { data, error } = await service.from('events')
      .select('id, client_id, event_type, lead_name, scheduled_at, occurred_at').in('id', part);
    if (error) return { error: error.message, events: [] as Row[] };
    found.push(...((data ?? []) as Row[]));
  }
  const ok = found.filter(e => e.client_id === clientId && APPOINTMENT_TYPES.includes(e.event_type as string));
  if (ok.length !== ids.length) return { error: 'Some of those appointments no longer exist for this client — refresh and try again', events: [] as Row[] };
  return { error: null, events: ok };
}

async function trackedRows(service: Service, ids: string[]) {
  const rows: Row[] = [];
  const parts = await Promise.all(chunks(ids).map(part => service.from('billing_appointments').select(APPT_COLS).in('event_id', part)));
  for (const { data, error } of parts) {
    if (error) return { error, rows };
    rows.push(...((data ?? []) as Row[]));
  }
  return { error: null, rows };
}

export async function POST(req: Request) {
  const ctx = await guard();
  if (isAuthError(ctx)) return ctx;
  const service = ctx.service;

  let body: Row;
  try { body = await req.json(); } catch { return bad('Bad request'); }
  const action = body.action;
  const now = () => new Date().toISOString();
  const dbError = (error: { code?: string; message?: string }) =>
    isMissingTable(error) ? NextResponse.json(NEEDS_SETUP, { status: 503 }) : bad(error.message ?? 'Database error', 500);

  /* ── settings: price per appointment, Stripe customer ── */
  if (action === 'settings') {
    const clientId = String(body.client_id ?? '');
    if (!clientId) return bad('client_id is required');
    const patch: Row = { client_id: clientId, updated_at: now() };
    if (body.price !== undefined) {
      const price = amount(body.price);
      if (price === null || price < 0) return bad('Price is not a number');
      patch.price_per_appointment = price;
    }
    if (body.stripe_customer_id !== undefined) {
      const id = typeof body.stripe_customer_id === 'string' ? body.stripe_customer_id.trim() : '';
      if (id && !/^cus_[A-Za-z0-9]+$/.test(id)) return bad("That doesn't look like a Stripe customer");
      patch.stripe_customer_id = id || null;
    }
    const { error } = await service.from('billing_clients').upsert(patch, { onConflict: 'client_id' });
    if (error) return dbError(error);
    if (body.price !== undefined) await tryCover(service, clientId);
    return NextResponse.json({ success: true });
  }

  /* ── profile: contact details, the same record Profit and Loss shows ── */
  if (action === 'profile') {
    const clientId = String(body.client_id ?? '');
    const { data: client } = await service.from('clients').select('id, name').eq('id', clientId).maybeSingle();
    if (!client) return bad('Client not found', 404);
    const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 2000) : null);
    const email = text(body.email);
    if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return bad("That email doesn't look right");

    const current = await profileFor(ctx, client);
    if (!current.available) return bad('Client details need the Profit and Loss tables first', 503);
    const row = {
      user_id: ctx.userId,
      name_key: (current.profile?.name_key as string | undefined) ?? nameKey(client.name),
      name: (current.profile?.name as string | undefined) ?? client.name,
      contact_name: text(body.contact_name), email, phone: text(body.phone),
      website: text(body.website), notes: text(body.notes),
      client_id: clientId, updated_at: now(),
    };
    const { data, error } = await service.from('pnl_clients')
      .upsert(row, { onConflict: 'user_id,name_key' }).select(PROFILE_COLS).single();
    if (error) return bad(error.message ?? 'Could not save', 500);
    return NextResponse.json({ profile: data });
  }

  /* ── charge: a set of appointments, or a one-off amount ── */
  if (action === 'charge') {
    const clientId = String(body.client_id ?? '');
    const eventIds = strings(body.event_ids);
    const method = body.method;
    if (!clientId) return bad('client_id is required');
    if (method !== 'card' && method !== 'invoice' && method !== 'manual') return bad('Choose how to charge');
    const requestId = typeof body.request_id === 'string' && body.request_id ? body.request_id : null;

    const { data: client } = await service.from('clients').select('id, name').eq('id', clientId).maybeSingle();
    if (!client) return bad('Client not found', 404);

    const price = amount(body.price ?? 0);
    const custom = amount(body.amount ?? 0);
    if (eventIds.length && (price === null || price <= 0)) return bad('Set a price per appointment first');
    if (!eventIds.length && (custom === null || custom <= 0)) return bad('Enter an amount');

    let events: Row[] = [];
    if (eventIds.length) {
      const loaded = await loadAppointments(service, clientId, eventIds);
      if (loaded.error) return bad(loaded.error, 409);
      events = loaded.events;
      const taken = await trackedRows(service, eventIds);
      if (taken.error) return dbError(taken.error);
      if (taken.rows.length) {
        return bad(`${taken.rows.length} of those ${taken.rows.length === 1 ? 'is' : 'are'} already billed, credited or cancelled — refresh and try again`, 409);
      }
    }

    const balance = await balanceOf(service, clientId);
    const wanted = body.apply_credit === undefined || body.apply_credit === null ? undefined : amount(body.apply_credit);
    if (wanted === null) return bad('Credit is not a number');
    const plan = planCharge({ count: eventIds.length, price: price ?? 0, customAmount: custom ?? 0, balance, applyCredit: wanted });
    // The confirm dialog shows a total; refuse if it no longer adds up to that.
    if (body.expected_total !== undefined && toCents(num(body.expected_total)) !== toCents(plan.total)) {
      return bad('The total changed since you opened this — refresh and try again', 409);
    }

    // Fully covered by credit: nothing to collect, so nothing goes to Stripe.
    const viaStripe = method !== 'manual' && plan.total > 0;
    let customer = null;
    if (viaStripe) {
      if (!stripeStatus().configured) return bad('Stripe is not connected yet', 503);
      if (plan.total < STRIPE_MINIMUM) return bad('Stripe needs at least $0.50');
      const { data: s } = await service.from('billing_clients').select('stripe_customer_id').eq('client_id', clientId).maybeSingle();
      if (!s?.stripe_customer_id) return bad('Link this client to their Stripe customer first');
      try { customer = await getCustomer(s.stripe_customer_id); }
      catch (e) { return bad(e instanceof Error ? e.message : "Couldn't reach Stripe", 502); }
      if (!customer) return bad('This Stripe customer no longer exists — link another');
      if (method === 'card' && !customer.payment) return bad('No card on file for this client — email an invoice instead');
      if (method === 'invoice' && !customer.email) return bad('This Stripe customer has no email — add one in Stripe first');
    }

    const typed = typeof body.description === 'string' ? body.description.trim().slice(0, 300) : '';
    const count = eventIds.length;
    const description = typed || (count ? `${count} appointment${count === 1 ? '' : 's'}` : 'Charge');

    const { data: charge, error: insertError } = await service.from('billing_charges').insert({
      client_id: clientId, client_name: client.name,
      kind: count ? 'appointments' : 'custom',
      description, appointment_count: count,
      subtotal: plan.subtotal, credit_applied: plan.credit, total: plan.total,
      method: viaStripe ? method : 'manual', status: 'draft',
      stripe_customer_id: customer?.id ?? null,
      request_id: requestId, created_by: ctx.userId,
    }).select(CHARGE_COLS).single();
    if (insertError || !charge) {
      if (insertError?.code === '23505') return bad('That charge was already submitted — refresh to see it', 409);
      return dbError(insertError ?? { message: 'Could not start the charge' });
    }
    const chargeId = charge.id as string;

    if (count) {
      const { error } = await service.from('billing_appointments').insert(events.map(e => ({
        client_id: clientId, event_id: e.id, lead_name: e.lead_name,
        appointment_at: e.scheduled_at ?? e.occurred_at, charge_id: chargeId, price,
      })));
      if (error) {
        await service.from('billing_appointments').delete().eq('charge_id', chargeId);
        await service.from('billing_charges').delete().eq('id', chargeId);
        if (error.code === '23505') return bad('Some of those were just charged or credited — refresh and try again', 409);
        return dbError(error);
      }
    }

    if (!viaStripe) {
      const done = await setCharge(service, chargeId, { status: 'paid', paid_at: now() });
      return NextResponse.json({ charge: done, message: plan.total > 0 ? 'Recorded' : 'Covered by credit' });
    }

    // ── Stripe ──
    const fail = async (message: string) => {
      const done = await setCharge(service, chargeId, { status: 'failed', error: message });
      await release(service, chargeId);
      return NextResponse.json({ error: message, charge: done }, { status: 402 });
    };
    const text = (e: unknown) => (e instanceof Error ? e.message : 'Stripe error');

    // The invoice says who the appointments were: on the line the client sees,
    // and as a note on the invoice in Stripe.
    const names = count ? namesNote(events.map(e => e.lead_name as string | null)) : '';
    const lines = [{ description: count ? `${count} appointment${count === 1 ? '' : 's'} × $${price} — ${names}` : description, cents: toCents(plan.subtotal) }];
    if (plan.credit > 0) lines.push({ description: 'Credit applied', cents: -toCents(plan.credit) });

    let invoiceId: string;
    try {
      const draft = await createDraftInvoice({
        ref: chargeId, customerId: customer!.id, lines, description,
        method: method as 'card' | 'invoice', paymentMethodId: customer!.payment?.id ?? null,
        note: names || undefined,
      });
      invoiceId = draft.id;
      await setCharge(service, chargeId, { stripe_invoice_id: invoiceId });
    } catch (e) {
      // A draft that exists but couldn't be recorded is never sent or charged.
      return fail(`Stripe couldn't create the invoice: ${text(e)}`);
    }

    let url: string | null = null;
    try {
      const open = await finalizeInvoice(invoiceId, chargeId);
      url = open.url;
    } catch (e) {
      if (e instanceof StripeError && !e.definite) {
        const done = await setCharge(service, chargeId, { status: 'pending', error: "Couldn't confirm with Stripe — reopen this client in a minute" });
        return NextResponse.json({ error: "Couldn't confirm with Stripe — reopen this client in a minute to see what happened", charge: done }, { status: 502 });
      }
      await deleteDraftInvoice(invoiceId);
      return fail(`Stripe couldn't finalize the invoice: ${text(e)}`);
    }

    if (method === 'invoice') {
      try {
        await sendInvoice(invoiceId, chargeId);
        const done = await setCharge(service, chargeId, { status: 'pending', stripe_invoice_url: url });
        return NextResponse.json({ charge: done, message: `Invoice emailed to ${customer!.email}` });
      } catch (e) {
        // The invoice exists and can be paid from its link; only the email failed.
        const done = await setCharge(service, chargeId, { status: 'pending', stripe_invoice_url: url, error: `Not emailed: ${text(e)}` });
        return NextResponse.json({ charge: done, message: "Invoice created, but Stripe couldn't email it — send the client the invoice link" });
      }
    }

    try {
      const paid = await payInvoice(invoiceId, chargeId);
      // A bank debit comes back still open: the money is on its way.
      const done = await setCharge(service, chargeId, paid.status === 'paid'
        ? { status: 'paid', paid_at: now(), stripe_invoice_url: paid.url ?? url }
        : { status: 'pending', stripe_invoice_url: paid.url ?? url });
      return NextResponse.json({ charge: done, message: paid.status === 'paid' ? `Charged ${customer!.payment!.label}` : 'Payment started — it will show as paid once it clears' });
    } catch (e) {
      if (e instanceof StripeError && !e.definite) {
        const done = await setCharge(service, chargeId, { status: 'pending', stripe_invoice_url: url, error: "Couldn't confirm the payment — reopen this client in a minute" });
        return NextResponse.json({ error: "Couldn't confirm the payment with Stripe — reopen this client in a minute to see whether it went through", charge: done }, { status: 502 });
      }
      // Declined. Cancel the invoice so it can't be paid later behind our back.
      try { await voidInvoice(invoiceId); }
      catch {
        const done = await setCharge(service, chargeId, { status: 'pending', stripe_invoice_url: url, error: `Card failed (${text(e)}) and the invoice is still open in Stripe` });
        return NextResponse.json({ error: `The card failed: ${text(e)}. The invoice is still open in Stripe — cancel it from Charges.`, charge: done }, { status: 402 });
      }
      return fail(`The card failed: ${text(e)}`);
    }
  }

  /* ── void: cancel an unpaid invoice, or undo a charge recorded by hand ── */
  if (action === 'void') {
    const id = String(body.id ?? '');
    const { data: charge, error } = await service.from('billing_charges')
      .select('id, client_id, status, method, credit_applied, stripe_invoice_id, request_id').eq('id', id).maybeSingle();
    if (error) return dbError(error);
    if (!charge) return bad('Charge not found', 404);
    if (charge.status === 'void' || charge.status === 'failed') return NextResponse.json({ success: true });
    if (charge.status === 'paid' && charge.method !== 'manual') {
      return bad('This was paid through Stripe. Refund it in Stripe, or credit the appointments instead.');
    }

    // Credit earned from this charge's appointments must not already be spent.
    if (charge.client_id) {
      const { data: credited } = await service.from('billing_appointments').select('credit_amount').eq('charge_id', id).gt('credit_amount', 0);
      const giveBack = (credited ?? []).reduce((s, r) => s + num(r.credit_amount), 0);
      if (giveBack > 0) {
        const after = (await balanceOf(service, charge.client_id)) + num(charge.credit_applied) - giveBack;
        if (after < -0.005) return bad("Credit from this charge's appointments has already been used on another charge");
      }
    }

    if (charge.stripe_invoice_id) {
      if (!stripeStatus().configured) return bad('Stripe is not connected', 503);
      try {
        const inv = await getInvoice(charge.stripe_invoice_id);
        if (inv.status === 'paid') {
          await setCharge(service, id, { status: 'paid', paid_at: now() });
          return bad('This invoice has just been paid — it can no longer be cancelled', 409);
        }
        if (inv.status === 'draft') await deleteDraftInvoice(inv.id);
        else if (inv.status === 'open' || inv.status === 'uncollectible') await voidInvoice(inv.id);
      } catch (e) {
        return bad(`Stripe couldn't cancel it: ${e instanceof Error ? e.message : 'error'}`, 502);
      }
    }
    await setCharge(service, id, { status: 'void' });
    await release(service, id);
    // A payment matched from Stripe carries a note of its appointments there;
    // the match is gone, so the note goes too. The money is not touched.
    const matched = typeof charge.request_id === 'string' && charge.request_id.startsWith('stripe:') ? charge.request_id.slice(7) : null;
    if (matched && stripeStatus().configured) await notePayment(matched, { appointments: '', billing_client: '' });
    if (charge.client_id) await tryCover(service, charge.client_id);
    return NextResponse.json({ success: true });
  }

  /* ── credit / uncredit appointments ── */
  if (action === 'credit') {
    const clientId = String(body.client_id ?? '');
    const eventIds = strings(body.event_ids);
    if (!clientId || !eventIds.length) return bad('Pick at least one appointment');
    const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 300) : '';

    const loaded = await loadAppointments(service, clientId, eventIds);
    if (loaded.error) return bad(loaded.error, 409);
    const existing = await trackedRows(service, eventIds);
    if (existing.error) return dbError(existing.error);
    const rowByEvent = new Map(existing.rows.map(r => [r.event_id as string, r]));
    const { data: s } = await service.from('billing_clients').select('price_per_appointment').eq('client_id', clientId).maybeSingle();

    const stamp = now();
    let credited = 0, back = 0;
    const fresh: Row[] = [];
    for (const e of loaded.events) {
      const row = rowByEvent.get(e.id as string);
      if (!row) {
        // Never charged: it simply won't be. Nothing to give back.
        fresh.push({
          client_id: clientId, event_id: e.id, lead_name: e.lead_name,
          appointment_at: e.scheduled_at ?? e.occurred_at, charge_id: null,
          price: num(s?.price_per_appointment), credited_at: stamp, credit_amount: 0, credit_reason: reason || null,
        });
        credited++;
      } else if (!row.credited_at) {
        // Billed: its price goes onto the client's credit balance. One that
        // was only marked cancelled becomes a credit worth nothing.
        const worth = row.charge_id ? num(row.price) : 0;
        const patch: Row = { credited_at: stamp, credit_amount: worth, credit_reason: reason || null, updated_at: stamp };
        if (row.cancelled_at) patch.cancelled_at = null;
        const { error } = await service.from('billing_appointments').update(patch).eq('id', row.id).is('credited_at', null);
        if (error) return dbError(error);
        credited++; back += worth;
      }
    }
    if (fresh.length) {
      const { error } = await service.from('billing_appointments').insert(fresh);
      if (error) return error.code === '23505' ? bad('Some of those were just charged — refresh and try again', 409) : dbError(error);
    }
    // Credit just issued goes straight onto their next booking, if there is one.
    const covered = back > 0 ? await tryCover(service, clientId) : 0;
    return NextResponse.json({ credited, credit_added: round2(back), covered });
  }

  if (action === 'uncredit') {
    const clientId = String(body.client_id ?? '');
    const eventIds = strings(body.event_ids);
    if (!clientId || !eventIds.length) return bad('Pick at least one appointment');
    const existing = await trackedRows(service, eventIds);
    if (existing.error) return dbError(existing.error);
    const rows = existing.rows.filter(r => r.client_id === clientId && r.credited_at);
    const takeBack = rows.reduce((s, r) => s + num(r.credit_amount), 0);
    // Bookings this credit covered go back to "to bill" with it.
    if (takeBack > 0 && !(await freeCredit(service, clientId, takeBack))) {
      return bad('That credit has already been used on a charge');
    }
    for (const r of rows) {
      const q = r.charge_id
        ? service.from('billing_appointments').update({ credited_at: null, credit_amount: 0, credit_reason: null, updated_at: now() }).eq('id', r.id)
        : service.from('billing_appointments').delete().eq('id', r.id);
      const { error } = await q;
      if (error) return dbError(error);
    }
    await tryCover(service, clientId);
    return NextResponse.json({ uncredited: rows.length });
  }

  /* ── cancelled: the appointment never happened — not billed, nothing owed ── */
  if (action === 'cancel') {
    const clientId = String(body.client_id ?? '');
    const eventIds = strings(body.event_ids);
    if (!clientId || !eventIds.length) return bad('Pick at least one appointment');
    const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 300) : '';

    const loaded = await loadAppointments(service, clientId, eventIds);
    if (loaded.error) return bad(loaded.error, 409);
    const existing = await trackedRows(service, eventIds);
    if (existing.error) return dbError(existing.error);
    // Only an appointment nobody has decided on can be cancelled: a billed one
    // has to be credited instead, so the client gets it back.
    const taken = new Set(existing.rows.map(r => r.event_id as string));
    const { data: s } = await service.from('billing_clients').select('price_per_appointment').eq('client_id', clientId).maybeSingle();
    const stamp = now();
    const fresh = loaded.events.filter(e => !taken.has(e.id as string)).map(e => ({
      client_id: clientId, event_id: e.id, lead_name: e.lead_name,
      appointment_at: e.scheduled_at ?? e.occurred_at, charge_id: null,
      price: num(s?.price_per_appointment), cancelled_at: stamp, credit_reason: reason || null,
    }));
    if (fresh.length) {
      const { error } = await service.from('billing_appointments').insert(fresh);
      if (error) {
        if (isMissingColumn(error, 'cancelled_at')) return bad('Marking appointments cancelled needs a one-off database update first', 503);
        return error.code === '23505' ? bad('Some of those were just billed or credited — refresh and try again', 409) : dbError(error);
      }
    }
    return NextResponse.json({ cancelled: fresh.length, skipped: eventIds.length - fresh.length });
  }

  if (action === 'uncancel') {
    const clientId = String(body.client_id ?? '');
    const eventIds = strings(body.event_ids);
    if (!clientId || !eventIds.length) return bad('Pick at least one appointment');
    const existing = await trackedRows(service, eventIds);
    if (existing.error) return dbError(existing.error);
    const rows = existing.rows.filter(r => r.client_id === clientId && r.cancelled_at && !r.charge_id);
    for (const r of rows) {
      const { error } = await service.from('billing_appointments').delete().eq('id', r.id);
      if (error) return dbError(error);
    }
    // Back to "not tracked" — and if they hold credit, it may cover it.
    await tryCover(service, clientId);
    return NextResponse.json({ uncancelled: rows.length });
  }

  /* ── credit not tied to an appointment ── */
  if (action === 'add_credit') {
    const clientId = String(body.client_id ?? '');
    const value = amount(body.amount);
    if (!clientId) return bad('client_id is required');
    if (value === null || value <= 0) return bad('Enter an amount');
    const { data: client } = await service.from('clients').select('id').eq('id', clientId).maybeSingle();
    if (!client) return bad('Client not found', 404);
    const { error } = await service.from('billing_credits').insert({
      client_id: clientId, amount: value,
      reason: typeof body.reason === 'string' ? body.reason.trim().slice(0, 300) : '',
      created_by: ctx.userId,
    });
    if (error) return dbError(error);
    const covered = await tryCover(service, clientId);
    return NextResponse.json({ success: true, covered });
  }

  if (action === 'delete_credit') {
    const id = String(body.id ?? '');
    const { data: credit, error } = await service.from('billing_credits').select('id, client_id, amount').eq('id', id).maybeSingle();
    if (error) return dbError(error);
    if (!credit) return NextResponse.json({ success: true });
    if (credit.client_id && !(await freeCredit(service, credit.client_id, num(credit.amount)))) {
      return bad('That credit has already been used on a charge');
    }
    const { error: delError } = await service.from('billing_credits').delete().eq('id', id);
    if (delError) return dbError(delError);
    if (credit.client_id) await tryCover(service, credit.client_id);
    return NextResponse.json({ success: true });
  }

  return bad('Unknown action');
}

// Charging a card waits on Stripe; give it room.
export const maxDuration = 60;
