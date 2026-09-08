import { NextResponse } from 'next/server';
import { getAuthContext, isAuthError } from '@/lib/api-auth';
import { normalizeZip, ZIP_METRIC_EVENTS } from '@/lib/zip-rollup';
import { fetchZipMetrics, type ScoredZipMetrics } from '@/lib/census';

/**
 * Meta targeting brief for one territory session.
 *
 * Facebook can't read prose, so the brief leads with the two things that are
 * actually actionable — a zip list to target and a zip list to exclude, both
 * formatted to paste straight into Ads Manager — and puts the reasoning under
 * them: which zips convert, which ads produced those conversions, and what the
 * winning zips look like demographically for lookalike and detailed targeting.
 *
 * POST { client_id?, client_name?, session_name?, zips: string[], days? }
 *   → { markdown, filename }
 */

const PAGE = 1000;
const MAX_PAGES = 50;
const LIST_LIMIT = 12;         // zips named in the winners / losers tables
const CREATIVE_LIMIT = 10;
// A zip needs this many leads before its close rate is treated as real. Relaxed
// step by step when a territory is too thin to fill a table at the strict bar.
const LEAD_FLOORS = [5, 3, 2, 1];
const MIN_QUALIFYING = 5;

type Row = {
  zip_code: string; event_type: string; revenue: number | null;
  ad_platform: string | null; campaign_name: string | null; campaign_id: string | null;
  adset_name: string | null; adset_id: string | null;
  ad_name: string | null; ad_id: string | null;
  utm_source: string | null; utm_campaign: string | null; utm_content: string | null;
};

type ZipStats = { leads: number; appointments: number; shows: number; closes: number; revenue: number };
type Creative = { label: string; platform: string | null; campaign: string | null; leads: number; closes: number; revenue: number };

const emptyStats = (): ZipStats => ({ leads: 0, appointments: 0, shows: 0, closes: 0, revenue: 0 });

const EVENT_TO_METRIC: Record<string, keyof ZipStats> = {
  [ZIP_METRIC_EVENTS.leads]:        'leads',
  [ZIP_METRIC_EVENTS.appointments]: 'appointments',
  [ZIP_METRIC_EVENTS.shows]:        'shows',
  [ZIP_METRIC_EVENTS.closes]:       'closes',
};

const money = (n: number) =>
  n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M`
  : n >= 1000    ? `$${Math.round(n / 1000)}k`
  : `$${Math.round(n)}`;

const pct = (n: number, d: number) => (d > 0 ? `${Math.round((n / d) * 100)}%` : '—');

function creativeKey(r: Row) {
  return r.ad_id || r.adset_id || r.campaign_id || r.utm_content || r.utm_campaign || r.utm_source || 'unattributed';
}
function creativeLabel(r: Row) {
  return r.ad_name || r.adset_name || r.campaign_name || r.utm_content || r.utm_campaign || r.utm_source || 'Unattributed';
}

function tally(map: Map<string, Creative>, r: Row, metric: keyof ZipStats) {
  const key = creativeKey(r);
  const c = map.get(key) ?? {
    label: creativeLabel(r), platform: r.ad_platform, campaign: r.campaign_name,
    leads: 0, closes: 0, revenue: 0,
  };
  if (metric === 'leads')  c.leads++;
  if (metric === 'closes') { c.closes++; c.revenue += Number(r.revenue) || 0; }
  map.set(key, c);
}

function creativeTable(map: Map<string, Creative>): string {
  const rows = [...map.values()]
    .sort((a, b) => b.closes - a.closes || b.leads - a.leads)
    .slice(0, CREATIVE_LIMIT);
  if (!rows.length) return '_No ad attribution on these events._\n';

  return [
    '| Ad / creative | Platform | Campaign | Leads | Closes | Revenue |',
    '|---|---|---|---:|---:|---:|',
    ...rows.map(c => `| ${c.label} | ${c.platform ?? '—'} | ${c.campaign ?? '—'} | ${c.leads} | ${c.closes} | ${c.revenue > 0 ? money(c.revenue) : '—'} |`),
  ].join('\n') + '\n';
}

export async function POST(req: Request) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;

  const body = await req.json().catch(() => ({}));
  const clientId    = typeof body.client_id === 'string' ? body.client_id : null;
  const clientName  = (body.client_name || 'Unassigned session') as string;
  const sessionName = (body.session_name || 'Territory') as string;
  const days        = Math.min(Math.max(Number(body.days) || 90, 7), 730);

  const territory = [...new Set(
    (Array.isArray(body.zips) ? body.zips : []).map(normalizeZip).filter(Boolean) as string[]
  )].sort();

  if (!territory.length) {
    return NextResponse.json({ error: 'No zips in this session' }, { status: 400 });
  }

  const since = new Date(Date.now() - days * 86_400_000).toISOString();

  // ── The client's own funnel inside this territory, over the window ──────────
  const stats = new Map<string, ZipStats>();
  const overall = new Map<string, Creative>();
  const perZipCreatives = new Map<string, Map<string, Creative>>();

  if (clientId) {
    for (let page = 0; page < MAX_PAGES; page++) {
      const { data, error } = await ctx.service
        .from('events')
        .select('zip_code, event_type, revenue, ad_platform, campaign_name, campaign_id, adset_name, adset_id, ad_name, ad_id, utm_source, utm_campaign, utm_content')
        .eq('client_id', clientId)
        .not('zip_code', 'is', null)
        .in('event_type', Object.values(ZIP_METRIC_EVENTS))
        .gte('occurred_at', since)
        .range(page * PAGE, page * PAGE + PAGE - 1);

      if (error || !data?.length) break;

      for (const raw of data as Row[]) {
        const zip = normalizeZip(raw.zip_code);
        const metric = EVENT_TO_METRIC[raw.event_type];
        if (!zip || !metric || !territory.includes(zip)) continue;

        const s = stats.get(zip) ?? emptyStats();
        s[metric]++;
        if (metric === 'closes') s.revenue += Number(raw.revenue) || 0;
        stats.set(zip, s);

        tally(overall, raw, metric);
        const perZip = perZipCreatives.get(zip) ?? new Map<string, Creative>();
        tally(perZip, raw, metric);
        perZipCreatives.set(zip, perZip);
      }

      if (data.length < PAGE) break;
    }
  }

  // ── Winners and losers ─────────────────────────────────────────────────────
  const withData = [...stats.entries()].filter(([, s]) => s.leads > 0);

  let floor = LEAD_FLOORS[LEAD_FLOORS.length - 1];
  for (const f of LEAD_FLOORS) {
    if (withData.filter(([, s]) => s.leads >= f).length >= MIN_QUALIFYING) { floor = f; break; }
  }

  const qualifying = withData.filter(([, s]) => s.leads >= floor);

  const winners = [...qualifying]
    .sort(([, a], [, b]) =>
      (b.closes / b.leads) - (a.closes / a.leads) ||
      (b.appointments / b.leads) - (a.appointments / a.leads) ||
      b.leads - a.leads)
    .filter(([, s]) => s.closes > 0 || s.appointments > 0)
    .slice(0, LIST_LIMIT);

  const losers = [...qualifying]
    .filter(([zip, s]) => s.closes === 0 && !winners.some(([w]) => w === zip))
    .sort(([, a], [, b]) => b.leads - a.leads)
    .slice(0, LIST_LIMIT);

  // ── Census profile for the zips actually named ─────────────────────────────
  const named = [...new Set([...winners, ...losers].map(([zip]) => zip))];
  let demo: Record<string, ScoredZipMetrics> = {};
  try { demo = await fetchZipMetrics(named); } catch { demo = {}; }

  const totals = [...stats.values()].reduce((a, s) => ({
    leads: a.leads + s.leads, appointments: a.appointments + s.appointments,
    shows: a.shows + s.shows, closes: a.closes + s.closes, revenue: a.revenue + s.revenue,
  }), emptyStats());

  // ── Compose ────────────────────────────────────────────────────────────────
  const today = new Date().toLocaleDateString('en-US', { day: 'numeric', month: 'long', year: 'numeric' });
  const targetList  = winners.map(([z]) => z).join(', ');
  const excludeList = losers.map(([z]) => z).join(', ');

  const md: string[] = [];

  md.push(`# ${clientName} — ${sessionName}`);
  md.push(`**Meta targeting brief** · generated ${today} · last ${days} days · ${territory.length} zips in territory\n`);

  md.push(`## Target these ZIPs\n`);
  md.push(targetList
    ? `Paste into Ads Manager → Locations → Add locations in bulk.\n\n\`\`\`\n${targetList}\n\`\`\`\n`
    : `_Not enough closed or booked business in this window to name winning zips yet._\n`);

  md.push(`## Exclude these ZIPs\n`);
  md.push(excludeList
    ? `These produced leads and no closes. Paste into Locations → Exclude.\n\n\`\`\`\n${excludeList}\n\`\`\`\n`
    : `_No zip has enough leads without a close to be worth excluding yet._\n`);

  md.push(`## Territory at a glance\n`);
  md.push([
    `| Metric | Value |`, `|---|---:|`,
    `| Leads | ${totals.leads} |`,
    `| Appointments | ${totals.appointments} (${pct(totals.appointments, totals.leads)} of leads) |`,
    `| Shows | ${totals.shows} |`,
    `| Closes | ${totals.closes} (${pct(totals.closes, totals.leads)} of leads) |`,
    `| Revenue | ${money(totals.revenue)} |`,
    `| Zips with lead history | ${withData.length} of ${territory.length} |`,
    `| Minimum leads to qualify | ${floor} |`,
  ].join('\n') + '\n');

  const zipTable = (rows: [string, ZipStats][]) => [
    `| ZIP | Leads | Appts | Closes | Close rate | Revenue | Median income | Home value | Owner-occ |`,
    `|---|---:|---:|---:|---:|---:|---:|---:|---:|`,
    ...rows.map(([zip, s]) => {
      const d = demo[zip];
      return `| ${zip} | ${s.leads} | ${s.appointments} | ${s.closes} | ${pct(s.closes, s.leads)} | ${s.revenue > 0 ? money(s.revenue) : '—'} | ${d?.median_income ? money(d.median_income) : '—'} | ${d?.home_value ? money(d.home_value) : '—'} | ${d ? `${Math.round(d.owner_pct)}%` : '—'} |`;
    }),
  ].join('\n') + '\n';

  md.push(`## Winning ZIPs\n`);
  md.push(winners.length ? zipTable(winners) : `_None yet._\n`);

  md.push(`## Losing ZIPs\n`);
  md.push(losers.length ? zipTable(losers) : `_None yet._\n`);

  md.push(`## What's working — ads & creatives\n`);
  md.push(`### Across the whole territory\n`);
  md.push(creativeTable(overall));

  if (winners.length) {
    md.push(`### Inside the winning ZIPs\n`);
    const winnerCreatives = new Map<string, Creative>();
    for (const [zip] of winners) {
      for (const [key, c] of perZipCreatives.get(zip) ?? []) {
        const existing = winnerCreatives.get(key);
        if (existing) {
          existing.leads += c.leads; existing.closes += c.closes; existing.revenue += c.revenue;
        } else {
          winnerCreatives.set(key, { ...c });
        }
      }
    }
    md.push(creativeTable(winnerCreatives));
  }

  // Audience profile — what the winning zips have in common, for lookalikes and
  // detailed targeting.
  const profile = winners.map(([zip]) => demo[zip]).filter(Boolean) as ScoredZipMetrics[];
  if (profile.length) {
    const avg = (f: (m: ScoredZipMetrics) => number) => profile.reduce((s, m) => s + f(m), 0) / profile.length;
    md.push(`## Audience profile of the winning ZIPs\n`);
    md.push([
      `| Trait | Average |`, `|---|---:|`,
      `| Median household income | ${money(avg(m => m.median_income))} |`,
      `| Median home value | ${money(avg(m => m.home_value))} |`,
      `| Owner-occupied | ${Math.round(avg(m => m.owner_pct))}% |`,
      `| Aged 45–64 | ${Math.round(avg(m => m.prime_age_pct) * 100)}% |`,
      `| In home 10+ years | ${Math.round(avg(m => m.long_term_pct) * 100)}% |`,
      `| Median year built | ${Math.round(avg(m => m.median_year))} |`,
    ].join('\n') + '\n');
  }

  md.push(`## How to use this\n`);
  md.push([
    `1. **Targeting** — paste the target list into Locations. Turn off "Include people living in or recently in this location"'s wider options so it holds the zips.`,
    `2. **Exclusions** — paste the exclude list into Locations → Exclude, so spend stops reaching zips that produce leads and no work.`,
    `3. **Creative** — scale the ads at the top of the winning-zips table; they are already producing closes in the areas you want more of.`,
    `4. **Lookalikes** — the audience profile above describes who is actually buying. Build a value-based lookalike from your closed customers and let the profile guide detailed-targeting layers.`,
    `5. **Feeding the algorithm** — the strongest signal is sending closes back to Meta with their revenue, so it optimises for customers rather than form fills. That needs the offline conversions / CAPI upload, which this brief does not do on its own.`,
  ].join('\n') + '\n');

  md.push(`---\n`);
  md.push(`_Zips are ranked on close rate, with a minimum of ${floor} lead${floor === 1 ? '' : 's'} to qualify. Demographics are US Census (ACS 5-year). Revenue reflects closes recorded in the dashboard over the window._\n`);

  const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

  return NextResponse.json({
    markdown: md.join('\n'),
    filename: `${slug(clientName)}-${slug(sessionName)}-meta-brief.md`,
  });
}
