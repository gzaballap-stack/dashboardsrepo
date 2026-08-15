// Seeded RNG — same date + client index always produces the same data
function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedForDay(dateStr: string, clientIndex: number) {
  let h = clientIndex * 999983;
  for (let i = 0; i < dateStr.length; i++) {
    h = (Math.imul(31, h) + dateStr.charCodeAt(i)) | 0;
  }
  return mulberry32(h >>> 0);
}

const FIRST_NAMES = [
  'James', 'Mary', 'Robert', 'Patricia', 'John', 'Jennifer', 'Michael', 'Linda',
  'David', 'Barbara', 'William', 'Susan', 'Richard', 'Jessica', 'Joseph', 'Karen',
  'Thomas', 'Sarah', 'Charles', 'Lisa', 'Christopher', 'Nancy', 'Daniel', 'Margaret',
  'Matthew', 'Betty', 'Anthony', 'Sandra', 'Mark', 'Ashley', 'Donald', 'Emily',
  'Steven', 'Donna', 'Paul', 'Carol', 'Andrew', 'Ruth', 'Kenneth', 'Sharon',
  'Brian', 'Michelle', 'George', 'Laura', 'Edward', 'Sarah', 'Ronald', 'Kimberly',
  'Timothy', 'Deborah',
];

const LAST_NAMES = [
  'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis',
  'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Wilson', 'Anderson', 'Thomas',
  'Taylor', 'Moore', 'Jackson', 'Martin', 'Lee', 'Perez', 'Thompson', 'White',
  'Harris', 'Clark', 'Lewis', 'Robinson', 'Walker', 'Young', 'Allen', 'King',
  'Wright', 'Scott', 'Torres', 'Nguyen', 'Hill', 'Adams', 'Baker', 'Rivera',
  'Carter', 'Mitchell', 'Nelson', 'Campbell', 'Roberts', 'Evans', 'Turner',
  'Phillips', 'Parker', 'Collins', 'Stewart',
];

const EMAIL_DOMAINS = ['gmail.com', 'yahoo.com', 'hotmail.com', 'outlook.com', 'icloud.com'];

const CALENDAR_NAMES = [
  'Kitchen Consultation',
  'Bath Renovation Assessment',
  'Home Walkthrough',
  'Design Consultation',
];

const STAGES = ['Day 1 AM', 'Day 1 PM', 'Day 2', 'Day 3', 'Follow-up'];

export interface ClientConfig {
  name: string;
  platforms: { platform: 'meta' | 'google' | 'local_services'; spend_min: number; spend_max: number }[];
  dials_weekday: [number, number];
  dials_weekend: [number, number];
  lead_rate: number;
  appt_rate: number;
  show_rate: number;
  cb_rate: number;
}

// KPI targets (portfolio averages):
//   CPL ≈ $65  |  CP Appt ≈ $140  |  Speed-to-lead ≈ 1.1 min
//   Avg daily spend ≈ $70 (16 regular clients); 1 big client (ProCraft) ≈ $750/day
//   show_rate ≈ 84%  |  CPS ≈ $167  |  CP closed job ≈ $620 at ~27% close rate from shows
//
// All clients run Meta (Facebook) as primary. Some add Google or Local Services Ads.
// lead_rate = spend_avg / (dials_avg × CPL_target).
// Slight underperformers (5): CPL target $73, appt_rate 0.40-0.43, show_rate 0.77-0.81.
export const MOCK_CLIENT_CONFIGS: ClientConfig[] = [
  // ── Performing clients ──────────────────────────────────────────────────────
  {
    name: 'Premier Bath & Kitchen',
    platforms: [{ platform: 'meta', spend_min: 52, spend_max: 80 }],
    dials_weekday: [14, 22],
    dials_weekend: [3, 7],
    lead_rate: 0.056,   // spend≈$66, dials≈18 → CPL≈$65
    appt_rate: 0.48,
    show_rate: 0.86,
    cb_rate: 0.12,
  },
  {
    name: 'Coastal Renovations LLC',
    platforms: [
      { platform: 'meta', spend_min: 40, spend_max: 56 },
      { platform: 'google', spend_min: 20, spend_max: 34 },
    ],
    dials_weekday: [16, 26],
    dials_weekend: [3, 7],
    lead_rate: 0.055,   // spend≈$75, dials≈21 → CPL≈$65
    appt_rate: 0.46,
    show_rate: 0.83,
    cb_rate: 0.10,
  },
  {
    name: 'Heritage Home Remodeling',
    platforms: [
      { platform: 'meta', spend_min: 44, spend_max: 62 },
      { platform: 'local_services', spend_min: 14, spend_max: 26 },
    ],
    dials_weekday: [15, 24],
    dials_weekend: [3, 6],
    lead_rate: 0.058,   // spend≈$73, dials≈19.5 → CPL≈$65
    appt_rate: 0.50,
    show_rate: 0.88,
    cb_rate: 0.13,
  },
  {
    // slight underperformer — CPL ~$73, lower booking & show rates
    name: 'Modern Living Spaces',
    platforms: [{ platform: 'meta', spend_min: 48, spend_max: 76 }],
    dials_weekday: [13, 20],
    dials_weekend: [2, 5],
    lead_rate: 0.051,   // spend≈$62, dials≈16.5 → CPL≈$74
    appt_rate: 0.42,
    show_rate: 0.78,
    cb_rate: 0.09,
  },
  {
    name: 'Elite Kitchen & Bath',
    platforms: [
      { platform: 'meta', spend_min: 38, spend_max: 54 },
      { platform: 'google', spend_min: 24, spend_max: 36 },
    ],
    dials_weekday: [17, 27],
    dials_weekend: [3, 7],
    lead_rate: 0.053,   // spend≈$76, dials≈22 → CPL≈$65
    appt_rate: 0.48,
    show_rate: 0.85,
    cb_rate: 0.11,
  },
  {
    name: 'Prestige Kitchen Designs',
    platforms: [{ platform: 'meta', spend_min: 58, spend_max: 80 }],
    dials_weekday: [16, 25],
    dials_weekend: [3, 7],
    lead_rate: 0.052,   // spend≈$69, dials≈20.5 → CPL≈$65
    appt_rate: 0.52,
    show_rate: 0.90,
    cb_rate: 0.14,
  },
  {
    // Meta added as primary (was Google + LSA only)
    name: 'Diamond Bath Solutions',
    platforms: [
      { platform: 'meta', spend_min: 42, spend_max: 60 },
      { platform: 'local_services', spend_min: 16, spend_max: 28 },
    ],
    dials_weekday: [14, 23],
    dials_weekend: [2, 6],
    lead_rate: 0.061,   // spend≈$73, dials≈18.5 → CPL≈$65
    appt_rate: 0.46,
    show_rate: 0.84,
    cb_rate: 0.10,
  },
  {
    // slight underperformer — CPL ~$74, lower booking & show rates
    name: 'Sunrise Home Renovations',
    platforms: [{ platform: 'meta', spend_min: 46, spend_max: 72 }],
    dials_weekday: [12, 20],
    dials_weekend: [2, 5],
    lead_rate: 0.050,   // spend≈$59, dials≈16 → CPL≈$74
    appt_rate: 0.40,
    show_rate: 0.77,
    cb_rate: 0.08,
  },
  {
    // big spender — only client at ~$750/day
    name: 'ProCraft Remodeling',
    platforms: [
      { platform: 'meta', spend_min: 480, spend_max: 700 },
      { platform: 'google', spend_min: 140, spend_max: 210 },
    ],
    dials_weekday: [80, 120],
    dials_weekend: [14, 28],
    lead_rate: 0.118,   // spend≈$765, dials≈100 → CPL≈$65
    appt_rate: 0.48,
    show_rate: 0.84,
    cb_rate: 0.12,
  },
  {
    name: 'Apex Home Improvements',
    platforms: [
      { platform: 'meta', spend_min: 42, spend_max: 60 },
      { platform: 'local_services', spend_min: 14, spend_max: 26 },
    ],
    dials_weekday: [15, 25],
    dials_weekend: [3, 7],
    lead_rate: 0.055,   // spend≈$71, dials≈20 → CPL≈$65
    appt_rate: 0.44,
    show_rate: 0.82,
    cb_rate: 0.11,
  },
  {
    name: 'BlueSky Renovations',
    platforms: [{ platform: 'meta', spend_min: 52, spend_max: 80 }],
    dials_weekday: [15, 23],
    dials_weekend: [3, 6],
    lead_rate: 0.053,   // spend≈$66, dials≈19 → CPL≈$66
    appt_rate: 0.48,
    show_rate: 0.86,
    cb_rate: 0.11,
  },
  {
    // slight underperformer — CPL ~$73, lower booking & show rates
    name: 'Golden Gate Remodeling',
    platforms: [
      { platform: 'meta', spend_min: 40, spend_max: 58 },
      { platform: 'google', spend_min: 24, spend_max: 36 },
    ],
    dials_weekday: [17, 27],
    dials_weekend: [3, 7],
    lead_rate: 0.049,   // spend≈$79, dials≈22 → CPL≈$74
    appt_rate: 0.41,
    show_rate: 0.79,
    cb_rate: 0.09,
  },
  {
    // Meta added as primary (was Google only)
    name: 'Signature Bath Co',
    platforms: [{ platform: 'meta', spend_min: 54, spend_max: 82 }],
    dials_weekday: [15, 23],
    dials_weekend: [2, 6],
    lead_rate: 0.055,   // spend≈$68, dials≈19 → CPL≈$65
    appt_rate: 0.48,
    show_rate: 0.87,
    cb_rate: 0.12,
  },
  {
    name: 'American Dream Renovations',
    platforms: [
      { platform: 'meta', spend_min: 38, spend_max: 56 },
      { platform: 'google', spend_min: 22, spend_max: 34 },
    ],
    dials_weekday: [17, 27],
    dials_weekend: [3, 7],
    lead_rate: 0.052,   // spend≈$75, dials≈22 → CPL≈$66
    appt_rate: 0.46,
    show_rate: 0.83,
    cb_rate: 0.11,
  },
  {
    // slight underperformer — CPL ~$73, lower booking & show rates
    name: 'Summit Home Solutions',
    platforms: [{ platform: 'meta', spend_min: 50, spend_max: 76 }],
    dials_weekday: [13, 21],
    dials_weekend: [2, 5],
    lead_rate: 0.051,   // spend≈$63, dials≈17 → CPL≈$73
    appt_rate: 0.43,
    show_rate: 0.80,
    cb_rate: 0.10,
  },
  {
    name: 'Craftsman Kitchen Group',
    platforms: [
      { platform: 'meta', spend_min: 44, spend_max: 64 },
      { platform: 'local_services', spend_min: 14, spend_max: 24 },
    ],
    dials_weekday: [15, 25],
    dials_weekend: [3, 6],
    lead_rate: 0.056,   // spend≈$73, dials≈20 → CPL≈$65
    appt_rate: 0.52,
    show_rate: 0.89,
    cb_rate: 0.13,
  },
  {
    // slight underperformer — CPL ~$73, lower booking & show rates
    name: 'Lakeside Renovations',
    platforms: [{ platform: 'meta', spend_min: 46, spend_max: 72 }],
    dials_weekday: [11, 18],
    dials_weekend: [2, 5],
    lead_rate: 0.056,   // spend≈$59, dials≈14.5 → CPL≈$73
    appt_rate: 0.40,
    show_rate: 0.77,
    cb_rate: 0.07,
  },
];

export const MOCK_AGENT_NAMES = [
  'Alex Rivera',
  'Jordan Kim',
  'Sam Patel',
  'Morgan Chen',
  'Taylor Brooks',
  'Casey Nguyen',
];

type RNG = () => number;

function ri(rng: RNG, min: number, max: number) {
  return Math.floor(rng() * (max - min + 1)) + min;
}

function pick<T>(rng: RNG, arr: T[]): T {
  return arr[Math.floor(rng() * arr.length)];
}

function fakePhone(rng: RNG): string {
  return `+1${ri(rng, 200, 999)}${ri(rng, 200, 999)}${ri(rng, 1000, 9999)}`;
}

function businessHourTs(rng: RNG, dateStr: string): string {
  const h = String(ri(rng, 8, 19)).padStart(2, '0');
  const m = String(ri(rng, 0, 59)).padStart(2, '0');
  const s = String(ri(rng, 0, 59)).padStart(2, '0');
  return `${dateStr}T${h}:${m}:${s}Z`;
}

function callDuration(rng: RNG): number {
  const r = rng();
  if (r < 0.44) return ri(rng, 5, 28);       // voicemail / no answer
  if (r < 0.63) return ri(rng, 29, 58);      // quick rejection
  if (r < 0.78) return ri(rng, 60, 118);     // short conversation
  if (r < 0.92) return ri(rng, 121, 295);    // solid conversation
  return ri(rng, 298, 590);                   // long / likely converted
}

export interface MockEvent {
  client_id: string;
  event_type: string;
  occurred_at: string;
  duration_seconds?: number | null;
  is_pickup?: boolean | null;
  is_conversation?: boolean | null;
  speed_to_lead_seconds?: number | null;
  lead_name?: string | null;
  lead_phone?: string | null;
  lead_email?: string | null;
  agent_name?: string | null;
  ghl_contact_id?: string | null;
  scheduled_at?: string | null;
  external_id?: string | null;
  calendar_name?: string | null;
  stage_booked?: string | null;
  direction?: string | null;
  call_status?: string | null;
}

export interface MockSpend {
  client_id: string;
  spend_date: string;
  platform: string;
  amount: number;
}

export function generateDayData(
  dateStr: string,
  clientId: string,
  clientIndex: number,
  config: ClientConfig,
): { events: MockEvent[]; spends: MockSpend[] } {
  const rng = seedForDay(dateStr, clientIndex);
  const dow = new Date(dateStr + 'T12:00:00Z').getUTCDay();
  const isWeekend = dow === 0 || dow === 6;

  const events: MockEvent[] = [];
  const spends: MockSpend[] = [];

  // ── Dials ──────────────────────────────────────────────────────────────────
  const [dMin, dMax] = isWeekend ? config.dials_weekend : config.dials_weekday;
  const numDials = ri(rng, dMin, dMax);

  for (let i = 0; i < numDials; i++) {
    const dur = callDuration(rng);
    events.push({
      client_id: clientId,
      event_type: 'dial',
      occurred_at: businessHourTs(rng, dateStr),
      duration_seconds: dur,
      is_pickup: dur >= 40,
      is_conversation: dur >= 120,
      agent_name: pick(rng, MOCK_AGENT_NAMES),
      ghl_contact_id: `mock-${clientIndex}-${dateStr}-d${i}`,
      direction: 'outbound',
      call_status: dur < 30 ? 'no_answer' : 'completed',
    });
  }

  // ── Leads ──────────────────────────────────────────────────────────────────
  const numLeads = Math.round(numDials * config.lead_rate * (0.82 + rng() * 0.36));

  for (let i = 0; i < numLeads; i++) {
    const first = pick(rng, FIRST_NAMES);
    const last = pick(rng, LAST_NAMES);
    const phone = fakePhone(rng);
    const email = `${first.toLowerCase()}.${last.toLowerCase()}${ri(rng, 1, 99)}@${pick(rng, EMAIL_DOMAINS)}`;
    const cid = `mock-${clientIndex}-${dateStr}-l${i}`;

    events.push({
      client_id: clientId,
      event_type: 'lead',
      occurred_at: businessHourTs(rng, dateStr),
      lead_name: `${first} ${last}`,
      lead_phone: phone,
      lead_email: email,
      ghl_contact_id: cid,
    });

    if (rng() < config.cb_rate) {
      events.push({
        client_id: clientId,
        event_type: 'callback_booked',
        occurred_at: businessHourTs(rng, dateStr),
        lead_name: `${first} ${last}`,
        lead_phone: phone,
        ghl_contact_id: cid,
      });
    }
  }

  // ── Appointments ───────────────────────────────────────────────────────────
  // Per-lead coin flip avoids Math.round collapsing ~1 lead/day to 0 appointments
  let numAppts = 0;
  for (let i = 0; i < numLeads; i++) {
    if (rng() < config.appt_rate * (0.82 + rng() * 0.36)) numAppts++;
  }

  for (let i = 0; i < numAppts; i++) {
    const first = pick(rng, FIRST_NAMES);
    const last = pick(rng, LAST_NAMES);
    const phone = fakePhone(rng);
    const daysAhead = ri(rng, 3, 7);
    const scheduledAt = new Date(dateStr + 'T12:00:00Z');
    scheduledAt.setUTCDate(scheduledAt.getUTCDate() + daysAhead);

    events.push({
      client_id: clientId,
      event_type: 'appointment_booked',
      occurred_at: businessHourTs(rng, dateStr),
      scheduled_at: scheduledAt.toISOString(),
      lead_name: `${first} ${last}`,
      lead_phone: phone,
      external_id: `mock-appt-${clientIndex}-${dateStr}-${i}`,
      calendar_name: pick(rng, CALENDAR_NAMES),
      stage_booked: pick(rng, STAGES),
    });
  }

  // ── Shows / No-Shows ───────────────────────────────────────────────────────
  // Per-appointment coin flip for the same reason as appointments above.
  for (let i = 0; i < numAppts; i++) {
    const first = pick(rng, FIRST_NAMES);
    const last = pick(rng, LAST_NAMES);
    events.push({
      client_id: clientId,
      event_type: rng() < config.show_rate ? 'show' : 'no_show',
      occurred_at: businessHourTs(rng, dateStr),
      lead_name: `${first} ${last}`,
    });
  }

  // ── Ad Spend ───────────────────────────────────────────────────────────────
  // Weekend spend scaled proportionally to weekend/weekday dial ratio so CPL
  // stays consistent across weekdays and weekends.
  const avgWkd = (config.dials_weekday[0] + config.dials_weekday[1]) / 2;
  const avgWkn = (config.dials_weekend[0] + config.dials_weekend[1]) / 2;
  const spendMult = isWeekend ? avgWkn / avgWkd : 1.0;
  for (const p of config.platforms) {
    const raw = p.spend_min + rng() * (p.spend_max - p.spend_min);
    spends.push({
      client_id: clientId,
      spend_date: dateStr,
      platform: p.platform,
      amount: Math.round(raw * spendMult * 100) / 100,
    });
  }

  // ── Speed-to-Lead ──────────────────────────────────────────────────────────
  // Assign response-time readings to the first numLeads dial events.
  // Average ~65 seconds ≈ 1.1 minutes. Objects in dialSample are the same
  // references held in events, so this mutates in place.
  const dialSample = events.filter(e => e.event_type === 'dial');
  for (let i = 0; i < Math.min(numLeads, dialSample.length); i++) {
    dialSample[i].speed_to_lead_seconds = ri(rng, 20, 110);
  }

  return { events, spends };
}
