import { NextResponse } from 'next/server';
import { getAuthContext, isAuthError } from '@/lib/api-auth';
import { getTomsiClientId } from '@/lib/tomsi';
import { getExcludedSpend } from '@/lib/exclusions';

// The records behind the B2B (Tomsi Media) dashboard tiles, for the
// "click a stat to see where it comes from" panel.
//
// Returns the same rows the tiles are computed from, with the same date bounds:
//   events — the Tomsi client's mirrored rows  (what /api/metrics counts)
//   b2b    — b2b_events                        (what /api/b2b-metrics counts)
//   spend  — ad_spend for the Tomsi client     (what /api/metrics sums)
// Read-only. The panel filters these per stat (see lib/b2b-stat-sources.ts).

const PAGE = 1000;

export async function GET(req: Request) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;

  const { searchParams } = new URL(req.url);
  const start_date = searchParams.get('start_date');
  const end_date = searchParams.get('end_date');

  const tomsiId = await getTomsiClientId(ctx.service);
  if (!tomsiId) return NextResponse.json({ error: 'Tomsi Media client not found' }, { status: 404 });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function all(build: () => any): Promise<Record<string, unknown>[]> {
    const out: Record<string, unknown>[] = [];
    for (let offset = 0; ; offset += PAGE) {
      const { data, error } = await build().range(offset, offset + PAGE - 1);
      if (error) throw new Error(error.message);
      if (!data?.length) break;
      out.push(...data);
      if (data.length < PAGE) break;
    }
    return out;
  }

  try {
    const [events, b2b, spendRes] = await Promise.all([
      all(() => {
        let q = ctx.service.from('events')
          .select('event_type, occurred_at, scheduled_at, lead_name, agent_name, is_pickup, is_conversation, duration_seconds, speed_to_lead_seconds, call_status, revenue, ghl_contact_id, campaign_name, ad_id, ad_name')
          .eq('client_id', tomsiId)
          .order('occurred_at', { ascending: false });
        if (start_date) q = q.gte('occurred_at', `${start_date}T00:00:00.000Z`);
        if (end_date)   q = q.lte('occurred_at', `${end_date}T23:59:59.999Z`);
        return q;
      }),
      all(() => {
        let q = ctx.service.from('b2b_events')
          .select('event_type, occurred_at, lead_name, revenue, booked_by, progress_pct, ghl_contact_id, ad_id, ad_name')
          .order('occurred_at', { ascending: false });
        if (start_date) q = q.gte('occurred_at', `${start_date}T00:00:00.000Z`);
        if (end_date)   q = q.lte('occurred_at', `${end_date}T23:59:59.999Z`);
        return q;
      }),
      (() => {
        let q = ctx.service.from('ad_spend').select('client_id, spend_date, amount').eq('client_id', tomsiId).order('spend_date', { ascending: false });
        if (start_date) q = q.gte('spend_date', start_date);
        if (end_date)   q = q.lte('spend_date', end_date);
        return q;
      })(),
    ]);
    if (spendRes.error) throw new Error(spendRes.error.message);

    // Ad id → the ad's real name. This funnel passes Meta's numeric ids through
    // the UTM slots, so an event's own ad_name is often just the id again.
    const { data: adRows } = await ctx.service.from('ad_campaigns')
      .select('ad_id, ad_name').eq('client_id', tomsiId).eq('level', 'ad').not('ad_name', 'is', null).limit(5000);
    const ad_names: Record<string, string> = {};
    for (const r of adRows ?? []) if (r.ad_id && r.ad_name) ad_names[r.ad_id] = r.ad_name;

    const excluded_spend = await getExcludedSpend(ctx.service, spendRes.data ?? [], { client_id: tomsiId, client_ids: null });

    return NextResponse.json({
      events, b2b,
      spend: (spendRes.data ?? []).map(r => ({ spend_date: r.spend_date, amount: Number(r.amount) || 0 })),
      excluded_spend,
      ad_names,
    });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
