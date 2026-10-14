// Two paste-ready versions of the Meta B2B report, built on top of
// buildMetaReport (meta-report.ts):
//
//   full    — everything a chat with NO context needs to advise on the campaign
//             in one paste: the business brief, what is live now, account
//             history by month, the L30/L7/L3 funnel, ad sets, the L7 ad table
//             with flags, the creative library (script / prompt / notes, lifetime
//             results, week-by-week life, video watch metrics), funnel pages,
//             ad set / campaign switches.
//   update  — for a chat that already has the full brief: what changed in the
//             last 7 days, L7 vs prior 7, L3, the L7 ad table, flags, new notes.
//
// Extra data beyond meta-report.ts: lifetime + weekly + video insights per ad,
// monthly account history, campaign / ad set budgets (all Meta), the Creative Hub entries and links, and the lifetime
// GHL funnel per ad (events, first touch, every demo booked).

import type { createServiceClient } from './supabase';
import { getTomsiClientId } from './tomsi';
import { rollupFunnelByAd, EMPTY_AD_FUNNEL, type AdFunnel } from './ad-funnel';
import { B2B_BRIEF } from './b2b-brief';
import {
  buildMetaReport, accountSummary, WINDOWS, RULES, LANDING_TO_BOOKING_KPI,
  type BuildOptions, type MetaReport, type AdRow, type StatusEvent, type WindowDays,
} from './meta-report';

type Service = ReturnType<typeof createServiceClient>;
export type ReportMode = 'full' | 'update';

const GRAPH = 'https://graph.facebook.com/v19.0';
const UPDATE_DAYS = 7;
const TRAJECTORY_MIN_SPEND = 100;   // creatives below this get a one-line life, not a weekly table
const MAX_WEEKS = 12;
const MINOR_SPEND = 100;          // ads with no Hub record and less than this lifetime spend are summed, not listed

// ── Meta extras ───────────────────────────────────────────────────────────

type Actions = { action_type: string; value: string }[];
type Insight = {
  ad_id?: string; ad_name?: string; adset_name?: string; campaign_name?: string; date_start?: string; date_stop?: string;
  spend?: string; impressions?: string; reach?: string; inline_link_clicks?: string; actions?: Actions;
  video_play_actions?: { value: string }[]; video_thruplay_watched_actions?: { value: string }[];
  video_avg_time_watched_actions?: { value: string }[]; video_p100_watched_actions?: { value: string }[];
};

async function graph<T>(path: string, params: Record<string, string>, token: string): Promise<T[]> {
  const out: T[] = [];
  let url: string | null = `${GRAPH}${path}?${new URLSearchParams({ ...params, limit: '500', access_token: token })}`;
  let guard = 0;
  while (url && guard++ < 30) {
    const res: Response = await fetch(url);
    const json = await res.json() as { data?: T[]; paging?: { next?: string }; error?: { message: string } };
    if (json.error) throw new Error(`Meta API: ${json.error.message}`);
    out.push(...(json.data ?? []));
    url = json.paging?.next ?? null;
  }
  return out;
}
const safe = async <T,>(p: Promise<T[]>): Promise<T[]> => { try { return await p; } catch { return []; } };

const num = (s: string | undefined) => parseFloat(s ?? '0') || 0;
const act = (a: Actions | undefined, type: string) => parseInt(a?.find(x => x.action_type === type)?.value ?? '0', 10) || 0;
const first = (v: { value: string }[] | undefined) => parseFloat(v?.[0]?.value ?? '0') || 0;
const leadsOf = (a: Actions | undefined) => {
  const t = act(a, 'lead');
  return t || ['offsite_conversion.fb_pixel_lead', 'onsite_conversion.lead_grouped', 'leadgen_grouped'].reduce((s, k) => s + act(a, k), 0);
};

type Lifetime = {
  spend: number; impressions: number; reach: number; clicks: number; leads: number;
  plays: number; views3s: number; thruplays: number; avgWatch: number; p100: number;
};
type Week = { start: string; end: string; spend: number; impressions: number; clicks: number; leads: number };
type Budgeted = { id: string; name: string; status: string; daily: number | null; lifetime: number | null; extra: string };

type Extras = {
  monthly: { month: string; spend: number; impressions: number; clicks: number; leads: number }[];
  lifetime: Map<string, Lifetime & { name: string; adset: string }>;
  weekly: Map<string, Week[]>;
  campaigns: Budgeted[];
  adsets: (Budgeted & { campaign_id: string })[];
};

async function fetchExtras(acct: string, token: string): Promise<Extras> {
  const base = 'spend,impressions,inline_link_clicks,actions';
  const [monthly, lifetime, weekly, campaigns, adsets] = await Promise.all([
    safe(graph<Insight>(`/${acct}/insights`, { date_preset: 'maximum', time_increment: 'monthly', fields: base }, token)),
    safe(graph<Insight>(`/${acct}/insights`, { level: 'ad', date_preset: 'maximum',
      fields: `ad_id,ad_name,adset_name,campaign_name,reach,${base},video_play_actions,video_thruplay_watched_actions,video_avg_time_watched_actions,video_p100_watched_actions` }, token)),
    safe(graph<Insight>(`/${acct}/insights`, { level: 'ad', date_preset: 'maximum', time_increment: '7', fields: `ad_id,${base}` }, token)),
    safe(graph<{ id: string; name: string; effective_status?: string; daily_budget?: string; lifetime_budget?: string; bid_strategy?: string; objective?: string }>(
      `/${acct}/campaigns`, { fields: 'id,name,effective_status,daily_budget,lifetime_budget,bid_strategy,objective' }, token)),
    safe(graph<{ id: string; name: string; effective_status?: string; daily_budget?: string; lifetime_budget?: string; campaign_id: string; optimization_goal?: string;
      targeting?: { age_min?: number; age_max?: number; geo_locations?: { countries?: string[] }; targeting_automation?: { advantage_audience?: number } } }>(
      `/${acct}/adsets`, { fields: 'id,name,effective_status,daily_budget,lifetime_budget,campaign_id,optimization_goal,targeting{age_min,age_max,geo_locations,targeting_automation}' }, token)),
  ]);

  const life = new Map<string, Lifetime & { name: string; adset: string }>();
  for (const r of lifetime) {
    if (!r.ad_id) continue;
    life.set(r.ad_id, {
      name: r.ad_name ?? '', adset: r.adset_name ?? r.campaign_name ?? '', spend: num(r.spend), impressions: num(r.impressions), reach: num(r.reach), clicks: num(r.inline_link_clicks),
      leads: leadsOf(r.actions), plays: first(r.video_play_actions), views3s: act(r.actions, 'video_view'),
      thruplays: first(r.video_thruplay_watched_actions), avgWatch: first(r.video_avg_time_watched_actions), p100: first(r.video_p100_watched_actions),
    });
  }
  const weeks = new Map<string, Week[]>();
  for (const r of weekly) {
    if (!r.ad_id || !r.date_start) continue;
    const list = weeks.get(r.ad_id) ?? [];
    list.push({ start: r.date_start, end: r.date_stop ?? r.date_start, spend: num(r.spend), impressions: num(r.impressions), clicks: num(r.inline_link_clicks), leads: leadsOf(r.actions) });
    weeks.set(r.ad_id, list);
  }
  for (const list of weeks.values()) list.sort((a, b) => a.start.localeCompare(b.start));

  const cents = (s: string | undefined) => (s ? Number(s) / 100 : null);

  return {
    monthly: monthly.filter(r => r.date_start).map(r => ({ month: r.date_start!.slice(0, 7), spend: num(r.spend), impressions: num(r.impressions), clicks: num(r.inline_link_clicks), leads: leadsOf(r.actions) })),
    lifetime: life, weekly: weeks,
    campaigns: campaigns.map(c => ({ id: c.id, name: c.name, status: c.effective_status ?? '—', daily: cents(c.daily_budget), lifetime: cents(c.lifetime_budget), extra: [c.objective, c.bid_strategy].filter(Boolean).join(' · ') })),
    adsets: adsets.map(s => ({
      id: s.id, name: s.name, status: s.effective_status ?? '—', campaign_id: s.campaign_id, daily: cents(s.daily_budget), lifetime: cents(s.lifetime_budget),
      extra: [s.optimization_goal, s.targeting?.geo_locations?.countries?.join('/'),
        s.targeting?.age_min != null ? `${s.targeting.age_min}–${s.targeting.age_max ?? '65+'}` : null,
        s.targeting?.targeting_automation?.advantage_audience ? 'Advantage+ audience' : null].filter(Boolean).join(' · '),
    })),
  };
}

// ── Creative Hub side ─────────────────────────────────────────────────────

type HubEntry = {
  id: string; name: string; code: string | null; category: string | null; kind: string | null; tags: string | null;
  launch_date: string | null; headline: string | null; primary_text: string | null; prompt: string | null;
  script: string | null; background_notes: string | null; notes: string | null; created_at: string; updated_at: string;
};
type Hub = { entries: HubEntry[]; linkToEntry: Map<string, string> };

async function fetchHub(service: Service): Promise<Hub> {
  const [{ data: entries }, { data: links }] = await Promise.all([
    service.from('creative_hub_entries').select('id,name,code,category,kind,tags,launch_date,headline,primary_text,prompt,script,background_notes,notes,created_at,updated_at').eq('scope', 'b2b'),
    service.from('creative_hub_links').select('ad_id,entry_id'),
  ]);
  const ids = new Set((entries ?? []).map(e => e.id as string));
  const linkToEntry = new Map<string, string>();
  for (const l of links ?? []) if (ids.has(l.entry_id as string)) linkToEntry.set(l.ad_id as string, l.entry_id as string);
  return { entries: (entries ?? []) as HubEntry[], linkToEntry };
}

// ── Formatting helpers ────────────────────────────────────────────────────

const money = (n: number | null | undefined, dp = 2) => n == null || !Number.isFinite(n) ? '—' : `$${n.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;
const money0 = (n: number | null | undefined) => money(n, 0);
const pct = (n: number | null | undefined, dp = 1) => n == null || !Number.isFinite(n) ? '—' : `${n.toFixed(dp)}%`;
const int = (n: number) => Math.round(n).toLocaleString('en-US');
const div = (a: number, b: number) => (b > 0 ? a / b : null);
const yn = (b: boolean | null) => (b == null ? 'N/A' : b ? 'TRUE' : 'FALSE');
const table = (head: string[], rows: string[][]) => {
  const esc = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
  return [`| ${head.join(' | ')} |`, `| ${head.map(() => '---').join(' | ')} |`, ...rows.map(r => `| ${r.map(esc).join(' | ')} |`)].join('\n');
};
const quote = (s: string) => s.trim().split('\n').map(l => `> ${l}`).join('\n');
const daysBetween = (a: string, b: string) => Math.round((new Date(b + 'T00:00:00Z').getTime() - new Date(a + 'T00:00:00Z').getTime()) / 86_400_000) + 1;
const shiftDays = (d: string, n: number) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };

const STATUS_LABEL: Record<StatusEvent['event'], string> = { created: 'Created', first_delivery: 'First delivery', on: 'Turned ON', off: 'Turned OFF' };
const eventLine = (e: StatusEvent) => `${STATUS_LABEL[e.event]} ${e.local}${e.detail ? ` (${e.detail})` : ''}${e.actor && (e.event === 'on' || e.event === 'off') ? ` by ${e.actor}` : ''}`;

// ── The AI's standing instructions ────────────────────────────────────────

function instructions(r: MetaReport, mode: ReportMode, sec: Record<string, number>): string {
  const k = LANDING_TO_BOOKING_KPI;
  const lines = [
    '> ## HOW TO READ THIS AND HOW TO ANSWER (NON-NEGOTIABLE)',
    mode === 'full'
      ? '> You are the media buyer for this account. This document is everything you need: the business, the funnel, the targets, what is live, every creative with its script and its results, and the last 30 / 7 / 3 days. Read it all before answering. Keep it for the rest of the conversation — later messages will only send updates.'
      : '> You already have the full brief for this account from earlier in this conversation. This is the periodic update: what changed and the latest numbers. Apply the same targets and the same answer format as before.',
    '>',
    `> **Definitions.** L30 / L7 / L3 = last 30 / 7 / 3 days ending ${r.today}. A *demo* is a booked sales call; a *kept demo* is one that showed. *Control* = the best ad in L7 (named in the ad-level section). Ad-level window numbers are L7; lifetime numbers are marked as such.`,
    '>',
    `> **KPI targets (compare every number to these):** cost per booked demo ≤ $90 · cost per lead ≤ $70 · link CTR > 1.0% · CPC ≤ $2.50 · landing page → booking never below ${k.floorPct}%, aiming for ${k.targetLowPct}–${k.targetHighPct}% (below ${k.floorPct}% is a funnel problem — page or offer — not a media problem). Priority order: cost per kept demo → cost per booked demo → cost per lead → CTR/CPC.`,
    '>',
    '> **Missing data rule.** If kept-demo data is N/A, or the header says there is no per-ad kept-demo source, treat it as MISSING, not zero. Never pause or rank an ad on kept demos in that case — fall back to CPL, CTR and CPC and say so. GHL ad attribution (leads / demos per ad) only exists from September 2026; earlier creatives have Meta lead counts only.',
    '>',
    `> **Use the report's flags.** The flag columns in section ${sec.ads} (Over_eval_floor, Zero_demo_kill, CTR_half_control, Early_CTR_trash, Perf_vs_control_bad) are the primary pause/keep signal — do not re-derive them. Always quote the exact ad name AND ad ID (names repeat across variants). Before judging an ad on L7 / L3, check the on/off history (section ${sec.history}): an ad switched off mid-window has low spend because it was off, not because it failed.`,
    '>',
    '> **Answer in exactly this shape:**',
    '> **1) EXECUTIVE SNAPSHOT** (2–4 sentences): profitable or bleeding; the #1 constraint; MEDIA issue (ads / targeting / creative) or FUNNEL/SALES issue (booking, show, close). End with one line listing data gaps.',
    '> **2) ACTION ITEMS** (3–7 bullets, start with "Do this next:"): which ads to PAUSE (exact name + ID) and why; which to KEEP and why; how many NEW ads to make, in which formats, modelled on which existing creative (use the scripts and prompts in the creative library to be specific — propose the hook); any funnel/sales change if that is the real bottleneck.',
    '> **3) DETAILS & REASONING**: key metrics by window and what changed; ad-level commentary against the targets; patterns in hooks, formats or angles that are working or failing. No new action items here.',
    '>',
    '> Be decisive — no "it depends" without a recommendation; if something is unclear, name the test you want next. A battlefield brief, not a novel.',
  ];
  return lines.join('\n');
}

// ── Sections ──────────────────────────────────────────────────────────────

function liveNow(r: MetaReport, x: Extras, hub: Hub): string {
  const parts: string[] = [];
  const liveAds = r.ads.filter(a => a.status === 'ACTIVE' && a.windows[3].impressions > 0);
  const onButSilent = r.ads.filter(a => a.status === 'ACTIVE' && a.windows[3].impressions === 0);
  parts.push(`**Ads delivering right now (L3 impressions > 0, status ACTIVE):** ${liveAds.length}`);
  if (liveAds.length) parts.push(table(['Ad', 'Ad ID', 'Ad set', 'L7 spend', 'L7 leads', 'L7 CPL', 'L7 CTR'],
    liveAds.map(a => { const m = a.windows[7]; return [a.ad_name, a.ad_id, a.adset_name, money(m.spend), int(m.leads), money(m.cost_per_lead), pct(m.ctr_link, 2)]; })));
  if (onButSilent.length) parts.push(`On but not delivering in L3: ${onButSilent.map(a => `${a.ad_name} (${a.ad_id})`).join(', ')}.`);

  const relevant = new Set(r.ads.map(a => a.campaign_id));
  const camps = x.campaigns.filter(c => relevant.has(c.id) || c.status === 'ACTIVE');
  if (camps.length) {
    parts.push('\n**Campaign structure and budgets (Meta, now):**');
    for (const c of camps) {
      parts.push(`- Campaign "${c.name}" — ${c.status}${c.daily != null ? ` · $${c.daily}/day` : ''}${c.lifetime != null ? ` · $${c.lifetime} lifetime` : ''}${c.extra ? ` · ${c.extra}` : ''}`);
      for (const s of x.adsets.filter(s => s.campaign_id === c.id)) {
        parts.push(`  - Ad set "${s.name}" — ${s.status}${s.daily != null ? ` · $${s.daily}/day` : ''}${s.extra ? ` · ${s.extra}` : ''}`);
      }
    }
  }

  const linkedEntries = new Set(hub.linkToEntry.values());
  const drafts = hub.entries.filter(e => !linkedEntries.has(e.id));
  if (drafts.length) {
    parts.push(`\n**Made but never launched (in the Creative Hub, no ad yet):** ${drafts.map(e => `${e.code ? e.code + ' ' : ''}${e.name}${e.kind ? ` (${e.kind})` : ''}`).join(' · ')}. Their prompts / scripts are in the creative library.`);
  }
  return parts.join('\n');
}

function history(x: Extras): string {
  const rows = x.monthly.filter(m => m.spend > 0);
  if (!rows.length) return 'No monthly history available from Meta.';
  const best = rows.filter(m => m.leads >= 10).reduce<typeof rows[number] | null>((b, m) => (!b || (m.spend / m.leads) < (b.spend / b.leads) ? m : b), null);
  return [
    'Whole account, by month (Meta-reported leads; GHL funnel data only exists from August 2026).' + (best ? ` Best month on cost per lead: **${best.month}** (${money(best.spend / best.leads)}).` : ''),
    table(['Month', 'Spend', 'Impressions', 'Link clicks', 'CTR', 'CPC', 'Leads (Meta)', 'CPL'],
      rows.map(m => [m.month === best?.month ? `**${m.month}**` : m.month, money0(m.spend), int(m.impressions), int(m.clicks), pct(div(m.clicks * 100, m.impressions), 2), money(div(m.spend, m.clicks)), int(m.leads), money(div(m.spend, m.leads))])),
  ].join('\n');
}

function adsetTables(r: MetaReport, windows: readonly WindowDays[]): string {
  const parts: string[] = [];
  for (const w of windows) {
    parts.push(`\n### Last ${w} days (${r.windows[w].since} → ${r.windows[w].until})`);
    parts.push(table(['Ad set', 'Spend', 'Impressions', 'Leads', 'CPL', 'Kept demos', 'Cost per kept demo', 'CTR (link)', 'CPC'], [
      ...r.adsets.map(s => { const m = s.windows[w]; return [s.name, money(m.spend), int(m.impressions), int(m.leads), money(m.cost_per_lead), int(m.kept_demos), money(m.cost_per_kept_demo), pct(m.ctr_link, 2), money(m.cpc_link)]; }),
      (() => { const m = r.totals[w]; return ['**Total**', money(m.spend), int(m.impressions), int(m.leads), money(m.cost_per_lead), int(m.kept_demos), money(m.cost_per_kept_demo), pct(m.ctr_link, 2), money(m.cpc_link)]; })(),
    ]));
  }
  return parts.join('\n');
}

function adTable(r: MetaReport): string {
  const parts: string[] = [];
  parts.push(`Control = best ad in L7: link CTR ${pct(r.control.best_ctr_link_7d, 2)}, cost per kept demo ${money(r.control.best_cost_per_kept_demo_7d)}.`);
  parts.push(table(
    ['Campaign', 'Ad set', 'Ad name', 'Ad ID', 'Now', 'First served', 'Spend', 'Impr.', 'Link clicks', 'CTR (link)', 'CPC', 'Leads', 'CPL', 'Kept demos', 'Cost per kept demo',
      'Over_eval_floor', 'Zero_demo_kill', 'CTR_half_control', 'Early_CTR_trash', 'Perf_vs_control_bad'],
    r.ads.map(a => { const m = a.windows[7]; const f = a.flags; return [
      a.campaign_name, a.adset_name, a.ad_name, a.ad_id, a.status ?? '—', a.first_served ?? '—',
      money(m.spend), int(m.impressions), int(m.link_clicks), pct(m.ctr_link, 2), money(m.cpc_link), int(m.leads), money(m.cost_per_lead), int(m.kept_demos), money(m.cost_per_kept_demo),
      yn(f.over_eval_floor), yn(f.zero_demo_kill), yn(f.ctr_half_control), yn(f.early_ctr_trash), yn(f.perf_vs_control_bad)]; }),
  ));
  parts.push(`Flag rules: Over_eval_floor = spend ≥ $${RULES.evalFloorSpend} OR impressions ≥ ${int(RULES.evalFloorImpressions)} · Zero_demo_kill = spend ≥ $${RULES.zeroDemoKillSpend} AND kept demos = 0 · ` +
    `CTR_half_control = link CTR < ${RULES.ctrHalfControl * 100}% of best ad in L7 · Early_CTR_trash = impressions ≥ ${RULES.earlyCtrTrashImpressions} AND link CTR < ${RULES.earlyCtrTrash * 100}% of best ad · ` +
    `Perf_vs_control_bad = spend ≥ $${RULES.perfVsControlSpend} AND cost per kept demo ≥ ${RULES.perfVsControlMultiple}× best ad. All on L7 numbers.` +
    (r.kept_demo_source === 'none' ? ' **Zero_demo_kill and Perf_vs_control_bad are N/A this run: no per-ad kept-demo data.**' : ''));
  return parts.join('\n');
}

// One creative = a Hub entry (with every ad linked to it) or, for ads with no
// entry, the ad itself. Lifetime numbers are summed across its ads.
type CreativeGroup = {
  key: string; title: string; entry: HubEntry | null; ads: { id: string; name: string; row: AdRow | null }[];
  life: Lifetime; funnel: AdFunnel; weeks: Week[]; firstDay: string | null; lastDay: string | null; isVideo: boolean;
};

function groupCreatives(r: MetaReport, x: Extras, hub: Hub, funnelByAd: Map<string, AdFunnel>): CreativeGroup[] {
  const byEntry = new Map<string, HubEntry>(hub.entries.map(e => [e.id, e]));
  const groups = new Map<string, CreativeGroup>();
  const reportAds = new Map(r.ads.map(a => [a.ad_id, a]));
  const adIds = new Set<string>([...x.lifetime.keys(), ...reportAds.keys()]);

  const blank = (): Lifetime => ({ spend: 0, impressions: 0, reach: 0, clicks: 0, leads: 0, plays: 0, views3s: 0, thruplays: 0, avgWatch: 0, p100: 0 });

  for (const id of adIds) {
    const entryId = hub.linkToEntry.get(id);
    const entry = entryId ? byEntry.get(entryId) ?? null : null;
    const lt = x.lifetime.get(id);
    const row = reportAds.get(id) ?? null;
    const name = lt?.name || row?.ad_name || id;
    const adset = lt?.adset || row?.adset_name || '';
    const key = entry ? `e:${entry.id}` : `a:${id}`;
    let g = groups.get(key);
    if (!g) {
      // Old ads with no Hub record repeat names ("Ad 2" in three campaigns) — carry the ad set.
      g = { key, title: entry ? `${entry.code ? entry.code + ' — ' : ''}${entry.name}` : `${name}${adset ? ` · ${adset}` : ''}`, entry, ads: [], life: blank(), funnel: { ...EMPTY_AD_FUNNEL }, weeks: [], firstDay: null, lastDay: null, isVideo: false };
      groups.set(key, g);
    }
    g.ads.push({ id, name, row });
    if (lt) {
      g.life.spend += lt.spend; g.life.impressions += lt.impressions; g.life.reach += lt.reach; g.life.clicks += lt.clicks; g.life.leads += lt.leads;
      g.life.plays += lt.plays; g.life.views3s += lt.views3s; g.life.thruplays += lt.thruplays; g.life.p100 += lt.p100;
      // weighted average watch time across the creative's ads
      g.life.avgWatch = g.life.plays > 0 ? ((g.life.avgWatch * (g.life.plays - lt.plays)) + lt.avgWatch * lt.plays) / g.life.plays : lt.avgWatch;
      if (lt.plays > 0) g.isVideo = true;
    }
    if (row?.creative.format?.startsWith('Video')) g.isVideo = true;
    const f = funnelByAd.get(id);
    if (f) { g.funnel.leads += f.leads; g.funnel.appts += f.appts; g.funnel.shows += f.shows; g.funnel.no_shows += f.no_shows; g.funnel.closes += f.closes; g.funnel.revenue += f.revenue; }
    for (const w of x.weekly.get(id) ?? []) {
      const ex = g.weeks.find(k => k.start === w.start);
      if (ex) { ex.spend += w.spend; ex.impressions += w.impressions; ex.clicks += w.clicks; ex.leads += w.leads; }
      else g.weeks.push({ ...w });
    }
  }
  for (const g of groups.values()) {
    g.weeks = g.weeks.filter(w => w.spend > 0).sort((a, b) => a.start.localeCompare(b.start));
    g.firstDay = g.weeks[0]?.start ?? null;
    g.lastDay = g.weeks[g.weeks.length - 1]?.end ?? null;
  }
  // Entries with no ad at all (drafts) still belong in the library, for their scripts.
  for (const e of hub.entries) {
    if (![...groups.values()].some(g => g.entry?.id === e.id)) {
      groups.set(`e:${e.id}`, { key: `e:${e.id}`, title: `${e.code ? e.code + ' — ' : ''}${e.name}`, entry: e, ads: [], life: blank(), funnel: { ...EMPTY_AD_FUNNEL }, weeks: [], firstDay: null, lastDay: null, isVideo: /video|head|ugc|voice/i.test(e.kind ?? '') });
    }
  }
  return [...groups.values()].sort((a, b) => b.life.spend - a.life.spend || a.title.localeCompare(b.title));
}

function creativeLibrary(r: MetaReport, groups: CreativeGroup[], today: string): string {
  const parts: string[] = [];
  parts.push(`One block per creative, biggest lifetime spend first. "GHL" numbers are real CRM outcomes attributed to the ad (first touch; a demo counts whether it later showed or not); "Meta leads" is Meta's own count. Week-by-week tables show how long a creative worked before it faded or was turned off (only for creatives that spent ≥ $${TRAJECTORY_MIN_SPEND}). Prompts and scripts are what the creative was made from — model new creatives on the ones that worked.`);

  const summary = groups.filter(g => g.life.spend > 0 && (g.entry || g.life.spend >= MINOR_SPEND)).map(g => {
    const cpl = div(g.life.spend, g.funnel.leads || g.life.leads);
    return [g.title, g.entry?.kind ?? (g.isVideo ? 'Video' : 'Image'), g.firstDay ?? '—', g.lastDay ?? '—', g.firstDay && g.lastDay ? String(daysBetween(g.firstDay, g.lastDay)) : '—',
      money0(g.life.spend), pct(div(g.life.clicks * 100, g.life.impressions), 2), int(g.life.leads), int(g.funnel.leads), money(cpl), int(g.funnel.appts), money(div(g.life.spend, g.funnel.appts)), int(g.funnel.shows), int(g.funnel.closes),
      g.isVideo ? `${pct(div(g.life.views3s * 100, g.life.impressions), 0)} / ${pct(div(g.life.thruplays * 100, g.life.views3s), 0)} / ${g.life.avgWatch ? g.life.avgWatch.toFixed(0) + 's' : '—'}` : '—'];
  });
  parts.push('\n### Lifetime scoreboard');
  parts.push(table(['Creative', 'Kind', 'First', 'Last', 'Days', 'Spend', 'CTR', 'Meta leads', 'GHL leads', 'CPL', 'Demos (GHL)', 'Cost/demo', 'Shown', 'Closed', 'Hook / hold / avg watch'], summary));

  const minor = groups.filter(g => !g.entry && g.life.spend < MINOR_SPEND && g.life.spend > 0);
  if (minor.length) {
    const spend = minor.reduce((t, g) => t + g.life.spend, 0), leads = minor.reduce((t, g) => t + g.life.leads, 0);
    parts.push(`\nNot listed above: ${minor.length} older ads with no Hub record and under $${MINOR_SPEND} lifetime spend each (${money0(spend)} and ${int(leads)} Meta leads in total).`);
  }
  parts.push('\nFull detail follows for every creative with a Hub record (script / prompt / notes). Older ads without one appear in the scoreboard only.');

  for (const g of groups.filter(g => g.entry)) {
    const e = g.entry;
    parts.push(`\n### ${g.title}`);
    const meta: string[] = [];
    if (e?.kind) meta.push(e.kind);
    if (e?.category) meta.push(`category ${e.category}`);
    if (e?.tags) meta.push(`tags: ${e.tags}`);
    if (g.ads.length) meta.push(`ads: ${g.ads.map(a => `${a.name} (${a.id}${a.row?.status ? ', ' + a.row.status : ''})`).join('; ')}`);
    else meta.push('not launched yet — no ad in Meta');
    parts.push(meta.join(' · '));

    if (g.life.spend > 0) {
      const alive = g.ads.some(a => a.row?.status === 'ACTIVE' && (a.row?.windows[3].impressions ?? 0) > 0);
      parts.push(`Life: ${g.firstDay ?? '?'} → ${g.lastDay ?? '?'}${g.firstDay && g.lastDay ? ` (${daysBetween(g.firstDay, g.lastDay)} days)` : ''}${alive ? ' · **still delivering**' : g.lastDay && g.lastDay < shiftDays(today, -3) ? ' · stopped' : ''}. ` +
        `Lifetime: ${money0(g.life.spend)} spend · ${int(g.life.impressions)} impressions · CTR ${pct(div(g.life.clicks * 100, g.life.impressions), 2)} · CPC ${money(div(g.life.spend, g.life.clicks))} · Meta leads ${int(g.life.leads)}` +
        ` · GHL: ${int(g.funnel.leads)} leads (${money(div(g.life.spend, g.funnel.leads))}), ${int(g.funnel.appts)} demos (${money(div(g.life.spend, g.funnel.appts))}), ${int(g.funnel.shows)} shown, ${int(g.funnel.closes)} closed.`);
      if (g.isVideo && g.life.plays > 0) {
        parts.push(`Video: hook rate ${pct(div(g.life.views3s * 100, g.life.impressions), 1)} (3-second views ÷ impressions) · hold rate ${pct(div(g.life.thruplays * 100, g.life.views3s), 0)} (ThruPlays ÷ 3-second views) · average watch ${g.life.avgWatch.toFixed(1)}s · watched to the end ${int(g.life.p100)}.`);
      }
      const hist = g.ads.flatMap(a => (a.row?.status_history ?? []).map(ev => ({ ad: a.name, ev }))).sort((p, q) => p.ev.at.localeCompare(q.ev.at));
      if (hist.length) parts.push(`On/off: ${hist.map(h => `${eventLine(h.ev)}${g.ads.length > 1 ? ` [${h.ad}]` : ''}`).join(' → ')}.`);
      if (g.life.spend >= TRAJECTORY_MIN_SPEND && g.weeks.length > 1) {
        const weeks = g.weeks.slice(-MAX_WEEKS);
        parts.push(table(['Week of', 'Spend', 'Impr.', 'CTR', 'Meta leads', 'CPL'], weeks.map(w => [w.start, money0(w.spend), int(w.impressions), pct(div(w.clicks * 100, w.impressions), 2), int(w.leads), money(div(w.spend, w.leads))])));
      }
    }

    const headline = e?.headline ?? g.ads.find(a => a.row?.creative.headline)?.row?.creative.headline ?? null;
    const primary = e?.primary_text ?? g.ads.find(a => a.row?.creative.primary_text)?.row?.creative.primary_text ?? null;
    if (headline) parts.push(`Headline: "${headline}"`);
    if (primary) parts.push(`Primary text: "${primary}"`);
    if (e?.script) parts.push(`**Script:**\n${quote(e.script)}`);
    if (e?.prompt) parts.push(`**Prompt:**\n${quote(e.prompt)}`);
    if (e?.background_notes) parts.push(`Background: ${e.background_notes}`);
    if (e?.notes) parts.push(`**Notes / decisions:** ${e.notes}`);
  }
  return parts.join('\n');
}

function funnelPages(r: MetaReport, windows: readonly WindowDays[]): string {
  if (!r.funnel) return 'Funnel page tracking not connected for this run.';
  const k = LANDING_TO_BOOKING_KPI;
  return [
    `Visits to each page of the funnel (our own tracking, from ${r.funnel[30].landing_tracked_since ?? 'September 2026'}). KPI: landing → booking never below ${k.floorPct}%, aim ${k.targetLowPct}–${k.targetHighPct}%.`,
    table(['Window', 'Landing visits', 'Calendar visits', 'Bookings (thank-you page)', 'Landing → calendar', 'Calendar → booking', 'Landing → booking', 'Verdict'],
      windows.map(w => { const f = r.funnel![w]; const p = f.landing_to_booking_pct;
        return [`L${w}`, int(f.landing_visits), int(f.calendar_visits), int(f.page_bookings), pct(div(f.calendar_visits * 100, f.landing_visits)), pct(div(f.page_bookings * 100, f.calendar_visits)), pct(p),
          !f.landing_visits ? '—' : (p ?? 0) < k.floorPct ? 'BELOW FLOOR' : (p ?? 0) < k.targetLowPct ? 'ABOVE FLOOR, BELOW TARGET' : 'ON TARGET']; })),
  ].join('\n');
}

function onOff(r: MetaReport, perAd = true): string {
  if (!r.status_history_available) return 'Meta did not return the account activity log for this run, so on/off times are unavailable.';
  const parts: string[] = [`Times in ${r.timezone}; the log covers ${r.status_history_since} → ${r.today}.` + (perAd ? '' : ' Per-ad timelines (created, first delivery, every ON / OFF) are on each creative in the library section.')];
  if (perAd) parts.push(table(['Ad name', 'Ad ID', 'Now', 'Last turned ON', 'Last turned OFF', 'Full timeline'], r.ads.map(a => {
    const last = (ev: 'on' | 'off') => [...a.status_history].reverse().find(e => e.event === ev)?.local ?? '—';
    return [a.ad_name, a.ad_id, a.status ?? '—', last('on'), last('off'), a.status_history.length ? a.status_history.map(eventLine).join(' → ') : 'No changes in the log window'];
  })));
  if (r.parent_status_changes.length) {
    parts.push('\n**Ad set / campaign switches** (these turn every ad underneath on or off):');
    parts.push(r.parent_status_changes.map(e => `- ${e.local} — ${e.level} "${e.name}" turned ${e.event === 'on' ? 'ON' : 'OFF'}${e.detail ? ` (${e.detail})` : ''}${e.actor ? ` by ${e.actor}` : ''}`).join('\n'));
  }
  return parts.join('\n');
}

// What changed in the last N days — the heart of the update.
function changes(r: MetaReport, hub: Hub, groups: CreativeGroup[], since: string): string {
  const parts: string[] = [];
  const sinceIso = `${since}T00:00:00Z`;
  const switches = r.ads.flatMap(a => a.status_history.filter(e => e.at >= sinceIso && (e.event === 'on' || e.event === 'off' || e.event === 'first_delivery')).map(e => ({ a, e })))
    .sort((p, q) => p.e.at.localeCompare(q.e.at));
  const parent = r.parent_status_changes.filter(e => e.at >= sinceIso);
  parts.push(`**Switches since ${since}:**`);
  if (!switches.length && !parent.length) parts.push('- No ads, ad sets or campaigns were turned on or off.');
  for (const p of parent) parts.push(`- ${p.local} — ${p.level} "${p.name}" turned ${p.event === 'on' ? 'ON' : 'OFF'}${p.actor ? ` by ${p.actor}` : ''}`);
  for (const s of switches) parts.push(`- ${eventLine(s.e)} — "${s.a.ad_name}" (${s.a.ad_id})`);

  const fresh = r.ads.filter(a => a.first_served && a.first_served >= since);
  if (fresh.length) parts.push(`\n**New ads (created since ${since}):** ${fresh.map(a => `"${a.ad_name}" (${a.ad_id}) in ${a.adset_name}`).join('; ')}.`);

  const newEntries = hub.entries.filter(e => e.created_at >= sinceIso);
  if (newEntries.length) parts.push(`\n**New creatives in the Hub:** ${newEntries.map(e => `${e.code ? e.code + ' ' : ''}${e.name}`).join(', ')} — scripts / prompts below.`);
  const noted = hub.entries.filter(e => e.notes && e.updated_at >= sinceIso && e.created_at < sinceIso);
  if (noted.length) parts.push(`\n**Notes updated:**\n${noted.map(e => `- ${e.code ? e.code + ' ' : ''}${e.name}: ${e.notes}`).join('\n')}`);

  const live = groups.filter(g => g.ads.some(a => a.row?.status === 'ACTIVE' && (a.row.windows[3].impressions ?? 0) > 0));
  parts.push(`\n**Delivering now:** ${live.length ? live.map(g => g.title).join(' · ') : 'nothing is delivering'}.`);
  return parts.join('\n');
}

// ── Build + render ────────────────────────────────────────────────────────

export type BriefOptions = BuildOptions & { service: Service; mode: ReportMode };

export async function buildBriefReport(opts: BriefOptions): Promise<{ report: MetaReport; markdown: string }> {
  const acct = opts.accountId ?? process.env.META_B2B_ACCOUNT_ID ?? 'act_1080664784142903';
  const tomsiId = await getTomsiClientId(opts.service);
  const [report, extras, hub, funnelByAd] = await Promise.all([
    buildMetaReport(opts),
    fetchExtras(acct, opts.token),
    fetchHub(opts.service),
    tomsiId
      ? rollupFunnelByAd(opts.service, { table: 'events', level: 'ad', client_id: tomsiId, bookedIncludesResolved: true }).catch(() => new Map<string, AdFunnel>())
      : Promise.resolve(new Map<string, AdFunnel>()),
  ]);
  const groups = groupCreatives(report, extras, hub, funnelByAd);
  const markdown = opts.mode === 'full' ? renderFull(report, extras, hub, groups) : renderUpdate(report, hub, groups);
  return { report, markdown };
}

function header(r: MetaReport, title: string): string {
  return `# ${title} — ${r.today}\n` +
    `Account ${r.account_id} · windows end ${r.today} (${r.timezone}) · ${r.campaign_filter ? `campaigns: ${r.campaign_filter.join(', ')}` : 'all campaigns'}` +
    ` · per-ad kept demos from ${r.kept_demo_source === 'ghl' ? 'GHL attribution' : r.kept_demo_source === 'meta' ? 'Meta "Schedule Kept" conversion' : 'no source (0)'}`;
}

export function renderFull(r: MetaReport, x: Extras, hub: Hub, groups: CreativeGroup[]): string {
  const sec = { brief: 1, now: 2, history: 3, funnel: 4, adsets: 5, ads: 6, library: 7, pages: 8, onoff: 9 };
  const p: string[] = [];
  p.push(header(r, 'Tomsi Media B2B — full media-buying brief'));
  p.push('');
  p.push(instructions(r, 'full', { ads: sec.ads, history: sec.library }));
  p.push(`\n## ${sec.brief}. The business`);
  p.push(B2B_BRIEF);
  p.push(`\n## ${sec.now}. Where we are right now`);
  p.push(liveNow(r, x, hub));
  p.push(`\n## ${sec.history}. Account history`);
  p.push(history(x));
  p.push(`\n## ${sec.funnel}. Funnel summary — last 30 / 7 / 3 days`);
  for (const w of WINDOWS) p.push('```\n' + accountSummary(r, w) + '\n```');
  p.push(`\n## ${sec.adsets}. Ad sets`);
  p.push(adsetTables(r, [30, 7]));
  p.push(`\n## ${sec.ads}. Ad level — last 7 days (${r.windows[7].since} → ${r.windows[7].until})`);
  p.push(adTable(r));
  p.push(`\n## ${sec.library}. Creative library — every creative, its script and its life`);
  p.push(creativeLibrary(r, groups, r.today));
  p.push(`\n## ${sec.pages}. Funnel pages`);
  p.push(funnelPages(r, [30, 7]));
  p.push(`\n## ${sec.onoff}. Ad set / campaign switches`);
  p.push(onOff(r, false));
  return p.join('\n');
}

export function renderUpdate(r: MetaReport, hub: Hub, groups: CreativeGroup[]): string {
  const since = shiftDays(r.today, -(UPDATE_DAYS - 1));
  const sec = { changes: 1, funnel: 2, adsets: 3, ads: 4, pages: 5, library: 6 };
  const p: string[] = [];
  p.push(header(r, 'Tomsi Media B2B — update'));
  p.push('');
  p.push(instructions(r, 'update', { ads: sec.ads, history: sec.changes }));
  p.push(`\n## ${sec.changes}. What changed in the last ${UPDATE_DAYS} days (${since} → ${r.today})`);
  p.push(changes(r, hub, groups, since));
  p.push(`\n## ${sec.funnel}. Funnel summary`);
  p.push('Last 7 days vs the 7 before:');
  p.push(r.summary.map(s => `- ${s}`).join('\n'));
  for (const w of [7, 3] as const) p.push('```\n' + accountSummary(r, w) + '\n```');
  p.push(`\n## ${sec.adsets}. Ad sets`);
  p.push(adsetTables(r, [7]));
  p.push(`\n## ${sec.ads}. Ad level — last 7 days (${r.windows[7].since} → ${r.windows[7].until})`);
  p.push(adTable(r));
  p.push(`\n## ${sec.pages}. Funnel pages`);
  p.push(funnelPages(r, [7]));
  const sinceIso = `${since}T00:00:00Z`;
  const fresh = groups.filter(g => g.entry && g.entry.created_at >= sinceIso);
  if (fresh.length) {
    p.push(`\n## ${sec.library}. New creatives — script / prompt`);
    for (const g of fresh) {
      const e = g.entry!;
      p.push(`\n### ${g.title}`);
      p.push([e.kind, e.tags ? `tags: ${e.tags}` : null, g.ads.length ? `ads: ${g.ads.map(a => `${a.name} (${a.id})`).join('; ')}` : 'not launched yet'].filter(Boolean).join(' · '));
      if (e.headline) p.push(`Headline: "${e.headline}"`);
      if (e.primary_text) p.push(`Primary text: "${e.primary_text}"`);
      if (e.script) p.push(`**Script:**\n${quote(e.script)}`);
      if (e.prompt) p.push(`**Prompt:**\n${quote(e.prompt)}`);
      if (e.notes) p.push(`**Notes:** ${e.notes}`);
    }
  }
  return p.join('\n');
}
