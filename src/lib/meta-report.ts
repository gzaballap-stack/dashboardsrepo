// Meta B2B prospecting report — pulls ad-level insights for three date windows
// (30 / 7 / 3 days including today), rolls them up to ad set and campaign,
// evaluates the kill/eval flags on the 7-day window, and renders JSON + Markdown.
//
// Meta supplies spend/impressions/clicks/leads per ad; the dashboard's own data
// (see b2b-funnel.ts) supplies the GHL side — bookings, kept demos, closes,
// cash, calling stats — for the account summary. Per-ad kept demos come from
// GHL attribution when it exists, otherwise from the "Schedule Kept" custom
// conversion in Meta. Consumed by /api/meta-b2b-report (the TM Dashboard's download button).

import type { FunnelStats } from './b2b-funnel';

const GRAPH = 'https://graph.facebook.com/v19.0';
export const DEFAULT_ACCOUNT = 'act_1080664784142903';

export const WINDOWS = [30, 7, 3] as const;
export type WindowDays = (typeof WINDOWS)[number];
export const FLAG_WINDOW: WindowDays = 7;

// ── Thresholds (per the report spec) ─────────────────────────────────────
export const RULES = {
  evalFloorSpend: 90,
  evalFloorImpressions: 1000,
  zeroDemoKillSpend: 135,
  ctrHalfControl: 0.5,
  earlyCtrTrashImpressions: 250,
  earlyCtrTrash: 0.25,
  perfVsControlSpend: 180,
  perfVsControlMultiple: 1.3,
} as const;

// Funnel KPI: landing page → booking rate. Never below the floor; aim for the target band.
export const LANDING_TO_BOOKING_KPI = { floorPct: 5, targetLowPct: 7, targetHighPct: 8 } as const;

export type Metrics = {
  spend: number;
  impressions: number;
  link_clicks: number;
  ctr_link: number | null;          // link clicks / impressions, as a percentage
  cpc_link: number | null;
  leads: number;
  cost_per_lead: number | null;
  kept_demos: number;
  cost_per_kept_demo: number | null;
  cpm: number | null;
};

// The two demo-based flags are null when no per-ad kept-demo source exists
// (no GHL ad attribution and no Meta "Schedule Kept" conversion) — a 0 there
// would read as a kill verdict when it is really missing data.
export type Flags = {
  over_eval_floor: boolean;
  zero_demo_kill: boolean | null;
  ctr_half_control: boolean;
  early_ctr_trash: boolean;
  perf_vs_control_bad: boolean | null;
};

export type Creative = {
  format: string | null;        // Video / Image / Carousel / …
  headline: string | null;
  primary_text: string | null;
  description: string;          // one-line "format + angle" for the creative map
};

export type AdRow = {
  campaign_id: string;
  campaign_name: string;
  adset_id: string;
  adset_name: string;
  ad_id: string;
  ad_name: string;
  creative_type: string;        // tag parsed from the ad name (UGC / VO / Static / …)
  creative: Creative;
  status: string | null;
  first_served: string | null;
  status_history: StatusEvent[];   // created / first delivery / turned on / turned off, oldest first
  windows: Record<WindowDays, Metrics>;
  flags: Flags;
};

// One entry in an ad's (or ad set's / campaign's) on-off timeline, from Meta's activity log.
export type StatusEvent = {
  at: string;                 // ISO timestamp (UTC)
  local: string;              // same moment in the report timezone, human-readable
  event: 'created' | 'first_delivery' | 'on' | 'off';
  detail: string | null;      // e.g. "Deleted", "switched off before going live"
  actor: string | null;
};

export type ParentStatusChange = StatusEvent & { level: 'ad set' | 'campaign'; id: string; name: string };

export type RollupRow = {
  id: string;
  name: string;
  campaign_name?: string;
  windows: Record<WindowDays, Metrics>;
};

export type MetaReport = {
  generated_at: string;
  today: string;
  timezone: string;
  account_id: string;
  campaign_filter: string[] | null;
  kept_demo_source: 'ghl' | 'meta' | 'none';
  kept_demo_action_type: string | null;
  flag_window_days: WindowDays;
  control: {
    best_ctr_link_7d: number | null;
    best_ctr_ad_id: string | null;
    best_cost_per_kept_demo_7d: number | null;
    best_cpki_ad_id: string | null;
  };
  windows: Record<WindowDays, { since: string; until: string }>;
  previous_7d: { since: string; until: string; totals: Metrics };
  totals: Record<WindowDays, Metrics>;          // Meta totals
  funnel: Record<WindowDays, FunnelStats> | null; // GHL / dashboard side
  summary: string[];
  ads: AdRow[];
  adsets: RollupRow[];
  campaigns: RollupRow[];
  // On/off changes at ad set and campaign level (these switch every ad underneath them).
  parent_status_changes: ParentStatusChange[];
  status_history_available: boolean;
  status_history_since: string | null;
  kpi_targets: { landing_to_booking: typeof LANDING_TO_BOOKING_KPI };
  rules: typeof RULES;
};

type RawInsight = {
  campaign_id?: string; campaign_name?: string;
  adset_id?: string; adset_name?: string;
  ad_id?: string; ad_name?: string;
  spend?: string; impressions?: string; inline_link_clicks?: string;
  actions?: { action_type: string; value: string }[];
};

// ── Helpers ───────────────────────────────────────────────────────────────

const ymd = (d: Date, tz: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);

const shiftDays = (dateStr: string, days: number) => {
  const d = new Date(dateStr + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

const div = (a: number, b: number) => (b > 0 ? a / b : null);

export function emptyMetrics(): Metrics {
  return {
    spend: 0, impressions: 0, link_clicks: 0, ctr_link: null, cpc_link: null,
    leads: 0, cost_per_lead: null, kept_demos: 0, cost_per_kept_demo: null, cpm: null,
  };
}

function finalize(m: Metrics): Metrics {
  m.ctr_link = m.impressions > 0 ? (m.link_clicks / m.impressions) * 100 : null;
  m.cpc_link = div(m.spend, m.link_clicks);
  m.cost_per_lead = div(m.spend, m.leads);
  m.cost_per_kept_demo = div(m.spend, m.kept_demos);
  m.cpm = m.impressions > 0 ? (m.spend / m.impressions) * 1000 : null;
  return m;
}

function add(into: Metrics, m: Metrics) {
  into.spend += m.spend;
  into.impressions += m.impressions;
  into.link_clicks += m.link_clicks;
  into.leads += m.leads;
  into.kept_demos += m.kept_demos;
}

const LEAD_TOTAL = 'lead';
const LEAD_PARTS = ['offsite_conversion.fb_pixel_lead', 'onsite_conversion.lead_grouped', 'leadgen_grouped'];

function leadsFrom(actions: RawInsight['actions']): number {
  if (!actions?.length) return 0;
  const total = actions.find(a => a.action_type === LEAD_TOTAL);
  if (total) return parseInt(total.value, 10) || 0;
  return actions.filter(a => LEAD_PARTS.includes(a.action_type))
    .reduce((s, a) => s + (parseInt(a.value, 10) || 0), 0);
}

function keptFrom(actions: RawInsight['actions'], keptType: string | null): number {
  if (!actions?.length || !keptType) return 0;
  return actions.filter(a => a.action_type === keptType)
    .reduce((s, a) => s + (parseInt(a.value, 10) || 0), 0);
}

export function creativeType(adName: string): string {
  const n = adName.toUpperCase();
  if (/\bUGC\b/.test(n)) return 'UGC';
  if (/\bVO\b|VOICE ?OVER/.test(n)) return 'VO';
  if (/CAROUSEL/.test(n)) return 'Carousel';
  if (/STATIC|IMAGE|IMG/.test(n)) return 'Static';
  if (/VIDEO|VID\b|REEL/.test(n)) return 'Video';
  if (/\bAI\b/.test(n)) return 'AI';
  return '—';
}

// ── Meta fetching ─────────────────────────────────────────────────────────

async function graphGet<T>(path: string, params: Record<string, string>, token: string): Promise<T[]> {
  const out: T[] = [];
  let url: string | null = `${GRAPH}${path}?${new URLSearchParams({ ...params, limit: '500', access_token: token })}`;
  let guard = 0;
  while (url && guard++ < 20) {
    const res: Response = await fetch(url);
    const json = await res.json() as { data?: T[]; paging?: { next?: string }; error?: { message: string; code?: number } };
    if (json.error) throw new Error(`Meta API: ${json.error.message}`);
    out.push(...(json.data ?? []));
    url = json.paging?.next ?? null;
  }
  return out;
}

async function fetchInsights(acct: string, token: string, since: string, until: string): Promise<RawInsight[]> {
  return graphGet<RawInsight>(`/${acct}/insights`, {
    level: 'ad',
    fields: 'campaign_id,campaign_name,adset_id,adset_name,ad_id,ad_name,spend,impressions,inline_link_clicks,actions',
    time_range: JSON.stringify({ since, until }),
    action_attribution_windows: JSON.stringify(['7d_click', '1d_view']),
  }, token);
}

async function findKeptDemoType(acct: string, token: string): Promise<string | null> {
  const override = (process.env.META_KEPT_DEMO_EVENT ?? process.env.META_KEPT_INTRO_EVENT)?.trim();
  if (override && override.includes('.')) return override; // full action_type given
  const wanted = (override || 'schedule kept').toLowerCase();
  try {
    const list = await graphGet<{ id: string; name: string }>(`/${acct}/customconversions`, { fields: 'id,name' }, token);
    const hit = list.find(c => c.name.toLowerCase() === wanted) ?? list.find(c => c.name.toLowerCase().includes(wanted));
    return hit ? `offsite_conversion.custom.${hit.id}` : null;
  } catch {
    return null;
  }
}

type RawCreative = {
  object_type?: string;
  title?: string;
  body?: string;
  object_story_spec?: {
    video_data?: { message?: string; title?: string; link_description?: string };
    link_data?: { message?: string; name?: string; description?: string; child_attachments?: unknown[] };
    photo_data?: { caption?: string };
  };
  asset_feed_spec?: {
    bodies?: { text?: string }[];
    titles?: { text?: string }[];
    videos?: unknown[];
    images?: unknown[];
  };
};
type AdEntity = { id: string; created_time?: string; effective_status?: string; creative?: RawCreative };

const clip = (s: string | null | undefined, n: number) => {
  if (!s) return null;
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n - 1) + '…' : t;
};

export function describeCreative(c: RawCreative | undefined): Creative {
  if (!c) return { format: null, headline: null, primary_text: null, description: 'No creative details available from Meta.' };
  const oss = c.object_story_spec;
  const afs = c.asset_feed_spec;
  let format: string | null = null;
  if (oss?.link_data?.child_attachments?.length) format = 'Carousel';
  else if (oss?.video_data || afs?.videos?.length || c.object_type === 'VIDEO') format = 'Video';
  else if (oss?.photo_data || afs?.images?.length || c.object_type === 'PHOTO') format = 'Image';
  else if (oss?.link_data) format = 'Image/link';
  else if (c.object_type) format = c.object_type.charAt(0) + c.object_type.slice(1).toLowerCase();
  if (afs && ((afs.bodies?.length ?? 0) > 1 || (afs.titles?.length ?? 0) > 1)) format = `${format ?? 'Dynamic'} (dynamic, ${afs.bodies?.length ?? 1} texts / ${afs.titles?.length ?? 1} headlines)`;

  const headline = clip(c.title ?? oss?.link_data?.name ?? oss?.video_data?.title ?? afs?.titles?.[0]?.text, 120);
  const primary = clip(c.body ?? oss?.link_data?.message ?? oss?.video_data?.message ?? oss?.photo_data?.caption ?? afs?.bodies?.[0]?.text, 220);
  const bits = [format, headline ? `headline: "${headline}"` : null, primary ? `text: "${primary}"` : null].filter(Boolean);
  return { format, headline, primary_text: primary, description: bits.length ? bits.join(' · ') : 'No creative details available from Meta.' };
}

async function fetchAdEntities(acct: string, token: string): Promise<Map<string, AdEntity>> {
  const map = new Map<string, AdEntity>();
  const fields = 'id,created_time,effective_status,creative{object_type,title,body,object_story_spec,asset_feed_spec}';
  try {
    const list = await graphGet<AdEntity>(`/${acct}/ads`, { fields }, token);
    for (const a of list) map.set(a.id, a);
  } catch {
    // Creative fields can be refused on some ad types — retry without them.
    try {
      const list = await graphGet<AdEntity>(`/${acct}/ads`, { fields: 'id,created_time,effective_status' }, token);
      for (const a of list) map.set(a.id, a);
    } catch { /* first_served / status / creative stay null */ }
  }
  return map;
}

// ── On/off history (Meta activity log) ────────────────────────────────────

type RawActivity = {
  event_time?: string; event_type?: string; object_id?: string; object_name?: string;
  extra_data?: string | Record<string, unknown>; actor_name?: string;
};

const ACTIVITY_LOOKBACK_DAYS = 180;

async function fetchActivities(acct: string, token: string): Promise<RawActivity[] | null> {
  const until = Math.floor(Date.now() / 1000);
  const since = until - ACTIVITY_LOOKBACK_DAYS * 86400;
  try {
    return await graphGet<RawActivity>(`/${acct}/activities`, {
      fields: 'event_time,event_type,object_id,object_name,extra_data,actor_name',
      since: String(since), until: String(until),
    }, token);
  } catch {
    return null; // token without activity-log access — the section says so rather than failing the report
  }
}

const STATUS_EVENT_TYPES: Record<string, 'ad' | 'ad set' | 'campaign'> = {
  update_ad_run_status: 'ad',
  update_ad_set_run_status: 'ad set',
  update_campaign_run_status: 'campaign',
};

// Meta logs a switch as several steps (Active → Pending process → Inactive). Only the
// settled states matter: reaching Active is "on", reaching anything non-pending else is "off".
export function buildStatusTimelines(activities: RawActivity[], tz: string) {
  const fmt = new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' });
  const sorted = [...activities].filter(a => a.event_time && a.object_id)
    .sort((a, b) => new Date(a.event_time!).getTime() - new Date(b.event_time!).getTime());

  const byObject = new Map<string, { level: 'ad' | 'ad set' | 'campaign'; name: string; events: StatusEvent[] }>();
  const settled = new Map<string, 'on' | 'off'>();

  for (const a of sorted) {
    const id = a.object_id!;
    const when = new Date(a.event_time!);
    const base = { at: when.toISOString(), local: fmt.format(when), actor: a.actor_name && a.actor_name !== 'Meta' ? a.actor_name : null };
    const level = STATUS_EVENT_TYPES[a.event_type ?? ''];
    const entry = byObject.get(id) ?? { level: level ?? 'ad', name: a.object_name ?? '', events: [] };
    if (level) entry.level = level;
    if (a.object_name) entry.name = a.object_name;

    if (a.event_type === 'create_ad') {
      entry.events.push({ ...base, event: 'created', detail: null });
    } else if (a.event_type === 'first_delivery_event') {
      entry.events.push({ ...base, event: 'first_delivery', detail: null });
    } else if (level) {
      let extra: Record<string, unknown> = {};
      try { extra = typeof a.extra_data === 'string' ? JSON.parse(a.extra_data) : (a.extra_data ?? {}); } catch { /* unreadable step — skip */ }
      const next = String(extra.new_value ?? '');
      if (!next || /pending/i.test(next)) { byObject.set(id, entry); continue; }
      const prev = settled.get(id);
      if (/^active$/i.test(next)) {
        if (prev !== 'on') entry.events.push({ ...base, event: 'on', detail: null });
        settled.set(id, 'on');
      } else {
        if (prev !== 'off') {
          entry.events.push({ ...base, event: 'off', detail: /^inactive$/i.test(next) ? (prev === 'on' ? null : 'switched off before it went live') : next });
        }
        settled.set(id, 'off');
      }
    } else {
      continue;
    }
    byObject.set(id, entry);
  }
  return byObject;
}

// ── Build ─────────────────────────────────────────────────────────────────

export type BuildOptions = {
  token: string;
  accountId?: string;
  campaigns?: string[] | null;     // exact campaign names; null/empty = all
  timezone?: string;
  now?: Date;
  // Dashboard-side numbers for a window; omitted = Meta-only report.
  funnelFor?: (since: string, until: string, tz: string) => Promise<FunnelStats>;
};

export async function buildMetaReport(opts: BuildOptions): Promise<MetaReport> {
  const tz = opts.timezone ?? process.env.REPORT_TIMEZONE ?? 'America/New_York';
  const acct = opts.accountId ?? process.env.META_B2B_ACCOUNT_ID ?? DEFAULT_ACCOUNT;
  const today = ymd(opts.now ?? new Date(), tz);

  const filterNames = (opts.campaigns ?? []).map(s => s.trim()).filter(Boolean);
  const filter = filterNames.length ? new Set(filterNames.map(s => s.toLowerCase())) : null;

  const windows = Object.fromEntries(
    WINDOWS.map(d => [d, { since: shiftDays(today, -(d - 1)), until: today }]),
  ) as Record<WindowDays, { since: string; until: string }>;
  const prev7 = { since: shiftDays(today, -13), until: shiftDays(today, -7) };

  const funnelPromise = opts.funnelFor
    ? Promise.all(WINDOWS.map(w => opts.funnelFor!(windows[w].since, windows[w].until, tz)))
        .then(list => Object.fromEntries(WINDOWS.map((w, i) => [w, list[i]])) as Record<WindowDays, FunnelStats>)
    : Promise.resolve(null);

  const [keptType, entities, activities, raw30, raw7, raw3, rawPrev, funnel] = await Promise.all([
    findKeptDemoType(acct, opts.token),
    fetchAdEntities(acct, opts.token),
    fetchActivities(acct, opts.token),
    fetchInsights(acct, opts.token, windows[30].since, windows[30].until),
    fetchInsights(acct, opts.token, windows[7].since, windows[7].until),
    fetchInsights(acct, opts.token, windows[3].since, windows[3].until),
    fetchInsights(acct, opts.token, prev7.since, prev7.until),
    funnelPromise,
  ]);

  // Kept demos per ad: GHL attribution when any exists in the 30-day window, else Meta's custom conversion.
  const ghlHasAttribution = !!funnel && Object.keys(funnel[30].kept_demos_by_ad).length > 0;
  const keptSource: MetaReport['kept_demo_source'] = ghlHasAttribution ? 'ghl' : keptType ? 'meta' : 'none';

  const toMetrics = (r: RawInsight, w?: WindowDays): Metrics => finalize({
    ...emptyMetrics(),
    spend: parseFloat(r.spend ?? '0') || 0,
    impressions: parseInt(r.impressions ?? '0', 10) || 0,
    link_clicks: parseInt(r.inline_link_clicks ?? '0', 10) || 0,
    leads: leadsFrom(r.actions),
    kept_demos: ghlHasAttribution && w && r.ad_id
      ? (funnel![w].kept_demos_by_ad[r.ad_id] ?? 0)
      : keptFrom(r.actions, keptType),
  });

  const inFilter = (r: RawInsight) => !filter || filter.has((r.campaign_name ?? '').toLowerCase());

  const timelines = buildStatusTimelines(activities ?? [], tz);

  // Ads = anything that served in the 30-day window.
  const ads = new Map<string, AdRow>();
  for (const r of raw30.filter(inFilter)) {
    if (!r.ad_id) continue;
    const ent = entities.get(r.ad_id);
    ads.set(r.ad_id, {
      campaign_id: r.campaign_id ?? '', campaign_name: r.campaign_name ?? '',
      adset_id: r.adset_id ?? '', adset_name: r.adset_name ?? '',
      ad_id: r.ad_id, ad_name: r.ad_name ?? '',
      creative_type: creativeType(r.ad_name ?? ''),
      creative: describeCreative(ent?.creative),
      status: ent?.effective_status ?? null,
      first_served: ent?.created_time ? ent.created_time.slice(0, 10) : null,
      status_history: timelines.get(r.ad_id)?.events ?? [],
      windows: { 30: toMetrics(r, 30), 7: emptyMetrics(), 3: emptyMetrics() },
      flags: { over_eval_floor: false, zero_demo_kill: false, ctr_half_control: false, early_ctr_trash: false, perf_vs_control_bad: false },
    });
  }
  for (const r of raw7) { const a = r.ad_id && ads.get(r.ad_id); if (a) a.windows[7] = toMetrics(r, 7); }
  for (const r of raw3) { const a = r.ad_id && ads.get(r.ad_id); if (a) a.windows[3] = toMetrics(r, 3); }

  const adList = [...ads.values()].sort((a, b) =>
    a.campaign_name.localeCompare(b.campaign_name) || a.adset_name.localeCompare(b.adset_name) || b.windows[7].spend - a.windows[7].spend);

  // ── Controls (best ad in last 7 days) ──
  const eligible7 = adList.filter(a => a.windows[7].impressions >= RULES.earlyCtrTrashImpressions);
  const bestCtr = eligible7.reduce<AdRow | null>((best, a) =>
    (a.windows[7].ctr_link ?? -1) > (best?.windows[7].ctr_link ?? -1) ? a : best, null);
  const withDemos7 = adList.filter(a => a.windows[7].kept_demos > 0);
  const bestCpki = withDemos7.reduce<AdRow | null>((best, a) =>
    (a.windows[7].cost_per_kept_demo ?? Infinity) < (best?.windows[7].cost_per_kept_demo ?? Infinity) ? a : best, null);

  const control = {
    best_ctr_link_7d: bestCtr?.windows[7].ctr_link ?? null,
    best_ctr_ad_id: bestCtr?.ad_id ?? null,
    best_cost_per_kept_demo_7d: bestCpki?.windows[7].cost_per_kept_demo ?? null,
    best_cpki_ad_id: bestCpki?.ad_id ?? null,
  };

  // ── Flags (7-day window) ──
  for (const a of adList) {
    const m = a.windows[FLAG_WINDOW];
    const ctr = m.ctr_link ?? 0;
    const bestC = control.best_ctr_link_7d;
    const bestK = control.best_cost_per_kept_demo_7d;
    a.flags = {
      over_eval_floor: m.spend >= RULES.evalFloorSpend || m.impressions >= RULES.evalFloorImpressions,
      zero_demo_kill: keptSource === 'none' ? null : m.spend >= RULES.zeroDemoKillSpend && m.kept_demos === 0,
      ctr_half_control: bestC != null && m.impressions > 0 && ctr < bestC * RULES.ctrHalfControl,
      early_ctr_trash: bestC != null && m.impressions >= RULES.earlyCtrTrashImpressions && ctr < bestC * RULES.earlyCtrTrash,
      perf_vs_control_bad: keptSource === 'none' ? null : bestK != null && m.spend >= RULES.perfVsControlSpend
        && (m.cost_per_kept_demo == null || m.cost_per_kept_demo >= bestK * RULES.perfVsControlMultiple),
    };
  }

  // ── Roll-ups ──
  const rollup = (key: (a: AdRow) => { id: string; name: string; campaign_name?: string }) => {
    const map = new Map<string, RollupRow>();
    for (const a of adList) {
      const k = key(a);
      let row = map.get(k.id);
      if (!row) { row = { ...k, windows: { 30: emptyMetrics(), 7: emptyMetrics(), 3: emptyMetrics() } }; map.set(k.id, row); }
      for (const w of WINDOWS) add(row.windows[w], a.windows[w]);
    }
    for (const row of map.values()) for (const w of WINDOWS) finalize(row.windows[w]);
    return [...map.values()];
  };
  const adsets = rollup(a => ({ id: a.adset_id, name: a.adset_name, campaign_name: a.campaign_name }));
  const campaigns = rollup(a => ({ id: a.campaign_id, name: a.campaign_name }));

  const totals = { 30: emptyMetrics(), 7: emptyMetrics(), 3: emptyMetrics() } as Record<WindowDays, Metrics>;
  for (const a of adList) for (const w of WINDOWS) add(totals[w], a.windows[w]);
  for (const w of WINDOWS) finalize(totals[w]);

  const prevTotals = emptyMetrics();
  for (const r of rawPrev.filter(inFilter)) add(prevTotals, toMetrics(r));
  finalize(prevTotals);

  // Ad set / campaign switches for the ad sets and campaigns in this report.
  const parentIds = new Set([...adList.map(a => a.adset_id), ...adList.map(a => a.campaign_id)]);
  const parentChanges: ParentStatusChange[] = [];
  for (const [id, t] of timelines) {
    if (t.level === 'ad' || !parentIds.has(id)) continue;
    for (const e of t.events) if (e.event === 'on' || e.event === 'off') parentChanges.push({ ...e, level: t.level, id, name: t.name });
  }
  parentChanges.sort((a, b) => a.at.localeCompare(b.at));

  const report: MetaReport = {
    generated_at: new Date().toISOString(),
    today, timezone: tz, account_id: acct,
    campaign_filter: filter ? filterNames : null,
    kept_demo_source: keptSource,
    kept_demo_action_type: keptType,
    flag_window_days: FLAG_WINDOW,
    control,
    windows,
    previous_7d: { ...prev7, totals: prevTotals },
    totals,
    funnel,
    summary: [],
    ads: adList, adsets, campaigns,
    parent_status_changes: parentChanges,
    status_history_available: activities != null,
    status_history_since: activities != null ? shiftDays(today, -ACTIVITY_LOOKBACK_DAYS) : null,
    kpi_targets: { landing_to_booking: LANDING_TO_BOOKING_KPI },
    rules: RULES,
  };
  report.summary = summarise(report);
  return report;
}

// ── Formatting ────────────────────────────────────────────────────────────

const money = (n: number | null | undefined, dp = 2) => n == null ? '—' : `$${n.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
const money0 = (n: number | null | undefined) => money(n, 0);
const pct = (n: number | null | undefined, dp = 1) => n == null ? '—' : `${n.toFixed(dp)}%`;
const int = (n: number) => n.toLocaleString('en-US');
const x = (n: number | null | undefined) => n == null ? '—' : `${n.toFixed(1)}x`;
const delta = (now: number | null, prev: number | null, invert = false) => {
  if (now == null || prev == null || prev === 0) return '';
  const ch = ((now - prev) / prev) * 100;
  const good = invert ? ch < 0 : ch > 0;
  return ` (${ch >= 0 ? '+' : ''}${ch.toFixed(0)}% vs prior 7d${Math.abs(ch) >= 10 ? (good ? ' ✅' : ' ⚠️') : ''})`;
};

// Summary bullets for the Slack message (deterministic — same inputs, same words).
export function summarise(r: MetaReport): string[] {
  const t = r.totals[7], p = r.previous_7d.totals;
  const f = r.funnel?.[7];
  const out: string[] = [];
  out.push(`Spend last 7d: ${money(t.spend)}${delta(t.spend, p.spend)} across ${r.ads.filter(a => a.windows[7].impressions > 0).length} ads.`);
  if (f) {
    out.push(`GHL: ${int(f.leads)} leads (CPL ${money(div(t.spend, f.leads))}) → ${int(f.demos_booked)} booked → ${int(f.demos_shown)} kept (${money(div(t.spend, f.demos_shown))} each) → ${int(f.closes)} closed · cash ${money0(f.cash_collected)} (ROAS ${x(div(f.cash_collected, t.spend))}).`);
    out.push(`Calling: speed to lead ${f.speed_to_lead_min == null ? '—' : f.speed_to_lead_min.toFixed(1) + ' min'} · ${f.dials_per_lead == null ? '—' : f.dials_per_lead.toFixed(1)} dials/lead · pickup ${pct(f.pickup_pct, 0)} · show ${pct(f.show_pct, 0)} · close ${pct(f.close_pct, 0)}.`);
  } else {
    out.push(`Meta leads: ${int(t.leads)} at ${money(t.cost_per_lead)} CPL${delta(t.cost_per_lead, p.cost_per_lead, true)}.`);
  }
  out.push(`Link CTR ${pct(t.ctr_link, 2)}${delta(t.ctr_link, p.ctr_link)} · CPC ${money(t.cpc_link)} · CPM ${money(t.cpm)}.`);

  const kills = r.ads.filter(a => a.flags.zero_demo_kill === true || a.flags.early_ctr_trash || a.flags.perf_vs_control_bad === true);
  const best = r.ads.find(a => a.ad_id === r.control.best_cpki_ad_id) ?? r.ads.find(a => a.ad_id === r.control.best_ctr_ad_id);
  if (best) out.push(`Control: "${best.ad_name}" — ${pct(best.windows[7].ctr_link, 2)} link CTR, ${money(best.windows[7].cost_per_kept_demo)} per kept demo (7d).`);
  out.push(kills.length
    ? `${kills.length} ad${kills.length === 1 ? '' : 's'} hit a kill flag: ${kills.slice(0, 5).map(a => `"${a.ad_name}"`).join(', ')}${kills.length > 5 ? '…' : ''}.`
    : 'No ads hit a kill flag this run.');
  if (r.kept_demo_source === 'none') out.push('⚠️ No per-ad kept-demo source: no GHL ad attribution yet and no "Schedule Kept" custom conversion on the ad account — per-ad kept demos show 0.');
  return out;
}

// Account / funnel summary block for one window, in the paste-ready format.
// Landing page → booking rate against its KPI (floor 5%, target 7–8%).
export function landingLine(f: FunnelStats): string {
  const k = LANDING_TO_BOOKING_KPI;
  const kpi = `KPI: never below ${k.floorPct}%, target ${k.targetLowPct}–${k.targetHighPct}%`;
  if (!f.landing_visits) return `Landing page → booking: — (no landing-page visits tracked in this window · ${kpi})`;
  const p = f.landing_to_booking_pct ?? 0;
  const status = p < k.floorPct ? 'BELOW FLOOR' : p < k.targetLowPct ? 'ABOVE FLOOR, BELOW TARGET' : 'ON TARGET';
  return `Landing page → booking: ${pct(p, 1)} (${int(f.page_bookings)} bookings / ${int(f.landing_visits)} landing-page visits) — ${status} · ${kpi}` +
    (f.landing_tracked_since ? ` · visits tracked from ${f.landing_tracked_since}` : '');
}

export function accountSummary(r: MetaReport, w: WindowDays): string {
  const t = r.totals[w];
  const f = r.funnel?.[w];
  const lines = [`ACCOUNT SUMMARY — Window: Last ${w} days (${r.windows[w].since} → ${r.windows[w].until})`];
  if (!f) {
    lines.push(`Ad spend: ${money0(t.spend)}`, `Leads (Meta): ${int(t.leads)} (CPL ${money(t.cost_per_lead)})`,
      `Kept demos (Meta): ${int(t.kept_demos)} (Cost per kept demo ${money(t.cost_per_kept_demo)})`,
      'GHL funnel data not connected for this run.');
    return lines.join('\n');
  }
  lines.push(`Ad spend: ${money0(t.spend)}`);
  lines.push(`Leads: ${int(f.leads)} (CPL ${money(div(t.spend, f.leads))})${t.leads !== f.leads ? ` · Meta-reported leads: ${int(t.leads)}` : ''}`);
  lines.push(`Bookings: ${int(f.demos_booked)} (Lead→Booking ${pct(f.lead_to_booking_pct, 0)} · Cost per booked demo ${money(div(t.spend, f.demos_booked))})`);
  lines.push(landingLine(f));
  lines.push(`Kept demos: ${int(f.demos_shown)} (Cost per kept demo ${money(div(t.spend, f.demos_shown))})`);
  if (f.spam_leads || f.spam_appointments) lines.push(`Fake submissions excluded: ${int(f.spam_leads)} leads, ${int(f.spam_appointments)} demos (Meta still counts these)`);
  lines.push(`Sales calls: ${int(f.sales_calls_booked)} booked / ${int(f.sales_calls_shown)} shown`);
  lines.push(`Closes: ${int(f.closes)} (CAC ${money(div(t.spend, f.closes))})`);
  lines.push(`Cash collected: ${money0(f.cash_collected)} (ROAS ${x(div(f.cash_collected, t.spend))})`);
  lines.push(`Speed to lead: ${f.speed_to_lead_min == null ? '—' : f.speed_to_lead_min.toFixed(1) + ' min'} | Dials/lead: ${f.dials_per_lead == null ? '—' : f.dials_per_lead.toFixed(1)} | Pickup: ${pct(f.pickup_pct, 0)} | Show: ${pct(f.show_pct, 0)} | Close: ${pct(f.close_pct, 0)}`);
  return lines.join('\n');
}

const yn = (b: boolean | null) => (b == null ? 'N/A' : b ? 'TRUE' : 'FALSE');

function table(head: string[], rows: string[][]): string {
  const esc = (s: string) => s.replace(/\|/g, '\\|');
  return [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...rows.map(r => `| ${r.map(esc).join(' | ')} |`)].join('\n');
}

export function renderMarkdown(r: MetaReport): string {
  const parts: string[] = [];
  parts.push(`# Meta B2B prospecting report — ${r.today}`);
  parts.push(`Account ${r.account_id} · windows end ${r.today} (${r.timezone}) · ` +
    (r.campaign_filter ? `campaigns: ${r.campaign_filter.join(', ')}` : 'all campaigns') +
    ` · per-ad kept demos from ${r.kept_demo_source === 'ghl' ? 'GHL attribution' : r.kept_demo_source === 'meta' ? 'Meta "Schedule Kept" conversion' : 'no source (0)'}`);

  // Standing instructions for whichever AI is handed this report. Embedded here,
  // at the top, so every analysis follows the same shape and compares against
  // the same KPI targets, and so missing per-ad data is never read as zero.
  parts.push([
    '',
    '> ## REPORTING STYLE INSTRUCTIONS (NON-NEGOTIABLE)',
    '> When you analyze this Meta/GHL performance data, you MUST format your answer exactly like this.',
    '>',
    `> **Definitions.** L30 / L7 / L3 = last 30 / 7 / 3 days ending ${r.today}. A *kept demo* is a booked demo that showed. *Control* = the best ad in L7 (named in section 3). Ad-level numbers are L7.`,
    '>',
    '> **KPI targets (compare every number to these):** cost per booked demo ≤ $90 · cost per lead ≤ $70 · link CTR > 1.0% · CPC < $2.50 · landing page → booking rate never below 5%, aiming for 7–8% (section 1 marks each window BELOW FLOOR / BELOW TARGET / ON TARGET; below 5% is a funnel problem — page or offer — not a media problem). Priority order: cost per kept demo → cost per booked demo → cost per lead → CTR/CPC. Account-level cost per booked demo is in section 1; per-ad kept-demo cost is in section 3.',
    '>',
    '> **Missing data rule.** If kept-demo data is N/A, or the header says there is no per-ad kept-demo source, treat it as MISSING, not zero. Never pause or rank an ad on kept demos in that case — fall back to CPL, CTR and CPC and say explicitly that kept-demo data is unavailable.',
    '>',
    '> **Use the report\'s flags.** The flag columns in section 3 (Over_eval_floor, Zero_demo_kill, CTR_half_control, Early_CTR_trash, Perf_vs_control_bad) are the primary pause/keep signal — do not re-derive them. Always quote the exact ad name AND ad ID (names repeat across variants).',
    '>',
    '> **1) EXECUTIVE SNAPSHOT** (2–4 sentences): what is happening at a 50,000-foot level (profitable? bleeding? lead vs show vs close problem?); the #1 constraint right now; whether this is mainly a MEDIA issue (ads / targeting / creative) or a FUNNEL/SALES issue (booking, show, close). End with one line listing any data gaps.',
    '>',
    '> **2) ACTION ITEMS** (3–7 bullets, very concrete) — start with "Do this next:". Each bullet is a direct instruction executable today or this week: which ads to PAUSE (exact ad name + ID) and why; which ads to KEEP (exact ad name + ID) and why; how many NEW ads to create, in what formats (UGC / VO / static) and which existing ad to model; any funnel/sales changes required if those are the real bottleneck.',
    '>',
    '> **3) DETAILS & REASONING** — only after the snapshot and actions: key metrics by window (L30, L7, L3) and what changed; ad-level commentary (CTR, CPC, CPL, cost per kept demo) against the KPI targets; patterns in hooks, formats or angles that are working or failing. Justification and nuance only — no new action items here.',
    '>',
    '> **On/off history.** Section 5 lists exactly when each ad (and its ad set / campaign) was turned on or off. Before judging an ad on its L7 or L3 numbers, check how much of that window it was actually live — an ad switched off mid-window has low spend because it was off, not because it failed.',
    '>',
    '> **General rules:** tie every recommendation back to the KPIs in priority order. Be decisive — no "it depends" without a recommendation; if something is unclear, name the test you want next. Brevity over fluff: a battlefield brief, not a novel.',
  ].join('\n'));

  parts.push('\n## 1. Account / funnel summary');
  for (const w of WINDOWS) parts.push('```\n' + accountSummary(r, w) + '\n```');

  parts.push('\n## 2. Ad set level');
  for (const w of WINDOWS) {
    parts.push(`\n### Last ${w} days (${r.windows[w].since} → ${r.windows[w].until})`);
    parts.push(table(['Ad set', 'Spend', 'Impressions', 'Leads', 'CPL', 'Kept demos', 'Cost per kept demo', 'CTR (link)', 'CPC'], [
      ...r.adsets.map(s => { const m = s.windows[w]; return [s.name, money(m.spend), int(m.impressions), int(m.leads), money(m.cost_per_lead), int(m.kept_demos), money(m.cost_per_kept_demo), pct(m.ctr_link, 2), money(m.cpc_link)]; }),
      (() => { const m = r.totals[w]; return ['**Total**', money(m.spend), int(m.impressions), int(m.leads), money(m.cost_per_lead), int(m.kept_demos), money(m.cost_per_kept_demo), pct(m.ctr_link, 2), money(m.cpc_link)]; })(),
    ]));
  }

  parts.push(`\n## 3. Ad level — last 7 days (${r.windows[7].since} → ${r.windows[7].until})`);
  parts.push(`Control = best ad in L7: link CTR ${pct(r.control.best_ctr_link_7d, 2)}, cost per kept demo ${money(r.control.best_cost_per_kept_demo_7d)}.`);
  parts.push(table(
    ['Campaign', 'Ad set', 'Ad name', 'Ad ID', 'First served', 'Spend', 'Impressions', 'Link clicks', 'CTR (link)', 'CPC', 'Leads', 'CPL', 'Kept demos', 'Cost per kept demo',
      'Over_eval_floor', 'Zero_demo_kill', 'CTR_half_control', 'Early_CTR_trash', 'Perf_vs_control_bad'],
    r.ads.map(a => { const m = a.windows[7]; const f = a.flags; return [
      a.campaign_name, a.adset_name, a.ad_name, a.ad_id, a.first_served ?? '—',
      money(m.spend), int(m.impressions), int(m.link_clicks), pct(m.ctr_link, 2), money(m.cpc_link), int(m.leads), money(m.cost_per_lead), int(m.kept_demos), money(m.cost_per_kept_demo),
      yn(f.over_eval_floor), yn(f.zero_demo_kill), yn(f.ctr_half_control), yn(f.early_ctr_trash), yn(f.perf_vs_control_bad)]; }),
  ));
  parts.push('\nFlag rules: Over_eval_floor = spend ≥ $90 OR impressions ≥ 1,000 · Zero_demo_kill = spend ≥ $135 AND kept demos = 0 · ' +
    'CTR_half_control = link CTR < 50% of best ad in L7 · Early_CTR_trash = impressions ≥ 250 AND link CTR < 25% of best ad · ' +
    'Perf_vs_control_bad = spend ≥ $180 AND cost per kept demo ≥ 1.3× best ad. All on L7 numbers.' +
    (r.kept_demo_source === 'none' ? ' **Zero_demo_kill and Perf_vs_control_bad are N/A this run: no per-ad kept-demo data (see header).**' : ''));

  parts.push('\n## 4. Creative map');
  parts.push(r.ads.map(a => `- ${a.ad_name} (${a.ad_id}, ${a.status ?? 'status —'}) = ${a.creative_type !== '—' ? a.creative_type + ' · ' : ''}${a.creative.description}`).join('\n'));

  parts.push('\n## 5. Ad on/off history');
  if (!r.status_history_available) {
    parts.push('Meta did not return the account activity log for this run, so on/off times are unavailable.');
  } else {
    parts.push(`Every time each ad was created, started delivering, turned ON or turned OFF, oldest first (times in ${r.timezone}; log covers ${r.status_history_since} → ${r.today}). "Now" is the ad's current status in Meta.`);
    const label: Record<StatusEvent['event'], string> = { created: 'Created', first_delivery: 'First delivery', on: 'Turned ON', off: 'Turned OFF' };
    const line = (e: StatusEvent) => `${label[e.event]} ${e.local}${e.detail ? ` (${e.detail})` : ''}${e.actor && (e.event === 'on' || e.event === 'off') ? ` by ${e.actor}` : ''}`;
    parts.push(table(['Ad name', 'Ad ID', 'Now', 'Last turned ON', 'Last turned OFF', 'Full timeline'], r.ads.map(a => {
      const last = (ev: 'on' | 'off') => [...a.status_history].reverse().find(e => e.event === ev)?.local ?? '—';
      return [a.ad_name, a.ad_id, a.status ?? '—', last('on'), last('off'),
        a.status_history.length ? a.status_history.map(line).join(' → ') : 'No changes in the log window'];
    })));
    if (r.parent_status_changes.length) {
      parts.push('\n**Ad set / campaign switches** (these turn every ad underneath on or off, even when the ad itself was not touched):');
      parts.push(r.parent_status_changes.map(e => `- ${e.local} — ${e.level} "${e.name}" turned ${e.event === 'on' ? 'ON' : 'OFF'}${e.detail ? ` (${e.detail})` : ''}${e.actor ? ` by ${e.actor}` : ''}`).join('\n'));
    }
  }
  return parts.join('\n');
}
