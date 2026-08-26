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
  impressions: number;
  reach: number;
  link_clicks: number;
  ctr: number | null;
  cpc: number | null;
  cpm: number | null;
  intro_show_rate: number;
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
function fmtDec(n: number, digits = 2) {
  return n.toFixed(digits);
}

function computeBottleneck(d: B2BMetrics): { label: string; action: string } {
  if (!d.leads && !d.ad_spend) return { label: "No Data", action: "No events yet — wire up GHL workflows" };

  const cbr      = d.leads > 0 ? d.intros_booked / d.leads : 0;
  const showRate  = d.intros_booked > 0 ? d.intros_shown / d.intros_booked : 0;
  const closeRate = d.sales_calls_shown > 0 ? d.closes / d.sales_calls_shown : 0;

  if (d.leads === 0)    return { label: "Targeting",    action: "No leads — review audience and creative" };
  if (cbr < 0.05)      return { label: "Funnel",       action: "Low booking rate — improve follow-up sequences" };
  if (showRate < 0.5)  return { label: "Post-Funnel",  action: "Low intro show rate — improve confirmation/reminder flow" };
  if (closeRate < 0.2) return { label: "Post-Funnel",  action: "Low close rate — review sales call process" };
  return { label: "Healthy", action: "All funnel stages performing well" };
}

interface StatCardProps {
  label: string;
  value: string;
  sub?: string;
}
function StatCard({ label, value, sub }: StatCardProps) {
  return (
    <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-4">
      <p className="text-[11px] uppercase tracking-wider font-semibold text-[var(--muted)] mb-1">{label}</p>
      <p className="text-2xl font-bold text-[var(--foreground)] tabular-nums">{value}</p>
      {sub && <p className="text-xs text-[var(--muted)] mt-0.5">{sub}</p>}
    </div>
  );
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

  const cbr     = data.leads > 0 ? data.intros_booked / data.leads : 0;
  const cpa     = data.intros_booked > 0 ? data.ad_spend / data.intros_booked : 0;
  const l2a     = data.leads > 0 ? data.intros_booked / data.leads : 0;
  const { label: bottleneck, action } = computeBottleneck(data);
  const bnStyle = BOTTLENECK_STYLE[bottleneck] ?? BOTTLENECK_STYLE["No Data"];

  const COL_H = "text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)] px-3 py-2 text-right whitespace-nowrap";
  const COL_L = "text-[10px] font-semibold uppercase tracking-wider text-[var(--muted)] px-3 py-2 text-left whitespace-nowrap";
  const CELL  = "px-3 py-3 text-sm text-right tabular-nums text-[var(--foreground)] whitespace-nowrap";
  const CEL_L = "px-3 py-3 text-sm text-left text-[var(--foreground)] whitespace-nowrap";
  const dash  = <span className="text-[var(--muted)]">—</span>;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-semibold text-[var(--foreground)]">B2B Tracking</h2>
        <p className="text-xs text-[var(--muted)] mt-0.5">{startDate} — {endDate}</p>
      </div>

      {/* ── Stat Cards: Ad Metrics ── */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)] mb-2">Ad Performance</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatCard label="Ad Spend"   value={data.ad_spend > 0 ? fmt$(data.ad_spend) : "—"} />
          <StatCard label="Reach"      value={data.reach        > 0 ? fmtN(data.reach)      : "—"} />
          <StatCard label="Impressions" value={data.impressions > 0 ? fmtN(data.impressions): "—"} />
          <StatCard label="Link Clicks" value={data.link_clicks > 0 ? fmtN(data.link_clicks): "—"} />
          <StatCard label="CTR"        value={data.ctr  != null ? fmtPct(data.ctr)  : "—"} sub="click-through rate" />
          <StatCard label="CPC"        value={data.cpc  != null ? `$${fmtDec(data.cpc)}` : "—"} sub="cost per click" />
        </div>
      </div>

      {/* ── Stat Cards: Funnel ── */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)] mb-2">Funnel</p>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatCard label="Leads"         value={fmtN(data.leads)}         sub={data.cost_per_lead > 0 ? `${fmt$(data.cost_per_lead)} / lead` : undefined} />
          <StatCard label="Intros Booked" value={fmtN(data.intros_booked)} sub={data.leads > 0 ? `${fmtPct(cbr*100)} booking rate` : undefined} />
          <StatCard label="Intros Shown"  value={fmtN(data.intros_shown)}  sub={data.intros_booked > 0 ? `${fmtPct(data.intro_show_rate*100)} show rate` : undefined} />
          <StatCard label="Sales Calls Booked" value={fmtN(data.sales_calls_booked)} />
          <StatCard label="Sales Calls Shown"  value={fmtN(data.sales_calls_shown)} />
          <StatCard label="Closes"        value={fmtN(data.closes)}        sub={data.cash_collected > 0 ? `${fmt$(data.cash_collected)} collected` : undefined} />
        </div>
      </div>

      {/* ── Campaign Overview-style Table Row ── */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-[var(--muted)] mb-2">Summary Row</p>
        <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--muted)]/5">
                  <th className={COL_L}>Campaign</th>
                  <th className={COL_H}>RAN</th>
                  <th className={COL_H}>SPAN</th>
                  <th className={COL_H}>LEAD</th>
                  <th className={COL_H}>CBOs</th>
                  <th className={COL_H}>CTR</th>
                  <th className={COL_H}>CPC</th>
                  <th className={COL_H}>CBR</th>
                  <th className={COL_H}>Appts</th>
                  <th className={COL_H}>Cost / Appt</th>
                  <th className={COL_H}>Lead → Appt</th>
                  <th className={COL_L}>Bottleneck</th>
                  <th className={COL_L}>Action</th>
                </tr>
              </thead>
              <tbody>
                <tr className="hover:bg-[var(--muted)]/5 transition-colors">
                  <td className={CEL_L}>
                    <span className="font-semibold">B2B</span>
                  </td>
                  {/* RAN — Reach */}
                  <td className={CELL}>{data.reach > 0 ? fmtN(data.reach) : dash}</td>
                  {/* SPAN — Ad Spend */}
                  <td className={CELL}>{data.ad_spend > 0 ? fmt$(data.ad_spend) : dash}</td>
                  {/* LEAD */}
                  <td className={CELL}>{data.leads > 0 ? fmtN(data.leads) : dash}</td>
                  {/* CBOs — not yet available */}
                  <td className={CELL}>{dash}</td>
                  {/* CTR */}
                  <td className={CELL}>{data.ctr != null ? fmtPct(data.ctr) : dash}</td>
                  {/* CPC */}
                  <td className={CELL}>{data.cpc != null ? `$${fmtDec(data.cpc)}` : dash}</td>
                  {/* CBR — booking rate */}
                  <td className={CELL}>{data.leads > 0 ? fmtPct(cbr * 100) : dash}</td>
                  {/* Appts */}
                  <td className={CELL}>{data.intros_booked > 0 ? fmtN(data.intros_booked) : dash}</td>
                  {/* Cost / Appt */}
                  <td className={CELL}>{cpa > 0 ? fmt$(cpa) : dash}</td>
                  {/* Lead → Appt */}
                  <td className={CELL}>{data.leads > 0 ? fmtPct(l2a * 100) : dash}</td>
                  {/* Bottleneck */}
                  <td className={CEL_L}>
                    <span
                      className="inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap"
                      style={{ color: bnStyle.color, background: bnStyle.bg }}
                    >
                      {bottleneck}
                    </span>
                  </td>
                  {/* Action */}
                  <td className={CEL_L}>
                    <span className="text-xs text-[var(--muted)] max-w-[220px] block">{action}</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
