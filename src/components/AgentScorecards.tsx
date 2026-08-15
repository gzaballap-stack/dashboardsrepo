"use client";

import { useEffect, useState } from "react";

type Client = { id: string; name: string };
type AgentRow = {
  agent_name: string;
  dials: number;
  pickups: number;
  pickup_rate: number;
  conversations: number;
  appointments: number;
  shows: number;
  no_shows: number;
  show_rate: number;
  avg_speed_to_lead_min: number | null;
  today: { dials: number; pickups: number; appointments: number };
};
type Goal = { agent_name: string | null; metric: string; target: number; period: string };

type Props = { clients: Client[]; startDate: string; endDate: string };

function Ring({ pct, color, size = 56 }: { pct: number; color: string; size?: number }) {
  const r = (size - 8) / 2;
  const circ = 2 * Math.PI * r;
  const offset = circ - (Math.min(pct, 100) / 100) * circ;
  return (
    <svg width={size} height={size} className="flex-shrink-0">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={4} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={4}
        strokeDasharray={circ} strokeDashoffset={offset}
        strokeLinecap="round" transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      <text x={size / 2} y={size / 2 + 4} textAnchor="middle" fontSize={11} fontWeight={700} fill={color}>{pct}%</text>
    </svg>
  );
}

export default function AgentScorecards({ clients, startDate, endDate }: Props) {
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(false);
  const [clientFilter, setClientFilter] = useState("");

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (clientFilter) params.set("clientId", clientFilter);
    if (startDate) params.set("startDate", startDate);
    if (endDate) params.set("endDate", endDate);

    Promise.all([
      fetch(`/api/agent-stats?${params}`).then(r => r.json()),
      clientFilter ? fetch(`/api/goals?clientId=${clientFilter}`).then(r => r.json()) : Promise.resolve({ goals: [] }),
    ]).then(([statsData, goalsData]) => {
      setAgents(statsData.agents ?? []);
      setGoals(goalsData.goals ?? []);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, [clientFilter, startDate, endDate]);

  function getTarget(agentName: string, metric: string) {
    return goals.find(g => g.agent_name === agentName && g.metric === metric && g.period === "daily")?.target ?? null;
  }

  const selectStyle = {
    background: "#0f2040", border: "1px solid rgba(255,255,255,0.12)",
    color: "#e2e8f0", borderRadius: "0.5rem", padding: "0.5rem 1rem",
    fontSize: "0.875rem", outline: "none",
  } as React.CSSProperties;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-semibold" style={{ color: "#e2e8f0" }}>Agent Scorecards</h2>
          <p className="text-sm mt-0.5" style={{ color: "#475569" }}>Today's performance + period totals and response time</p>
        </div>
        <select style={selectStyle} value={clientFilter} onChange={e => setClientFilter(e.target.value)}>
          <option value="">All Clients</option>
          {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="py-12 text-center text-sm" style={{ color: "#1e3a5f" }}>Loading…</div>
      ) : agents.length === 0 ? (
        <div className="py-12 text-center text-sm" style={{ color: "#1e3a5f" }}>No agent data</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {agents.map(a => {
            const dialTarget = getTarget(a.agent_name, "dials");
            const apptTarget = getTarget(a.agent_name, "appointments");
            const dialPct = dialTarget ? Math.min(100, Math.round((a.today.dials / dialTarget) * 100)) : null;
            const apptPct = apptTarget ? Math.min(100, Math.round((a.today.appointments / apptTarget) * 100)) : null;

            return (
              <div key={a.agent_name} className="rounded-xl p-5 space-y-4"
                style={{ background: "#0a1628", border: "1px solid rgba(255,255,255,0.06)" }}>
                {/* Header */}
                <div className="flex items-center justify-between">
                  <span className="font-semibold" style={{ color: "#e2e8f0" }}>{a.agent_name}</span>
                  {a.avg_speed_to_lead_min != null && (
                    <span className="text-xs px-2 py-1 rounded-full"
                      style={{ background: "rgba(245,158,11,0.1)", color: "#f59e0b" }}>
                      ⚡ {a.avg_speed_to_lead_min}m avg response
                    </span>
                  )}
                </div>

                {/* Today */}
                <div>
                  <p className="text-xs font-bold uppercase tracking-widest mb-2" style={{ color: "#334155" }}>Today</p>
                  <div className="flex items-center gap-6">
                    <div className="text-center">
                      {dialPct !== null
                        ? <Ring pct={dialPct} color={dialPct >= 100 ? "#34d399" : dialPct >= 70 ? "#fbbf24" : "#f87171"} />
                        : <p className="text-2xl font-bold" style={{ color: "#e2e8f0" }}>{a.today.dials}</p>}
                      <p className="text-xs mt-1" style={{ color: "#475569" }}>Dials{dialTarget ? ` / ${dialTarget}` : ""}</p>
                    </div>
                    <div className="text-center">
                      <p className="text-2xl font-bold" style={{ color: "#e2e8f0" }}>{a.today.pickups}</p>
                      <p className="text-xs mt-1" style={{ color: "#475569" }}>Pickups</p>
                    </div>
                    <div className="text-center">
                      {apptPct !== null
                        ? <Ring pct={apptPct} color={apptPct >= 100 ? "#34d399" : apptPct >= 70 ? "#fbbf24" : "#f87171"} />
                        : <p className="text-2xl font-bold" style={{ color: "#f59e0b" }}>{a.today.appointments}</p>}
                      <p className="text-xs mt-1" style={{ color: "#475569" }}>Appts{apptTarget ? ` / ${apptTarget}` : ""}</p>
                    </div>
                  </div>
                </div>

                {/* Period totals */}
                <div style={{ borderTop: "1px solid rgba(255,255,255,0.05)", paddingTop: "0.75rem" }}>
                  <p className="text-xs font-bold uppercase tracking-widest mb-2" style={{ color: "#334155" }}>Period Totals</p>
                  <div className="grid grid-cols-4 gap-2 text-center">
                    {[
                      { label: "Dials", value: a.dials },
                      { label: "Pickup %", value: `${a.pickup_rate}%` },
                      { label: "Appts", value: a.appointments },
                      { label: "Show %", value: `${a.show_rate}%` },
                    ].map(s => (
                      <div key={s.label}>
                        <p className="text-base font-bold" style={{ color: "#94a3b8" }}>{s.value}</p>
                        <p className="text-xs" style={{ color: "#334155" }}>{s.label}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
