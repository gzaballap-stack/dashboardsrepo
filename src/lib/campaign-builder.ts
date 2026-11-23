// Build Campaign (NOTES.md 2026-11-23) — a new Facebook client's first
// campaign, built in their ad account from what the survey already made, the
// way the owner builds them by hand. Everything is created PAUSED: nothing
// spends until someone turns it on in Ads Manager.
//
//   Campaign  "Tomsi Media | Qualified Estimates | MM/DD/YY" — Leads, daily
//             budget at the campaign (the survey's ad spend), lowest cost.
//   Ad set    "<City> <N> Miles (Radius) | Feeds, Stories, Reels" — instant
//             form leads on the client's page; a radius around their address
//             (the survey's miles, zip centre); over 50 miles, or "specific zip
//             codes", it targets the survey's zip list instead. Ages 25–65,
//             Advantage+ audience, Facebook + Instagram feeds / stories / reels,
//             1-day click attribution.
//   Form      "M / D / YY | Tomsi Media | Full": a copy of the standard instant
//             form (Super Floor Store's) on the client's page — their city in
//             the travel-time question, then on to their funnel's /bookingpage.
//   Ads       one per creative picked from the Creative & Copy Hub: its image or
//             video copied into this ad account, the client's current copy pack
//             as the texts (flexible: every primary text, headline, description),
//             Learn More → the form. Named exactly like the source ad, so the hub
//             pools them with the creative.
//
// Needs META_MANAGEMENT_TOKEN — a system-user token with ads_management,
// business_management, pages_show_list, pages_read_engagement,
// pages_manage_ads and leads_retrieval — and that system user assigned to the
// client's page and ad account. META_ACCESS_TOKEN (read only) is not enough.

import type { AuthContext } from './api-auth';
import { geocodeZip } from './census';
import { areaOf, readSetup } from './client-setup';
import { str, type Answers } from './client-survey';

type Service = AuthContext['service'];
type Row = Record<string, unknown>;

const GRAPH = 'https://graph.facebook.com/v21.0';
export const NEEDED_SCOPES = ['ads_management', 'business_management', 'pages_show_list', 'pages_read_engagement', 'pages_manage_ads', 'leads_retrieval'];
const MAX_RADIUS = 50;          // Meta's limit for a radius around a point
const MAX_ADS = 8;
const SETTINGS_KEY = 'campaign_builder';
// The standard form to copy, until someone sets another (app_settings.campaign_builder).
const DEFAULT_TEMPLATE = { form_id: '1754800585608166', page_id: '1386164391238217', client_name: 'Super Floor Store And Remodeling', city: 'Conroe' };

export class MetaError extends Error {}
const token = () => process.env.META_MANAGEMENT_TOKEN ?? '';

async function graph(method: 'GET' | 'POST' | 'DELETE', path: string, params: Record<string, unknown> = {}, accessToken = token()): Promise<Row> {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) body.set(k, typeof v === 'string' ? v : JSON.stringify(v));
  body.set('access_token', accessToken);
  const url = method === 'GET' ? `${GRAPH}/${path}?${body}` : `${GRAPH}/${path}`;
  const res = await fetch(url, { method, body: method === 'GET' ? undefined : body, signal: AbortSignal.timeout(60_000) });
  const json = await res.json().catch(() => ({})) as Row & { error?: { message?: string; error_user_msg?: string } };
  if (!res.ok || json.error) throw new MetaError(json.error?.error_user_msg || json.error?.message || `Meta answered ${res.status}`);
  return json;
}

/** Which of the needed permissions the management token is missing (all of them when there is no token). */
export async function tokenStatus(): Promise<{ set: boolean; missing: string[] }> {
  const t = token();
  if (!t) return { set: false, missing: NEEDED_SCOPES };
  try {
    const d = (await graph('GET', 'debug_token', { input_token: t }, t)).data as { scopes?: string[]; is_valid?: boolean };
    if (!d?.is_valid) return { set: true, missing: NEEDED_SCOPES };
    return { set: true, missing: NEEDED_SCOPES.filter(s => !(d.scopes ?? []).includes(s)) };
  } catch {
    return { set: true, missing: NEEDED_SCOPES };
  }
}

const slug = (name: string) => name.toLowerCase().replace(/\b(llc|inc|co|corp|ltd)\b\.?/g, '').replace(/[^a-z0-9]/g, '');
const today = () => { const d = new Date(); return `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${String(d.getFullYear()).slice(2)}`; };

type Template = { form_id: string; page_id: string; client_name: string; city: string };
async function template(service: Service): Promise<Template> {
  const { data } = await service.from('app_settings').select('value').eq('key', SETTINGS_KEY).maybeSingle();
  const v = (data?.value ?? {}) as Partial<Template>;
  return { ...DEFAULT_TEMPLATE, ...Object.fromEntries(Object.entries(v).filter(([, x]) => typeof x === 'string' && x)) } as Template;
}

/** Everything the builder shows before anything is made. */
export async function builderOptions(service: Service, clientId: string) {
  const [{ data: client }, { data: survey }, setup, tok, tpl] = await Promise.all([
    service.from('clients').select('id, name, meta_account_id').eq('id', clientId).maybeSingle(),
    service.from('client_surveys').select('answers').eq('client_id', clientId).maybeSingle(),
    readSetup(service, clientId),
    tokenStatus(),
    template(service),
  ]);
  if (!client) throw new Error('No such client');
  const a = ((survey as Row | null)?.answers ?? {}) as Answers;
  const area = areaOf(a);
  const zips = setup.audience?.zips ?? [];
  const useZips = !area.radius || area.radius > MAX_RADIUS;
  const name = String(client.name);

  // Pages the system user can use, to pick the client's (best guess: same name).
  let pages: { id: string; name: string }[] = [];
  let pagesError: string | null = null;
  if (tok.set && !tok.missing.includes('pages_show_list')) {
    try {
      const r = await graph('GET', 'me/accounts', { fields: 'id,name', limit: 200 });
      pages = ((r.data ?? []) as { id: string; name: string }[]).sort((x, y) => x.name.localeCompare(y.name));
    } catch (e) { pagesError = (e as Error).message; }
  }
  const guess = pages.find(p => slug(p.name) === slug(name)) ?? pages.find(p => slug(p.name).includes(slug(name)) || slug(name).includes(slug(p.name)));

  const budget = parseFloat(str(a, 'ad_spend').replace(/[^0-9.]/g, ''));
  return {
    client: { id: client.id, name },
    token: tok,
    ad_account: (client.meta_account_id as string | null) ?? null,
    pages, pages_error: pagesError, page_id: guess?.id ?? null,
    budget: Number.isFinite(budget) && budget > 0 ? budget : 50,
    targeting: useZips
      ? { kind: 'zips' as const, zips: zips.length, radius: area.radius, zip: area.zip, note: zips.length ? null : 'No zip codes yet — make them on the survey first (Make Again), or add them by hand there.' }
      : { kind: 'radius' as const, radius: area.radius, zip: area.zip, address: [str(a, 'street_address'), str(a, 'city'), str(a, 'state')].filter(Boolean).join(', ') },
    city: str(a, 'city') || 'Area',
    pack: setup.pack ? { id: setup.pack.id, name: setup.pack.name, bodies: setup.pack.bodies.length, headlines: setup.pack.headlines.length, descriptions: setup.pack.descriptions.length } : null,
    thank_you_url: `https://${slug(name)}.remodelwithexperts.com/bookingpage`,
    template_client: tpl.client_name,
    names: { campaign: `Tomsi Media | Qualified Estimates | ${today()}` },
  };
}

export type BuildInput = {
  client_id: string; page_id: string; budget: number; thank_you_url?: string;
  ads: { ad_id: string; name: string }[];   // source ads in the hub: one per creative picked
};

/** What Build will make, checked against the survey and the hub — no calls that change anything. */
export async function planBuild(service: Service, input: BuildInput) {
  const o = await builderOptions(service, input.client_id);
  const problems: string[] = [];
  if (o.token.missing.length) problems.push(`The Meta token is missing: ${o.token.missing.join(', ')}`);
  if (!o.ad_account) problems.push("The client has no ad account linked (Client Roster). It links itself once Meta shows the account to the dashboard's token.");
  if (!input.page_id) problems.push("Pick the client's Facebook page");
  if (!o.pack) problems.push('The client has no copy pack — make it on the survey (Make Again)');
  if (o.targeting.kind === 'zips' && !o.targeting.zips) problems.push(o.targeting.note ?? 'No zip codes');
  if (o.targeting.kind === 'radius' && !o.targeting.zip) problems.push('The survey has no company zip code to centre the radius on');
  if (!input.ads.length) problems.push('Pick at least one creative');
  if (input.ads.length > MAX_ADS) problems.push(`At most ${MAX_ADS} creatives at once`);
  if (!(input.budget >= 5)) problems.push('The daily budget must be at least $5');
  const adset = o.targeting.kind === 'radius'
    ? `${o.city} ${o.targeting.radius} Miles (Radius) | Feeds, Stories, Reels`
    : `${o.city} ${o.targeting.zips} Zip Codes | Feeds, Stories, Reels`;
  const d = new Date();
  const form = `${d.getMonth() + 1} / ${d.getDate()} / ${String(d.getFullYear()).slice(2)} | Tomsi Media | Full`;
  return { options: o, problems, names: { campaign: o.names.campaign, adset, form, ads: input.ads.map(x => x.name) } };
}

// ── building ──

async function pageToken(pageId: string): Promise<string> {
  const r = await graph('GET', pageId, { fields: 'access_token' });
  if (!r.access_token) throw new MetaError(`The dashboard's Meta user is not on page ${pageId} — assign it the page in Business Settings`);
  return r.access_token as string;
}

/**
 * The standard form, copied onto the client's page — the way Star Construction's
 * was made by hand on 2026-11-23: same questions, the past client's city
 * swapped for this one (the "within 90 minutes of <city>" question), privacy
 * link text with this client's name, and after submitting the lead goes to this
 * client's funnel booking page. Super Floor Store's form has no intro card or
 * thank-you screen of its own — the booking page is the thank-you.
 */
async function copyForm(service: Service, pageId: string, clientName: string, city: string, afterUrl: string, formName: string): Promise<string> {
  const tpl = await template(service);
  const f = await graph('GET', tpl.form_id, {
    fields: 'locale,questions,follow_up_action_url,is_optimized_for_quality,block_display_for_non_targeted_viewer,question_page_custom_headline,legal_content',
  }, await pageToken(tpl.page_id));
  const swap = (t: string) => {
    let out = tpl.client_name ? t.split(tpl.client_name).join(clientName) : t;
    if (tpl.city && city) out = out.split(tpl.city).join(city).split(tpl.city.toLowerCase()).join(city.toLowerCase().replace(/\s+/g, '_'));
    return out;
  };
  const questions = ((f.questions ?? []) as Row[]).map(q => ({
    type: q.type, key: swap(String(q.key)),
    ...(q.type === 'CUSTOM' ? { label: swap(String(q.label)), ...(Array.isArray(q.options) ? { options: (q.options as Row[]).map(o => ({ key: o.key, value: o.value })) } : {}) } : {}),
  }));
  const privacy = ((f.legal_content as Row | undefined)?.privacy_policy ?? {}) as Row;
  const made = await graph('POST', `${pageId}/leadgen_forms`, {
    name: formName,
    locale: f.locale,
    questions,
    privacy_policy: { url: privacy.url ?? 'https://www.facebook.com/privacy/policy/', link_text: `Visit ${clientName}'s Privacy Policy.` },
    follow_up_action_url: afterUrl,
    is_optimized_for_quality: f.is_optimized_for_quality,
    block_display_for_non_targeted_viewer: f.block_display_for_non_targeted_viewer,
    question_page_custom_headline: f.question_page_custom_headline ? swap(String(f.question_page_custom_headline)) : undefined,
  }, await pageToken(pageId));
  return made.id as string;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** The source ad's picture or video, copied into the client's ad account. */
async function copyMedia(sourceAdId: string, account: string): Promise<{ image_hash?: string; video_id?: string; image_url?: string; dof?: Row }> {
  const ad = await graph('GET', sourceAdId, { fields: 'account_id,creative{object_story_spec,asset_feed_spec,image_hash,video_id,thumbnail_url,degrees_of_freedom_spec}' });
  const c = (ad.creative ?? {}) as Row;
  const oss = (c.object_story_spec ?? {}) as Row;
  const vd = (oss.video_data ?? {}) as Row, ld = (oss.link_data ?? {}) as Row;
  const afs = (c.asset_feed_spec ?? {}) as Row;
  const videoId = (vd.video_id as string) ?? (c.video_id as string) ?? ((afs.videos as Row[] | undefined)?.[0]?.video_id as string | undefined);
  const imageHash = (ld.image_hash as string) ?? (c.image_hash as string) ?? ((afs.images as Row[] | undefined)?.[0]?.hash as string | undefined);
  const dof = c.degrees_of_freedom_spec as Row | undefined;
  if (videoId) {
    const v = await graph('GET', videoId, { fields: 'source,picture,title' });
    if (!v.source) throw new MetaError(`Meta would not hand over the video of ad ${sourceAdId}`);
    const made = await graph('POST', `${account}/advideos`, { file_url: v.source, name: v.title ?? undefined });
    const id = made.id as string;
    for (let i = 0; i < 40; i++) {    // up to ~2 minutes for Meta to process it
      const s = await graph('GET', id, { fields: 'status' });
      const st = (s.status as { video_status?: string } | undefined)?.video_status;
      if (st === 'ready') break;
      if (st === 'error') throw new MetaError(`Meta could not process the video of ad ${sourceAdId}`);
      await sleep(3000);
    }
    const thumbs = await graph('GET', `${id}/thumbnails`, { fields: 'uri,is_preferred' }).catch(() => ({ data: [] }));
    const list = (thumbs.data ?? []) as { uri: string; is_preferred?: boolean }[];
    const image_url = list.find(t => t.is_preferred)?.uri ?? list[0]?.uri ?? (v.picture as string | undefined) ?? (vd.image_url as string | undefined);
    return { video_id: id, image_url, dof };
  }
  if (imageHash) {
    const src = `act_${String(ad.account_id).replace(/^act_/, '')}`;
    const imgs = await graph('GET', `${src}/adimages`, { hashes: [imageHash], fields: 'url,hash' });
    const url = ((imgs.data ?? []) as { url?: string }[])[0]?.url;
    if (!url) throw new MetaError(`Meta would not hand over the image of ad ${sourceAdId}`);
    const bytes = Buffer.from(await (await fetch(url, { signal: AbortSignal.timeout(60_000) })).arrayBuffer()).toString('base64');
    const made = await graph('POST', `${account}/adimages`, { bytes });
    const images = (made.images ?? {}) as Record<string, { hash: string }>;
    const hash = Object.values(images)[0]?.hash;
    if (!hash) throw new MetaError(`The image of ad ${sourceAdId} could not be uploaded`);
    return { image_hash: hash, dof };
  }
  throw new MetaError(`Ad ${sourceAdId} has no image or video Meta will share`);
}

export type BuildResult = {
  ok: boolean; done: string[]; error?: string;
  campaign_id?: string; adset_id?: string; form_id?: string; ad_ids: string[]; failed_ads: string[]; ads_manager_url?: string;
};

/** Makes it all, paused. Stops at the first step that fails and says what was already made. */
export async function build(service: Service, input: BuildInput): Promise<BuildResult> {
  const out: BuildResult = { ok: false, done: [], ad_ids: [], failed_ads: [] };
  const plan = await planBuild(service, input);
  if (plan.problems.length) return { ...out, error: plan.problems.join('. ') };
  const o = plan.options;
  const account = String(o.ad_account).startsWith('act_') ? String(o.ad_account) : `act_${o.ad_account}`;
  const setup = await readSetup(service, input.client_id);
  const pack = setup.pack!;
  try {
    // 1. The form
    out.form_id = await copyForm(service, input.page_id, o.client.name, o.city, input.thank_you_url || o.thank_you_url, plan.names.form);
    out.done.push(`Instant form "${plan.names.form}" on the page`);

    // 2. The campaign
    const camp = await graph('POST', `${account}/campaigns`, {
      name: plan.names.campaign, objective: 'OUTCOME_LEADS', status: 'PAUSED', buying_type: 'AUCTION',
      special_ad_categories: [], daily_budget: Math.round(input.budget * 100), bid_strategy: 'LOWEST_COST_WITHOUT_CAP',
    });
    out.campaign_id = camp.id as string;
    out.done.push(`Campaign "${plan.names.campaign}" ($${input.budget}/day, paused)`);

    // 3. The ad set
    let geo: Row;
    if (o.targeting.kind === 'radius') {
      const center = await geocodeZip(String(o.targeting.zip));
      if (!center) throw new MetaError(`No location for zip ${o.targeting.zip}`);
      geo = { custom_locations: [{ latitude: center.lat, longitude: center.lng, radius: o.targeting.radius, distance_unit: 'mile', name: o.targeting.address }], location_types: ['home', 'recent'] };
    } else {
      geo = { zips: (setup.audience?.zips ?? []).map(z => ({ key: `US:${z}` })), location_types: ['home', 'recent'] };
    }
    const adset = await graph('POST', `${account}/adsets`, {
      name: plan.names.adset, campaign_id: out.campaign_id, status: 'PAUSED',
      optimization_goal: 'LEAD_GENERATION', billing_event: 'IMPRESSIONS', destination_type: 'ON_AD',
      promoted_object: { page_id: input.page_id },
      attribution_spec: [{ event_type: 'CLICK_THROUGH', window_days: 1 }],
      targeting: {
        geo_locations: geo, age_min: 25, age_max: 65,
        targeting_automation: { advantage_audience: 1 },
        publisher_platforms: ['facebook', 'instagram'],
        facebook_positions: ['feed', 'story', 'facebook_reels', 'profile_feed'],
        instagram_positions: ['stream', 'story', 'reels', 'profile_feed'],
        device_platforms: ['mobile', 'desktop'],
      },
    });
    out.adset_id = adset.id as string;
    out.done.push(`Ad set "${plan.names.adset}" (paused)`);

    // 4. The ads — one bad creative does not stop the others.
    const texts = {
      bodies: pack.bodies.map(text => ({ text })), titles: pack.headlines.map(text => ({ text })),
      descriptions: pack.descriptions.map(text => ({ text })), optimization_type: 'DEGREES_OF_FREEDOM',
    };
    const cta = { type: 'LEARN_MORE', value: { lead_gen_form_id: out.form_id, link: 'http://fb.me/' } };
    for (const src of input.ads) {
      try {
        const media = await copyMedia(src.ad_id, account);
        const story = media.video_id
          ? { page_id: input.page_id, video_data: { video_id: media.video_id, image_url: media.image_url, call_to_action: cta } }
          : { page_id: input.page_id, link_data: { image_hash: media.image_hash, link: 'http://fb.me/', call_to_action: cta } };
        const creative = await graph('POST', `${account}/adcreatives`, {
          name: src.name, object_story_spec: story, asset_feed_spec: texts,
          ...(media.dof ? { degrees_of_freedom_spec: media.dof } : {}),
        });
        const ad = await graph('POST', `${account}/ads`, { name: src.name, adset_id: out.adset_id, creative: { creative_id: creative.id }, status: 'PAUSED' });
        out.ad_ids.push(ad.id as string);
      } catch (e) {
        out.failed_ads.push(`${src.name}: ${(e as Error).message}`);
      }
    }
    out.done.push(`${out.ad_ids.length} ad${out.ad_ids.length === 1 ? '' : 's'} (paused)`);
    out.ok = out.ad_ids.length > 0;
    if (!out.ok) out.error = 'No ad could be made';
  } catch (e) {
    out.error = (e as Error).message;
  }
  out.ads_manager_url = out.campaign_id
    ? `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${account.replace('act_', '')}&selected_campaign_ids=${out.campaign_id}`
    : undefined;
  // Kept so the survey can show what was built.
  await service.from('app_settings').upsert({ key: `campaign_build:${input.client_id}`, value: { at: new Date().toISOString(), ...out }, updated_at: new Date().toISOString() }, { onConflict: 'key' });
  return out;
}

export async function lastBuild(service: Service, clientId: string): Promise<(BuildResult & { at: string }) | null> {
  const { data } = await service.from('app_settings').select('value').eq('key', `campaign_build:${clientId}`).maybeSingle();
  return (data?.value as (BuildResult & { at: string }) | undefined) ?? null;
}
