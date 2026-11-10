import { NextResponse } from 'next/server';
import { getAuthContext, isAuthError, type AuthContext } from '@/lib/api-auth';
import {
  APPOINTMENT_TYPES, STRIPE_MINIMUM,
  canBill, creditBalance, isMissingTable, planCharge, round2, toCents,
} from '@/lib/billing';
import {
  StripeError, stripeStatus, getCustomer, createDraftInvoice, finalizeInvoice,
  payInvoice, sendInvoice, getInvoice, voidInvoice, deleteDraftInvoice,
} from '@/lib/stripe';

// Client Billing — which appointments each client has been charged for, which
// were credited, the charges themselves and the credit each client holds.
//
//   GET                      every client, with their figures for the period
//   GET ?client_id=          one client: appointments, charges, credits
//   POST { action: ... }     settings | charge | void | credit | uncredit |
//                            add_credit | delete_credit
//
// Charges go through Stripe (saved card, or an emailed invoice) or are recorded
// by hand. Nothing here ever charges without an explicit `charge` action.

type Service = AuthContext['service'];
type Row = Record<string, unknown>;

const PAGE = 1000;
const NEEDS_SETUP = { ready: false, error: 'Client Billing needs a one-off database update first' };
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const CHARGE_COLS = 'id, client_id, client_name, kind, description, appointment_count, subtotal, credit_applied, total, method, status, stripe_invoice_id, stripe_invoice_url, error, created_at, paid_at';
const APPT_COLS = 'id, client_id, event_id, lead_name, appointment_at, charge_id, price, credited_at, credit_amount, credit_reason';

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

/* ── GET ──────────────────────────────────────────────────────────────────── */

export async function GET(req: Request) {
  const ctx = await guard();
  if (isAuthError(ctx)) return ctx;
  const service = ctx.service;

  const params = new URL(req.url).searchParams;
  const clientId = params.get('client_id');
  const start = DAY.test(params.get('start') ?? '') ? params.get('start')! : null;
  const end = DAY.test(params.get('end') ?? '') ? params.get('end')! : null;
  const from = start ? `${start}T00:00:00.000Z` : null;
  const to = end ? `${end}T23:59:59.999Z` : null;
  const inPeriod = (iso: unknown) => typeof iso === 'string' && (!from || iso >= from) && (!to || iso <= to);
  const stripe = stripeStatus();

  const probe = await service.from('billing_clients').select('client_id, price_per_appointment, stripe_customer_id');
  if (probe.error) return isMissingTable(probe.error) ? NextResponse.json({ ...NEEDS_SETUP, stripe }) : bad(probe.error.message, 500);
  const settings = new Map((probe.data ?? []).map(s => [s.client_id as string, s]));

  /* ── one client ── */
  if (clientId) {
    const { data: client } = await service.from('clients').select('id, name, status').eq('id', clientId).maybeSingle();
    if (!client) return bad('Client not found', 404);

    await syncWithStripe(service, clientId);

    const [events, appts, charges, credits] = await Promise.all([
      readAll((a, b) => {
        let q = service.from('events')
          .select('id, event_type, occurred_at, scheduled_at, lead_name, lead_phone, calendar_name')
          .eq('client_id', clientId).in('event_type', APPOINTMENT_TYPES)
          .order('occurred_at', { ascending: false }).range(a, b);
        if (from) q = q.gte('occurred_at', from);
        if (to) q = q.lte('occurred_at', to);
        return q;
      }, 10),
      readAll((a, b) => service.from('billing_appointments').select(APPT_COLS).eq('client_id', clientId).range(a, b)),
      readAll((a, b) => service.from('billing_charges').select(CHARGE_COLS).eq('client_id', clientId).order('created_at', { ascending: false }).range(a, b), 2),
      readAll((a, b) => service.from('billing_credits').select('id, amount, reason, created_at').eq('client_id', clientId).order('created_at', { ascending: false }).range(a, b), 2),
    ]);
    const failed = events.error ?? appts.error ?? charges.error ?? credits.error;
    if (failed) return isMissingTable(failed) ? NextResponse.json({ ...NEEDS_SETUP, stripe }) : bad(failed.message ?? 'Could not load billing', 500);

    const chargeById = new Map(charges.rows.map(c => [c.id as string, c]));
    const apptByEvent = new Map(appts.rows.map(a => [a.event_id as string, a]));

    const billingOf = (a: Row | undefined) => {
      if (!a) return null;
      const charge = a.charge_id ? chargeById.get(a.charge_id as string) : undefined;
      return {
        state: a.credited_at ? 'credited' : 'charged',
        price: num(a.price),
        charged: !!a.charge_id,
        charge_id: (a.charge_id as string | null) ?? null,
        charge_status: (charge?.status as string | undefined) ?? null,
        credit_amount: num(a.credit_amount),
        credited_at: (a.credited_at as string | null) ?? null,
        credit_reason: (a.credit_reason as string | null) ?? null,
      };
    };

    const s = settings.get(clientId);
    let customer = null, customerError: string | null = null;
    if (stripe.configured && s?.stripe_customer_id) {
      try {
        customer = await getCustomer(s.stripe_customer_id as string);
        if (!customer) customerError = 'This Stripe customer no longer exists — link another';
      } catch (e) { customerError = e instanceof Error ? e.message : "Couldn't reach Stripe"; }
    }

    return NextResponse.json({
      ready: true, stripe,
      client,
      settings: { price: num(s?.price_per_appointment), stripe_customer_id: (s?.stripe_customer_id as string | null) ?? null },
      customer, customer_error: customerError,
      balance: creditBalance(
        appts.rows as { credit_amount: number }[],
        credits.rows as { amount: number }[],
        charges.rows as { credit_applied: number; status: string }[],
      ),
      appointments: events.rows.map(e => ({
        event_id: e.id, outcome: e.event_type, booked_at: e.occurred_at, scheduled_at: e.scheduled_at,
        lead_name: e.lead_name, lead_phone: e.lead_phone, calendar: e.calendar_name,
        billing: billingOf(apptByEvent.get(e.id as string)),
      })),
      // Every credited appointment, whatever the period on screen.
      credited: appts.rows.filter(a => a.credited_at)
        .sort((a, b) => String(b.credited_at).localeCompare(String(a.credited_at)))
        .map(a => ({
          event_id: a.event_id, lead_name: a.lead_name, appointment_at: a.appointment_at,
          credit_amount: num(a.credit_amount), credited_at: a.credited_at, credit_reason: a.credit_reason,
        })),
      charges: charges.rows,
      credits: credits.rows,
    });
  }

  /* ── every client ── */
  const [clients, charges, appts, credits, events] = await Promise.all([
    service.from('clients').select('id, name, status, is_internal').order('name'),
    readAll((a, b) => service.from('billing_charges').select('client_id, total, credit_applied, status, created_at').range(a, b)),
    readAll((a, b) => service.from('billing_appointments').select('client_id, event_id, charge_id, credited_at, credit_amount').range(a, b)),
    readAll((a, b) => service.from('billing_credits').select('client_id, amount').range(a, b)),
    readAll((a, b) => {
      let q = service.from('events').select('id, client_id').in('event_type', APPOINTMENT_TYPES).order('occurred_at', { ascending: false }).range(a, b);
      if (from) q = q.gte('occurred_at', from);
      if (to) q = q.lte('occurred_at', to);
      return q;
    }),
  ]);
  const failed = clients.error ?? charges.error ?? appts.error ?? credits.error ?? events.error;
  if (failed) return isMissingTable(failed) ? NextResponse.json({ ...NEEDS_SETUP, stripe }) : bad(failed.message ?? 'Could not load billing', 500);

  const tracked = new Set(appts.rows.map(a => a.event_id as string));
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
  const chargesBy = by(charges.rows), apptsBy = by(appts.rows), creditsBy = by(credits.rows), eventsBy = by(events.rows);

  const rows = (clients.data ?? []).filter(c => !c.is_internal).map(c => {
    const s = settings.get(c.id);
    const price = num(s?.price_per_appointment);
    const mine = chargesBy.get(c.id) ?? [];
    const myAppts = apptsBy.get(c.id) ?? [];
    const uncharged = (eventsBy.get(c.id) ?? []).filter(e => !tracked.has(e.id as string)).length;
    const sum = (list: Row[]) => round2(list.reduce((t, r) => t + num(r.total), 0));
    return {
      id: c.id, name: c.name, status: c.status,
      price,
      stripe_linked: !!s?.stripe_customer_id,
      appointments: (eventsBy.get(c.id) ?? []).length,
      uncharged,
      uncharged_value: round2(uncharged * price),
      charged: sum(mine.filter(r => ['pending', 'paid'].includes(r.status as string) && inPeriod(r.created_at))),
      paid: sum(mine.filter(r => r.status === 'paid' && inPeriod(r.created_at))),
      outstanding: sum(mine.filter(r => r.status === 'pending')),
      credited: myAppts.filter(a => a.credited_at && inPeriod(a.credited_at)).length,
      balance: creditBalance(
        myAppts as { credit_amount: number }[],
        (creditsBy.get(c.id) ?? []) as { amount: number }[],
        mine as { credit_applied: number; status: string }[],
      ),
    };
  });

  return NextResponse.json({ ready: true, stripe, clients: rows });
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
  for (const part of chunks(ids)) {
    const { data, error } = await service.from('billing_appointments').select(APPT_COLS).in('event_id', part);
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
    return NextResponse.json({ success: true });
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
        return bad(`${taken.rows.length} of those ${taken.rows.length === 1 ? 'is' : 'are'} already charged or credited — refresh and try again`, 409);
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

    const lines = [{ description: count ? `${count} appointment${count === 1 ? '' : 's'} × $${price}` : description, cents: toCents(plan.subtotal) }];
    if (plan.credit > 0) lines.push({ description: 'Credit applied', cents: -toCents(plan.credit) });

    let invoiceId: string;
    try {
      const draft = await createDraftInvoice({
        ref: chargeId, customerId: customer!.id, lines, description,
        method: method as 'card' | 'invoice', paymentMethodId: customer!.payment?.id ?? null,
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
      .select('id, client_id, status, method, credit_applied, stripe_invoice_id').eq('id', id).maybeSingle();
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
        // Charged: its price goes onto the client's credit balance.
        const { error } = await service.from('billing_appointments')
          .update({ credited_at: stamp, credit_amount: num(row.price), credit_reason: reason || null, updated_at: stamp })
          .eq('id', row.id).is('credited_at', null);
        if (error) return dbError(error);
        credited++; back += num(row.price);
      }
    }
    if (fresh.length) {
      const { error } = await service.from('billing_appointments').insert(fresh);
      if (error) return error.code === '23505' ? bad('Some of those were just charged — refresh and try again', 409) : dbError(error);
    }
    return NextResponse.json({ credited, credit_added: round2(back) });
  }

  if (action === 'uncredit') {
    const clientId = String(body.client_id ?? '');
    const eventIds = strings(body.event_ids);
    if (!clientId || !eventIds.length) return bad('Pick at least one appointment');
    const existing = await trackedRows(service, eventIds);
    if (existing.error) return dbError(existing.error);
    const rows = existing.rows.filter(r => r.client_id === clientId && r.credited_at);
    const takeBack = rows.reduce((s, r) => s + num(r.credit_amount), 0);
    if (takeBack > 0 && (await balanceOf(service, clientId)) - takeBack < -0.005) {
      return bad('That credit has already been used on a charge');
    }
    for (const r of rows) {
      const q = r.charge_id
        ? service.from('billing_appointments').update({ credited_at: null, credit_amount: 0, credit_reason: null, updated_at: now() }).eq('id', r.id)
        : service.from('billing_appointments').delete().eq('id', r.id);
      const { error } = await q;
      if (error) return dbError(error);
    }
    return NextResponse.json({ uncredited: rows.length });
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
    return NextResponse.json({ success: true });
  }

  if (action === 'delete_credit') {
    const id = String(body.id ?? '');
    const { data: credit, error } = await service.from('billing_credits').select('id, client_id, amount').eq('id', id).maybeSingle();
    if (error) return dbError(error);
    if (!credit) return NextResponse.json({ success: true });
    if (credit.client_id && (await balanceOf(service, credit.client_id)) - num(credit.amount) < -0.005) {
      return bad('That credit has already been used on a charge');
    }
    const { error: delError } = await service.from('billing_credits').delete().eq('id', id);
    if (delError) return dbError(delError);
    return NextResponse.json({ success: true });
  }

  return bad('Unknown action');
}

// Charging a card waits on Stripe; give it room.
export const maxDuration = 60;
