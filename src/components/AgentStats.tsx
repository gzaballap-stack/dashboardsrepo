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
          <h2 className="text-xl font-semibold" style={{ color: "#111111" }}>Agent Stats</h2>
          <p className="text-sm mt-0.5" style={{ color: "#767676" }}>Performance breakdown by agent</p>
        </div>
        <select
          value={clientFilter}
          onChange={e => setClientFilter(e.target.value)}
          className="px-4 py-2 rounded-lg text-sm font-medium outline-none"
          style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.162)", color: "#111111", minWidth: "11rem" }}
        >
          <option value="">All Clients</option>
          {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {/* Agent stats table */}
      <div className="rounded-xl overflow-hidden" style={{ border: "1px solid rgba(0,0,0,0.081)" }}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: "#ffffff" }}>
                <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider whitespace-nowrap"
                  style={{ color: "#767676", borderBottom: "1px solid rgba(0,0,0,0.081)" }}>
                  Agent
                </th>
                {statCols.map(c => (
                  <th key={c.key} className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider whitespace-nowrap"
                    style={{ color: "#767676", borderBottom: "1px solid rgba(0,0,0,0.081)" }}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={statCols.length + 1} className="px-4 py-12 text-center text-sm" style={{ color: "#c2c2c2" }}>Loading…</td></tr>
              ) : agents.length === 0 ? (
                <tr><td colSpan={statCols.length + 1} className="px-4 py-12 text-center text-sm" style={{ color: "#c2c2c2" }}>No agent data</td></tr>
              ) : agents.map((a, i) => (
                <tr key={a.agent_name} style={{ borderTop: "1px solid rgba(0,0,0,0.041)", background: i % 2 === 0 ? "rgba(0,0,0,0.02)" : "transparent" }}>
                  <td className="px-4 py-3 font-medium whitespace-nowrap" style={{ color: "#111111" }}>{a.agent_name}</td>
                  {statCols.map(c => {
                    const v = a[c.key as keyof AgentRow] as number;
                    const isRate = c.key.endsWith("_rate");
                    return (
                      <td key={c.key} className="px-4 py-3 text-right whitespace-nowrap tabular-nums"
                        style={{ color: isRate ? (v >= 50 ? "#333333" : v >= 25 ? "#333333" : "#c0392b") : "#4a4a4a" }}>
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
        <h3 className="text-base font-semibold mb-4" style={{ color: "#111111" }}>Setter Leaderboard</h3>
        <div className="space-y-2">
          {loading ? (
            <p className="text-sm py-4 text-center" style={{ color: "#c2c2c2" }}>Loading…</p>
          ) : agents.filter(a => a.appointments > 0).length === 0 ? (
            <p className="text-sm py-4 text-center" style={{ color: "#c2c2c2" }}>No appointment data</p>
          ) : agents
              .filter(a => a.appointments > 0)
              .sort((a, b) => b.appointments - a.appointments)
              .map((a, i) => {
                const max = agents[0]?.appointments || 1;
                const pct = Math.round((a.appointments / max) * 100);
                const medals = ["🥇", "🥈", "🥉"];
                return (
                  <div key={a.agent_name} className="rounded-lg p-3" style={{ background: "#fafafa", border: "1px solid rgba(0,0,0,0.068)" }}>
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-base">{medals[i] ?? `#${i + 1}`}</span>
                        <span className="text-sm font-medium" style={{ color: "#111111" }}>{a.agent_name}</span>
                      </div>
                      <div className="flex items-center gap-4 text-xs tabular-nums" style={{ color: "#6b6b6b" }}>
                        <span><span style={{ color: "#000000", fontWeight: 600 }}>{a.appointments}</span> appts</span>
                        <span><span style={{ color: "#333333", fontWeight: 600 }}>{a.show_rate}%</span> show rate</span>
                      </div>
                    </div>
                    <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(0,0,0,0.081)" }}>
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${pct}%`, background: i === 0 ? "#000000" : i === 1 ? "#4a4a4a" : i === 2 ? "#c97c3c" : "#949494" }}
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
