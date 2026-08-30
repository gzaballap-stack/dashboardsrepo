import { createServiceClient } from './supabase';

type Service = ReturnType<typeof createServiceClient>;

export const ATTRIBUTION_FIELDS = [
  'ad_platform', 'campaign_id', 'campaign_name',
  'adset_id', 'adset_name', 'ad_id', 'ad_name',
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
  'referrer_url',
] as const;

export type Attribution = Record<(typeof ATTRIBUTION_FIELDS)[number], string | null>;

export function pickAttribution(payload: Record<string, unknown>): Attribution {
  const out = {} as Attribution;
  for (const f of ATTRIBUTION_FIELDS) {
    const v = payload[f];
    out[f] = v === undefined || v === null || v === '' ? null : String(v);
  }
  return out;
}

// "Does this event carry real ad attribution?" — UTM-only counts, since GHL fills
// UTMs far more reliably than the numeric Meta IDs.
export function hasAttribution(attr: Attribution): boolean {
  return Boolean(attr.campaign_id || attr.adset_id || attr.ad_id || attr.utm_campaign || attr.utm_source);
}

// First-touch inheritance.
//
// Meta lead forms attach ad_id/adset_id/campaign_id to the lead submission, but
// nothing downstream: the appointment booked three days later, the show, and the
// close all arrive with no ad data. Without this, spend could only ever be tied
// to leads — never to appointments, closes or revenue, which is the whole point.
//
// So when an event arrives with no attribution of its own, we copy it from that
// contact's earliest attributed event. Attribution is stamped once at first touch
// and inherited by the rest of the funnel.
//
// Practical upside: GHL only needs the attribution custom-data fields on the
// New Lead workflow, not on all six.
export async function inheritAttribution(
  service: Service,
  opts: {
    table: 'events' | 'b2b_events';
    client_id?: string | null;
    ghl_contact_id?: string | null;
    attr: Attribution;
  },
): Promise<Attribution> {
  // An event that knows its own origin always wins.
  if (hasAttribution(opts.attr)) return opts.attr;
  if (!opts.ghl_contact_id) return opts.attr;

  let q = service
    .from(opts.table)
    .select(ATTRIBUTION_FIELDS.join(','))
    .eq('ghl_contact_id', opts.ghl_contact_id)
    .or('campaign_id.not.is.null,utm_campaign.not.is.null,utm_source.not.is.null')
    .order('occurred_at', { ascending: true })
    .limit(1);

  if (opts.table === 'events' && opts.client_id) q = q.eq('client_id', opts.client_id);

  const { data, error } = await q;
  if (error || !data?.length) return opts.attr;

  const source = data[0] as unknown as Attribution;
  const merged = { ...opts.attr };
  for (const f of ATTRIBUTION_FIELDS) merged[f] = merged[f] ?? source[f] ?? null;
  return merged;
}
