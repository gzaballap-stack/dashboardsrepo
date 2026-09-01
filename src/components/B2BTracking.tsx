"use client";

import { useEffect, useRef, useState } from "react";
import CampaignDetailDrawer, { type DrawerEntity } from "./CampaignDetailDrawer";

interface CampaignRow {
  campaign_id: string;
  campaign_name: string | null;
  spend: number;
  impressions: number;
  reach: number;
  link_clicks: number;
  ctr: number | null;
  cpc: number | null;
  cpm: number | null;
}

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
  campaigns: CampaignRow[];
}

interface Props {
  startDate: string;
  endDate: string;
}

const BOTTLENECK_STYLE: Record<string, { color: string; bg: string }> = {
  Healthy:       { color: "#000000", bg: "rgba(0,0,0,0.06)"  },
  Creative:      { color: "#6b6b6b", bg: "rgba(244,114,182,0.1)" },
  Targeting:     { color: "#000000", bg: "rgba(0,0,0,0.06)"  },
  Funnel:        { color: "#4a4a4a", bg: "rgba(251,146,60,0.1)"  },
  "Post-Funnel": { color: "#a78bfa", bg: "rgba(167,139,250,0.1)" },
  "No Data":     { color: "#6b6b6b", bg: "rgba(100,116,139,0.1)" },
};

const STATUS_STYLE: Record<string, { label: string; color: string; bg: string }> = {
  excellent:    { label: "Excellent",    color: "#000000", bg: "rgba(0,0,0,0.072)"  },
  on_target:    { label: "On Target",    color: "#38bdf8", bg: "rgba(56,189,248,0.12)"  },
  above_target: { label: "Above Target", color: "#000000", bg: "rgba(0,0,0,0.072)"  },
  critical:     { label: "Critical",     color: "#c0392b", bg: "rgba(192,57,43,0.12)" },
  no_data:      { label: "No Data",      color: "#6b6b6b", bg: "rgba(100,116,139,0.12)" },
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
      className="relative overflow-hidden rounded-2xl p-5 flex flex-col gap-2 transition-all duration-200 hover:translate-y-[-1px]"
      style={{ background: "linear-gradient(135deg, #ffffff 0%, #f7f7f7 100%)", border: "1px solid rgba(0,0,0,0.07)", boxShadow: "0 1px 2px rgba(0,0,0,0.03), 0 10px 28px -12px rgba(0,0,0,0.10)" }}
    >
      <div className="absolute top-0 left-0 w-1 h-full rounded-l-xl"
        style={{ background: accent ? "#000000" : "#000000" }} />
      <span className="text-xs font-medium tracking-wide pl-3" style={{ color: "#6b6b6b" }}>{label}</span>
      <span className="text-3xl font-bold pl-3" style={{ color: "#000000" }}>{value}</span>
    </div>
  );
}

export default function B2BTracking({ startDate, endDate }: Props) {
  const [data, setData] = useState<B2BMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drawerEntity, setDrawerEntity] = useState<DrawerEntity | null>(null);

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
        <div className="flex items-center gap-3" style={{ color: "#949494" }}>
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
      <div className="rounded-2xl p-4 text-sm" style={{ background: "rgba(192,57,43,0.08)", border: "1px solid rgba(192,57,43,0.2)", color: "#d98b82" }}>
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
  const dash = <span style={{ color: "#949494" }}>—</span>;

  return (
    <>
    <div className="space-y-8 max-w-7xl">

      {/* ── Row 1: Pipeline ── */}
      <section>
        <h2 className="text-xs font-bold uppercase tracking-widest mb-4" style={{ color: "#949494" }}>Pipeline</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <KpiCard label="Ad Spend"           value={data.ad_spend > 0 ? fmt$(data.ad_spend) : "—"} />
          <KpiCard label="Booked Intros"      value={fmtN(data.intros_booked)} />
          <KpiCard label="Intro Show Rate"    value={data.intros_booked > 0 ? fmtPct((data.intros_shown / data.intros_booked) * 100) : "—"} accent />
          <KpiCard label="Booked Demos"       value={fmtN(data.sales_calls_booked)} />
          <KpiCard label="Demos"              value={fmtN(data.sales_calls_shown)} accent />
          <KpiCard label="Demo Show Rate"     value={data.sales_calls_booked > 0 ? fmtPct((data.sales_calls_shown / data.sales_calls_booked) * 100) : "—"} accent />
        </div>
      </section>

      {/* ── Row 2: Results ── */}
      <section>
        <h2 className="text-xs font-bold uppercase tracking-widest mb-4" style={{ color: "#949494" }}>Results</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <KpiCard label="Closes"               value={fmtN(data.closes)} accent />
          <KpiCard label="Closing Rate"         value={data.sales_calls_shown > 0 ? fmtPct((data.closes / data.sales_calls_shown) * 100) : "—"} accent />
          <KpiCard label="Cost per Intro"       value={data.intros_booked > 0 ? fmt$(data.ad_spend / data.intros_booked) : "—"} />
          <KpiCard label="Cost per Demo"        value={data.sales_calls_shown > 0 ? fmt$(data.ad_spend / data.sales_calls_shown) : "—"} />
          <KpiCard label="Cost per Acquisition" value={data.closes > 0 ? fmt$(data.ad_spend / data.closes) : "—"} />
          <KpiCard label="Cash Collected"       value={data.cash_collected > 0 ? fmt$(data.cash_collected) : "—"} accent />
        </div>
      </section>

      {/* ── Campaign Overview-style table row ── */}
      <section>
        <h2 className="text-xs font-bold uppercase tracking-widest mb-4" style={{ color: "#949494" }}>B2B Campaign — Overview</h2>
        <div className="rounded-2xl overflow-x-auto" style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.07)", boxShadow: "0 1px 2px rgba(0,0,0,0.03), 0 10px 28px -12px rgba(0,0,0,0.10)" }}>
          <table className="w-full text-sm" style={{ minWidth: 1100 }}>
            <thead>
              <tr style={{ background: "#f7f7f7", color: "#6b6b6b" }}>
                <th className="text-left font-medium px-4 py-3">Campaign</th>
                <th className="text-right font-medium px-3 py-3">Spend</th>
                <th className="text-right font-medium px-3 py-3">Schedules</th>
                <th className="text-right font-medium px-3 py-3">CPL</th>
                <th className="text-right font-medium px-3 py-3">CTR</th>
                <th className="text-right font-medium px-3 py-3">CPC</th>
                <th className="text-right font-medium px-3 py-3">CVR</th>
                <th className="text-right font-medium px-3 py-3">Demos</th>
                <th className="text-right font-medium px-3 py-3">CP Demo</th>
                <th className="text-right font-medium px-3 py-3">L2D %</th>
                <th className="text-left font-medium px-3 py-3">Bottleneck</th>
                <th className="text-left font-medium px-3 py-3">Action</th>
                <th className="text-right font-medium px-4 py-3">Overall</th>
              </tr>
            </thead>
            <tbody>
              {(data.campaigns.length > 0 ? data.campaigns : [null]).map((camp, i) => {
                const singleCamp = data.campaigns.length === 1 || camp === null;
                const campSpend = camp ? camp.spend : data.ad_spend;
                const campCtr   = camp ? camp.ctr   : data.ctr;
                const campCpc   = camp ? camp.cpc   : data.cpc;
                const campId    = camp?.campaign_id ?? 'total';
                const campName  = camp?.campaign_name
                  || (camp?.campaign_id ? `Campaign …${camp.campaign_id.slice(-8)}` : "B2B Account Total");
                const isSelected = drawerEntity?.kind === "b2b" && drawerEntity.id === campId;
                return (
                  <>
                  <tr key={campId}
                    onClick={() => {
                      if (isSelected) { setDrawerEntity(null); return; }
                      setDrawerEntity({ kind: "b2b", name: campName, id: campId, data, startDate, endDate });
                    }}
                    className="cursor-pointer transition-colors"
                    style={{
                      borderTop: i === 0 ? "1px solid rgba(0,0,0,0.068)" : "1px solid rgba(0,0,0,0.041)",
                      background: isSelected ? "rgba(0,0,0,0.048)" : "",
                    }}
                    onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = "rgba(0,0,0,0.027)"; }}
                    onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = ""; }}>
                    {/* Campaign */}
                    <td className="px-4 py-3 font-semibold whitespace-nowrap">
                      <div className="flex items-center gap-2">
                        <svg className="w-3 h-3 flex-none transition-transform" style={{ color: "#767676", transform: isSelected ? "rotate(90deg)" : "none" }} fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                        </svg>
                        <span style={{ color: "#93c5fd" }}>{campName}</span>
                      </div>
                    </td>
                    {/* Spend */}
                    <td className="text-right px-3 py-3" style={{ color: "#111111" }}>
                      {campSpend > 0 ? fmt$(campSpend) : dash}
                    </td>
                    {/* Schedules — account total (per-campaign pending attribution) */}
                    <td className="text-right px-3 py-3" style={{ color: "#111111" }}>
                      {singleCamp && data.intros_booked > 0 ? fmtN(data.intros_booked) : singleCamp ? dash : dash}
                    </td>
                    {/* CPL */}
                    <td className="text-right px-3 py-3" style={{ color: "#111111" }}>
                      {singleCamp && data.cost_per_lead > 0 ? fmt$(data.cost_per_lead) : singleCamp ? dash : campSpend > 0 && data.leads > 0 ? fmt$(campSpend / data.leads * data.campaigns.length) : dash}
                    </td>
                    {/* CTR */}
                    <td className="text-right px-3 py-3" style={{ color: "#111111" }}>
                      {campCtr != null ? fmtPct(campCtr) : dash}
                    </td>
                    {/* CPC */}
                    <td className="text-right px-3 py-3" style={{ color: "#111111" }}>
                      {campCpc != null ? `$${fmtDec(campCpc)}` : dash}
                    </td>
                    {/* CVR */}
                    <td className="text-right px-3 py-3" style={{ color: "#111111" }}>
                      {singleCamp && data.leads > 0 ? fmtPct(cbr * 100) : dash}
                    </td>
                    {/* Demos */}
                    <td className="text-right px-3 py-3" style={{ color: "#111111" }}>
                      {singleCamp && data.intros_shown > 0 ? fmtN(data.intros_shown) : dash}
                    </td>
                    {/* CP Demo */}
                    <td className="text-right px-3 py-3" style={{ color: "#111111" }}>
                      {singleCamp && data.intros_shown > 0 ? fmt$(data.ad_spend / data.intros_shown) : dash}
                    </td>
                    {/* L2D % */}
                    <td className="text-right px-3 py-3" style={{ color: "#111111" }}>
                      {singleCamp && data.leads > 0 ? fmtPct((data.intros_shown / data.leads) * 100) : dash}
                    </td>
                    {/* Bottleneck */}
                    <td className="px-3 py-3">
                      {singleCamp ? (
                        <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap"
                          style={{ color: bnStyle.color, background: bnStyle.bg }}>
                          {bottleneck}
                        </span>
                      ) : dash}
                    </td>
                    {/* Action */}
                    <td className="px-3 py-3 text-xs max-w-[200px]" style={{ color: "#767676" }}>
                      {singleCamp ? action : ""}
                    </td>
                    {/* Overall */}
                    <td className="text-right px-4 py-3">
                      {singleCamp ? (
                        <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap"
                          style={{ color: stStyle.color, background: stStyle.bg }}>
                          {stStyle.label}
                        </span>
                      ) : dash}
                    </td>
                  </tr>
                  {isSelected && drawerEntity && (
                    <tr key={campId + "_detail"}>
                      <td colSpan={13} style={{ padding: 0 }}>
                        <CampaignDetailDrawer entity={drawerEntity} onClose={() => setDrawerEntity(null)} />
                      </td>
                    </tr>
                  )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

    </div>

    </>
  );
}
