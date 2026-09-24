// Meta B2B prospecting report — pulls ad-level insights for three date windows
// (30 / 7 / 3 days including today), rolls them up to ad set and campaign,
// evaluates the kill/eval flags, and renders the result as JSON + Markdown.
//
// Everything comes from the Meta Marketing API; nothing here touches Supabase.
// Consumed by /api/cron/meta-b2b-report, which posts the output to Slack.

const GRAPH = 'https://graph.facebook.com/v19.0';
export const DEFAULT_ACCOUNT = 'act_1080664784142903';

export const WINDOWS = [30, 7, 3] as const;
export type WindowDays = (typeof WINDOWS)[number];

// ── Thresholds (per the report spec) ─────────────────────────────────────
export const RULES = {
  evalFloorSpend: 90,
  evalFloorImpressions: 1000,
  zeroIntroKillSpend: 135,
  ctrHalfControl: 0.5,
  earlyCtrTrashImpressions: 250,
  earlyCtrTrash: 0.25,
  perfVsControlSpend: 180,
  perfVsControlMultiple: 1.3,
} as const;

export type Metrics = {
  spend: number;
  impressions: number;
  link_clicks: number;
  ctr_link: number | null;          // link clicks / impressions, as a percentage
  cpc_link: number | null;          // spend / link clicks
  leads: number;
  cost_per_lead: number | null;
  kept_intros: number;
  cost_per_kept_intro: number | null;
  cpm: number | null;
};

export type Flags = {
  over_eval_floor: boolean;
  zero_intro_kill: boolean;
  ctr_half_control: boolean;
  early_ctr_trash: boolean;
  perf_vs_control_bad: boolean;
};

export type AdRow = {
  campaign_id: string;
  campaign_name: string;
  adset_id: string;
  adset_name: string;
  ad_id: string;
  ad_name: string;
  creative_type: string;
  status: string | null;
  first_served: string | null;
  windows: Record<WindowDays, Metrics>;
  flags: Flags;
};

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
  kept_intro_action_type: string | null;
  flag_window_days: WindowDays;
  control: {
    best_ctr_link_7d: number | null;
    best_ctr_ad_id: string | null;
    best_cost_per_kept_intro_7d: number | null;
    best_cpki_ad_id: string | null;
  };
  windows: Record<WindowDays, { since: string; until: string }>;
  previous_7d: { since: string; until: string; totals: Metrics };
  totals: Record<WindowDays, Metrics>;
  summary: string[];
  ads: AdRow[];
  adsets: RollupRow[];
  campaigns: RollupRow[];
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
    leads: 0, cost_per_lead: null, kept_intros: 0, cost_per_kept_intro: null, cpm: null,
  };
}

function finalize(m: Metrics): Metrics {
  m.ctr_link = m.impressions > 0 ? (m.link_clicks / m.impressions) * 100 : null;
  m.cpc_link = div(m.spend, m.link_clicks);
  m.cost_per_lead = div(m.spend, m.leads);
  m.cost_per_kept_intro = div(m.spend, m.kept_intros);
  m.cpm = m.impressions > 0 ? (m.spend / m.impressions) * 1000 : null;
  return m;
}

function add(into: Metrics, m: Metrics) {
  into.spend += m.spend;
  into.impressions += m.impressions;
  into.link_clicks += m.link_clicks;
  into.leads += m.leads;
  into.kept_intros += m.kept_intros;
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

async function findKeptIntroType(acct: string, token: string): Promise<string | null> {
  const override = process.env.META_KEPT_INTRO_EVENT?.trim();
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

type AdEntity = { id: string; created_time?: string; effective_status?: string };

async function fetchAdEntities(acct: string, token: string): Promise<Map<string, AdEntity>> {
  const map = new Map<string, AdEntity>();
  try {
    const list = await graphGet<AdEntity>(`/${acct}/ads`, { fields: 'id,created_time,effective_status' }, token);
    for (const a of list) map.set(a.id, a);
  } catch { /* first_served / status stay null */ }
  return map;
}

// ── Build ─────────────────────────────────────────────────────────────────

export type BuildOptions = {
  token: string;
  accountId?: string;
  campaigns?: string[] | null;     // exact campaign names; null/empty = all
  flagWindow?: WindowDays;
  timezone?: string;
  now?: Date;
};

export async function buildMetaReport(opts: BuildOptions): Promise<MetaReport> {
  const tz = opts.timezone ?? process.env.REPORT_TIMEZONE ?? 'America/New_York';
  const acct = opts.accountId ?? process.env.META_B2B_ACCOUNT_ID ?? DEFAULT_ACCOUNT;
  const flagWindow: WindowDays = opts.flagWindow ?? 7;
  const today = ymd(opts.now ?? new Date(), tz);

  const filterNames = (opts.campaigns ?? []).map(s => s.trim()).filter(Boolean);
  const filter = filterNames.length ? new Set(filterNames.map(s => s.toLowerCase())) : null;

  const windows = Object.fromEntries(
    WINDOWS.map(d => [d, { since: shiftDays(today, -(d - 1)), until: today }]),
  ) as Record<WindowDays, { since: string; until: string }>;
  const prev7 = { since: shiftDays(today, -13), until: shiftDays(today, -7) };

  const [keptType, entities, raw30, raw7, raw3, rawPrev] = await Promise.all([
    findKeptIntroType(acct, opts.token),
    fetchAdEntities(acct, opts.token),
    fetchInsights(acct, opts.token, windows[30].since, windows[30].until),
    fetchInsights(acct, opts.token, windows[7].since, windows[7].until),
    fetchInsights(acct, opts.token, windows[3].since, windows[3].until),
    fetchInsights(acct, opts.token, prev7.since, prev7.until),
  ]);

  const toMetrics = (r: RawInsight): Metrics => finalize({
    ...emptyMetrics(),
    spend: parseFloat(r.spend ?? '0') || 0,
    impressions: parseInt(r.impressions ?? '0', 10) || 0,
    link_clicks: parseInt(r.inline_link_clicks ?? '0', 10) || 0,
    leads: leadsFrom(r.actions),
    kept_intros: keptFrom(r.actions, keptType),
  });

  const inFilter = (r: RawInsight) => !filter || filter.has((r.campaign_name ?? '').toLowerCase());

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
      status: ent?.effective_status ?? null,
      first_served: ent?.created_time ? ent.created_time.slice(0, 10) : null,
      windows: { 30: toMetrics(r), 7: emptyMetrics(), 3: emptyMetrics() },
      flags: { over_eval_floor: false, zero_intro_kill: false, ctr_half_control: false, early_ctr_trash: false, perf_vs_control_bad: false },
    });
  }
  for (const r of raw7) { const a = r.ad_id && ads.get(r.ad_id); if (a) a.windows[7] = toMetrics(r); }
  for (const r of raw3) { const a = r.ad_id && ads.get(r.ad_id); if (a) a.windows[3] = toMetrics(r); }

  const adList = [...ads.values()].sort((a, b) =>
    a.campaign_name.localeCompare(b.campaign_name) || a.adset_name.localeCompare(b.adset_name) || b.windows[7].spend - a.windows[7].spend);

  // ── Controls (best ad in last 7 days) ──
  const eligible7 = adList.filter(a => a.windows[7].impressions >= RULES.earlyCtrTrashImpressions);
  const bestCtr = eligible7.reduce<AdRow | null>((best, a) =>
    (a.windows[7].ctr_link ?? -1) > (best?.windows[7].ctr_link ?? -1) ? a : best, null);
  const withIntros7 = adList.filter(a => a.windows[7].kept_intros > 0);
  const bestCpki = withIntros7.reduce<AdRow | null>((best, a) =>
    (a.windows[7].cost_per_kept_intro ?? Infinity) < (best?.windows[7].cost_per_kept_intro ?? Infinity) ? a : best, null);

  const control = {
    best_ctr_link_7d: bestCtr?.windows[7].ctr_link ?? null,
    best_ctr_ad_id: bestCtr?.ad_id ?? null,
    best_cost_per_kept_intro_7d: bestCpki?.windows[7].cost_per_kept_intro ?? null,
    best_cpki_ad_id: bestCpki?.ad_id ?? null,
  };

  // ── Flags ──
  for (const a of adList) {
    const m = a.windows[flagWindow];
    const ctr = m.ctr_link ?? 0;
    const bestC = control.best_ctr_link_7d;
    const bestK = control.best_cost_per_kept_intro_7d;
    a.flags = {
      over_eval_floor: m.spend >= RULES.evalFloorSpend || m.impressions >= RULES.evalFloorImpressions,
      zero_intro_kill: m.spend >= RULES.zeroIntroKillSpend && m.kept_intros === 0,
      ctr_half_control: bestC != null && m.impressions > 0 && ctr < bestC * RULES.ctrHalfControl,
      early_ctr_trash: bestC != null && m.impressions >= RULES.earlyCtrTrashImpressions && ctr < bestC * RULES.earlyCtrTrash,
      perf_vs_control_bad: bestK != null && m.spend >= RULES.perfVsControlSpend
        && (m.cost_per_kept_intro == null || m.cost_per_kept_intro >= bestK * RULES.perfVsControlMultiple),
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

  const report: MetaReport = {
    generated_at: new Date().toISOString(),
    today, timezone: tz, account_id: acct,
    campaign_filter: filter ? filterNames : null,
    kept_intro_action_type: keptType,
    flag_window_days: flagWindow,
    control,
    windows,
    previous_7d: { ...prev7, totals: prevTotals },
    totals,
    summary: [],
    ads: adList, adsets, campaigns,
    rules: RULES,
  };
  report.summary = summarise(report);
  return report;
}

// ── Summary bullets (deterministic — same inputs, same words) ─────────────

const money = (n: number | null | undefined) => n == null ? '—' : `$${n.toFixed(2)}`;
const pct = (n: number | null | undefined) => n == null ? '—' : `${n.toFixed(2)}%`;
const int = (n: number) => n.toLocaleString('en-US');
const delta = (now: number | null, prev: number | null, invert = false) => {
  if (now == null || prev == null || prev === 0) return '';
  const ch = ((now - prev) / prev) * 100;
  const good = invert ? ch < 0 : ch > 0;
  return ` (${ch >= 0 ? '+' : ''}${ch.toFixed(0)}% vs prior 7d${Math.abs(ch) >= 10 ? (good ? ' ✅' : ' ⚠️') : ''})`;
};

export function summarise(r: MetaReport): string[] {
  const t = r.totals[7], p = r.previous_7d.totals;
  const out: string[] = [];
  out.push(`Spend last 7d: ${money(t.spend)}${delta(t.spend, p.spend)} across ${r.ads.filter(a => a.windows[7].impressions > 0).length} ads.`);
  out.push(`Leads: ${int(t.leads)} at ${money(t.cost_per_lead)} CPL${delta(t.cost_per_lead, p.cost_per_lead, true)} · prior 7d: ${int(p.leads)} at ${money(p.cost_per_lead)}.`);
  out.push(`Kept intros: ${int(t.kept_intros)} at ${money(t.cost_per_kept_intro)} each${delta(t.cost_per_kept_intro, p.cost_per_kept_intro, true)} · prior 7d: ${int(p.kept_intros)} at ${money(p.cost_per_kept_intro)}.`);
  out.push(`Link CTR ${pct(t.ctr_link)}${delta(t.ctr_link, p.ctr_link)} · CPC ${money(t.cpc_link)} · CPM ${money(t.cpm)}.`);

  const kills = r.ads.filter(a => a.flags.zero_intro_kill || a.flags.early_ctr_trash || a.flags.perf_vs_control_bad);
  const best = r.ads.find(a => a.ad_id === r.control.best_cpki_ad_id) ?? r.ads.find(a => a.ad_id === r.control.best_ctr_ad_id);
  if (best) {
    out.push(`Control: "${best.ad_name}" — ${pct(best.windows[7].ctr_link)} link CTR, ${money(best.windows[7].cost_per_kept_intro)} per kept intro (7d).`);
  }
  out.push(kills.length
    ? `${kills.length} ad${kills.length === 1 ? '' : 's'} hit a kill flag: ${kills.slice(0, 5).map(a => `"${a.ad_name}"`).join(', ')}${kills.length > 5 ? '…' : ''}.`
    : 'No ads hit a kill flag this run.');
  if (!r.kept_intro_action_type) out.push('⚠️ No "Schedule Kept" custom conversion found on the ad account — kept intros show 0.');
  return out;
}

// ── Markdown ──────────────────────────────────────────────────────────────

const yn = (b: boolean) => (b ? 'TRUE' : 'false');

function metricCells(m: Metrics) {
  return [money(m.spend), int(m.impressions), int(m.link_clicks), pct(m.ctr_link), money(m.cpc_link),
    int(m.leads), money(m.cost_per_lead), int(m.kept_intros), money(m.cost_per_kept_intro), money(m.cpm)];
}
const METRIC_HEAD = ['Spend', 'Impr', 'Link clicks', 'CTR (link)', 'CPC', 'Leads', 'CPL', 'Kept intros', 'Cost/kept', 'CPM'];

function table(head: string[], rows: string[][]): string {
  return [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...rows.map(r => `| ${r.join(' | ')} |`)].join('\n');
}

export function renderMarkdown(r: MetaReport): string {
  const parts: string[] = [];
  parts.push(`# Meta B2B prospecting report — ${r.today}`);
  parts.push(`Account ${r.account_id} · windows end ${r.today} (${r.timezone}) · flags evaluated on the ${r.flag_window_days}-day window` +
    (r.campaign_filter ? ` · campaigns: ${r.campaign_filter.join(', ')}` : ' · all campaigns'));
  parts.push('\n## Summary (vs previous 7 days)\n' + r.summary.map(s => `- ${s}`).join('\n'));

  parts.push('\n## Ads');
  parts.push(table(
    ['Campaign', 'Ad set', 'Ad', 'Ad ID', 'Type', 'First served', 'Status'],
    r.ads.map(a => [a.campaign_name, a.adset_name, a.ad_name, a.ad_id, a.creative_type, a.first_served ?? '—', a.status ?? '—']),
  ));

  for (const w of WINDOWS) {
    parts.push(`\n### Per ad — last ${w} days (${r.windows[w].since} → ${r.windows[w].until})`);
    parts.push(table(['Ad', 'Ad ID', ...METRIC_HEAD], [
      ...r.ads.map(a => [a.ad_name, a.ad_id, ...metricCells(a.windows[w])]),
      ['**Total**', '', ...metricCells(r.totals[w])],
    ]));
  }

  for (const w of WINDOWS) {
    parts.push(`\n### Ad set totals — last ${w} days`);
    parts.push(table(['Campaign', 'Ad set', ...METRIC_HEAD], r.adsets.map(s => [s.campaign_name ?? '', s.name, ...metricCells(s.windows[w])])));
    parts.push(`\n### Campaign totals — last ${w} days`);
    parts.push(table(['Campaign', ...METRIC_HEAD], r.campaigns.map(c => [c.name, ...metricCells(c.windows[w])])));
  }

  parts.push(`\n## Flags (${r.flag_window_days}-day window; control = best ad in last 7 days: CTR ${pct(r.control.best_ctr_link_7d)}, cost/kept ${money(r.control.best_cost_per_kept_intro_7d)})`);
  parts.push(table(
    ['Ad', 'Ad ID', 'Over eval floor', 'Zero-intro kill', 'CTR_half_control', 'Early_CTR_trash', 'Perf_vs_control_bad'],
    r.ads.map(a => [a.ad_name, a.ad_id, yn(a.flags.over_eval_floor), yn(a.flags.zero_intro_kill), yn(a.flags.ctr_half_control), yn(a.flags.early_ctr_trash), yn(a.flags.perf_vs_control_bad)]),
  ));
  parts.push('\nRules: over eval floor = spend ≥ $90 OR impressions ≥ 1,000 · zero-intro kill = spend ≥ $135 AND kept intros = 0 · ' +
    'CTR_half_control = link CTR < 50% of best ad (7d) · Early_CTR_trash = impressions ≥ 250 AND link CTR < 25% of best ad (7d) · ' +
    'Perf_vs_control_bad = spend ≥ $180 AND cost per kept intro ≥ 1.3× best ad (7d).');
  return parts.join('\n');
}

// Compact Slack text: summary + flagged ads. The full tables go as file attachments.
export function renderSlackText(r: MetaReport): string {
  const lines = [`*Meta B2B prospecting report — ${r.today}*`, ...r.summary.map(s => `• ${s}`)];
  const flagged = r.ads.filter(a => a.flags.zero_intro_kill || a.flags.early_ctr_trash || a.flags.perf_vs_control_bad || a.flags.ctr_half_control);
  if (flagged.length) {
    lines.push('', `*Flagged ads (${r.flag_window_days}d):*`);
    for (const a of flagged.slice(0, 15)) {
      const f = a.flags;
      const tags = [f.zero_intro_kill && 'zero-intro kill', f.early_ctr_trash && 'early CTR trash', f.perf_vs_control_bad && 'perf vs control bad', f.ctr_half_control && 'CTR < ½ control'].filter(Boolean).join(', ');
      const m = a.windows[r.flag_window_days];
      lines.push(`• ${a.ad_name} (${a.adset_name}) — ${money(m.spend)}, ${pct(m.ctr_link)} CTR, ${int(m.kept_intros)} kept → _${tags}_`);
    }
    if (flagged.length > 15) lines.push(`…and ${flagged.length - 15} more in the attached table.`);
  }
  lines.push('', `7d totals: ${money(r.totals[7].spend)} · ${int(r.totals[7].leads)} leads (${money(r.totals[7].cost_per_lead)}) · ${int(r.totals[7].kept_intros)} kept intros (${money(r.totals[7].cost_per_kept_intro)})`);
  lines.push(`30d totals: ${money(r.totals[30].spend)} · ${int(r.totals[30].leads)} leads (${money(r.totals[30].cost_per_lead)}) · ${int(r.totals[30].kept_intros)} kept intros (${money(r.totals[30].cost_per_kept_intro)})`);
  return lines.join('\n');
}
