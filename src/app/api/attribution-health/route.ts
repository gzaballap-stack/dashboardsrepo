import { NextResponse } from 'next/server';
import { getAuthContext, isAuthError } from '@/lib/api-auth';

/**
 * Attribution coverage monitor.
 *
 * Attribution can stop arriving without anything looking broken — no error, no
 * failed run, just events landing with empty ad fields. That failure mode is
 * invisible in every downstream report: spend still shows, leads still show,
 * and the join between them quietly returns nothing.
 *
 * This measures the one number that would have surfaced it: what share of
 * events carry ad attribution, per client, and whether that share is falling.
 *
 * GET ?days=30
 */

const RECENT_WINDOW = 7;   // days treated as "now"
const DROP_ALERT    = 25;  // pp fall vs the prior window that counts as a regression
const LOW_COVERAGE  = 50;  // % below which a client is called out outright

type Bucket = { total: number; attributed: number };

const pct = (b: Bucket) => (b.total > 0 ? (b.attributed / b.total) * 100 : 0);

export async function GET(req: Request) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;

  const days = Math.min(Math.max(Number(new URL(req.url).searchParams.get('days')) || 30, 7), 365);
  const since = new Date(Date.now() - days * 86400_000).toISOString();

  const { data: clients, error: ce } = await ctx.service.from('clients').select('id, name');
  if (ce) return NextResponse.json({ error: ce.message }, { status: 500 });
  const nameById = new Map((clients ?? []).map(c => [c.id as string, c.name as string]));

  const byClient = new Map<string, Bucket>();
  const byDay    = new Map<string, Bucket>();
  const recent   = new Map<string, Bucket>();
  const prior    = new Map<string, Bucket>();

  const recentCut = new Date(Date.now() - RECENT_WINDOW * 86400_000).toISOString();

  const PAGE = 1000;
  let offset = 0;
  for (;;) {
    const { data, error } = await ctx.service
      .from('events')
      .select('client_id, occurred_at, campaign_id, adset_id, ad_id, utm_source')
      .gte('occurred_at', since)
      .order('occurred_at', { ascending: false })
      .range(offset, offset + PAGE - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    if (!data?.length) break;

    for (const e of data) {
      const attributed = Boolean(e.campaign_id || e.adset_id || e.ad_id || e.utm_source);
      const day = String(e.occurred_at).slice(0, 10);
      const cid = (e.client_id as string) ?? 'unknown';

      for (const [map, key] of [[byClient, cid], [byDay, day]] as const) {
        const b = map.get(key) ?? { total: 0, attributed: 0 };
        b.total++; if (attributed) b.attributed++;
        map.set(key, b);
      }

      const window = String(e.occurred_at) >= recentCut ? recent : prior;
      const b = window.get(cid) ?? { total: 0, attributed: 0 };
      b.total++; if (attributed) b.attributed++;
      window.set(cid, b);
    }

    if (data.length < PAGE) break;
    offset += PAGE;
  }

  const clientRows = Array.from(byClient.entries())
    .map(([id, b]) => {
      const r = recent.get(id) ?? { total: 0, attributed: 0 };
      const p = prior.get(id)  ?? { total: 0, attributed: 0 };
      const recentPct = pct(r), priorPct = pct(p);
      // Only call it a drop when both windows have enough events to mean anything.
      const regressed = r.total >= 5 && p.total >= 5 && (priorPct - recentPct) >= DROP_ALERT;
      return {
        client_id: id,
        client_name: nameById.get(id) ?? 'Unknown',
        total: b.total,
        attributed: b.attributed,
        coverage: pct(b),
        recent_coverage: recentPct,
        recent_events: r.total,
        regressed,
        low: b.total >= 5 && pct(b) < LOW_COVERAGE,
      };
    })
    .sort((a, b) => a.coverage - b.coverage);

  const trend = Array.from(byDay.entries())
    .map(([date, b]) => ({ date, total: b.total, attributed: b.attributed, coverage: pct(b) }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const overall = clientRows.reduce(
    (t, r) => ({ total: t.total + r.total, attributed: t.attributed + r.attributed }),
    { total: 0, attributed: 0 },
  );

  return NextResponse.json({
    days,
    overall: { ...overall, coverage: pct(overall) },
    clients: clientRows,
    trend,
    alerts: {
      regressed: clientRows.filter(r => r.regressed).map(r => r.client_name),
      low:       clientRows.filter(r => r.low && !r.regressed).map(r => r.client_name),
    },
  });
}
