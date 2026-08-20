"use client";

import { useEffect, useState } from "react";

type CampaignRollup = {
  campaign_id: string;
  campaign_name: string;
  platform: string;
  status: string | null;
  budget: number | null;
  spend: number;
  impressions: number;
  reach: number;
  link_clicks: number;
  ctr: number;
  cpc: number;
};

type ClientRollup = {
  client_id: string;
  client_name: string;
  rank: "Whale" | "Shark" | "Dolphin" | "Shrimp";
  status: "no_data" | "hold" | "excellent" | "on_target" | "above_target" | "critical";
  bottleneck: string;
  action: string;
  spend: number;
  impressions: number;
  reach: number;
  link_clicks: number;
  ctr: number;
  cpc: number;
  leads: number;
  cpl: number;
  cvr: number;
  appts: number;
  cp_appt: number;
  l2a_pct: number;
  shows: number;
  no_shows: number;
  show_rate: number;
  closes: number;
  close_rate: number;
  campaigns: CampaignRollup[];
};

const STATUS_STYLE: Record<ClientRollup["status"], { label: string; color: string; bg: string }> = {
  excellent:     { label: "Excellent",     color: "#4ade80", bg: "rgba(74,222,128,0.12)" },
  on_target:     { label: "On Target",     color: "#38bdf8", bg: "rgba(56,189,248,0.12)" },
  above_target:  { label: "Above Target",  color: "#f59e0b", bg: "rgba(245,158,11,0.12)" },
  critical:      { label: "Critical",      color: "#f87171", bg: "rgba(248,113,113,0.12)" },
  hold:          { label: "Hold",          color: "#a78bfa", bg: "rgba(167,139,250,0.12)" },
  no_data:       { label: "No Data",       color: "#64748b", bg: "rgba(100,116,139,0.12)" },
};

const RANK_STYLE: Record<ClientRollup["rank"], { color: string; bg: string }> = {
  Whale:   { color: "#fbbf24", bg: "rgba(251,191,36,0.12)" },
  Shark:   { color: "#60a5fa", bg: "rgba(96,165,250,0.12)" },
  Dolphin: { color: "#22d3ee", bg: "rgba(34,211,238,0.12)" },
  Shrimp:  { color: "#94a3b8", bg: "rgba(148,163,184,0.12)" },
};

const BOTTLENECK_STYLE: Record<string, { color: string; bg: string }> = {
  Healthy:      { color: "#4ade80", bg: "rgba(74,222,128,0.1)" },
  Creative:     { color: "#f472b6", bg: "rgba(244,114,182,0.1)" },
  Funnel:       { color: "#fb923c", bg: "rgba(251,146,60,0.1)" },
  Targeting:    { color: "#f59e0b", bg: "rgba(245,158,11,0.1)" },
  "Post-Funnel":{ color: "#a78bfa", bg: "rgba(167,139,250,0.1)" },
  Hold:         { color: "#94a3b8", bg: "rgba(148,163,184,0.1)" },
  "No Data":    { color: "#64748b", bg: "rgba(100,116,139,0.1)" },
};

const PLATFORM_LABEL: Record<string, string> = {
  meta: "Meta", google: "Google", local_services: "LSA",
};

function fmt$(n: number) {
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}
function fmtInt(n: number) {
  return n.toLocaleString();
}
function fmtPct(n: number) {
  return `${n.toFixed(1)}%`;
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl p-4 flex flex-col gap-1"
      style={{ background: "linear-gradient(135deg, #0f2040 0%, #0c1a30 100%)", border: "1px solid rgba(255,255,255,0.07)" }}>
      <span className="text-xs font-medium tracking-wide" style={{ color: "#64748b" }}>{label}</span>
      <span className="text-2xl font-bold" style={{ color: "#f1f5f9" }}>{value}</span>
    </div>
  );
}

export default function CampaignOverview({ startDate, endDate }: {
  startDate: string;
  endDate: string;
}) {
  const [rows, setRows] = useState<ClientRollup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<ClientRollup["status"] | "all">("all");

  useEffect(() => {
    setLoading(true);
    setError("");
    const params = new URLSearchParams();
    if (startDate) params.set("start_date", startDate);
    if (endDate) params.set("end_date", endDate);
    fetch(`/api/campaign-overview?${params}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) { setError(d.error); setRows([]); }
        else setRows(d.clients ?? []);
      })
      .catch(() => setError("Failed to load campaign data"))
      .finally(() => setLoading(false));
  }, [startDate, endDate]);

  const toggleExpanded = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const filtered = rows
    .filter(r => r.client_name.toLowerCase().includes(search.toLowerCase()))
    .filter(r => statusFilter === "all" || r.status === statusFilter);

  const statusCounts = rows.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const totals = filtered.reduce((acc, r) => ({
    spend: acc.spend + r.spend,
    impressions: acc.impressions + r.impressions,
    link_clicks: acc.link_clicks + r.link_clicks,
    leads: acc.leads + r.leads,
    appts: acc.appts + r.appts,
    closes: acc.closes + r.closes,
  }), { spend: 0, impressions: 0, link_clicks: 0, leads: 0, appts: 0, closes: 0 });
  const portfolioCpl = totals.leads > 0 ? totals.spend / totals.leads : 0;
  const portfolioCtr = totals.impressions > 0 ? (totals.link_clicks / totals.impressions) * 100 : 0;
  const portfolioL2a = totals.leads > 0 ? (totals.appts / totals.leads) * 100 : 0;

  return (
    <div className="space-y-6 max-w-[1400px]">
      <section>
        <h2 className="text-xs font-bold uppercase tracking-widest mb-4" style={{ color: "#334155" }}>Portfolio Totals</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatCard label="Total Spend" value={fmt$(totals.spend)} />
          <StatCard label="Total Leads" value={fmtInt(totals.leads)} />
          <StatCard label="Portfolio CPL" value={totals.leads > 0 ? fmt$(portfolioCpl) : "—"} />
          <StatCard label="Booked Appts" value={fmtInt(totals.appts)} />
          <StatCard label="L2A %" value={totals.leads > 0 ? fmtPct(portfolioL2a) : "—"} />
          <StatCard label="CTR" value={fmtPct(portfolioCtr)} />
        </div>
      </section>

      <section>
        <div className="flex items-center gap-2 mb-4 flex-wrap">
          {(["all", "critical", "above_target", "on_target", "excellent", "hold", "no_data"] as const).map(s => {
            const active = statusFilter === s;
            const style = s === "all" ? { color: "#94a3b8", bg: "rgba(148,163,184,0.1)" } : STATUS_STYLE[s];
            const count = s === "all" ? rows.length : (statusCounts[s] ?? 0);
            return (
              <button key={s} onClick={() => setStatusFilter(s)}
                className="px-2.5 py-1 rounded-full text-xs font-semibold transition-opacity"
                style={{ color: style.color, background: style.bg, opacity: active ? 1 : 0.55, border: active ? `1px solid ${style.color}` : "1px solid transparent" }}>
                {s === "all" ? "All" : STATUS_STYLE[s].label} {count}
              </button>
            );
          })}
        </div>

        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xs font-bold uppercase tracking-widest" style={{ color: "#334155" }}>Campaign Overview — All Clients</h2>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Filter clients..."
            className="px-3 py-1.5 rounded-lg text-sm outline-none w-56"
            style={{ background: "#0f2040", border: "1px solid rgba(255,255,255,0.12)", color: "#e2e8f0" }}
          />
        </div>

        {error && (
          <div className="rounded-xl p-4 text-sm" style={{ background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.2)", color: "#fca5a5" }}>
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex items-center gap-2 py-10 justify-center" style={{ color: "#64748b" }}>
            <span className="text-sm font-medium">Loading campaign data…</span>
          </div>
        ) : filtered.length === 0 && !error ? (
          <div className="rounded-xl p-8 text-center text-sm" style={{ background: "#0f2040", border: "1px solid rgba(255,255,255,0.07)", color: "#64748b" }}>
            No campaign data yet for this range. This page reads from the <code>ad_campaigns</code> table, populated by a
            Make.com sync pulling from each platform's ads reporting — see <code>ccm-ad-campaigns.blueprint.json</code>.
          </div>
        ) : (
          <div className="rounded-xl overflow-x-auto" style={{ border: "1px solid rgba(255,255,255,0.07)" }}>
            <table className="w-full text-sm" style={{ minWidth: 1500 }}>
              <thead>
                <tr style={{ background: "#0c1a30", color: "#64748b" }}>
                  <th className="text-left font-medium px-4 py-3 w-8"></th>
                  <th className="text-left font-medium px-2 py-3">Client</th>
                  <th className="text-center font-medium px-2 py-3">Rank</th>
                  <th className="text-right font-medium px-3 py-3">Spend</th>
                  <th className="text-right font-medium px-3 py-3">Leads</th>
                  <th className="text-right font-medium px-3 py-3">CPL</th>
                  <th className="text-right font-medium px-3 py-3">CTR</th>
                  <th className="text-right font-medium px-3 py-3">CPC</th>
                  <th className="text-right font-medium px-3 py-3">CVR</th>
                  <th className="text-right font-medium px-3 py-3">Appts</th>
                  <th className="text-right font-medium px-3 py-3">CP Appt</th>
                  <th className="text-right font-medium px-3 py-3">L2A %</th>
                  <th className="text-left font-medium px-3 py-3">Bottleneck</th>
                  <th className="text-left font-medium px-3 py-3">Action</th>
                  <th className="text-right font-medium px-4 py-3">Overall</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => {
                  const st = STATUS_STYLE[r.status];
                  const rk = RANK_STYLE[r.rank];
                  const bn = BOTTLENECK_STYLE[r.bottleneck] ?? { color: "#94a3b8", bg: "rgba(148,163,184,0.1)" };
                  const isOpen = expanded.has(r.client_id);
                  return (
                    <>
                      <tr key={r.client_id}
                        onClick={() => toggleExpanded(r.client_id)}
                        className="cursor-pointer transition-colors"
                        style={{ borderTop: "1px solid rgba(255,255,255,0.05)" }}>
                        <td className="px-4 py-3">
                          <svg className="w-3 h-3 transition-transform" style={{ color: "#475569", transform: isOpen ? "rotate(90deg)" : "none" }}
                            fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                          </svg>
                        </td>
                        <td className="px-2 py-3 font-semibold whitespace-nowrap" style={{ color: "#e2e8f0" }}>{r.client_name}</td>
                        <td className="text-center px-2 py-3">
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase" style={{ color: rk.color, background: rk.bg }}>
                            {r.rank}
                          </span>
                        </td>
                        <td className="text-right px-3 py-3" style={{ color: "#e2e8f0" }}>{fmt$(r.spend)}</td>
                        <td className="text-right px-3 py-3" style={{ color: "#e2e8f0" }}>{fmtInt(r.leads)}</td>
                        <td className="text-right px-3 py-3" style={{ color: "#94a3b8" }}>{r.cpl > 0 ? fmt$(r.cpl) : "—"}</td>
                        <td className="text-right px-3 py-3" style={{ color: "#94a3b8" }}>{fmtPct(r.ctr)}</td>
                        <td className="text-right px-3 py-3" style={{ color: "#94a3b8" }}>{r.cpc > 0 ? fmt$(r.cpc) : "—"}</td>
                        <td className="text-right px-3 py-3" style={{ color: "#94a3b8" }}>{r.cvr > 0 ? fmtPct(r.cvr) : "—"}</td>
                        <td className="text-right px-3 py-3" style={{ color: "#e2e8f0" }}>{fmtInt(r.appts)}</td>
                        <td className="text-right px-3 py-3" style={{ color: "#94a3b8" }}>{r.cp_appt > 0 ? fmt$(r.cp_appt) : "—"}</td>
                        <td className="text-right px-3 py-3" style={{ color: "#94a3b8" }}>{r.l2a_pct > 0 ? fmtPct(r.l2a_pct) : "—"}</td>
                        <td className="px-3 py-3">
                          <span className="px-2 py-1 rounded-md text-xs font-semibold whitespace-nowrap" style={{ color: bn.color, background: bn.bg }}>
                            {r.bottleneck}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-xs max-w-[220px]" style={{ color: "#64748b" }}>{r.action}</td>
                        <td className="text-right px-4 py-3">
                          <span className="px-2 py-1 rounded-full text-xs font-semibold whitespace-nowrap" style={{ color: st.color, background: st.bg }}>
                            {st.label}
                          </span>
                        </td>
                      </tr>
                      {isOpen && r.campaigns.map(camp => (
                        <tr key={r.client_id + camp.campaign_id} style={{ background: "rgba(255,255,255,0.02)" }}>
                          <td className="px-4 py-2"></td>
                          <td className="px-2 py-2 pl-6 whitespace-nowrap" style={{ color: "#94a3b8" }} colSpan={2}>
                            <span className="text-xs px-1.5 py-0.5 rounded mr-2" style={{ background: "rgba(59,130,246,0.15)", color: "#60a5fa" }}>
                              {PLATFORM_LABEL[camp.platform] ?? camp.platform}
                            </span>
                            {camp.campaign_name}
                          </td>
                          <td className="text-right px-3 py-2 text-xs" style={{ color: "#cbd5e1" }}>{fmt$(camp.spend)}</td>
                          <td className="text-right px-3 py-2 text-xs" colSpan={2} style={{ color: "#475569" }}>—</td>
                          <td className="text-right px-3 py-2 text-xs" style={{ color: "#64748b" }}>{fmtPct(camp.ctr)}</td>
                          <td className="text-right px-3 py-2 text-xs" style={{ color: "#64748b" }}>{camp.cpc > 0 ? fmt$(camp.cpc) : "—"}</td>
                          <td className="text-right px-3 py-2 text-xs" colSpan={4} style={{ color: "#475569" }}>—</td>
                          <td className="px-3 py-2 text-xs" style={{ color: "#475569" }}>{camp.status ?? "—"}</td>
                          <td className="text-right px-4 py-2 text-xs" style={{ color: "#94a3b8" }}>{fmtInt(camp.impressions)} impr</td>
                        </tr>
                      ))}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
