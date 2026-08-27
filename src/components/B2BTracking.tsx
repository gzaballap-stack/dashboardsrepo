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
  Healthy:       { color: "#4ade80", bg: "rgba(74,222,128,0.1)"  },
  Creative:      { color: "#f472b6", bg: "rgba(244,114,182,0.1)" },
  Targeting:     { color: "#f59e0b", bg: "rgba(245,158,11,0.1)"  },
  Funnel:        { color: "#fb923c", bg: "rgba(251,146,60,0.1)"  },
  "Post-Funnel": { color: "#a78bfa", bg: "rgba(167,139,250,0.1)" },
  "No Data":     { color: "#64748b", bg: "rgba(100,116,139,0.1)" },
};

const STATUS_STYLE: Record<string, { label: string; color: string; bg: string }> = {
  excellent:    { label: "Excellent",    color: "#4ade80", bg: "rgba(74,222,128,0.12)"  },
  on_target:    { label: "On Target",    color: "#38bdf8", bg: "rgba(56,189,248,0.12)"  },
  above_target: { label: "Above Target", color: "#f59e0b", bg: "rgba(245,158,11,0.12)"  },
  critical:     { label: "Critical",     color: "#f87171", bg: "rgba(248,113,113,0.12)" },
  no_data:      { label: "No Data",      color: "#64748b", bg: "rgba(100,116,139,0.12)" },
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

function computeStatus(d: B2BMetrics): string {
  if (!d.leads && !d.ad_spend) return "no_data";
  const cbr = d.leads > 0 ? d.intros_booked / d.leads : 0;
  if (cbr >= 0.15) return "excellent";
  if (cbr >= 0.08) return "on_target";
  if (cbr >= 0.04) return "above_target";
  return "critical";
}

function computeBottleneck(d: B2BMetrics): { label: string; action: string } {
  if (!d.leads && !d.ad_spend) return { label: "No Data", action: "No events yet" };
  const cbr       = d.leads > 0 ? d.intros_booked / d.leads : 0;
  const showRate   = d.intros_booked > 0 ? d.intros_shown / d.intros_booked : 0;
  const closeRate  = d.sales_calls_shown > 0 ? d.closes / d.sales_calls_shown : 0;
  if (d.leads === 0)    return { label: "Targeting",    action: "No leads — review audience & creative" };
  if (cbr < 0.05)      return { label: "Funnel",       action: "Low booking rate — improve follow-up" };
  if (showRate < 0.5)  return { label: "Post-Funnel",  action: "Low show rate — improve reminders" };
  if (closeRate < 0.2) return { label: "Post-Funnel",  action: "Low close rate — review sales process" };
  return { label: "Healthy", action: "All stages performing well" };
}

// ── KPI card matching the Dashboard style exactly ──
function KpiCard({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div
      className="relative overflow-hidden rounded-xl p-5 flex flex-col gap-2 transition-all duration-200 hover:translate-y-[-1px]"
      style={{ background: "linear-gradient(135deg, #0f2040 0%, #0c1a30 100%)", border: "1px solid rgba(255,255,255,0.07)" }}
    >
      <div className="absolute top-0 left-0 w-1 h-full rounded-l-xl"
        style={{ background: accent ? "#f59e0b" : "#1d4ed8" }} />
      <span className="text-xs font-medium tracking-wide pl-3" style={{ color: "#64748b" }}>{label}</span>
      <span className="text-3xl font-bold pl-3" style={{ color: "#f1f5f9" }}>{value}</span>
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
      <div className="flex items-center justify-center py-24">
        <div className="flex items-center gap-3" style={{ color: "#334155" }}>
          <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span className="text-sm font-medium">Loading B2B metrics…</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-xl p-4 text-sm" style={{ background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.2)", color: "#fca5a5" }}>
        {error}
      </div>
    );
  }

  if (!data) return null;

  const cbr    = data.leads > 0 ? data.intros_booked / data.leads : 0;
  const cpa    = data.intros_booked > 0 ? data.ad_spend / data.intros_booked : 0;
  const l2a    = data.leads > 0 ? data.intros_booked / data.leads : 0;
  const { label: bottleneck, action } = computeBottleneck(data);
  const bnStyle  = BOTTLENECK_STYLE[bottleneck] ?? BOTTLENECK_STYLE["No Data"];
  const statusKey = computeStatus(data);
  const stStyle   = STATUS_STYLE[statusKey] ?? STATUS_STYLE["no_data"];
  const dash = <span style={{ color: "#334155" }}>—</span>;

  return (
    <div className="space-y-8 max-w-7xl">

      {/* ── Row 1: Funnel KPIs ── */}
      <section>
        <h2 className="text-xs font-bold uppercase tracking-widest mb-4" style={{ color: "#334155" }}>Funnel</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <KpiCard label="Leads"              value={fmtN(data.leads)} />
          <KpiCard label="Intros Booked"      value={fmtN(data.intros_booked)} />
          <KpiCard label="Intros Shown"       value={fmtN(data.intros_shown)} accent />
          <KpiCard label="Sales Calls Booked" value={fmtN(data.sales_calls_booked)} />
          <KpiCard label="Sales Calls Shown"  value={fmtN(data.sales_calls_shown)} accent />
          <KpiCard label="Closes"             value={fmtN(data.closes)} accent />
        </div>
      </section>

      {/* ── Row 2: Ad / Revenue KPIs ── */}
      <section>
        <h2 className="text-xs font-bold uppercase tracking-widest mb-4" style={{ color: "#334155" }}>Ad Performance</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <KpiCard label="Ad Spend"       value={data.ad_spend    > 0 ? fmt$(data.ad_spend)          : "—"} />
          <KpiCard label="Cost per Lead"  value={data.cost_per_lead > 0 ? fmt$(data.cost_per_lead)   : "—"} />
          <KpiCard label="CP Appointment" value={cpa              > 0 ? fmt$(cpa)                    : "—"} />
          <KpiCard label="Cash Collected" value={data.cash_collected > 0 ? fmt$(data.cash_collected) : "—"} accent />
          <KpiCard label="Reach"          value={data.reach       > 0 ? fmtN(data.reach)             : "—"} />
        </div>
      </section>

      {/* ── Campaign Overview-style table row ── */}
      <section>
        <h2 className="text-xs font-bold uppercase tracking-widest mb-4" style={{ color: "#334155" }}>B2B Campaign — Overview</h2>
        <div className="rounded-xl overflow-x-auto" style={{ border: "1px solid rgba(255,255,255,0.07)" }}>
          <table className="w-full text-sm" style={{ minWidth: 1100 }}>
            <thead>
              <tr style={{ background: "#0c1a30", color: "#64748b" }}>
                <th className="text-left font-medium px-4 py-3">Campaign</th>
                <th className="text-right font-medium px-3 py-3">RAN</th>
                <th className="text-right font-medium px-3 py-3">SPAN</th>
                <th className="text-right font-medium px-3 py-3">LEAD</th>
                <th className="text-right font-medium px-3 py-3">CTR</th>
                <th className="text-right font-medium px-3 py-3">CPC</th>
                <th className="text-right font-medium px-3 py-3">CBR</th>
                <th className="text-right font-medium px-3 py-3">Appts</th>
                <th className="text-right font-medium px-3 py-3">CP Appt</th>
                <th className="text-right font-medium px-3 py-3">L2A %</th>
                <th className="text-left font-medium px-3 py-3">Bottleneck</th>
                <th className="text-left font-medium px-3 py-3">Action</th>
                <th className="text-right font-medium px-4 py-3">Overall</th>
              </tr>
            </thead>
            <tbody>
              <tr style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
                {/* Campaign */}
                <td className="px-4 py-3 font-semibold whitespace-nowrap" style={{ color: "#e2e8f0" }}>
                  B2B
                </td>
                {/* RAN — Reach */}
                <td className="text-right px-3 py-3" style={{ color: "#e2e8f0" }}>
                  {data.reach > 0 ? fmtN(data.reach) : dash}
                </td>
                {/* SPAN — Ad Spend */}
                <td className="text-right px-3 py-3" style={{ color: "#e2e8f0" }}>
                  {data.ad_spend > 0 ? fmt$(data.ad_spend) : dash}
                </td>
                {/* LEAD */}
                <td className="text-right px-3 py-3" style={{ color: "#e2e8f0" }}>
                  {data.leads > 0 ? fmtN(data.leads) : dash}
                </td>
                {/* CTR */}
                <td className="text-right px-3 py-3" style={{ color: "#e2e8f0" }}>
                  {data.ctr != null ? fmtPct(data.ctr) : dash}
                </td>
                {/* CPC */}
                <td className="text-right px-3 py-3" style={{ color: "#e2e8f0" }}>
                  {data.cpc != null ? `$${fmtDec(data.cpc)}` : dash}
                </td>
                {/* CBR — booking rate */}
                <td className="text-right px-3 py-3" style={{ color: "#e2e8f0" }}>
                  {data.leads > 0 ? fmtPct(cbr * 100) : dash}
                </td>
                {/* Appts */}
                <td className="text-right px-3 py-3" style={{ color: "#e2e8f0" }}>
                  {data.intros_booked > 0 ? fmtN(data.intros_booked) : dash}
                </td>
                {/* CP Appt */}
                <td className="text-right px-3 py-3" style={{ color: "#e2e8f0" }}>
                  {cpa > 0 ? fmt$(cpa) : dash}
                </td>
                {/* L2A % */}
                <td className="text-right px-3 py-3" style={{ color: "#e2e8f0" }}>
                  {data.leads > 0 ? fmtPct(l2a * 100) : dash}
                </td>
                {/* Bottleneck */}
                <td className="px-3 py-3">
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap"
                    style={{ color: bnStyle.color, background: bnStyle.bg }}>
                    {bottleneck}
                  </span>
                </td>
                {/* Action */}
                <td className="px-3 py-3 text-xs max-w-[200px]" style={{ color: "#475569" }}>
                  {action}
                </td>
                {/* Overall status */}
                <td className="text-right px-4 py-3">
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap"
                    style={{ color: stStyle.color, background: stStyle.bg }}>
                    {stStyle.label}
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

    </div>
  );
}
