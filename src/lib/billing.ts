// Client Billing — the rules, kept apart from the routes so they can be checked
// on their own.
//
// An appointment is one row in `events` (booked, then flipped to show / no-show
// in place). Billing tracks it in `billing_appointments`:
//   no row                       → not tracked: nobody has decided yet
//   row with a charge            → billed
//   row with a charge of 0 paid  → paid with credit: a good appointment a
//     in full by credit            credit paid for, never billed
//   row with credited_at         → credit given: a bad appointment; the client
//                                  gets credit_amount back (one appointment's
//                                  price, whether it was billed here or not)
//   row with cancelled_at        → not billed: no charge, nothing owed (so is
//                                  an old row credited for 0)
//
// A client's credit balance is what they are owed against their next charge:
//   credits on appointments + credits added by hand − credit already used.

import type { AuthContext } from './api-auth';

export const APPOINTMENT_TYPES = ['appointment_booked', 'show', 'no_show'];

/** Charges whose used credit still counts as used. A failed or cancelled
 *  charge gives its credit back. */
export const LIVE_CHARGE_STATUSES = ['draft', 'pending', 'paid'];

export const toCents = (dollars: number) => Math.round(dollars * 100);
export const fromCents = (cents: number) => Math.round(cents) / 100;
export const round2 = (n: number) => fromCents(toCents(n));

/** Stripe refuses card charges under 50 cents. */
export const STRIPE_MINIMUM = 0.5;

export function creditBalance(
  appointments: { credit_amount: number | null }[],
  credits: { amount: number | null }[],
  charges: { credit_applied: number | null; status: string }[],
): number {
  const earned = appointments.reduce((s, a) => s + toCents(Number(a.credit_amount ?? 0)), 0)
    + credits.reduce((s, c) => s + toCents(Number(c.amount ?? 0)), 0);
  const used = charges
    .filter(c => LIVE_CHARGE_STATUSES.includes(c.status))
    .reduce((s, c) => s + toCents(Number(c.credit_applied ?? 0)), 0);
  return fromCents(earned - used);
}

export type ChargePlan = { subtotal: number; credit: number; total: number };

/** What a charge comes to. Credit never exceeds the balance or the subtotal;
 *  `applyCredit` undefined means "use as much as there is". */
export function planCharge(opts: {
  count: number; price: number; customAmount?: number; balance: number; applyCredit?: number;
}): ChargePlan {
  const subtotalCents = opts.count > 0
    ? toCents(opts.price) * opts.count
    : toCents(opts.customAmount ?? 0);
  const available = Math.max(0, Math.min(toCents(opts.balance), subtotalCents));
  const wanted = opts.applyCredit === undefined ? available : toCents(opts.applyCredit);
  const creditCents = Math.max(0, Math.min(wanted, available));
  return {
    subtotal: fromCents(subtotalCents),
    credit: fromCents(creditCents),
    total: fromCents(subtotalCents - creditCents),
  };
}

/* ── credit → free appointments ───────────────────────────────────────────────
   Credit a client holds pays for their next bookings on its own: once they hold
   at least one appointment's price, the first appointment booked after that
   credit was issued is marked "covered by credit" and never billed. Credit is
   used oldest first, and only ever on bookings made after it was issued — it
   never reaches back to old appointments. */

export type CreditEntry = { at: string; amount: number };

const time = (iso: string) => new Date(iso).getTime();

/** When the oldest credit with something still left on it was issued (credit is
 *  used oldest first). null = all of it is used. */
export function oldestOpenCredit(credits: CreditEntry[], used: number): string | null {
  let left = toCents(used);
  for (const c of [...credits].sort((a, b) => time(a.at) - time(b.at))) {
    const worth = toCents(c.amount);
    if (worth <= 0) continue;
    if (left >= worth) { left -= worth; continue; }
    return c.at;
  }
  return null;
}

/** The bookings a client's credit covers, in order. `candidates` are their
 *  appointments that are neither charged nor credited. */
export function planCovers(opts: {
  credits: CreditEntry[]; used: number; price: number; candidates: { id: string; at: string }[];
}): string[] {
  const price = toCents(opts.price);
  if (price <= 0) return [];
  const total = opts.credits.reduce((s, c) => s + Math.max(0, toCents(c.amount)), 0);
  const pool = [...opts.candidates].sort((a, b) => time(a.at) - time(b.at));
  const covered: string[] = [];
  let used = toCents(opts.used);
  while (total - used >= price) {
    const since = oldestOpenCredit(opts.credits, fromCents(used));
    if (!since) break;
    const next = pool.find(c => !covered.includes(c.id) && time(c.at) >= time(since));
    if (!next) break;
    covered.push(next.id);
    used += price;
  }
  return covered;
}

/** The appointments' names as one line — "Dana White, Luis Ortega +3 more" —
 *  for the note Stripe carries. Stripe caps a note at 500 characters. */
export function namesNote(names: (string | null | undefined)[], max = 400): string {
  const clean = names.map(n => (typeof n === 'string' && n.trim() ? n.trim().split(/\s+/).join(' ') : 'No name'));
  let out = '';
  for (let i = 0; i < clean.length; i++) {
    const next = out ? `${out}, ${clean[i]}` : clean[i];
    const rest = clean.length - i - 1;
    if (next.length + (rest ? ` +${rest} more`.length : 0) > max) return out ? `${out} +${clean.length - i} more` : clean[i].slice(0, max);
    out = next;
  }
  return out;
}

/** How many whole appointments a credit balance is worth at this price. */
export const creditInAppointments = (balance: number, price: number) =>
  price > 0 ? Math.floor(toCents(balance) / toCents(price)) : 0;

/** The database has not had the "cancelled" column added yet. */
export function isMissingColumn(error: { code?: string; message?: string } | null | undefined, column: string): boolean {
  if (!error) return false;
  return (error.code === 'PGRST204' || error.code === '42703' || /column|schema cache/i.test(error.message ?? ''))
    && (error.message ?? '').includes(column);
}

/** A charge paid entirely with credit: nothing was billed for it. */
export const paidByCredit = (c: { total?: unknown; credit_applied?: unknown }) =>
  toCents(Number(c.total ?? 0)) === 0 && toCents(Number(c.credit_applied ?? 0)) > 0;

/* ── where an appointment came from, and what each source returns ─────────────
   SMS and Facebook Ads are told apart the same way the Clients dashboard does:
   an SMS reply is stored as a lead with `ad_platform = sms`, and the bookings
   that follow inherit it. Anything else carrying ad attribution is ads. An
   appointment with no recorded source falls back on the client's service — and
   for a client running both, it is "unknown" rather than guessed. */

export type Source = 'ads' | 'sms' | 'unknown';

type Attributed = {
  ad_platform?: unknown; utm_source?: unknown; utm_medium?: unknown;
  campaign_id?: unknown; adset_id?: unknown; ad_id?: unknown; utm_campaign?: unknown;
};

const isSms = (v: unknown) => typeof v === 'string' && v.trim().toLowerCase() === 'sms';

/** The booking itself says where it came from. false = nothing was recorded
 *  on it, and `sourceOf` falls back on what the client runs. */
export const sourceRecorded = (e: Attributed): boolean =>
  isSms(e.ad_platform) || isSms(e.utm_source) || isSms(e.utm_medium)
  || !!(e.ad_platform || e.campaign_id || e.adset_id || e.ad_id || e.utm_source || e.utm_campaign);

export function sourceOf(e: Attributed, service: string | null | undefined): Source {
  if (isSms(e.ad_platform) || isSms(e.utm_source) || isSms(e.utm_medium)) return 'sms';
  if (e.ad_platform || e.campaign_id || e.adset_id || e.ad_id || e.utm_source || e.utm_campaign) return 'ads';
  if (service === 'sms') return 'sms';
  if (service === 'both') return 'unknown';
  return 'ads';
}

export type BillingState = 'to_bill' | 'charged' | 'credited' | 'covered' | 'cancelled';

export type SourceReturn = {
  appointments: number;       // booked in the period
  credited: number;           // of those, credited — earn nothing
  cancelled: number;          // of those, cancelled — earn nothing
  untracked: number;          // of those, not decided yet
  billed: number;             // $ already charged, or paid for by credit
  to_bill: number;            // $ the untracked ones are worth, at the client's price
  revenue: number;            // billed + to_bill
  cost: number;               // SMS cost. Ads cost us nothing: the client pays the ad spend
  profit: number;             // revenue − cost
  multiple: number | null;    // revenue ÷ cost; null when nothing was spent
  cost_per_appointment: number | null;
};

/** What each source cost and what its appointments bring in. A billed or
 *  credit-covered appointment counts at the price it was charged; one not
 *  tracked yet counts at the client's current price; a credited or cancelled
 *  one counts for nothing. */
export function returnsBySource(
  appointments: { source: Source; state: BillingState; price: number; clientPrice: number }[],
  costs: { ads: number; sms: number },
): Record<'ads' | 'sms', SourceReturn> & { unknown: number } {
  const make = (source: 'ads' | 'sms'): SourceReturn => {
    const mine = appointments.filter(a => a.source === source);
    const billed = mine.filter(a => a.state === 'charged' || a.state === 'covered').reduce((s, a) => s + toCents(a.price), 0);
    const toBill = mine.filter(a => a.state === 'to_bill').reduce((s, a) => s + toCents(a.clientPrice), 0);
    const cost = toCents(costs[source]);
    return {
      appointments: mine.length,
      credited: mine.filter(a => a.state === 'credited').length,
      cancelled: mine.filter(a => a.state === 'cancelled').length,
      untracked: mine.filter(a => a.state === 'to_bill').length,
      billed: fromCents(billed), to_bill: fromCents(toBill), revenue: fromCents(billed + toBill),
      cost: fromCents(cost), profit: fromCents(billed + toBill - cost),
      multiple: cost > 0 ? Math.round(((billed + toBill) / cost) * 100) / 100 : null,
      cost_per_appointment: cost > 0 && mine.length > 0 ? fromCents(cost / mine.length) : null,
    };
  };
  return { ads: make('ads'), sms: make('sms'), unknown: appointments.filter(a => a.source === 'unknown').length };
}

/** Billing moves real money, so "no restriction set" is not enough: it takes
 *  an admin, or an account an admin has ticked Client Billing for. */
export async function canBill(ctx: AuthContext): Promise<boolean> {
  const { data } = await ctx.service
    .from('profiles').select('is_admin, allowed_views').eq('id', ctx.userId).maybeSingle();
  if (data?.is_admin === true) return true;
  return Array.isArray(data?.allowed_views) && data.allowed_views.includes('client_billing');
}

/** The billing tables have not been created on this database yet. */
export function isMissingTable(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return error.code === '42P01' || error.code === 'PGRST205'
    || /schema cache|does not exist/i.test(error.message ?? '');
}
