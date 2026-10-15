import { NextResponse } from 'next/server';
import { hubAuth, isScope, type Service } from '@/lib/creative-hub-entries';
import { rollupFunnelByAd, type AdFunnel } from '@/lib/ad-funnel';

/**
 * Copy sets — the texts an ad rotates through (Advantage+ creative takes up to
 * five primary texts, five headlines and five descriptions), kept per campaign.
 *
 * GET    ?scope=b2b|b2c                → { sets } — each set carries `performance`: lifetime
 *                                        results of every ad whose primary text (or, failing
 *                                        that, headline) is one of the set's texts
 * POST   { id?, scope, name, … }       → create or update
 * DELETE ?id=
 */

const LIMIT = 5;
const LIST_FIELDS = ['bodies', 'headlines', 'descriptions'] as const;
const TEXT_FIELDS = ['campaign_label', 'notes', 'cta', 'link'] as const;

const norm = (t: string | null | undefined) => (t ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

export type CopyPerformance = {
  ads: number; spend: number; impressions: number; link_clicks: number; ctr: number; cpc: number;
  meta_leads: number; leads: number; appts: number; shows: number; closes: number;
  cost_per_lead: number; cost_per_appt: number; first: string | null; last: string | null;
};

// Lifetime results per ad for the scope, with each ad's texts (from the hub's
// Meta cache, so an ad the hub has never loaded has no texts and cannot match).
async function adResults(service: Service, scope: 'b2b' | 'b2c') {
  const { data: clientRows } = await service.from('clients').select('id, is_internal');
  const clientIds = (clientRows ?? []).filter(c => (scope === 'b2b' ? c.is_internal : !c.is_internal)).map(c => c.id as string);
  type Acc = { spend: number; impressions: number; link_clicks: number; meta_leads: number; first: string; last: string };
  const ads = new Map<string, Acc>();
  if (clientIds.length) {
    const PAGE = 1000;
    for (let offset = 0; ; offset += PAGE) {
      const { data } = await service.from('ad_campaigns')
        .select('report_date, ad_id, spend, impressions, link_clicks, leads')
        .eq('level', 'ad').in('client_id', clientIds).neq('ad_id', '')
        .order('report_date').order('id').range(offset, offset + PAGE - 1);
      for (const r of data ?? []) {
        const a = ads.get(r.ad_id as string) ?? { spend: 0, impressions: 0, link_clicks: 0, meta_leads: 0, first: r.report_date as string, last: r.report_date as string };
        a.spend += Number(r.spend) || 0; a.impressions += (r.impressions as number) ?? 0; a.link_clicks += (r.link_clicks as number) ?? 0; a.meta_leads += (r.leads as number) ?? 0;
        if ((r.report_date as string) > a.last) a.last = r.report_date as string;
        ads.set(r.ad_id as string, a);
      }
      if (!data || data.length < PAGE) break;
    }
  }
  const ids = [...ads.keys()];
  const [{ data: meta }, funnel] = await Promise.all([
    ids.length ? service.from('creative_hub_meta').select('ad_id, primary_text, headline').in('ad_id', ids) : Promise.resolve({ data: [] as { ad_id: string; primary_text: string | null; headline: string | null }[] }),
    rollupFunnelByAd(service, { table: 'events', level: 'ad', model: 'first', client_id: clientIds.length === 1 ? clientIds[0] : null, bookedIncludesResolved: scope === 'b2b' })
      .catch(() => new Map<string, AdFunnel>()),
  ]);
  const texts = new Map((meta ?? []).map(m => [m.ad_id as string, { body: norm(m.primary_text as string), headline: norm(m.headline as string) }]));
  return { ads, texts, funnel };
}

function performanceFor(set: { bodies: string[]; headlines: string[] }, r: Awaited<ReturnType<typeof adResults>>): CopyPerformance {
  const bodies = new Set(set.bodies.map(norm).filter(Boolean));
  const heads = new Set(set.headlines.map(norm).filter(Boolean));
  const out: CopyPerformance = { ads: 0, spend: 0, impressions: 0, link_clicks: 0, ctr: 0, cpc: 0, meta_leads: 0, leads: 0, appts: 0, shows: 0, closes: 0, cost_per_lead: 0, cost_per_appt: 0, first: null, last: null };
  for (const [id, a] of r.ads) {
    const t = r.texts.get(id);
    if (!t) continue;
    // Primary text is the distinctive part; the headline only decides when the set has no primary texts.
    const hit = bodies.size ? bodies.has(t.body) : heads.size ? heads.has(t.headline) : false;
    if (!hit) continue;
    out.ads++; out.spend += a.spend; out.impressions += a.impressions; out.link_clicks += a.link_clicks; out.meta_leads += a.meta_leads;
    const f = r.funnel.get(id);
    if (f) { out.leads += f.leads; out.appts += f.appts; out.shows += f.shows; out.closes += f.closes; }
    if (!out.first || a.first < out.first) out.first = a.first;
    if (!out.last || a.last > out.last) out.last = a.last;
  }
  out.ctr = out.impressions > 0 ? (out.link_clicks / out.impressions) * 100 : 0;
  out.cpc = out.link_clicks > 0 ? out.spend / out.link_clicks : 0;
  out.cost_per_lead = out.leads > 0 ? out.spend / out.leads : 0;
  out.cost_per_appt = out.appts > 0 ? out.spend / out.appts : 0;
  return out;
}

const cleanList = (v: unknown) =>
  (Array.isArray(v) ? v : []).map(x => (typeof x === 'string' ? x.trim() : '')).filter(Boolean).slice(0, LIMIT);

export async function GET(req: Request) {
  const service = await hubAuth(req);
  if (service instanceof NextResponse) return service;
  const scope = new URL(req.url).searchParams.get('scope');
  if (!isScope(scope)) return NextResponse.json({ error: "scope must be 'b2b' or 'b2c'" }, { status: 400 });
  const [{ data, error }, { data: users }, results] = await Promise.all([
    service.from('creative_hub_copy_sets').select('*').eq('scope', scope).order('updated_at', { ascending: false }),
    service.from('creative_hub_entries').select('copy_set_id, code, name').eq('scope', scope).not('copy_set_id', 'is', null),
    adResults(service, scope),
  ]);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  // Which creatives run each set.
  const usedBy = new Map<string, string[]>();
  for (const u of users ?? []) {
    const label = u.code ? `${u.code} ${u.name}` : (u.name as string);
    usedBy.set(u.copy_set_id as string, [...(usedBy.get(u.copy_set_id as string) ?? []), label]);
  }
  return NextResponse.json({
    sets: (data ?? []).map(s => ({
      ...s,
      used_by: usedBy.get(s.id as string) ?? [],
      performance: performanceFor({ bodies: (s.bodies as string[]) ?? [], headlines: (s.headlines as string[]) ?? [] }, results),
    })),
    limit: LIMIT,
  });
}

export async function POST(req: Request) {
  const service = await hubAuth(req);
  if (service instanceof NextResponse) return service;
  const body = await req.json() as Record<string, unknown>;
  if (!isScope(body.scope)) return NextResponse.json({ error: "scope must be 'b2b' or 'b2c'" }, { status: 400 });
  const name = typeof body.name === 'string' ? body.name.replace(/\s+/g, ' ').trim() : '';
  if (!name) return NextResponse.json({ error: 'A name is required' }, { status: 400 });

  const row: Record<string, unknown> = { scope: body.scope, name, updated_at: new Date().toISOString() };
  for (const f of TEXT_FIELDS) if (f in body) row[f] = typeof body[f] === 'string' && (body[f] as string).trim() ? (body[f] as string).trim() : null;
  for (const f of LIST_FIELDS) if (f in body) row[f] = cleanList(body[f]);

  const id = typeof body.id === 'string' && body.id ? body.id : null;
  const q = id ? service.from('creative_hub_copy_sets').update(row).eq('id', id) : service.from('creative_hub_copy_sets').insert(row);
  const { data, error } = await q.select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ set: data });
}

export async function DELETE(req: Request) {
  const service = await hubAuth(req);
  if (service instanceof NextResponse) return service;
  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const { error } = await service.from('creative_hub_copy_sets').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
