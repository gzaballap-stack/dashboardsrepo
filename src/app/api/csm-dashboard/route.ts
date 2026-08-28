import { NextResponse } from 'next/server';
import { getAuthContext, isAuthError } from '@/lib/api-auth';
import { getLiveClientIds, liveClientFilter } from '@/lib/db-helpers';

const DEFAULT_CADENCE_DAYS = 14;
// A client is "at risk" once they're this many multiples of their cadence overdue --
// e.g. a 14-day cadence client becomes at-risk past 28 days of silence, not just late.
const AT_RISK_MULTIPLIER = 2;

type TouchpointRow = {
  client_id: string;
  occurred_at: string;
  type: string;
  summary: string | null;
  csm_name: string | null;
};

type StatusRow = {
  client_id: string;
  cadence_days: number;
  csm_name: string | null;
  left_review: boolean;
  review_date: string | null;
  review_platform: string | null;
  review_link: string | null;
  upsell_status: string;
  upsell_notes: string | null;
  upsell_date: string | null;
};

export async function GET() {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;

  const liveClientIds = await getLiveClientIds(ctx.service);
  const filterIds = liveClientFilter(liveClientIds);

  const [{ data: clients, error: clientsError }, { data: touchpoints, error: tpError }, { data: statuses, error: statusError }] = await Promise.all([
    ctx.service.from('clients').select('id, name').in('id', filterIds).order('name'),
    ctx.service.from('client_touchpoints').select('client_id, occurred_at, type, summary, csm_name').in('client_id', filterIds).order('occurred_at', { ascending: false }),
    ctx.service.from('client_csm_status').select('*').in('client_id', filterIds),
  ]);

  if (clientsError) return NextResponse.json({ error: clientsError.message }, { status: 500 });
  if (tpError) return NextResponse.json({ error: tpError.message }, { status: 500 });
  if (statusError) return NextResponse.json({ error: statusError.message }, { status: 500 });

  const touchpointsByClient = new Map<string, TouchpointRow[]>();
  for (const tp of (touchpoints ?? []) as TouchpointRow[]) {
    const list = touchpointsByClient.get(tp.client_id) ?? [];
    list.push(tp);
    touchpointsByClient.set(tp.client_id, list);
  }

  const statusByClient = new Map<string, StatusRow>((statuses ?? []).map((s: StatusRow) => [s.client_id, s]));

  const now = Date.now();

  const rows = (clients ?? []).map(c => {
    const tps = touchpointsByClient.get(c.id) ?? [];
    const last = tps[0] ?? null;
    const status = statusByClient.get(c.id) ?? null;
    const cadenceDays = status?.cadence_days ?? DEFAULT_CADENCE_DAYS;

    const daysSinceLastTouch = last
      ? Math.floor((now - new Date(last.occurred_at).getTime()) / 86400000)
      : null;

    const overdue = daysSinceLastTouch === null ? true : daysSinceLastTouch > cadenceDays;
    const atRisk = daysSinceLastTouch === null
      ? tps.length === 0 // never contacted at all -- treat as at-risk regardless of client age
      : daysSinceLastTouch > cadenceDays * AT_RISK_MULTIPLIER;

    return {
      client_id: c.id,
      client_name: c.name,
      cadence_days: cadenceDays,
      csm_name: status?.csm_name ?? null,
      last_touch_at: last?.occurred_at ?? null,
      last_touch_type: last?.type ?? null,
      last_touch_summary: last?.summary ?? null,
      days_since_last_touch: daysSinceLastTouch,
      overdue,
      at_risk: atRisk,
      total_touchpoints: tps.length,
      left_review: status?.left_review ?? false,
      review_date: status?.review_date ?? null,
      review_platform: status?.review_platform ?? null,
      review_link: status?.review_link ?? null,
      upsell_status: status?.upsell_status ?? 'none',
      upsell_notes: status?.upsell_notes ?? null,
      upsell_date: status?.upsell_date ?? null,
    };
  }).sort((a, b) => {
    // At-risk first, then overdue, then most-recently-touched last
    if (a.at_risk !== b.at_risk) return a.at_risk ? -1 : 1;
    if (a.overdue !== b.overdue) return a.overdue ? -1 : 1;
    return (a.days_since_last_touch ?? 999) - (b.days_since_last_touch ?? 999);
  });

  return NextResponse.json({ clients: rows });
}
