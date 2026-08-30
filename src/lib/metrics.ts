type EventRow = {
  event_type: string;
  is_pickup: boolean | null;
  is_conversation: boolean | null;
  speed_to_lead_seconds: number | null;
  duration_seconds?: number | null;
  revenue?: number | null;
};

type SpendRow = { amount: number | string };

// excludedSpend is the spend of campaigns opted out per client (see lib/exclusions).
// It is subtracted from the stored ad_spend totals, which have no campaign dimension.
export function calculateMetrics(events: EventRow[], spendRows: SpendRow[], excludedSpend = 0) {
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

  const ad_spend = Math.max(
    0,
    spendRows.reduce((sum, r) => sum + Number(r.amount), 0) - excludedSpend,
  );

  const durations = dials
    .map(e => Number(e.duration_seconds))
    .filter(n => Number.isFinite(n) && n > 0);
  const avg_duration_sec = durations.length > 0
    ? durations.reduce((a, b) => a + b, 0) / durations.length
    : 0;

  const speedReadings = dials
    .filter(e => e.speed_to_lead_seconds != null)
    .map(e => Number(e.speed_to_lead_seconds));
  const speed_to_lead_min = speedReadings.length > 0
    ? speedReadings.reduce((a, b) => a + b, 0) / speedReadings.length / 60
    : 0;

  // Each stage below is derived from the previous one scaled by a resolved-only
  // conversion rate, rather than ad_spend / raw_count directly. Pending appointments
  // and shows never enter these ratios, so a maturation backlog can't distort them,
  // and since every rate is <=1, cpl <= cp_appt <= cps <= cost_per_close is guaranteed
  // by construction. With no pending backlog each still reduces to the naive
  // ad_spend / count for that stage.
  const cp_appt = booked > 0 ? ad_spend / booked : 0;
  const show_rate = shows + no_shows > 0 ? shows / (shows + no_shows) : 0;
  const cps = cp_appt > 0 && show_rate > 0 ? cp_appt / show_rate : 0;
  const close_rate_ratio = shows > 0 ? close_count / shows : 0;
  const cost_per_close = cps > 0 && close_rate_ratio > 0 ? cps / close_rate_ratio : 0;

  return {
    new_leads: leads,
    booked_appointments: booked,
    appt_booking_rate: leads > 0 ? (booked / leads) * 100 : 0,
    appts_to_take_place: Math.max(0, booked - shows - no_shows),
    shows,
    no_shows,
    show_pct: shows + no_shows > 0 ? (shows / (shows + no_shows)) * 100 : 0,
    ad_spend,
    cpl: leads > 0 ? ad_spend / leads : 0,
    cp_appt,
    cps,
    outbound_dials: dial_count,
    dials_per_lead: leads > 0 ? dial_count / leads : 0,
    pickups,
    pickup_pct: dial_count > 0 ? (pickups / dial_count) * 100 : 0,
    conversations,
    conversation_pct: pickups > 0 ? (conversations / pickups) * 100 : 0,
    callbacks,
    cb_pct: leads > 0 ? (callbacks / leads) * 100 : 0,
    speed_to_lead_min,
    avg_duration_sec,
    answer_rate: dial_count > 0 ? (pickups / dial_count) * 100 : 0,
    conversation_rate: dial_count > 0 ? (conversations / dial_count) * 100 : 0,
    // Revenue KPIs
    closes: close_count,
    total_revenue,
    avg_project_revenue: close_count > 0 ? total_revenue / close_count : 0,
    cost_per_close,
    close_rate: close_rate_ratio * 100,
    // ROI nets a 40% profit margin against spend, rather than raw revenue/spend (ROAS),
    // so it reflects actual return after cost of goods/labor, not gross revenue multiple.
    roi:                 ad_spend > 0 ? (total_revenue * 0.4 - ad_spend) / ad_spend : 0,
  };
}
