import { createServiceClient } from './supabase';

type Service = ReturnType<typeof createServiceClient>;

export type SpendRowWithDate = {
  client_id: string;
  spend_date: string;
  amount: number | string;
};

// Ad accounts frequently carry campaigns Tomsi Media doesn't run — another
// agency's, a legacy campaign, or a second company sharing the account. Those
// are opted out per client in ad_campaign_exclusions and must not reach any
// rollup.
//
// The two spend tables are populated by different pipelines and do NOT agree:
// for some clients ad_spend has far more days than ad_campaigns, for others the
// reverse. So we can neither subtract one from the other nor swap the source
// without distorting totals. Instead ad_campaigns is used only for the *ratio*
// of excluded-to-total spend on each date, and that ratio is applied to the
// ad_spend figure for the same date, which stays the source of magnitude.
//
// Dates with no campaign breakdown get no adjustment — the split is unknowable
// there, and leaving the figure alone is the conservative choice. With nothing
// excluded this returns 0 and every number is unchanged.
export async function getExcludedSpend(
  service: Service,
  spendRows: SpendRowWithDate[],
  opts: { client_id?: string | null; client_ids?: string[] | null },
): Promise<number> {
  if (!spendRows.length) return 0;

  let exQuery = service.from('ad_campaign_exclusions').select('client_id, campaign_id');
  if (opts.client_id) exQuery = exQuery.eq('client_id', opts.client_id);
  else if (opts.client_ids?.length) exQuery = exQuery.in('client_id', opts.client_ids);

  const { data: exclusions, error } = await exQuery;
  if (error || !exclusions?.length) return 0;

  const excludedKeys = new Set(
    (exclusions as { client_id: string; campaign_id: string }[])
      .map(e => `${e.client_id}:${e.campaign_id}`),
  );
  const affectedClients = Array.from(
    new Set((exclusions as { client_id: string }[]).map(e => e.client_id)),
  );

  // Only the dates actually present in the spend rows matter.
  const dates = spendRows.map(r => r.spend_date).filter(Boolean).sort();
  const minDate = dates[0];
  const maxDate = dates[dates.length - 1];

  let campQuery = service
    .from('ad_campaigns')
    .select('client_id, report_date, campaign_id, spend')
    .eq('level', 'campaign')
    .in('client_id', affectedClients);
  if (minDate) campQuery = campQuery.gte('report_date', minDate);
  if (maxDate) campQuery = campQuery.lte('report_date', maxDate);

  const { data: campRows } = await campQuery;
  if (!campRows?.length) return 0;

  // client:date -> { total, excluded }
  const split = new Map<string, { total: number; excluded: number }>();
  for (const r of campRows as { client_id: string; report_date: string; campaign_id: string; spend: number | string }[]) {
    const key = `${r.client_id}:${r.report_date}`;
    const acc = split.get(key) ?? { total: 0, excluded: 0 };
    const amt = Number(r.spend) || 0;
    acc.total += amt;
    if (excludedKeys.has(`${r.client_id}:${r.campaign_id}`)) acc.excluded += amt;
    split.set(key, acc);
  }

  let adjustment = 0;
  for (const row of spendRows) {
    const acc = split.get(`${row.client_id}:${row.spend_date}`);
    if (!acc || acc.total <= 0 || acc.excluded <= 0) continue;
    const ratio = Math.min(1, acc.excluded / acc.total);
    adjustment += (Number(row.amount) || 0) * ratio;
  }

  return adjustment;
}
