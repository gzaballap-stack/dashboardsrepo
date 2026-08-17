"use client";

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import dynamic from "next/dynamic";
import type { Pin, ZipPerfCircle } from "@/components/ZipMap";
import { scorePerformanceZips } from "@/lib/zip-score";

const ZipMap = dynamic(() => import("@/components/ZipMap"), { ssr: false });

const PIN_COLORS = ["#3b82f6", "#10b981", "#f59e0b", "#ec4899", "#8b5cf6", "#06b6d4", "#f97316", "#84cc16"];
const SESSION_KEY = "zip-tool-sessions";
const ACTIVE_KEY  = "zip-tool-session";

type SavedPin = Pick<Pin, "id" | "lat" | "lng" | "label" | "radius" | "type" | "color">;

// Unattached, local-only session — prospecting/sales-call territory work that
// isn't (yet) tied to a real client. Lives in localStorage only.
type Session = {
  id: string;
  name: string;
  savedAt: string;
  pinCounter: number;
  pins: SavedPin[];
};

// A session attached to a client — a real database record (client_sessions
// table) shared across the team, not just this browser.
type ClientSession = {
  id: string;
  client_id: string;
  name: string;
  pins: SavedPin[];
  pin_counter: number;
  updated_at: string;
};

type Platform = {
  name: string; color: string; jobs: number; share_pct: number;
  description: string; source: string;
};

type Client = { id: string; name: string; is_live: boolean };
type ZipPerfRow = {
  zip_code: string; leads: number; appointments: number;
  shows: number; closes: number; revenue: number; notes?: string;
};

type ZipData = {
  zip: string;
  median_income: number;
  home_value: number;
  owner_pct: number;
  owner_units: number;
  population: number;
  median_year: number | null;
  prime_age_pct?: number;
  recent_mover_pct?: number;
  long_term_pct?: number;
  mortgage_pct?: number;
  appreciation_5yr?: number | null;
  score: number;
  grade: "A" | "B" | "C" | "D";
  score_breakdown: {
    income: number; owner_occ: number; home_value: number; home_age: number;
    prime_age?: number; turnover?: number; equity?: number;
    long_term?: number; mortgage?: number;
  };
  job_volume: {
    total_est: number; digital_est: number; digital_rate_pct: number;
    market_density: number; platforms: Platform[];
  };
  roi?: { avg_ticket: number; close_rate: number; total_addressable_revenue: number };
};

function fmt$(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `$${Math.round(n / 1000).toLocaleString()}k`;
  return `$${n}`;
}

function gradeColor(grade: string) {
  return grade === "A" ? "#10b981" : grade === "B" ? "#3b82f6" : grade === "C" ? "#f59e0b" : "#ef4444";
}

function chipStyle(grade: "A" | "B" | "C" | "D" | undefined, selected: boolean, excluded = false) {
  if (excluded) return {
    fontSize: 11, fontWeight: 600, padding: "3px 7px", borderRadius: 5, cursor: "pointer",
    fontFamily: "monospace" as const, transition: "all 0.1s",
    background: "rgba(239,68,68,0.12)", color: "#f87171",
    border: "1px solid rgba(239,68,68,0.25)", textDecoration: "line-through" as const,
  };
  const gc = grade ? gradeColor(grade) : "#475569";
  return {
    fontSize: 11, fontWeight: 600, padding: "3px 7px", borderRadius: 5, cursor: "pointer",
    fontFamily: "monospace" as const, transition: "all 0.1s",
    background: selected ? `${gc}33` : grade ? `${gc}14` : "rgba(255,255,255,0.05)",
    color: selected ? gc : grade ? gc : "#94a3b8",
    border: `1px solid ${selected ? gc + "66" : grade ? gc + "30" : "transparent"}`,
  };
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ marginBottom: 5 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 2 }}>
        <span style={{ fontSize: 10, color: "#475569" }}>{label}</span>
        <span style={{ fontSize: 10, fontWeight: 700, color: "#64748b" }}>{value}</span>
      </div>
      <div style={{ height: 3, borderRadius: 2, background: "rgba(255,255,255,0.06)" }}>
        <div style={{ height: "100%", borderRadius: 2, width: `${value}%`, background: "rgba(245,158,11,0.45)", transition: "width 0.4s ease" }} />
      </div>
    </div>
  );
}

function ZipDataPanel({ data, loading, zip, onClose, clientName, perfData, onSavePerf }: {
  data: ZipData | null; loading: boolean; zip: string; onClose: () => void;
  clientName?: string; perfData?: ZipPerfRow | null; onSavePerf?: (updates: Partial<ZipPerfRow>) => void;
}) {
  const [expandedPlatform, setExpandedPlatform] = useState<string | null>(null);
  const [showPlatforms, setShowPlatforms] = useState(false);
  const [activeTab, setActiveTab] = useState<"census" | "performance">("census");
  const [perfForm, setPerfForm] = useState<Partial<ZipPerfRow>>({});
  const gc = data ? gradeColor(data.grade) : "#64748b";

  // Reset form when perfData changes
  useEffect(() => {
    setPerfForm(perfData ?? {});
  }, [perfData, zip]);

  return (
    <div style={{
      position: "absolute", top: 12, right: 12, width: 268, maxHeight: "calc(100% - 24px)",
      zIndex: 1000, display: "flex", flexDirection: "column",
      background: "#0a1628", border: "1px solid rgba(255,255,255,0.1)",
      borderRadius: 12, overflow: "hidden", boxShadow: "0 20px 60px rgba(0,0,0,0.7)",
    }}>
      <div style={{ padding: "12px 14px", borderBottom: "1px solid rgba(255,255,255,0.07)", display: "flex", justifyContent: "space-between", alignItems: "center", flexShrink: 0 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: "#e2e8f0", fontFamily: "monospace" }}>ZIP {zip}</span>
        <button onClick={onClose} style={{ background: "none", border: "none", color: "#475569", cursor: "pointer", fontSize: 18, lineHeight: 1, padding: 0 }}>×</button>
      </div>

      {/* Tab bar — only shown when a client is connected */}
      {clientName && (
        <div style={{ display: "flex", borderBottom: "1px solid rgba(255,255,255,0.07)", flexShrink: 0 }}>
          {(["census", "performance"] as const).map(tab => (
            <button key={tab} onClick={() => setActiveTab(tab)} style={{
              flex: 1, padding: "7px 0", border: "none", cursor: "pointer", fontSize: 10, fontWeight: 700,
              textTransform: "uppercase", letterSpacing: "0.06em",
              background: activeTab === tab ? "rgba(245,158,11,0.1)" : "transparent",
              color: activeTab === tab ? "#f59e0b" : "#475569",
              borderBottom: activeTab === tab ? "2px solid #f59e0b" : "2px solid transparent",
            }}>{tab}</button>
          ))}
        </div>
      )}

      <div style={{ overflowY: "auto", flex: 1 }}>
        {loading && <div style={{ padding: 24, textAlign: "center", color: "#334155", fontSize: 12 }}>Loading data…</div>}
        {!loading && !data && activeTab !== "performance" && <div style={{ padding: 20, textAlign: "center", color: "#334155", fontSize: 12 }}>No Census data for this zip.</div>}

        {/* Performance tab */}
        {!loading && activeTab === "performance" && clientName && (
          <div style={{ padding: "12px 14px" }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: "#334155", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 10 }}>
              {clientName} · ZIP {zip}
            </div>
            {(["leads", "appointments", "shows", "closes"] as const).map(field => (
              <div key={field} style={{ marginBottom: 8 }}>
                <div style={{ fontSize: 10, color: "#475569", marginBottom: 3, textTransform: "capitalize" }}>{field}</div>
                <input
                  type="number"
                  min={0}
                  value={perfForm[field] ?? 0}
                  onChange={e => setPerfForm(prev => ({ ...prev, [field]: parseInt(e.target.value) || 0 }))}
                  style={{
                    width: "100%", padding: "6px 9px", borderRadius: 6, fontSize: 12, fontFamily: "monospace",
                    background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
                    color: "#e2e8f0", outline: "none", boxSizing: "border-box",
                  }}
                />
              </div>
            ))}
            <div style={{ marginBottom: 10 }}>
              <div style={{ fontSize: 10, color: "#475569", marginBottom: 3 }}>Revenue ($)</div>
              <input
                type="number"
                min={0}
                step={100}
                value={perfForm.revenue ?? 0}
                onChange={e => setPerfForm(prev => ({ ...prev, revenue: parseFloat(e.target.value) || 0 }))}
                style={{
                  width: "100%", padding: "6px 9px", borderRadius: 6, fontSize: 12, fontFamily: "monospace",
                  background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
                  color: "#e2e8f0", outline: "none", boxSizing: "border-box",
                }}
              />
            </div>
            <button
              onClick={() => onSavePerf && onSavePerf(perfForm)}
              style={{
                width: "100%", padding: "8px 0", borderRadius: 7, border: "none", cursor: "pointer",
                background: "#1d4ed8", color: "#fff", fontSize: 11, fontWeight: 700,
              }}>Save</button>
          </div>
        )}

        {/* Census tab (default) */}
        {!loading && data && (activeTab === "census" || !clientName) && (<>
          <div style={{ padding: "14px 14px 10px", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: "#334155", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>Lead Quality Score</div>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
              <div style={{ flex: 1, height: 10, borderRadius: 5, background: "rgba(255,255,255,0.06)", overflow: "hidden" }}>
                <div style={{ height: "100%", width: `${data.score}%`, background: gc, borderRadius: 5, transition: "width 0.5s ease" }} />
              </div>
              <span style={{ fontSize: 18, fontWeight: 800, color: "#f1f5f9" }}>{data.score}</span>
              <span style={{ fontSize: 13, fontWeight: 800, color: gc, padding: "2px 7px", borderRadius: 5, background: `${gc}22`, border: `1px solid ${gc}44` }}>{data.grade}</span>
            </div>
            <ScoreBar label="Income"          value={data.score_breakdown.income} />
            <ScoreBar label="Owner Occupancy" value={data.score_breakdown.owner_occ} />
            <ScoreBar label="Home Value"      value={data.score_breakdown.home_value} />
            <ScoreBar label="Home Age"        value={data.score_breakdown.home_age} />
            {data.score_breakdown.prime_age  != null && <ScoreBar label="Prime Age (45-64)"    value={data.score_breakdown.prime_age} />}
            {data.score_breakdown.turnover   != null && <ScoreBar label="Recent Movers"        value={data.score_breakdown.turnover} />}
            {data.score_breakdown.equity     != null && <ScoreBar label="Home Equity"           value={data.score_breakdown.equity} />}
            {data.score_breakdown.long_term  != null && <ScoreBar label="Long-term Residents"  value={data.score_breakdown.long_term} />}
            {data.score_breakdown.mortgage   != null && <ScoreBar label="Mortgage Penetration" value={data.score_breakdown.mortgage} />}
          </div>
          <div style={{ padding: "10px 14px", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
            {[
              { label: "Avg. Household Income", value: fmt$(data.median_income) },
              { label: "Median Home Value",      value: fmt$(data.home_value) },
              { label: "Owner-Occupied",         value: `${data.owner_pct.toFixed(1)}%  (${data.owner_units.toLocaleString()})` },
              { label: "Avg. Home Year Built",   value: data.median_year ? `${data.median_year}` : "N/A" },
              ...(data.prime_age_pct    != null ? [{ label: "Ages 45–64",              value: `${Math.round(data.prime_age_pct * 100)}%` }] : []),
              ...(data.recent_mover_pct != null ? [{ label: "Recent Movers (Owner)",   value: `${Math.round(data.recent_mover_pct * 100)}%` }] : []),
              ...(data.long_term_pct   != null ? [{ label: "Long-term Residents (10+ yr)", value: `${Math.round(data.long_term_pct * 100)}%` }] : []),
              ...(data.mortgage_pct    != null && data.mortgage_pct > 0 ? [{ label: "Est. Mortgaged",       value: `~${Math.round(data.mortgage_pct * 100)}%` }] : []),
              ...(data.appreciation_5yr != null ? [{ label: "5-yr Appreciation",       value: `${data.appreciation_5yr >= 0 ? "+" : ""}${Math.round(data.appreciation_5yr * 100)}%` }] : []),
            ].map(row => (
              <div key={row.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 5 }}>
                <span style={{ fontSize: 10, color: "#475569" }}>{row.label}</span>
                <span style={{ fontSize: 11, fontWeight: 700, color: "#e2e8f0", textAlign: "right" }}>{row.value}</span>
              </div>
            ))}
          </div>
          <div style={{ padding: "10px 14px", borderBottom: "1px solid rgba(255,255,255,0.07)" }}>
            <div style={{ fontSize: 9, fontWeight: 700, color: "#334155", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>K&B Job Volume / Year</div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <span style={{ fontSize: 10, color: "#475569" }}>Total estimate</span>
              <span style={{ fontSize: 12, fontWeight: 800, color: "#f59e0b" }}>{data.job_volume.total_est.toLocaleString()}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <span style={{ fontSize: 10, color: "#475569" }}>Via digital platforms ({data.job_volume.digital_rate_pct}%)</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: "#e2e8f0" }}>{data.job_volume.digital_est.toLocaleString()}</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
              <span style={{ fontSize: 10, color: "#475569" }}>Market density</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: "#e2e8f0" }}>{data.job_volume.market_density} / 1k residents</span>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 10 }}>
              <span style={{ fontSize: 10, color: "#475569" }}>Total residents</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: "#e2e8f0" }}>{data.population.toLocaleString()}</span>
            </div>
            <button onClick={() => setShowPlatforms(p => !p)} style={{
              width: "100%", padding: "7px 10px", borderRadius: 7, border: "1px solid rgba(255,255,255,0.08)",
              background: showPlatforms ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.03)",
              color: "#64748b", cursor: "pointer", display: "flex", justifyContent: "space-between",
              alignItems: "center", fontSize: 11, fontWeight: 600,
            }}>
              <span>Platform Breakdown</span>
              <svg style={{ width: 12, height: 12, transform: showPlatforms ? "rotate(90deg)" : "rotate(0)", transition: "transform 0.2s" }}
                fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </button>
            {showPlatforms && (
              <div style={{ marginTop: 8 }}>
                {data.job_volume.platforms.map(p => (
                  <div key={p.name} style={{ marginBottom: 6 }}>
                    <div onClick={() => setExpandedPlatform(expandedPlatform === p.name ? null : p.name)}
                      style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 8px", borderRadius: 7, cursor: "pointer", background: expandedPlatform === p.name ? "rgba(255,255,255,0.06)" : "transparent", border: "1px solid rgba(255,255,255,0.05)" }}>
                      <div style={{ width: 8, height: 8, borderRadius: "50%", background: p.color, flexShrink: 0 }} />
                      <span style={{ flex: 1, fontSize: 10, fontWeight: 600, color: "#94a3b8" }}>{p.name}</span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: "#e2e8f0" }}>{p.jobs.toLocaleString()}</span>
                      <span style={{ fontSize: 9, color: "#334155" }}>{p.share_pct}%</span>
                    </div>
                    <div style={{ height: 3, borderRadius: 2, background: "rgba(255,255,255,0.04)", margin: "2px 8px 0", overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${p.share_pct * 2.5}%`, background: p.color, opacity: 0.7, borderRadius: 2 }} />
                    </div>
                    {expandedPlatform === p.name && (
                      <div style={{ margin: "6px 8px 4px", padding: "8px 10px", borderRadius: 6, background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.06)" }}>
                        <p style={{ fontSize: 10, color: "#475569", lineHeight: 1.6, margin: "0 0 4px" }}>{p.description}</p>
                        <p style={{ fontSize: 9, color: "#1e3a5f", margin: 0, fontStyle: "italic" }}>Source: {p.source}</p>
                      </div>
                    )}
                  </div>
                ))}
                <p style={{ fontSize: 9, color: "#1e3a5f", lineHeight: 1.5, margin: "8px 0 0", padding: "0 4px" }}>
                  Census base × Harvard JCHS 13% renovation rate, income + age adjusted. Platform shares estimated from public reports.
                </p>
              </div>
            )}
          </div>

          {/* ROI Projector */}
          {data.roi && (
            <div style={{ padding: "10px 14px" }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: "#334155", letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>ROI Projector</div>
              {[
                { label: "Avg project ticket",        value: fmt$(data.roi.avg_ticket) },
                { label: "Close rate",                value: `${Math.round(data.roi.close_rate * 100)}%` },
                { label: "Total addressable revenue", value: fmt$(data.roi.total_addressable_revenue) },
              ].map(row => (
                <div key={row.label} style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 5 }}>
                  <span style={{ fontSize: 10, color: "#475569" }}>{row.label}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: row.label.includes("revenue") ? "#f59e0b" : "#e2e8f0", textAlign: "right" }}>{row.value}</span>
                </div>
              ))}
              <p style={{ fontSize: 9, color: "#1e3a5f", margin: "6px 0 0", lineHeight: 1.5 }}>
                Market opportunity estimate based on owner-occupied units × 18% contractor close rate.
              </p>
            </div>
          )}
        </>)}
      </div>
    </div>
  );
}

export default function ZipTool() {
  const [pins,           setPins]           = useState<Pin[]>([]);
  const [selectedId,     setSelectedId]     = useState<string | null>(null);
  const [radius,         setRadius]         = useState(50);
  const [pinMode,        setPinMode]        = useState<"include" | "exclude">("include");
  const [copied,         setCopied]         = useState(false);
  const [manualExcludes, setManualExcludes] = useState<Set<string>>(new Set());

  const [selectedZip, setSelectedZip] = useState<string | null>(null);
  const [zipData,     setZipData]     = useState<ZipData | null>(null);
  const [zipLoading,  setZipLoading]  = useState(false);

  // Sessions — local (unattached) + client (server-backed) sessions
  const [sessions,          setSessions]          = useState<Session[]>([]);
  const [clientSessions,    setClientSessions]    = useState<ClientSession[]>([]);
  const [showSessions,      setShowSessions]      = useState(false);
  const [showClients,       setShowClients]       = useState(false);
  const [savingSession,     setSavingSession]     = useState(false);
  const [newSessionName,    setNewSessionName]    = useState("");
  const [saveTargetClientId, setSaveTargetClientId] = useState("");
  const [activeSession,     setActiveSession]     = useState<string | null>(null);
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null);
  const [expandedClientId,  setExpandedClientId]  = useState<string | null>(null);
  const sessionsRef       = useRef<Session[]>([]);
  const clientSessionsRef = useRef<ClientSession[]>([]);
  useEffect(() => { sessionsRef.current = sessions; }, [sessions]);
  useEffect(() => { clientSessionsRef.current = clientSessions; }, [clientSessions]);

  // Client connection
  const [clients,         setClients]         = useState<Client[]>([]);
  const [connectedClient, setConnectedClient] = useState<Client | null>(null);
  const [clientPerf,      setClientPerf]      = useState<Record<string, ZipPerfRow>>({});

  const [searchInput,  setSearchInput]  = useState("");
  const [searchError,  setSearchError]  = useState<string | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);

  const [addZipInput,   setAddZipInput]   = useState("");
  const [addZipError,   setAddZipError]   = useState<string | null>(null);
  const [addZipLoading, setAddZipLoading] = useState(false);

  const abortRefs       = useRef<Map<string, AbortController>>(new Map());
  const zipAbortRef     = useRef<AbortController | null>(null);
  const pinCounterRef   = useRef(0);
  const activeSessionRef = useRef<string | null>(null);
  const [mapFlyTrigger, setMapFlyTrigger] = useState(0);
  const sessionLoadingRef = useRef(false);

  // Restore pins + sessions on mount
  useEffect(() => {
    let savedActiveSessionId: string | null = null;

    try {
      const raw = localStorage.getItem(ACTIVE_KEY);
      if (raw) {
        const data = JSON.parse(raw);
        savedActiveSessionId = data.activeSessionId ?? null;
        if (savedActiveSessionId) {
          setActiveSession(savedActiveSessionId);
          activeSessionRef.current = savedActiveSessionId;
        }
        const skeletons: SavedPin[] = (data.pins ?? []).filter((p: SavedPin) => p.type !== "exclude");
        const maxNum = skeletons.reduce((mx, p) => {
          const m = p.label.match(/(\d+)$/);
          return m ? Math.max(mx, parseInt(m[1])) : mx;
        }, 0);
        pinCounterRef.current = maxNum;
        const restoredPins: Pin[] = skeletons.map(sp => ({ ...sp, zips: [], features: [], loading: true, scores: undefined }));
        setPins(restoredPins);
        for (const sp of skeletons) {
          const ctrl = new AbortController();
          abortRefs.current.set(sp.id, ctrl);
          fetch(`/api/zip-radius?lat=${sp.lat}&lng=${sp.lng}&radius=${sp.radius}`, { signal: ctrl.signal })
            .then(r => r.json())
            .then(d => {
              setPins(prev => prev.map(p =>
                p.id === sp.id
                  ? { ...p, zips: d.zips ?? [], features: d.features ?? [], loading: false, scores: d.scores ?? {} }
                  : p
              ));
            })
            .catch(e => {
              if (e?.name !== "AbortError") {
                setPins(prev => prev.map(p => p.id === sp.id ? { ...p, loading: false } : p));
              }
            });
        }
      }
    } catch {}

    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (raw) {
        const loadedSessions: Session[] = JSON.parse(raw);
        setSessions(loadedSessions);
      }
    } catch {}

    Promise.all([
      fetch('/api/clients').then(r => r.json()),
      fetch('/api/client-sessions').then(r => r.json()),
    ]).then(([clientsData, sessionsData]) => {
      const allClients: Client[] = clientsData.clients ?? [];
      const allClientSessions: ClientSession[] = sessionsData.sessions ?? [];
      setClients(allClients);
      setClientSessions(allClientSessions);
      if (savedActiveSessionId) {
        const cs = allClientSessions.find(s => s.id === savedActiveSessionId);
        if (cs) {
          setConnectedClient(allClients.find(c => c.id === cs.client_id) ?? null);
          // If the server record has pins, always use it as the authoritative
          // source. localStorage can go stale because the persist effect writes
          // empty state on the very first render before mount-effect updates land.
          // Only override when the server actually has pins (don't wipe pins that
          // are in localStorage but not yet synced to the server).
          if (cs.pins.length > 0) {
            applySessionPins(cs.id, cs.pins, cs.pin_counter);
          }
        }
      }
    }).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist active pins + active session ID on change
  useEffect(() => {
    try {
      localStorage.setItem(ACTIVE_KEY, JSON.stringify({
        pins: pins.map(({ id, lat, lng, label, radius, type, color }) => ({ id, lat, lng, label, radius, type, color })),
        activeSessionId: activeSession,
      }));
    } catch {}
  }, [pins, activeSession]);

  // Persist sessions list
  useEffect(() => {
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(sessions)); } catch {}
  }, [sessions]);

  // Keep activeSessionRef in sync (must be defined before auto-save effect)
  useEffect(() => { activeSessionRef.current = activeSession; }, [activeSession]);

  // Auto-save pin changes back to the active session — local sessions persist to
  // localStorage, client sessions PATCH the server. Uses refs (not [sessions]/
  // [clientSessions] in the dep array) so this can't loop: those setters always
  // return a new array reference, which would re-trigger the effect forever.
  useEffect(() => {
    const sid = activeSessionRef.current;
    if (!sid || pins.some(p => p.loading)) return;
    const payload = pinsPayload(pins);

    if (sessionsRef.current.some(s => s.id === sid)) {
      setSessions(prev => {
        const next = prev.map(s => s.id !== sid ? s : { ...s, pins: payload, pinCounter: pinCounterRef.current });
        persistSessions(next);
        return next;
      });
    } else if (clientSessionsRef.current.some(cs => cs.id === sid)) {
      setClientSessions(prev => prev.map(cs => cs.id !== sid ? cs : { ...cs, pins: payload, pin_counter: pinCounterRef.current }));
      fetch(`/api/client-sessions/${sid}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pins: payload, pin_counter: pinCounterRef.current }),
      }).catch(() => {});
    }
  }, [pins]);

  // Fly to all pins when a session finishes loading
  useEffect(() => {
    if (!sessionLoadingRef.current || pins.length === 0) return;
    if (pins.some(p => p.loading)) return;
    sessionLoadingRef.current = false;
    setMapFlyTrigger(k => k + 1);
  }, [pins]);

  // Load perf data when connected client changes
  useEffect(() => {
    if (!connectedClient) { setClientPerf({}); return; }
    fetch(`/api/zip-performance?client_id=${connectedClient.id}`)
      .then(r => r.json())
      .then(d => {
        const map: Record<string, ZipPerfRow> = {};
        for (const row of (d.performance ?? [])) map[row.zip_code] = row;
        setClientPerf(map);
      })
      .catch(() => {});
  }, [connectedClient]);

  // Composite performance score per zip (leads/appointments/shows/closes/revenue),
  // drawn as a circle overlay on the map sized by how each zip is performing.
  const perfCircles = useMemo<Record<string, ZipPerfCircle> | undefined>(() => {
    if (!connectedClient) return undefined;
    const rows = Object.fromEntries(
      Object.entries(clientPerf).map(([zip, p]) => [zip, {
        leads: p.leads, appointments: p.appointments, shows: p.shows, closes: p.closes, revenue: p.revenue,
      }])
    );
    const scores = scorePerformanceZips(rows);
    const circles: Record<string, ZipPerfCircle> = {};
    for (const [zip, p] of Object.entries(clientPerf)) {
      circles[zip] = { score: scores[zip] ?? 0, leads: p.leads, appointments: p.appointments, shows: p.shows, closes: p.closes, revenue: p.revenue };
    }
    return circles;
  }, [connectedClient, clientPerf]);

  // Writes straight to localStorage synchronously with the state update, rather than
  // waiting for the [sessions] effect to flush — so a save (or delete) that's immediately
  // followed by a page refresh can't race the deferred effect and get lost.
  const persistSessions = (list: Session[]) => {
    try { localStorage.setItem(SESSION_KEY, JSON.stringify(list)); } catch {}
  };

  const pinsPayload = (list: Pin[]) =>
    list.map(({ id, lat, lng, label, radius, type, color }) => ({ id, lat, lng, label, radius, type, color }));

  const saveSession = async () => {
    if (!newSessionName.trim() || !pins.length) return;
    const name = newSessionName.trim();

    if (saveTargetClientId) {
      const client = clients.find(c => c.id === saveTargetClientId);
      try {
        const r = await fetch('/api/client-sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ client_id: saveTargetClientId, name, pins: pinsPayload(pins), pin_counter: pinCounterRef.current }),
        });
        const d = await r.json();
        if (d.session) {
          setClientSessions(prev => [d.session, ...prev]);
          setActiveSession(d.session.id);
          setConnectedClient(client ?? null);
        }
      } catch {}
    } else {
      const session: Session = {
        id: `sess-${Date.now()}`,
        name,
        savedAt: new Date().toISOString(),
        pinCounter: pinCounterRef.current,
        pins: pinsPayload(pins),
      };
      setSessions(prev => {
        const next = [session, ...prev];
        persistSessions(next);
        return next;
      });
      setActiveSession(session.id);
    }

    setNewSessionName("");
    setSaveTargetClientId("");
    setSavingSession(false);
  };

  // Shared by loadSession/loadClientSession — restores pins (marked loading) onto
  // the map for the given saved session and re-fetches each pin's zip radius data.
  const applySessionPins = (sessionId: string, savedPins: SavedPin[], pinCounter: number) => {
    for (const ctrl of abortRefs.current.values()) ctrl.abort();
    abortRefs.current.clear();
    setActiveSession(sessionId);
    if (savedPins.length > 0) sessionLoadingRef.current = true;

    const restoredPins: Pin[] = savedPins.map(sp => ({
      ...sp, zips: [], features: [], loading: true, scores: undefined,
    }));
    setPins(restoredPins);
    pinCounterRef.current = pinCounter;
    setSelectedId(null);

    for (const sp of savedPins) {
      const ctrl = new AbortController();
      abortRefs.current.set(sp.id, ctrl);
      fetch(`/api/zip-radius?lat=${sp.lat}&lng=${sp.lng}&radius=${sp.radius}`, { signal: ctrl.signal })
        .then(r => r.json())
        .then(data => {
          setPins(prev => prev.map(p =>
            p.id === sp.id
              ? { ...p, zips: data.zips ?? [], features: data.features ?? [], loading: false, scores: data.scores ?? {} }
              : p
          ));
        })
        .catch(e => {
          if (e?.name !== "AbortError") {
            setPins(prev => prev.map(p => p.id === sp.id ? { ...p, loading: false } : p));
          }
        });
    }
  };

  const loadSession = (session: Session) => {
    setConnectedClient(null);
    applySessionPins(session.id, session.pins, session.pinCounter);
  };

  const loadClientSession = (cs: ClientSession) => {
    setConnectedClient(clients.find(c => c.id === cs.client_id) ?? null);
    applySessionPins(cs.id, cs.pins, cs.pin_counter);
  };

  // Unmarks the active session (local or client) and clears its pins off the map —
  // without deleting the saved session record itself, just unloading it.
  const deselectSession = () => {
    for (const ctrl of abortRefs.current.values()) ctrl.abort();
    abortRefs.current.clear();
    setPins([]);
    setManualExcludes(new Set());
    setSelectedId(null);
    pinCounterRef.current = 0;
    setActiveSession(null);
    setConnectedClient(null);
    try { localStorage.removeItem(ACTIVE_KEY); } catch {}
  };

  const deleteSession = (id: string) => {
    setSessions(prev => {
      const next = prev.filter(s => s.id !== id);
      persistSessions(next);
      return next;
    });
    if (activeSession === id) setActiveSession(null);
  };

  const deleteClientSession = async (cs: ClientSession) => {
    setClientSessions(prev => prev.filter(s => s.id !== cs.id));
    if (activeSession === cs.id) setActiveSession(null);
    try { await fetch(`/api/client-sessions/${cs.id}`, { method: 'DELETE' }); } catch {}
  };

  // Promotes a local, unattached session to a client — creates the server record
  // and removes it from the local (localStorage-only) list.
  const promoteSession = async (session: Session, clientId: string) => {
    const client = clients.find(c => c.id === clientId);
    if (!client) return;
    try {
      const r = await fetch('/api/client-sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ client_id: clientId, name: session.name, pins: session.pins, pin_counter: session.pinCounter }),
      });
      const d = await r.json();
      if (!d.session) return;
      setClientSessions(prev => [d.session, ...prev]);
      setSessions(prev => {
        const next = prev.filter(s => s.id !== session.id);
        persistSessions(next);
        return next;
      });
      if (activeSession === session.id) {
        setActiveSession(d.session.id);
        setConnectedClient(client);
      }
    } catch {}
  };

  const zipScores = useMemo(() => {
    const map: Record<string, { score: number; grade: "A" | "B" | "C" | "D" }> = {};
    for (const pin of pins) {
      if (pin.scores) Object.assign(map, pin.scores);
    }
    return map;
  }, [pins]);

  const handleZipClick = useCallback(async (zip: string) => {
    setSelectedZip(zip);
    setZipData(null);
    setZipLoading(true);
    zipAbortRef.current?.abort();
    const ctrl = new AbortController();
    zipAbortRef.current = ctrl;
    try {
      const r = await fetch(`/api/zip-data?zip=${zip}`, { signal: ctrl.signal });
      const data = await r.json();
      if (!ctrl.signal.aborted) setZipData(r.ok ? data : null);
    } catch (e: any) {
      if (e?.name !== "AbortError") setZipData(null);
    } finally {
      if (!ctrl.signal.aborted) setZipLoading(false);
    }
  }, []);

  const handleExcludeToggle = useCallback((zip: string) => {
    setManualExcludes(prev => {
      const next = new Set(prev);
      if (next.has(zip)) next.delete(zip); else next.add(zip);
      return next;
    });
  }, []);

  const handleMapClick = useCallback(async (lat: number, lng: number) => {
    pinCounterRef.current++;
    const id    = `pin-${pinCounterRef.current}`;
    const color = PIN_COLORS[(pinCounterRef.current - 1) % PIN_COLORS.length];
    const label = `Pin ${pinCounterRef.current}`;

    const newPin: Pin = { id, lat, lng, label, radius, zips: [], features: [], loading: true, color, type: "include" };
    setPins(prev => [...prev, newPin]);
    setSelectedId(id);

    abortRefs.current.get(id)?.abort();
    const ctrl = new AbortController();
    abortRefs.current.set(id, ctrl);

    try {
      const r = await fetch(`/api/zip-radius?lat=${lat}&lng=${lng}&radius=${radius}`, { signal: ctrl.signal });
      const data = await r.json();
      setPins(prev => prev.map(p =>
        p.id === id
          ? { ...p, zips: data.zips ?? [], features: data.features ?? [], loading: false, scores: data.scores ?? {} }
          : p
      ));
    } catch (e: any) {
      if (e?.name !== "AbortError") setPins(prev => prev.map(p => p.id === id ? { ...p, loading: false } : p));
    }
  }, [radius]);

  const handleDeletePin = useCallback((id: string) => {
    abortRefs.current.get(id)?.abort();
    abortRefs.current.delete(id);
    setPins(prev => {
      const next = prev.filter(p => p.id !== id);
      if (next.length === 0) pinCounterRef.current = 0;
      return next;
    });
    setSelectedId(prev => prev === id ? null : prev);
  }, []);

  const handleZipSearch = useCallback(async (raw: string) => {
    const zip = raw.trim().replace(/\D/g, "").slice(0, 5);
    if (zip.length !== 5) { setSearchError("Enter a 5-digit zip code"); return; }
    setSearchError(null);
    setSearchLoading(true);
    try {
      const params = new URLSearchParams({
        where: `ZCTA5='${zip}'`,
        returnGeometry: "true",
        outFields: "ZCTA5",
        outSR: "4326",
        f: "geojson",
      });
      const r = await fetch(
        `https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Current/MapServer/2/query?${params}`
      );
      const data = await r.json();
      const feat = data.features?.[0];
      if (!feat) { setSearchError(`Zip ${zip} not found`); return; }
      const coords: number[][] = feat.geometry?.type === "Polygon"
        ? feat.geometry.coordinates[0]
        : feat.geometry?.coordinates?.flat(1) ?? [];
      if (!coords.length) { setSearchError("Could not locate zip"); return; }
      const lngs = coords.map((c: number[]) => c[0]);
      const lats = coords.map((c: number[]) => c[1]);
      const lat = (Math.min(...lats) + Math.max(...lats)) / 2;
      const lng = (Math.min(...lngs) + Math.max(...lngs)) / 2;
      setSearchInput("");
      await handleMapClick(lat, lng);
      // Open data panel + trigger fly-to for the searched zip
      handleZipClick(zip);
    } catch {
      setSearchError("Search failed — check your connection");
    } finally {
      setSearchLoading(false);
    }
  }, [handleMapClick, handleZipClick]);

  const handleAddZipToPin = useCallback(async (raw: string, exclude = false) => {
    // Parse multiple zips — split on comma, space, or newline
    const zips = raw.split(/[\s,]+/).map(z => z.replace(/\D/g, "").slice(0, 5)).filter(z => z.length === 5);
    if (!zips.length) { setAddZipError("Enter valid 5-digit zip code(s)"); return; }

    const pin = pins.find(p => p.id === selectedId);
    if (!pin) return;

    if (exclude) {
      // Mark excluded immediately — if the zip is already a chip, this alone shows
      // the strikethrough right away. Zips not yet in the pin still get fetched
      // below so they actually appear as a (struck-through) chip, not nothing.
      setManualExcludes(prev => {
        const next = new Set(prev);
        for (const z of zips) next.add(z);
        return next;
      });
    }

    const newZips = zips.filter(z => !pin.zips.includes(z));
    if (!newZips.length) {
      setAddZipInput("");
      if (!exclude) setAddZipError("All zips already in this pin");
      return;
    }
    setAddZipError(null);
    setAddZipLoading(true);
    try {
      const where = newZips.length === 1 ? `ZCTA5='${newZips[0]}'` : `ZCTA5 IN (${newZips.map(z => `'${z}'`).join(",")})`;
      const params = new URLSearchParams({ where, returnGeometry: "true", outFields: "ZCTA5", outSR: "4326", f: "geojson" });
      const r = await fetch(`https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Current/MapServer/2/query?${params}`);
      const data = await r.json();
      const feats = data.features ?? [];
      if (!feats.length) { setAddZipError("No zips found"); return; }

      const addedZips: string[] = [];
      const newFeatures: object[] = [];
      const newScores: Record<string, { score: number; grade: "A" | "B" | "C" | "D" }> = {};

      for (const feat of feats) {
        const z = feat.properties?.ZCTA5;
        if (!z) continue;
        addedZips.push(z);
        newFeatures.push({ type: "Feature" as const, properties: { zip: z }, geometry: feat.geometry });
      }

      // Fetch scores in parallel
      await Promise.all(addedZips.map(async z => {
        try {
          const sr = await fetch(`/api/zip-data?zip=${z}`);
          if (sr.ok) { const sd = await sr.json(); newScores[z] = { score: sd.score, grade: sd.grade }; }
        } catch {}
      }));

      setPins(prev => prev.map(p => {
        if (p.id !== selectedId) return p;
        return {
          ...p,
          zips: [...p.zips, ...addedZips],
          features: [...p.features, ...newFeatures],
          scores: { ...p.scores, ...newScores },
        };
      }));
      setAddZipInput("");
      if (!exclude && addedZips.length === 1) handleZipClick(addedZips[0]);
    } catch { setAddZipError("Failed — check connection"); }
    finally { setAddZipLoading(false); }
  }, [selectedId, pins, handleZipClick]);

  const clearAll = () => {
    for (const ctrl of abortRefs.current.values()) ctrl.abort();
    abortRefs.current.clear();
    setPins([]);
    setManualExcludes(new Set());
    setSelectedId(null);
    pinCounterRef.current = 0;
    setActiveSession(null);
    try { localStorage.removeItem(ACTIVE_KEY); } catch {}
  };

  const saveZipPerf = useCallback(async (zip: string, updates: Partial<ZipPerfRow>) => {
    if (!connectedClient) return;
    const existing = clientPerf[zip] ?? { zip_code: zip, leads: 0, appointments: 0, shows: 0, closes: 0, revenue: 0 };
    const merged = { ...existing, ...updates };
    const r = await fetch('/api/zip-performance', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: connectedClient.id, ...merged }),
    });
    if (r.ok) {
      const d = await r.json();
      setClientPerf(prev => ({ ...prev, [zip]: d.record }));
    }
  }, [connectedClient, clientPerf]);

  const includeZips = new Set(pins.flatMap(p => p.zips));
  const netZips = Array.from(includeZips).filter(z => !manualExcludes.has(z)).sort();
  const selectedPin = pins.find(p => p.id === selectedId) ?? null;
  // All zips shown in chip list — excluded ones rendered with strikethrough
  const allChipZips = selectedPin ? [...selectedPin.zips].sort() : Array.from(includeZips).sort();
  // Net (non-excluded) zips — used for copy count and copy action
  const displayZips = selectedPin ? [...selectedPin.zips].filter(z => !manualExcludes.has(z)).sort() : netZips;
  const totalLoading = pins.some(p => p.loading);

  const copyZips = () => {
    const toCopy = selectedPin ? displayZips : netZips;
    if (!toCopy.length) return;
    navigator.clipboard.writeText(toCopy.join(",")).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const fmtDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };

  const clientSessionsByClientId = useMemo(() => {
    const map = new Map<string, ClientSession[]>();
    for (const cs of clientSessions) {
      const list = map.get(cs.client_id) ?? [];
      list.push(cs);
      map.set(cs.client_id, list);
    }
    return map;
  }, [clientSessions]);

  const activeLocalSessionLabel  = activeSession ? sessions.find(s => s.id === activeSession)?.name : undefined;
  const activeClientSessionLabel = activeSession ? clientSessions.find(s => s.id === activeSession)?.name : undefined;

  return (
    <div style={{ display: "flex", flex: 1, overflow: "hidden", height: "100%" }}>

      {/* ── Sidebar ── */}
      <div style={{
        width: 288, flexShrink: 0, display: "flex", flexDirection: "column",
        borderRight: "1px solid rgba(255,255,255,0.07)", background: "#0a1628", overflow: "hidden",
      }}>

        {/* ── Clients (server-backed sessions, shared across the team) ── */}
        <div style={{ borderBottom: "1px solid rgba(255,255,255,0.07)", flexShrink: 0 }}>
          <button
            onClick={() => setShowClients(v => !v)}
            style={{
              width: "100%", padding: "9px 14px", background: "none", border: "none",
              cursor: "pointer", display: "flex", alignItems: "center", gap: 8,
              color: "#64748b",
            }}
          >
            <svg style={{ width: 13, height: 13, flexShrink: 0 }} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <span style={{ fontSize: 11, fontWeight: 700, flex: 1, textAlign: "left" }}>
              Clients
            </span>
            {activeClientSessionLabel && (
              <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 4, background: "rgba(245,158,11,0.15)", color: "#f59e0b", fontWeight: 700 }}>
                {activeClientSessionLabel}
              </span>
            )}
            <svg style={{ width: 11, height: 11, transform: showClients ? "rotate(90deg)" : "rotate(0)", transition: "transform 0.2s" }}
              fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>

          {showClients && (
            <div style={{ padding: "0 10px 10px" }}>

              {clientSessionsByClientId.size === 0 && (
                <p style={{ fontSize: 11, color: "#334155", padding: "6px 2px 4px", margin: 0 }}>
                  No client sessions yet. Save one below with a client selected.
                </p>
              )}

              <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6 }}>
                {Array.from(clientSessionsByClientId.entries()).map(([clientId, csList]) => {
                  const client = clients.find(c => c.id === clientId);
                  const isExpanded = expandedClientId === clientId;
                  const hasActive = csList.some(cs => cs.id === activeSession);
                  return (
                    <div key={clientId}
                      style={{
                        borderRadius: 8, border: `1px solid ${hasActive ? "rgba(245,158,11,0.3)" : "rgba(255,255,255,0.07)"}`,
                        background: hasActive ? "rgba(245,158,11,0.06)" : "rgba(255,255,255,0.02)",
                        overflow: "hidden",
                      }}
                    >
                      <div
                        onClick={() => setExpandedClientId(prev => prev === clientId ? null : clientId)}
                        style={{ display: "flex", alignItems: "center", padding: "8px 10px", gap: 8, cursor: "pointer" }}
                      >
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: hasActive ? "#f59e0b" : "#e2e8f0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {client?.name ?? "Unknown client"}
                          </div>
                          <div style={{ fontSize: 10, color: "#334155", marginTop: 1 }}>
                            {csList.length} session{csList.length !== 1 ? "s" : ""}
                          </div>
                        </div>
                        <svg style={{ width: 10, height: 10, flexShrink: 0, transform: isExpanded ? "rotate(90deg)" : "rotate(0)", transition: "transform 0.2s", color: "#475569" }}
                          fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                        </svg>
                      </div>
                      {isExpanded && (
                        <div style={{ padding: "0 8px 8px", borderTop: "1px solid rgba(255,255,255,0.05)", display: "flex", flexDirection: "column", gap: 3 }}>
                          {csList.map(cs => {
                            const isActive = activeSession === cs.id;
                            return (
                              <div key={cs.id} style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 6px 0" }}>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <div style={{ fontSize: 11, fontWeight: 600, color: isActive ? "#f59e0b" : "#cbd5e1", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                                    {cs.name}
                                  </div>
                                  <div style={{ fontSize: 9, color: "#334155" }}>
                                    {cs.pins.length} pin{cs.pins.length !== 1 ? "s" : ""} · {fmtDate(cs.updated_at)}
                                  </div>
                                </div>
                                <button
                                  onClick={() => isActive ? deselectSession() : loadClientSession(cs)}
                                  style={{
                                    padding: "4px 8px", borderRadius: 5, border: "none", cursor: "pointer",
                                    fontSize: 10, fontWeight: 700, flexShrink: 0,
                                    background: isActive ? "rgba(245,158,11,0.2)" : "rgba(255,255,255,0.07)",
                                    color: isActive ? "#f59e0b" : "#64748b",
                                  }}
                                >{isActive ? "Loaded" : "Load"}</button>
                                <button
                                  onClick={() => deleteClientSession(cs)}
                                  style={{ background: "none", border: "none", color: "#334155", cursor: "pointer", fontSize: 15, lineHeight: 1, padding: "0 2px", flexShrink: 0 }}
                                >×</button>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* ── Sessions (unattached, local — sales-call prep etc.) ── */}
        <div style={{ borderBottom: "1px solid rgba(255,255,255,0.07)", flexShrink: 0 }}>
          <button
            onClick={() => setShowSessions(v => !v)}
            style={{
              width: "100%", padding: "9px 14px", background: "none", border: "none",
              cursor: "pointer", display: "flex", alignItems: "center", gap: 8,
              color: "#64748b",
            }}
          >
            <svg style={{ width: 13, height: 13, flexShrink: 0 }} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5a2 2 0 00-2-2H9a2 2 0 00-2 2v5a2 2 0 01-2 2z" />
            </svg>
            <span style={{ fontSize: 11, fontWeight: 700, flex: 1, textAlign: "left" }}>
              Sessions
            </span>
            {activeLocalSessionLabel && (
              <span style={{ fontSize: 9, padding: "2px 6px", borderRadius: 4, background: "rgba(245,158,11,0.15)", color: "#f59e0b", fontWeight: 700 }}>
                {activeLocalSessionLabel}
              </span>
            )}
            <svg style={{ width: 11, height: 11, transform: showSessions ? "rotate(90deg)" : "rotate(0)", transition: "transform 0.2s" }}
              fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>

          {showSessions && (
            <div style={{ padding: "0 10px 10px" }}>

              {sessions.length === 0 && (
                <p style={{ fontSize: 11, color: "#334155", padding: "6px 2px 4px", margin: 0 }}>
                  No unattached sessions. Save one below to prep for a call, or attach it to a client.
                </p>
              )}

              <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6 }}>
                {sessions.map(session => {
                  const isActive   = activeSession === session.id;
                  const isExpanded = expandedSessionId === session.id;
                  return (
                    <div key={session.id}
                      style={{
                        borderRadius: 8, border: `1px solid ${isActive ? "rgba(245,158,11,0.3)" : "rgba(255,255,255,0.07)"}`,
                        background: isActive ? "rgba(245,158,11,0.06)" : "rgba(255,255,255,0.02)",
                        overflow: "hidden",
                      }}
                    >
                      {/* Main row — click body to expand "attach to client" picker */}
                      <div
                        onClick={() => setExpandedSessionId(prev => prev === session.id ? null : session.id)}
                        style={{ display: "flex", alignItems: "center", padding: "8px 10px", gap: 8, cursor: "pointer" }}
                      >
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: isActive ? "#f59e0b" : "#e2e8f0", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {session.name}
                          </div>
                          <div style={{ fontSize: 10, color: "#334155", marginTop: 1 }}>
                            {session.pins.length} pin{session.pins.length !== 1 ? "s" : ""} · {fmtDate(session.savedAt)}
                          </div>
                        </div>
                        <button
                          onClick={e => { e.stopPropagation(); isActive ? deselectSession() : loadSession(session); }}
                          style={{
                            padding: "4px 8px", borderRadius: 5, border: "none", cursor: "pointer",
                            fontSize: 10, fontWeight: 700,
                            background: isActive ? "rgba(245,158,11,0.2)" : "rgba(255,255,255,0.07)",
                            color: isActive ? "#f59e0b" : "#64748b",
                          }}
                        >{isActive ? "Loaded" : "Load"}</button>
                        <button
                          onClick={e => { e.stopPropagation(); deleteSession(session.id); }}
                          style={{ background: "none", border: "none", color: "#334155", cursor: "pointer", fontSize: 15, lineHeight: 1, padding: "0 2px", flexShrink: 0 }}
                        >×</button>
                      </div>
                      {/* Attach-to-client picker — visible when card is expanded; picking a
                          client promotes this session into a real, shared client record */}
                      {isExpanded && (
                        <div style={{ padding: "0 10px 8px", borderTop: "1px solid rgba(255,255,255,0.05)" }}>
                          <div style={{ fontSize: 9, color: "#475569", textTransform: "uppercase", letterSpacing: "0.07em", margin: "6px 0 4px" }}>Attach to client</div>
                          <select
                            value=""
                            onClick={e => e.stopPropagation()}
                            onChange={e => {
                              if (e.target.value) promoteSession(session, e.target.value);
                              setExpandedSessionId(null);
                            }}
                            style={{
                              width: "100%", padding: "5px 8px", borderRadius: 6, fontSize: 11,
                              background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
                              color: "#64748b", cursor: "pointer", outline: "none",
                            }}
                          >
                            <option value="">— Choose a client —</option>
                            {clients.filter(c => c.is_live).map(c => (
                              <option key={c.id} value={c.id}>{c.name}</option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Save form */}
              {savingSession ? (
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input
                      autoFocus
                      placeholder="Session name…"
                      value={newSessionName}
                      onChange={e => setNewSessionName(e.target.value)}
                      onKeyDown={e => { if (e.key === "Enter") saveSession(); if (e.key === "Escape") setSavingSession(false); }}
                      style={{
                        flex: 1, padding: "7px 10px", borderRadius: 7, fontSize: 11,
                        background: "#0f2040", border: "1px solid rgba(245,158,11,0.3)",
                        color: "#e2e8f0", outline: "none",
                      }}
                    />
                    <button onClick={saveSession} disabled={!newSessionName.trim() || !pins.length}
                      style={{
                        padding: "7px 10px", borderRadius: 7, border: "none", cursor: "pointer",
                        background: "#f59e0b", color: "#000", fontSize: 11, fontWeight: 700,
                        opacity: (!newSessionName.trim() || !pins.length) ? 0.4 : 1,
                      }}>Save</button>
                    <button onClick={() => setSavingSession(false)}
                      style={{ background: "none", border: "none", color: "#475569", cursor: "pointer", fontSize: 15, padding: 0 }}>×</button>
                  </div>
                  <select
                    value={saveTargetClientId}
                    onChange={e => setSaveTargetClientId(e.target.value)}
                    style={{
                      width: "100%", padding: "5px 8px", borderRadius: 6, fontSize: 11,
                      background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
                      color: saveTargetClientId ? "#f59e0b" : "#64748b", cursor: "pointer", outline: "none",
                    }}
                  >
                    <option value="">— No client (local session) —</option>
                    {clients.filter(c => c.is_live).map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
              ) : (
                <button
                  onClick={() => { setSavingSession(true); setSaveTargetClientId(connectedClient?.id ?? ""); }}
                  disabled={!pins.length}
                  style={{
                    width: "100%", padding: "7px 0", borderRadius: 7, fontSize: 11, fontWeight: 700,
                    border: "1px dashed rgba(255,255,255,0.1)", cursor: pins.length ? "pointer" : "default",
                    background: "transparent", color: pins.length ? "#475569" : "#1e3a5f",
                  }}
                >
                  {pins.length ? "+ Save Current Session" : "Drop pins to save a session"}
                </button>
              )}
            </div>
          )}
        </div>

        {/* Zip code search */}
        <div style={{ padding: "10px 12px", borderBottom: "1px solid rgba(255,255,255,0.07)", flexShrink: 0 }}>
          <form onSubmit={e => { e.preventDefault(); handleZipSearch(searchInput); }}
            style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input
              type="text"
              inputMode="numeric"
              maxLength={5}
              placeholder="Search zip code…"
              value={searchInput}
              onChange={e => { setSearchInput(e.target.value.replace(/\D/g, "")); setSearchError(null); }}
              style={{
                flex: 1, padding: "8px 10px", borderRadius: 7, fontSize: 12,
                background: "#0f2040", border: "1px solid rgba(255,255,255,0.1)",
                color: "#e2e8f0", outline: "none", fontFamily: "monospace",
              }}
            />
            <button type="submit" disabled={searchLoading || searchInput.length < 5}
              style={{
                padding: "8px 12px", borderRadius: 7, border: "none", cursor: "pointer",
                background: searchLoading ? "rgba(255,255,255,0.04)" : "#1d4ed8",
                color: "#fff", fontSize: 11, fontWeight: 700,
                opacity: (searchLoading || searchInput.length < 5) ? 0.5 : 1,
              }}>
              {searchLoading ? "…" : "Go"}
            </button>
          </form>
          {searchError && (
            <p style={{ fontSize: 10, color: "#ef4444", margin: "5px 2px 0", lineHeight: 1.4 }}>{searchError}</p>
          )}
        </div>

        {/* Pin mode controls */}
        {(<>
          <div style={{ padding: "12px 16px", borderBottom: "1px solid rgba(255,255,255,0.07)", flexShrink: 0 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <span style={{ fontSize: 11, color: "#475569", textTransform: "uppercase", letterSpacing: "0.07em" }}>Radius</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: "#f59e0b" }}>{radius} mi</span>
            </div>
            <input type="range" min={5} max={200} step={5} value={radius}
              onChange={e => setRadius(parseInt(e.target.value))}
              style={{ width: "100%", accentColor: "#f59e0b", cursor: "pointer" }} />
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 3 }}>
              <span style={{ fontSize: 10, color: "#334155" }}>5 mi</span>
              <span style={{ fontSize: 10, color: "#334155" }}>200 mi</span>
            </div>
          </div>
          <div style={{ padding: "6px 12px 8px", borderBottom: "1px solid rgba(255,255,255,0.07)", display: "flex", gap: 6, flexShrink: 0 }}>
            <button onClick={() => setPinMode("include")}
              style={{
                flex: 1, padding: "7px 0", borderRadius: 7, border: "none", cursor: "pointer",
                fontSize: 11, fontWeight: 700, transition: "all 0.15s",
                background: pinMode === "include" ? "rgba(59,130,246,0.18)" : "rgba(255,255,255,0.04)",
                color: pinMode === "include" ? "#60a5fa" : "#475569",
                boxShadow: pinMode === "include" ? "inset 0 0 0 1px rgba(59,130,246,0.3)" : "none",
              }}>+ Add Pin</button>
            <button onClick={() => setPinMode("exclude")}
              style={{
                flex: 1, padding: "7px 0", borderRadius: 7, border: "none", cursor: "pointer",
                fontSize: 11, fontWeight: 700, transition: "all 0.15s",
                background: pinMode === "exclude" ? "rgba(239,68,68,0.18)" : "rgba(255,255,255,0.04)",
                color: pinMode === "exclude" ? "#f87171" : "#475569",
                boxShadow: pinMode === "exclude" ? "inset 0 0 0 1px rgba(239,68,68,0.3)" : "none",
              }}>× Exclude Zips</button>
          </div>
          {pinMode === "exclude" && (
            <div style={{ padding: "6px 14px 8px", borderBottom: "1px solid rgba(255,255,255,0.07)", flexShrink: 0 }}>
              <p style={{ fontSize: 10, color: "#475569", margin: 0, lineHeight: 1.55 }}>
                Click zip polygons on the map or chips below to exclude individual zips.{manualExcludes.size > 0 ? ` ${manualExcludes.size} excluded.` : ""}
              </p>
            </div>
          )}
        </>)}

        {/* Pins */}
        <div style={{ padding: "10px 12px", borderBottom: "1px solid rgba(255,255,255,0.07)", maxHeight: 180, overflowY: "auto", flexShrink: 0 }}>
          {pins.length === 0 ? (
            <div style={{ padding: "6px 4px", color: "#334155", fontSize: 11, lineHeight: 1.5 }}>
              Click the map to drop a pin, or search a zip above.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {pins.map(pin => {
                const isSel = pin.id === selectedId;
                return (
                  <div key={pin.id} onClick={() => setSelectedId(isSel ? null : pin.id)}
                    style={{
                      display: "flex", alignItems: "center", gap: 8, padding: "7px 10px",
                      borderRadius: 8, cursor: "pointer",
                      background: isSel ? "rgba(255,255,255,0.06)" : "transparent",
                      border: `1px solid ${isSel ? "rgba(255,255,255,0.1)" : "transparent"}`,
                    }}>
                    <div style={{ width: 10, height: 10, borderRadius: pin.type === "exclude" ? 2 : "50%", background: pin.color, flexShrink: 0 }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 600, color: "#e2e8f0" }}>{pin.label}</div>
                      <div style={{ fontSize: 10, color: "#475569" }}>
                        {pin.loading ? "Loading…" : `${pin.zips.length} zips · ${pin.radius} mi`}
                      </div>
                    </div>
                    <span style={{
                      fontSize: 9, padding: "2px 5px", borderRadius: 4, fontWeight: 700, flexShrink: 0,
                      background: pin.type === "exclude" ? "rgba(239,68,68,0.15)" : "rgba(59,130,246,0.15)",
                      color: pin.type === "exclude" ? "#f87171" : "#60a5fa",
                    }}>{pin.type === "include" ? "IN" : "EX"}</span>
                    <button onClick={e => { e.stopPropagation(); handleDeletePin(pin.id); }}
                      style={{ background: "none", border: "none", color: "#475569", cursor: "pointer", fontSize: 16, lineHeight: 1, padding: "0 2px" }}>×</button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Grade legend */}
        {includeZips.size > 0 && (
          <div style={{ padding: "5px 16px", display: "flex", gap: 12, borderBottom: "1px solid rgba(255,255,255,0.05)", flexShrink: 0, flexWrap: "wrap", alignItems: "center" }}>
            {(["A", "B", "C", "D"] as const).map(g => (
              <span key={g} style={{ fontSize: 9, fontWeight: 700, color: gradeColor(g) }}>● {g}</span>
            ))}
            {connectedClient && perfCircles && Object.keys(perfCircles).length > 0 && (
              <span style={{ fontSize: 9, fontWeight: 700, color: "#94a3b8", display: "inline-flex", alignItems: "center", gap: 4 }}>
                <span style={{
                  width: 10, height: 10, borderRadius: "50%", display: "inline-block",
                  border: "1.5px solid #f8fafc", background: "rgba(248,250,252,0.12)",
                }} />
                circle = performance
              </span>
            )}
          </div>
        )}

        {/* Zip chips */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          <div style={{ padding: "7px 16px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid rgba(255,255,255,0.05)", flexShrink: 0 }}>
            <span style={{ fontSize: 10, color: "#475569", textTransform: "uppercase", letterSpacing: "0.07em" }}>
              {selectedPin ? selectedPin.label : "Targeted Zips"}
            </span>
            <span style={{ fontSize: 11, fontWeight: 700, color: "#64748b" }}>{totalLoading ? "…" : displayZips.length}</span>
          </div>
          {selectedPin && (
            <div style={{ padding: "6px 16px 0", flexShrink: 0 }}>
              <div style={{ display: "flex", gap: 4 }}>
                <input
                  value={addZipInput}
                  onChange={e => { setAddZipInput(e.target.value); setAddZipError(null); }}
                  placeholder="Zip codes (comma or space separated)…"
                  style={{
                    flex: 1, padding: "5px 8px", borderRadius: 6, fontSize: 11, fontFamily: "monospace",
                    background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
                    color: "#e2e8f0", outline: "none",
                  }}
                />
                <button
                  onClick={() => handleAddZipToPin(addZipInput, false)}
                  disabled={addZipLoading || !addZipInput.trim()}
                  style={{
                    padding: "5px 8px", borderRadius: 6, border: "none", cursor: "pointer",
                    background: "rgba(59,130,246,0.25)", color: "#60a5fa", fontSize: 11, fontWeight: 700,
                  }}>
                  {addZipLoading ? "…" : "+ Add"}
                </button>
                <button
                  onClick={() => handleAddZipToPin(addZipInput, true)}
                  disabled={addZipLoading || !addZipInput.trim()}
                  style={{
                    padding: "5px 8px", borderRadius: 6, border: "none", cursor: "pointer",
                    background: "rgba(239,68,68,0.18)", color: "#f87171", fontSize: 11, fontWeight: 700,
                  }}>
                  {addZipLoading ? "…" : "× Ex"}
                </button>
              </div>
              {addZipError && <p style={{ fontSize: 10, color: "#ef4444", margin: "4px 0 0", lineHeight: 1.4 }}>{addZipError}</p>}
            </div>
          )}
          {allChipZips.length > 0 ? (
            <div style={{ flex: 1, overflowY: "auto", padding: "8px 16px" }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                {allChipZips.map(zip => {
                  const zs = zipScores[zip];
                  return (
                    <span key={zip}
                      onClick={() => {
                        if (pinMode === "exclude") {
                          handleExcludeToggle(zip);
                        } else {
                          handleZipClick(zip);
                        }
                      }}
                      style={{ ...chipStyle(zs?.grade, selectedZip === zip, manualExcludes.has(zip)), display: "inline-flex", alignItems: "center", gap: 2 }}
                      title={
                        manualExcludes.has(zip)
                          ? "Excluded — click to restore"
                          : (zs ? `Score ${zs.score} · Grade ${zs.grade}` : "Click for data")
                      }>
                      {zip}
                      {connectedClient && clientPerf[zip] && clientPerf[zip].leads > 0 && (
                        <span style={{ fontSize: 8, background: "#1d4ed8", color: "#fff", borderRadius: 3, padding: "1px 3px", marginLeft: 2 }}>
                          {clientPerf[zip].leads}L
                        </span>
                      )}
                    </span>
                  );
                })}
              </div>
            </div>
          ) : (
            <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <span style={{ fontSize: 12, color: "#334155", textAlign: "center", padding: "0 16px" }}>
                {totalLoading ? "Loading…" : pins.length === 0 ? "No pins yet" : "No targeted zips"}
              </span>
            </div>
          )}
        </div>

        {/* Rankings */}
        {connectedClient && (() => {
          const allZips = Array.from(new Set(pins.flatMap(p => p.zips)));
          const ranked = allZips
            .filter(z => clientPerf[z])
            .sort((a, b) => (clientPerf[b]?.leads ?? 0) - (clientPerf[a]?.leads ?? 0))
            .slice(0, 10);
          if (!ranked.length) return null;
          return (
            <div style={{ borderTop: "1px solid rgba(255,255,255,0.07)", padding: "8px 12px", flexShrink: 0 }}>
              <div style={{ fontSize: 10, color: "#475569", textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 6 }}>
                Rankings · {connectedClient.name}
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                {ranked.map(zip => {
                  const p = clientPerf[zip];
                  return (
                    <div key={zip} style={{ display: "flex", alignItems: "center", gap: 6, padding: "3px 4px", borderRadius: 5, background: "rgba(255,255,255,0.03)" }}>
                      <span style={{ fontSize: 10, fontWeight: 700, color: "#e2e8f0", fontFamily: "monospace", width: 40, flexShrink: 0 }}>{zip}</span>
                      <span style={{ fontSize: 9, color: "#3b82f6" }}>{p.leads}L</span>
                      <span style={{ fontSize: 9, color: "#475569" }}>{p.appointments}A</span>
                      <span style={{ fontSize: 9, color: "#475569" }}>{p.closes}C</span>
                      {p.revenue > 0 && <span style={{ fontSize: 9, color: "#10b981", marginLeft: "auto" }}>{fmt$(p.revenue)}</span>}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })()}

        {/* Actions */}
        <div style={{ padding: "10px 12px", borderTop: "1px solid rgba(255,255,255,0.07)", display: "flex", gap: 6, flexShrink: 0 }}>
          <button onClick={copyZips} disabled={!displayZips.length}
            style={{
              flex: 1, padding: "9px 0", borderRadius: 8, border: "none",
              cursor: displayZips.length ? "pointer" : "default",
              background: copied ? "rgba(52,211,153,0.15)" : displayZips.length ? "#1d4ed8" : "#0f2040",
              color: copied ? "#34d399" : displayZips.length ? "#fff" : "#334155",
              fontSize: 12, fontWeight: 600, transition: "all 0.15s",
            }}>
            {copied ? "✓ Copied!" : `Copy${selectedPin ? ` (${displayZips.length})` : netZips.length ? ` (${netZips.length})` : ""}`}
          </button>
          {pins.length > 0 && (
            <button onClick={clearAll}
              style={{
                padding: "9px 12px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.08)",
                background: "transparent", color: "#475569", fontSize: 12, cursor: "pointer",
              }}>Clear</button>
          )}
        </div>
      </div>

      {/* ── Map ── */}
      <div style={{ flex: 1, position: "relative", overflow: "hidden" }}>
        <ZipMap
          pins={pins}
          selectedPinId={selectedId}
          onMapClick={handleMapClick}
          onSelectPin={setSelectedId}
          onDeletePin={handleDeletePin}
          onZipClick={handleZipClick}
          focusZip={selectedZip}
          manualExcludes={manualExcludes}
          pinMode={pinMode}
          onExcludeToggle={handleExcludeToggle}
          perfCircles={perfCircles}
          flyTrigger={mapFlyTrigger}
        />
        {pins.length === 0 && (
          <div style={{
            position: "absolute", bottom: 20, left: "50%", transform: "translateX(-50%)",
            background: "rgba(10,22,40,0.88)", backdropFilter: "blur(6px)",
            border: "1px solid rgba(255,255,255,0.08)", borderRadius: 20,
            padding: "5px 14px", fontSize: 11, fontWeight: 700, color: "#64748b",
            pointerEvents: "none", letterSpacing: "0.04em",
          }}>
            Click a zip to view data · click empty map to drop a pin
          </div>
        )}
        {selectedZip && (
          <ZipDataPanel
            zip={selectedZip}
            data={zipData}
            loading={zipLoading}
            onClose={() => { setSelectedZip(null); setZipData(null); }}
            clientName={connectedClient?.name}
            perfData={clientPerf[selectedZip] ?? null}
            onSavePerf={updates => saveZipPerf(selectedZip, updates)}
          />
        )}
      </div>
    </div>
  );
}
