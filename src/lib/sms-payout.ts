// Johnny's payout — pure rules, shared by the API route and its checks.
//
// Johnny gets a share (30% unless changed) of the revenue a client he signed
// through the B2B SMS system generates in their first month. The month is 30
// days from the client's first SMS blast; what is collected inside it, per
// Client Billing, is the base; once the 30 days are over the figure is final.

export const DEFAULT_PCT = 30;
export const WINDOW_DAYS = 30;

export type PayoutStatus = 'not_started' | 'tracking' | 'final';

export type PayoutRow = {
  id: string;
  client_id: string;
  client_name: string;
  close_event_id: string | null;
  signed_on: string;                 // YYYY-MM-DD
  started_on: string | null;         // effective start: by hand, else first blast
  start_source: 'manual' | 'blast' | null;
  ends_on: string | null;            // first day after the window
  revenue: number;                   // paid charges inside the window
  charges: number;                   // how many
  pct: number;
  payout: number;
  status: PayoutStatus;
  days_left: number | null;          // tracking only
  cash_at_close: number;             // what the close itself recorded (not in revenue)
  notes: string | null;
};

const DAY = /^\d{4}-\d{2}-\d{2}$/;
export const isDay = (s: unknown): s is string => typeof s === 'string' && DAY.test(s);

/** YYYY-MM-DD plus n days, in UTC. */
export function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** The calendar day (UTC) of a timestamp, or the day itself. */
export const dayOf = (ts: string | null | undefined): string | null => {
  if (!ts) return null;
  if (isDay(ts)) return ts;
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
};

export const round2 = (n: number) => Math.round(n * 100) / 100;

export function clampPct(v: unknown, fallback = DEFAULT_PCT): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(100, Math.max(0, round2(n)));
}

export type Charge = { client_id: string; total: number | string | null; status: string; paid_at: string | null; created_at: string };

/**
 * One client's figures. `firstBlast` is the day of the client's first SMS
 * blast (null = none yet); `charges` the client's billing charges, any period.
 */
export function computeRow(
  base: { id: string; client_id: string; client_name: string; close_event_id: string | null; signed_on: string; started_on: string | null; pct: number; notes: string | null; cash_at_close?: number },
  firstBlast: string | null,
  charges: Charge[],
  today: string,
): PayoutRow {
  const started_on = base.started_on ?? firstBlast ?? null;
  const start_source: PayoutRow['start_source'] = base.started_on ? 'manual' : firstBlast ? 'blast' : null;
  const ends_on = started_on ? addDays(started_on, WINDOW_DAYS) : null;

  let revenue = 0, count = 0;
  if (started_on && ends_on) {
    for (const c of charges) {
      if (c.client_id !== base.client_id || c.status !== 'paid') continue;
      const day = dayOf(c.paid_at ?? c.created_at);
      if (!day || day < started_on || day >= ends_on) continue;
      revenue += Number(c.total) || 0;
      count++;
    }
  }
  revenue = round2(revenue);

  const status: PayoutStatus = !started_on ? 'not_started' : today >= ends_on! ? 'final' : 'tracking';
  const days_left = status === 'tracking' && ends_on
    ? Math.max(0, Math.round((Date.parse(`${ends_on}T00:00:00.000Z`) - Date.parse(`${today}T00:00:00.000Z`)) / 86400000))
    : null;

  return {
    id: base.id, client_id: base.client_id, client_name: base.client_name, close_event_id: base.close_event_id,
    signed_on: base.signed_on, started_on, start_source, ends_on,
    revenue, charges: count, pct: base.pct, payout: round2(revenue * base.pct / 100),
    status, days_left, cash_at_close: round2(base.cash_at_close ?? 0), notes: base.notes,
  };
}

export function totals(rows: PayoutRow[]) {
  const sum = (f: (r: PayoutRow) => number) => round2(rows.reduce((s, r) => s + f(r), 0));
  return {
    clients: rows.length,
    revenue: sum(r => r.revenue),
    payout: sum(r => r.payout),
    payout_final: sum(r => (r.status === 'final' ? r.payout : 0)),
    payout_tracking: sum(r => (r.status === 'tracking' ? r.payout : 0)),
  };
}

// Normalised name match, for suggesting which roster client an SMS close became.
const norm = (s: string) => s.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').replace(/\b(and|llc|inc|ltd|co|corp)\b/g, ' ').trim().replace(/\s+/g, ' ');
export function suggestClient(lead: { lead_name?: string | null; lead_email?: string | null }, clients: { id: string; name: string; email?: string | null }[]): string | null {
  const email = (lead.lead_email ?? '').trim().toLowerCase();
  if (email) { const hit = clients.find(c => (c.email ?? '').trim().toLowerCase() === email); if (hit) return hit.id; }
  const name = norm(lead.lead_name ?? '');
  if (!name) return null;
  const exact = clients.filter(c => norm(c.name) === name);
  if (exact.length === 1) return exact[0].id;
  const loose = clients.filter(c => { const n = norm(c.name); return n && (n.includes(name) || name.includes(n)); });
  return loose.length === 1 ? loose[0].id : null;
}
