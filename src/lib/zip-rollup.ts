import { createServiceClient } from './supabase';

type Service = ReturnType<typeof createServiceClient>;

// Which event type feeds each column of a zip's performance row.
export const ZIP_METRIC_EVENTS = {
  leads:        'lead',
  appointments: 'appointment_booked',
  shows:        'show',
  closes:       'closed',
} as const;

export type ZipMetric = keyof typeof ZIP_METRIC_EVENTS;

export type ZipCounts = {
  leads: number; appointments: number; shows: number; closes: number; revenue: number;
};

const EVENT_TO_METRIC: Record<string, ZipMetric> = Object.fromEntries(
  Object.entries(ZIP_METRIC_EVENTS).map(([m, e]) => [e, m as ZipMetric])
) as Record<string, ZipMetric>;

const PAGE = 1000;
const MAX_PAGES = 50;

// GHL sends postal codes in every shape going ("33139", "33139-1234", " 33139 ",
// and Canadian/blank values). Keep US 5-digit ones, drop the rest — the zip
// features are all ZCTA-based.
export function normalizeZip(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  const digits = String(raw).trim().replace(/\D/g, '').slice(0, 5);
  return /^\d{5}$/.test(digits) ? digits : null;
}

function emptyCounts(): ZipCounts {
  return { leads: 0, appointments: 0, shows: 0, closes: 0, revenue: 0 };
}

// Live per-zip rollup straight from the events table. Nothing is written: a zip's
// numbers are always whatever its events currently say, so re-delivered webhooks
// and deletions can never drift the totals.
export async function rollupEventZips(
  service: Service,
  clientId: string,
): Promise<Record<string, ZipCounts>> {
  const out: Record<string, ZipCounts> = {};

  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await service
      .from('events')
      .select('zip_code, event_type, revenue')
      .eq('client_id', clientId)
      .not('zip_code', 'is', null)
      .in('event_type', Object.values(ZIP_METRIC_EVENTS))
      .range(page * PAGE, page * PAGE + PAGE - 1);

    // Missing column (database not migrated yet) — behave as if there is no zip
    // data, so the stored zip_performance numbers keep showing.
    if (error) return out;
    if (!data?.length) break;

    for (const row of data as { zip_code: string; event_type: string; revenue: number | null }[]) {
      const zip = normalizeZip(row.zip_code);
      const metric = EVENT_TO_METRIC[row.event_type];
      if (!zip || !metric) continue;
      const counts = (out[zip] ??= emptyCounts());
      counts[metric]++;
      if (metric === 'closes') counts.revenue += Number(row.revenue) || 0;
    }

    if (data.length < PAGE) break;
  }

  return out;
}

export type CreativeRow = {
  key: string;
  label: string;
  platform: string | null;
  campaign: string | null;
  adset: string | null;
  count: number;
  revenue: number;
};

type AttrRow = {
  ad_platform: string | null; campaign_name: string | null; campaign_id: string | null;
  adset_name: string | null; adset_id: string | null; ad_name: string | null; ad_id: string | null;
  utm_source: string | null; utm_campaign: string | null; utm_content: string | null;
  revenue: number | null;
};

// Which ads / creatives produced one zip's leads (or appointments, shows, closes).
// Groups on the most specific identifier the event carries, falling back through
// ad → ad set → campaign → UTM, since GHL fills UTMs far more reliably than IDs.
export async function zipCreativeBreakdown(
  service: Service,
  clientId: string,
  zip: string,
  metric: ZipMetric,
): Promise<CreativeRow[]> {
  const groups = new Map<string, CreativeRow>();

  for (let page = 0; page < MAX_PAGES; page++) {
    const { data, error } = await service
      .from('events')
      .select('ad_platform, campaign_name, campaign_id, adset_name, adset_id, ad_name, ad_id, utm_source, utm_campaign, utm_content, revenue')
      .eq('client_id', clientId)
      .eq('zip_code', zip)
      .eq('event_type', ZIP_METRIC_EVENTS[metric])
      .range(page * PAGE, page * PAGE + PAGE - 1);

    if (error) return [];
    if (!data?.length) break;

    for (const row of data as AttrRow[]) {
      const key =
        row.ad_id || row.adset_id || row.campaign_id ||
        row.utm_content || row.utm_campaign || row.utm_source || 'unattributed';
      const label =
        row.ad_name || row.adset_name || row.campaign_name ||
        row.utm_content || row.utm_campaign || row.utm_source || 'Unattributed';

      const existing = groups.get(key);
      if (existing) {
        existing.count++;
        existing.revenue += Number(row.revenue) || 0;
      } else {
        groups.set(key, {
          key,
          label,
          platform: row.ad_platform,
          campaign: row.campaign_name,
          adset:    row.adset_name,
          count:    1,
          revenue:  Number(row.revenue) || 0,
        });
      }
    }

    if (data.length < PAGE) break;
  }

  return [...groups.values()].sort((a, b) => b.count - a.count);
}
