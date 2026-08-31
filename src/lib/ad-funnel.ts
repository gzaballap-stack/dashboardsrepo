import { createServiceClient } from './supabase';

type Service = ReturnType<typeof createServiceClient>;

/** Which attribution column the rollup is keyed on. */
export type AdLevel = 'campaign' | 'adset' | 'ad';

const LEVEL_COLUMN: Record<AdLevel, 'campaign_id' | 'adset_id' | 'ad_id'> = {
  campaign: 'campaign_id',
  adset:    'adset_id',
  ad:       'ad_id',
};

export type AdFunnel = {
  leads: number;
  appts: number;
  shows: number;
  no_shows: number;
  closes: number;
  revenue: number;
};

export const EMPTY_AD_FUNNEL: AdFunnel = {
  leads: 0, appts: 0, shows: 0, no_shows: 0, closes: 0, revenue: 0,
};

// B2C and B2B name the same funnel shape differently. B2B runs intro call ->
// sales call -> close; the intro is the conversion the ad actually bought, so it
// maps to appts/shows. sales_call_* sit downstream of the intro and would double
// count the same contact, so they are deliberately not folded in here.
const STAGE_MAP: Record<'events' | 'b2b_events', Record<string, keyof AdFunnel>> = {
  events: {
    lead:               'leads',
    appointment_booked: 'appts',
    show:               'shows',
    no_show:            'no_shows',
    closed:             'closes',
  },
  b2b_events: {
    lead:         'leads',
    intro_booked: 'appts',
    intro_shown:  'shows',
    close:        'closes',
  },
};

/**
 * Roll the real funnel up by ad entity.
 *
 * Counts leads/appointments/shows/closes from `events` (B2C) or `b2b_events`
 * (B2B), grouped by campaign_id / adset_id / ad_id — the attribution stamped at
 * first touch and inherited down the funnel by `lib/attribution`.
 *
 * This is deliberately not Meta's own reported `leads` field on ad_campaigns:
 * that counts form opens Meta saw, not leads that reached the CRM.
 *
 * Rows with a null id at the requested level are skipped — an unattributed event
 * belongs to no ad, and spreading it would invent attribution that isn't there.
 */
export async function rollupFunnelByAd(
  service: Service,
  opts: {
    table: 'events' | 'b2b_events';
    level: AdLevel;
    start_date?: string | null;
    end_date?: string | null;
    client_id?: string | null;
    campaign_id?: string | null;
  },
): Promise<Map<string, AdFunnel>> {
  const col    = LEVEL_COLUMN[opts.level];
  const stages = STAGE_MAP[opts.table];
  const out    = new Map<string, AdFunnel>();

  const PAGE = 1000;
  let offset = 0;

  for (;;) {
    let q = service
      .from(opts.table)
      .select(`${col}, event_type, revenue`)
      .not(col, 'is', null)
      .in('event_type', Object.keys(stages));

    if (opts.client_id)   q = q.eq('client_id', opts.client_id);
    if (opts.campaign_id) q = q.eq('campaign_id', opts.campaign_id);
    if (opts.start_date)  q = q.gte('occurred_at', `${opts.start_date}T00:00:00.000Z`);
    if (opts.end_date)    q = q.lte('occurred_at', `${opts.end_date}T23:59:59.999Z`);

    const { data, error } = await q.range(offset, offset + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;

    for (const row of data as unknown as Array<Record<string, unknown>>) {
      const key = row[col] as string | null;
      if (!key) continue;

      const slot = stages[row.event_type as string];
      if (!slot) continue;

      const f = out.get(key) ?? { ...EMPTY_AD_FUNNEL };
      (f[slot] as number) += 1;
      // Revenue rides on the close event, so only count it once, there.
      if (slot === 'closes') f.revenue += Number(row.revenue) || 0;
      out.set(key, f);
    }

    if (data.length < PAGE) break;
    offset += PAGE;
  }

  return out;
}

/** Cost-per-stage and ROAS for one ad entity. Zero denominators stay 0. */
export function funnelRates(spend: number, f: AdFunnel) {
  return {
    cost_per_lead:  f.leads  > 0 ? spend / f.leads  : 0,
    cost_per_appt:  f.appts  > 0 ? spend / f.appts  : 0,
    cost_per_close: f.closes > 0 ? spend / f.closes : 0,
    lead_to_appt:   f.leads  > 0 ? (f.appts / f.leads) * 100 : 0,
    show_rate:      f.appts  > 0 ? (f.shows / f.appts) * 100 : 0,
    close_rate:     f.shows  > 0 ? (f.closes / f.shows) * 100 : 0,
    roas:           spend    > 0 ? f.revenue / spend : 0,
  };
}
