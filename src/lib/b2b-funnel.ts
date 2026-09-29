// Tomsi Media (B2B) funnel numbers for a date window, read from the dashboard's
// own data: `b2b_events` (leads, demos, closes, cash — the one-call model; intro rows are history only) and the
// mirrored `events` rows under the internal client (dials, pickups, speed to
// lead). Used by the Meta B2B report to sit GHL results next to Meta spend.

import type { createServiceClient } from './supabase';
import { getTomsiClientId } from './tomsi';

type Service = ReturnType<typeof createServiceClient>;

export type FunnelStats = {
  leads: number;
  demos_booked: number;
  demos_shown: number;             // "kept demos" (demo that showed)
  sales_calls_booked: number;
  sales_calls_shown: number;
  closes: number;
  cash_collected: number;
  spam_leads: number;              // fake submissions, excluded from everything above
  spam_appointments: number;
  dials: number;
  pickups: number;
  speed_to_lead_min: number | null;
  dials_per_lead: number | null;
  pickup_pct: number | null;
  lead_to_booking_pct: number | null;   // demos booked / leads
  show_pct: number | null;              // demos shown / demos booked
  close_pct: number | null;             // closes / demos shown
  kept_demos_by_ad: Record<string, number>;    // ad_id → demos shown (GHL attribution)
};

// Local-day bounds → UTC ISO strings, for a given IANA timezone.
export function dayBounds(since: string, until: string, tz: string): { from: string; to: string } {
  const offsetMs = (dateStr: string) => {
    const probe = new Date(`${dateStr}T12:00:00Z`);
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hour12: false }).formatToParts(probe);
    const localHour = Number(parts.find(p => p.type === 'hour')?.value ?? 12) % 24;
    return (localHour - 12) * 3_600_000;
  };
  const from = new Date(new Date(`${since}T00:00:00Z`).getTime() - offsetMs(since)).toISOString();
  const to = new Date(new Date(`${until}T23:59:59.999Z`).getTime() - offsetMs(until)).toISOString();
  return { from, to };
}

type B2BRow = { event_type: string; revenue: number | null; ghl_contact_id: string | null; ad_id: string | null };
type DialRow = { is_pickup: boolean | null; speed_to_lead_seconds: number | null };

export async function getFunnelStats(service: Service, since: string, until: string, tz: string): Promise<FunnelStats> {
  const { from, to } = dayBounds(since, until, tz);

  const tomsiId = await getTomsiClientId(service);
  const [b2b, dialsRes] = await Promise.all([
    service.from('b2b_events')
      .select('event_type, revenue, ghl_contact_id, ad_id')
      .gte('occurred_at', from).lte('occurred_at', to)
      .in('event_type', ['lead', 'intro_booked', 'intro_shown', 'sales_call_booked', 'sales_call_shown', 'close', 'spam_lead', 'spam_appointment']),
    tomsiId
      ? service.from('events').select('is_pickup, speed_to_lead_seconds')
          .eq('client_id', tomsiId).eq('event_type', 'dial')
          .gte('occurred_at', from).lte('occurred_at', to)
      : Promise.resolve({ data: [] as DialRow[], error: null }),
  ]);
  if (b2b.error) throw new Error(`b2b_events: ${b2b.error.message}`);
  if (dialsRes.error) throw new Error(`events: ${dialsRes.error.message}`);

  const rows = (b2b.data ?? []) as B2BRow[];
  const dials = (dialsRes.data ?? []) as DialRow[];

  const count = (t: string) => rows.filter(r => r.event_type === t).length;
  const leads = count('lead');
  const demosBooked = count('sales_call_booked');
  const demosShown = count('sales_call_shown');
  const closes = count('close');
  const cash = rows.filter(r => r.event_type === 'close').reduce((s, r) => s + (Number(r.revenue) || 0), 0);

  const keptByAd: Record<string, number> = {};
  for (const r of rows) {
    if (r.event_type === 'sales_call_shown' && r.ad_id) keptByAd[r.ad_id] = (keptByAd[r.ad_id] ?? 0) + 1;
  }

  const pickups = dials.filter(d => d.is_pickup).length;
  const speeds = dials.map(d => Number(d.speed_to_lead_seconds)).filter(n => Number.isFinite(n) && n > 0);
  const rate = (n: number, d: number) => (d > 0 ? (n / d) * 100 : null);

  return {
    leads,
    demos_booked: demosBooked,
    demos_shown: demosShown,
    sales_calls_booked: count('sales_call_booked'),
    sales_calls_shown: count('sales_call_shown'),
    closes,
    cash_collected: cash,
    spam_leads: count('spam_lead'),
    spam_appointments: count('spam_appointment'),
    dials: dials.length,
    pickups,
    speed_to_lead_min: speeds.length ? speeds.reduce((a, b) => a + b, 0) / speeds.length / 60 : null,
    dials_per_lead: leads > 0 ? dials.length / leads : null,
    pickup_pct: rate(pickups, dials.length),
    lead_to_booking_pct: rate(demosBooked, leads),
    show_pct: rate(demosShown, demosBooked),
    close_pct: rate(closes, demosShown),
    kept_demos_by_ad: keptByAd,
  };
}
