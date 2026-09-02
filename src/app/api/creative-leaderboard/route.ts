import { NextResponse } from 'next/server';
import { getAuthContext, isAuthError } from '@/lib/api-auth';
import { rollupFunnelByAd, funnelRates, EMPTY_AD_FUNNEL, type AdFunnel, type TouchModel } from '@/lib/ad-funnel';

/**
 * Cross-client creative leaderboard.
 *
 * The same creative is run for many clients under different ad IDs — "Bathroom
 * Script 12" is one piece of work, not ten. Per-account tools can only ever
 * score each copy separately, which splits its record across ten thin samples.
 *
 * Grouping by creative NAME across the whole portfolio pools those samples, so a
 * creative that has produced 60 appointments over 9 clients is judged on 60, not
 * on the 6 it happens to have under one client this month.
 *
 * GET ?level=ad|adset|campaign&model=first|last&start_date=&end_date=&min_spend=
 */

type Row = {
  key: string;
  /** Highest-spend spelling, used as the display name. */
  name: string;
  /** Every distinct spelling pooled under this key, for auditability. */
  spellings: Map<string, number>;
  spend: number;
  impressions: number;
  link_clicks: number;
  client_ids: Set<string>;
  entity_ids: Set<string>;
  funnel: AdFunnel;
};

const LEVEL_NAME: Record<string, 'ad_name' | 'adset_name' | 'campaign_name'> = {
  ad: 'ad_name', adset: 'adset_name', campaign: 'campaign_name',
};
const LEVEL_ID: Record<string, 'ad_id' | 'adset_id' | 'campaign_id'> = {
  ad: 'ad_id', adset: 'adset_id', campaign: 'campaign_id',
};

// Ad names get "– Copy", " - Copy 2", trailing whitespace and case drift as they
// are duplicated between accounts. Fold those so one creative stays one row.
function normaliseName(raw: string): string {
  return raw
    .replace(/\s*[–—-]\s*copy(\s*\d+)?\s*$/i, '')
    .replace(/\s*\(\s*copy(\s*\d+)?\s*\)\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Grouping key that ignores word order.
 *
 * The same creative gets typed differently between accounts — "Bathroom Script
 * 12" and "Script 12 Bathroom" are one piece of work. Sorting the tokens makes
 * both collapse to "12 bathroom script".
 *
 * This is deliberately order-insensitive but still exact on the words
 * themselves, so "Bathroom Script 10" and "Bathroom Script 12" stay apart — the
 * distinguishing token differs. Every pooled spelling is returned on the row so
 * an unintended merge is visible rather than silent.
 */
function poolKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .sort()
    .join(' ');
}

export async function GET(req: Request) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;

  const { searchParams } = new URL(req.url);
  const level      = (searchParams.get('level') ?? 'ad') as 'ad' | 'adset' | 'campaign';
  const model      = (searchParams.get('model') === 'last' ? 'last' : 'first') as TouchModel;
  const start_date = searchParams.get('start_date');
  const end_date   = searchParams.get('end_date');
  const minSpend   = Number(searchParams.get('min_spend')) || 0;

  if (!LEVEL_NAME[level]) {
    return NextResponse.json({ error: "level must be 'ad', 'adset' or 'campaign'" }, { status: 400 });
  }
  const nameCol = LEVEL_NAME[level];
  const idCol   = LEVEL_ID[level];

  // Spend side: every ad entity across every client.
  let q = ctx.service
    .from('ad_campaigns')
    .select(`client_id, ${idCol}, ${nameCol}, spend, impressions, link_clicks`)
    .eq('level', level)
    .not(idCol, 'is', null);
  if (start_date) q = q.gte('report_date', start_date);
  if (end_date)   q = q.lte('report_date', end_date);

  const { data: spendRows, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Funnel side: real CRM outcomes keyed on the same id, across all clients.
  let funnel: Map<string, AdFunnel>;
  try {
    funnel = await rollupFunnelByAd(ctx.service, { table: 'events', level, model, start_date, end_date });
  } catch {
    funnel = new Map();
  }

  const byName = new Map<string, Row>();
  const seenEntity = new Set<string>();

  for (const r of (spendRows ?? []) as unknown as Array<Record<string, unknown>>) {
    const rawName = (r[nameCol] as string | null) ?? '';
    const entityId = r[idCol] as string;
    const name = normaliseName(rawName) || `(unnamed ${level})`;
    const key = poolKey(name) || name.toLowerCase();
    const rowSpend = Number(r.spend) || 0;

    let row = byName.get(key);
    if (!row) {
      row = {
        key, name, spellings: new Map(), spend: 0, impressions: 0, link_clicks: 0,
        client_ids: new Set(), entity_ids: new Set(), funnel: { ...EMPTY_AD_FUNNEL },
      };
      byName.set(key, row);
    }

    // Display the spelling that carries the most spend, so the label matches
    // whichever version is actually running at scale.
    row.spellings.set(name, (row.spellings.get(name) ?? 0) + rowSpend);

    row.spend       += rowSpend;
    row.impressions += Number(r.impressions) || 0;
    row.link_clicks += Number(r.link_clicks) || 0;
    if (r.client_id) row.client_ids.add(r.client_id as string);
    row.entity_ids.add(entityId);

    // Spend rows are per-day, so fold each entity's funnel in exactly once.
    if (!seenEntity.has(entityId)) {
      seenEntity.add(entityId);
      const f = funnel.get(entityId);
      if (f) {
        row.funnel.leads    += f.leads;
        row.funnel.appts    += f.appts;
        row.funnel.shows    += f.shows;
        row.funnel.no_shows += f.no_shows;
        row.funnel.closes   += f.closes;
        row.funnel.revenue  += f.revenue;
      }
    }
  }

  const rows = Array.from(byName.values())
    .filter(r => r.spend >= minSpend)
    .map(r => {
      const spellings = Array.from(r.spellings.entries()).sort((a, b) => b[1] - a[1]);
      return {
      name: spellings[0]?.[0] ?? r.name,
      // Surfaced so a wrong merge is caught by eye instead of trusted blindly.
      pooled_names: spellings.length > 1 ? spellings.map(([n]) => n) : [],
      level,
      model,
      clients: r.client_ids.size,
      variants: r.entity_ids.size,
      spend: r.spend,
      impressions: r.impressions,
      link_clicks: r.link_clicks,
      ...r.funnel,
      ...funnelRates(r.spend, r.funnel),
      };
    })
    .sort((a, b) => {
      // Best cost per appointment first, but only for rows that produced any.
      // Everything with zero appointments sorts after, by spend descending — the
      // expensive silent ones are what you want to see next.
      if (a.appts > 0 && b.appts > 0) return a.cost_per_appt - b.cost_per_appt;
      if (a.appts > 0) return -1;
      if (b.appts > 0) return 1;
      return b.spend - a.spend;
    });

  const totals = rows.reduce((t, r) => ({
    spend: t.spend + r.spend, leads: t.leads + r.leads,
    appts: t.appts + r.appts, closes: t.closes + r.closes, revenue: t.revenue + r.revenue,
  }), { spend: 0, leads: 0, appts: 0, closes: 0, revenue: 0 });

  return NextResponse.json({ level, model, rows, totals });
}
