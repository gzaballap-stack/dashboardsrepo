"use client";

import { useEffect, useRef, useState } from "react";
import CampaignDetailDrawer, { type DrawerEntity } from "./CampaignDetailDrawer";

type CampaignRollup = {
  campaign_id: string;
  campaign_name: string;
  platform: string;
  status: string | null;
  objective: string | null;
  budget: number | null;
  spend: number;
  impressions: number;
  reach: number;
  frequency: number;
  link_clicks: number;
  unique_clicks: number;
  unique_ctr: number;
  ctr: number;
  cpc: number;
  cpm: number;
  leads: number;
  cvr: number;
  cost_per_result: number;
  excluded: boolean;
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
  excellent:     { label: "Excellent",     color: "#15803d", bg: "rgba(21,128,61,0.10)"  },
  on_target:     { label: "On Target",     color: "#0369a1", bg: "rgba(3,105,161,0.10)"  },
  above_target:  { label: "Above Target",  color: "#b45309", bg: "rgba(180,83,9,0.10)"   },
  critical:      { label: "Critical",      color: "#b91c1c", bg: "rgba(185,28,28,0.10)"  },
  hold:          { label: "Hold",          color: "#6d28d9", bg: "rgba(109,40,217,0.10)" },
  no_data:       { label: "No Data",       color: "#6b6b6b", bg: "rgba(0,0,0,0.06)"      },
};

const RANK_STYLE: Record<ClientRollup["rank"], { color: string; bg: string }> = {
  Whale:   { color: "#b45309", bg: "rgba(180,83,9,0.10)"   },
  Shark:   { color: "#0369a1", bg: "rgba(3,105,161,0.10)"  },
  Dolphin: { color: "#0e7490", bg: "rgba(14,116,144,0.10)" },
  Shrimp:  { color: "#6b6b6b", bg: "rgba(0,0,0,0.06)"      },
};

const BOTTLENECK_STYLE: Record<string, { color: string; bg: string }> = {
  Healthy:      { color: "#000000", bg: "rgba(0,0,0,0.06)" },
  Creative:     { color: "#6b6b6b", bg: "rgba(244,114,182,0.1)" },
  Funnel:       { color: "#4a4a4a", bg: "rgba(251,146,60,0.1)" },
  Targeting:    { color: "#000000", bg: "rgba(0,0,0,0.06)" },
  "Post-Funnel":{ color: "#a78bfa", bg: "rgba(167,139,250,0.1)" },
  Hold:         { color: "#4a4a4a", bg: "rgba(0,0,0,0.06)" },
  "No Data":    { color: "#6b6b6b", bg: "rgba(100,116,139,0.1)" },
};


/* ── Phone card ────────────────────────────────────────────────────────────
   One client per card, tappable to open the same detail drawer the table row
   opens. Rendered only below the md breakpoint; desktop never sees it. */
function Stat({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-semibold uppercase tracking-wider truncate" style={{ color: "#949494" }}>{label}</div>
      <div className="text-sm tabular-nums truncate" style={{ color: strong ? "#111111" : "#4a4a4a", fontWeight: strong ? 600 : 400 }}>{value}</div>
    </div>
  );
}

function MobileClientCard({ row, isOpen, onToggle, children }: {
  row: ClientRollup;
  isOpen: boolean;
  onToggle: () => void;
  children?: React.ReactNode;
}) {
  const st = STATUS_STYLE[row.status];
  const rk = RANK_STYLE[row.rank];
  const bn = BOTTLENECK_STYLE[row.bottleneck] ?? { color: "#4a4a4a", bg: "rgba(0,0,0,0.06)" };
  return (
    <div className="rounded-2xl overflow-hidden" style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.07)", boxShadow: "0 1px 2px rgba(0,0,0,0.03), 0 10px 28px -12px rgba(0,0,0,0.10)" }}>
      <button onClick={onToggle} className="w-full text-left px-4 py-3">
        <div className="flex items-start gap-2">
          <svg className="w-3 h-3 mt-1 flex-shrink-0 transition-transform" style={{ color: "#767676", transform: isOpen ? "rotate(90deg)" : "none" }}
            fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
          </svg>
          <span className="font-semibold text-sm flex-1 min-w-0 break-words" style={{ color: "#111111" }}>{row.client_name}</span>
          <span className="px-2 py-0.5 rounded-full text-[11px] font-semibold flex-shrink-0" style={{ color: st.color, background: st.bg }}>
            {st.label}
          </span>
        </div>

        <div className="flex items-center gap-1.5 mt-2 flex-wrap">
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase" style={{ color: rk.color, background: rk.bg }}>{row.rank}</span>
          <span className="px-2 py-0.5 rounded-md text-[11px] font-semibold" style={{ color: bn.color, background: bn.bg }}>{row.bottleneck}</span>
        </div>

        <div className="grid grid-cols-3 gap-x-3 gap-y-2.5 mt-3">
          <Stat label="Spend"   value={fmt$(row.spend)} strong />
          <Stat label="Leads"   value={fmtInt(row.leads)} strong />
          <Stat label="CPL"     value={row.cpl > 0 ? fmt$(row.cpl) : "—"} />
          <Stat label="Appts"   value={fmtInt(row.appts)} strong />
          <Stat label="CP Appt" value={row.cp_appt > 0 ? fmt$(row.cp_appt) : "—"} />
          <Stat label="L2A"     value={row.l2a_pct > 0 ? fmtPct(row.l2a_pct) : "—"} />
        </div>

        {row.action && (
          <p className="text-xs mt-3 leading-snug" style={{ color: "#6b6b6b" }}>{row.action}</p>
        )}
      </button>
      {children}
    </div>
  );
}

function fmt$(n: number) {
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}
function fmtInt(n: number) {
  return n.toLocaleString();
}
function fmtPct(n: number) {
  return `${n.toFixed(1)}%`;
}

type DatePreset = "this_week" | "last_7" | "this_month" | "last_30" | "all_time" | "custom";

const DATE_PRESET_LABELS: Record<DatePreset, string> = {
  this_week: "This Week", last_7: "Last 7 Days", this_month: "This Month",
  last_30: "Last 30 Days", all_time: "All Time", custom: "Custom Range",
};

function toISODate(d: Date) {
  return d.toISOString().split("T")[0];
}

function resolvePreset(preset: DatePreset): { start: string; end: string } {
  const now = new Date();
  const today = toISODate(now);
  if (preset === "this_week") {
    const day = now.getDay();
    const monday = new Date(now);
    monday.setDate(now.getDate() - ((day + 6) % 7));
    return { start: toISODate(monday), end: today };
  }
  if (preset === "last_7")  return { start: toISODate(new Date(now.getTime() - 7 * 86400000)), end: today };
  if (preset === "this_month") return { start: toISODate(new Date(now.getFullYear(), now.getMonth(), 1)), end: today };
  if (preset === "last_30") return { start: toISODate(new Date(now.getTime() - 30 * 86400000)), end: today };
  return { start: "", end: "" }; // all_time
}

function relativeTime(d: Date | null): string {
  if (!d) return "never";
  const seconds = Math.floor((Date.now() - d.getTime()) / 1000);
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export default function CampaignOverview({ startDate, endDate }: {
  startDate: string;
  endDate: string;
}) {
  const [rows, setRows] = useState<ClientRollup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<ClientRollup["status"] | "all">("all");

  // Own date range, independent of the global dashboard preset — defaults to
  // whatever the parent nav is showing, but can be changed locally on this page.
  const [datePreset, setDatePreset] = useState<DatePreset>("custom");
  const [customStart, setCustomStart] = useState(startDate);
  const [customEnd, setCustomEnd] = useState(endDate);
  const [connected, setConnected] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [, forceTick] = useState(0);

  const { start: rangeStart, end: rangeEnd } = datePreset === "custom"
    ? { start: customStart, end: customEnd }
    : resolvePreset(datePreset);

  const loadData = () => {
    setLoading(true);
    setError("");
    const params = new URLSearchParams();
    if (rangeStart) params.set("start_date", rangeStart);
    if (rangeEnd) params.set("end_date", rangeEnd);
    fetch(`/api/campaign-overview?${params}`)
      .then(r => r.json())
      .then(d => {
        if (d.error) { setError(d.error); setRows([]); setConnected(false); }
        else { setRows(d.clients ?? []); setConnected(true); setLastUpdated(new Date()); }
      })
      .catch(() => { setError("Failed to load campaign data"); setConnected(false); })
      .finally(() => setLoading(false));
  };

  const loadDataRef = useRef(loadData);
  loadDataRef.current = loadData;

  useEffect(() => {
    loadDataRef.current();
  }, [rangeStart, rangeEnd]);

  // Re-render every 15s just to keep the "X minutes ago" label fresh
  useEffect(() => {
    const id = setInterval(() => forceTick(t => t + 1), 15000);
    return () => clearInterval(id);
  }, []);

  const [drawerEntity, setDrawerEntity] = useState<DrawerEntity | null>(null);

  const filtered = rows
    .filter(r => r.client_name.toLowerCase().includes(search.toLowerCase()))
    .filter(r => statusFilter === "all" || r.status === statusFilter);

  const statusCounts = rows.reduce((acc, r) => {
    acc[r.status] = (acc[r.status] ?? 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <>
    <div className="space-y-6 max-w-[1400px]">
      <div className="flex items-center justify-between flex-wrap gap-3 rounded-2xl px-4 py-3"
        style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.07)", boxShadow: "0 1px 2px rgba(0,0,0,0.03), 0 10px 28px -12px rgba(0,0,0,0.10)" }}>
        <div className="flex items-center gap-5 flex-wrap">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full" style={{ background: connected ? "#000000" : "#c0392b", boxShadow: connected ? "0 0 6px #000000" : "none" }} />
            <span className="text-xs font-semibold" style={{ color: connected ? "#000000" : "#c0392b" }}>
              {connected ? "Live Connection" : "Connection Error"}
            </span>
          </div>
          <div className="text-xs" style={{ color: "#6b6b6b" }}>
            Last updated <span style={{ color: "#4a4a4a" }}>{relativeTime(lastUpdated)}</span>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={datePreset}
            onChange={e => setDatePreset(e.target.value as DatePreset)}
            className="px-3 py-1.5 rounded-lg text-xs font-medium outline-none cursor-pointer"
            style={{ background: "#f7f7f7", border: "1px solid rgba(0,0,0,0.162)", color: "#111111" }}
          >
            {(Object.keys(DATE_PRESET_LABELS) as DatePreset[]).map(p => (
              <option key={p} value={p}>{DATE_PRESET_LABELS[p]}</option>
            ))}
          </select>
          {datePreset === "custom" && (
            <>
              <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)}
                className="px-2 py-1.5 rounded-lg text-xs outline-none"
                style={{ background: "#f7f7f7", border: "1px solid rgba(0,0,0,0.162)", color: "#111111" }} />
              <span className="text-xs" style={{ color: "#767676" }}>–</span>
              <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)}
                className="px-2 py-1.5 rounded-lg text-xs outline-none"
                style={{ background: "#f7f7f7", border: "1px solid rgba(0,0,0,0.162)", color: "#111111" }} />
            </>
          )}
          <button
            onClick={loadData}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-opacity"
            style={{ background: "rgba(0,0,0,0.09)", color: "#4a4a4a", border: "1px solid rgba(0,0,0,0.18)", opacity: loading ? 0.6 : 1 }}
          >
            <svg className={`w-3 h-3 ${loading ? "animate-spin" : ""}`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Refresh Data
          </button>
        </div>
      </div>

      <section>
        <div className="flex items-center gap-2 mb-4 overflow-x-auto md:flex-wrap md:overflow-visible -mx-4 px-4 md:mx-0 md:px-0">
          {(["all", "critical", "above_target", "on_target", "excellent", "hold", "no_data"] as const).map(s => {
            const active = statusFilter === s;
            const style = s === "all" ? { color: "#4a4a4a", bg: "rgba(0,0,0,0.06)" } : STATUS_STYLE[s];
            const count = s === "all" ? rows.length : (statusCounts[s] ?? 0);
            return (
              <button key={s} onClick={() => setStatusFilter(s)}
                className="px-2.5 py-1 rounded-full text-xs font-semibold transition-opacity whitespace-nowrap flex-shrink-0"
                style={{ color: style.color, background: style.bg, opacity: active ? 1 : 0.55, border: active ? `1px solid ${style.color}` : "1px solid transparent" }}>
                {s === "all" ? "All" : STATUS_STYLE[s].label} {count}
              </button>
            );
          })}
        </div>

        <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between mb-4">
          <h2 className="text-xs font-bold uppercase tracking-widest" style={{ color: "#949494" }}>Campaign Overview — All Clients</h2>
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Filter clients..."
            className="px-3 py-1.5 rounded-lg text-sm outline-none w-full md:w-56"
            style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.162)", color: "#111111" }}
          />
        </div>

        {error && (
          <div className="rounded-2xl p-4 text-sm" style={{ background: "rgba(192,57,43,0.08)", border: "1px solid rgba(192,57,43,0.2)", color: "#d98b82" }}>
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex items-center gap-2 py-10 justify-center" style={{ color: "#6b6b6b" }}>
            <span className="text-sm font-medium">Loading campaign data…</span>
          </div>
        ) : filtered.length === 0 && !error ? (
          <div className="rounded-2xl p-8 text-center text-sm" style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.07)", boxShadow: "0 1px 2px rgba(0,0,0,0.03), 0 10px 28px -12px rgba(0,0,0,0.10)", color: "#6b6b6b" }}>
            No campaign data yet for this range. This page reads from the <code>ad_campaigns</code> table, populated by a
            Make.com sync pulling from each platform's ads reporting — see <code>ccm-ad-campaigns.blueprint.json</code>.
          </div>
        ) : (
          <>
          {/* A 15-column table cannot be read on a phone, so below the
              breakpoint the same rows render as cards. The table itself is
              untouched and still what desktop gets. */}
          <div className="md:hidden space-y-3">
            {filtered.map(r => {
              const isOpen = drawerEntity?.kind === "client" && drawerEntity.client.client_id === r.client_id;
              return (
                <MobileClientCard
                  key={r.client_id}
                  row={r}
                  isOpen={isOpen}
                  onToggle={() => setDrawerEntity(isOpen ? null : { kind: "client", client: r, startDate: rangeStart, endDate: rangeEnd })}
                >
                  {isOpen && drawerEntity && (
                    <CampaignDetailDrawer entity={drawerEntity} onClose={() => setDrawerEntity(null)} onExclusionsChange={() => loadDataRef.current()} />
                  )}
                </MobileClientCard>
              );
            })}
          </div>

          <div className="hidden md:block rounded-2xl overflow-x-auto" style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.07)", boxShadow: "0 1px 2px rgba(0,0,0,0.03), 0 10px 28px -12px rgba(0,0,0,0.10)" }}>
            <table className="w-full text-sm" style={{ minWidth: 1500 }}>
              <thead>
                <tr style={{ background: "#f7f7f7", color: "#6b6b6b" }}>
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
                  const bn = BOTTLENECK_STYLE[r.bottleneck] ?? { color: "#4a4a4a", bg: "rgba(0,0,0,0.06)" };
                  const isOpen = drawerEntity?.kind === "client" && drawerEntity.client.client_id === r.client_id;
                  return (
                    <>
                      <tr key={r.client_id}
                        onClick={() => {
                          if (isOpen) { setDrawerEntity(null); return; }
                          setDrawerEntity({ kind: "client", client: r, startDate: rangeStart, endDate: rangeEnd });
                        }}
                        className="cursor-pointer transition-colors"
                        style={{ borderTop: "1px solid rgba(0,0,0,0.068)", background: isOpen ? "rgba(0,0,0,0.048)" : "" }}>
                        <td className="px-4 py-3">
                          <svg className="w-3 h-3 transition-transform" style={{ color: "#767676", transform: isOpen ? "rotate(90deg)" : "none" }}
                            fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                          </svg>
                        </td>
                        <td className="px-2 py-3 font-semibold whitespace-nowrap">
                          <span style={{ color: "#93c5fd" }}>{r.client_name}</span>
                        </td>
                        <td className="text-center px-2 py-3">
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase" style={{ color: rk.color, background: rk.bg }}>
                            {r.rank}
                          </span>
                        </td>
                        <td className="text-right px-3 py-3" style={{ color: "#111111" }}>{fmt$(r.spend)}</td>
                        <td className="text-right px-3 py-3" style={{ color: "#111111" }}>{fmtInt(r.leads)}</td>
                        <td className="text-right px-3 py-3" style={{ color: "#4a4a4a" }}>{r.cpl > 0 ? fmt$(r.cpl) : "—"}</td>
                        <td className="text-right px-3 py-3" style={{ color: "#4a4a4a" }}>{fmtPct(r.ctr)}</td>
                        <td className="text-right px-3 py-3" style={{ color: "#4a4a4a" }}>{r.cpc > 0 ? fmt$(r.cpc) : "—"}</td>
                        <td className="text-right px-3 py-3" style={{ color: "#4a4a4a" }}>{r.cvr > 0 ? fmtPct(r.cvr) : "—"}</td>
                        <td className="text-right px-3 py-3" style={{ color: "#111111" }}>{fmtInt(r.appts)}</td>
                        <td className="text-right px-3 py-3" style={{ color: "#4a4a4a" }}>{r.cp_appt > 0 ? fmt$(r.cp_appt) : "—"}</td>
                        <td className="text-right px-3 py-3" style={{ color: "#4a4a4a" }}>{r.l2a_pct > 0 ? fmtPct(r.l2a_pct) : "—"}</td>
                        <td className="px-3 py-3">
                          <span className="px-2 py-1 rounded-md text-xs font-semibold whitespace-nowrap" style={{ color: bn.color, background: bn.bg }}>
                            {r.bottleneck}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-xs max-w-[220px]" style={{ color: "#6b6b6b" }}>{r.action}</td>
                        <td className="text-right px-4 py-3">
                          <span className="px-2 py-1 rounded-full text-xs font-semibold whitespace-nowrap" style={{ color: st.color, background: st.bg }}>
                            {st.label}
                          </span>
                        </td>
                      </tr>
                      {isOpen && drawerEntity && (
                        <tr key={r.client_id + "_detail"}>
                          <td colSpan={15} style={{ padding: 0 }}>
                            <CampaignDetailDrawer entity={drawerEntity} onClose={() => setDrawerEntity(null)} onExclusionsChange={() => loadDataRef.current()} />
                          </td>
                        </tr>
                      )}
                    </>
                  );
                })}
              </tbody>
            </table>
          </div>
          </>
        )}
      </section>
    </div>

    </>
  );
}
