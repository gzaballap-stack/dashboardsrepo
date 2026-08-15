"use client";

import { useEffect, useState } from "react";

type Client = { id: string; name: string };

type AgentRow = {
  agent_name: string;
  dials: number;
  pickups: number;
  pickup_rate: number;
  conversations: number;
  conversation_rate: number;
  appointments: number;
  callbacks: number;
  shows: number;
  no_shows: number;
  show_rate: number;
};

type Props = {
  clients: Client[];
  preset: string;
  startDate: string;
  endDate: string;
};

export default function AgentStats({ clients, preset, startDate, endDate }: Props) {
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [clientFilter, setClientFilter] = useState("");

  useEffect(() => { setClientFilter(""); }, [preset]);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (clientFilter) params.set("clientId", clientFilter);
    if (startDate) params.set("startDate", startDate);
    if (endDate) params.set("endDate", endDate);

    fetch(`/api/agent-stats?${params}`)
      .then(r => r.json())
      .then(d => { setAgents(d.agents ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }, [clientFilter, startDate, endDate]);

  const statCols = [
    { key: "dials", label: "Dials" },
    { key: "pickups", label: "Pickups" },
    { key: "pickup_rate", label: "Pickup %" },
    { key: "conversations", label: "Convos" },
    { key: "conversation_rate", label: "Convo %" },
    { key: "appointments", label: "Appts" },
    { key: "callbacks", label: "Callbacks" },
    { key: "shows", label: "Shows" },
    { key: "no_shows", label: "No Shows" },
    { key: "show_rate", label: "Show %" },
  ];

  return (
    <div className="space-y-8">
      {/* Header + filter */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold" style={{ color: "#e2e8f0" }}>Agent Stats</h2>
          <p className="text-sm mt-0.5" style={{ color: "#475569" }}>Performance breakdown by agent</p>
        </div>
        <select
          value={clientFilter}
          onChange={e => setClientFilter(e.target.value)}
          className="px-4 py-2 rounded-lg text-sm font-medium outline-none"
          style={{ background: "#0f2040", border: "1px solid rgba(255,255,255,0.12)", color: "#e2e8f0", minWidth: "11rem" }}
        >
          <option value="">All Clients</option>
          {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {/* Agent stats table */}
      <div className="rounded-xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.06)" }}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: "#050c18" }}>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider whitespace-nowrap"
                  style={{ color: "#475569", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                  Agent
                </th>
                {statCols.map(c => (
                  <th key={c.key} className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider whitespace-nowrap"
                    style={{ color: "#475569", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={statCols.length + 1} className="px-4 py-12 text-center text-sm" style={{ color: "#1e3a5f" }}>Loading…</td></tr>
              ) : agents.length === 0 ? (
                <tr><td colSpan={statCols.length + 1} className="px-4 py-12 text-center text-sm" style={{ color: "#1e3a5f" }}>No agent data</td></tr>
              ) : agents.map((a, i) => (
                <tr key={a.agent_name} style={{ borderTop: "1px solid rgba(255,255,255,0.03)", background: i % 2 === 0 ? "rgba(255,255,255,0.015)" : "transparent" }}>
                  <td className="px-4 py-3 font-medium whitespace-nowrap" style={{ color: "#e2e8f0" }}>{a.agent_name}</td>
                  {statCols.map(c => {
                    const v = a[c.key as keyof AgentRow] as number;
                    const isRate = c.key.endsWith("_rate");
                    return (
                      <td key={c.key} className="px-4 py-3 text-right whitespace-nowrap tabular-nums"
                        style={{ color: isRate ? (v >= 50 ? "#34d399" : v >= 25 ? "#fbbf24" : "#f87171") : "#94a3b8" }}>
                        {isRate ? `${v}%` : v.toLocaleString()}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Setter Leaderboard */}
      <div>
        <h3 className="text-base font-semibold mb-4" style={{ color: "#e2e8f0" }}>Setter Leaderboard</h3>
        <div className="space-y-2">
          {loading ? (
            <p className="text-sm py-4 text-center" style={{ color: "#1e3a5f" }}>Loading…</p>
          ) : agents.filter(a => a.appointments > 0).length === 0 ? (
            <p className="text-sm py-4 text-center" style={{ color: "#1e3a5f" }}>No appointment data</p>
          ) : agents
              .filter(a => a.appointments > 0)
              .sort((a, b) => b.appointments - a.appointments)
              .map((a, i) => {
                const max = agents[0]?.appointments || 1;
                const pct = Math.round((a.appointments / max) * 100);
                const medals = ["🥇", "🥈", "🥉"];
                return (
                  <div key={a.agent_name} className="rounded-lg p-3" style={{ background: "#0a1628", border: "1px solid rgba(255,255,255,0.05)" }}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-base">{medals[i] ?? `#${i + 1}`}</span>
                        <span className="text-sm font-medium" style={{ color: "#e2e8f0" }}>{a.agent_name}</span>
                      </div>
                      <div className="flex items-center gap-4 text-xs tabular-nums" style={{ color: "#64748b" }}>
                        <span><span style={{ color: "#f59e0b", fontWeight: 600 }}>{a.appointments}</span> appts</span>
                        <span><span style={{ color: "#34d399", fontWeight: 600 }}>{a.show_rate}%</span> show rate</span>
                      </div>
                    </div>
                    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${pct}%`, background: i === 0 ? "#f59e0b" : i === 1 ? "#94a3b8" : i === 2 ? "#c97c3c" : "#334155" }}
                      />
                    </div>
                  </div>
                );
              })}
        </div>
      </div>
    </div>
  );
}
