import { NextResponse } from 'next/server';
import { rollupFunnelByAd, funnelRates, EMPTY_AD_FUNNEL, type AdFunnel } from '@/lib/ad-funnel';
import { normaliseName, creativeKey, codeOf, CATEGORIES } from '@/lib/creative-key';
import { loadMeta, refreshMeta, metaAgeHours, inferKind, listCampaignAds, REFRESH_HOURS, EXPIRED_HOURS, type HubMeta } from '@/lib/creative-hub';
import {
  hubAuth, isScope, loadFolders, resolveFiling, ensureEntry, pushAdNames, canRenameInMeta, facebookName,
  ENTRY_FIELDS, type Entry,
} from '@/lib/creative-hub-entries';

/**
 * Creative & Copy Hub.
 *
 * One record per creative, keyed on the same pooled name as the creative
 * leaderboard, so the hub and the leaderboard always mean the same thing by
 * "Bathroom Script 12". Each record is assembled from three places:
 *
 *   ad_campaigns          when it ran, where, and what it spent
 *   Meta (cached)         the picture / video, headline and primary text
 *   creative_hub_entries  what only we know: prompt, script, background, notes
 *
 * GET    ?scope=b2b|b2c[&client_id=]   → { creatives, campaigns, folders, … }
 * POST   { scope, name, …fields, id?, category?, folder_id? } → create or update an entry
 * POST   { scope, assign: [{ id? | name }], category, folder_id }  → file several at once
 * DELETE ?id=                          → remove an entry (the ad data stays)
 *
 * Ads are matched to an entry by a saved link (ad id), then by the code at the
 * front of the ad name, then by the pooled name. New name/code matches are
 * saved as links, so a later rename in Meta can't detach the ad.
 *
 * b2b = the internal Tomsi Media client; b2c = every real client, pooled.
 */

export const maxDuration = 60;

type SpendRow = {
  client_id: string; report_date: string; campaign_id: string; campaign_name: string | null;
  adset_name: string | null; ad_id: string; ad_name: string | null;
  spend: number | string; impressions: number | null; link_clicks: number | null; leads: number | null;
};

type AdAcc = {
  ad_id: string; ad_name: string; client_id: string; campaign_id: string; campaign_name: string;
  adset_name: string; days: Set<string>; spend: number; impressions: number; link_clicks: number; meta_leads: number;
  first: string; last: string;
};

const DAY = 86_400_000;
const dayNum = (d: string) => Math.round(new Date(`${d}T00:00:00Z`).getTime() / DAY);

// Days → continuous runs. A gap of up to two days is bridged: a missed sync or a
// day with no delivery shouldn't split one flight into two bars.
function toRuns(days: Iterable<string>): { start: string; end: string }[] {
  const sorted = [...new Set(days)].sort();
  const runs: { start: string; end: string }[] = [];
  for (const d of sorted) {
    const last = runs[runs.length - 1];
    if (last && dayNum(d) - dayNum(last.end) <= 3) last.end = d;
    else runs.push({ start: d, end: d });
  }
  return runs;
}

export async function GET(req: Request) {
  const service = await hubAuth(req);
  if (service instanceof NextResponse) return service;

  const { searchParams } = new URL(req.url);
  const scope = searchParams.get('scope');
  const clientFilter = searchParams.get('client_id');
  if (!isScope(scope)) {
    return NextResponse.json({ error: "scope must be 'b2b' or 'b2c'" }, { status: 400 });
  }

  const { data: clientRows, error: cErr } = await service.from('clients').select('id, name, is_internal');
  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 });
  const clientName = new Map((clientRows ?? []).map(c => [c.id as string, c.name as string]));
  const clientIds = (clientRows ?? [])
    .filter(c => (scope === 'b2b' ? c.is_internal : !c.is_internal))
    .map(c => c.id as string)
    .filter(id => scope === 'b2b' || !clientFilter || id === clientFilter);

  // B2B is one account, so names are matched in order ("Hook 1 Body 2" is not
  // "Hook 2 Body 1"); across clients, word order is ignored.
  const keyOf = (adName: string) => creativeKey(adName || '(unnamed ad)', scope === 'b2b');

  // ── Spend side: every day each ad ran ──
  const ads = new Map<string, AdAcc>();
  if (clientIds.length) {
    const PAGE = 1000;
    for (let offset = 0; ; offset += PAGE) {
      const { data, error } = await service
        .from('ad_campaigns')
        .select('client_id, report_date, campaign_id, campaign_name, adset_name, ad_id, ad_name, spend, impressions, link_clicks, leads')
        .eq('level', 'ad')
        .in('client_id', clientIds)
        .neq('ad_id', '')
        .order('report_date').order('id')
        .range(offset, offset + PAGE - 1);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      for (const r of (data ?? []) as SpendRow[]) {
        let a = ads.get(r.ad_id);
        if (!a) {
          a = { ad_id: r.ad_id, ad_name: '', client_id: r.client_id, campaign_id: r.campaign_id, campaign_name: '',
                adset_name: '', days: new Set(), spend: 0, impressions: 0, link_clicks: 0, meta_leads: 0,
                first: r.report_date, last: r.report_date };
          ads.set(r.ad_id, a);
        }
        // Rows arrive oldest first, so the latest name wins — ads get renamed.
        if (r.ad_name) a.ad_name = r.ad_name;
        if (r.campaign_name) a.campaign_name = r.campaign_name;
        if (r.adset_name) a.adset_name = r.adset_name;
        a.days.add(r.report_date);
        if (r.report_date > a.last) a.last = r.report_date;
        a.spend += Number(r.spend) || 0;
        a.impressions += r.impressions ?? 0;
        a.link_clicks += r.link_clicks ?? 0;
        a.meta_leads += r.leads ?? 0;
      }
      if (!data || data.length < PAGE) break;
    }
  }

  // ── Ads that are in Meta but haven't delivered yet ──
  // The spend sync only sees ads with an impression. Ask Meta for every ad in
  // the campaigns that ran in the last 30 days and add the active ones it
  // missed, with no delivery days — so a freshly launched ad shows up straight away.
  const token = process.env.META_ACCESS_TOKEN;
  if (token) {
    const cut30 = new Date(Date.now() - 30 * DAY).toISOString().slice(0, 10);
    const camps = new Map<string, { client_id: string; name: string; last: string }>();
    for (const a of ads.values()) {
      const c = camps.get(a.campaign_id);
      if (!c || a.last > c.last) camps.set(a.campaign_id, { client_id: a.client_id, name: a.campaign_name, last: a.last });
    }
    const running = [...camps].filter(([, c]) => c.last >= cut30).map(([id]) => id);
    try {
      for (const [campaignId, list] of running.length ? await listCampaignAds(token, running) : []) {
        const c = camps.get(campaignId)!;
        for (const ad of list) {
          // Only ads that are switched on: a paused ad that never served is old
          // clutter (client accounts are full of them), not a launch.
          if (ads.has(ad.id) || !ad.name || ad.effective_status !== 'ACTIVE') continue;
          ads.set(ad.id, { ad_id: ad.id, ad_name: ad.name, client_id: c.client_id, campaign_id: campaignId, campaign_name: c.name,
            adset_name: ad.adset?.name ?? '', days: new Set(), spend: 0, impressions: 0, link_clicks: 0, meta_leads: 0, first: '', last: '' });
        }
      }
    } catch { /* the hub still works from the spend data alone */ }
  }

  // ── Funnel side: what each ad produced in the CRM (first touch, all time) ──
  let funnel = new Map<string, AdFunnel>();
  try {
    funnel = await rollupFunnelByAd(service, {
      table: 'events', level: 'ad', model: 'first',
      client_id: clientIds.length === 1 ? clientIds[0] : null,
      // Same rule as the leaderboard: B2B counts every demo booked, the client
      // side counts as it always has.
      bookedIncludesResolved: scope === 'b2b',
    });
  } catch { /* outcomes stay at zero rather than failing the library */ }

  // ── Our side: entries, folders, and which ad belongs to which entry ──
  const [{ data: entryRows, error: eErr }, folders] = await Promise.all([
    service.from('creative_hub_entries').select('*').eq('scope', scope),
    loadFolders(service, scope),
  ]);
  if (eErr) return NextResponse.json({ error: eErr.message }, { status: 500 });
  const entryList = (entryRows ?? []) as Entry[];
  const entryById = new Map(entryList.map(e => [e.id, e]));
  // An entry is filed under its code when it has one, else under its pooled name.
  const keyOfEntry = (e: Entry) => e.code?.toLowerCase() ?? e.pool_key;
  // An entry answers to its name and to its code, so an ad renamed in Meta from
  // "AI Slop 7" to "AI/SLOP/007 Kitchen Made of Money" lands on the same record.
  const entries = new Map<string, Entry>();
  for (const e of entryList) {
    entries.set(e.pool_key, e);
    if (e.code) entries.set(e.code.toLowerCase(), e);
  }
  const linkOf = new Map<string, Entry>();
  if (entryList.length) {
    const { data: links } = await service.from('creative_hub_links').select('ad_id, entry_id').in('entry_id', entryList.map(e => e.id));
    for (const l of links ?? []) { const e = entryById.get(l.entry_id as string); if (e) linkOf.set(l.ad_id as string, e); }
  }
  // Saved link first; then the code at the front of the name; then the name.
  const newLinks: { ad_id: string; entry_id: string }[] = [];
  const keyForAd = (a: AdAcc) => {
    const linked = linkOf.get(a.ad_id);
    if (linked) return keyOfEntry(linked);
    const k = keyOf(a.ad_name);
    const e = entries.get(k);
    if (!e) return k;
    newLinks.push({ ad_id: a.ad_id, entry_id: e.id });
    return keyOfEntry(e);
  };

  // ── Meta side: copy + media for the most recent ad of each creative ──
  const byKey = new Map<string, AdAcc[]>();
  const adKey = new Map<string, string>();
  for (const a of ads.values()) {
    const key = keyForAd(a);
    adKey.set(a.ad_id, key);
    byKey.set(key, [...(byKey.get(key) ?? []), a]);
  }
  // Remember today's name matches so a rename in Meta can't undo them.
  if (newLinks.length) await service.from('creative_hub_links').upsert(newLinks, { onConflict: 'ad_id', ignoreDuplicates: true });
  const lead = new Map<string, AdAcc>();   // creative key → the ad that represents it
  for (const [key, list] of byKey) {
    lead.set(key, [...list].sort((x, y) => y.last.localeCompare(x.last) || y.spend - x.spend)[0]);
  }

  const today = new Date().toISOString().slice(0, 10);
  // Ads that delivered in the last few days are the ones whose on/off status matters.
  const recentCut = new Date(Date.now() - 3 * DAY).toISOString().slice(0, 10);

  const meta = await loadMeta(service, [...ads.keys()]);
  let metaError: string | null = token ? null : 'META_ACCESS_TOKEN is not set';
  if (token) {
    const wanted = new Set([...lead.values()].map(a => a.ad_id));
    for (const a of ads.values()) if (!a.last || a.last >= recentCut) wanted.add(a.ad_id);
    const expired = [...wanted].filter(id => metaAgeHours(meta.get(id)) > EXPIRED_HOURS);
    const aging = [...wanted].filter(id => { const h = metaAgeHours(meta.get(id)); return h > REFRESH_HOURS && h <= EXPIRED_HOURS; });
    if (expired.length) {
      try {
        for (const [id, row] of await refreshMeta(service, token, expired)) meta.set(id, row);
      } catch (e) {
        metaError = e instanceof Error ? e.message : String(e);
      }
    }
    // Still usable, so don't make the page wait — the next load gets the fresh rows.
    if (aging.length) void refreshMeta(service, token, aging).catch(() => {});
  }

  const usable = (m: HubMeta | undefined) => (m && !m.error ? m : undefined);

  const creatives = [...byKey.entries()].map(([key, list]) => {
    const spellings = new Map<string, number>();
    const days = new Set<string>();
    const f: AdFunnel = { ...EMPTY_AD_FUNNEL };
    let spend = 0, impressions = 0, link_clicks = 0, meta_leads = 0;
    for (const a of list) {
      const n = normaliseName(a.ad_name) || '(unnamed ad)';
      spellings.set(n, (spellings.get(n) ?? 0) + a.spend + 0.001);
      for (const d of a.days) days.add(d);
      spend += a.spend; impressions += a.impressions; link_clicks += a.link_clicks; meta_leads += a.meta_leads;
      const af = funnel.get(a.ad_id);
      if (af) for (const k of Object.keys(f) as (keyof AdFunnel)[]) f[k] += af[k];
    }
    const names = [...spellings.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n);
    const entry = entries.get(key) ?? null;
    const code = entry?.code ?? codeOf(names[0]) ?? null;
    const name = entry?.name ?? names[0];
    const fbName = entry ? facebookName(entry) : name;
    const rep = lead.get(key)!;
    // Prefer the representative ad; fall back to any sibling Meta did answer for.
    const m = usable(meta.get(rep.ad_id)) ?? list.map(a => usable(meta.get(a.ad_id))).find(Boolean) ?? null;
    const runs = toRuns(days);
    const first = runs.length ? runs[0].start : null;
    const last = runs.length ? runs[runs.length - 1].end : null;
    // "Live" = Meta says one of its recently-delivering ads is active. When Meta
    // gave no answer, having delivered in the last two days stands in for it.
    // An ad with no delivery at all (`last` empty) is judged on its status alone.
    const recent = list.filter(a => !a.last || a.last >= recentCut);
    const statuses = recent.map(a => meta.get(a.ad_id)?.status).filter(Boolean);
    const live = statuses.length
      ? statuses.includes('ACTIVE')
      : recent.some(a => !!a.last && dayNum(today) - dayNum(a.last) <= 2);

    return {
      key, code, name, names,
      category: entry?.category ?? null, folder_id: entry?.folder_id ?? null, seq: entry?.seq ?? null,
      fb_name: fbName,
      // Every ad in Meta is already called "<code> <name>".
      names_match: list.every(a => a.ad_name === fbName),
      entry,
      kind: entry?.kind ?? inferKind(name, m?.format ?? null),
      first,
      last,
      days: days.size,
      runs,
      live,
      // Meta's own lead count (website + instant form) — the only lead number
      // that exists for ads that ran before CRM tracking began.
      spend, impressions, link_clicks, meta_leads,
      ...f,
      ...funnelRates(spend, f),
      clients: [...new Set(list.map(a => a.client_id))].map(id => ({ id, name: clientName.get(id) ?? '—' })),
      ads: list
        .map(a => ({
          ad_id: a.ad_id, ad_name: a.ad_name, client_name: clientName.get(a.client_id) ?? '—',
          campaign_name: a.campaign_name, adset_name: a.adset_name,
          first: a.first, last: a.last, spend: a.spend,
          status: meta.get(a.ad_id)?.status ?? null,
        }))
        .sort((a, b) => b.last.localeCompare(a.last) || b.spend - a.spend),
      meta: m && {
        format: m.format, status: m.status, headline: m.headline, primary_text: m.primary_text,
        description: m.description, preview_link: m.preview_link, thumbnail_url: m.thumbnail_url,
        image_url: m.image_url, video_url: m.video_url, video_length: m.video_length,
      },
    };
  });

  // Entries with no ad behind them yet: drafts, and work older than the spend data.
  // Left out when looking at one client — a draft belongs to no client.
  if (!clientFilter) {
    for (const entry of entryList) {
      const key = keyOfEntry(entry);
      if (byKey.has(key)) continue;
      byKey.set(key, []);
      creatives.push({
        key, code: entry.code, name: entry.name, names: [entry.name],
        category: entry.category, folder_id: entry.folder_id, seq: entry.seq,
        fb_name: facebookName(entry), names_match: true,
        entry, kind: entry.kind,
        first: null, last: null, days: 0, runs: [], live: false,
        spend: 0, impressions: 0, link_clicks: 0, meta_leads: 0,
        ...EMPTY_AD_FUNNEL, ...funnelRates(0, EMPTY_AD_FUNNEL),
        clients: [], ads: [], meta: null,
      });
    }
  }

  // ── Campaign timeline: each campaign, and the creatives that ran inside it ──
  type CampCreative = { key: string; name: string; days: Set<string>; spend: number };
  const camps = new Map<string, { campaign_id: string; name: string; client_name: string; days: Set<string>; spend: number; creatives: Map<string, CampCreative> }>();
  for (const a of ads.values()) {
    let c = camps.get(a.campaign_id);
    if (!c) {
      c = { campaign_id: a.campaign_id, name: a.campaign_name || '(unnamed campaign)', client_name: clientName.get(a.client_id) ?? '—',
            days: new Set(), spend: 0, creatives: new Map() };
      camps.set(a.campaign_id, c);
    }
    const key = adKey.get(a.ad_id) ?? keyOf(a.ad_name);
    const cc = c.creatives.get(key) ?? { key, name: entries.get(key)?.name ?? (normaliseName(a.ad_name) || '(unnamed ad)'), days: new Set<string>(), spend: 0 };
    for (const d of a.days) { c.days.add(d); cc.days.add(d); }
    c.spend += a.spend; cc.spend += a.spend;
    c.creatives.set(key, cc);
  }
  const campaigns = [...camps.values()].map(c => {
    const runs = toRuns(c.days);
    return {
      campaign_id: c.campaign_id, name: c.name, client_name: c.client_name, spend: c.spend,
      first: runs[0]?.start ?? null, last: runs[runs.length - 1]?.end ?? null, runs,
      creatives: [...c.creatives.values()]
        .map(cc => ({ key: cc.key, name: cc.name, spend: cc.spend, runs: toRuns(cc.days) }))
        .sort((a, b) => (a.runs[0]?.start ?? '').localeCompare(b.runs[0]?.start ?? '') || b.spend - a.spend),
    };
  }).sort((a, b) => (a.first ?? '').localeCompare(b.first ?? ''));

  // Newest delivery first. A live ad that hasn't served yet counts as today, so a
  // fresh launch sits at the top rather than down among the drafts.
  const recency = (c: { last: string | null; live: boolean }) => c.last ?? (c.live ? today : '');
  creatives.sort((a, b) => recency(b).localeCompare(recency(a)) || b.spend - a.spend || a.name.localeCompare(b.name));

  return NextResponse.json({
    scope, today, creatives, campaigns, folders,
    categories: CATEGORIES,
    can_rename: canRenameInMeta(),
    meta_error: metaError,
  });
}

export async function POST(req: Request) {
  const service = await hubAuth(req);
  if (service instanceof NextResponse) return service;

  const body = await req.json() as Record<string, unknown>;
  const scope = body.scope;
  if (!isScope(scope)) return NextResponse.json({ error: "scope must be 'b2b' or 'b2c'" }, { status: 400 });
  const folders = await loadFolders(service, scope);
  const filingWanted = { category: typeof body.category === 'string' ? body.category : null, folder_id: typeof body.folder_id === 'string' && body.folder_id ? body.folder_id : null };

  // Names of the ads as Meta currently has them — so a rename only touches ads
  // whose name is actually wrong. The UI sends them along; scripts may not.
  const currentNames = new Map(Object.entries((body.current_names ?? {}) as Record<string, string>));
  const maybeRename = async (saved: Entry[]) => {
    if (!canRenameInMeta() || !saved.some(e => e.code)) return [];
    try { return await pushAdNames(service, saved.filter(e => e.code), currentNames); } catch { return []; }
  };

  // ── Bulk filing: several creatives into one category / folder ──
  if (Array.isArray(body.assign)) {
    const saved: Entry[] = [];
    for (const item of body.assign as { id?: string; name?: string }[]) {
      let entry: Entry | null = null;
      if (item.id) {
        const { data } = await service.from('creative_hub_entries').select('*').eq('id', item.id).eq('scope', scope).maybeSingle();
        entry = (data as Entry | null) ?? null;
      }
      if (!entry && item.name) {
        const made = await ensureEntry(service, scope, item.name);
        if ('error' in made) return NextResponse.json({ error: made.error }, { status: 400 });
        entry = made;
      }
      if (!entry) continue;
      const filing = await resolveFiling(service, scope, folders, filingWanted, entry);
      if ('error' in filing) return NextResponse.json({ error: filing.error }, { status: 400 });
      const { data, error } = await service.from('creative_hub_entries')
        .update({ ...filing, updated_at: new Date().toISOString() }).eq('id', entry.id).select().single();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      saved.push(data as Entry);
    }
    return NextResponse.json({ entries: saved, renamed: await maybeRename(saved) });
  }

  // ── One entry: create or update ──
  const name = typeof body.name === 'string' ? body.name.replace(/\s+/g, ' ').trim() : '';
  if (!name) return NextResponse.json({ error: 'A name is required' }, { status: 400 });

  const id = typeof body.id === 'string' && body.id ? body.id : null;
  let current: Entry | null = null;
  if (id) {
    const { data } = await service.from('creative_hub_entries').select('*').eq('id', id).maybeSingle();
    current = (data as Entry | null) ?? null;
    if (!current) return NextResponse.json({ error: 'That creative no longer exists.' }, { status: 404 });
  }

  const row: Record<string, unknown> = {
    scope, name, pool_key: creativeKey(name, scope === 'b2b'), updated_at: new Date().toISOString(),
  };
  for (const f of ENTRY_FIELDS) {
    if (!(f in body)) continue;
    const v = body[f];
    row[f] = typeof v === 'string' && v.trim() ? v.trim() : null;
  }
  if ('category' in body || 'folder_id' in body) {
    const filing = await resolveFiling(service, scope, folders,
      { category: filingWanted.category ?? current?.category ?? null, folder_id: 'folder_id' in body ? filingWanted.folder_id : current?.folder_id ?? null },
      current);
    if ('error' in filing) return NextResponse.json({ error: filing.error }, { status: 400 });
    Object.assign(row, filing);
  }

  const q = id
    ? service.from('creative_hub_entries').update(row).eq('id', id)
    : service.from('creative_hub_entries').upsert(row, { onConflict: 'scope,pool_key' });
  const { data, error } = await q.select().single();
  if (error) {
    const clash = error.code === '23505';
    return NextResponse.json(
      { error: clash ? (error.message.includes('code') ? 'Another creative already uses that code.' : 'Another creative already uses that name.') : error.message },
      { status: clash ? 409 : 500 },
    );
  }
  const entry = data as Entry;
  return NextResponse.json({ entry, renamed: await maybeRename([entry]) });
}

export async function DELETE(req: Request) {
  const service = await hubAuth(req);
  if (service instanceof NextResponse) return service;

  const id = new URL(req.url).searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const { error } = await service.from('creative_hub_entries').delete().eq('id', id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
