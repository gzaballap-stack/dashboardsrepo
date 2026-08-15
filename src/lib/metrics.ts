type EventRow = {
  event_type: string;
  is_pickup: boolean | null;
  is_conversation: boolean | null;
  speed_to_lead_seconds: number | null;
};

type SpendRow = { amount: number | string };

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

  const ad_spend = spendRows.reduce((sum, r) => sum + Number(r.amount), 0);

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
    cpl:    leads  > 0 ? ad_spend / leads  : 0,
    cp_appt: booked > 0 ? ad_spend / booked : 0,
    cps:    shows  > 0 ? ad_spend / shows  : 0,
    outbound_dials: dial_count,
    dials_per_lead: leads > 0 ? dial_count / leads : 0,
    pickups,
    pickup_pct: dial_count > 0 ? (pickups / dial_count) * 100 : 0,
    conversations,
    conversation_pct: pickups > 0 ? (conversations / pickups) * 100 : 0,
    callbacks,
    cb_pct: leads > 0 ? (callbacks / leads) * 100 : 0,
    speed_to_lead_min,
  };
}
