"use client";

import { useCallback, useEffect, useState } from "react";

type Row = {
  name: string;
  pooled_names: string[];
  level: string;
  clients: number;
  variants: number;
  spend: number;
  impressions: number;
  link_clicks: number;
  leads: number;
  appts: number;
  shows: number;
  no_shows: number;
  closes: number;
  revenue: number;
  cost_per_lead: number;
  cost_per_appt: number;
  cost_per_close: number;
  lead_to_appt: number;
  show_rate: number;
  roas: number;
};

type Health = {
  overall: { total: number; attributed: number; coverage: number };
  clients: Array<{ client_name: string; coverage: number; total: number; regressed: boolean; low: boolean }>;
  alerts: { regressed: string[]; low: string[] };
};

type Level = "ad" | "adset" | "campaign";
type Model = "first" | "last";

const MODELS: { id: Model; label: string; hint: string }[] = [
  { id: "first", label: "First Touch", hint: "Credits the ad that created the lead" },
  { id: "last",  label: "Last Touch",  hint: "Credits the ad they saw most recently before converting" },
];

const LEVELS: { id: Level; label: string }[] = [
  { id: "ad",       label: "Creatives" },
  { id: "adset",    label: "Ad Sets"   },
  { id: "campaign", label: "Campaigns" },
];

const fmt$   = (n: number) => `$${Math.round(n).toLocaleString()}`;
const fmtDec = (n: number) => `$${n.toFixed(2)}`;
const fmtN   = (n: number) => n.toLocaleString();

const CARD = {
  background: "#ffffff",
  border: "1px solid rgba(0,0,0,0.07)",
  boxShadow: "0 1px 2px rgba(0,0,0,0.03), 0 10px 28px -12px rgba(0,0,0,0.10)",
};

const TH = "text-right px-3 py-2 text-[10px] font-bold uppercase tracking-wider";
const TD = "text-right px-3 py-2.5 text-xs";

export default function CreativeLeaderboard({ startDate, endDate }: {
  startDate: string;
  endDate: string;
}) {
  const [level, setLevel]     = useState<Level>("ad");
  const [model, setModel]     = useState<Model>("first");
  const [rows, setRows]       = useState<Row[]>([]);
  const [health, setHealth]   = useState<Health | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState("");
  const [minSpend, setMinSpend] = useState(0);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const [lb, h] = await Promise.all([
        fetch(`/api/creative-leaderboard?level=${level}&model=${model}&start_date=${startDate}&end_date=${endDate}&min_spend=${minSpend}`)
          .then(r => r.json()),
        fetch(`/api/attribution-health?days=30`).then(r => r.json()).catch(() => null),
      ]);
      if (lb.error) setError(lb.error); else setRows(lb.rows ?? []);
      if (h && !h.error) setHealth(h);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [level, model, startDate, endDate, minSpend]);

  useEffect(() => { load(); }, [load]);

  const coverage = health?.overall.coverage ?? null;
  const badCoverage = coverage !== null && coverage < 90;

  return (
    <div className="space-y-4">

      {/* Attribution health — the leaderboard is only as complete as its inputs,
          so coverage is stated up front rather than left to be discovered. */}
      {health && (
        <div className="rounded-2xl p-4" style={{
          ...CARD,
          background: badCoverage ? "rgba(192,57,43,0.06)" : "#ffffff",
          border: badCoverage ? "1px solid rgba(192,57,43,0.25)" : CARD.border,
        }}>
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div>
              <div className="text-sm font-semibold" style={{ color: "#111111" }}>
                Attribution coverage: {coverage!.toFixed(1)}%
              </div>
              <div className="text-xs mt-0.5" style={{ color: "#6b6b6b" }}>
                {fmtN(health.overall.attributed)} of {fmtN(health.overall.total)} events in the last 30 days carry ad data.
                {badCoverage && " Anything unattributed is missing from the table below."}
              </div>
            </div>
            {(health.alerts.regressed.length > 0 || health.alerts.low.length > 0) && (
              <div className="text-xs text-right" style={{ color: "#b91c1c" }}>
                {health.alerts.regressed.length > 0 && (
                  <div><strong>Dropped recently:</strong> {health.alerts.regressed.join(", ")}</div>
                )}
                {health.alerts.low.length > 0 && (
                  <div><strong>Low coverage:</strong> {health.alerts.low.join(", ")}</div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Controls */}
      <div className="rounded-2xl p-4 flex items-center gap-3 flex-wrap" style={CARD}>
        <div className="flex rounded-lg overflow-hidden" style={{ border: "1px solid rgba(0,0,0,0.162)" }}>
          {LEVELS.map(l => (
            <button key={l.id} onClick={() => setLevel(l.id)}
              className="px-3 py-1.5 text-xs font-semibold"
              style={{
                background: level === l.id ? "rgba(0,0,0,0.09)" : "#f7f7f7",
                color: level === l.id ? "#111111" : "#6b6b6b",
              }}>
              {l.label}
            </button>
          ))}
        </div>

        <div className="flex rounded-lg overflow-hidden" style={{ border: "1px solid rgba(0,0,0,0.162)" }}>
          {MODELS.map(m => (
            <button key={m.id} onClick={() => setModel(m.id)} title={m.hint}
              className="px-3 py-1.5 text-xs font-semibold"
              style={{
                background: model === m.id ? "rgba(0,0,0,0.09)" : "#f7f7f7",
                color: model === m.id ? "#111111" : "#6b6b6b",
              }}>
              {m.label}
            </button>
          ))}
        </div>

        <label className="text-xs flex items-center gap-2" style={{ color: "#6b6b6b" }}>
          Min spend
          <input type="number" value={minSpend} min={0} step={50}
            onChange={e => setMinSpend(Number(e.target.value) || 0)}
            className="w-24 px-2 py-1.5 rounded-lg text-xs"
            style={{ background: "#f7f7f7", border: "1px solid rgba(0,0,0,0.162)", color: "#111111" }} />
        </label>

        <button onClick={load} disabled={loading}
          className="px-3 py-1.5 rounded-lg text-xs font-semibold"
          style={{ background: "rgba(0,0,0,0.09)", color: "#4a4a4a", border: "1px solid rgba(0,0,0,0.18)", opacity: loading ? 0.6 : 1 }}>
          {loading ? "Loading…" : "Refresh"}
        </button>

        <div className="text-xs ml-auto" style={{ color: "#6b6b6b" }}>
          {MODELS.find(m => m.id === model)!.hint}. Pooled across every client, sorted by cost per appointment.
        </div>
      </div>

      {error && (
        <div className="rounded-2xl p-4 text-sm" style={{ background: "rgba(192,57,43,0.08)", border: "1px solid rgba(192,57,43,0.2)", color: "#b91c1c" }}>
          {error}
        </div>
      )}

      {!error && !loading && rows.length === 0 && (
        <div className="rounded-2xl p-8 text-center text-sm" style={{ ...CARD, color: "#6b6b6b" }}>
          No {LEVELS.find(l => l.id === level)?.label.toLowerCase()} with spend in this range.
        </div>
      )}

      {rows.length > 0 && (
        <div className="rounded-2xl overflow-x-auto" style={CARD}>
          <table className="w-full text-sm" style={{ borderCollapse: "collapse", minWidth: 1180 }}>
            <thead style={{ background: "#f7f7f7", borderBottom: "1px solid rgba(0,0,0,0.07)" }}>
              <tr>
                <th className="text-left px-3 py-2 text-[10px] font-bold uppercase tracking-wider" style={{ color: "#6b6b6b" }}>
                  {LEVELS.find(l => l.id === level)?.label.replace(/s$/, "")}
                </th>
                {["Clients", "Spend", "Leads", "Appts", "Shows", "Closes",
                  "Cost / Lead", "Cost / Appt", "Lead→Appt", "Show Rate", "ROAS"].map(c => (
                  <th key={c} className={TH} style={{ color: "#6b6b6b" }}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const dash = <span style={{ color: "#c4c4c4" }}>—</span>;
                return (
                  <tr key={r.name + i} style={{ borderTop: "1px solid rgba(0,0,0,0.05)" }}>
                    <td className="px-3 py-2.5" style={{ maxWidth: 320 }}>
                      <div className="text-xs font-medium truncate" style={{ color: "#111111" }}>{r.name}</div>
                      {(r.variants > 1 || r.pooled_names?.length > 0) && (
                        <div className="text-[10px] mt-0.5" style={{ color: "#9b9b9b" }}>
                          {r.variants > 1 && `${r.variants} variants pooled`}
                          {r.pooled_names?.length > 1 && (
                            <span title={r.pooled_names.join("  ·  ")}>
                              {r.variants > 1 ? " · " : ""}
                              also named: {r.pooled_names.slice(1).join(", ")}
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className={TD} style={{ color: "#6b6b6b" }}>{r.clients}</td>
                    <td className={TD} style={{ color: "#111111" }}>{fmt$(r.spend)}</td>
                    <td className={TD} style={{ color: r.leads ? "#111111" : "#c4c4c4" }}>{r.leads ? fmtN(r.leads) : dash}</td>
                    <td className={TD} style={{ color: r.appts ? "#111111" : "#c4c4c4" }}>{r.appts ? fmtN(r.appts) : dash}</td>
                    <td className={TD} style={{ color: "#6b6b6b" }}>{r.shows ? fmtN(r.shows) : dash}</td>
                    <td className={TD} style={{ color: r.closes ? "#15803d" : "#c4c4c4" }}>{r.closes ? fmtN(r.closes) : dash}</td>
                    <td className={TD} style={{ color: "#6b6b6b" }}>{r.cost_per_lead ? fmtDec(r.cost_per_lead) : dash}</td>
                    <td className={TD} style={{ color: r.cost_per_appt ? "#111111" : "#c4c4c4", fontWeight: r.cost_per_appt ? 600 : 400 }}>
                      {r.cost_per_appt ? fmtDec(r.cost_per_appt) : dash}
                    </td>
                    <td className={TD} style={{ color: "#6b6b6b" }}>{r.lead_to_appt ? `${r.lead_to_appt.toFixed(0)}%` : dash}</td>
                    <td className={TD} style={{ color: "#6b6b6b" }}>{r.show_rate ? `${r.show_rate.toFixed(0)}%` : dash}</td>
                    <td className={TD} style={{ color: r.roas ? "#15803d" : "#c4c4c4" }}>{r.roas ? `${r.roas.toFixed(2)}x` : dash}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
