"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

/* ────────────────────────────────────────────────────────────────────────────
   Sales Tracker (TM Dashboard)

   Tomsi Media's log of sales calls — a rebuild of the owner's "Sales Tracker
   2026" sheet. One row per call: date, prospect, source, the pitch / pricing
   offered, length, recording, outcome, how the call felt, the conclusion and
   notes.

   As in the sheet, a "call" for the totals is one with a decision: Won or
   Lost. DQ, N/A and Pending calls are listed and counted on their own, but
   never enter the closing % (won ÷ (won + lost)). The sheet's own caveat
   stands: the % means little under 30 calls.
   ──────────────────────────────────────────────────────────────────────────── */

type Outcome = "won" | "lost" | "dq" | "na" | "pending";

type Call = {
  id: string;
  call_date: string | null;      // YYYY-MM-DD
  name: string;
  source: string;
  pitch: string;
  call_minutes: number | null;
  recording_url: string;
  outcome: Outcome;
  emotions: string;
  conclusion: string;
  notes: string;
  contact: string;
  created_at: string;
};

type Draft = Omit<Call, "id" | "created_at" | "call_minutes"> & { id?: string; call_minutes: string };

const CARD = "#ffffff";
const BORDER = "1px solid rgba(0,0,0,0.07)";
const SHADOW = "0 1px 2px rgba(0,0,0,0.03), 0 10px 28px -12px rgba(0,0,0,0.10)";
const INK = "#111111";
const MUTED = "#767676";
const FAINT = "#a8a8a8";
const GOOD = "#1a7f4b";
const BAD = "#b4472e";

const OUTCOMES: { id: Outcome; label: string; color: string; bg: string }[] = [
  { id: "won",     label: "Won",     color: GOOD,      bg: "rgba(26,127,75,0.10)" },
  { id: "lost",    label: "Lost",    color: BAD,       bg: "rgba(180,71,46,0.10)" },
  { id: "dq",      label: "DQ",      color: "#6b5b2e", bg: "rgba(160,130,40,0.13)" },
  { id: "na",      label: "N/A",     color: MUTED,     bg: "rgba(0,0,0,0.06)" },
  { id: "pending", label: "Pending", color: "#2f5da8", bg: "rgba(47,93,168,0.10)" },
];
const OUTCOME = Object.fromEntries(OUTCOMES.map(o => [o.id, o])) as Record<Outcome, typeof OUTCOMES[number]>;

const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];
const SOURCES = ["Ads", "Outbound", "Referral", "Organic"];
const EFFICACY_MIN = 30;

/* ── helpers ──────────────────────────────────────────────────────────────── */

const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : "n/a");

function shortDate(d: string | null): string {
  if (!d) return "No date";
  const [y, m, day] = d.split("-").map(Number);
  return `${m}/${day}/${String(y).slice(2)}`;
}

const monthName = (key: string) => `${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

type Tally = { total: number; won: number; lost: number; dq: number; na: number; pending: number; minutes: number; timed: number };

function tally(calls: Call[]): Tally {
  const t: Tally = { total: 0, won: 0, lost: 0, dq: 0, na: 0, pending: 0, minutes: 0, timed: 0 };
  for (const c of calls) {
    t.total++;
    t[c.outcome]++;
    if (c.call_minutes != null) { t.minutes += c.call_minutes; t.timed++; }
  }
  return t;
}

// Groups pitches that differ only by case or spacing ("5 PPA x 200" / "5 ppa  x 200").
const pitchKey = (p: string) => p.trim().toLowerCase().replace(/\s+/g, " ");

// Newest first; undated calls on top so they get a date.
const newestFirst = (a: Call, b: Call) => (b.call_date ?? "9999").localeCompare(a.call_date ?? "9999");

const blankDraft = (): Draft => ({
  call_date: today(), name: "", source: "Ads", pitch: "", call_minutes: "",
  recording_url: "", outcome: "pending", emotions: "", conclusion: "", notes: "", contact: "",
});

/* ── small pieces ─────────────────────────────────────────────────────────── */

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "good" | "bad" }) {
  return (
    <div style={{ background: CARD, border: BORDER, boxShadow: SHADOW, borderRadius: 16, padding: "14px 16px" }}>
      <p style={{ fontSize: 11, fontWeight: 600, color: MUTED, marginBottom: 8 }}>{label}</p>
      <p style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em", color: tone === "good" ? GOOD : tone === "bad" ? BAD : INK }}>{value}</p>
      {sub && <p style={{ fontSize: 11, color: FAINT, marginTop: 6 }}>{sub}</p>}
    </div>
  );
}

function Badge({ outcome }: { outcome: Outcome }) {
  const o = OUTCOME[outcome];
  return (
    <span style={{ fontSize: 11, fontWeight: 700, padding: "3px 8px", borderRadius: 999, color: o.color, background: o.bg, whiteSpace: "nowrap" }}>
      {o.label}
    </span>
  );
}

function Panel({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ background: CARD, border: BORDER, boxShadow: SHADOW, borderRadius: 16, padding: 16, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <h3 style={{ fontSize: 13, fontWeight: 700, color: INK, flex: 1 }}>{title}</h3>
        {action}
      </div>
      {children}
    </div>
  );
}

const TH: React.CSSProperties = { textAlign: "left", fontSize: 11, fontWeight: 600, color: MUTED, padding: "6px 8px", whiteSpace: "nowrap" };
const TD: React.CSSProperties = { fontSize: 13, color: INK, padding: "8px 8px", borderTop: "1px solid rgba(0,0,0,0.06)", verticalAlign: "top" };
const NUM: React.CSSProperties = { textAlign: "right", fontVariantNumeric: "tabular-nums" };

// Calls / won / lost / closing % for each group, biggest first.
function BreakdownTable({ label, rows }: { label: string; rows: { key: string; t: Tally }[] }) {
  if (!rows.length) return <p style={{ fontSize: 13, color: FAINT }}>No calls yet.</p>;
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead><tr>
          <th style={TH}>{label}</th>
          <th style={{ ...TH, ...NUM }}>Calls</th>
          <th style={{ ...TH, ...NUM }}>Won</th>
          <th style={{ ...TH, ...NUM }}>Lost</th>
          <th style={{ ...TH, ...NUM }}>Closing %</th>
        </tr></thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.key}>
              <td style={TD}>{r.key}</td>
              <td style={{ ...TD, ...NUM }}>{r.t.won + r.t.lost}</td>
              <td style={{ ...TD, ...NUM, color: GOOD }}>{r.t.won}</td>
              <td style={{ ...TD, ...NUM, color: BAD }}>{r.t.lost}</td>
              <td style={{ ...TD, ...NUM, fontWeight: 600 }}>{pct(r.t.won, r.t.won + r.t.lost)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Tick the pricing / pitches on offer right now, or add one that has no calls
// yet. Saved as one shared list.
function PitchEditor({ known, current, onSave, onCancel }: {
  known: string[];
  current: string[];
  onSave: (names: string[]) => Promise<string | null>;
  onCancel: () => void;
}) {
  const [options, setOptions] = useState<string[]>(() => {
    const keys = new Set(current.map(pitchKey));
    return [...current, ...known.filter(k => !keys.has(pitchKey(k)))];
  });
  const [on, setOn] = useState<Set<string>>(() => new Set(current.map(pitchKey)));
  const [fresh, setFresh] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggle = (p: string) => setOn(prev => {
    const next = new Set(prev);
    const k = pitchKey(p);
    if (next.has(k)) next.delete(k); else next.add(k);
    return next;
  });
  const add = () => {
    const name = fresh.trim().replace(/\s+/g, " ");
    if (!name) return;
    const k = pitchKey(name);
    if (!options.some(o => pitchKey(o) === k)) setOptions(prev => [name, ...prev]);
    setOn(prev => new Set(prev).add(k));
    setFresh("");
  };
  const save = async () => {
    setBusy(true);
    const err = await onSave(options.filter(o => on.has(pitchKey(o))));
    setBusy(false);
    if (err) setError(err);
  };

  return (
    <div>
      <p style={{ fontSize: 12.5, color: MUTED, marginBottom: 10 }}>Tick the pricing on offer right now. Past pitches stay in the calls.</p>
      <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
        <input value={fresh} onChange={e => setFresh(e.target.value)} onKeyDown={e => { if (e.key === "Enter") add(); }}
          placeholder="Add a new pitch, e.g. $1 + 250 PPA" aria-label="New pitch" style={{ ...FIELD, flex: 1 }} />
        <button onClick={add} style={{ padding: "7px 12px", borderRadius: 9, fontSize: 12.5, fontWeight: 600, background: "rgba(0,0,0,0.06)", color: "#4a4a4a" }}>Add</button>
      </div>
      <div style={{ maxHeight: 280, overflowY: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
        {options.map(o => (
          <label key={o} style={{ display: "flex", alignItems: "center", gap: 10, padding: "6px 4px", fontSize: 13, color: INK, cursor: "pointer", borderRadius: 7 }}>
            <input type="checkbox" checked={on.has(pitchKey(o))} onChange={() => toggle(o)} style={{ width: 15, height: 15, accentColor: INK }} />
            {o}
          </label>
        ))}
      </div>
      {error && <p style={{ fontSize: 12.5, color: BAD, marginTop: 8 }}>{error}</p>}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 12 }}>
        <button onClick={onCancel} style={{ padding: "7px 12px", borderRadius: 9, fontSize: 12.5, fontWeight: 600, background: "rgba(0,0,0,0.06)", color: "#4a4a4a" }}>Cancel</button>
        <button onClick={save} disabled={busy} style={{ padding: "7px 14px", borderRadius: 9, fontSize: 12.5, fontWeight: 600, background: INK, color: "#ffffff", opacity: busy ? 0.5 : 1 }}>
          {busy ? "Saving…" : `Save (${on.size} current)`}
        </button>
      </div>
    </div>
  );
}

/* ── the call form (new or edit) ──────────────────────────────────────────── */

const FIELD: React.CSSProperties = {
  width: "100%", padding: "8px 10px", borderRadius: 9, fontSize: 13, color: INK,
  background: "#ffffff", border: "1px solid rgba(0,0,0,0.16)", outline: "none", fontFamily: "inherit",
};

function Field({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <label style={{ display: "block", gridColumn: wide ? "1 / -1" : undefined }}>
      <span style={{ display: "block", fontSize: 11, fontWeight: 600, color: MUTED, marginBottom: 5 }}>{label}</span>
      {children}
    </label>
  );
}

function CallForm({ initial, pitches, onSave, onDelete, onClose }: {
  initial: Draft;
  pitches: string[];
  onSave: (d: Draft) => Promise<string | null>;
  onDelete?: () => Promise<void>;
  onClose: () => void;
}) {
  const [d, setD] = useState<Draft>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD(prev => ({ ...prev, [k]: v }));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const save = async () => {
    if (!d.name.trim()) { setError("Add the prospect's name."); return; }
    if (d.call_minutes.trim() && !/^\d+$/.test(d.call_minutes.trim())) { setError("Call length is whole minutes."); return; }
    setBusy(true);
    const err = await onSave(d);
    setBusy(false);
    if (err) setError(err); else onClose();
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(0,0,0,0.28)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={e => e.stopPropagation()} role="dialog" aria-label={d.id ? "Edit call" : "Log a call"}
        style={{ background: CARD, borderRadius: 18, boxShadow: "0 24px 60px -12px rgba(0,0,0,0.35)", width: "100%", maxWidth: 640, maxHeight: "90vh", overflowY: "auto", padding: 20 }}>
        <div style={{ display: "flex", alignItems: "center", marginBottom: 16 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: INK, flex: 1 }}>{d.id ? "Edit call" : "Log a call"}</h2>
          <button onClick={onClose} aria-label="Close" style={{ padding: 6, color: MUTED, lineHeight: 0 }}>
            <svg width={16} height={16} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" /></svg>
          </button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12 }}>
          <Field label="Name"><input style={FIELD} value={d.name} onChange={e => set("name", e.target.value)} autoFocus /></Field>
          <Field label="Date"><input type="date" style={FIELD} value={d.call_date ?? ""} onChange={e => set("call_date", e.target.value || null)} /></Field>
          <Field label="Outcome">
            <select style={FIELD} value={d.outcome} onChange={e => set("outcome", e.target.value as Outcome)}>
              {OUTCOMES.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          </Field>
          <Field label="Source">
            <input style={FIELD} list="sales-sources" value={d.source} onChange={e => set("source", e.target.value)} />
            <datalist id="sales-sources">{SOURCES.map(s => <option key={s} value={s} />)}</datalist>
          </Field>
          <Field label="Pricing / Pitch">
            <input style={FIELD} list="sales-pitches" value={d.pitch} onChange={e => set("pitch", e.target.value)} placeholder="e.g. 5 PPA x 200" />
            <datalist id="sales-pitches">{pitches.map(p => <option key={p} value={p} />)}</datalist>
          </Field>
          <Field label="Call length (min)"><input style={FIELD} inputMode="numeric" value={d.call_minutes} onChange={e => set("call_minutes", e.target.value)} /></Field>
          <Field label="Recording link" wide><input style={FIELD} value={d.recording_url} onChange={e => set("recording_url", e.target.value)} placeholder="https://fathom.video/…" /></Field>
          <Field label="My emotions" wide><input style={FIELD} value={d.emotions} onChange={e => set("emotions", e.target.value)} placeholder="How did the call feel?" /></Field>
          <Field label="Conclusion" wide><textarea style={{ ...FIELD, minHeight: 90, resize: "vertical" }} value={d.conclusion} onChange={e => set("conclusion", e.target.value)} /></Field>
          <Field label="Notes" wide><textarea style={{ ...FIELD, minHeight: 60, resize: "vertical" }} value={d.notes} onChange={e => set("notes", e.target.value)} placeholder="Objections, follow-ups…" /></Field>
          <Field label="Contact information" wide><input style={FIELD} value={d.contact} onChange={e => set("contact", e.target.value)} placeholder="Phone / email" /></Field>
        </div>

        {error && <p style={{ fontSize: 12.5, color: BAD, marginTop: 12 }}>{error}</p>}

        <div style={{ display: "flex", gap: 8, marginTop: 18, alignItems: "center" }}>
          {onDelete && (
            <button disabled={busy} onClick={async () => {
              if (!confirm(`Delete the call with ${d.name || "this prospect"}?`)) return;
              setBusy(true); await onDelete(); setBusy(false); onClose();
            }} style={{ padding: "8px 12px", borderRadius: 9, fontSize: 13, fontWeight: 600, color: BAD }}>
              Delete
            </button>
          )}
          <span style={{ flex: 1 }} />
          <button onClick={onClose} style={{ padding: "8px 14px", borderRadius: 9, fontSize: 13, fontWeight: 600, background: "rgba(0,0,0,0.06)", color: "#4a4a4a" }}>Cancel</button>
          <button onClick={save} disabled={busy} style={{ padding: "8px 16px", borderRadius: 9, fontSize: 13, fontWeight: 600, background: INK, color: "#ffffff", opacity: busy ? 0.5 : 1 }}>
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── page ─────────────────────────────────────────────────────────────────── */

export default function SalesTracker() {
  const [calls, setCalls] = useState<Call[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // "all", a year ("2026") or a month ("2026-09").
  const [frame, setFrame] = useState<string>(() => String(new Date().getFullYear()));
  const [outcomeFilter, setOutcomeFilter] = useState<Outcome | "all">("all");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Draft | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  // Pricing on offer right now (shared). Empty = not set, so every pitch shows.
  const [current, setCurrent] = useState<string[]>([]);
  const [editPitches, setEditPitches] = useState(false);
  const [allPitches, setAllPitches] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/sales-calls");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not load calls");
      setCalls([...data.calls].sort(newestFirst));
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load calls");
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    fetch("/api/sales-pitches").then(r => (r.ok ? r.json() : null))
      .then(d => { if (d?.pitches) setCurrent(d.pitches); }).catch(() => {});
  }, []);

  const savePitches = async (names: string[]): Promise<string | null> => {
    const res = await fetch("/api/sales-pitches", {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pitches: names }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return data.error || "Could not save";
    setCurrent(data.pitches);
    setEditPitches(false);
    setAllPitches(false);
    return null;
  };

  const all = useMemo(() => calls ?? [], [calls]);

  // Time-frame choices: every year and month that has a call, newest first.
  const frames = useMemo(() => {
    const years = new Set<string>(), months = new Set<string>();
    for (const c of all) if (c.call_date) { years.add(c.call_date.slice(0, 4)); months.add(c.call_date.slice(0, 7)); }
    years.add(String(new Date().getFullYear()));
    return { years: [...years].sort().reverse(), months: [...months].sort().reverse() };
  }, [all]);

  const inFrame = useMemo(
    () => (frame === "all" ? all : all.filter(c => c.call_date?.startsWith(frame))),
    [all, frame],
  );
  const t = useMemo(() => tally(inFrame), [inFrame]);
  const decided = t.won + t.lost;

  const byMonth = useMemo(() => {
    const m = new Map<string, Call[]>();
    for (const c of inFrame) if (c.call_date) {
      const k = c.call_date.slice(0, 7);
      m.set(k, [...(m.get(k) ?? []), c]);
    }
    return [...m.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([k, cs]) => ({ key: monthName(k), t: tally(cs) }));
  }, [inFrame]);

  const byPitch = useMemo(() => {
    const m = new Map<string, { label: string; calls: Call[] }>();
    for (const c of inFrame) {
      if (!c.pitch.trim() || c.outcome === "dq" || c.outcome === "na") continue;
      const k = pitchKey(c.pitch);
      const g = m.get(k) ?? { label: c.pitch.trim(), calls: [] };
      g.calls.push(c);
      m.set(k, g);
    }
    const everything = [...m.values()].map(g => ({ key: g.label, t: tally(g.calls) }))
      .filter(r => r.t.won + r.t.lost > 0)
      .sort((a, b) => (b.t.won + b.t.lost) - (a.t.won + a.t.lost));
    // With a current list set, show just those — in its order, with zeros for
    // a pitch nobody has run in this time frame yet.
    if (!current.length || allPitches) return everything;
    return current.map(name => ({ key: name, t: tally(m.get(pitchKey(name))?.calls ?? []) }));
  }, [inFrame, current, allPitches]);

  // Every pitch ever used, most-used first.
  const known = useMemo(() => {
    const m = new Map<string, { name: string; n: number }>();
    for (const c of all) if (c.pitch.trim()) {
      const k = pitchKey(c.pitch);
      const g = m.get(k) ?? { name: c.pitch.trim(), n: 0 };
      g.n++;
      m.set(k, g);
    }
    return [...m.values()].sort((a, b) => b.n - a.n).map(g => g.name);
  }, [all]);
  // The call form suggests the current pricing; with none set, everything.
  const pitches = current.length ? current : known;

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return inFrame.filter(c =>
      (outcomeFilter === "all" || c.outcome === outcomeFilter) &&
      (!q || [c.name, c.pitch, c.source, c.conclusion, c.notes, c.emotions].some(v => v.toLowerCase().includes(q))));
  }, [inFrame, outcomeFilter, search]);

  const save = async (d: Draft): Promise<string | null> => {
    const body = { ...d, call_minutes: d.call_minutes.trim() || null };
    const res = await fetch("/api/sales-calls", {
      method: d.id ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return data.error || "Could not save";
    setCalls(prev => {
      const rest = (prev ?? []).filter(c => c.id !== data.call.id);
      return [data.call, ...rest].sort(newestFirst);
    });
    return null;
  };

  const remove = async (id: string) => {
    const res = await fetch(`/api/sales-calls?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    if (res.ok) setCalls(prev => (prev ?? []).filter(c => c.id !== id));
  };

  const edit = (c: Call) => setEditing({ ...c, call_minutes: c.call_minutes == null ? "" : String(c.call_minutes) });

  if (loadError) return <p style={{ fontSize: 13, color: BAD }}>{loadError}</p>;
  if (!calls) return <p style={{ fontSize: 13, color: MUTED }}>Loading calls…</p>;

  const frameLabel = frame === "all" ? "All time" : frame.length === 4 ? frame : monthName(frame);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* controls */}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <select value={frame} onChange={e => setFrame(e.target.value)} aria-label="Time frame"
          style={{ ...FIELD, width: "auto", fontWeight: 600 }}>
          <option value="all">All time</option>
          <optgroup label="Year">{frames.years.map(y => <option key={y} value={y}>{y}</option>)}</optgroup>
          <optgroup label="Month">{frames.months.map(m => <option key={m} value={m}>{monthName(m)}</option>)}</optgroup>
        </select>
        <span style={{ flex: 1 }} />
        <button onClick={() => setEditing(blankDraft())}
          style={{ padding: "8px 14px", borderRadius: 9, fontSize: 13, fontWeight: 600, background: INK, color: "#ffffff" }}>
          + Log a call
        </button>
      </div>

      {/* totals */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 12 }}>
        <Tile label="Total calls" value={String(decided)} sub={`${frameLabel} · won + lost`} />
        <Tile label="Total won" value={String(t.won)} tone="good" />
        <Tile label="Total lost" value={String(t.lost)} tone="bad" />
        <Tile label="Closing %" value={pct(t.won, decided)}
          sub={decided < EFFICACY_MIN ? `Little meaning under ${EFFICACY_MIN} calls` : undefined} />
        <Tile label="DQ / N/A / Pending" value={`${t.dq} / ${t.na} / ${t.pending}`} sub="Not in closing %" />
        <Tile label="Avg call length" value={t.timed ? `${Math.round(t.minutes / t.timed)} min` : "n/a"} />
      </div>

      {/* breakdowns */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 12 }}>
        <Panel title="By month"><BreakdownTable label="Month" rows={byMonth} /></Panel>
        <Panel title={current.length && !allPitches && !editPitches ? "By pricing / pitch · current" : "By pricing / pitch"}
          action={!editPitches && (
            <button onClick={() => setEditPitches(true)} style={{ fontSize: 12.5, fontWeight: 600, color: MUTED }}>Edit</button>
          )}>
          {editPitches ? (
            <PitchEditor known={known} current={current} onSave={savePitches} onCancel={() => setEditPitches(false)} />
          ) : (
            <>
              <BreakdownTable label="Pitch" rows={byPitch} />
              {current.length > 0 && (
                <button onClick={() => setAllPitches(v => !v)} style={{ fontSize: 12, fontWeight: 600, color: MUTED, marginTop: 10 }}>
                  {allPitches ? "Show current pricing only" : "Show past pricing too"}
                </button>
              )}
            </>
          )}
        </Panel>
      </div>

      {/* call log */}
      <Panel title={`Calls (${shown.length})`}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
          {(["all", ...OUTCOMES.map(o => o.id)] as const).map(id => {
            const active = outcomeFilter === id;
            return (
              <button key={id} onClick={() => setOutcomeFilter(id)}
                style={{ padding: "5px 11px", borderRadius: 999, fontSize: 12, fontWeight: 600,
                  background: active ? INK : "rgba(0,0,0,0.05)", color: active ? "#ffffff" : "#4a4a4a" }}>
                {id === "all" ? "All" : OUTCOME[id].label}
              </button>
            );
          })}
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, pitch, notes…"
            aria-label="Search calls" style={{ ...FIELD, width: "auto", flex: "1 1 180px", padding: "5px 10px" }} />
        </div>

        {!shown.length ? (
          <p style={{ fontSize: 13, color: FAINT, padding: "12px 0" }}>No calls here yet.</p>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
              <thead><tr>
                <th style={TH}>Date</th>
                <th style={TH}>Name</th>
                <th style={TH}>Source</th>
                <th style={TH}>Pricing / Pitch</th>
                <th style={{ ...TH, ...NUM }}>Min</th>
                <th style={TH}>Outcome</th>
                <th style={TH}>My emotions</th>
                <th style={TH}>Recording</th>
                <th style={TH} />
              </tr></thead>
              <tbody>
                {shown.map(c => {
                  const expanded = open === c.id;
                  return (
                    <FragmentRow key={c.id} c={c} expanded={expanded}
                      onToggle={() => setOpen(expanded ? null : c.id)} onEdit={() => edit(c)} />
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {editing && (
        <CallForm
          key={editing.id ?? "new"}
          initial={editing}
          pitches={pitches}
          onSave={save}
          onDelete={editing.id ? () => remove(editing.id!) : undefined}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

// One call: the summary row, and — when opened — its conclusion and notes.
function FragmentRow({ c, expanded, onToggle, onEdit }: { c: Call; expanded: boolean; onToggle: () => void; onEdit: () => void }) {
  const hasText = !!(c.conclusion || c.notes || c.contact);
  return (
    <>
      <tr onClick={onToggle} style={{ cursor: "pointer", background: expanded ? "rgba(0,0,0,0.025)" : undefined }}>
        <td style={{ ...TD, whiteSpace: "nowrap", color: c.call_date ? INK : FAINT }}>{shortDate(c.call_date)}</td>
        <td style={{ ...TD, fontWeight: 600 }}>{c.name || "—"}</td>
        <td style={TD}>{c.source}</td>
        <td style={TD}>{c.pitch}</td>
        <td style={{ ...TD, ...NUM }}>{c.call_minutes ?? ""}</td>
        <td style={TD}><Badge outcome={c.outcome} /></td>
        <td style={{ ...TD, color: MUTED }}>{c.emotions}</td>
        <td style={TD}>
          {c.recording_url && (
            <a href={c.recording_url} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()}
              style={{ color: "#2f5da8", fontWeight: 600, fontSize: 12.5 }}>Watch</a>
          )}
        </td>
        <td style={{ ...TD, textAlign: "right" }}>
          <button onClick={e => { e.stopPropagation(); onEdit(); }} style={{ fontSize: 12.5, fontWeight: 600, color: MUTED }}>Edit</button>
        </td>
      </tr>
      {expanded && (
        <tr style={{ background: "rgba(0,0,0,0.025)" }}>
          <td colSpan={9} style={{ padding: "4px 8px 14px" }}>
            {!hasText && <p style={{ fontSize: 13, color: FAINT }}>No conclusion or notes.</p>}
            {c.conclusion && <Note label="Conclusion" text={c.conclusion} />}
            {c.notes && <Note label="Notes" text={c.notes} />}
            {c.contact && <Note label="Contact" text={c.contact} />}
          </td>
        </tr>
      )}
    </>
  );
}

function Note({ label, text }: { label: string; text: string }) {
  return (
    <div style={{ marginTop: 8 }}>
      <p style={{ fontSize: 11, fontWeight: 600, color: MUTED, marginBottom: 2 }}>{label}</p>
      <p style={{ fontSize: 13, color: INK, whiteSpace: "pre-wrap", lineHeight: 1.5 }}>{text}</p>
    </div>
  );
}
