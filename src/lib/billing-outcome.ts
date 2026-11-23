// Whether an appointment "showed", read from Client Billing (owner's rule,
// NOTES.md 2026-11-23). Clients never report shows, so for the Clients
// dashboard's SMS view the billing decision IS the outcome:
//
//   billed, or paid with a credit          → show
//   not billed — cancelled or no-show      → no-show   (so is an older row with no reason)
//   not billed — card declined             → show      (the appointment happened; only the payment failed)
//   credit given (a bad appointment)       → no-show   (the client got its price back)
//   not tracked yet                        → neither
//
// Pure: the billing screen (browser) and the metrics route both read this file.

export const NOT_BILLED_REASONS = ['cancelled', 'no_show', 'card_declined'] as const;
export type NotBilledReason = (typeof NOT_BILLED_REASONS)[number];
export const NOT_BILLED_LABEL: Record<NotBilledReason, string> = {
  cancelled: 'Cancelled', no_show: 'No-Show', card_declined: 'Card Declined',
};
export const isNotBilledReason = (v: unknown): v is NotBilledReason =>
  typeof v === 'string' && (NOT_BILLED_REASONS as readonly string[]).includes(v);

type BillingRow = {
  charge_id?: unknown; credited_at?: unknown; cancelled_at?: unknown;
  credit_amount?: unknown; not_billed_reason?: unknown;
};

/** show / no_show for a tracked appointment; null when nobody has decided yet. */
export function billedOutcome(a: BillingRow | null | undefined): 'show' | 'no_show' | null {
  if (!a) return null;
  // Not billed: marked so, or (older records) "credited" for nothing.
  const notBilled = !!a.cancelled_at || (!!a.credited_at && !a.charge_id && Number(a.credit_amount ?? 0) <= 0);
  if (notBilled) return a.not_billed_reason === 'card_declined' ? 'show' : 'no_show';
  if (a.credited_at) return 'no_show';
  return a.charge_id ? 'show' : null;
}
