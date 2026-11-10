// Client Billing — the rules, kept apart from the routes so they can be checked
// on their own.
//
// An appointment is one row in `events` (booked, then flipped to show / no-show
// in place). Billing tracks it in `billing_appointments`:
//   no row                       → not charged
//   row with a charge            → charged
//   row with credited_at         → credited (credit_amount is what came back:
//                                  its price if it had been charged, else 0)
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
