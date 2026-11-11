import { NextResponse } from 'next/server';
import { getAuthContext, isAuthError, type AuthContext } from '@/lib/api-auth';
import { APPOINTMENT_TYPES, LIVE_CHARGE_STATUSES, canBill, isMissingTable, round2, sourceOf } from '@/lib/billing';
import { stripeStatus, listPayments, getPayment, type StripePayment } from '@/lib/stripe';
import { MATCH, matchKey, split, suggest, type Candidate, type MatchClient } from '@/lib/stripe-match';

// Client Billing — Match with Stripe.
//
// Money that reached Stripe outside this dashboard is read back and tied to
// the client's appointments, so those stop reading "Not tracked".
//
//   GET ?start=&end=      payments in Stripe not matched yet, each with the
//                         suggested client and appointments, plus every
//                         untracked appointment to choose from
//   POST { payment_id, client_id, event_ids }   save one match
//   POST { payment_id, client_id, other: true } the payment was not for appointments
//
// Stripe is only ever read here. A match is a charge marked paid on the date
// Stripe took the money, holding those appointments — removed again from the
// client's Charges tab, which puts the payment back in this list.

type Row = Record<string, unknown>;

const PAGE = 1000;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const LOOK_BACK_DAYS = 60;   // a payment can be for last month's appointments
const ATTRIBUTION = 'ad_platform, utm_source, utm_medium, utm_campaign, campaign_id, adset_id, ad_id';

const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });
const num = (v: unknown) => Number(v ?? 0) || 0;

async function guard(): Promise<AuthContext | NextResponse> {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;
  if (!(await canBill(ctx))) return bad('Client Billing is not enabled for this account', 403);
  return ctx;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function readAll(build: (from: number, to: number) => any, maxPages = 20): Promise<{ rows: Row[]; error: { code?: string; message?: string } | null }> {
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

// Roster clients with their price and Stripe link, and the email on their
// Profit and Loss profile where there is one.
async function loadClients(ctx: AuthContext): Promise<{ clients: (MatchClient & { service: string | null })[]; error: { code?: string; message?: string } | null }> {
  const [clients, settings, profiles] = await Promise.all([
    ctx.service.from('clients').select('id, name, service, is_internal').order('name'),
    ctx.service.from('billing_clients').select('client_id, price_per_appointment, stripe_customer_id'),
    ctx.service.from('pnl_clients').select('client_id, email').eq('user_id', ctx.userId),
  ]);
  const error = clients.error ?? settings.error;
  if (error) return { clients: [], error };
  const byId = new Map((settings.data ?? []).map(s => [s.client_id as string, s]));
  const emails = new Map((profiles.error ? [] : profiles.data ?? []).filter(p => p.client_id && p.email).map(p => [p.client_id as string, p.email as string]));
  return {
    error: null,
    clients: (clients.data ?? []).filter(c => !c.is_internal).map(c => ({
      id: c.id as string, name: c.name as string, service: (c.service as string | null) ?? null,
      price: num(byId.get(c.id)?.price_per_appointment),
      stripe_customer_id: (byId.get(c.id)?.stripe_customer_id as string | null) ?? null,
      email: emails.get(c.id as string) ?? null,
    })),
  };
}

/* ── GET ──────────────────────────────────────────────────────────────────── */

export async function GET(req: Request) {
  const ctx = await guard();
  if (isAuthError(ctx)) return ctx;
  const service = ctx.service;
  const stripe = stripeStatus();
  if (!stripe.configured) return NextResponse.json({ ready: true, connected: false });

  const params = new URL(req.url).searchParams;
  const start = DAY.test(params.get('start') ?? '') ? params.get('start')! : null;
  const end = DAY.test(params.get('end') ?? '') ? params.get('end')! : null;
  const fromMs = start ? new Date(`${start}T00:00:00.000Z`).getTime() : null;
  const toMs = end ? new Date(`${end}T23:59:59.999Z`).getTime() : null;

  const loaded = await loadClients(ctx);
  if (loaded.error) return isMissingTable(loaded.error) ? NextResponse.json({ ready: false, connected: true }) : bad(loaded.error.message ?? 'Could not load clients', 500);
  const clients = loaded.clients;

  let listed;
  try {
    listed = await listPayments({ from: fromMs === null ? null : Math.floor(fromMs / 1000), to: toMs === null ? null : Math.floor(toMs / 1000) });
  } catch (e) {
    return bad(`Couldn't read Stripe: ${e instanceof Error ? e.message : 'error'}`, 502);
  }

  const [charges, tracked, events] = await Promise.all([
    readAll((a, b) => service.from('billing_charges').select('request_id, status, stripe_invoice_id, total').range(a, b)),
    readAll((a, b) => service.from('billing_appointments').select('event_id').range(a, b)),
    readAll((a, b) => {
      let q = service.from('events')
        .select(`id, client_id, event_type, occurred_at, scheduled_at, lead_name, ${ATTRIBUTION}`)
        .in('event_type', APPOINTMENT_TYPES).order('occurred_at', { ascending: false }).range(a, b);
      if (fromMs !== null) q = q.gte('occurred_at', new Date(fromMs - LOOK_BACK_DAYS * 86_400_000).toISOString());
      if (toMs !== null) q = q.lte('occurred_at', new Date(toMs).toISOString());
      return q;
    }, 10),
  ]);
  const failed = charges.error ?? tracked.error ?? events.error;
  if (failed) return isMissingTable(failed) ? NextResponse.json({ ready: false, connected: true }) : bad(failed.message ?? 'Could not load billing', 500);

  // Payments made from this dashboard are already tracked; so are ones matched before.
  const ourInvoices = new Set(charges.rows.map(c => c.stripe_invoice_id as string | null).filter(Boolean));
  const done = new Set(charges.rows
    .filter(c => typeof c.request_id === 'string' && (c.request_id as string).startsWith(MATCH) && LIVE_CHARGE_STATUSES.includes(c.status as string))
    .map(c => c.request_id as string));

  const usd = listed.payments.filter(p => p.currency === 'usd');
  const outside = usd.filter(p => !p.ours && !(p.invoice_id && ourInvoices.has(p.invoice_id)));
  const open = outside.filter(p => !done.has(matchKey(p.id)));
  const matched = outside.filter(p => done.has(matchKey(p.id)));

  const taken = new Set(tracked.rows.map(t => t.event_id as string));
  const known = new Map(clients.map(c => [c.id, c]));
  const untracked = events.rows.filter(e => e.client_id && known.has(e.client_id as string) && !taken.has(e.id as string));
  const candidates: Candidate[] = untracked.map(e => ({
    event_id: e.id as string, client_id: e.client_id as string, at: e.occurred_at as string,
    lead_name: (e.lead_name as string | null) ?? null,
    source: sourceOf(e, known.get(e.client_id as string)!.service),
  }));
  const suggestions = suggest(open, clients, candidates);
  const sourceById = new Map(candidates.map(c => [c.event_id, c.source]));

  const appointments: Record<string, unknown[]> = {};
  for (const e of untracked) {
    (appointments[e.client_id as string] ??= []).push({
      event_id: e.id, booked_at: e.occurred_at, scheduled_at: e.scheduled_at,
      lead_name: e.lead_name, outcome: e.event_type, source: sourceById.get(e.id as string),
    });
  }

  return NextResponse.json({
    ready: true, connected: true, test: stripe.test,
    limited: listed.limited, more: listed.more,
    payments: open.map(p => {
      const s = suggestions.get(p.id)!;
      return {
        id: p.id, date: p.created, amount: p.amount,
        customer_id: p.customer_id, customer_name: p.customer_name, customer_email: p.customer_email,
        description: p.description, url: p.url,
        client_id: s.client_id, how: s.how, count: s.count, suggested: s.event_ids,
      };
    }),
    clients: clients.map(c => ({ id: c.id, name: c.name, price: c.price, linked: !!c.stripe_customer_id })),
    appointments,
    matched: { count: matched.length, total: round2(matched.reduce((t, p) => t + p.amount, 0)) },
    other_currency: listed.payments.length - usd.length,
  });
}

/* ── POST ─────────────────────────────────────────────────────────────────── */

const describe = (p: StripePayment, n: number) => {
  const what = n ? `${n} appointment${n === 1 ? '' : 's'}` : (p.description || 'Payment');
  return `Paid in Stripe — ${what}`.slice(0, 300);
};

export async function POST(req: Request) {
  const ctx = await guard();
  if (isAuthError(ctx)) return ctx;
  const service = ctx.service;
  if (!stripeStatus().configured) return bad('Stripe is not connected yet', 503);

  let body: Row;
  try { body = await req.json(); } catch { return bad('Bad request'); }
  const paymentId = typeof body.payment_id === 'string' ? body.payment_id.trim() : '';
  const clientId = typeof body.client_id === 'string' ? body.client_id : '';
  const eventIds = Array.isArray(body.event_ids)
    ? [...new Set(body.event_ids.filter((x): x is string => typeof x === 'string' && x.length > 0))] : [];
  const other = body.other === true;
  if (!/^[a-z]{2}_[A-Za-z0-9]+$/.test(paymentId)) return bad('That is not a Stripe payment');
  if (!clientId) return bad('Choose the client this payment came from');
  if (!eventIds.length && !other) return bad('Tick the appointments this payment was for');
  if (eventIds.length && other) return bad('Either tick appointments or mark it as not for appointments');

  const dbError = (error: { code?: string; message?: string }) =>
    isMissingTable(error) ? bad('Client Billing needs a one-off database update first', 503) : bad(error.message ?? 'Database error', 500);

  const { data: client } = await service.from('clients').select('id, name, is_internal').eq('id', clientId).maybeSingle();
  if (!client || client.is_internal) return bad('Client not found', 404);

  // The amount comes from Stripe, never from the browser.
  let payment: StripePayment | null;
  try { payment = await getPayment(paymentId); }
  catch (e) { return bad(`Couldn't read Stripe: ${e instanceof Error ? e.message : 'error'}`, 502); }
  if (!payment) return bad('Stripe has no successful payment with that id — it may have been refunded', 409);
  if (payment.currency !== 'usd') return bad('Only payments in US dollars can be matched');
  if (payment.ours) return bad('That payment was charged from this dashboard — it is already tracked', 409);
  if (payment.invoice_id) {
    const { data: mine } = await service.from('billing_charges').select('id').eq('stripe_invoice_id', payment.invoice_id).limit(1);
    if (mine?.length) return bad('That payment was charged from this dashboard — it is already tracked', 409);
  }

  const key = matchKey(payment.id);
  const { data: before, error: beforeError } = await service.from('billing_charges').select('id, status').eq('request_id', key);
  if (beforeError) return dbError(beforeError);
  if ((before ?? []).some(c => LIVE_CHARGE_STATUSES.includes(c.status as string))) return bad('That payment is already matched — refresh', 409);
  // A match that was removed leaves a cancelled record; make room for the new one.
  for (const c of before ?? []) await service.from('billing_charges').delete().eq('id', c.id);

  let events: Row[] = [];
  if (eventIds.length) {
    for (const part of chunks(eventIds)) {
      const { data, error } = await service.from('events').select('id, client_id, event_type, lead_name, scheduled_at, occurred_at').in('id', part);
      if (error) return dbError(error);
      events.push(...((data ?? []) as Row[]));
    }
    events = events.filter(e => e.client_id === clientId && APPOINTMENT_TYPES.includes(e.event_type as string));
    if (events.length !== eventIds.length) return bad('Some of those appointments no longer exist for this client — refresh and try again', 409);
    for (const part of chunks(eventIds)) {
      const { data, error } = await service.from('billing_appointments').select('event_id').in('event_id', part);
      if (error) return dbError(error);
      if (data?.length) return bad(`${data.length} of those ${data.length === 1 ? 'is' : 'are'} already billed, credited or cancelled — refresh and try again`, 409);
    }
  }

  const { data: charge, error: insertError } = await service.from('billing_charges').insert({
    client_id: clientId, client_name: client.name,
    kind: events.length ? 'appointments' : 'custom',
    description: describe(payment, events.length), appointment_count: events.length,
    subtotal: payment.amount, credit_applied: 0, total: payment.amount,
    // Recorded, not charged: removing it never touches the money in Stripe.
    method: 'manual', status: 'paid',
    created_at: payment.created, paid_at: payment.created,
    stripe_customer_id: payment.customer_id, stripe_invoice_url: payment.url,
    request_id: key, created_by: ctx.userId,
  }).select('id').single();
  if (insertError || !charge) {
    if (insertError?.code === '23505') return bad('That payment is already matched — refresh', 409);
    return dbError(insertError ?? { message: 'Could not save the match' });
  }

  if (events.length) {
    const prices = split(payment.amount, events.length);
    const ordered = [...events].sort((a, b) => String(a.occurred_at).localeCompare(String(b.occurred_at)));
    const { error } = await service.from('billing_appointments').insert(ordered.map((e, i) => ({
      client_id: clientId, event_id: e.id, lead_name: e.lead_name,
      appointment_at: e.scheduled_at ?? e.occurred_at, charge_id: charge.id, price: prices[i],
    })));
    if (error) {
      await service.from('billing_appointments').delete().eq('charge_id', charge.id);
      await service.from('billing_charges').delete().eq('id', charge.id);
      if (error.code === '23505') return bad('Some of those were just billed or credited — refresh and try again', 409);
      return dbError(error);
    }
  }

  // Remember whose Stripe customer this is, so their next payment finds them
  // on its own. Never replaces a link that is already there.
  let linked = false;
  if (payment.customer_id && body.link !== false) {
    const { data: s } = await service.from('billing_clients').select('stripe_customer_id').eq('client_id', clientId).maybeSingle();
    const { data: holder } = await service.from('billing_clients').select('client_id').eq('stripe_customer_id', payment.customer_id).limit(1);
    if (!s?.stripe_customer_id && !holder?.length) {
      const { error } = await service.from('billing_clients')
        .upsert({ client_id: clientId, stripe_customer_id: payment.customer_id, updated_at: new Date().toISOString() }, { onConflict: 'client_id' });
      linked = !error;
    }
  }

  return NextResponse.json({ success: true, charge_id: charge.id, amount: payment.amount, appointments: events.length, linked });
}

// Reading a long stretch of Stripe takes a few round trips.
export const maxDuration = 60;
