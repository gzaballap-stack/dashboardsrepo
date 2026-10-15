// Per-text ad results from Meta. An Advantage+ ad rotates up to five primary
// texts, headlines and descriptions; only Meta knows which text each
// impression carried. Its `body_asset` / `title_asset` / `description_asset`
// breakdowns give lifetime spend, impressions, clicks and leads per text, per
// ad. Pulled per campaign (we know campaign ids from ad_campaigns) and kept in
// memory for 15 minutes.

const GRAPH = 'https://graph.facebook.com/v21.0';
const TTL_MS = 15 * 60_000;

export type TextKind = 'body' | 'title' | 'description';
export type TextRow = { campaign_id: string; ad_id: string; kind: TextKind; text: string; spend: number; impressions: number; clicks: number; leads: number };
export type TextPerf = { ads: number; spend: number; impressions: number; clicks: number; ctr: number; cpc: number; leads: number; cost_per_lead: number };

export const normText = (t: string | null | undefined) => (t ?? '').replace(/\s+/g, ' ').trim().toLowerCase();

const BREAKDOWN: Record<TextKind, string> = { body: 'body_asset', title: 'title_asset', description: 'description_asset' };
const cache = new Map<string, { at: number; rows: TextRow[] }>();

type Raw = { ad_id?: string; spend?: string; impressions?: string; inline_link_clicks?: string; actions?: { action_type: string; value: string }[] } & Record<string, unknown>;

async function fetchCampaign(token: string, campaignId: string): Promise<TextRow[]> {
  const hit = cache.get(campaignId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.rows;
  const rows: TextRow[] = [];
  await Promise.all((Object.keys(BREAKDOWN) as TextKind[]).map(async kind => {
    let url: string | null = `${GRAPH}/${campaignId}/insights?${new URLSearchParams({
      level: 'ad', date_preset: 'maximum', breakdowns: BREAKDOWN[kind],
      fields: 'ad_id,spend,impressions,inline_link_clicks,actions', limit: '500', access_token: token,
    })}`;
    let guard = 0;
    while (url && guard++ < 10) {
      let json: { data?: Raw[]; paging?: { next?: string }; error?: unknown };
      try { json = await (await fetch(url)).json(); } catch { return; }
      if (json.error || !json.data) return;
      for (const r of json.data) {
        const asset = r[BREAKDOWN[kind]] as { text?: string } | undefined;
        if (!r.ad_id || !asset?.text) continue;
        const leads = parseInt(r.actions?.find(a => a.action_type === 'lead')?.value ?? '0', 10) || 0;
        rows.push({ campaign_id: campaignId, ad_id: r.ad_id, kind, text: asset.text, spend: parseFloat(r.spend ?? '0') || 0, impressions: parseInt(r.impressions ?? '0', 10) || 0, clicks: parseInt(r.inline_link_clicks ?? '0', 10) || 0, leads });
      }
      url = json.paging?.next ?? null;
    }
  }));
  cache.set(campaignId, { at: Date.now(), rows });
  return rows;
}

/** Every text row for the given campaigns (lifetime). Empty when the token is missing. */
export async function fetchTextRows(token: string | undefined, campaignIds: string[]): Promise<TextRow[]> {
  if (!token || !campaignIds.length) return [];
  const out: TextRow[] = [];
  const ids = [...new Set(campaignIds.filter(Boolean))];
  for (let i = 0; i < ids.length; i += 8) {
    const batch = await Promise.all(ids.slice(i, i + 8).map(id => fetchCampaign(token, id)));
    for (const b of batch) out.push(...b);
  }
  return out;
}

/** Results of one exact text (whitespace / case-insensitive) across every ad that carried it. */
export function perfForText(rows: TextRow[], kind: TextKind, text: string): TextPerf {
  const want = normText(text);
  const ads = new Set<string>();
  const p: TextPerf = { ads: 0, spend: 0, impressions: 0, clicks: 0, ctr: 0, cpc: 0, leads: 0, cost_per_lead: 0 };
  if (!want) return p;
  for (const r of rows) {
    if (r.kind !== kind || normText(r.text) !== want) continue;
    ads.add(r.ad_id); p.spend += r.spend; p.impressions += r.impressions; p.clicks += r.clicks; p.leads += r.leads;
  }
  p.ads = ads.size;
  p.ctr = p.impressions > 0 ? (p.clicks / p.impressions) * 100 : 0;
  p.cpc = p.clicks > 0 ? p.spend / p.clicks : 0;
  p.cost_per_lead = p.leads > 0 ? p.spend / p.leads : 0;
  return p;
}

/** Every distinct text of a kind, ranked by spend — for reports. */
export function rankTexts(rows: TextRow[], kind: TextKind): (TextPerf & { text: string })[] {
  const seen = new Map<string, string>();
  for (const r of rows) if (r.kind === kind) seen.set(normText(r.text), r.text);
  return [...seen.values()].map(text => ({ text, ...perfForText(rows, kind, text) })).sort((a, b) => b.spend - a.spend);
}
