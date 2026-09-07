"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/* ────────────────────────────────────────────────────────────────────────────
   Lifting Tracker

   One row per week, keyed to that week's Monday — the calendar is the input
   surface and the progress tab reads back out of it. Everything here is scoped
   to the signed-in user by the API; nobody shares a log.
   ──────────────────────────────────────────────────────────────────────────── */

type Lift = { load: number | null; reps: number | null };

type Entry = {
  id: string;
  week_start: string;
  weight_1: number | null;
  weight_2: number | null;
  weight_3: number | null;
  waist: number | null;
  bicep: number | null;
  lifts: Record<string, Lift>;
  notes: string | null;
  updated_at: string;
};

type Settings = {
  exercises: string[];
  unit: string;
  length_unit: string;
  goal_note: string | null;
  share_token: string | null;
};

const CARD = "#ffffff";
const BORDER = "1px solid rgba(0,0,0,0.07)";
const SHADOW = "0 1px 2px rgba(0,0,0,0.03), 0 10px 28px -12px rgba(0,0,0,0.10)";
const INK = "#111111";
const MUTED = "#767676";
const FAINT = "#a8a8a8";

const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/* ── dates ─────────────────────────────────────────────────────────────────
   Kept in local time throughout. toISOString() would shift the date backwards
   for anyone west of UTC, which silently files a Monday under the Sunday
   before it. */

function iso(d: Date) {
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

function parseISO(s: string) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function mondayOf(d: Date) {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const shift = (out.getDay() + 6) % 7; // Sunday counts as the end of the week
  out.setDate(out.getDate() - shift);
  return out;
}

function addDays(d: Date, n: number) {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

// Every Monday whose week begins in the given year.
function weeksOfYear(year: number) {
  const first = mondayOf(new Date(year, 0, 1));
  if (first.getFullYear() < year) first.setDate(first.getDate() + 7);
  const out: Date[] = [];
  for (let d = first; d.getFullYear() === year; d = addDays(d, 7)) out.push(d);
  return out;
}

function weekLabel(monday: Date) {
  const end = addDays(monday, 6);
  const a = `${MONTHS_SHORT[monday.getMonth()]} ${monday.getDate()}`;
  const b = monday.getMonth() === end.getMonth()
    ? `${end.getDate()}`
    : `${MONTHS_SHORT[end.getMonth()]} ${end.getDate()}`;
  return `${a} – ${b}`;
}

/* ── numbers ──────────────────────────────────────────────────────────────── */

function avgOf(vals: (number | null)[]) {
  const nums = vals.filter((v): v is number => typeof v === "number");
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function fmt(n: number | null | undefined, dp = 1) {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return n.toFixed(dp).replace(/\.0+$/, "");
}

function fmtDelta(n: number | null, dp = 1) {
  if (n === null || !Number.isFinite(n)) return "—";
  const s = fmt(Math.abs(n), dp);
  if (Math.abs(n) < 0.001) return "0";
  return `${n > 0 ? "+" : "−"}${s}`;
}

/* ── small pieces ─────────────────────────────────────────────────────────── */

function Field({ label, hint, value, onChange, placeholder, autoFocus }: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  return (
    <label style={{ display: "block" }}>
      <span style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 6, marginBottom: 4 }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: MUTED }}>{label}</span>
        {hint && <span style={{ fontSize: 10, color: FAINT }}>{hint}</span>}
      </span>
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        inputMode="decimal"
        // A numeric keypad on the phone, but not a spinner that eats decimals.
        style={{
          width: "100%", padding: "10px 12px", borderRadius: 10, fontSize: 16,
          background: "#ffffff", border: "1px solid rgba(0,0,0,0.14)", color: INK, outline: "none",
        }}
      />
    </label>
  );
}

function Stat({ label, start, current, unit, lowerIsBetter }: {
  label: string; start: number | null; current: number | null; unit: string; lowerIsBetter?: boolean;
}) {
  const change = start !== null && current !== null ? current - start : null;
  const good = change === null || Math.abs(change) < 0.001
    ? null
    : lowerIsBetter ? change < 0 : change > 0;
  return (
    <div style={{ background: CARD, border: BORDER, boxShadow: SHADOW, borderRadius: 16, padding: "14px 16px" }}>
      <p style={{ fontSize: 11, fontWeight: 600, color: MUTED, marginBottom: 8 }}>{label}</p>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{ fontSize: 22, fontWeight: 700, color: INK, letterSpacing: "-0.02em" }}>{fmt(current)}</span>
        <span style={{ fontSize: 11, color: FAINT }}>{unit}</span>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 6 }}>
        <span style={{
          fontSize: 12, fontWeight: 700,
          color: good === null ? FAINT : good ? "#1a7f4b" : "#b4472e",
        }}>
          {fmtDelta(change)}
        </span>
        <span style={{ fontSize: 11, color: FAINT }}>from {fmt(start)}</span>
      </div>
    </div>
  );
}

// A plain line chart. No library in this project, and one line of data does not
// justify adding one.
function Chart({ points, unit, height = 132 }: {
  points: { x: string; y: number }[]; unit: string; height?: number;
}) {
  if (points.length === 0) {
    return (
      <div style={{ height, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, color: FAINT }}>
        Nothing logged yet
      </div>
    );
  }

  const W = 640, H = height, PAD_L = 34, PAD_R = 10, PAD_T = 12, PAD_B = 22;
  const ys = points.map(p => p.y);
  let lo = Math.min(...ys), hi = Math.max(...ys);
  if (hi - lo < 0.5) { lo -= 0.5; hi += 0.5; }      // a flat line should sit mid-box
  const pad = (hi - lo) * 0.12;
  lo -= pad; hi += pad;

  const px = (i: number) => points.length === 1
    ? (PAD_L + W - PAD_R) / 2
    : PAD_L + (i / (points.length - 1)) * (W - PAD_L - PAD_R);
  const py = (v: number) => PAD_T + (1 - (v - lo) / (hi - lo)) * (H - PAD_T - PAD_B);

  const d = points.map((p, i) => `${i ? "L" : "M"}${px(i).toFixed(1)},${py(p.y).toFixed(1)}`).join(" ");
  const area = `${d} L${px(points.length - 1).toFixed(1)},${H - PAD_B} L${px(0).toFixed(1)},${H - PAD_B} Z`;
  const ticks = [hi, (hi + lo) / 2, lo];
  const last = points[points.length - 1];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: "100%", height, display: "block" }} preserveAspectRatio="none">
      {ticks.map((t, i) => (
        <g key={i}>
          <line x1={PAD_L} x2={W - PAD_R} y1={py(t)} y2={py(t)} stroke="rgba(0,0,0,0.07)" strokeWidth={1} />
          <text x={0} y={py(t) + 3} fontSize={9} fill={FAINT}>{fmt(t)}</text>
        </g>
      ))}
      <path d={area} fill="rgba(0,0,0,0.05)" />
      <path d={d} fill="none" stroke={INK} strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round"
        vectorEffect="non-scaling-stroke" />
      {points.map((p, i) => (
        <circle key={i} cx={px(i)} cy={py(p.y)} r={i === points.length - 1 ? 3.4 : 2.2}
          fill={i === points.length - 1 ? INK : "#ffffff"} stroke={INK} strokeWidth={1.4}
          vectorEffect="non-scaling-stroke" />
      ))}
      <text x={PAD_L} y={H - 6} fontSize={9} fill={FAINT}>{points[0].x}</text>
      {points.length > 1 && (
        <text x={W - PAD_R} y={H - 6} fontSize={9} fill={FAINT} textAnchor="end">{last.x}</text>
      )}
      <title>{`${fmt(last.y)} ${unit}`}</title>
    </svg>
  );
}

function Panel({ title, subtitle, children }: {
  title: string; subtitle?: string; children: React.ReactNode;
}) {
  return (
    <div style={{ background: CARD, border: BORDER, boxShadow: SHADOW, borderRadius: 18, padding: 18 }}>
      <div style={{ marginBottom: 10 }}>
        <p style={{ fontSize: 13, fontWeight: 700, color: INK }}>{title}</p>
        {subtitle && <p style={{ fontSize: 11, color: FAINT, marginTop: 2 }}>{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

function Sheet({ title, onClose, children, footer }: {
  title: string; onClose: () => void; children: React.ReactNode; footer?: React.ReactNode;
}) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 60, background: "rgba(0,0,0,0.42)",
        backdropFilter: "blur(3px)", WebkitBackdropFilter: "blur(3px)",
        display: "flex", alignItems: "flex-end", justifyContent: "center",
      }}
      className="lift-sheet-backdrop"
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: "#ffffff", width: "100%", maxWidth: 560, maxHeight: "92dvh",
          display: "flex", flexDirection: "column",
          borderRadius: "20px 20px 0 0", boxShadow: "0 -12px 60px rgba(0,0,0,0.28)",
        }}
        className="lift-sheet"
      >
        <div style={{
          padding: "14px 18px", borderBottom: "1px solid rgba(0,0,0,0.07)",
          display: "flex", alignItems: "center", gap: 12, flexShrink: 0,
        }}>
          <p style={{ fontSize: 15, fontWeight: 700, color: INK, flex: 1 }}>{title}</p>
          <button onClick={onClose} aria-label="Close"
            style={{ padding: 6, borderRadius: 8, color: MUTED, lineHeight: 0 }}>
            <svg width={18} height={18} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
            </svg>
          </button>
        </div>
        <div style={{ padding: 18, overflowY: "auto", flex: 1 }}>{children}</div>
        {footer && (
          <div style={{
            padding: "12px 18px", borderTop: "1px solid rgba(0,0,0,0.07)",
            display: "flex", gap: 10, alignItems: "center", flexShrink: 0,
            paddingBottom: "max(12px, env(safe-area-inset-bottom))",
          }}>
            {footer}
          </div>
        )}
      </div>
      <style>{`
        @media (min-width: 640px) {
          .lift-sheet-backdrop { align-items: center; }
          .lift-sheet { border-radius: 20px !important; }
        }
      `}</style>
    </div>
  );
}

const BTN_PRIMARY: React.CSSProperties = {
  padding: "10px 18px", borderRadius: 10, fontSize: 14, fontWeight: 600,
  background: "#000000", color: "#ffffff",
};
const BTN_QUIET: React.CSSProperties = {
  padding: "10px 14px", borderRadius: 10, fontSize: 13, fontWeight: 600,
  background: "rgba(0,0,0,0.06)", color: "#4a4a4a",
};

/* ── the tool ─────────────────────────────────────────────────────────────── */

type Tab = "calendar" | "progress";

export default function LiftTracker() {
  const thisMonday = useMemo(() => mondayOf(new Date()), []);
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [tab, setTab] = useState<Tab>("calendar");

  const [entries, setEntries] = useState<Entry[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [openWeek, setOpenWeek] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [eRes, sRes] = await Promise.all([
        fetch("/api/lift-log"),
        fetch("/api/lift-log/settings"),
      ]);
      if (eRes.status === 403 || sRes.status === 403) {
        setError("You don't have access to this tool.");
        setLoading(false);
        return;
      }
      const e = await eRes.json();
      const s = await sRes.json();
      if (!eRes.ok) throw new Error(e.error ?? "Could not load your log");
      setEntries(e.entries ?? []);
      setSettings(s.settings ?? null);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load your log");
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const byWeek = useMemo(() => {
    const m = new Map<string, Entry>();
    for (const e of entries) m.set(e.week_start, e);
    return m;
  }, [entries]);

  const exercises = settings?.exercises ?? [];
  const unit = settings?.unit ?? "kg";
  const lengthUnit = settings?.length_unit ?? "cm";

  // Only weeks that actually carry numbers, oldest first — the spine of every
  // stat and chart below.
  const logged = useMemo(
    () => entries
      .filter(e => avgOf([e.weight_1, e.weight_2, e.weight_3]) !== null
        || e.waist !== null || e.bicep !== null
        || Object.keys(e.lifts ?? {}).length > 0)
      .sort((a, b) => a.week_start.localeCompare(b.week_start)),
    [entries],
  );

  const weeks = useMemo(() => weeksOfYear(year), [year]);
  const loggedThisYear = weeks.filter(w => byWeek.has(iso(w))).length;

  async function saveEntry(payload: Record<string, unknown>) {
    const res = await fetch("/api/lift-log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const d = await res.json();
    if (!res.ok) throw new Error(d.error ?? "Could not save");
    setEntries(prev => {
      const rest = prev.filter(e => e.week_start !== d.entry.week_start);
      return [...rest, d.entry].sort((a, b) => a.week_start.localeCompare(b.week_start));
    });
  }

  async function deleteEntry(weekStart: string) {
    await fetch(`/api/lift-log?week_start=${weekStart}`, { method: "DELETE" });
    setEntries(prev => prev.filter(e => e.week_start !== weekStart));
  }

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 80, color: FAINT, fontSize: 13 }}>
        Loading your log…
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 32, fontSize: 13, color: "#b4472e" }}>{error}</div>
    );
  }

  return (
    <div style={{ maxWidth: 1080 }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap", marginBottom: 18 }}>
        <div style={{ flex: 1, minWidth: 180 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: INK, letterSpacing: "-0.02em" }}>Lifting Tracker</h2>
          <p style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>
            {settings?.goal_note
              ? settings.goal_note
              : `${loggedThisYear} of ${weeks.length} weeks logged in ${year}`}
          </p>
        </div>

        <div style={{ display: "flex", background: "rgba(0,0,0,0.05)", borderRadius: 10, padding: 3 }}>
          {(["calendar", "progress"] as Tab[]).map(t => (
            <button key={t} onClick={() => setTab(t)}
              style={{
                padding: "6px 14px", borderRadius: 8, fontSize: 12.5, fontWeight: 600,
                textTransform: "capitalize",
                background: tab === t ? "#ffffff" : "transparent",
                color: tab === t ? INK : MUTED,
                boxShadow: tab === t ? "0 1px 3px rgba(0,0,0,0.10)" : "none",
              }}>
              {t}
            </button>
          ))}
        </div>

        <button onClick={() => setShowSettings(true)} aria-label="Tracker settings"
          style={{ padding: 9, borderRadius: 10, background: "rgba(0,0,0,0.05)", color: MUTED, lineHeight: 0 }}>
          <svg width={16} height={16} fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </button>
      </div>

      {tab === "calendar" && (
        <Calendar
          year={year} setYear={setYear} weeks={weeks} byWeek={byWeek}
          thisMonday={iso(thisMonday)} unit={unit}
          onOpen={setOpenWeek}
        />
      )}

      {tab === "progress" && (
        <Progress logged={logged} exercises={exercises} unit={unit} lengthUnit={lengthUnit} />
      )}

      {openWeek && (
        <EntrySheet
          weekStart={openWeek}
          entry={byWeek.get(openWeek) ?? null}
          previous={logged.filter(e => e.week_start < openWeek).slice(-1)[0] ?? null}
          exercises={exercises}
          unit={unit}
          lengthUnit={lengthUnit}
          onClose={() => setOpenWeek(null)}
          onSave={saveEntry}
          onDelete={deleteEntry}
        />
      )}

      {showSettings && settings && (
        <SettingsSheet
          settings={settings}
          onClose={() => setShowSettings(false)}
          onSaved={s => setSettings(s)}
        />
      )}
    </div>
  );
}

/* ── calendar ─────────────────────────────────────────────────────────────── */

function Calendar({ year, setYear, weeks, byWeek, thisMonday, unit, onOpen }: {
  year: number;
  setYear: (y: number) => void;
  weeks: Date[];
  byWeek: Map<string, Entry>;
  thisMonday: string;
  unit: string;
  onOpen: (weekStart: string) => void;
}) {
  const currentRef = useRef<HTMLButtonElement>(null);

  // Land on the week you are actually in rather than the top of January.
  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: "center", behavior: "auto" });
  }, [year]);

  const byMonth = useMemo(() => {
    const groups: { month: number; weeks: Date[] }[] = [];
    for (const w of weeks) {
      const last = groups[groups.length - 1];
      if (last && last.month === w.getMonth()) last.weeks.push(w);
      else groups.push({ month: w.getMonth(), weeks: [w] });
    }
    return groups;
  }, [weeks]);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
        <button onClick={() => setYear(year - 1)} aria-label="Previous year" style={{ ...BTN_QUIET, padding: "6px 12px" }}>‹</button>
        <span style={{ fontSize: 15, fontWeight: 700, color: INK, minWidth: 56, textAlign: "center" }}>{year}</span>
        <button onClick={() => setYear(year + 1)} aria-label="Next year" style={{ ...BTN_QUIET, padding: "6px 12px" }}>›</button>
        <button onClick={() => onOpen(thisMonday)} style={{ ...BTN_PRIMARY, marginLeft: "auto", padding: "8px 16px", fontSize: 13 }}>
          Log this week
        </button>
      </div>

      {byMonth.map(({ month, weeks: ws }) => (
        <section key={month} style={{ marginBottom: 22 }}>
          <p style={{
            fontSize: 10, fontWeight: 700, letterSpacing: "0.09em", textTransform: "uppercase",
            color: FAINT, marginBottom: 8,
          }}>
            {MONTHS[month]}
          </p>
          <div style={{ display: "grid", gap: 8, gridTemplateColumns: "repeat(auto-fill, minmax(148px, 1fr))" }}>
            {ws.map(w => {
              const key = iso(w);
              const entry = byWeek.get(key);
              const weight = entry ? avgOf([entry.weight_1, entry.weight_2, entry.weight_3]) : null;
              const liftCount = entry ? Object.keys(entry.lifts ?? {}).length : 0;
              const isNow = key === thisMonday;
              const filled = !!entry;

              return (
                <button
                  key={key}
                  ref={isNow ? currentRef : undefined}
                  onClick={() => onOpen(key)}
                  style={{
                    textAlign: "left", padding: "11px 13px", borderRadius: 14, minHeight: 84,
                    background: filled ? CARD : "rgba(0,0,0,0.018)",
                    border: filled ? BORDER : "1px dashed rgba(0,0,0,0.13)",
                    boxShadow: filled ? SHADOW : "none",
                    outline: isNow ? `2px solid ${INK}` : "none",
                    outlineOffset: isNow ? 1 : 0,
                    display: "flex", flexDirection: "column", gap: 4,
                    transition: "transform 120ms ease",
                  }}
                  onMouseEnter={e => (e.currentTarget.style.transform = "translateY(-1px)")}
                  onMouseLeave={e => (e.currentTarget.style.transform = "none")}
                >
                  <span style={{ fontSize: 11, fontWeight: 600, color: filled ? MUTED : FAINT }}>
                    {weekLabel(w)}{isNow ? " · now" : ""}
                  </span>
                  {weight !== null ? (
                    <span style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
                      <span style={{ fontSize: 19, fontWeight: 700, color: INK, letterSpacing: "-0.02em" }}>{fmt(weight)}</span>
                      <span style={{ fontSize: 10, color: FAINT }}>{unit}</span>
                    </span>
                  ) : (
                    <span style={{ fontSize: 19, fontWeight: 700, color: filled ? INK : "rgba(0,0,0,0.14)", letterSpacing: "-0.02em" }}>
                      {filled ? "·" : "+"}
                    </span>
                  )}
                  <span style={{ fontSize: 10, color: FAINT, marginTop: "auto" }}>
                    {liftCount ? `${liftCount} lift${liftCount === 1 ? "" : "s"}` : filled ? "measurements only" : "not logged"}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}

/* ── entry sheet ──────────────────────────────────────────────────────────── */

function EntrySheet({ weekStart, entry, previous, exercises, unit, lengthUnit, onClose, onSave, onDelete }: {
  weekStart: string;
  entry: Entry | null;
  previous: Entry | null;
  exercises: string[];
  unit: string;
  lengthUnit: string;
  onClose: () => void;
  onSave: (payload: Record<string, unknown>) => Promise<void>;
  onDelete: (weekStart: string) => Promise<void>;
}) {
  const s = (v: number | null | undefined) => (v === null || v === undefined ? "" : String(v));

  const [w1, setW1] = useState(s(entry?.weight_1));
  const [w2, setW2] = useState(s(entry?.weight_2));
  const [w3, setW3] = useState(s(entry?.weight_3));
  const [waist, setWaist] = useState(s(entry?.waist));
  const [bicep, setBicep] = useState(s(entry?.bicep));
  const [notes, setNotes] = useState(entry?.notes ?? "");
  const [lifts, setLifts] = useState<Record<string, { load: string; reps: string }>>(() => {
    const out: Record<string, { load: string; reps: string }> = {};
    for (const name of exercises) {
      const l = entry?.lifts?.[name];
      out[name] = { load: s(l?.load), reps: s(l?.reps) };
    }
    return out;
  });

  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const nums = [w1, w2, w3].map(v => (v.trim() === "" ? null : Number(v)))
    .map(v => (v !== null && Number.isFinite(v) ? v : null));
  const avg = avgOf(nums);

  const monday = parseISO(weekStart);
  const title = `${weekLabel(monday)}, ${monday.getFullYear()}`;

  async function handleSave() {
    setSaving(true);
    setErr("");
    try {
      await onSave({
        week_start: weekStart,
        weight_1: w1, weight_2: w2, weight_3: w3,
        waist, bicep, notes,
        lifts: Object.fromEntries(Object.entries(lifts).map(([k, v]) => [k, { load: v.load, reps: v.reps }])),
      });
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not save");
      setSaving(false);
    }
  }

  return (
    <Sheet
      title={title}
      onClose={onClose}
      footer={
        <>
          {entry && (
            <button
              onClick={async () => { await onDelete(weekStart); onClose(); }}
              style={{ ...BTN_QUIET, background: "rgba(180,71,46,0.09)", color: "#b4472e" }}>
              Clear week
            </button>
          )}
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={{ ...BTN_QUIET, background: "transparent", color: MUTED }}>Cancel</button>
          <button onClick={handleSave} disabled={saving} style={{ ...BTN_PRIMARY, opacity: saving ? 0.6 : 1 }}>
            {saving ? "Saving…" : "Save"}
          </button>
        </>
      }
    >
      {err && (
        <p style={{ fontSize: 12, color: "#b4472e", marginBottom: 12 }}>{err}</p>
      )}

      <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.09em", textTransform: "uppercase", color: FAINT, marginBottom: 8 }}>
        Body
      </p>
      <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(3, 1fr)" }}>
        <Field label="Weigh-in 1" value={w1} onChange={setW1} placeholder={unit} autoFocus />
        <Field label="Weigh-in 2" value={w2} onChange={setW2} placeholder={unit} />
        <Field label="Weigh-in 3" value={w3} onChange={setW3} placeholder={unit} />
      </div>
      <div style={{
        marginTop: 8, padding: "8px 12px", borderRadius: 10, background: "rgba(0,0,0,0.035)",
        display: "flex", alignItems: "baseline", gap: 8,
      }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: MUTED }}>Average</span>
        <span style={{ fontSize: 15, fontWeight: 700, color: INK }}>{fmt(avg, 2)}</span>
        <span style={{ fontSize: 10, color: FAINT }}>{unit}</span>
        {previous && (
          <span style={{ marginLeft: "auto", fontSize: 11, color: FAINT }}>
            last: {fmt(avgOf([previous.weight_1, previous.weight_2, previous.weight_3]), 2)}
          </span>
        )}
      </div>

      <div style={{ display: "grid", gap: 10, gridTemplateColumns: "1fr 1fr", marginTop: 12 }}>
        <Field label={`Waist (${lengthUnit})`} hint={previous?.waist != null ? `last ${fmt(previous.waist)}` : undefined}
          value={waist} onChange={setWaist} />
        <Field label={`Bicep (${lengthUnit})`} hint={previous?.bicep != null ? `last ${fmt(previous.bicep)}` : undefined}
          value={bicep} onChange={setBicep} />
      </div>

      <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.09em", textTransform: "uppercase", color: FAINT, margin: "20px 0 8px" }}>
        Lifts
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {exercises.map(name => {
          const prev = previous?.lifts?.[name];
          return (
            <div key={name}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, marginBottom: 5 }}>
                <span style={{ fontSize: 12.5, fontWeight: 600, color: INK }}>{name}</span>
                {prev && (prev.load !== null || prev.reps !== null) && (
                  <span style={{ fontSize: 10, color: FAINT }}>
                    last {fmt(prev.load)} {unit} × {fmt(prev.reps, 0)}
                  </span>
                )}
              </div>
              <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 1fr" }}>
                <Field label={`Load (${unit})`} value={lifts[name]?.load ?? ""}
                  onChange={v => setLifts(p => ({ ...p, [name]: { load: v, reps: p[name]?.reps ?? "" } }))} />
                <Field label="Reps" value={lifts[name]?.reps ?? ""}
                  onChange={v => setLifts(p => ({ ...p, [name]: { load: p[name]?.load ?? "", reps: v } }))} />
              </div>
            </div>
          );
        })}
        {exercises.length === 0 && (
          <p style={{ fontSize: 12, color: FAINT }}>No exercises set up yet — add them in settings.</p>
        )}
      </div>

      <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.09em", textTransform: "uppercase", color: FAINT, margin: "20px 0 8px" }}>
        Notes
      </p>
      <textarea
        value={notes}
        onChange={e => setNotes(e.target.value)}
        rows={3}
        placeholder="How the week felt, sleep, food, anything worth remembering."
        style={{
          width: "100%", padding: "10px 12px", borderRadius: 10, fontSize: 15, resize: "vertical",
          background: "#ffffff", border: "1px solid rgba(0,0,0,0.14)", color: INK, outline: "none",
          fontFamily: "inherit",
        }}
      />
    </Sheet>
  );
}

/* ── progress ─────────────────────────────────────────────────────────────── */

function Progress({ logged, exercises, unit, lengthUnit }: {
  logged: Entry[]; exercises: string[]; unit: string; lengthUnit: string;
}) {
  if (logged.length === 0) {
    return (
      <div style={{
        background: CARD, border: BORDER, boxShadow: SHADOW, borderRadius: 18,
        padding: 48, textAlign: "center",
      }}>
        <p style={{ fontSize: 14, fontWeight: 600, color: INK }}>Nothing to chart yet</p>
        <p style={{ fontSize: 12, color: FAINT, marginTop: 6 }}>
          Log a week on the calendar and the numbers show up here.
        </p>
      </div>
    );
  }

  const label = (e: Entry) => {
    const d = parseISO(e.week_start);
    return `${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}`;
  };

  const series = (pick: (e: Entry) => number | null) =>
    logged.map(e => ({ x: label(e), y: pick(e) }))
      .filter((p): p is { x: string; y: number } => p.y !== null && Number.isFinite(p.y));

  const weightSeries = series(e => avgOf([e.weight_1, e.weight_2, e.weight_3]));
  const waistSeries = series(e => e.waist);
  const bicepSeries = series(e => e.bicep);

  const first = <T,>(a: T[]) => (a.length ? a[0] : null);
  const last = <T,>(a: T[]) => (a.length ? a[a.length - 1] : null);
  const ends = (s: { y: number }[]) => ({ start: first(s)?.y ?? null, current: last(s)?.y ?? null });

  const weekSpan = logged.length;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      <section>
        <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.09em", textTransform: "uppercase", color: FAINT, marginBottom: 10 }}>
          Since you started · {weekSpan} week{weekSpan === 1 ? "" : "s"} logged
        </p>
        <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))" }}>
          <Stat label="Body Weight" unit={unit} {...ends(weightSeries)} />
          <Stat label="Waist" unit={lengthUnit} lowerIsBetter {...ends(waistSeries)} />
          <Stat label="Bicep" unit={lengthUnit} {...ends(bicepSeries)} />
          {exercises.map(name => {
            const s = series(e => e.lifts?.[name]?.load ?? null);
            return <Stat key={name} label={name} unit={unit} {...ends(s)} />;
          })}
        </div>
      </section>

      <section style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))" }}>
        <Panel title="Body Weight" subtitle={`Weekly average, ${unit}`}>
          <Chart points={weightSeries} unit={unit} height={150} />
        </Panel>
        <Panel title="Waist" subtitle={lengthUnit}>
          <Chart points={waistSeries} unit={lengthUnit} height={150} />
        </Panel>
        <Panel title="Bicep" subtitle={lengthUnit}>
          <Chart points={bicepSeries} unit={lengthUnit} height={150} />
        </Panel>
      </section>

      <section>
        <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.09em", textTransform: "uppercase", color: FAINT, marginBottom: 10 }}>
          Strength
        </p>
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))" }}>
          {exercises.map(name => {
            const loadSeries = series(e => e.lifts?.[name]?.load ?? null);
            const lastReps = [...logged].reverse().find(e => e.lifts?.[name]?.reps != null)?.lifts?.[name]?.reps ?? null;
            return (
              <Panel key={name} title={name}
                subtitle={lastReps !== null ? `Working load in ${unit} · last set ${fmt(lastReps, 0)} reps` : `Working load in ${unit}`}>
                <Chart points={loadSeries} unit={unit} />
              </Panel>
            );
          })}
        </div>
      </section>

      {logged.some(e => e.notes) && (
        <section>
          <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.09em", textTransform: "uppercase", color: FAINT, marginBottom: 10 }}>
            Notes
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {[...logged].reverse().filter(e => e.notes).slice(0, 12).map(e => (
              <div key={e.week_start} style={{ background: CARD, border: BORDER, borderRadius: 14, padding: "11px 14px" }}>
                <p style={{ fontSize: 10.5, fontWeight: 700, color: FAINT, marginBottom: 3 }}>
                  {weekLabel(parseISO(e.week_start))}, {parseISO(e.week_start).getFullYear()}
                </p>
                <p style={{ fontSize: 13, color: "#3a3a3a", lineHeight: 1.5 }}>{e.notes}</p>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

/* ── settings ─────────────────────────────────────────────────────────────── */

function SettingsSheet({ settings, onClose, onSaved }: {
  settings: Settings;
  onClose: () => void;
  onSaved: (s: Settings) => void;
}) {
  const [exercises, setExercises] = useState<string[]>(settings.exercises ?? []);
  const [unit, setUnit] = useState(settings.unit ?? "kg");
  const [lengthUnit, setLengthUnit] = useState(settings.length_unit ?? "cm");
  const [goal, setGoal] = useState(settings.goal_note ?? "");
  const [shareToken, setShareToken] = useState<string | null>(settings.share_token);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [newName, setNewName] = useState("");

  const shareUrl = shareToken && typeof window !== "undefined"
    ? `${window.location.origin}/api/lift-log/export?token=${shareToken}`
    : null;

  async function patch(body: Record<string, unknown>) {
    const res = await fetch("/api/lift-log/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const d = await res.json();
    if (res.ok) {
      onSaved(d.settings);
      setShareToken(d.settings.share_token ?? null);
    }
    return d.settings as Settings | undefined;
  }

  async function handleSave() {
    setSaving(true);
    await patch({ exercises, unit, length_unit: lengthUnit, goal_note: goal });
    setSaving(false);
    onClose();
  }

  return (
    <Sheet
      title="Tracker settings"
      onClose={onClose}
      footer={
        <>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} style={{ ...BTN_QUIET, background: "transparent", color: MUTED }}>Cancel</button>
          <button onClick={handleSave} disabled={saving} style={{ ...BTN_PRIMARY, opacity: saving ? 0.6 : 1 }}>
            {saving ? "Saving…" : "Save"}
          </button>
        </>
      }
    >
      <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.09em", textTransform: "uppercase", color: FAINT, marginBottom: 8 }}>
        Exercises
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        {exercises.map((name, i) => (
          <div key={i} style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              value={name}
              onChange={e => setExercises(p => p.map((x, j) => (j === i ? e.target.value : x)))}
              style={{
                flex: 1, padding: "9px 12px", borderRadius: 10, fontSize: 15,
                background: "#ffffff", border: "1px solid rgba(0,0,0,0.14)", color: INK, outline: "none",
              }}
            />
            <button
              onClick={() => setExercises(p => p.filter((_, j) => j !== i))}
              aria-label={`Remove ${name}`}
              style={{ padding: 8, borderRadius: 9, background: "rgba(0,0,0,0.05)", color: MUTED, lineHeight: 0 }}>
              <svg width={15} height={15} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
        ))}
        <div style={{ display: "flex", gap: 8 }}>
          <input
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => {
              if (e.key === "Enter" && newName.trim()) {
                setExercises(p => [...p, newName.trim()]);
                setNewName("");
              }
            }}
            placeholder="Add an exercise"
            style={{
              flex: 1, padding: "9px 12px", borderRadius: 10, fontSize: 15,
              background: "#ffffff", border: "1px dashed rgba(0,0,0,0.18)", color: INK, outline: "none",
            }}
          />
          <button
            onClick={() => { if (newName.trim()) { setExercises(p => [...p, newName.trim()]); setNewName(""); } }}
            style={{ ...BTN_QUIET, padding: "9px 14px" }}>
            Add
          </button>
        </div>
      </div>
      <p style={{ fontSize: 11, color: FAINT, marginTop: 8 }}>
        Renaming an exercise starts its history fresh — past weeks keep the old name.
      </p>

      <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.09em", textTransform: "uppercase", color: FAINT, margin: "20px 0 8px" }}>
        Units
      </p>
      <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
        {([
          { label: "Weight", value: unit, set: setUnit, options: ["kg", "lb"] },
          { label: "Measurements", value: lengthUnit, set: setLengthUnit, options: ["cm", "in"] },
        ] as const).map(row => (
          <div key={row.label}>
            <p style={{ fontSize: 11, fontWeight: 600, color: MUTED, marginBottom: 5 }}>{row.label}</p>
            <div style={{ display: "flex", background: "rgba(0,0,0,0.05)", borderRadius: 9, padding: 3 }}>
              {row.options.map(o => (
                <button key={o} onClick={() => row.set(o)}
                  style={{
                    padding: "5px 16px", borderRadius: 7, fontSize: 12.5, fontWeight: 600,
                    background: row.value === o ? "#ffffff" : "transparent",
                    color: row.value === o ? INK : MUTED,
                    boxShadow: row.value === o ? "0 1px 3px rgba(0,0,0,0.10)" : "none",
                  }}>
                  {o}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      <p style={{ fontSize: 11, color: FAINT, marginTop: 8 }}>
        Changing a unit relabels the tracker — it does not convert numbers you already logged.
      </p>

      <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.09em", textTransform: "uppercase", color: FAINT, margin: "20px 0 8px" }}>
        Goal
      </p>
      <input
        value={goal}
        onChange={e => setGoal(e.target.value)}
        placeholder="e.g. Lean bulk — +0.25 kg a week"
        style={{
          width: "100%", padding: "10px 12px", borderRadius: 10, fontSize: 15,
          background: "#ffffff", border: "1px solid rgba(0,0,0,0.14)", color: INK, outline: "none",
        }}
      />

      <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.09em", textTransform: "uppercase", color: FAINT, margin: "20px 0 8px" }}>
        Share your log
      </p>
      {shareUrl ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{
            padding: "10px 12px", borderRadius: 10, background: "rgba(0,0,0,0.035)",
            fontSize: 11.5, color: "#3a3a3a", wordBreak: "break-all", fontFamily: "ui-monospace, monospace",
          }}>
            {shareUrl}
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              onClick={() => {
                navigator.clipboard?.writeText(shareUrl);
                setCopied(true);
                setTimeout(() => setCopied(false), 1600);
              }}
              style={{ ...BTN_QUIET }}>
              {copied ? "Copied" : "Copy link"}
            </button>
            <a href={shareUrl} target="_blank" rel="noreferrer" style={{ ...BTN_QUIET, display: "inline-block" }}>
              Open CSV
            </a>
            <button onClick={() => patch({ share: false })}
              style={{ ...BTN_QUIET, background: "rgba(180,71,46,0.09)", color: "#b4472e" }}>
              Turn off
            </button>
          </div>
          <p style={{ fontSize: 11, color: FAINT, lineHeight: 1.5 }}>
            Anyone with this link can read your log. Paste it into a Claude project,
            or into a spreadsheet with <code>=IMPORTDATA(&quot;…&quot;)</code>. Add
            <code> &amp;format=json</code> for JSON. Turning it off breaks the old link for good.
          </p>
        </div>
      ) : (
        <div>
          <button onClick={() => patch({ share: true })} style={{ ...BTN_QUIET }}>
            Create a read-only link
          </button>
          <p style={{ fontSize: 11, color: FAINT, marginTop: 8, lineHeight: 1.5 }}>
            Makes a private URL that returns your log as a spreadsheet — for handing
            to Claude or a Google Sheet. Off by default.
          </p>
        </div>
      )}
    </Sheet>
  );
}
