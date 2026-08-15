"use client";

import { useEffect, useState } from "react";

type Client = { id: string; name: string };
type Row = {
  id: string;
  occurred_at: string;
  lead_name: string | null;
  lead_phone: string | null;
  agent_name: string | null;
  duration_seconds: number | null;
  is_pickup: boolean | null;
  is_conversation: boolean | null;
  call_status: string | null;
  recording_url: string;
  clients: { name: string } | null;
};

type Props = { clients: Client[]; startDate: string; endDate: string };

const OUTCOME_OPTIONS = [
  { value: "all", label: "All Recordings" },
  { value: "conversation", label: "Conversations (2m+)" },
  { value: "pickup", label: "Pickups (40s+)" },
];

function fmt(s: number) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

export default function RecordingBrowser({ clients, startDate, endDate }: Props) {
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [clientFilter, setClientFilter] = useState("");
  const [agentFilter, setAgentFilter] = useState("");
  const [outcome, setOutcome] = useState("all");
  const [page, setPage] = useState(1);
  const [agents, setAgents] = useState<string[]>([]);

  // Reset both page and accumulated agent list when filters change
  useEffect(() => { setPage(1); setAgents([]); }, [clientFilter, outcome, startDate, endDate]);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), outcome });
    if (clientFilter) params.set("clientId", clientFilter);
    if (agentFilter) params.set("agentName", agentFilter);
    if (startDate) params.set("startDate", startDate);
    if (endDate) params.set("endDate", endDate);

    fetch(`/api/recordings?${params}`)
      .then(r => r.json())
      .then(d => {
        setRows(d.rows ?? []);
        setTotal(d.total ?? 0);
        const names = (d.rows ?? []).map((r: Row) => r.agent_name).filter(Boolean) as string[];
        setAgents(prev => [...new Set([...prev, ...names])]);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [clientFilter, agentFilter, outcome, page, startDate, endDate]);

  const totalPages = Math.ceil(total / 50);
  const selectStyle = {
    background: "#0f2040", border: "1px solid rgba(255,255,255,0.12)",
    color: "#e2e8f0", borderRadius: "0.5rem", padding: "0.5rem 1rem",
    fontSize: "0.875rem", outline: "none",
  } as React.CSSProperties;

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <select style={selectStyle} value={clientFilter} onChange={e => setClientFilter(e.target.value)}>
          <option value="">All Clients</option>
          {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select style={selectStyle} value={agentFilter} onChange={e => setAgentFilter(e.target.value)}>
          <option value="">All Agents</option>
          {agents.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <select style={selectStyle} value={outcome} onChange={e => setOutcome(e.target.value)}>
          {OUTCOME_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <span className="text-sm ml-auto" style={{ color: "#334155" }}>{total.toLocaleString()} recordings</span>
      </div>

      {/* Cards */}
      <div className="space-y-2">
        {loading ? (
          <div className="py-12 text-center text-sm" style={{ color: "#1e3a5f" }}>Loading…</div>
        ) : rows.length === 0 ? (
          <div className="py-12 text-center text-sm" style={{ color: "#1e3a5f" }}>No recordings found</div>
        ) : rows.map(row => (
          <div key={row.id} className="rounded-xl px-5 py-4 flex items-center gap-5"
            style={{ background: "#0a1628", border: "1px solid rgba(255,255,255,0.05)" }}>
            {/* Play button */}
            <a href={row.recording_url} target="_blank" rel="noopener noreferrer"
              className="flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center transition-colors"
              style={{ background: "rgba(245,158,11,0.15)", border: "1px solid rgba(245,158,11,0.3)" }}
              onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "rgba(245,158,11,0.3)"}
              onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "rgba(245,158,11,0.15)"}>
              <svg className="w-4 h-4 ml-0.5" fill="#f59e0b" viewBox="0 0 24 24">
                <path d="M8 5v14l11-7z" />
              </svg>
            </a>

            {/* Info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-sm font-medium" style={{ color: "#e2e8f0" }}>{row.lead_name ?? "Unknown Lead"}</span>
                <span className="text-xs" style={{ color: "#334155" }}>{row.lead_phone ?? ""}</span>
                {row.is_conversation && (
                  <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: "rgba(52,211,153,0.12)", color: "#34d399" }}>Conversation</span>
                )}
                {row.is_pickup && !row.is_conversation && (
                  <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: "rgba(96,165,250,0.12)", color: "#60a5fa" }}>Pickup</span>
                )}
              </div>
              <div className="flex items-center gap-4 mt-1 text-xs" style={{ color: "#475569" }}>
                <span>{new Date(row.occurred_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                {row.duration_seconds != null && <span>{fmt(row.duration_seconds)}</span>}
                {row.clients?.name && <span>{row.clients.name}</span>}
              </div>
            </div>

            {/* Agent */}
            {row.agent_name && (
              <div className="flex-shrink-0 text-right">
                <span className="text-xs font-medium" style={{ color: "#64748b" }}>{row.agent_name}</span>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center gap-3 justify-end">
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
            className="px-3 py-1.5 rounded-lg text-sm font-medium disabled:opacity-30"
            style={{ background: "#0f2040", border: "1px solid rgba(255,255,255,0.10)", color: "#94a3b8" }}>
            ← Prev
          </button>
          <span className="text-sm" style={{ color: "#334155" }}>Page {page} of {totalPages}</span>
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
            className="px-3 py-1.5 rounded-lg text-sm font-medium disabled:opacity-30"
            style={{ background: "#0f2040", border: "1px solid rgba(255,255,255,0.10)", color: "#94a3b8" }}>
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
