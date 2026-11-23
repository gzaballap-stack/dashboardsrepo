import { NextResponse } from 'next/server';
import { hubAuth } from '@/lib/creative-hub-entries';
import { readAdTexts, type AdTexts } from '@/lib/ad-texts';

/**
 * A client's past copy packs, rebuilt from their own ads in Meta (Copy page,
 * Clients view → "Pull Packs From Their Ads"). Every ad the client has run is
 * read in full (all primary texts, headlines, descriptions); ads that ran the
 * same combination become one pack, labelled with the campaign and dated by
 * when those ads ran. A combination the client already has a pack for is
 * skipped, so pulling again only adds what is new. Never marks a pack current.
 *
 * POST { client_id } → { made, skipped, failed }
 */

const LIMIT = 5;
const MAX_ADS = 150;
const norm = (t: string) => t.replace(/\s+/g, ' ').trim().toLowerCase();
const keyOf = (t: { bodies: string[]; headlines: string[]; descriptions: string[] }) =>
  JSON.stringify([t.bodies.map(norm).sort(), t.headlines.map(norm).sort(), t.descriptions.map(norm).sort()]);

export async function POST(req: Request) {
  const service = await hubAuth(req);
  if (service instanceof NextResponse) return service;
  const body = await req.json().catch(() => ({})) as { client_id?: unknown };
  const clientId = typeof body.client_id === 'string' ? body.client_id : '';
  if (!clientId) return NextResponse.json({ error: 'client_id is required' }, { status: 400 });
  const token = process.env.META_ACCESS_TOKEN;
  if (!token) return NextResponse.json({ error: 'META_ACCESS_TOKEN is not set' }, { status: 503 });

  const { data: client } = await service.from('clients').select('id, name').eq('id', clientId).maybeSingle();
  if (!client) return NextResponse.json({ error: 'No such client' }, { status: 404 });

  // Every ad the client has run, with its campaign and the days it ran.
  type Ad = { ad_id: string; ad_name: string; campaign: string; first: string; last: string; spend: number };
  const ads = new Map<string, Ad>();
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await service.from('ad_campaigns')
      .select('ad_id, ad_name, campaign_name, report_date, spend')
      .eq('client_id', clientId).eq('level', 'ad').neq('ad_id', '')
      .order('report_date').order('id').range(offset, offset + 999);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    for (const r of data ?? []) {
      const a = ads.get(r.ad_id as string) ?? { ad_id: r.ad_id as string, ad_name: (r.ad_name as string) ?? '', campaign: (r.campaign_name as string) ?? '', first: r.report_date as string, last: r.report_date as string, spend: 0 };
      if ((r.report_date as string) > a.last) a.last = r.report_date as string;
      a.spend += Number(r.spend) || 0;
      ads.set(a.ad_id, a);
    }
    if (!data || data.length < 1000) break;
  }
  // Biggest spenders first, so a cap keeps the ads that mattered.
  const list = [...ads.values()].sort((a, b) => b.spend - a.spend).slice(0, MAX_ADS);

  const read: { ad: Ad; texts: AdTexts }[] = [];
  let failed = 0;
  for (let i = 0; i < list.length; i += 8) {
    const batch = await Promise.all(list.slice(i, i + 8).map(ad => readAdTexts(ad.ad_id, token).then(texts => ({ ad, texts })).catch(() => null)));
    for (const b of batch) { if (b && (b.texts.bodies.length || b.texts.headlines.length)) read.push(b); else failed++; }
  }

  // One pack per combination of texts.
  type Group = { texts: AdTexts; ads: Ad[] };
  const groups = new Map<string, Group>();
  for (const { ad, texts } of read) {
    const t = { ...texts, bodies: texts.bodies.slice(0, LIMIT), headlines: texts.headlines.slice(0, LIMIT), descriptions: texts.descriptions.slice(0, LIMIT) };
    const g = groups.get(keyOf(t)) ?? { texts: t, ads: [] };
    g.ads.push(ad);
    groups.set(keyOf(t), g);
  }

  const { data: existing } = await service.from('creative_hub_copy_sets')
    .select('bodies, headlines, descriptions').eq('client_id', clientId);
  const have = new Set((existing ?? []).map(e => keyOf(e as { bodies: string[]; headlines: string[]; descriptions: string[] })));

  const rows = [...groups.entries()].filter(([k]) => !have.has(k)).map(([, g]) => {
    const first = g.ads.reduce((m, a) => (a.first < m ? a.first : m), g.ads[0].first);
    const last = g.ads.reduce((m, a) => (a.last > m ? a.last : m), g.ads[0].last);
    const campaigns = [...new Set(g.ads.map(a => a.campaign).filter(Boolean))];
    const lead = g.ads.sort((a, b) => b.spend - a.spend)[0];
    return {
      scope: 'b2c', client_id: clientId, is_template: false, active: false,
      name: `${client.name} — ${lead.ad_name || 'Ad copy'}`,
      campaign_label: campaigns[0] ?? 'From Their Ads',
      bodies: g.texts.bodies, headlines: g.texts.headlines, descriptions: g.texts.descriptions,
      cta: g.texts.cta, link: g.texts.link,
      notes: `From their ads, ran ${first} → ${last} on ${g.ads.length} ad${g.ads.length === 1 ? '' : 's'}: ${g.ads.map(a => a.ad_name).filter(Boolean).join(', ')}.`,
      updated_at: `${last}T00:00:00Z`,
    };
  });
  if (rows.length) {
    const { error } = await service.from('creative_hub_copy_sets').insert(rows);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ made: rows.length, skipped: groups.size - rows.length, failed, ads: list.length });
}
