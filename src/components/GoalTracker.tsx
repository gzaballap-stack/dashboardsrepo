"use client";

import { useEffect, useState } from "react";

type Client = { id: string; name: string };
type Goal = { id: string; client_id: string; agent_name: string | null; metric: string; target: number; period: string };
type Metrics = Record<string, number>;

type Props = { clients: Client[]; startDate: string; endDate: string };

const CLIENT_METRICS = [
  { key: "new_leads", label: "New Leads" },
  { key: "booked_appointments", label: "Appointments Booked" },
  { key: "shows", label: "Shows" },
  { key: "outbound_dials", label: "Outbound Dials" },
  { key: "ad_spend", label: "Ad Spend ($)" },
];

function ProgressBar({ value, target, isCurrency = false }: { value: number; target: number; isCurrency?: boolean }) {
  const pct = Math.min(100, target > 0 ? Math.round((value / target) * 100) : 0);
  const color = pct >= 100 ? "#34d399" : pct >= 70 ? "#fbbf24" : "#f87171";
  const fmt = (n: number) => isCurrency ? `$${Math.round(n).toLocaleString()}` : Math.round(n).toLocaleString();
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span style={{ color }}>{pct}%</span>
        <span style={{ color: "#475569" }}>{fmt(value)} / {fmt(target)}</span>
      </div>
      <div className="h-2 rounded-full overflow-hidden" style={{ background: "rgba(255,255,255,0.06)" }}>
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

export default function GoalTracker({ clients, startDate, endDate }: Props) {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [metrics, setMetrics] = useState<Metrics>({});
  const [clientId, setClientId] = useState("");
  const [adding, setAdding] = useState(false);
  const [newGoal, setNewGoal] = useState({ metric: "new_leads", target: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function loadGoals(cid: string) {
    if (!cid) { setGoals([]); return; }
    fetch(`/api/goals?clientId=${cid}`)
      .then(r => r.json()).then(d => setGoals(d.goals ?? []));
  }

  function loadMetrics(cid: string) {
    const params = new URLSearchParams();
    if (cid) params.set("client_id", cid);
    if (startDate) params.set("start_date", startDate);
    if (endDate) params.set("end_date", endDate);
    fetch(`/api/metrics?${params}`)
      .then(r => r.json()).then(d => setMetrics(d));
  }

  useEffect(() => { loadGoals(clientId); loadMetrics(clientId); }, [clientId, startDate, endDate]);

  async function handleAdd() {
    if (!clientId || !newGoal.target) return;
    setSaving(true); setError("");
    const res = await fetch("/api/goals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: clientId, metric: newGoal.metric, target: Number(newGoal.target), period: "monthly" }),
    });
    const data = await res.json();
    setSaving(false);
    if (!res.ok) { setError(data.error ?? "Failed to save"); return; }
    setAdding(false); setNewGoal({ metric: "new_leads", target: "" });
    loadGoals(clientId);
  }

  async function handleDelete(id: string) {
    await fetch(`/api/goals/${id}`, { method: "DELETE" });
    loadGoals(clientId);
  }

  const selectStyle = {
    background: "#0a1628", border: "1px solid rgba(255,255,255,0.12)",
    color: "#e2e8f0", borderRadius: "0.5rem", padding: "0.5rem 0.75rem",
    fontSize: "0.875rem", outline: "none", width: "100%",
  } as React.CSSProperties;

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-xl font-semibold" style={{ color: "#e2e8f0" }}>Goal Tracker</h2>
          <p className="text-sm mt-0.5" style={{ color: "#475569" }}>Set monthly targets and track progress</p>
        </div>
        <div className="flex items-center gap-3">
          <select style={{ ...selectStyle, width: "auto", minWidth: "11rem" }} value={clientId} onChange={e => setClientId(e.target.value)}>
            <option value="">Select a client</option>
            {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          {clientId && !adding && (
            <button onClick={() => setAdding(true)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold"
              style={{ background: "#f59e0b", color: "#fff" }}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
              </svg>
              Add Goal
            </button>
          )}
        </div>
      </div>

      {!clientId && (
        <div className="rounded-xl py-16 text-center text-sm" style={{ background: "#0a1628", border: "1px solid rgba(255,255,255,0.05)", color: "#1e3a5f" }}>
          Select a client to view and set goals
        </div>
      )}

      {error && (
        <div className="px-4 py-3 rounded-lg text-sm" style={{ background: "rgba(239,68,68,0.12)", border: "1px solid rgba(239,68,68,0.25)", color: "#f87171" }}>{error}</div>
      )}

      {clientId && adding && (
        <div className="rounded-xl p-4 space-y-3" style={{ background: "#0a1628", border: "1px solid rgba(245,158,11,0.25)" }}>
          <p className="text-sm font-semibold" style={{ color: "#f59e0b" }}>New Goal</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: "#475569" }}>Metric</label>
              <select style={selectStyle} value={newGoal.metric} onChange={e => setNewGoal(s => ({ ...s, metric: e.target.value }))}>
                {CLIENT_METRICS.map(m => <option key={m.key} value={m.key}>{m.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: "#475569" }}>Monthly Target</label>
              <input style={selectStyle} type="number" placeholder="e.g. 50" value={newGoal.target}
                onChange={e => setNewGoal(s => ({ ...s, target: e.target.value }))}
                onKeyDown={e => { if (e.key === "Enter") handleAdd(); }} />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => { setAdding(false); setError(""); }}
              className="px-4 py-2 rounded-lg text-sm" style={{ background: "rgba(255,255,255,0.05)", color: "#64748b" }}>Cancel</button>
            <button onClick={handleAdd} disabled={saving || !newGoal.target}
              className="px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-40"
              style={{ background: "#f59e0b", color: "#fff" }}>{saving ? "Saving…" : "Save Goal"}</button>
          </div>
        </div>
      )}

      {clientId && goals.length === 0 && !adding && (
        <div className="rounded-xl py-12 text-center text-sm" style={{ background: "#0a1628", border: "1px solid rgba(255,255,255,0.05)", color: "#1e3a5f" }}>
          No goals set — add your first goal above
        </div>
      )}

      {goals.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {goals.map(g => {
            const metricLabel = CLIENT_METRICS.find(m => m.key === g.metric)?.label ?? g.metric;
            const isCurrency = g.metric === "ad_spend";
            const current = Number(metrics[g.metric] ?? 0);
            return (
              <div key={g.id} className="rounded-xl p-5 relative group"
                style={{ background: "#0a1628", border: "1px solid rgba(255,255,255,0.06)" }}>
                <button onClick={() => handleDelete(g.id)}
                  className="absolute top-3 right-3 opacity-0 group-hover:opacity-100 transition-opacity text-xs px-2 py-1 rounded"
                  style={{ color: "#ef4444", background: "rgba(239,68,68,0.08)" }}>✕</button>
                <p className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: "#475569" }}>{metricLabel}</p>
                <ProgressBar value={current} target={g.target} isCurrency={isCurrency} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
