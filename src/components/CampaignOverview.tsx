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
  leads: number;
  ctr: number;
  cpc: number;
  cpl: number;
};

type ClientRollup = {
  client_id: string;
  client_name: string;
  status: "no_data" | "excellent" | "on_target" | "above_target" | "critical";
  spend: number;
  impressions: number;
  reach: number;
  link_clicks: number;
  leads: number;
  ctr: number;
  cpc: number;
  cpl: number;
  campaigns: CampaignRollup[];
};

const STATUS_STYLE: Record<ClientRollup["status"], { label: string; color: string; bg: string }> = {
  excellent:     { label: "Excellent",     color: "#4ade80", bg: "rgba(74,222,128,0.12)" },
  on_target:     { label: "On Target",     color: "#38bdf8", bg: "rgba(56,189,248,0.12)" },
  above_target:  { label: "Above Target",  color: "#f59e0b", bg: "rgba(245,158,11,0.12)" },
  critical:      { label: "Critical",      color: "#f87171", bg: "rgba(248,113,113,0.12)" },
  no_data:       { label: "No Data",       color: "#64748b", bg: "rgba(100,116,139,0.12)" },
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
  return `${n.toFixed(2)}%`;
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

  const filtered = rows.filter(r => r.client_name.toLowerCase().includes(search.toLowerCase()));

  const totals = filtered.reduce((acc, r) => ({
    spend: acc.spend + r.spend,
    impressions: acc.impressions + r.impressions,
    reach: acc.reach + r.reach,
    link_clicks: acc.link_clicks + r.link_clicks,
    leads: acc.leads + r.leads,
  }), { spend: 0, impressions: 0, reach: 0, link_clicks: 0, leads: 0 });
  const portfolioCpl = totals.leads > 0 ? totals.spend / totals.leads : 0;
  const portfolioCtr = totals.impressions > 0 ? (totals.link_clicks / totals.impressions) * 100 : 0;

  return (
    <div className="space-y-6 max-w-7xl">
      <section>
        <h2 className="text-xs font-bold uppercase tracking-widest mb-4" style={{ color: "#334155" }}>Portfolio Totals</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatCard label="Total Spend" value={fmt$(totals.spend)} />
          <StatCard label="Total Leads" value={fmtInt(totals.leads)} />
          <StatCard label="Portfolio CPL" value={totals.leads > 0 ? fmt$(portfolioCpl) : "—"} />
          <StatCard label="Impressions" value={fmtInt(totals.impressions)} />
          <StatCard label="Link Clicks" value={fmtInt(totals.link_clicks)} />
          <StatCard label="CTR" value={fmtPct(portfolioCtr)} />
        </div>
      </section>

      <section>
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
          <div className="rounded-xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.07)" }}>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: "#0c1a30", color: "#64748b" }}>
                  <th className="text-left font-medium px-4 py-3 w-8"></th>
                  <th className="text-left font-medium px-2 py-3">Client</th>
                  <th className="text-right font-medium px-3 py-3">Spend</th>
                  <th className="text-right font-medium px-3 py-3">Impr.</th>
                  <th className="text-right font-medium px-3 py-3">Reach</th>
                  <th className="text-right font-medium px-3 py-3">Clicks</th>
                  <th className="text-right font-medium px-3 py-3">CTR</th>
                  <th className="text-right font-medium px-3 py-3">CPC</th>
                  <th className="text-right font-medium px-3 py-3">Leads</th>
                  <th className="text-right font-medium px-3 py-3">CPL</th>
                  <th className="text-right font-medium px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => {
                  const st = STATUS_STYLE[r.status];
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
                        <td className="px-2 py-3 font-semibold" style={{ color: "#e2e8f0" }}>{r.client_name}</td>
                        <td className="text-right px-3 py-3" style={{ color: "#e2e8f0" }}>{fmt$(r.spend)}</td>
                        <td className="text-right px-3 py-3" style={{ color: "#94a3b8" }}>{fmtInt(r.impressions)}</td>
                        <td className="text-right px-3 py-3" style={{ color: "#94a3b8" }}>{fmtInt(r.reach)}</td>
                        <td className="text-right px-3 py-3" style={{ color: "#94a3b8" }}>{fmtInt(r.link_clicks)}</td>
                        <td className="text-right px-3 py-3" style={{ color: "#94a3b8" }}>{fmtPct(r.ctr)}</td>
                        <td className="text-right px-3 py-3" style={{ color: "#94a3b8" }}>{r.cpc > 0 ? fmt$(r.cpc) : "—"}</td>
                        <td className="text-right px-3 py-3" style={{ color: "#e2e8f0" }}>{fmtInt(r.leads)}</td>
                        <td className="text-right px-3 py-3" style={{ color: "#e2e8f0" }}>{r.cpl > 0 ? fmt$(r.cpl) : "—"}</td>
                        <td className="text-right px-4 py-3">
                          <span className="px-2 py-1 rounded-full text-xs font-semibold" style={{ color: st.color, background: st.bg }}>
                            {st.label}
                          </span>
                        </td>
                      </tr>
                      {isOpen && r.campaigns.map(camp => (
                        <tr key={r.client_id + camp.campaign_id} style={{ background: "rgba(255,255,255,0.02)" }}>
                          <td className="px-4 py-2"></td>
                          <td className="px-2 py-2 pl-6" style={{ color: "#94a3b8" }}>
                            <span className="text-xs px-1.5 py-0.5 rounded mr-2" style={{ background: "rgba(59,130,246,0.15)", color: "#60a5fa" }}>
                              {PLATFORM_LABEL[camp.platform] ?? camp.platform}
                            </span>
                            {camp.campaign_name}
                          </td>
                          <td className="text-right px-3 py-2 text-xs" style={{ color: "#cbd5e1" }}>{fmt$(camp.spend)}</td>
                          <td className="text-right px-3 py-2 text-xs" style={{ color: "#64748b" }}>{fmtInt(camp.impressions)}</td>
                          <td className="text-right px-3 py-2 text-xs" style={{ color: "#64748b" }}>{fmtInt(camp.reach)}</td>
                          <td className="text-right px-3 py-2 text-xs" style={{ color: "#64748b" }}>{fmtInt(camp.link_clicks)}</td>
                          <td className="text-right px-3 py-2 text-xs" style={{ color: "#64748b" }}>{fmtPct(camp.ctr)}</td>
                          <td className="text-right px-3 py-2 text-xs" style={{ color: "#64748b" }}>{camp.cpc > 0 ? fmt$(camp.cpc) : "—"}</td>
                          <td className="text-right px-3 py-2 text-xs" style={{ color: "#cbd5e1" }}>{fmtInt(camp.leads)}</td>
                          <td className="text-right px-3 py-2 text-xs" style={{ color: "#cbd5e1" }}>{camp.cpl > 0 ? fmt$(camp.cpl) : "—"}</td>
                          <td className="text-right px-4 py-2 text-xs" style={{ color: "#475569" }}>{camp.status ?? "—"}</td>
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
