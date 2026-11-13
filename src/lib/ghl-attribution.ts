import type { Attribution } from './attribution';
import { ATTRIBUTION_FIELDS, hasAttribution } from './attribution';

const GHL_BASE = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/**
 * GoHighLevel's per-contact attribution record.
 *
 * GHL captures this itself on Meta lead-form submissions — campaign, ad set and
 * ad IDs arrive with no pixel, no landing page and no workflow configuration.
 * Field spelling is not stable across sub-accounts (`utmCampaign` in some,
 * `utm_campaign` in others), so every read goes through `pick()`.
 */
type GhlAttribution = Record<string, unknown>;

function pick(src: GhlAttribution, ...names: string[]): string | null {
  for (const n of names) {
    const v = src[n];
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
  }
  return null;
}

/** meta / google / tiktok, from whichever field the sub-account happens to fill. */
function normalisePlatform(src: GhlAttribution): string | null {
  const raw = (pick(src, 'adSource', 'utmSource', 'source', 'medium') ?? '').toLowerCase();
  if (!raw) return null;
  // Meta placement codes seen in utmSource: fb, ig, an (Audience Network), th (Threads), msg (Messenger).
  if (['fb','ig','an','th','msg'].includes(raw) || raw.includes('facebook') || raw.includes('instagram') || raw.includes('meta')) return 'meta';
  if (raw.includes('google') || raw.includes('adwords')) return 'google';
  if (raw.includes('tiktok')) return 'tiktok';
  return raw;
}

/**
 * Map a GHL attribution record onto the dashboard's attribution columns.
 *
 * Note on names: GHL has no dedicated ad-set-name or ad-name field. Accounts in
 * this portfolio put the ad set name in `utmMedium` and the creative name in
 * `utmContent`, which is a naming convention rather than a guarantee — the IDs
 * are the reliable part, the names are best-effort.
 */
export function mapGhlAttribution(src: GhlAttribution | null | undefined): Attribution {
  const out = {} as Attribution;
  for (const f of ATTRIBUTION_FIELDS) out[f] = null;
  if (!src || typeof src !== 'object') return out;

  out.ad_platform   = normalisePlatform(src);
  out.campaign_id   = pick(src, 'campaignId', 'campaign_id');
  out.campaign_name = pick(src, 'campaign', 'utmCampaign', 'utm_campaign');
  out.adset_id      = pick(src, 'adSetId', 'adset_id', 'adGroupId', 'adgroupId');
  out.adset_name    = pick(src, 'utmMedium', 'utm_medium');
  out.ad_id         = pick(src, 'adId', 'ad_id');
  out.ad_name       = pick(src, 'utmContent', 'utm_content');
  out.utm_source    = pick(src, 'utmSource', 'utm_source');
  out.utm_medium    = pick(src, 'utmMedium', 'utm_medium');
  out.utm_campaign  = pick(src, 'utmCampaign', 'utm_campaign', 'campaign');
  out.utm_content   = pick(src, 'utmContent', 'utm_content');
  out.utm_term      = pick(src, 'keyword', 'utmTerm', 'utm_term', 'utmKeyword');
  out.referrer_url  = pick(src, 'referrer', 'referrer_url', 'referrerUrl');

  // Some funnels pass Meta's numeric ids through the UTM slots instead of the
  // dedicated id fields (utm_campaign = campaign id, utm_term = ad set id,
  // utm_content = ad id). When the dedicated field is empty and the UTM value is
  // a Meta-style numeric id, use it — the ids are what the spend tables join on.
  const metaId = (v: string | null) => (v && /^\d{12,}$/.test(v) ? v : null);
  out.campaign_id = out.campaign_id ?? metaId(out.utm_campaign);
  out.adset_id    = out.adset_id    ?? metaId(out.utm_term);
  out.ad_id       = out.ad_id       ?? metaId(out.utm_content);

  return out;
}

/**
 * The Tomsi Media sub-account's UTM contact fields (custom field id → the name
 * GHL's own attribution record uses).
 *
 * GHL fills `attributionSource` only on its own forms, surveys and calendars,
 * and it cannot be written through the API. Leads from the website funnel
 * (tomsimedia.com) are created through the API, so the funnel writes its UTMs
 * into these contact fields instead. They are read only when GHL's own record
 * is empty, so nothing changes for a contact GHL already attributed.
 */
const UTM_CUSTOM_FIELDS: Record<string, string> = {
  EzXVddJhKcSotusii4cD: 'utmSource',
  LZrpPMo8ZDKsnqMvxyVH: 'utmMedium',
  dOXxUwaaZIL6XnK4DZrh: 'utmCampaign',
  ZXWCFHQjfp8sBux798NT: 'utmContent',
  BBzAbWAWIZDdlA5VLKXj: 'utmTerm',
};

/** A GHL-shaped attribution record built from the contact's UTM fields, or null if they are empty. */
function attributionFromCustomFields(contact: unknown): GhlAttribution | null {
  const list = (contact as { customFields?: unknown } | null)?.customFields;
  if (!Array.isArray(list)) return null;
  const out: GhlAttribution = {};
  for (const f of list as Array<Record<string, unknown>>) {
    const name = UTM_CUSTOM_FIELDS[String(f?.id ?? '')];
    const value = f?.value ?? f?.field_value ?? f?.fieldValue;
    if (name && value !== undefined && value !== null && String(value).trim() !== '') out[name] = String(value).trim();
  }
  return Object.keys(out).length ? out : null;
}

export type GhlFetchResult =
  | {
      ok: true;
      /** First touch — the ad that originally produced the contact. */
      attribution: Attribution;
      /** Last touch — the most recent ad before converting, or null if GHL has none. */
      lastTouch: Attribution | null;
      /** The contact's postal code, for the per-zip rollup. Same call, no extra cost. */
      zip: string | null;
      raw: GhlAttribution | null;
    }
  | { ok: false; status: number; error: string };

/**
 * Read a contact's attribution from GHL — both touches.
 *
 * `attributionSource` is first touch, `lastAttributionSource` is last touch.
 * GHL returns both on the same call, so capturing last touch costs nothing.
 * First touch remains the default everywhere, matching the model
 * `lib/attribution` already applies downstream.
 */
export async function fetchGhlAttribution(
  contactId: string,
  apiKey: string,
): Promise<GhlFetchResult> {
  // GHL rate-limits hard on bursts. 429 is expected under any real backfill, so
  // retry it with exponential backoff rather than dropping the contact.
  let res: Response | null = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      res = await fetch(`${GHL_BASE}/contacts/${encodeURIComponent(contactId)}`, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Version: GHL_VERSION,
          Accept: 'application/json',
        },
      });
    } catch (e) {
      if (attempt === 4) return { ok: false, status: 0, error: (e as Error).message };
      await sleep(250 * 2 ** attempt);
      continue;
    }

    if (res.status !== 429) break;

    // Honour Retry-After when GHL sends it, otherwise back off exponentially.
    const retryAfter = Number(res.headers.get('retry-after'));
    const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
      ? retryAfter * 1000
      : 500 * 2 ** attempt;
    await sleep(waitMs);
  }

  if (!res) return { ok: false, status: 0, error: 'no response' };
  if (!res.ok) {
    return { ok: false, status: res.status, error: (await res.text()).slice(0, 200) };
  }

  const body = await res.json();
  const contact = body?.contact ?? body;
  const src  = (contact?.attributionSource ?? null) as GhlAttribution | null;
  const last = (contact?.lastAttributionSource ?? null) as GhlAttribution | null;

  const hasLast = last && typeof last === 'object' && Object.keys(last).length > 0;

  // GHL's own record first; the funnel's UTM contact fields only when it is empty.
  let attribution = mapGhlAttribution(src);
  if (!hasAttribution(attribution)) {
    const fromFields = attributionFromCustomFields(contact);
    if (fromFields) attribution = mapGhlAttribution(fromFields);
  }

  return {
    ok: true,
    attribution,
    lastTouch: hasLast ? mapGhlAttribution(last) : null,
    zip: pick(contact ?? {}, 'postalCode', 'postal_code', 'zip', 'zipCode'),
    raw: src,
  };
}
