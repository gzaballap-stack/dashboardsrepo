"use client";

import { useEffect, useRef, useState } from "react";

interface B2BMetrics {
  ad_spend: number;
  leads: number;
  intros_booked: number;
  intros_shown: number;
  sales_calls_booked: number;
  sales_calls_shown: number;
  closes: number;
  cash_collected: number;
  cost_per_lead: number;
  cost_per_close: number;
}

interface Props {
  startDate: string;
  endDate: string;
}

const BOTTLENECK_STYLE: Record<string, { color: string; bg: string }> = {
  Healthy:       { color: "#4ade80", bg: "rgba(74,222,128,0.1)" },
  Creative:      { color: "#f472b6", bg: "rgba(244,114,182,0.1)" },
  Targeting:     { color: "#f59e0b", bg: "rgba(245,158,11,0.1)" },
  Funnel:        { color: "#fb923c", bg: "rgba(251,146,60,0.1)" },
  "Post-Funnel": { color: "#a78bfa", bg: "rgba(167,139,250,0.1)" },
  "No Data":     { color: "#64748b", bg: "rgba(100,116,139,0.1)" },
};

function fmt$(n: number) {
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}
function fmtPct(n: number) {
  return `${n.toFixed(1)}%`;
}
function fmtN(n: number) {
  return n.toLocaleString();
}

function computeBottleneck(d: B2BMetrics): { label: string; action: string } {
  if (!d.leads && !d.ad_spend) return { label: "No Data", action: "No events yet — wire up GHL workflows" };

  const cbr     = d.leads > 0 ? d.intros_booked / d.leads : 0;
  const showRate = d.intros_booked > 0 ? d.intros_shown / d.intros_booked : 0;
  const closeRate = d.sales_calls_shown > 0 ? d.closes / d.sales_calls_shown : 0;

  if (d.leads === 0)        return { label: "Targeting",    action: "No leads coming in — review audience and creative" };
  if (cbr < 0.05)          return { label: "Funnel",       action: "Low booking rate — improve follow-up sequences" };
  if (showRate < 0.5)      return { label: "Post-Funnel",  action: "Low intro show rate — improve confirmation/reminder flow" };
  if (closeRate < 0.2)     return { label: "Post-Funnel",  action: "Low close rate — review sales call process" };
  return { label: "Healthy", action: "All funnel stages performing well" };
}

export default function B2BTracking({ startDate, endDate }: Props) {
  const [data, setData] = useState<B2BMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    fetch(`/api/b2b-metrics?start_date=${startDate}&end_date=${endDate}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) throw new Error(d.error);
        setData(d);
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  };

  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => { loadRef.current(); }, [startDate, endDate]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48 text-[var(--muted)] text-sm">
        Loading B2B metrics…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-48 text-red-500 text-sm">{error}</div>
    );
  }

  if (!data) return null;

  const cbr      = data.leads > 0 ? data.intros_booked / data.leads : 0;
  const cpa      = data.intros_booked > 0 ? data.ad_spend / data.intros_booked : 0;
  const l2a      = data.leads > 0 ? data.intros_booked / data.leads : 0;
  const { label: bottleneck, action } = computeBottleneck(data);
  const bnStyle  = BOTTLENECK_STYLE[bottleneck] ?? BOTTLENECK_STYLE["No Data"];

  const COL_HEADER = "text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)] px-3 py-2 text-right whitespace-nowrap";
  const COL_LEFT   = "text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)] px-3 py-2 text-left whitespace-nowrap";
  const CELL       = "px-3 py-3 text-sm text-right tabular-nums text-[var(--foreground)] whitespace-nowrap";
  const CELL_LEFT  = "px-3 py-3 text-sm text-left text-[var(--foreground)] whitespace-nowrap";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold text-[var(--foreground)]">B2B Tracking</h2>
          <p className="text-xs text-[var(--muted)] mt-0.5">{startDate} — {endDate}</p>
        </div>
      </div>

      <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--muted)]/5">
                <th className={COL_LEFT}>Campaign</th>
                <th className={COL_HEADER}>RAN</th>
                <th className={COL_HEADER}>SPAN</th>
                <th className={COL_HEADER}>LEADS</th>
                <th className={COL_HEADER}>CBOs</th>
                <th className={COL_HEADER}>CTR</th>
                <th className={COL_HEADER}>CPC</th>
                <th className={COL_HEADER}>CBR</th>
                <th className={COL_HEADER}>Appts</th>
                <th className={COL_HEADER}>Cost / Appt</th>
                <th className={COL_HEADER}>Lead → Appt</th>
                <th className={COL_LEFT}>Bottleneck</th>
                <th className={COL_LEFT}>Action</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-[var(--border)]/50 hover:bg-[var(--muted)]/5 transition-colors">
                {/* Campaign */}
                <td className={CELL_LEFT}>
                  <span className="font-semibold text-[var(--foreground)]">B2B</span>
                </td>

                {/* RAN — Reach (Meta API not yet extended) */}
                <td className={CELL}>
                  <span className="text-[var(--muted)]">—</span>
                </td>

                {/* SPAN — Ad Spend */}
                <td className={CELL}>
                  {data.ad_spend > 0 ? fmt$(data.ad_spend) : <span className="text-[var(--muted)]">—</span>}
                </td>

                {/* LEADS */}
                <td className={CELL}>
                  {data.leads > 0 ? fmtN(data.leads) : <span className="text-[var(--muted)]">—</span>}
                </td>

                {/* CBOs — (Meta API not yet extended) */}
                <td className={CELL}>
                  <span className="text-[var(--muted)]">—</span>
                </td>

                {/* CTR — (Meta API not yet extended) */}
                <td className={CELL}>
                  <span className="text-[var(--muted)]">—</span>
                </td>

                {/* CPC — (Meta API not yet extended) */}
                <td className={CELL}>
                  <span className="text-[var(--muted)]">—</span>
                </td>

                {/* CBR — Click Booking Rate (leads → intros booked) */}
                <td className={CELL}>
                  {data.leads > 0 ? fmtPct(cbr * 100) : <span className="text-[var(--muted)]">—</span>}
                </td>

                {/* Appointments (Intros Booked) */}
                <td className={CELL}>
                  {data.intros_booked > 0 ? fmtN(data.intros_booked) : <span className="text-[var(--muted)]">—</span>}
                </td>

                {/* Cost per Appointment */}
                <td className={CELL}>
                  {cpa > 0 ? fmt$(cpa) : <span className="text-[var(--muted)]">—</span>}
                </td>

                {/* Lead → Appointment % */}
                <td className={CELL}>
                  {data.leads > 0 ? fmtPct(l2a * 100) : <span className="text-[var(--muted)]">—</span>}
                </td>

                {/* Bottleneck */}
                <td className={CELL_LEFT}>
                  <span
                    className="inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap"
                    style={{ color: bnStyle.color, background: bnStyle.bg }}
                  >
                    {bottleneck}
                  </span>
                </td>

                {/* Action */}
                <td className={CELL_LEFT}>
                  <span className="text-xs text-[var(--muted)] max-w-[220px] block">{action}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Summary footer */}
        <div className="px-4 py-3 border-t border-[var(--border)]/50 flex flex-wrap gap-6 text-xs text-[var(--muted)]">
          <span>Closes: <strong className="text-[var(--foreground)]">{fmtN(data.closes)}</strong></span>
          <span>Cash Collected: <strong className="text-[var(--foreground)]">{fmt$(data.cash_collected)}</strong></span>
          <span>Intros Shown: <strong className="text-[var(--foreground)]">{fmtN(data.intros_shown)}</strong></span>
          <span>Sales Calls Booked: <strong className="text-[var(--foreground)]">{fmtN(data.sales_calls_booked)}</strong></span>
          <span>Sales Calls Shown: <strong className="text-[var(--foreground)]">{fmtN(data.sales_calls_shown)}</strong></span>
        </div>
      </div>
    </div>
  );
}
