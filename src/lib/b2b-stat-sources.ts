// "Where does this number come from?" — one entry per tile on the B2B (Tomsi
// Media) dashboard, keyed by the tile's label.
//
// Each entry says what the stat measures, which system the data originates in,
// the sum behind it using the dashboard's own numbers, and which records to list.
// The record filters mirror lib/metrics.ts (tiles fed by /api/metrics, the
// mirrored `events` rows) and /api/b2b-metrics (`b2b_events`). If a tile's
// definition changes in either place, change its entry here too.

export type SrcEvent = {
  event_type: string; occurred_at: string | null; scheduled_at?: string | null; lead_name?: string | null;
  agent_name?: string | null; is_pickup?: boolean | null; is_conversation?: boolean | null;
  duration_seconds?: number | null; speed_to_lead_seconds?: number | null; call_status?: string | null;
  revenue?: number | null; ghl_contact_id?: string | null; campaign_name?: string | null; ad_id?: string | null; ad_name?: string | null;
  booked_by?: string | null; progress_pct?: number | null;
  external_id?: string | null;
};
export type SrcData = { events: SrcEvent[]; b2b: SrcEvent[]; spend: { spend_date: string; amount: number }[]; excluded_spend: number; ad_names?: Record<string, string> };

// The numbers already on screen — formulas quote these so they always match the tile.
export type StatNumbers = {
  ad_spend: number; leads: number; booked_pending: number; total_booked: number; shows: number; no_shows: number;
  closes: number; revenue: number; cash: number; spam_leads: number; spam_appointments: number;
  dials: number; pickups: number; conversations: number; callbacks: number; speed_to_lead_min: number;
  self_booked: number; team_booked: number; booking_leads: number; non_booking_leads: number; b2b_leads: number;
  landing_visits: number; calendar_visits: number; bookings: number; precall_views: number; vsl_views: number;
};

export type SourceRow = { when: string | null; who: string; detail?: string };
export type SourcePart = { title: string; rows: SourceRow[] };
export type StatSource = {
  what: string;
  origin: string;
  // `d` is the fetched records — null while they load. Only a few formulas need it.
  formula: (n: StatNumbers, d: SrcData | null) => string;
  parts: (d: SrcData) => SourcePart[];
};

const GHL = 'GoHighLevel. Each event is sent to the dashboard the moment it happens.';
const META = 'Meta Ads. Spend is pulled into the dashboard every morning.';
const SITE = 'Your funnel pages. Each page load and video view is tracked on the site and sent to the dashboard.';
const CALLS = 'GoHighLevel call log. Every outbound dial is sent to the dashboard when the call ends.';
const mixed = (...s: string[]) => s.join(' ');

const $ = (n: number) => `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`;
const pct = (num: number, den: number) => (den > 0 ? `${((num / den) * 100).toFixed(1)}%` : '—');
const ratio = (num: number, den: number, dp = 1) => (den > 0 ? (num / den).toFixed(dp) : '—');
const mmss = (s?: number | null) => (s || s === 0 ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : null);
const join = (...bits: (string | null | undefined | false)[]) => bits.filter(Boolean).join(' · ') || undefined;

// ── Record pickers ────────────────────────────────────────────────────────

const ev = (d: SrcData, ...types: string[]) => d.events.filter(e => types.includes(e.event_type));
const bb = (d: SrcData, ...types: string[]) => d.b2b.filter(e => types.includes(e.event_type));

// Page visits and video views carry a contact id but no name — borrow it from that contact's other rows.
function nameIndex(d: SrcData) {
  const m = new Map<string, string>();
  for (const e of [...d.b2b, ...d.events]) if (e.ghl_contact_id && e.lead_name && !m.has(e.ghl_contact_id)) m.set(e.ghl_contact_id, e.lead_name);
  return m;
}
const who = (e: SrcEvent, names?: Map<string, string>, fallback = 'Name not recorded') =>
  e.lead_name || (e.ghl_contact_id && names?.get(e.ghl_contact_id)) || fallback;

const person = (title: string, list: SrcEvent[], detail?: (e: SrcEvent) => string | undefined, names?: Map<string, string>, fallback?: string): SourcePart =>
  ({ title, rows: list.map(e => ({ when: e.occurred_at, who: who(e, names, fallback), detail: detail?.(e) })) });

// Which ad the lead came from. The stored ad_name is often just Meta's numeric id, so look the real name up.
const adOf = (d: SrcData) => (e: SrcEvent) => {
  const named = (e.ad_id && d.ad_names?.[e.ad_id]) || (e.ad_name && d.ad_names?.[e.ad_name]) || (e.ad_name && !/^\d+$/.test(e.ad_name) ? e.ad_name : null);
  if (named) return `Ad: ${named}`;
  return e.ad_id || e.ad_name ? 'From a Meta ad (name not synced yet)' : 'No ad source recorded';
};
const leads = (d: SrcData) => person('Leads', ev(d, 'lead'), adOf(d));
const b2bLeads = (d: SrcData) => person('Leads', bb(d, 'lead'), adOf(d));
const STATUS: Record<string, string> = { appointment_booked: 'Upcoming', show: 'Showed', no_show: 'No-show' };
const demoDetail = (e: SrcEvent) => join(STATUS[e.event_type], e.scheduled_at ? `Scheduled ${new Date(e.scheduled_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : null);
const demos = (d: SrcData) => person('Demos booked', ev(d, 'appointment_booked', 'show', 'no_show'), demoDetail);
const pending = (d: SrcData) => person('Demos still to take place', ev(d, 'appointment_booked'), demoDetail);
const shows = (d: SrcData) => person('Shows', ev(d, 'show'), demoDetail);
const noShows = (d: SrcData) => person('No-shows', ev(d, 'no_show'), demoDetail);
const closes = (d: SrcData) => person('Closes', ev(d, 'closed'), e => (Number(e.revenue) ? $(Number(e.revenue)) : 'No amount recorded'));
const cashRows = (d: SrcData) => person('Closes with cash', bb(d, 'close'), e => (Number(e.revenue) ? $(Number(e.revenue)) : '$0 — no amount recorded'));
const spendRows = (d: SrcData): SourcePart => ({
  title: 'Daily ad spend',
  rows: [
    ...d.spend.map(r => ({ when: `${r.spend_date}T12:00:00`, who: $(r.amount), detail: 'Meta' })),
    ...(d.excluded_spend > 0 ? [{ when: null, who: `− ${$(d.excluded_spend)}`, detail: 'Campaigns you unticked in Campaign Overview' }] : []),
  ],
});
const dialDetail = (e: SrcEvent) => join(e.is_conversation ? 'Conversation' : e.is_pickup ? 'Pickup' : 'No answer', mmss(e.duration_seconds), e.agent_name);
const dials = (d: SrcData, title = 'Outbound dials', f: (e: SrcEvent) => boolean = () => true) => person(title, ev(d, 'dial').filter(f), dialDetail);
const demoBookings = (d: SrcData, by: 'self' | 'team') =>
  person(by === 'self' ? 'Demos the lead booked themselves' : 'Demos booked by your team', bb(d, 'sales_call_booked').filter(e => e.booked_by === by), () => (by === 'self' ? 'Booked via the calendar link' : 'Booked by hand'));
// One row per person: rows with a per-person key are already unique; older rows had no key.
const visits = (d: SrcData, type: string, title: string) => {
  const seen = new Set<string>();
  const list = bb(d, type).filter(e => { if (!e.external_id) return true; if (seen.has(e.external_id)) return false; seen.add(e.external_id); return true; });
  return person(title, list, undefined, nameIndex(d), 'Visitor (not yet a lead)');
};
const demosBooked = (d: SrcData) => person('Demos booked', bb(d, 'sales_call_booked'), e => (e.booked_by === 'team' ? 'Booked by hand' : e.booked_by === 'self' ? 'Booked via the calendar link' : undefined));
const viewerKey = (e: SrcEvent) => e.ghl_contact_id || (e.external_id ? e.external_id.split(':')[1] || null : null);

// One row per contact, at the furthest point they watched.
function watchers(d: SrcData, type: string, title: string, min = 0): SourcePart {
  const names = nameIndex(d);
  const best = new Map<string, SrcEvent>();
  for (const e of bb(d, type)) {
    const key = viewerKey(e);
    if (!key) continue;
    const cur = best.get(key);
    if (!cur || (Number(e.progress_pct) || 0) > (Number(cur.progress_pct) || 0)) best.set(key, e);
  }
  const list = [...best.values()].filter(e => (Number(e.progress_pct) || 0) >= min);
  return person(title, list, e => `Watched ${Number(e.progress_pct) || 0}%`, names, 'Name not recorded');
}
const bookingLeadRows = (d: SrcData, booked: boolean): SourcePart => {
  const bookers = new Set(bb(d, 'sales_call_booked').map(e => e.ghl_contact_id).filter(Boolean));
  const list = bb(d, 'lead').filter(e => (!!e.ghl_contact_id && bookers.has(e.ghl_contact_id)) === booked);
  return person(booked ? 'Leads who booked a demo' : 'Leads who have not booked', list, adOf(d));
};

// ── Catalog ───────────────────────────────────────────────────────────────

const watchStats = (kind: 'Pre-Call' | 'VSL', type: string, views: (n: StatNumbers) => number): Record<string, StatSource> => {
  const video = kind === 'Pre-Call' ? 'pre-call video' : 'VSL';
  const out: Record<string, StatSource> = {
    [`${kind} Views`]: {
      what: `People who started watching the ${video}. Each person counts once, however many times they pressed play.`,
      origin: SITE, formula: n => `${views(n)} people watched`,
      parts: d => [watchers(d, type, 'Viewers')],
    },
    [`${kind} View Rate`]: {
      what: `Of the people who booked a demo, how many watched the ${video}.`,
      origin: SITE, formula: n => `${views(n)} viewers ÷ ${n.bookings} bookings = ${pct(views(n), n.bookings)}`,
      parts: d => [watchers(d, type, 'Viewers'), demosBooked(d)],
    },
  };
  for (const th of [25, 50, 75, 100]) {
    out[`${kind} ${th}%${th === 100 ? '' : '+'}`] = {
      what: `Of the people who booked a demo, how many watched at least ${th}% of the ${video}.`,
      origin: SITE,
      formula: (n, d) => {
        if (!d) return `People who reached ${th}% ÷ ${n.bookings} bookings`;
        const reached = watchers(d, type, '', th).rows.length;
        return `${reached} reached ${th}% ÷ ${n.bookings} bookings = ${pct(reached, n.bookings)}`;
      },
      parts: d => [watchers(d, type, `Watched ${th}%${th === 100 ? '' : ' or more'}`, th), demosBooked(d)],
    };
  }
  return out;
};

export const B2B_STAT_SOURCES: Record<string, StatSource> = {
  // ── Overview ──
  'Ad Spend': {
    what: 'What Meta charged for Tomsi Media ads in this period.',
    origin: META, formula: n => `Each day's spend added up = ${$(n.ad_spend)}`,
    parts: d => [spendRows(d)],
  },
  'Leads': {
    what: 'People who submitted the form and were created as a lead. Fake submissions are not counted.',
    origin: GHL, formula: n => `${n.leads} lead records in this period`,
    parts: d => [leads(d)],
  },
  'Booking Leads': {
    what: 'Leads who also booked a demo in this period.',
    origin: GHL, formula: n => `${n.booking_leads} of ${n.b2b_leads} leads have a demo booking`,
    parts: d => [bookingLeadRows(d, true)],
  },
  'Non-Booking Leads': {
    what: 'Leads who have not booked a demo in this period.',
    origin: GHL, formula: n => `${n.b2b_leads} leads − ${n.booking_leads} who booked = ${n.non_booking_leads}`,
    parts: d => [bookingLeadRows(d, false)],
  },
  'Demos Booked': {
    what: 'Every demo booked in this period, whether it is still upcoming, showed, or no-showed.',
    origin: GHL, formula: n => `${n.booked_pending} upcoming + ${n.shows} showed + ${n.no_shows} no-showed = ${n.total_booked}`,
    parts: d => [demos(d)],
  },
  'Demo Booking Rate': {
    what: 'Share of leads that turned into a booked demo.',
    origin: GHL, formula: n => `${n.total_booked} demos booked ÷ ${n.leads} leads = ${pct(n.total_booked, n.leads)}`,
    parts: d => [demos(d), leads(d)],
  },
  'Demos To Take Place': {
    what: 'Booked demos that have not been marked showed or no-show yet.',
    origin: GHL, formula: n => `${n.total_booked} booked − ${n.shows} showed − ${n.no_shows} no-showed = ${n.booked_pending}`,
    parts: d => [pending(d)],
  },
  'Shows': {
    what: 'Demos where the lead showed up.',
    origin: GHL, formula: n => `${n.shows} demos marked as showed`,
    parts: d => [shows(d)],
  },
  'No Shows': {
    what: 'Demos where the lead did not show up.',
    origin: GHL, formula: n => `${n.no_shows} demos marked as no-show`,
    parts: d => [noShows(d)],
  },
  'Show Rate': {
    what: 'Of the demos that have already happened, how many showed. Upcoming demos are left out.',
    origin: GHL, formula: n => `${n.shows} showed ÷ (${n.shows} showed + ${n.no_shows} no-showed) = ${pct(n.shows, n.shows + n.no_shows)}`,
    parts: d => [shows(d), noShows(d)],
  },
  'CPL': {
    what: 'Cost per lead.',
    origin: mixed('Spend from Meta Ads; leads from GoHighLevel.'), formula: n => `${$(n.ad_spend)} spend ÷ ${n.leads} leads = ${n.leads ? $(n.ad_spend / n.leads) : '—'}`,
    parts: d => [leads(d), spendRows(d)],
  },
  'CP Demo Booked': {
    what: 'Cost per demo booked.',
    origin: mixed('Spend from Meta Ads; demos from GoHighLevel.'), formula: n => `${$(n.ad_spend)} spend ÷ ${n.total_booked} demos booked = ${n.total_booked ? $(n.ad_spend / n.total_booked) : '—'}`,
    parts: d => [demos(d), spendRows(d)],
  },
  'CP Demo Shown': {
    what: 'Cost per demo that actually showed.',
    origin: mixed('Spend from Meta Ads; shows from GoHighLevel.'), formula: n => `${$(n.ad_spend)} spend ÷ ${n.shows} shows = ${n.shows ? $(n.ad_spend / n.shows) : '—'}`,
    parts: d => [shows(d), spendRows(d)],
  },
  'CAC': {
    what: 'Cost to acquire one client.',
    origin: mixed('Spend from Meta Ads; closes from GoHighLevel.'), formula: n => `${$(n.ad_spend)} spend ÷ ${n.closes} closes = ${n.closes ? $(n.ad_spend / n.closes) : '—'}`,
    parts: d => [closes(d), spendRows(d)],
  },
  'Close Rate': {
    what: 'Of the demos that showed, how many closed.',
    origin: GHL, formula: n => `${n.closes} closes ÷ ${n.shows} shows = ${pct(n.closes, n.shows)}`,
    parts: d => [closes(d), shows(d)],
  },
  'Cash Collected': {
    what: 'Money collected from closes in this period.',
    origin: GHL, formula: n => `Amounts on each close added up = ${$(n.cash)}`,
    parts: d => [cashRows(d)],
  },
  'ROAS': {
    what: 'Cash back for every dollar of ad spend.',
    origin: mixed('Cash from GoHighLevel closes; spend from Meta Ads.'), formula: n => `${$(n.cash)} cash ÷ ${$(n.ad_spend)} spend = ${n.ad_spend ? (n.cash / n.ad_spend).toFixed(2) + 'x' : '—'}`,
    parts: d => [cashRows(d), spendRows(d)],
  },
  'ROI': {
    what: 'Return after costs, assuming a 40% profit margin on revenue.',
    origin: mixed('Revenue from GoHighLevel closes; spend from Meta Ads.'),
    formula: n => `(${$(n.revenue)} revenue × 40% margin − ${$(n.ad_spend)} spend) ÷ ${$(n.ad_spend)} spend = ${n.ad_spend ? (((n.revenue * 0.4 - n.ad_spend) / n.ad_spend) * 100).toFixed(0) + '%' : '—'}`,
    parts: d => [closes(d), spendRows(d)],
  },
  'Fake Leads': {
    what: 'Form submissions you marked as fake. They are kept out of every other number.',
    origin: GHL, formula: n => `${n.spam_leads} submissions marked fake`,
    parts: d => [person('Fake leads', ev(d, 'spam_lead'), adOf(d))],
  },
  'Fake Demos': {
    what: 'Demo bookings you marked as fake. They are kept out of every other number.',
    origin: GHL, formula: n => `${n.spam_appointments} bookings marked fake`,
    parts: d => [person('Fake demos', ev(d, 'spam_appointment'), demoDetail)],
  },

  // ── Calling ──
  'Speed To Lead (Min)': {
    what: 'Average minutes between a lead coming in and the first call to them.',
    origin: CALLS, formula: n => (n.speed_to_lead_min > 0 ? `Average across calls that carry a timing = ${n.speed_to_lead_min.toFixed(1)} min` : 'No call in this period carries a speed-to-lead timing, so this shows 0.'),
    parts: d => [person('Calls with a speed-to-lead timing', ev(d, 'dial').filter(e => e.speed_to_lead_seconds != null), e => join(`${(Number(e.speed_to_lead_seconds) / 60).toFixed(1)} min`, e.agent_name))],
  },
  'Outbound Dials': {
    what: 'Every outbound call made to a lead.',
    origin: CALLS, formula: n => `${n.dials} calls logged`,
    parts: d => [dials(d)],
  },
  'Dials Per Lead': {
    what: 'Average number of calls made per lead.',
    origin: CALLS, formula: n => `${n.dials} dials ÷ ${n.leads} leads = ${ratio(n.dials, n.leads)}`,
    parts: d => [dials(d), leads(d)],
  },
  'Pickups (40s+)': {
    what: 'Calls that lasted 40 seconds or more, counted as answered.',
    origin: CALLS, formula: n => `${n.pickups} of ${n.dials} calls ran 40 seconds or longer`,
    parts: d => [dials(d, 'Pickups', e => !!e.is_pickup)],
  },
  'Pick Up Rate': {
    what: 'Share of calls that were answered.',
    origin: CALLS, formula: n => `${n.pickups} pickups ÷ ${n.dials} dials = ${pct(n.pickups, n.dials)}`,
    parts: d => [dials(d, 'Pickups', e => !!e.is_pickup), dials(d, 'All dials')],
  },
  'Conversations (2m+)': {
    what: 'Calls that lasted 2 minutes or more, counted as a real conversation.',
    origin: CALLS, formula: n => `${n.conversations} of ${n.dials} calls ran 2 minutes or longer`,
    parts: d => [dials(d, 'Conversations', e => !!e.is_conversation)],
  },
  'Conversation Rate': {
    what: 'Of the answered calls, how many became a real conversation.',
    origin: CALLS, formula: n => `${n.conversations} conversations ÷ ${n.pickups} pickups = ${pct(n.conversations, n.pickups)}`,
    parts: d => [dials(d, 'Conversations', e => !!e.is_conversation), dials(d, 'Pickups', e => !!e.is_pickup)],
  },
  'Callback Requests': {
    what: 'Leads who asked to be called back.',
    origin: GHL, formula: n => `${n.callbacks} callback requests`,
    parts: d => [person('Callback requests', ev(d, 'callback_booked'), e => e.agent_name ?? undefined)],
  },
  'Callback Rate': {
    what: 'Share of leads who asked for a callback.',
    origin: GHL, formula: n => `${n.callbacks} callbacks ÷ ${n.leads} leads = ${pct(n.callbacks, n.leads)}`,
    parts: d => [person('Callback requests', ev(d, 'callback_booked')), leads(d)],
  },
  'Leads To Call': {
    what: 'Leads that did not book themselves, so someone has to call them.',
    origin: GHL, formula: n => `${n.leads} leads − ${n.self_booked} who booked themselves = ${Math.max(0, n.leads - n.self_booked)}`,
    parts: d => [leads(d), demoBookings(d, 'self')],
  },
  'Hand-Booked Demos': {
    what: 'Demos your team booked by hand, rather than the lead booking through the calendar link.',
    origin: GHL, formula: n => (n.self_booked + n.team_booked > 0 ? `${n.team_booked} demos booked by the team` : 'No demo in this period says who booked it, so this shows —.'),
    parts: d => [demoBookings(d, 'team')],
  },
  'Lead Demo Booking Rate': {
    what: 'Of the leads you had to call, how many you booked.',
    origin: GHL, formula: n => `${n.team_booked} hand-booked ÷ (${n.leads} leads − ${n.self_booked} self-booked) = ${pct(n.team_booked, Math.max(0, n.leads - n.self_booked))}`,
    parts: d => [demoBookings(d, 'team'), demoBookings(d, 'self'), leads(d)],
  },

  // ── Funnel ──
  'Landing Page Visits': {
    what: 'People who opened the landing page. Each person counts once, however many times they reloaded.',
    origin: SITE, formula: n => `${n.landing_visits} people`,
    parts: d => [visits(d, 'visit_landing', 'Landing page visits')],
  },
  'Calendar Page Visits': {
    what: 'People who opened the calendar page. Each person counts once.',
    origin: SITE, formula: n => `${n.calendar_visits} people`,
    parts: d => [visits(d, 'visit_calendar', 'Calendar page visits')],
  },
  'Bookings': {
    what: 'Demos booked, from GoHighLevel. The same number as Demos Booked above.',
    origin: GHL, formula: n => `${n.bookings} demos booked`,
    parts: d => [demosBooked(d)],
  },
  'Landing → Calendar Rate': {
    what: 'Share of landing page visits that went on to the calendar page.',
    origin: SITE, formula: n => `${n.calendar_visits} calendar visits ÷ ${n.landing_visits} landing visits = ${pct(n.calendar_visits, n.landing_visits)}`,
    parts: d => [visits(d, 'visit_calendar', 'Calendar page visits'), visits(d, 'visit_landing', 'Landing page visits')],
  },
  'Calendar → Booking Rate': {
    what: 'Share of calendar page visits that ended in a booking.',
    origin: SITE, formula: n => `${n.bookings} bookings ÷ ${n.calendar_visits} calendar visits = ${pct(n.bookings, n.calendar_visits)}`,
    parts: d => [demosBooked(d), visits(d, 'visit_calendar', 'Calendar page visits')],
  },
  'Landing → Booking Rate': {
    what: 'Share of landing page visits that ended in a booked demo. KPI: never below 5%, aim for 7–8%.',
    origin: SITE, formula: n => `${n.bookings} bookings ÷ ${n.landing_visits} landing visits = ${pct(n.bookings, n.landing_visits)}`,
    parts: d => [demosBooked(d), visits(d, 'visit_landing', 'Landing page visits')],
  },
  'Lead Page Conversion': {
    what: 'Share of landing page visits that became a lead.',
    origin: mixed('Leads from GoHighLevel; visits from your funnel pages.'), formula: n => `${n.b2b_leads} leads ÷ ${n.landing_visits} landing visits = ${pct(n.b2b_leads, n.landing_visits)}`,
    parts: d => [b2bLeads(d), visits(d, 'visit_landing', 'Landing page visits')],
  },
  'Lead Booking Rate': {
    what: 'Share of leads that completed a booking on the page.',
    origin: GHL, formula: n => `${n.bookings} bookings ÷ ${n.b2b_leads} leads = ${pct(n.bookings, n.b2b_leads)}`,
    parts: d => [demosBooked(d), b2bLeads(d)],
  },
  ...watchStats('Pre-Call', 'precall_watch', n => n.precall_views),
  ...watchStats('VSL', 'vsl_watch', n => n.vsl_views),
};
