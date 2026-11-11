// Match with Stripe — the rules, kept apart from the route so they can be
// checked on their own.
//
// Money that reached Stripe outside this dashboard (an invoice sent from
// Stripe, a payment link) says who paid and how much, never which appointments
// it was for. These rules make the suggestion a person then confirms:
//
//   who      the client linked to that Stripe customer; failing that, the one
//            roster client whose name or email matches
//   how many the amount ÷ that client's price per appointment, when it divides
//   which    appointments named in the payment's description first, then the
//            most recent ones booked before the payment that nobody has
//            tracked yet. Each appointment is suggested for one payment only.
//
// Nothing here saves anything.

import { toCents, type Source } from './billing';

export type MatchClient = {
  id: string; name: string; price: number;
  stripe_customer_id: string | null;
  email?: string | null;
};

export type MatchPayment = {
  id: string; created: string; amount: number;
  customer_id: string | null; customer_name: string | null; customer_email: string | null;
  description: string;
};

export type Candidate = { event_id: string; client_id: string; at: string; lead_name: string | null; source: Source };

/** How the client was found. `linked` is certain; the others are a guess to confirm. */
export type ClientMatch = { client_id: string | null; how: 'linked' | 'email' | 'name' | null };

const SUFFIX = /\b(llc|inc|ltd|co|corp|corporation|company|the|l l c)\b/g;
export const normalName = (v: string | null | undefined) =>
  (v ?? '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ').replace(SUFFIX, ' ').replace(/\s+/g, ' ').trim();

export function clientFor(p: MatchPayment, clients: MatchClient[]): ClientMatch {
  if (p.customer_id) {
    const linked = clients.filter(c => c.stripe_customer_id === p.customer_id);
    if (linked.length === 1) return { client_id: linked[0].id, how: 'linked' };
  }
  const email = (p.customer_email ?? '').trim().toLowerCase();
  if (email) {
    const same = clients.filter(c => (c.email ?? '').trim().toLowerCase() === email);
    if (same.length === 1) return { client_id: same[0].id, how: 'email' };
  }
  const name = normalName(p.customer_name);
  if (name.length >= 3) {
    const exact = clients.filter(c => normalName(c.name) === name);
    if (exact.length === 1) return { client_id: exact[0].id, how: 'name' };
    if (exact.length === 0 && name.length >= 5) {
      const near = clients.filter(c => {
        const n = normalName(c.name);
        return n.length >= 5 && (n.includes(name) || name.includes(n));
      });
      if (near.length === 1) return { client_id: near[0].id, how: 'name' };
    }
  }
  return { client_id: null, how: null };
}

/** How many appointments the amount pays for at this price. 0 = it doesn't
 *  divide (or no price is set), so a person has to say. */
export function countFor(amount: number, price: number): number {
  const a = toCents(amount), p = toCents(price);
  if (p <= 0 || a <= 0 || a % p !== 0) return 0;
  return a / p;
}

const SLACK_MS = 24 * 3600 * 1000;   // a payment and its booking can straddle midnight
const time = (iso: string) => new Date(iso).getTime();

const hintOf = (text: string): Source | null => {
  if (/\b(sms|text|texts)\b/i.test(text)) return 'sms';
  if (/\b(fb|facebook|meta|ads?)\b/i.test(text)) return 'ads';
  return null;
};

/** The appointments to suggest for one payment, best guess first. */
export function pick(opts: {
  payment: { created: string; description: string }; count: number;
  candidates: Candidate[]; taken: Set<string>;
}): string[] {
  if (opts.count <= 0) return [];
  const paidAt = time(opts.payment.created) + SLACK_MS;
  const said = normalName(opts.payment.description);
  const hint = hintOf(opts.payment.description);
  const open = opts.candidates.filter(c => !opts.taken.has(c.event_id) && time(c.at) <= paidAt);

  const named = (c: Candidate) => {
    const n = normalName(c.lead_name);
    return n.length >= 5 && n.includes(' ') && said.includes(n) ? 1 : 0;
  };
  const hinted = (c: Candidate) => (hint && c.source === hint ? 1 : 0);
  return [...open]
    .sort((a, b) => named(b) - named(a) || hinted(b) - hinted(a) || time(b.at) - time(a.at))
    .slice(0, opts.count)
    .map(c => c.event_id);
}

export type Suggestion = ClientMatch & {
  /** Appointments the amount pays for at the client's price; 0 = can't tell. */
  count: number;
  event_ids: string[];
};

/** A suggestion for every payment. Oldest payment first, so two payments from
 *  one client never claim the same appointment. */
export function suggest(payments: MatchPayment[], clients: MatchClient[], candidates: Candidate[]): Map<string, Suggestion> {
  const byClient = new Map<string, Candidate[]>();
  for (const c of candidates) byClient.set(c.client_id, [...(byClient.get(c.client_id) ?? []), c]);
  const priceOf = new Map(clients.map(c => [c.id, c.price]));
  const taken = new Set<string>();
  const out = new Map<string, Suggestion>();
  for (const p of [...payments].sort((a, b) => time(a.created) - time(b.created))) {
    const who = clientFor(p, clients);
    const count = who.client_id ? countFor(p.amount, priceOf.get(who.client_id) ?? 0) : 0;
    const ids = who.client_id ? pick({ payment: p, count, candidates: byClient.get(who.client_id) ?? [], taken }) : [];
    ids.forEach(id => taken.add(id));
    out.set(p.id, { ...who, count, event_ids: ids });
  }
  return out;
}

/** The payment's amount spread over its appointments, to the cent. */
export function split(amount: number, n: number): number[] {
  if (n <= 0) return [];
  const total = toCents(amount);
  const base = Math.floor(total / n), extra = total - base * n;
  return Array.from({ length: n }, (_, i) => (base + (i < extra ? 1 : 0)) / 100);
}

/** What ties a saved charge to its Stripe payment — and stops it being saved twice. */
export const MATCH = 'stripe:';
export const matchKey = (paymentId: string) => `${MATCH}${paymentId}`;
