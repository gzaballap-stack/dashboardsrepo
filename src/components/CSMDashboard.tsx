"use client";

import { useEffect, useState, type CSSProperties } from "react";

type ClientCSMRow = {
  client_id: string;
  client_name: string;
  cadence_days: number;
  csm_name: string | null;
  last_touch_at: string | null;
  last_touch_type: string | null;
  last_touch_summary: string | null;
  days_since_last_touch: number | null;
  overdue: boolean;
  at_risk: boolean;
  total_touchpoints: number;
  left_review: boolean;
  review_date: string | null;
  review_platform: string | null;
  review_link: string | null;
  upsell_status: "none" | "attempted" | "closed_won" | "closed_lost";
  upsell_notes: string | null;
  upsell_date: string | null;
};

type Touchpoint = {
  id: string;
  client_id: string;
  occurred_at: string;
  type: string;
  summary: string | null;
  csm_name: string | null;
  agent_name?: string | null;
  duration_seconds?: number | null;
  recording_url?: string | null;
  source?: "client" | "b2b";
};

function mmss(sec: number | null | undefined) {
  if (sec === null || sec === undefined) return null;
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

const TOUCHPOINT_TYPES = ["call", "email", "meeting", "text", "other"] as const;
const UPSELL_LABELS: Record<ClientCSMRow["upsell_status"], string> = {
  none: "Not Attempted", attempted: "Attempted", closed_won: "Closed Won", closed_lost: "Closed Lost",
};
const UPSELL_STYLE: Record<ClientCSMRow["upsell_status"], { color: string; bg: string }> = {
  none:        { color: "#6b6b6b", bg: "rgba(100,116,139,0.12)" },
  attempted:   { color: "#000000", bg: "rgba(0,0,0,0.072)" },
  closed_won:  { color: "#000000", bg: "rgba(0,0,0,0.072)" },
  closed_lost: { color: "#c0392b", bg: "rgba(192,57,43,0.12)" },
};

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function inputStyle(): CSSProperties {
  return { background: "#f7f7f7", border: "1px solid rgba(0,0,0,0.162)", color: "#111111" };
}

export default function CSMDashboard() {
  const [rows, setRows] = useState<ClientCSMRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "at_risk" | "overdue" | "on_track">("all");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [touchpoints, setTouchpoints] = useState<Touchpoint[]>([]);
  const [tpLoading, setTpLoading] = useState(false);

  // Log-touchpoint form state
  const [logType, setLogType] = useState<typeof TOUCHPOINT_TYPES[number]>("call");
  const [logDate, setLogDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [logSummary, setLogSummary] = useState("");
  const [logCsm, setLogCsm] = useState("");
  const [saving, setSaving] = useState(false);

  const load = () => {
    setLoading(true);
    setError("");
    fetch("/api/csm-dashboard")
      .then(r => r.json())
      .then(d => { if (d.error) setError(d.error); else setRows(d.clients ?? []); })
      .catch(() => setError("Failed to load CSM data"))
      .finally(() => setLoading(false));
  };

  useEffect(() => { load(); }, []);

  // Conversation history is two sources merged: CSM touchpoints logged against
  // the client, and B2B calls that resolved to this client.
  const loadTouchpoints = (clientId: string) => {
    setTpLoading(true);
    Promise.all([
      fetch(`/api/client-touchpoints?client_id=${clientId}`).then(r => r.json()).catch(() => ({})),
      fetch(`/api/csm-recordings?client_id=${clientId}&source=b2b`).then(r => r.json()).catch(() => ({})),
    ])
      .then(([tp, rec]) => {
        const logged: Touchpoint[] = (tp.touchpoints ?? []).map((t: Touchpoint) => ({ ...t, source: "client" as const }));
        const b2bCalls: Touchpoint[] = (rec.rows ?? []).map((r: {
          id: string; occurred_at: string; summary: string | null; csm_name: string | null;
          agent_name: string | null; duration_seconds: number | null; recording_url: string;
        }) => ({
          id: r.id, client_id: clientId, occurred_at: r.occurred_at,
          type: "b2b call", summary: r.summary, csm_name: r.csm_name,
          agent_name: r.agent_name, duration_seconds: r.duration_seconds,
          recording_url: r.recording_url, source: "b2b" as const,
        }));
        setTouchpoints(
          [...logged, ...b2bCalls].sort(
            (a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime()
          )
        );
      })
      .finally(() => setTpLoading(false));
  };

  const toggleExpand = (clientId: string) => {
    if (expanded === clientId) { setExpanded(null); return; }
    setExpanded(clientId);
    setLogSummary("");
    setLogDate(new Date().toISOString().slice(0, 10));
    loadTouchpoints(clientId);
  };

  const submitTouchpoint = async (clientId: string) => {
    setSaving(true);
    try {
      await fetch("/api/client-touchpoints", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: clientId,
          type: logType,
          summary: logSummary || null,
          csm_name: logCsm || null,
          occurred_at: new Date(logDate + "T12:00:00").toISOString(),
        }),
      });
      setLogSummary("");
      loadTouchpoints(clientId);
      load();
    } finally {
      setSaving(false);
    }
  };

  const updateStatus = async (row: ClientCSMRow, patch: Partial<ClientCSMRow>) => {
    const next = { ...row, ...patch };
    setRows(prev => prev.map(r => r.client_id === row.client_id ? next : r));
    await fetch("/api/client-csm-status", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: row.client_id,
        cadence_days: next.cadence_days,
        csm_name: next.csm_name,
        left_review: next.left_review,
        review_date: next.review_date,
        review_platform: next.review_platform,
        review_link: next.review_link,
        upsell_status: next.upsell_status,
        upsell_notes: next.upsell_notes,
        upsell_date: next.upsell_date,
      }),
    });
    load();
  };

  const filtered = rows
    .filter(r => r.client_name.toLowerCase().includes(search.toLowerCase()))
    .filter(r => {
      if (statusFilter === "all") return true;
      if (statusFilter === "at_risk") return r.at_risk;
      if (statusFilter === "overdue") return r.overdue && !r.at_risk;
      return !r.overdue && !r.at_risk;
    });

  const counts = {
    at_risk: rows.filter(r => r.at_risk).length,
    overdue: rows.filter(r => r.overdue && !r.at_risk).length,
    on_track: rows.filter(r => !r.overdue && !r.at_risk).length,
  };

  return (
    <div className="space-y-6 max-w-[1300px]">
      <div>
        <h2 className="text-xs font-bold uppercase tracking-widest mb-1" style={{ color: "#949494" }}>CSM Dashboard</h2>
        <p className="text-xs" style={{ color: "#767676" }}>
          Client touchpoints, review status, and upsell tracking. &quot;At Risk&quot; = no contact in 2x a client&apos;s expected cadence (default 14 days).
        </p>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {([
          ["all", "All", rows.length, { color: "#4a4a4a", bg: "rgba(0,0,0,0.06)" }],
          ["at_risk", "At Risk", counts.at_risk, { color: "#c0392b", bg: "rgba(192,57,43,0.12)" }],
          ["overdue", "Overdue", counts.overdue, { color: "#000000", bg: "rgba(0,0,0,0.072)" }],
          ["on_track", "On Track", counts.on_track, { color: "#000000", bg: "rgba(0,0,0,0.072)" }],
        ] as const).map(([key, label, count, style]) => {
          const active = statusFilter === key;
          return (
            <button key={key} onClick={() => setStatusFilter(key)}
              className="px-2.5 py-1 rounded-full text-xs font-semibold transition-opacity"
              style={{ color: style.color, background: style.bg, opacity: active ? 1 : 0.55, border: active ? `1px solid ${style.color}` : "1px solid transparent" }}>
              {label} {count}
            </button>
          );
        })}
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Filter clients..."
          className="ml-auto px-3 py-1.5 rounded-lg text-sm outline-none w-56"
          style={inputStyle()}
        />
      </div>

      {error && (
        <div className="rounded-xl p-4 text-sm" style={{ background: "rgba(192,57,43,0.08)", border: "1px solid rgba(192,57,43,0.2)", color: "#d98b82" }}>
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-10 text-sm" style={{ color: "#6b6b6b" }}>Loading CSM data…</div>
      ) : filtered.length === 0 && !error ? (
        <div className="rounded-xl p-8 text-center text-sm" style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.095)", color: "#6b6b6b" }}>
          No clients match this filter.
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(row => {
            const isOpen = expanded === row.client_id;
            const statusStyle = row.at_risk
              ? { label: "At Risk", color: "#c0392b", bg: "rgba(192,57,43,0.12)" }
              : row.overdue
                ? { label: "Overdue", color: "#000000", bg: "rgba(0,0,0,0.072)" }
                : { label: "On Track", color: "#000000", bg: "rgba(0,0,0,0.072)" };
            const upsellStyle = UPSELL_STYLE[row.upsell_status];

            return (
              <div key={row.client_id} className="rounded-xl overflow-hidden" style={{ border: "1px solid rgba(0,0,0,0.095)" }}>
                <div
                  onClick={() => toggleExpand(row.client_id)}
                  className="flex items-center gap-4 px-4 py-3 cursor-pointer flex-wrap"
                  style={{ background: "#ffffff" }}
                >
                  <svg className="w-3 h-3 flex-shrink-0 transition-transform" style={{ color: "#767676", transform: isOpen ? "rotate(90deg)" : "none" }}
                    fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                  <span className="font-semibold text-sm flex-shrink-0" style={{ color: "#111111", minWidth: 200 }}>{row.client_name}</span>
                  <span className="px-2 py-1 rounded-full text-xs font-semibold flex-shrink-0" style={{ color: statusStyle.color, background: statusStyle.bg }}>
                    {statusStyle.label}
                  </span>
                  <span className="text-xs flex-shrink-0" style={{ color: "#4a4a4a", minWidth: 160 }}>
                    Last touch: <span style={{ color: "#111111" }}>
                      {row.last_touch_at ? `${row.days_since_last_touch}d ago` : "Never"}
                    </span>
                    {row.last_touch_type && <span style={{ color: "#767676" }}> ({row.last_touch_type})</span>}
                  </span>
                  <span className="text-xs flex-shrink-0" style={{ color: "#767676" }}>
                    Cadence: {row.cadence_days}d
                  </span>
                  <span className="flex items-center gap-1 text-xs flex-shrink-0" style={{ color: row.left_review ? "#000000" : "#767676" }}>
                    {row.left_review ? "★ Reviewed" : "No Review"}
                  </span>
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase flex-shrink-0" style={{ color: upsellStyle.color, background: upsellStyle.bg }}>
                    {UPSELL_LABELS[row.upsell_status]}
                  </span>
                  {row.last_touch_summary && !isOpen && (
                    <span className="text-xs truncate flex-1" style={{ color: "#6b6b6b", minWidth: 100 }}>
                      &ldquo;{row.last_touch_summary}&rdquo;
                    </span>
                  )}
                </div>

                {isOpen && (
                  <div className="p-4 space-y-5" style={{ background: "#f7f7f7" }} onClick={e => e.stopPropagation()}>
                    {/* Log a touchpoint */}
                    <div className="rounded-lg p-3" style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.081)" }}>
                      <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "#6b6b6b" }}>Log a Touchpoint</p>
                      <div className="flex gap-2 flex-wrap items-start">
                        <select value={logType} onChange={e => setLogType(e.target.value as typeof logType)}
                          className="px-2 py-1.5 rounded-lg text-xs outline-none" style={inputStyle()}>
                          {TOUCHPOINT_TYPES.map(t => <option key={t} value={t}>{t[0].toUpperCase() + t.slice(1)}</option>)}
                        </select>
                        <input type="date" value={logDate} onChange={e => setLogDate(e.target.value)}
                          className="px-2 py-1.5 rounded-lg text-xs outline-none" style={inputStyle()} />
                        <input type="text" value={logCsm} onChange={e => setLogCsm(e.target.value)} placeholder="CSM name"
                          className="px-2 py-1.5 rounded-lg text-xs outline-none w-32" style={inputStyle()} />
                        <textarea value={logSummary} onChange={e => setLogSummary(e.target.value)} placeholder="What was discussed..."
                          className="px-2 py-1.5 rounded-lg text-xs outline-none flex-1 min-w-[200px]" style={{ ...inputStyle(), minHeight: 34 }} rows={1} />
                        <button
                          onClick={() => submitTouchpoint(row.client_id)}
                          disabled={saving}
                          className="px-3 py-1.5 rounded-lg text-xs font-semibold"
                          style={{ background: "rgba(0,0,0,0.12)", color: "#4a4a4a", border: "1px solid rgba(0,0,0,0.21)", opacity: saving ? 0.6 : 1 }}
                        >
                          {saving ? "Saving…" : "Log"}
                        </button>
                      </div>
                    </div>

                    {/* Review + Upsell status */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="rounded-lg p-3" style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.081)" }}>
                        <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "#6b6b6b" }}>Review Status</p>
                        <label className="flex items-center gap-2 text-xs mb-2" style={{ color: "#333333" }}>
                          <input type="checkbox" checked={row.left_review}
                            onChange={e => updateStatus(row, { left_review: e.target.checked, review_date: e.target.checked ? (row.review_date ?? new Date().toISOString().slice(0, 10)) : row.review_date })} />
                          Left a review
                        </label>
                        <div className="flex gap-2 flex-wrap">
                          <input type="text" defaultValue={row.review_platform ?? ""} placeholder="Platform (Google, Yelp...)"
                            onBlur={e => updateStatus(row, { review_platform: e.target.value || null })}
                            className="px-2 py-1 rounded text-xs outline-none w-36" style={inputStyle()} />
                          <input type="text" defaultValue={row.review_link ?? ""} placeholder="Review link"
                            onBlur={e => updateStatus(row, { review_link: e.target.value || null })}
                            className="px-2 py-1 rounded text-xs outline-none flex-1" style={inputStyle()} />
                        </div>
                      </div>

                      <div className="rounded-lg p-3" style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.081)" }}>
                        <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "#6b6b6b" }}>Upsell Status</p>
                        <select value={row.upsell_status} onChange={e => updateStatus(row, { upsell_status: e.target.value as ClientCSMRow["upsell_status"], upsell_date: new Date().toISOString().slice(0, 10) })}
                          className="px-2 py-1.5 rounded-lg text-xs outline-none mb-2" style={inputStyle()}>
                          {(Object.keys(UPSELL_LABELS) as ClientCSMRow["upsell_status"][]).map(k => (
                            <option key={k} value={k}>{UPSELL_LABELS[k]}</option>
                          ))}
                        </select>
                        <input type="text" defaultValue={row.upsell_notes ?? ""} placeholder="Notes (what was offered, amount...)"
                          onBlur={e => updateStatus(row, { upsell_notes: e.target.value || null })}
                          className="px-2 py-1 rounded text-xs outline-none w-full" style={inputStyle()} />
                      </div>
                    </div>

                    {/* Cadence + CSM assignment */}
                    <div className="flex items-center gap-4 flex-wrap text-xs" style={{ color: "#4a4a4a" }}>
                      <label className="flex items-center gap-2">
                        Contact cadence:
                        <input type="number" min={1} defaultValue={row.cadence_days}
                          onBlur={e => updateStatus(row, { cadence_days: Math.max(1, parseInt(e.target.value) || 14) })}
                          className="px-2 py-1 rounded text-xs outline-none w-16" style={inputStyle()} /> days
                      </label>
                      <label className="flex items-center gap-2">
                        Assigned CSM:
                        <input type="text" defaultValue={row.csm_name ?? ""}
                          onBlur={e => updateStatus(row, { csm_name: e.target.value || null })}
                          className="px-2 py-1 rounded text-xs outline-none w-32" style={inputStyle()} />
                      </label>
                    </div>

                    {/* Touchpoint history */}
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: "#6b6b6b" }}>
                        Conversation History {tpLoading ? "…" : `(${touchpoints.length})`}
                        {!tpLoading && touchpoints.some(t => t.recording_url) && (
                          <span className="ml-2 font-normal normal-case" style={{ color: "#767676" }}>
                            {touchpoints.filter(t => t.recording_url).length} recorded
                          </span>
                        )}
                      </p>
                      {touchpoints.length === 0 && !tpLoading ? (
                        <p className="text-xs" style={{ color: "#767676" }}>No touchpoints logged yet.</p>
                      ) : (
                        <div className="space-y-1.5 max-h-64 overflow-y-auto">
                          {touchpoints.map(tp => {
                            const isB2B = tp.source === "b2b";
                            const dur = mmss(tp.duration_seconds);
                            return (
                              <div key={tp.id} className="px-3 py-2 rounded-lg text-xs" style={{ background: "rgba(0,0,0,0.027)" }}>
                                <div className="flex items-start gap-3">
                                  <span className="px-1.5 py-0.5 rounded flex-shrink-0"
                                    style={isB2B
                                      ? { background: "rgba(0,0,0,0.075)", color: "#6b6b6b" }
                                      : { background: "rgba(0,0,0,0.09)", color: "#4a4a4a" }}>{tp.type}</span>
                                  <span className="flex-shrink-0" style={{ color: "#6b6b6b" }}>{fmtDateTime(tp.occurred_at)}</span>
                                  {tp.csm_name && <span className="flex-shrink-0" style={{ color: "#767676" }}>· {tp.csm_name}</span>}
                                  {tp.agent_name && !tp.csm_name && <span className="flex-shrink-0" style={{ color: "#767676" }}>· {tp.agent_name}</span>}
                                  {dur && <span className="flex-shrink-0" style={{ color: "#767676" }}>· {dur}</span>}
                                  <span className="flex-1" style={{ color: "#333333" }}>{tp.summary ?? "—"}</span>
                                </div>
                                {tp.recording_url && (
                                  <audio controls preload="none" src={tp.recording_url}
                                    className="mt-1.5" style={{ height: 30, width: "100%", maxWidth: 340 }} />
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
