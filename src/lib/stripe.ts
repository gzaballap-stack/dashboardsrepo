// Stripe, over its REST API — no SDK. Server-side only.
//
// Used by Client Billing to charge a client's saved card or email them an
// invoice. Every charge is a Stripe invoice: one line per item, credit as a
// negative line, so the client's receipt reads the same as the dashboard.
//
// STRIPE_SECRET_KEY unset = billing still tracks everything, and charges can
// only be recorded by hand.

const API = 'https://api.stripe.com/v1';
const TIMEOUT_MS = 25_000;

export class StripeError extends Error {
  /** false = the request may or may not have reached Stripe (timeout, network). */
  definite: boolean;
  code: string | null;
  constructor(message: string, definite: boolean, code: string | null = null) {
    super(message);
    this.definite = definite;
    this.code = code;
  }
}

const key = () => (process.env.STRIPE_SECRET_KEY ?? '').trim();

export function stripeStatus(): { configured: boolean; test: boolean } {
  const k = key();
  return { configured: k.length > 0, test: /^(sk|rk)_test_/.test(k) };
}

type Params = Record<string, string | number | boolean | null | undefined | Record<string, string>>;

// { a: 1, metadata: { b: 'c' } } → a=1&metadata[b]=c
function encode(params: Params): string {
  const out = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined) continue;
    if (typeof v === 'object') {
      for (const [k2, v2] of Object.entries(v)) out.append(`${k}[${k2}]`, v2);
    } else out.append(k, String(v));
  }
  return out.toString();
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

async function call(method: 'GET' | 'POST' | 'DELETE', path: string, params?: Params, idempotencyKey?: string, version?: string): Promise<Json> {
  const k = key();
  if (!k) throw new StripeError('Stripe is not connected', true);

  const headers: Record<string, string> = { Authorization: `Bearer ${k}` };
  if (version) headers['Stripe-Version'] = version;
  let url = `${API}${path}`;
  let body: string | undefined;
  if (params && method === 'GET') url += (url.includes('?') ? '&' : '?') + encode(params);
  else if (params) { body = encode(params); headers['Content-Type'] = 'application/x-www-form-urlencoded'; }
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

  let res: Response;
  try {
    res = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(TIMEOUT_MS), cache: 'no-store' });
  } catch {
    throw new StripeError("Couldn't reach Stripe", false);
  }
  let data: Json = null;
  try { data = await res.json(); } catch { /* not JSON */ }
  if (!res.ok) {
    // 5xx: Stripe may have done the work before failing to answer.
    throw new StripeError(data?.error?.message ?? `Stripe answered ${res.status}`, res.status < 500, data?.error?.code ?? null);
  }
  return data;
}

/* ── customers ────────────────────────────────────────────────────────────── */

export type StripeCustomer = { id: string; name: string | null; email: string | null };

/** Customers matching a name or email. Reads up to 500 and filters here —
 *  Stripe's own search is not available on every account. */
export async function findCustomers(q: string): Promise<StripeCustomer[]> {
  const needle = q.trim().toLowerCase();
  const found: StripeCustomer[] = [];
  let after: string | undefined;
  for (let page = 0; page < 5; page++) {
    const data = await call('GET', '/customers', { limit: 100, starting_after: after });
    const rows: Json[] = data?.data ?? [];
    for (const c of rows) {
      const hay = `${c.name ?? ''} ${c.email ?? ''} ${c.description ?? ''}`.toLowerCase();
      if (!needle || hay.includes(needle)) found.push({ id: c.id, name: c.name ?? c.description ?? null, email: c.email ?? null });
    }
    if (!data?.has_more || !rows.length) break;
    after = rows[rows.length - 1].id;
  }
  return found.slice(0, 50);
}

export async function createCustomer(name: string, email: string | null): Promise<StripeCustomer> {
  const c = await call('POST', '/customers', { name, email: email || undefined });
  return { id: c.id, name: c.name ?? null, email: c.email ?? null };
}

/**
 * A Stripe-hosted page where the card is typed in and saved on the customer —
 * no charge is made. This is how a card gets on file: the number never passes
 * through the dashboard. The link works for 24 hours.
 */
export async function createCardSetupLink(customerId: string, returnUrl: string): Promise<string> {
  const session = await call('POST', '/checkout/sessions', {
    mode: 'setup', customer: customerId,
    'payment_method_types[0]': 'card',
    success_url: returnUrl, cancel_url: returnUrl,
  });
  if (!session?.url) throw new StripeError('Stripe did not return a link', true);
  return session.url as string;
}

export type CustomerSummary = StripeCustomer & {
  /** What a card charge would use. null = nothing on file. */
  payment: { id: string | null; label: string } | null;
};

function describePayment(pm: Json): string {
  if (pm?.card) return `${String(pm.card.brand ?? 'card').replace(/^./, (ch: string) => ch.toUpperCase())} •••• ${pm.card.last4}`;
  if (pm?.us_bank_account) return `${pm.us_bank_account.bank_name ?? 'Bank account'} •••• ${pm.us_bank_account.last4}`;
  if (pm?.sepa_debit) return `SEPA •••• ${pm.sepa_debit.last4}`;
  return 'Saved payment method';
}

/** The customer and the payment method a card charge would use. null if the
 *  customer no longer exists in Stripe. */
export async function getCustomer(id: string): Promise<CustomerSummary | null> {
  let c: Json;
  try {
    c = await call('GET', `/customers/${encodeURIComponent(id)}`, { 'expand[]': 'invoice_settings.default_payment_method' });
  } catch (e) {
    if (e instanceof StripeError && e.code === 'resource_missing') return null;
    throw e;
  }
  if (!c || c.deleted) return null;
  const base = { id: c.id as string, name: (c.name ?? null) as string | null, email: (c.email ?? null) as string | null };

  const def = c.invoice_settings?.default_payment_method;
  if (def && typeof def === 'object') return { ...base, payment: { id: def.id, label: describePayment(def) } };

  const list = await call('GET', `/customers/${encodeURIComponent(id)}/payment_methods`, { limit: 10 });
  const pms: Json[] = list?.data ?? [];
  const pick = pms.find(p => p.type === 'card') ?? pms.find(p => p.type === 'us_bank_account') ?? pms[0];
  if (pick) return { ...base, payment: { id: pick.id, label: describePayment(pick) } };

  // Older customers hold a card as a "source"; Stripe charges it by default.
  if (c.default_source) return { ...base, payment: { id: null, label: 'Saved card' } };
  return { ...base, payment: null };
}

/* ── invoices ─────────────────────────────────────────────────────────────── */

export type InvoiceState = {
  id: string;
  /** draft | open | paid | uncollectible | void */
  status: string;
  url: string | null;
};

const stateOf = (inv: Json): InvoiceState => ({ id: inv.id, status: inv.status, url: inv.hosted_invoice_url ?? null });

export type InvoiceLine = { description: string; cents: number };

/** A draft invoice holding exactly these lines — nothing else pending on the
 *  customer is swept in. `ref` is our charge id: it keys every request, so a
 *  repeat of the same call can never create a second invoice. */
export async function createDraftInvoice(opts: {
  ref: string; customerId: string; lines: InvoiceLine[]; description: string;
  method: 'card' | 'invoice'; paymentMethodId?: string | null; daysUntilDue?: number;
  /** The appointments it is for, kept on the invoice in Stripe. */
  note?: string;
}): Promise<InvoiceState> {
  const inv = await call('POST', '/invoices', {
    customer: opts.customerId,
    currency: 'usd',
    collection_method: opts.method === 'card' ? 'charge_automatically' : 'send_invoice',
    days_until_due: opts.method === 'invoice' ? (opts.daysUntilDue ?? 7) : undefined,
    default_payment_method: opts.method === 'card' ? (opts.paymentMethodId ?? undefined) : undefined,
    auto_advance: false,
    pending_invoice_items_behavior: 'exclude',
    description: opts.description || undefined,
    metadata: opts.note ? { billing_charge_id: opts.ref, appointments: opts.note.slice(0, 500) } : { billing_charge_id: opts.ref },
  }, `${opts.ref}-invoice`);

  try {
    for (let i = 0; i < opts.lines.length; i++) {
      const line = opts.lines[i];
      await call('POST', '/invoiceitems', {
        customer: opts.customerId, invoice: inv.id, currency: 'usd',
        amount: line.cents, description: line.description,
      }, `${opts.ref}-item-${i}`);
    }
  } catch (e) {
    await deleteDraftInvoice(inv.id);
    throw e;
  }
  return stateOf(inv);
}

export async function finalizeInvoice(id: string, ref: string): Promise<InvoiceState> {
  return stateOf(await call('POST', `/invoices/${id}/finalize`, { auto_advance: false }, `${ref}-finalize`));
}

/** Charges the invoice's payment method now. */
export async function payInvoice(id: string, ref: string): Promise<InvoiceState> {
  return stateOf(await call('POST', `/invoices/${id}/pay`, {}, `${ref}-pay`));
}

/** Emails the invoice to the customer. */
export async function sendInvoice(id: string, ref: string): Promise<InvoiceState> {
  return stateOf(await call('POST', `/invoices/${id}/send`, {}, `${ref}-send`));
}

export async function getInvoice(id: string): Promise<InvoiceState> {
  return stateOf(await call('GET', `/invoices/${id}`));
}

export async function voidInvoice(id: string): Promise<InvoiceState> {
  return stateOf(await call('POST', `/invoices/${id}/void`, {}));
}

/** Best effort — a draft that can't be deleted is harmless (never sent, never charged). */
export async function deleteDraftInvoice(id: string): Promise<boolean> {
  try { await call('DELETE', `/invoices/${id}`); return true; } catch { return false; }
}

/* ── payments already taken in Stripe ─────────────────────────────────────────
   Read-only. Used to match money that reached Stripe outside this dashboard
   (an invoice sent from Stripe, a payment link) to the client's appointments. */

export type StripePayment = {
  id: string;                    // the Stripe charge, ch_… / py_…
  created: string;               // when it was paid
  amount: number;                // dollars, net of any refund
  currency: string;
  customer_id: string | null;
  customer_name: string | null;
  customer_email: string | null;
  description: string;           // what the invoice or payment says it was for
  url: string | null;            // the invoice or receipt
  invoice_id: string | null;
  /** Set when the payment came from a charge made in this dashboard. */
  ours: string | null;
};

// A version where a charge still names its invoice, so the invoice's lines can
// be read in the same request.
const WITH_INVOICE = '2024-06-20';

const https = (v: unknown) => (typeof v === 'string' && v.startsWith('https://') ? v : null);

function toPayment(c: Json): StripePayment | null {
  if (!c || c.status !== 'succeeded' || c.paid === false) return null;
  const cents = Number(c.amount ?? 0) - Number(c.amount_refunded ?? 0);
  if (!(cents > 0)) return null;
  const customer = c.customer && typeof c.customer === 'object' ? c.customer : null;
  const invoice = c.invoice && typeof c.invoice === 'object' ? c.invoice : null;
  const lines: string[] = ((invoice?.lines?.data ?? []) as Json[])
    .map(l => (typeof l?.description === 'string' ? l.description.trim() : '')).filter(Boolean);
  const said = [typeof c.description === 'string' ? c.description.trim() : '', typeof invoice?.description === 'string' ? invoice.description.trim() : '', ...lines]
    .filter((t, i, all) => t && all.indexOf(t) === i);
  return {
    id: String(c.id),
    created: new Date(Number(c.created ?? 0) * 1000).toISOString(),
    amount: cents / 100,
    currency: String(c.currency ?? 'usd').toLowerCase(),
    customer_id: customer?.id ?? (typeof c.customer === 'string' ? c.customer : null),
    customer_name: (customer && !customer.deleted ? customer.name ?? customer.description : null) ?? c.billing_details?.name ?? null,
    customer_email: (customer && !customer.deleted ? customer.email : null) ?? c.billing_details?.email ?? c.receipt_email ?? null,
    description: said.join(' · ').slice(0, 400),
    url: https(invoice?.hosted_invoice_url) ?? https(c.receipt_url),
    invoice_id: invoice?.id ?? (typeof c.invoice === 'string' ? c.invoice : null),
    ours: invoice?.metadata?.billing_charge_id ?? c.metadata?.billing_charge_id ?? null,
  };
}

/** Successful payments between two moments (unix seconds), newest first.
 *  `limited` = Stripe would not hand over the invoice behind each payment, so
 *  descriptions are thinner and `ours` can't be told. `more` = there were more
 *  than could be read in one go. */
export async function listPayments(opts: { from?: number | null; to?: number | null; maxPages?: number }): Promise<{ payments: StripePayment[]; limited: boolean; more: boolean }> {
  const read = async (withInvoice: boolean) => {
    const out: StripePayment[] = [];
    let after: string | undefined;
    let more = false;
    const pages = opts.maxPages ?? 10;
    for (let page = 0; page < pages; page++) {
      const data = await call('GET', '/charges', {
        limit: 100, starting_after: after,
        'created[gte]': opts.from ?? undefined, 'created[lte]': opts.to ?? undefined,
        'expand[0]': 'data.customer', 'expand[1]': withInvoice ? 'data.invoice' : undefined,
      }, undefined, withInvoice ? WITH_INVOICE : undefined);
      const rows: Json[] = data?.data ?? [];
      for (const c of rows) { const p = toPayment(c); if (p) out.push(p); }
      if (!data?.has_more || !rows.length) break;
      after = rows[rows.length - 1].id;
      if (page === pages - 1) more = true;
    }
    return { payments: out, more };
  };
  try {
    return { ...(await read(true)), limited: false };
  } catch (e) {
    // Stripe refused the fuller request — the plain one still lists the money.
    if (!(e instanceof StripeError) || !e.definite) throw e;
    return { ...(await read(false)), limited: true };
  }
}

/** Writes a note on a payment in Stripe — which client and appointments it was
 *  for. Internal only (Stripe "metadata"): the customer never sees it and no
 *  money is touched. An empty value takes that note off again. Best effort:
 *  false if Stripe refused, e.g. a key that may only read. */
export async function notePayment(id: string, note: Record<string, string>): Promise<boolean> {
  const metadata = Object.fromEntries(Object.entries(note).map(([k, v]) => [k, v.slice(0, 500)]));
  try { await call('POST', `/charges/${encodeURIComponent(id)}`, { metadata }); return true; }
  catch { return false; }
}

/** One payment, read again from Stripe. null = not a successful payment. */
export async function getPayment(id: string): Promise<StripePayment | null> {
  const path = `/charges/${encodeURIComponent(id)}`;
  let c: Json;
  try {
    c = await call('GET', path, { 'expand[0]': 'customer', 'expand[1]': 'invoice' }, undefined, WITH_INVOICE);
  } catch (e) {
    if (!(e instanceof StripeError) || !e.definite) throw e;
    if (e.code === 'resource_missing') return null;
    try { c = await call('GET', path, { 'expand[0]': 'customer' }); }
    catch (e2) { if (e2 instanceof StripeError && e2.code === 'resource_missing') return null; throw e2; }
  }
  return toPayment(c);
}
