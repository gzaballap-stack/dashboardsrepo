"use client";

import { useEffect, useState } from "react";
import { B2B_STAT_SOURCES, type SrcData, type StatNumbers } from "@/lib/b2b-stat-sources";

// "Where does this number come from?" — opened by clicking a tile on the B2B
// dashboard. Shows what the stat measures, the sum behind it, the system the
// data originates in, and the actual records counted.

// Last records seen per date range: shown instantly on reopen, then refreshed.
const cache = new Map<string, SrcData>();
const MAX_ROWS = 150;

function H({ children }: { children: React.ReactNode }) {
  return <h3 className="text-[10px] font-bold uppercase tracking-widest mb-1.5" style={{ color: "#949494" }}>{children}</h3>;
}

const fmtWhen = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const dateOnly = /T12:00:00$/.test(iso);
  return d.toLocaleString("en-US", dateOnly
    ? { month: "short", day: "numeric", year: "numeric" }
    : { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
};

export default function StatSourceModal({ label, value, numbers, startDate, endDate, onClose }: {
  label: string; value: string; numbers: StatNumbers;
  startDate: string; endDate: string; onClose: () => void;
}) {
  const def = B2B_STAT_SOURCES[label];
  const key = `${startDate}|${endDate}`;
  const [data, setData] = useState<SrcData | null>(() => cache.get(key) ?? null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const params = new URLSearchParams();
    if (startDate) params.set("start_date", startDate);
    if (endDate) params.set("end_date", endDate);
    fetch(`/api/b2b-stat-source?${params}`)
      .then(async r => { const j = await r.json(); if (!r.ok) throw new Error(j.error ?? "Could not load the records"); return j as SrcData; })
      .then(j => { cache.set(key, j); if (alive) setData(j); })
      .catch(e => { if (alive) setError(e instanceof Error ? e.message : "Could not load the records"); });
    return () => { alive = false; };
  }, [key, startDate, endDate]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const parts = def && data ? def.parts(data) : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.4)" }}
      onClick={onClose} role="dialog" aria-modal="true" aria-label={`Where ${label} comes from`}>
      <div className="w-full max-w-xl rounded-2xl flex flex-col" onClick={e => e.stopPropagation()}
        style={{ background: "#ffffff", maxHeight: "85vh", boxShadow: "0 24px 64px -16px rgba(0,0,0,0.35)" }}>
        <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-4" style={{ borderBottom: "1px solid rgba(0,0,0,0.08)" }}>
          <div>
            <div className="text-xs font-medium" style={{ color: "#6b6b6b" }}>{label}</div>
            <div className="text-3xl font-bold" style={{ color: "#000000" }}>{value}</div>
            <div className="text-[11px] mt-1" style={{ color: "#949494" }}>{startDate} to {endDate}</div>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ width: 32, height: 32, border: "1px solid rgba(0,0,0,0.12)", color: "#111" }}>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>

        <div className="px-6 py-5 space-y-5 overflow-y-auto">
          {!def ? (
            <p className="text-sm" style={{ color: "#4a4a4a" }}>No breakdown is available for this stat yet.</p>
          ) : (
            <>
              <section>
                <H>What it measures</H>
                <p className="text-sm" style={{ color: "#111111" }}>{def.what}</p>
              </section>
              <section>
                <H>How it&apos;s calculated</H>
                <p className="text-sm font-medium rounded-lg px-3 py-2" style={{ background: "#f5f5f5", color: "#111111" }}>{def.formula(numbers, data)}</p>
              </section>
              <section>
                <H>Where the data comes from</H>
                <p className="text-sm" style={{ color: "#4a4a4a" }}>{def.origin}</p>
              </section>
              <section>
                <H>The records behind it</H>
                {error ? (
                  <p className="text-sm" style={{ color: "#b91c1c" }}>{error}</p>
                ) : !data ? (
                  <p className="text-sm" style={{ color: "#949494" }}>Loading records…</p>
                ) : (
                  <div className="space-y-4">
                    {parts.map(part => (
                      <div key={part.title}>
                        <div className="flex items-baseline justify-between mb-1">
                          <span className="text-xs font-semibold" style={{ color: "#111111" }}>{part.title}</span>
                          <span className="text-xs tabular-nums" style={{ color: "#6b6b6b" }}>{part.rows.length}</span>
                        </div>
                        {part.rows.length === 0 ? (
                          <p className="text-xs" style={{ color: "#949494" }}>Nothing recorded in this period.</p>
                        ) : (
                          <div className="rounded-xl overflow-hidden" style={{ border: "1px solid rgba(0,0,0,0.08)" }}>
                            {part.rows.slice(0, MAX_ROWS).map((r, i) => (
                              <div key={i} className="flex items-baseline gap-3 px-3 py-2 text-xs"
                                style={{ borderTop: i ? "1px solid rgba(0,0,0,0.05)" : undefined }}>
                                <span className="flex-shrink-0 tabular-nums" style={{ color: "#949494", width: 112 }}>{fmtWhen(r.when)}</span>
                                <span className="font-medium truncate" style={{ color: "#111111" }}>{r.who}</span>
                                {r.detail && <span className="ml-auto text-right" style={{ color: "#6b6b6b" }}>{r.detail}</span>}
                              </div>
                            ))}
                            {part.rows.length > MAX_ROWS && (
                              <div className="px-3 py-2 text-xs" style={{ borderTop: "1px solid rgba(0,0,0,0.05)", color: "#949494" }}>
                                …and {part.rows.length - MAX_ROWS} more
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
