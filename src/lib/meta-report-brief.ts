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
import { fetchTextRows, rankTexts, type TextRow } from './copy-performance';
import {
  buildMetaReport, accountSummary, LANDING_TO_BOOKING_KPI,
  type BuildOptions, type MetaReport, type AdRow, type StatusEvent, type WindowDays,
} from './meta-report';

type Service = ReturnType<typeof createServiceClient>;
export type ReportMode = 'full' | 'update';

const GRAPH = 'https://graph.facebook.com/v19.0';
const UPDATE_DAYS = 7;
const TRAJECTORY_MIN_SPEND = 100;   // creatives below this get a one-line life, not a weekly table
const MAX_WEEKS = 12;

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
  lifetime: Map<string, Lifetime & { name: string; adset: string; campaign: string }>;
  weekly: Map<string, Week[]>;
  campaigns: Budgeted[];
  adsets: (Budgeted & { campaign_id: string })[];
  copyByAd: Map<string, { body: string; title: string }>;   // every ad's primary text + headline
  textRows: TextRow[];                                       // Meta's per-text split, every campaign
};

async function fetchExtras(acct: string, token: string): Promise<Extras> {
  const base = 'spend,impressions,inline_link_clicks,actions';
  const [monthly, lifetime, weekly, campaigns, adsets, adCreatives] = await Promise.all([
    safe(graph<Insight>(`/${acct}/insights`, { date_preset: 'maximum', time_increment: 'monthly', fields: base }, token)),
    safe(graph<Insight>(`/${acct}/insights`, { level: 'ad', date_preset: 'maximum',
      fields: `ad_id,ad_name,adset_name,campaign_name,reach,${base},video_play_actions,video_thruplay_watched_actions,video_avg_time_watched_actions,video_p100_watched_actions` }, token)),
    safe(graph<Insight>(`/${acct}/insights`, { level: 'ad', date_preset: 'maximum', time_increment: '7', fields: `ad_id,${base}` }, token)),
    safe(graph<{ id: string; name: string; effective_status?: string; daily_budget?: string; lifetime_budget?: string; bid_strategy?: string; objective?: string }>(
      `/${acct}/campaigns`, { fields: 'id,name,effective_status,daily_budget,lifetime_budget,bid_strategy,objective' }, token)),
    safe(graph<{ id: string; name: string; effective_status?: string; daily_budget?: string; lifetime_budget?: string; campaign_id: string; optimization_goal?: string;
      targeting?: { age_min?: number; age_max?: number; geo_locations?: { countries?: string[] }; targeting_automation?: { advantage_audience?: number } } }>(
      `/${acct}/adsets`, { fields: 'id,name,effective_status,daily_budget,lifetime_budget,campaign_id,optimization_goal,targeting{age_min,age_max,geo_locations,targeting_automation}' }, token)),
    safe(graph<{ id: string; creative?: { title?: string; body?: string; object_story_spec?: { link_data?: { message?: string; name?: string }; video_data?: { message?: string; title?: string } }; asset_feed_spec?: { bodies?: { text?: string }[]; titles?: { text?: string }[] } } }>(
      `/${acct}/ads`, { fields: 'id,creative{title,body,object_story_spec,asset_feed_spec}' }, token)),
  ]);
  const textRows = await fetchTextRows(token, campaigns.map(c => c.id));
  const copyByAd = new Map<string, { body: string; title: string }>();
  for (const a of adCreatives) {
    const c = a.creative ?? {}; const oss = c.object_story_spec ?? {}; const afs = c.asset_feed_spec ?? {};
    const body = (c.body ?? oss.link_data?.message ?? oss.video_data?.message ?? afs.bodies?.[0]?.text ?? '').replace(/\s+/g, ' ').trim();
    const title = (c.title ?? oss.link_data?.name ?? oss.video_data?.title ?? afs.titles?.[0]?.text ?? '').replace(/\s+/g, ' ').trim();
    copyByAd.set(a.id, { body, title });
  }

  const life = new Map<string, Lifetime & { name: string; adset: string; campaign: string }>();
  for (const r of lifetime) {
    if (!r.ad_id) continue;
    life.set(r.ad_id, {
      name: r.ad_name ?? '', adset: r.adset_name ?? r.campaign_name ?? '', campaign: r.campaign_name ?? '', spend: num(r.spend), impressions: num(r.impressions), reach: num(r.reach), clicks: num(r.inline_link_clicks),
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
    copyByAd, textRows,
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
      ? '> You are the media buyer for this account. This document is everything you need: the business, the funnel, the targets, what is live, what changed this week, every creative with its script and its results, and the last 30 / 7 / 3 days. It is regenerated live each time it is fetched. Read it all before answering.'
      : '> You already have the full brief for this account from earlier in this conversation. This is the periodic update: what changed and the latest numbers. Apply the same targets and the same answer format as before.',
    '>',
    `> **Definitions.** L30 / L7 / L3 = last 30 / 7 / 3 days ending ${r.today}. A *demo* is a booked sales call; a *kept demo* is one that showed. *Control* = the best ad in L7 (named in the ad-level section). Ad-level window numbers are L7; lifetime numbers are marked as such.`,
    '>',
    `> **KPI targets (compare every number to these):** cost per booked demo ≤ $90 · cost per lead ≤ $70 · link CTR > 1.0% · CPC ≤ $2.50 · landing page → booking never below ${k.floorPct}%, aiming for ${k.targetLowPct}–${k.targetHighPct}% (below ${k.floorPct}% is a funnel problem — page or offer — not a media problem). Priority order: cost per booked demo → cost per lead → CTR/CPC. **Every kill / keep / control rule runs on demos BOOKED.** Kept demos (showed up), show rate and closes are context for the funnel and sales read — never a reason to pause an ad. Fake leads and fake demos marked in the dashboard are already excluded from every GHL number here.`,
    '>',
    '> **Missing data rule.** If the ad table says per-ad demos are unavailable, treat demos as MISSING, not zero: never pause or rank an ad on demos in that case — fall back to CPL, CTR and CPC and say so. GHL ad attribution (leads / demos per ad) only exists from September 2026; earlier creatives have Meta lead counts only.',
    '>',
    `> **Use the computed verdicts.** The "OS verdict" column in section ${sec.ads} applies the weekly operating system's control / kill / watch / learning rules on L7, all on demos booked — it is the primary pause/keep signal; do not re-derive it. The control is named above that table. Always quote the exact ad name AND ad ID (names repeat across variants). Before judging an ad on L7 / L3, check the on/off history (section ${sec.history}): an ad switched off mid-window has low spend because it was off, not because it failed.`,
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

// The operating system's per-ad rules, on the L7 window:
//   control  = lowest cost per booked demo with ≥ 2 demos
//   kill     = ≥ 1,000 impressions and link CTR < half the control's, or ≥ $135 spend and 0 demos
//   watch    = ≥ $90 spend and 0 demos (one more day or two before it hits $135)
//   learning = under $90 and under 1,000 impressions
const OS = { control_min_demos: 2, kill_spend: 135, watch_spend: 90, eval_impr: 1000, eval_spend: 90 } as const;

function adTable(r: MetaReport): string {
  const parts: string[] = [];
  const served = r.ads.filter(a => a.windows[7].impressions > 0 || a.windows[7].spend > 0);
  const idle = r.ads.length - served.length;
  if (idle) parts.push(`${idle} ad${idle === 1 ? '' : 's'} from the last 30 days did not serve in L7 and ${idle === 1 ? 'is' : 'are'} left out of this table (they are in the creative library).`);
  if (!served.length) { parts.push('No ad served in the last 7 days.'); return parts.join('\n'); }

  const booked = (a: AdRow, w: WindowDays) => r.funnel?.[w].demos_by_ad[a.ad_id] ?? 0;
  const cpd = (a: AdRow, w: WindowDays) => div(a.windows[w].spend, booked(a, w));
  const hasAttribution = r.kept_demo_source === 'ghl' || served.some(a => booked(a, 7) > 0);

  // Control per the operating system; the report's own control (best kept-demo cost, else best CTR) is the fallback.
  const eligible = served.filter(a => booked(a, 7) >= OS.control_min_demos);
  const osControl = eligible.sort((p, q) => (cpd(p, 7) ?? Infinity) - (cpd(q, 7) ?? Infinity))[0] ?? null;
  // No ad with 2+ booked demos → the best link CTR stands in (never kept demos).
  const control = osControl ?? r.ads.find(a => a.ad_id === r.control.best_ctr_ad_id) ?? null;
  const controlCtr = control?.windows[7].ctr_link ?? null;

  const verdict = (a: AdRow): string => {
    const m = a.windows[7];
    if (control && a.ad_id === control.ad_id) return 'CONTROL';
    const reasons: string[] = [];
    if (controlCtr != null && m.impressions >= OS.eval_impr && (m.ctr_link ?? 0) < controlCtr / 2) reasons.push(`CTR ${pct(m.ctr_link, 2)} < half control`);
    if (hasAttribution && m.spend >= OS.kill_spend && booked(a, 7) === 0) reasons.push(`${money0(m.spend)} and 0 demos`);
    if (reasons.length) return `KILL — ${reasons.join('; ')}`;
    if (hasAttribution && m.spend >= OS.watch_spend && booked(a, 7) === 0) return `WATCH — ${money0(m.spend)} and 0 demos (kill at $${OS.kill_spend})`;
    if (m.spend < OS.eval_spend && m.impressions < OS.eval_impr) return 'LEARNING — not enough data';
    if (control && hasAttribution && booked(a, 7) > 0 && cpd(a, 7) != null && cpd(control, 7) != null && cpd(a, 7)! >= cpd(control, 7)! * 1.3) return `WEAK — cost/demo ${money0(cpd(a, 7))} is 30%+ worse than control`;
    return 'KEEP';
  };

  parts.push(control
    ? `**Control (operating-system rule, L7):** "${control.ad_name}" (${control.ad_id}) — ${osControl ? `${booked(control, 7)} demos booked at ${money0(cpd(control, 7))} each` : 'no ad has 2+ booked demos in L7, so the best link CTR stands in as control'}, link CTR ${pct(controlCtr, 2)}.`
    : '**Control:** none — nothing served enough to be a control this week.');
  if (!hasAttribution) parts.push('**Per-ad demos are unavailable this run** (no GHL ad attribution in the window): the demo-based rules are not applied; judge on CTR, CPC and CPL.');

  parts.push(table(
    ['Ad set', 'Ad name', 'Ad ID', 'Now', 'L7 spend', 'Impr.', 'CTR (link)', 'CPC', 'Leads', 'CPL', 'Demos booked', 'Cost/demo', 'Kept (info)', 'L3 spend / demos', 'OS verdict'],
    served.sort((p, q) => q.windows[7].spend - p.windows[7].spend).map(a => { const m = a.windows[7]; return [
      a.adset_name, a.ad_name, a.ad_id, a.status ?? '—',
      money(m.spend), int(m.impressions), pct(m.ctr_link, 2), money(m.cpc_link), int(m.leads), money(m.cost_per_lead),
      int(booked(a, 7)), money(cpd(a, 7)), int(m.kept_demos), `${money0(a.windows[3].spend)} / ${int(booked(a, 3))}`,
      verdict(a)]; }),
  ));
  parts.push(`OS verdict = the weekly system's rules computed on L7: CONTROL = lowest cost per booked demo with ≥ ${OS.control_min_demos} demos · KILL = ≥ ${int(OS.eval_impr)} impressions and link CTR under half the control's, or ≥ $${OS.kill_spend} with 0 demos · WATCH = ≥ $${OS.watch_spend} with 0 demos · WEAK = cost per demo 30%+ worse than control · LEARNING = under $${OS.eval_spend} and under ${int(OS.eval_impr)} impressions. "Leads" and "Demos booked" are GHL (CRM) numbers attributed to the ad, with fake leads / fake demos excluded; every rule runs on demos booked. "Kept" = demos that showed — context only, never a pause reason.`);
  return parts.join('\n');
}

// One creative = a Hub entry (with every ad linked to it) or, for ads with no
// entry, the ad itself. Lifetime numbers are summed across its ads.
type CreativeGroup = {
  key: string; title: string; entry: HubEntry | null; campaign: string; ads: { id: string; name: string; row: AdRow | null }[];
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
      g = { key, title: entry ? `${entry.code ? entry.code + ' — ' : ''}${entry.name}` : `${name}${adset ? ` · ${adset}` : ''}`, entry, campaign: lt?.campaign || row?.campaign_name || '', ads: [], life: blank(), funnel: { ...EMPTY_AD_FUNNEL }, weeks: [], firstDay: null, lastDay: null, isVideo: false };
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
      groups.set(`e:${e.id}`, { key: `e:${e.id}`, title: `${e.code ? e.code + ' — ' : ''}${e.name}`, entry: e, campaign: '', ads: [], life: blank(), funnel: { ...EMPTY_AD_FUNNEL }, weeks: [], firstDay: null, lastDay: null, isVideo: /video|head|ugc|voice/i.test(e.kind ?? '') });
    }
  }
  return [...groups.values()].sort((a, b) => b.life.spend - a.life.spend || a.title.localeCompare(b.title));
}

// The copy is the same on nearly every remodeler ad, so it is printed once and a
// creative only repeats it when its own differs.
function standardCopy(r: MetaReport): { headline: string | null; primary: string | null } {
  const mode = (vals: (string | null)[]) => {
    const n = new Map<string, number>();
    for (const v of vals) if (v) n.set(v, (n.get(v) ?? 0) + 1);
    return [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  };
  return { headline: mode(r.ads.map(a => a.creative.headline)), primary: mode(r.ads.map(a => a.creative.primary_text)) };
}

const shortDate = (local: string) => local.replace(/,\s*\d{4}.*$/, '').replace(/^(\w{3}) (\d+)$/, '$1 $2');

function creativeLibrary(r: MetaReport, x: Extras, groups: CreativeGroup[], today: string): string {
  const parts: string[] = [];
  const std = standardCopy(r);
  parts.push(`One block per creative, biggest lifetime spend first. "GHL" = real CRM outcomes attributed to the ad (first touch; a demo counts whether it later showed or not); "Meta leads" = Meta's count. "Weeks" shows how long a creative worked before it faded or was turned off: week start · spend · Meta leads. Prompts and scripts are what each creative was made from — model new ones on what worked.`);
  if (std.headline || std.primary) parts.push(`\n**Standard copy on every ad unless noted** — headline: "${std.headline ?? '—'}" · primary text: "${std.primary ?? '—'}"`);

  const scored = groups.filter(g => g.entry && g.life.spend > 0);
  parts.push('\n### Scoreboard (lifetime)');
  parts.push(table(['Creative', 'Kind', 'Days live', 'Spend', 'CTR', 'Meta leads', 'GHL leads', 'CPL', 'Demos', 'Cost/demo', 'Hook / hold / watch'],
    scored.map(g => [g.title, g.entry?.kind ?? (g.isVideo ? 'Video' : 'Image'), g.firstDay && g.lastDay ? String(daysBetween(g.firstDay, g.lastDay)) : '—',
      money0(g.life.spend), pct(div(g.life.clicks * 100, g.life.impressions), 2), int(g.life.leads), int(g.funnel.leads), money(div(g.life.spend, g.funnel.leads || g.life.leads), 0),
      int(g.funnel.appts), money(div(g.life.spend, g.funnel.appts), 0),
      g.isVideo && g.life.plays ? `${pct(div(g.life.views3s * 100, g.life.impressions), 0)} / ${pct(div(g.life.thruplays * 100, g.life.views3s), 0)} / ${g.life.avgWatch.toFixed(0)}s` : '—'])));

  // Everything that predates the Hub, rolled up by campaign: the eras, not the ads.
  const eras = new Map<string, { spend: number; impressions: number; clicks: number; leads: number; first: string; last: string; ads: number }>();
  for (const g of groups.filter(g => !g.entry && g.life.spend > 0)) {
    const k = g.campaign || 'Unknown campaign';
    const e = eras.get(k) ?? { spend: 0, impressions: 0, clicks: 0, leads: 0, first: g.firstDay ?? '', last: g.lastDay ?? '', ads: 0 };
    e.spend += g.life.spend; e.impressions += g.life.impressions; e.clicks += g.life.clicks; e.leads += g.life.leads; e.ads++;
    if (g.firstDay && (!e.first || g.firstDay < e.first)) e.first = g.firstDay;
    if (g.lastDay && g.lastDay > e.last) e.last = g.lastDay;
    eras.set(k, e);
  }
  if (eras.size) {
    parts.push('\n### Earlier campaigns (ads with no Hub record, rolled up)');
    parts.push(table(['Campaign', 'Ran', 'Ads', 'Spend', 'CTR', 'Meta leads', 'CPL'],
      [...eras.entries()].sort((a, b) => a[1].first.localeCompare(b[1].first)).map(([k, e]) => [k, `${e.first || '?'} → ${e.last || '?'}`, String(e.ads), money0(e.spend), pct(div(e.clicks * 100, e.impressions), 2), int(e.leads), money(div(e.spend, e.leads), 0)])));
  }

  for (const g of groups.filter(g => g.entry)) {
    const e = g.entry!;
    parts.push(`\n### ${g.title}`);
    const meta: string[] = [];
    if (e.kind) meta.push(e.kind);
    if (e.tags) meta.push(`tags: ${e.tags}`);
    meta.push(g.ads.length ? `ads: ${g.ads.map(a => `${a.id}${a.row?.status ? ' ' + a.row.status : ''}`).join(', ')}` : 'not launched — no ad in Meta');
    parts.push(meta.join(' · '));

    if (g.life.spend > 0) {
      const alive = g.ads.some(a => a.row?.status === 'ACTIVE' && (a.row?.windows[3].impressions ?? 0) > 0);
      parts.push(`Ran ${g.firstDay ?? '?'} → ${g.lastDay ?? '?'}${g.firstDay && g.lastDay ? ` (${daysBetween(g.firstDay, g.lastDay)} days)` : ''}${alive ? ', **still delivering**' : g.lastDay && g.lastDay < shiftDays(today, -3) ? ', stopped' : ''}. ` +
        `${money0(g.life.spend)} · CTR ${pct(div(g.life.clicks * 100, g.life.impressions), 2)} · CPC ${money(div(g.life.spend, g.life.clicks))} · Meta leads ${int(g.life.leads)}` +
        ` · GHL ${int(g.funnel.leads)} leads / ${int(g.funnel.appts)} demos / ${int(g.funnel.shows)} shown / ${int(g.funnel.closes)} closed` +
        (g.isVideo && g.life.plays > 0 ? ` · video: hook ${pct(div(g.life.views3s * 100, g.life.impressions), 0)}, hold ${pct(div(g.life.thruplays * 100, g.life.views3s), 0)}, avg watch ${g.life.avgWatch.toFixed(0)}s` : '') + '.');
      const hist = g.ads.flatMap(a => (a.row?.status_history ?? []).filter(ev => ev.event === 'on' || ev.event === 'off')).sort((p, q) => p.at.localeCompare(q.at));
      if (hist.length) parts.push(`Switches: ${hist.map(ev => `${ev.event.toUpperCase()} ${shortDate(ev.local)}`).join(', ')}.`);
      if (g.life.spend >= TRAJECTORY_MIN_SPEND && g.weeks.length > 1) {
        parts.push(`Weeks: ${g.weeks.slice(-MAX_WEEKS).map(w => `${w.start.slice(5)} ${money0(w.spend)}/${w.leads}`).join(' · ')}.`);
      }
    }

    const headline = e.headline ?? g.ads.find(a => a.row?.creative.headline)?.row?.creative.headline ?? null;
    const primary = e.primary_text ?? g.ads.find(a => a.row?.creative.primary_text)?.row?.creative.primary_text ?? null;
    if (headline && headline !== std.headline) parts.push(`Headline: "${headline}"`);
    if (primary && primary !== std.primary) parts.push(`Primary text: "${primary}"`);
    if (e.script) parts.push(`**Script:**\n${quote(e.script)}`);
    if (e.prompt) parts.push(`**Prompt:**\n${quote(e.prompt)}`);
    if (e.background_notes) parts.push(`Background: ${e.background_notes}`);
    if (e.notes) parts.push(`**Notes / decisions:** ${e.notes}`);
  }
  void x;
  return parts.join('\n');
}

// Lifetime results grouped by the words on the ad (primary text + headline),
// across every ad that ever ran. Copies ran in different periods on different
// creatives, so this is evidence, not a clean split test — the note says so.
function copyPerformance(x: Extras): string {
  type Acc = { body: string; title: string; spend: number; impressions: number; clicks: number; leads: number; ads: number; first: string; last: string };
  const g = new Map<string, Acc>();
  for (const [id, lt] of x.lifetime) {
    const c = x.copyByAd.get(id);
    if (!c || lt.spend <= 0) continue;
    const key = `${c.body}||${c.title}`;
    const weeks = x.weekly.get(id)?.filter(w => w.spend > 0) ?? [];
    const a = g.get(key) ?? { body: c.body, title: c.title, spend: 0, impressions: 0, clicks: 0, leads: 0, ads: 0, first: '', last: '' };
    a.spend += lt.spend; a.impressions += lt.impressions; a.clicks += lt.clicks; a.leads += lt.leads; a.ads++;
    const f = weeks[0]?.start ?? '', l = weeks[weeks.length - 1]?.end ?? '';
    if (f && (!a.first || f < a.first)) a.first = f;
    if (l && l > a.last) a.last = l;
    g.set(key, a);
  }
  const rows = [...g.values()].filter(a => a.spend >= 50).sort((p, q) => q.spend - p.spend);
  const parts: string[] = [];
  if (rows.length) {
    parts.push('**By ad copy** — every ad that ever ran, grouped by the words on it (first primary text + headline), lifetime. Copies ran in different periods on different creatives, so treat this as evidence, not a split test: to settle it, run two copies on the same creative in the same week.');
    parts.push(table(['Primary text (start)', 'Headline', 'Ran', 'Ads', 'Spend', 'CTR', 'CPC', 'Leads (Meta)', 'CPL'],
      rows.map(a => [a.body.slice(0, 90) + (a.body.length > 90 ? '…' : ''), a.title || '—', a.first && a.last ? `${a.first.slice(0, 7)} → ${a.last.slice(0, 7)}` : '—', String(a.ads),
        money0(a.spend), pct(div(a.clicks * 100, a.impressions), 2), money(div(a.spend, a.clicks)), int(a.leads), money(div(a.spend, a.leads), 0)])));
  }
  // Meta's own per-text split: ads that rotate several texts report each text separately.
  for (const [kind, label] of [['body', 'primary text'], ['title', 'headline'], ['description', 'description']] as const) {
    const ranked = rankTexts(x.textRows, kind).filter(t => t.spend >= 20);
    if (!ranked.length) continue;
    parts.push(`\n**By individual ${label}** — Meta's own split for ads that rotate several texts (an ad with five primary texts reports each one separately). Lifetime, every campaign.`);
    parts.push(table([label.charAt(0).toUpperCase() + label.slice(1), 'Ads', 'Spend', 'Impr.', 'CTR', 'CPC', 'Leads (Meta)', 'CPL'],
      ranked.slice(0, 12).map(t => [t.text.replace(/\s+/g, ' ').slice(0, 100) + (t.text.length > 100 ? '…' : ''), String(t.ads), money0(t.spend), int(t.impressions), pct(t.ctr, 2), money(t.cpc), int(t.leads), t.leads ? money(t.cost_per_lead, 0) : '—'])));
  }
  return parts.length ? parts.join('\n') : 'No copy history available.';
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
  const sec = { brief: 1, now: 2, changes: 3, history: 4, funnel: 5, adsets: 6, ads: 7, library: 8, copy: 9, pages: 10, onoff: 11 };
  const since = shiftDays(r.today, -(UPDATE_DAYS - 1));
  const p: string[] = [];
  p.push(header(r, 'Tomsi Media B2B — full media-buying brief'));
  p.push('');
  p.push(instructions(r, 'full', { ads: sec.ads, history: sec.library }));
  p.push(`\n## ${sec.brief}. The business`);
  p.push(B2B_BRIEF);
  p.push(`\n## ${sec.now}. Where we are right now`);
  p.push(liveNow(r, x, hub));
  p.push(`\n## ${sec.changes}. What changed in the last ${UPDATE_DAYS} days (${since} → ${r.today})`);
  p.push(changes(r, hub, groups, since));
  p.push('\nLast 7 days vs the 7 before:');
  p.push(r.summary.map(s => `- ${s}`).join('\n'));
  p.push(`\n## ${sec.history}. Account history`);
  p.push(history(x));
  p.push(`\n## ${sec.funnel}. Funnel summary — last 30 / 7 / 3 days`);
  for (const w of [30, 7, 3] as const) p.push('```\n' + accountSummary(r, w) + '\n```');
  p.push(`\n## ${sec.adsets}. Ad sets`);
  p.push(adsetTables(r, [30, 7]));
  p.push(`\n## ${sec.ads}. Ad level — last 7 days (${r.windows[7].since} → ${r.windows[7].until})`);
  p.push(adTable(r));
  p.push(`\n## ${sec.library}. Creative library — every creative, its script and its life`);
  p.push(creativeLibrary(r, x, groups, r.today));
  p.push(`\n## ${sec.copy}. Copy performance — which words worked`);
  p.push(copyPerformance(x));
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
