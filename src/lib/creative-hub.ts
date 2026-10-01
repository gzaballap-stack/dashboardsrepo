// Creative & Copy Hub — the Meta side.
//
// Nothing is stored on our side except text: the image and the video are served
// straight from Meta's CDN. Those links expire after a few days, so each ad's
// row in `creative_hub_meta` is refreshed daily (see REFRESH_HOURS).
// The copy (headline / primary text) is kept on the row, so it survives the ad
// being deleted in Meta even though the picture does not.

import { createServiceClient } from './supabase';

type Service = ReturnType<typeof createServiceClient>;

const GRAPH = 'https://graph.facebook.com/v19.0';
const BATCH = 50;               // Meta's limit per batch request
// Past REFRESH_HOURS a row is refreshed in the background; past EXPIRED_HOURS its
// media links can no longer be trusted, so the page waits for the refresh.
export const REFRESH_HOURS = 20;
export const EXPIRED_HOURS = 72;

const AD_FIELDS =
  'name,effective_status,created_time,preview_shareable_link,' +
  'creative.thumbnail_width(600).thumbnail_height(600){thumbnail_url,image_url,object_type,title,body,object_story_spec,asset_feed_spec}';

export type HubMeta = {
  ad_id: string;
  ad_name: string | null;
  status: string | null;
  created_time: string | null;
  format: string | null;
  headline: string | null;
  primary_text: string | null;
  description: string | null;
  preview_link: string | null;
  thumbnail_url: string | null;
  image_url: string | null;
  video_id: string | null;
  video_url: string | null;
  video_length: number | null;
  error: string | null;
  fetched_at: string;
};

type RawAd = {
  name?: string; effective_status?: string; created_time?: string; preview_shareable_link?: string;
  creative?: {
    thumbnail_url?: string; image_url?: string; object_type?: string; title?: string; body?: string;
    object_story_spec?: {
      video_data?: { video_id?: string; message?: string; title?: string; link_description?: string; image_url?: string };
      link_data?: { message?: string; name?: string; description?: string; picture?: string; child_attachments?: unknown[] };
      photo_data?: { caption?: string; url?: string };
    };
    asset_feed_spec?: {
      bodies?: { text?: string }[]; titles?: { text?: string }[]; descriptions?: { text?: string }[];
      videos?: { video_id?: string }[]; images?: unknown[];
    };
  };
  error?: { message?: string };
};
type RawVideo = { source?: string; picture?: string; length?: number; error?: { message?: string } };

// One HTTP call, up to 50 GETs. A bad id fails only its own slot — unlike
// `?ids=a,b,c`, where one unknown id rejects the whole request.
async function graphBatch<T>(token: string, relativeUrls: string[]): Promise<(T | null)[]> {
  const res = await fetch(`${GRAPH}/`, {
    method: 'POST',
    body: new URLSearchParams({
      access_token: token,
      batch: JSON.stringify(relativeUrls.map(relative_url => ({ method: 'GET', relative_url }))),
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const json = await res.json() as unknown;
  if (!Array.isArray(json)) {
    const msg = (json as { error?: { message?: string } })?.error?.message ?? 'unexpected response';
    throw new Error(`Meta API: ${msg}`);
  }
  return json.map(slot => {
    try { return JSON.parse((slot as { body: string }).body) as T; } catch { return null; }
  });
}

const chunk = <T,>(list: T[], n: number) =>
  Array.from({ length: Math.ceil(list.length / n) }, (_, i) => list.slice(i * n, i * n + n));

const PROFILE_PICTURE = /\/t39\.30808-1\//;

const text = (s: string | null | undefined) => (s && s.trim() ? s.trim() : null);

// Meta writes offsets as -0500; Postgres and Date both want -05:00.
const isoTime = (s: string | undefined) => {
  if (!s) return null;
  const d = new Date(s.replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
};

function fromRaw(adId: string, raw: RawAd): Omit<HubMeta, 'video_url' | 'video_length' | 'fetched_at'> {
  const c = raw.creative ?? {};
  const oss = c.object_story_spec;
  const afs = c.asset_feed_spec;
  const videoId = oss?.video_data?.video_id ?? afs?.videos?.[0]?.video_id ?? null;

  let format: string | null = null;
  if (oss?.link_data?.child_attachments?.length) format = 'Carousel';
  else if (videoId || c.object_type === 'VIDEO') format = 'Video';
  else if (c.image_url || oss?.photo_data || oss?.link_data || afs?.images?.length || c.object_type === 'PHOTO') format = 'Image';

  return {
    ad_id: adId,
    ad_name: text(raw.name),
    status: raw.effective_status ?? null,
    created_time: isoTime(raw.created_time),
    format,
    headline: text(c.title ?? oss?.link_data?.name ?? oss?.video_data?.title ?? afs?.titles?.[0]?.text),
    primary_text: text(c.body ?? oss?.link_data?.message ?? oss?.video_data?.message ?? oss?.photo_data?.caption ?? afs?.bodies?.[0]?.text),
    description: text(oss?.link_data?.description ?? oss?.video_data?.link_description ?? afs?.descriptions?.[0]?.text),
    preview_link: raw.preview_shareable_link ?? null,
    // Meta's `thumbnail_url` is often the page's profile picture rather than the
    // ad, so it is only ever a last resort behind the real image / video poster.
    thumbnail_url: c.thumbnail_url && !PROFILE_PICTURE.test(c.thumbnail_url) ? c.thumbnail_url : null,
    image_url: c.image_url ?? oss?.video_data?.image_url ?? oss?.link_data?.picture ?? oss?.photo_data?.url ?? null,
    video_id: videoId,
    error: null,
  };
}

/** Cached Meta rows for these ads, keyed by ad id. */
export async function loadMeta(service: Service, adIds: string[]): Promise<Map<string, HubMeta>> {
  const out = new Map<string, HubMeta>();
  for (const ids of chunk(adIds, 200)) {
    const { data } = await service.from('creative_hub_meta').select('*').in('ad_id', ids);
    for (const row of (data ?? []) as HubMeta[]) out.set(row.ad_id, row);
  }
  return out;
}

/** Hours since this ad was last pulled from Meta; Infinity if it never was. */
export function metaAgeHours(row: HubMeta | undefined): number {
  return row ? (Date.now() - new Date(row.fetched_at).getTime()) / 3_600_000 : Infinity;
}

/**
 * Pull these ads from Meta and store what came back. Returns the fresh rows.
 * A refusal for one ad is recorded on its row (keeping any copy already saved)
 * so it isn't retried on every page load.
 */
export async function refreshMeta(service: Service, token: string, adIds: string[]): Promise<Map<string, HubMeta>> {
  const fresh = new Map<string, HubMeta>();
  const now = new Date().toISOString();
  const failed: { ad_id: string; error: string; fetched_at: string }[] = [];

  await Promise.all(chunk(adIds, BATCH).map(async ids => {
    const ads = await graphBatch<RawAd>(token, ids.map(id => `${id}?fields=${encodeURIComponent(AD_FIELDS)}`));
    const parsed = ids.map((id, i) => {
      const raw = ads[i];
      if (!raw || raw.error) { failed.push({ ad_id: id, error: raw?.error?.message ?? 'No response from Meta', fetched_at: now }); return null; }
      return fromRaw(id, raw);
    }).filter((r): r is NonNullable<typeof r> => r !== null);

    // Playable source for the videos. Only the ad-account video (the one in
    // object_story_spec) is readable; the page copy of it is not.
    const withVideo = parsed.filter(p => p.video_id);
    const videos = withVideo.length
      ? await graphBatch<RawVideo>(token, withVideo.map(p => `${p.video_id}?fields=source,picture,length`)).catch(() => [])
      : [];
    const videoById = new Map(withVideo.map((p, i) => [p.video_id!, videos[i]]));

    for (const p of parsed) {
      const v = p.video_id ? videoById.get(p.video_id) : null;
      fresh.set(p.ad_id, {
        ...p,
        image_url: p.image_url ?? (v && !v.error ? v.picture ?? null : null),
        video_url: v && !v.error ? v.source ?? null : null,
        video_length: v && !v.error ? v.length ?? null : null,
        fetched_at: now,
      });
    }
  }));

  if (fresh.size) await service.from('creative_hub_meta').upsert([...fresh.values()], { onConflict: 'ad_id' });
  // Only the error and timestamp are written, so earlier copy on the row is kept.
  if (failed.length) await service.from('creative_hub_meta').upsert(failed, { onConflict: 'ad_id' });
  return fresh;
}

// ── Ads that exist but have not delivered ────────────────────────────────
// The spend sync only ever sees ads with at least one impression, so an ad that
// is switched on but hasn't served yet would be invisible to the hub. Listing
// the ads of the campaigns we already know about closes that gap.

export type CampaignAd = { id: string; name?: string; effective_status?: string; adset?: { name?: string } };

const LIST_TTL_MS = 15 * 60_000;
const listCache = new Map<string, { at: number; ads: CampaignAd[] }>();

async function fetchCampaignAds(token: string, campaignIds: string[]): Promise<void> {
  await Promise.all(chunk(campaignIds, BATCH).map(async ids => {
    const out = await graphBatch<{ data?: CampaignAd[]; error?: unknown }>(
      token, ids.map(id => `${id}/ads?fields=${encodeURIComponent('id,name,effective_status,adset{name}')}&limit=200`));
    ids.forEach((id, i) => { if (out[i]?.data) listCache.set(id, { at: Date.now(), ads: out[i]!.data! }); });
  }));
}

/**
 * Every (non-deleted) ad in these campaigns, by campaign id. Held in memory for
 * 15 minutes; a stale answer is returned at once and refreshed behind it, so
 * only the first load after a restart waits on Meta.
 */
export async function listCampaignAds(token: string, campaignIds: string[]): Promise<Map<string, CampaignAd[]>> {
  const unknown = campaignIds.filter(id => !listCache.has(id));
  const stale = campaignIds.filter(id => { const c = listCache.get(id); return c && Date.now() - c.at > LIST_TTL_MS; });
  if (unknown.length) await fetchCampaignAds(token, unknown);
  if (stale.length) void fetchCampaignAds(token, stale).catch(() => {});
  return new Map(campaignIds.filter(id => listCache.has(id)).map(id => [id, listCache.get(id)!.ads]));
}

/** A readable creative type from the Meta format and the naming convention. */
export function inferKind(name: string, format: string | null): string | null {
  const n = name.toUpperCase();
  if (/\bUGC\b/.test(n)) return 'UGC video';
  if (/\bVO\b|VOICE ?OVER/.test(n)) return 'Voiceover video';
  if (/\bAI\b/.test(n)) return format === 'Video' ? 'AI video' : 'AI image';
  if (/CAROUSEL/.test(n)) return 'Carousel';
  return format;
}
