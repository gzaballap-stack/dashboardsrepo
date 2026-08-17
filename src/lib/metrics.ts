type EventRow = {
  event_type: string;
  is_pickup: boolean | null;
  is_conversation: boolean | null;
  speed_to_lead_seconds: number | null;
  revenue?: number | null;
};

type SpendRow = { amount: number | string; spend_date?: string | null };

// Booked appointments are scheduled 3-7 days out (see mock-generator's daysAhead)
// and don't resolve to a show/no-show until that date arrives. Spend from within
// this window hasn't had a chance to produce a show yet, so it's excluded from
// Cost Per Show — otherwise CPS spikes for any range that includes recent days.
const APPT_MATURITY_DAYS = 7;

export function calculateMetrics(events: EventRow[], spendRows: SpendRow[]) {
  const leads    = events.filter(e => e.event_type === 'lead').length;
  const booked   = events.filter(e => e.event_type === 'appointment_booked').length;
  const shows    = events.filter(e => e.event_type === 'show').length;
  const no_shows = events.filter(e => e.event_type === 'no_show').length;
  const dials    = events.filter(e => e.event_type === 'dial');
  const dial_count = dials.length;
  const pickups      = dials.filter(e => e.is_pickup).length;
  const conversations = dials.filter(e => e.is_conversation).length;
  const callbacks    = events.filter(e => e.event_type === 'callback_booked').length;

  const closes = events.filter(e => e.event_type === 'closed');
  const close_count = closes.length;
  const total_revenue = closes.reduce((sum, e) => sum + (Number(e.revenue) || 0), 0);

  const ad_spend = spendRows.reduce((sum, r) => sum + Number(r.amount), 0);

  const matureCutoff = new Date();
  matureCutoff.setDate(matureCutoff.getDate() - APPT_MATURITY_DAYS);
  const matured_ad_spend = spendRows.reduce((sum, r) => {
    if (!r.spend_date || new Date(r.spend_date) <= matureCutoff) return sum + Number(r.amount);
    return sum;
  }, 0);

  const speedReadings = dials
    .filter(e => e.speed_to_lead_seconds != null)
    .map(e => Number(e.speed_to_lead_seconds));
  const speed_to_lead_min = speedReadings.length > 0
    ? speedReadings.reduce((a, b) => a + b, 0) / speedReadings.length / 60
    : 0;

  return {
    new_leads: leads,
    booked_appointments: booked,
    appt_booking_rate: leads > 0 ? (booked / leads) * 100 : 0,
    appts_to_take_place: Math.max(0, booked - shows - no_shows),
    shows,
    no_shows,
    show_pct: shows + no_shows > 0 ? (shows / (shows + no_shows)) * 100 : 0,
    ad_spend,
    cpl:     leads  > 0 ? ad_spend / leads  : 0,
    cp_appt: booked > 0 ? ad_spend / booked : 0,
    cps:     shows  > 0 ? matured_ad_spend / shows  : 0,
    outbound_dials: dial_count,
    dials_per_lead: leads > 0 ? dial_count / leads : 0,
    pickups,
    pickup_pct: dial_count > 0 ? (pickups / dial_count) * 100 : 0,
    conversations,
    conversation_pct: pickups > 0 ? (conversations / pickups) * 100 : 0,
    callbacks,
    cb_pct: leads > 0 ? (callbacks / leads) * 100 : 0,
    speed_to_lead_min,
    // Revenue KPIs
    closes: close_count,
    total_revenue,
    avg_project_revenue: close_count > 0 ? total_revenue / close_count : 0,
    cost_per_close:      close_count > 0 ? ad_spend / close_count : 0,
    close_rate:          shows > 0 ? (close_count / shows) * 100 : 0,
    // ROI nets a 40% profit margin against spend, rather than raw revenue/spend (ROAS),
    // so it reflects actual return after cost of goods/labor, not gross revenue multiple.
    roi:                 ad_spend > 0 ? (total_revenue * 0.4 - ad_spend) / ad_spend : 0,
  };
}
