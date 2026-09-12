"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { mergeExerciseNames, activeProgrammeExercises } from "@/lib/health-tracker";

/* ────────────────────────────────────────────────────────────────────────────
   Health Tracker

   Four tabs over one person's data:
     Calendar  — the weekly log. One row per week, keyed to that week's Monday.
     Progress  — the same rows read back as stats and charts.
     Diet      — a standing daily eating plan with macro targets.
     Split     — a standing weekly training plan.

   The log is rows in `lift_entries`. The two plans are documents on that user's
   `lift_settings` row: they describe intent, not history, so they are edited in
   place and autosave rather than being versioned week by week. Everything here
   is scoped to the signed-in user by the API; nobody shares a log.
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
  // Raw jsonb straight off the row — normalizeDiet / normalizeSplit give these
  // a shape, and have to cope with `{}` and with the older single-plan format.
  diet_plan: unknown;
  split_plan: unknown;
};

type Macro = "kcal" | "protein" | "carbs" | "fat";

type DietItem = {
  id: string;
  name: string;
  qty: string;
  kcal: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
};

type Meal = { id: string; name: string; time: string; items: DietItem[] };

type DietPlan = {
  id: string;
  name: string;
  targets: Record<Macro, number | null>;
  meals: Meal[];
  notes: string;
  // Calories and protein are always tracked. Carbs and fat are opt-out per
  // plan — some plans only ever count two numbers.
  showCarbs: boolean;
  showFat: boolean;
};

type SplitExercise = { id: string; name: string; sets: string; reps: string; notes: string };

type SplitDay = { id: string; weekday: string; title: string; rest: boolean; exercises: SplitExercise[] };

type SplitProgramme = { id: string; name: string; days: SplitDay[]; notes: string };

// Both plans are collections with one member marked active — the one currently
// being run. Selecting a plan to look at is separate from making it active.
type DietDoc = { plans: DietPlan[]; activeId: string | null };
type SplitDoc = { programmes: SplitProgramme[]; activeId: string | null };

const MACROS: { key: Macro; label: string; unit: string }[] = [
  { key: "kcal", label: "Calories", unit: "kcal" },
  { key: "protein", label: "Protein", unit: "g" },
  { key: "carbs", label: "Carbs", unit: "g" },
  { key: "fat", label: "Fat", unit: "g" },
];

function macrosFor(plan: DietPlan) {
  return MACROS.filter(m =>
    m.key === "carbs" ? plan.showCarbs : m.key === "fat" ? plan.showFat : true);
}

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

// The documents come back as bare `{}` before anyone has filled them in, and
// the first version of this tool stored a single unnamed plan rather than a
// collection. Both shapes have to survive a read.

function normalizeDietPlan(raw: unknown, fallbackName: string): DietPlan {
  const p = (raw ?? {}) as Partial<DietPlan>;
  const targets = (p.targets ?? {}) as Partial<Record<Macro, number | null>>;
  return {
    id: p.id ?? uid(),
    name: p.name?.trim() ? p.name : fallbackName,
    targets: {
      kcal: targets.kcal ?? null,
      protein: targets.protein ?? null,
      carbs: targets.carbs ?? null,
      fat: targets.fat ?? null,
    },
    meals: (Array.isArray(p.meals) ? p.meals : []).map(m => ({
      id: m?.id ?? uid(),
      name: m?.name ?? "",
      time: m?.time ?? "",
      items: (Array.isArray(m?.items) ? m.items : []).map(it => ({
        id: it?.id ?? uid(),
        name: it?.name ?? "",
        qty: it?.qty ?? "",
        kcal: it?.kcal ?? null,
        protein: it?.protein ?? null,
        carbs: it?.carbs ?? null,
        fat: it?.fat ?? null,
      })),
    })),
    notes: typeof p.notes === "string" ? p.notes : "",
    // Absent means the plan predates the toggle, when all four were always
    // shown — keep showing them rather than hiding numbers already entered.
    showCarbs: p.showCarbs ?? true,
    showFat: p.showFat ?? true,
  };
}

function normalizeDiet(raw: unknown): DietDoc {
  const doc = (raw ?? {}) as Partial<DietDoc> & { meals?: unknown };
  const plans = Array.isArray(doc.plans)
    ? doc.plans.map((p, i) => normalizeDietPlan(p, `Plan ${i + 1}`))
    // A pre-collection document: one unnamed plan. Anything else is empty.
    : doc.meals !== undefined || (doc as { targets?: unknown }).targets !== undefined
      ? [normalizeDietPlan(doc, "My plan")]
      : [];
  const activeId = plans.some(p => p.id === doc.activeId) ? doc.activeId! : plans[0]?.id ?? null;
  return { plans, activeId };
}

function normalizeProgramme(raw: unknown, fallbackName: string): SplitProgramme {
  const p = (raw ?? {}) as Partial<SplitProgramme>;
  const days = Array.isArray(p.days) ? p.days : [];
  // Always seven days, always in weekday order — a split with gaps in it is
  // harder to read than one with rest days spelled out.
  return {
    id: p.id ?? uid(),
    name: p.name?.trim() ? p.name : fallbackName,
    days: WEEKDAYS.map(weekday => {
      const found = days.find(d => d?.weekday === weekday);
      return {
        id: found?.id ?? uid(),
        weekday,
        title: found?.title ?? "",
        rest: found?.rest ?? false,
        exercises: (Array.isArray(found?.exercises) ? found.exercises : []).map(e => ({
          id: e?.id ?? uid(),
          name: e?.name ?? "",
          sets: e?.sets ?? "",
          reps: e?.reps ?? "",
          notes: e?.notes ?? "",
        })),
      };
    }),
    notes: typeof p.notes === "string" ? p.notes : "",
  };
}

function normalizeSplit(raw: unknown): SplitDoc {
  const doc = (raw ?? {}) as Partial<SplitDoc> & { days?: unknown };
  const programmes = Array.isArray(doc.programmes)
    ? doc.programmes.map((p, i) => normalizeProgramme(p, `Programme ${i + 1}`))
    : Array.isArray(doc.days)
      ? [normalizeProgramme(doc, "My split")]
      : [];
  const activeId = programmes.some(p => p.id === doc.activeId) ? doc.activeId! : programmes[0]?.id ?? null;
  return { programmes, activeId };
}

function emptyDietPlan(name: string): DietPlan {
  return {
    id: uid(), name,
    targets: { kcal: null, protein: null, carbs: null, fat: null },
    meals: [], notes: "", showCarbs: true, showFat: true,
  };
}

function emptyProgramme(name: string): SplitProgramme {
  return {
    id: uid(), name,
    days: WEEKDAYS.map(weekday => ({ id: uid(), weekday, title: "", rest: false, exercises: [] })),
    notes: "",
  };
}

// A copy keeps every nested id unique, or editing the duplicate would edit the
// original through shared keys.
function cloneDietPlan(plan: DietPlan, name: string): DietPlan {
  return {
    ...plan, id: uid(), name,
    meals: plan.meals.map(m => ({ ...m, id: uid(), items: m.items.map(it => ({ ...it, id: uid() })) })),
  };
}

function cloneProgramme(prog: SplitProgramme, name: string): SplitProgramme {
  return {
    ...prog, id: uid(), name,
    days: prog.days.map(d => ({ ...d, id: uid(), exercises: d.exercises.map(e => ({ ...e, id: uid() })) })),
  };
}

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

type Tab = "calendar" | "progress" | "diet" | "split";

const TABS: { id: Tab; label: string }[] = [
  { id: "calendar", label: "Calendar" },
  { id: "progress", label: "Progress" },
  { id: "diet", label: "Diet" },
  { id: "split", label: "Split" },
];

export default function HealthTracker() {
  const thisMonday = useMemo(() => mondayOf(new Date()), []);
  const [year, setYear] = useState(() => new Date().getFullYear());
  const [month, setMonth] = useState(() => new Date().getMonth());
  const [tab, setTab] = useState<Tab>("calendar");

  const [entries, setEntries] = useState<Entry[]>([]);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [openWeek, setOpenWeek] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [planSaving, setPlanSaving] = useState(false);
  const planSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (planSaveTimer.current) clearTimeout(planSaveTimer.current); }, []);

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

  const dietDoc = useMemo(() => normalizeDiet(settings?.diet_plan), [settings?.diet_plan]);
  const splitDoc = useMemo(() => normalizeSplit(settings?.split_plan), [settings?.split_plan]);

  // Your own list, plus everything the active programme trains, plus anything
  // with history. Derived on every render rather than copied into settings, so
  // switching programmes can't duplicate a lift or strand an old one.
  const exercises = useMemo(() => {
    const loggedNames = new Set<string>();
    for (const e of entries) for (const name of Object.keys(e.lifts ?? {})) loggedNames.add(name);
    return mergeExerciseNames(
      settings?.exercises,
      activeProgrammeExercises(settings?.split_plan),
      [...loggedNames],
    );
  }, [settings?.exercises, settings?.split_plan, entries]);

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

  // The plan editors change on every keystroke, so the write is coalesced —
  // local state updates immediately, the server catches up a beat later.
  function savePlan(patch: { diet_plan?: DietDoc } | { split_plan?: SplitDoc }) {
    setSettings(prev => (prev ? { ...prev, ...patch } : prev));
    if (planSaveTimer.current) clearTimeout(planSaveTimer.current);
    planSaveTimer.current = setTimeout(() => {
      setPlanSaving(true);
      fetch("/api/lift-log/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      })
        .catch(() => {})
        .finally(() => setPlanSaving(false));
    }, 700);
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
          <h2 style={{ fontSize: 20, fontWeight: 700, color: INK, letterSpacing: "-0.02em" }}>Health Tracker</h2>
          <p style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>
            {planSaving
              ? "Saving…"
              : settings?.goal_note
                ? settings.goal_note
                : `${loggedThisYear} of ${weeks.length} weeks logged in ${year}`}
          </p>
        </div>

        <div style={{
          display: "flex", background: "rgba(0,0,0,0.05)", borderRadius: 10, padding: 3,
          overflowX: "auto", maxWidth: "100%",
        }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              style={{
                padding: "6px 14px", borderRadius: 8, fontSize: 12.5, fontWeight: 600,
                whiteSpace: "nowrap",
                background: tab === t.id ? "#ffffff" : "transparent",
                color: tab === t.id ? INK : MUTED,
                boxShadow: tab === t.id ? "0 1px 3px rgba(0,0,0,0.10)" : "none",
              }}>
              {t.label}
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
          year={year} setYear={setYear} month={month} setMonth={setMonth}
          weeks={weeks} byWeek={byWeek}
          thisMonday={iso(thisMonday)} unit={unit} lengthUnit={lengthUnit}
          onOpen={setOpenWeek}
        />
      )}

      {tab === "progress" && (
        <Progress logged={logged} exercises={exercises} unit={unit} lengthUnit={lengthUnit} />
      )}

      {tab === "diet" && settings && (
        <DietTab doc={dietDoc} onChange={d => savePlan({ diet_plan: d })} />
      )}

      {tab === "split" && settings && (
        <SplitTab
          doc={splitDoc}
          trackedExercises={exercises}
          onChange={d => savePlan({ split_plan: d })}
        />
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

type CalendarScope = "month" | "year";

function WeekCard({ monday, entry, isNow, big, unit, lengthUnit, onOpen, cardRef }: {
  monday: Date;
  entry: Entry | undefined;
  isNow: boolean;
  big: boolean;
  unit: string;
  lengthUnit: string;
  onOpen: (weekStart: string) => void;
  cardRef?: React.Ref<HTMLButtonElement>;
}) {
  const key = iso(monday);
  const filled = !!entry;
  const weight = entry ? avgOf([entry.weight_1, entry.weight_2, entry.weight_3]) : null;
  const liftCount = entry ? Object.keys(entry.lifts ?? {}).length : 0;

  const footer = liftCount
    ? `${liftCount} lift${liftCount === 1 ? "" : "s"} logged`
    : filled ? "Measurements only" : "Not logged";

  return (
    <button
      ref={cardRef}
      onClick={() => onOpen(key)}
      style={{
        textAlign: "left",
        padding: big ? "16px 18px" : "11px 13px",
        borderRadius: big ? 18 : 14,
        // Grid rows stretch to the tallest card, so a shorter empty card costs
        // nothing on a wide screen and saves a lot of scrolling on a phone.
        minHeight: big ? (filled ? 196 : 140) : 84,
        background: filled ? CARD : "rgba(0,0,0,0.018)",
        border: filled ? BORDER : "1px dashed rgba(0,0,0,0.13)",
        boxShadow: filled ? SHADOW : "none",
        outline: isNow ? `2px solid ${INK}` : "none",
        outlineOffset: isNow ? 1 : 0,
        display: "flex", flexDirection: "column", gap: big ? 6 : 4,
        transition: "transform 120ms ease",
      }}
      onMouseEnter={e => (e.currentTarget.style.transform = "translateY(-1px)")}
      onMouseLeave={e => (e.currentTarget.style.transform = "none")}
    >
      <span style={{
        display: "flex", alignItems: "center", gap: 7,
        fontSize: big ? 12.5 : 11, fontWeight: 600, color: filled ? MUTED : FAINT,
      }}>
        {weekLabel(monday)}
        {isNow && (
          big ? (
            <span style={{
              fontSize: 9.5, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase",
              padding: "2px 7px", borderRadius: 20, background: INK, color: "#ffffff",
            }}>
              This week
            </span>
          ) : <span>· now</span>
        )}
      </span>

      {weight !== null ? (
        <span style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
          <span style={{ fontSize: big ? 38 : 19, fontWeight: 700, color: INK, letterSpacing: "-0.03em", lineHeight: 1.05 }}>
            {fmt(weight)}
          </span>
          <span style={{ fontSize: big ? 13 : 10, color: FAINT }}>{unit}</span>
        </span>
      ) : (
        <span style={{
          fontSize: big ? 38 : 19, fontWeight: 700, lineHeight: 1.05,
          color: filled ? INK : "rgba(0,0,0,0.14)", letterSpacing: "-0.03em",
        }}>
          {filled ? "·" : "+"}
        </span>
      )}

      {/* The big card has the room to say what's actually in the week. */}
      {big && (
        <div style={{ display: "flex", gap: 18, marginTop: 2 }}>
          {([["Waist", entry?.waist], ["Bicep", entry?.bicep]] as const).map(([label, value]) => (
            <span key={label} style={{ display: "flex", flexDirection: "column", gap: 1 }}>
              <span style={{ fontSize: 10, fontWeight: 600, color: FAINT }}>{label}</span>
              <span style={{ fontSize: 14, fontWeight: 600, color: value == null ? "rgba(0,0,0,0.2)" : "#3a3a3a" }}>
                {value == null ? "—" : `${fmt(value)} ${lengthUnit}`}
              </span>
            </span>
          ))}
        </div>
      )}

      {big && entry?.notes && (
        <span style={{
          fontSize: 12, color: "#6b6b6b", lineHeight: 1.45, marginTop: 2,
          display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
        }}>
          {entry.notes}
        </span>
      )}

      <span style={{ fontSize: big ? 11.5 : 10, color: FAINT, marginTop: "auto" }}>
        {footer}
      </span>
    </button>
  );
}

function Calendar({ year, setYear, month, setMonth, weeks, byWeek, thisMonday, unit, lengthUnit, onOpen }: {
  year: number;
  setYear: (y: number) => void;
  month: number;
  setMonth: (m: number) => void;
  weeks: Date[];
  byWeek: Map<string, Entry>;
  thisMonday: string;
  unit: string;
  lengthUnit: string;
  onOpen: (weekStart: string) => void;
}) {
  // A month at a time by default — four or five boxes is the whole screen on a
  // phone. Yearly is there for looking back, not for logging.
  const [scope, setScope] = useState<CalendarScope>("month");
  const currentRef = useRef<HTMLButtonElement>(null);

  // In the year view, land on the week you are actually in rather than the top
  // of January. The month view is short enough not to need it.
  useEffect(() => {
    if (scope === "year") currentRef.current?.scrollIntoView({ block: "center", behavior: "auto" });
  }, [year, scope]);

  const big = scope === "month";
  const shownWeeks = big ? weeks.filter(w => w.getMonth() === month) : weeks;

  const byMonth = useMemo(() => {
    const groups: { month: number; weeks: Date[] }[] = [];
    for (const w of shownWeeks) {
      const last = groups[groups.length - 1];
      if (last && last.month === w.getMonth()) last.weeks.push(w);
      else groups.push({ month: w.getMonth(), weeks: [w] });
    }
    return groups;
  }, [shownWeeks]);

  const step = (dir: 1 | -1) => {
    if (scope === "year") { setYear(year + dir); return; }
    const next = month + dir;
    if (next < 0) { setMonth(11); setYear(year - 1); }
    else if (next > 11) { setMonth(0); setYear(year + 1); }
    else setMonth(next);
  };

  const loggedHere = shownWeeks.filter(w => byWeek.has(iso(w))).length;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
        <div style={{ display: "flex", background: "rgba(0,0,0,0.05)", borderRadius: 10, padding: 3 }}>
          {(["month", "year"] as CalendarScope[]).map(s => (
            <button key={s} onClick={() => setScope(s)}
              style={{
                padding: "6px 14px", borderRadius: 8, fontSize: 12.5, fontWeight: 600,
                background: scope === s ? "#ffffff" : "transparent",
                color: scope === s ? INK : MUTED,
                boxShadow: scope === s ? "0 1px 3px rgba(0,0,0,0.10)" : "none",
              }}>
              {s === "month" ? "Monthly" : "Yearly"}
            </button>
          ))}
        </div>

        {/* The arrows and the label move as one unit, or the second arrow ends
            up alone on the next line on a phone. */}
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button onClick={() => step(-1)} aria-label={scope === "month" ? "Previous month" : "Previous year"}
            style={{ ...BTN_QUIET, padding: "6px 12px" }}>‹</button>
          <span style={{
            fontSize: 15, fontWeight: 700, color: INK, textAlign: "center",
            minWidth: scope === "month" ? 132 : 56,
          }}>
            {scope === "month" ? `${MONTHS[month]} ${year}` : year}
          </span>
          <button onClick={() => step(1)} aria-label={scope === "month" ? "Next month" : "Next year"}
            style={{ ...BTN_QUIET, padding: "6px 12px" }}>›</button>
        </div>

        <button onClick={() => onOpen(thisMonday)} style={{ ...BTN_PRIMARY, marginLeft: "auto", padding: "8px 16px", fontSize: 13 }}>
          Log this week
        </button>
      </div>

      {scope === "month" && (
        <p style={{ fontSize: 11, color: FAINT, marginBottom: 12 }}>
          {loggedHere} of {shownWeeks.length} week{shownWeeks.length === 1 ? "" : "s"} logged this month.
        </p>
      )}

      {shownWeeks.length === 0 && (
        <p style={{ fontSize: 12, color: FAINT, padding: "24px 0" }}>No weeks start in this month.</p>
      )}

      {byMonth.map(({ month: m, weeks: ws }) => (
        <section key={m} style={{ marginBottom: 22 }}>
          {/* The month view already names the month in its header. */}
          {scope === "year" && (
            <p style={{
              fontSize: 10, fontWeight: 700, letterSpacing: "0.09em", textTransform: "uppercase",
              color: FAINT, marginBottom: 8,
            }}>
              {MONTHS[m]}
            </p>
          )}
          {/* A month is four or five boxes, so they get the room — the year view
              stays compact because it has fifty-two of them. */}
          <div style={{
            display: "grid",
            gap: big ? 14 : 8,
            gridTemplateColumns: big
              ? "repeat(auto-fit, minmax(min(100%, 420px), 1fr))"
              : "repeat(auto-fill, minmax(148px, 1fr))",
          }}>
            {ws.map(w => (
              <WeekCard
                key={iso(w)}
                monday={w}
                entry={byWeek.get(iso(w))}
                isNow={iso(w) === thisMonday}
                big={big}
                unit={unit}
                lengthUnit={lengthUnit}
                onOpen={onOpen}
                cardRef={iso(w) === thisMonday ? currentRef : undefined}
              />
            ))}
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

/* ── shared plan-editor inputs ────────────────────────────────────────────── */

const CELL: React.CSSProperties = {
  padding: "8px 10px", borderRadius: 9, fontSize: 15, minWidth: 0,
  background: "#ffffff", border: "1px solid rgba(0,0,0,0.13)", color: INK, outline: "none",
};

function TextCell({ value, onChange, placeholder, list, style }: {
  value: string; onChange: (v: string) => void; placeholder?: string;
  list?: string; style?: React.CSSProperties;
}) {
  return (
    <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
      list={list} style={{ ...CELL, ...style }} />
  );
}

// Holds its own text so half-typed values like "12." survive a keystroke, and
// reports a number (or null) upwards.
function NumCell({ value, onChange, placeholder, style }: {
  value: number | null; onChange: (v: number | null) => void;
  placeholder?: string; style?: React.CSSProperties;
}) {
  const [text, setText] = useState(value === null ? "" : String(value));
  return (
    <input
      value={text}
      inputMode="decimal"
      placeholder={placeholder}
      onChange={e => {
        const t = e.target.value;
        setText(t);
        const n = t.trim() === "" ? null : Number(t);
        onChange(n !== null && Number.isFinite(n) ? n : null);
      }}
      style={{ ...CELL, ...style }}
    />
  );
}

function IconButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button onClick={onClick} aria-label={label} title={label}
      style={{
        padding: 8, borderRadius: 9, background: "rgba(0,0,0,0.05)", color: MUTED,
        lineHeight: 0, flexShrink: 0,
      }}>
      <svg width={14} height={14} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
        <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
      </svg>
    </button>
  );
}

function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button onClick={onClick}
      style={{
        ...BTN_QUIET, padding: "8px 14px", display: "inline-flex", alignItems: "center", gap: 6,
      }}>
      <svg width={13} height={13} fill="none" stroke="currentColor" strokeWidth={2.4} viewBox="0 0 24 24">
        <path strokeLinecap="round" d="M12 5v14M5 12h14" />
      </svg>
      {label}
    </button>
  );
}

// What one plan looks like on the index: a headline number, a couple of
// supporting figures, and a line of detail.
type PlanCard = {
  headline: string;
  headlineUnit: string;
  facts: { label: string; value: string }[];
  footer: string;
  notes: string;
};

// The index. Every plan as a card, the one you're running marked, and a slot at
// the end to start another. Picking a card opens it; making one active is a
// separate act, done inside.
function PlanGrid<T extends { id: string; name: string }>({
  items, activeId, noun, describe, onOpen, onAdd,
}: {
  items: T[];
  activeId: string | null;
  noun: string;
  describe: (item: T) => PlanCard;
  onOpen: (id: string) => void;
  onAdd: () => void;
}) {
  return (
    <div style={{
      display: "grid", gap: 14,
      gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 420px), 1fr))",
    }}>
      {items.map(item => {
        const card = describe(item);
        const isActive = item.id === activeId;
        return (
          <button
            key={item.id}
            onClick={() => onOpen(item.id)}
            style={{
              textAlign: "left", padding: "18px 20px", borderRadius: 18, minHeight: 186,
              background: CARD, border: BORDER, boxShadow: SHADOW,
              outline: isActive ? `2px solid ${INK}` : "none",
              outlineOffset: isActive ? 1 : 0,
              display: "flex", flexDirection: "column", gap: 8,
              transition: "transform 120ms ease",
            }}
            onMouseEnter={e => (e.currentTarget.style.transform = "translateY(-1px)")}
            onMouseLeave={e => (e.currentTarget.style.transform = "none")}
          >
            <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
              <span style={{
                fontSize: 16, fontWeight: 700, color: INK, letterSpacing: "-0.01em",
                overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              }}>
                {item.name || `Untitled ${noun}`}
              </span>
              {isActive && (
                <span style={{
                  fontSize: 9.5, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase",
                  padding: "2px 7px", borderRadius: 20, background: INK, color: "#ffffff", flexShrink: 0,
                }}>
                  Active
                </span>
              )}
            </span>

            <span style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
              <span style={{ fontSize: 34, fontWeight: 700, color: INK, letterSpacing: "-0.03em", lineHeight: 1.05 }}>
                {card.headline}
              </span>
              <span style={{ fontSize: 12.5, color: FAINT }}>{card.headlineUnit}</span>
            </span>

            <span style={{ display: "flex", gap: 18 }}>
              {card.facts.map(f => (
                <span key={f.label} style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                  <span style={{ fontSize: 10, fontWeight: 600, color: FAINT }}>{f.label}</span>
                  <span style={{ fontSize: 14, fontWeight: 600, color: "#3a3a3a" }}>{f.value}</span>
                </span>
              ))}
            </span>

            {card.notes && (
              <span style={{
                fontSize: 12, color: "#6b6b6b", lineHeight: 1.45,
                display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden",
              }}>
                {card.notes}
              </span>
            )}

            <span style={{ fontSize: 11.5, color: FAINT, marginTop: "auto" }}>{card.footer}</span>
          </button>
        );
      })}

      <button
        onClick={onAdd}
        style={{
          padding: "18px 20px", borderRadius: 18, minHeight: 186,
          background: "rgba(0,0,0,0.018)", border: "1px dashed rgba(0,0,0,0.16)",
          display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 8,
          color: MUTED, transition: "transform 120ms ease",
        }}
        onMouseEnter={e => (e.currentTarget.style.transform = "translateY(-1px)")}
        onMouseLeave={e => (e.currentTarget.style.transform = "none")}
      >
        <svg width={22} height={22} fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
          <path strokeLinecap="round" d="M12 5v14M5 12h14" />
        </svg>
        <span style={{ fontSize: 13, fontWeight: 600 }}>New {noun}</span>
      </button>
    </div>
  );
}

// The bar above an opened plan: the way back to the index, the name, and the
// three things you can do to the plan as a whole.
function PlanHeader({ name, isActive, noun, onBack, onRename, onSetActive, onDuplicate, onDelete }: {
  name: string;
  isActive: boolean;
  noun: string;
  onBack: () => void;
  onRename: (name: string) => void;
  onSetActive: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  return (
    <div style={{ background: CARD, border: BORDER, boxShadow: SHADOW, borderRadius: 18, padding: 14 }}>
      <button
        onClick={onBack}
        style={{
          display: "inline-flex", alignItems: "center", gap: 5, marginBottom: 12,
          fontSize: 12, fontWeight: 600, color: MUTED,
        }}>
        <svg width={13} height={13} fill="none" stroke="currentColor" strokeWidth={2.2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
        All {noun}s
      </button>

      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <TextCell value={name} onChange={onRename}
          placeholder={`${noun} name`} style={{ flex: 1, minWidth: 160, fontWeight: 600 }} />
        <button onClick={onSetActive} disabled={isActive}
          style={{
            ...BTN_QUIET,
            background: isActive ? "rgba(0,0,0,0.05)" : INK,
            color: isActive ? MUTED : "#ffffff",
            cursor: isActive ? "default" : "pointer",
          }}>
          {isActive ? "Active" : "Make active"}
        </button>
        <button onClick={onDuplicate} style={{ ...BTN_QUIET }}>Duplicate</button>
        <button onClick={onDelete}
          style={{ ...BTN_QUIET, background: "rgba(180,71,46,0.09)", color: "#b4472e" }}>
          Delete
        </button>
      </div>
    </div>
  );
}

function PlanNotes({ value, onChange, placeholder }: {
  value: string; onChange: (v: string) => void; placeholder: string;
}) {
  return (
    <div>
      <p style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.09em", textTransform: "uppercase", color: FAINT, marginBottom: 8 }}>
        Notes
      </p>
      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        rows={3}
        placeholder={placeholder}
        style={{
          width: "100%", padding: "10px 12px", borderRadius: 12, fontSize: 14, resize: "vertical",
          background: CARD, border: BORDER, color: INK, outline: "none", fontFamily: "inherit",
        }}
      />
    </div>
  );
}

/* ── diet ─────────────────────────────────────────────────────────────────── */

function DietTab({ doc, onChange }: { doc: DietDoc; onChange: (d: DietDoc) => void }) {
  // null = showing the index. Opening a card sets it; the back button clears it.
  const [openId, setOpenId] = useState<string | null>(null);
  const plan = doc.plans.find(p => p.id === openId) ?? null;

  const setPlans = (plans: DietPlan[], activeId = doc.activeId) => onChange({ plans, activeId });

  const addPlan = () => {
    const created = emptyDietPlan(`Plan ${doc.plans.length + 1}`);
    setOpenId(created.id);
    // The very first plan becomes the active one — nothing else could be.
    onChange({ plans: [...doc.plans, created], activeId: doc.activeId ?? created.id });
  };

  if (!plan && doc.plans.length === 0) {
    return (
      <div style={{
        background: CARD, border: BORDER, boxShadow: SHADOW, borderRadius: 18,
        padding: 48, textAlign: "center",
      }}>
        <p style={{ fontSize: 14, fontWeight: 600, color: INK }}>No diet plans yet</p>
        <p style={{ fontSize: 12, color: FAINT, marginTop: 6, marginBottom: 16 }}>
          Make one for each way you eat — bulk, cut, maintenance — and mark the one you&apos;re on.
        </p>
        <AddButton label="Create a diet plan" onClick={addPlan} />
      </div>
    );
  }

  if (!plan) {
    return (
      <PlanGrid
        items={doc.plans}
        activeId={doc.activeId}
        noun="plan"
        onOpen={setOpenId}
        onAdd={addPlan}
        describe={p => {
          const items = p.meals.flatMap(m => m.items);
          const planned = (key: Macro) => items.reduce((s, i) => s + (i[key] ?? 0), 0);
          // The target is the point of the plan; what the meals add up to is
          // the fallback for a plan that has food in it but no target set.
          const kcal = p.targets.kcal ?? (items.length ? planned("kcal") : null);
          const protein = p.targets.protein ?? (items.length ? planned("protein") : null);
          return {
            headline: kcal === null ? "—" : fmt(kcal, 0),
            headlineUnit: "kcal a day",
            facts: [
              { label: "Protein", value: protein === null ? "—" : `${fmt(protein, 0)} g` },
              { label: "Meals", value: String(p.meals.length) },
            ],
            footer: items.length
              ? `${items.length} food${items.length === 1 ? "" : "s"}`
              : "Nothing added yet",
            notes: p.notes,
          };
        }}
      />
    );
  }

  const update = (patch: Partial<DietPlan>) =>
    setPlans(doc.plans.map(p => (p.id === plan.id ? { ...p, ...patch } : p)));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <PlanHeader
        name={plan.name}
        isActive={plan.id === doc.activeId}
        noun="plan"
        onBack={() => setOpenId(null)}
        onRename={name => update({ name })}
        onSetActive={() => setPlans(doc.plans, plan.id)}
        onDuplicate={() => {
          const copy = cloneDietPlan(plan, `${plan.name} copy`);
          setOpenId(copy.id);
          setPlans([...doc.plans, copy]);
        }}
        onDelete={() => {
          const rest = doc.plans.filter(p => p.id !== plan.id);
          setOpenId(null);
          onChange({
            plans: rest,
            activeId: doc.activeId === plan.id ? rest[0]?.id ?? null : doc.activeId,
          });
        }}
      />
      {/* Keyed by plan: the number inputs hold their own text, so without this
          switching plans would leave the previous plan's figures on screen. */}
      <DietPlanEditor key={plan.id} plan={plan} onChange={update} />
    </div>
  );
}

function DietPlanEditor({ plan, onChange: update }: {
  plan: DietPlan; onChange: (patch: Partial<DietPlan>) => void;
}) {
  const shown = macrosFor(plan);

  const onChange = (next: DietPlan) => update(next);

  const totals = useMemo(() => {
    const out: Record<Macro, number> = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
    for (const meal of plan.meals) {
      for (const item of meal.items) {
        for (const { key } of MACROS) out[key] += item[key] ?? 0;
      }
    }
    return out;
  }, [plan]);

  const mealTotal = (meal: Meal, key: Macro) =>
    meal.items.reduce((sum, it) => sum + (it[key] ?? 0), 0);

  const setMeals = (meals: Meal[]) => onChange({ ...plan, meals });

  const patchMeal = (id: string, patch: Partial<Meal>) =>
    setMeals(plan.meals.map(m => (m.id === id ? { ...m, ...patch } : m)));

  const patchItem = (mealId: string, itemId: string, patch: Partial<DietItem>) =>
    setMeals(plan.meals.map(m => m.id !== mealId ? m : {
      ...m, items: m.items.map(it => (it.id === itemId ? { ...it, ...patch } : it)),
    }));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>

      {/* Targets vs. what the plan actually adds up to */}
      <div style={{ background: CARD, border: BORDER, boxShadow: SHADOW, borderRadius: 18, padding: 18 }}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap", marginBottom: 2 }}>
          <p style={{ fontSize: 13, fontWeight: 700, color: INK }}>Daily targets</p>
          <div style={{ display: "flex", gap: 12, marginLeft: "auto" }}>
            {([["showCarbs", "Carbs"], ["showFat", "Fat"]] as const).map(([key, label]) => (
              <label key={key} style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer" }}>
                <input type="checkbox" checked={plan[key]}
                  onChange={e => update({ [key]: e.target.checked } as Partial<DietPlan>)} />
                <span style={{ fontSize: 11.5, color: MUTED }}>Track {label.toLowerCase()}</span>
              </label>
            ))}
          </div>
        </div>
        <p style={{ fontSize: 11, color: FAINT, marginBottom: 14 }}>
          Nothing here is required — fill in only what you count. What the meals
          below add up to is shown against each target.
        </p>
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))" }}>
          {shown.map(({ key, label, unit }) => {
            const target = plan.targets[key];
            const actual = totals[key];
            const pct = target && target > 0 ? Math.min(actual / target, 1.35) : null;
            const over = target !== null && target > 0 && actual > target * 1.02;
            const under = target !== null && target > 0 && actual < target * 0.98;
            return (
              <div key={key}>
                <label style={{ display: "block" }}>
                  <span style={{ fontSize: 11, fontWeight: 600, color: MUTED, display: "block", marginBottom: 4 }}>
                    {label} <span style={{ color: FAINT, fontWeight: 500 }}>({unit})</span>
                  </span>
                  <NumCell
                    value={target}
                    onChange={v => onChange({ ...plan, targets: { ...plan.targets, [key]: v } })}
                    placeholder="—"
                    style={{ width: "100%" }}
                  />
                </label>
                <div style={{ marginTop: 7 }}>
                  <div style={{ height: 4, borderRadius: 3, background: "rgba(0,0,0,0.07)", overflow: "hidden" }}>
                    <div style={{
                      height: "100%", width: `${Math.min((pct ?? 0) * 100, 100)}%`,
                      background: pct === null ? "transparent" : over ? "#b4472e" : INK,
                      transition: "width 200ms ease",
                    }} />
                  </div>
                  <p style={{ fontSize: 10.5, color: over ? "#b4472e" : under ? MUTED : "#1a7f4b", marginTop: 4 }}>
                    {fmt(actual, 0)} planned{target ? ` · ${fmtDelta(actual - target, 0)}` : ""}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Meals */}
      {plan.meals.map(meal => (
        <div key={meal.id} style={{ background: CARD, border: BORDER, boxShadow: SHADOW, borderRadius: 18, padding: 16 }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
            <TextCell value={meal.name} onChange={v => patchMeal(meal.id, { name: v })}
              placeholder="Meal name" style={{ flex: 1, fontWeight: 600 }} />
            <TextCell value={meal.time} onChange={v => patchMeal(meal.id, { time: v })}
              placeholder="Time" style={{ width: 92, fontSize: 13 }} />
            <IconButton label={`Remove ${meal.name || "meal"}`}
              onClick={() => setMeals(plan.meals.filter(m => m.id !== meal.id))} />
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {meal.items.map(item => (
              <div key={item.id} style={{
                padding: 10, borderRadius: 12, background: "rgba(0,0,0,0.022)",
                display: "flex", flexDirection: "column", gap: 7,
              }}>
                <div style={{ display: "flex", gap: 7 }}>
                  <TextCell value={item.name} onChange={v => patchItem(meal.id, item.id, { name: v })}
                    placeholder="Food" style={{ flex: 1 }} />
                  <TextCell value={item.qty} onChange={v => patchItem(meal.id, item.id, { qty: v })}
                    placeholder="Qty" style={{ width: 88, fontSize: 13 }} />
                  <IconButton label="Remove item"
                    onClick={() => patchMeal(meal.id, { items: meal.items.filter(i => i.id !== item.id) })} />
                </div>
                <div style={{ display: "grid", gap: 7, gridTemplateColumns: `repeat(${shown.length}, 1fr)` }}>
                  {shown.map(({ key, unit }) => (
                    <NumCell key={key} value={item[key]}
                      onChange={v => patchItem(meal.id, item.id, { [key]: v } as Partial<DietItem>)}
                      placeholder={unit} style={{ fontSize: 13, textAlign: "center" }} />
                  ))}
                </div>
              </div>
            ))}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12, flexWrap: "wrap" }}>
            <AddButton label="Add food"
              onClick={() => patchMeal(meal.id, {
                items: [...meal.items, { id: uid(), name: "", qty: "", kcal: null, protein: null, carbs: null, fat: null }],
              })} />
            {meal.items.length > 0 && (
              <span style={{ fontSize: 11, color: FAINT, marginLeft: "auto" }}>
                {shown.map(({ key, unit }) =>
                  `${fmt(mealTotal(meal, key), 0)}${key === "kcal" ? " kcal" : unit}`).join(" · ")}
              </span>
            )}
          </div>
        </div>
      ))}

      <div>
        <AddButton label="Add meal"
          onClick={() => setMeals([...plan.meals, { id: uid(), name: "", time: "", items: [] }])} />
      </div>

      <PlanNotes value={plan.notes} onChange={v => onChange({ ...plan, notes: v })}
        placeholder="Supplements, water, refeed days, anything that isn't a meal." />
    </div>
  );
}

/* ── split ────────────────────────────────────────────────────────────────── */

function SplitTab({ doc, trackedExercises, onChange }: {
  doc: SplitDoc; trackedExercises: string[]; onChange: (d: SplitDoc) => void;
}) {
  // null = showing the index. Opening a card sets it; the back button clears it.
  const [openId, setOpenId] = useState<string | null>(null);
  const prog = doc.programmes.find(p => p.id === openId) ?? null;

  const setProgrammes = (programmes: SplitProgramme[], activeId = doc.activeId) =>
    onChange({ programmes, activeId });

  const addProgramme = () => {
    const created = emptyProgramme(`Programme ${doc.programmes.length + 1}`);
    setOpenId(created.id);
    onChange({ programmes: [...doc.programmes, created], activeId: doc.activeId ?? created.id });
  };

  if (!prog && doc.programmes.length === 0) {
    return (
      <div style={{
        background: CARD, border: BORDER, boxShadow: SHADOW, borderRadius: 18,
        padding: 48, textAlign: "center",
      }}>
        <p style={{ fontSize: 14, fontWeight: 600, color: INK }}>No programmes yet</p>
        <p style={{ fontSize: 12, color: FAINT, marginTop: 6, marginBottom: 16, maxWidth: 380, marginLeft: "auto", marginRight: "auto" }}>
          Build one per way of training — low volume high intensity, an Arnold
          split, push pull legs — and mark the one you&apos;re running.
        </p>
        <AddButton label="Create a programme" onClick={addProgramme} />
      </div>
    );
  }

  if (!prog) {
    return (
      <PlanGrid
        items={doc.programmes}
        activeId={doc.activeId}
        noun="programme"
        onOpen={setOpenId}
        onAdd={addProgramme}
        describe={p => {
          const training = p.days.filter(d => !d.rest);
          const exercises = training.reduce((n, d) => n + d.exercises.length, 0);
          const titles = training.map(d => d.title.trim()).filter(Boolean);
          return {
            headline: String(training.length),
            headlineUnit: training.length === 1 ? "training day" : "training days",
            facts: [
              { label: "Exercises", value: String(exercises) },
              { label: "Rest", value: String(p.days.length - training.length) },
            ],
            footer: titles.length ? titles.join(" · ") : "No days named yet",
            notes: p.notes,
          };
        }}
      />
    );
  }

  const update = (patch: Partial<SplitProgramme>) =>
    setProgrammes(doc.programmes.map(p => (p.id === prog.id ? { ...p, ...patch } : p)));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <PlanHeader
        name={prog.name}
        isActive={prog.id === doc.activeId}
        noun="programme"
        onBack={() => setOpenId(null)}
        onRename={name => update({ name })}
        onSetActive={() => setProgrammes(doc.programmes, prog.id)}
        onDuplicate={() => {
          const copy = cloneProgramme(prog, `${prog.name} copy`);
          setOpenId(copy.id);
          setProgrammes([...doc.programmes, copy]);
        }}
        onDelete={() => {
          const rest = doc.programmes.filter(p => p.id !== prog.id);
          setOpenId(null);
          onChange({
            programmes: rest,
            activeId: doc.activeId === prog.id ? rest[0]?.id ?? null : doc.activeId,
          });
        }}
      />
      <ProgrammeEditor
        key={prog.id}
        prog={prog}
        trackedExercises={trackedExercises}
        onChange={update}
      />
    </div>
  );
}

function ProgrammeEditor({ prog, trackedExercises, onChange: update }: {
  prog: SplitProgramme; trackedExercises: string[]; onChange: (patch: Partial<SplitProgramme>) => void;
}) {
  const plan = prog;
  const onChange = (next: SplitProgramme) => update(next);

  const [bulkSets, setBulkSets] = useState("");
  const [bulkReps, setBulkReps] = useState("");

  const patchDay = (id: string, patch: Partial<SplitDay>) =>
    onChange({ ...plan, days: plan.days.map(d => (d.id === id ? { ...d, ...patch } : d)) });

  const exerciseCount = plan.days.reduce((n, d) => n + (d.rest ? 0 : d.exercises.length), 0);

  // One prescription across a whole programme is the normal case — 4×8 for
  // everything, then tweak the handful that differ.
  const applyToAll = () => {
    if (!bulkSets.trim() && !bulkReps.trim()) return;
    onChange({
      ...plan,
      days: plan.days.map(d => d.rest ? d : {
        ...d,
        exercises: d.exercises.map(e => ({
          ...e,
          sets: bulkSets.trim() || e.sets,
          reps: bulkReps.trim() || e.reps,
        })),
      }),
    });
  };

  const trainingDays = plan.days.filter(d => !d.rest && d.exercises.length > 0).length;
  const listId = "health-tracker-exercises";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <datalist id={listId}>
        {trackedExercises.map(x => <option key={x} value={x} />)}
      </datalist>

      <div style={{
        background: CARD, border: BORDER, boxShadow: SHADOW, borderRadius: 18, padding: 14,
        display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap",
      }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: INK }}>Set every exercise to</span>
        <TextCell value={bulkSets} onChange={setBulkSets} placeholder="Sets"
          style={{ width: 74, fontSize: 13, textAlign: "center" }} />
        <span style={{ fontSize: 12, color: FAINT }}>×</span>
        <TextCell value={bulkReps} onChange={setBulkReps} placeholder="Reps"
          style={{ width: 84, fontSize: 13, textAlign: "center" }} />
        <button onClick={applyToAll}
          disabled={!exerciseCount || (!bulkSets.trim() && !bulkReps.trim())}
          style={{
            ...BTN_PRIMARY, padding: "8px 16px", fontSize: 13,
            opacity: !exerciseCount || (!bulkSets.trim() && !bulkReps.trim()) ? 0.4 : 1,
          }}>
          Apply to all {exerciseCount || ""}
        </button>
        <span style={{ fontSize: 11, color: FAINT, flexBasis: "100%" }}>
          Overwrites sets and reps on every exercise in {plan.name || "this programme"}.
          Leave one box empty to change only the other.
        </span>
      </div>

      <p style={{ fontSize: 11, color: FAINT }}>
        {trainingDays} training day{trainingDays === 1 ? "" : "s"} a week.
        Exercises you also log on the calendar will suggest themselves as you type.
      </p>

      {plan.days.map(day => (
        <div key={day.id} style={{
          background: day.rest ? "rgba(0,0,0,0.022)" : CARD,
          border: day.rest ? "1px dashed rgba(0,0,0,0.13)" : BORDER,
          boxShadow: day.rest ? "none" : SHADOW,
          borderRadius: 18, padding: 16,
        }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: day.rest ? FAINT : INK, width: 88, flexShrink: 0 }}>
              {day.weekday}
            </span>
            {!day.rest && (
              <TextCell value={day.title} onChange={v => patchDay(day.id, { title: v })}
                placeholder="Push, Pull, Legs…" style={{ flex: 1, minWidth: 140, fontWeight: 600 }} />
            )}
            {day.rest && <span style={{ flex: 1, fontSize: 13, color: FAINT }}>Rest</span>}
            <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", flexShrink: 0 }}>
              <input type="checkbox" checked={day.rest}
                onChange={e => patchDay(day.id, { rest: e.target.checked })} />
              <span style={{ fontSize: 11.5, color: MUTED }}>Rest day</span>
            </label>
          </div>

          {!day.rest && (
            <>
              {day.exercises.length > 0 && (
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 12 }}>
                  {day.exercises.map(ex => (
                    <div key={ex.id} style={{
                      padding: 10, borderRadius: 12, background: "rgba(0,0,0,0.022)",
                      display: "flex", flexDirection: "column", gap: 7,
                    }}>
                      <div style={{ display: "flex", gap: 7 }}>
                        <TextCell value={ex.name} list={listId}
                          onChange={v => patchDay(day.id, {
                            exercises: day.exercises.map(e => (e.id === ex.id ? { ...e, name: v } : e)),
                          })}
                          placeholder="Exercise" style={{ flex: 1 }} />
                        <TextCell value={ex.sets}
                          onChange={v => patchDay(day.id, {
                            exercises: day.exercises.map(e => (e.id === ex.id ? { ...e, sets: v } : e)),
                          })}
                          placeholder="Sets" style={{ width: 68, fontSize: 13, textAlign: "center" }} />
                        <TextCell value={ex.reps}
                          onChange={v => patchDay(day.id, {
                            exercises: day.exercises.map(e => (e.id === ex.id ? { ...e, reps: v } : e)),
                          })}
                          placeholder="Reps" style={{ width: 78, fontSize: 13, textAlign: "center" }} />
                        <IconButton label="Remove exercise"
                          onClick={() => patchDay(day.id, { exercises: day.exercises.filter(e => e.id !== ex.id) })} />
                      </div>
                      <TextCell value={ex.notes}
                        onChange={v => patchDay(day.id, {
                          exercises: day.exercises.map(e => (e.id === ex.id ? { ...e, notes: v } : e)),
                        })}
                        placeholder="Tempo, rest, cues — optional" style={{ fontSize: 13 }} />
                    </div>
                  ))}
                </div>
              )}
              <div style={{ marginTop: 12 }}>
                <AddButton label="Add exercise"
                  onClick={() => patchDay(day.id, {
                    exercises: [...day.exercises, { id: uid(), name: "", sets: "", reps: "", notes: "" }],
                  })} />
              </div>
            </>
          )}
        </div>
      ))}

      <PlanNotes value={plan.notes} onChange={v => onChange({ ...plan, notes: v })}
        placeholder="Warm-ups, cardio, deload weeks, anything that isn't a lift." />
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

  // How many lifts the weekly log gains from the active programme beyond what is
  // listed here — the point being that this list does not have to repeat them.
  const fromProgramme = useMemo(() => {
    const base = mergeExerciseNames(exercises);
    return mergeExerciseNames(base, activeProgrammeExercises(settings.split_plan)).length - base.length;
  }, [exercises, settings.split_plan]);

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
      <p style={{ fontSize: 11, color: FAINT, marginTop: 8, lineHeight: 1.5 }}>
        {fromProgramme > 0 && (
          <>
            Your active programme adds {fromProgramme} more on top of these, so you
            only need to list lifts here that it doesn&apos;t already cover.{" "}
          </>
        )}
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
            <code> &amp;format=json</code> to include your diet plan and split as well.
            Turning it off breaks the old link for good.
          </p>
        </div>
      ) : (
        <div>
          <button onClick={() => patch({ share: true })} style={{ ...BTN_QUIET }}>
            Create a read-only link
          </button>
          <p style={{ fontSize: 11, color: FAINT, marginTop: 8, lineHeight: 1.5 }}>
            Makes a private URL that returns your weekly log as a spreadsheet — and,
            in JSON form, your diet plan and split too. For handing to Claude or a
            Google Sheet. Off by default.
          </p>
        </div>
      )}
    </Sheet>
  );
}


