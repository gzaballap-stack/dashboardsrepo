"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/* ────────────────────────────────────────────────────────────────────────────
   Profit and Loss

   Three tabs over one person's lines:
     Month    — a month's sheet: clients (revenue), business expenses, and
                personal spending split necessary / leisure.
     Overview — every month side by side, with totals, averages and extremes.
     Clients  — what each client has paid, for how many months, and how many
                stay from one month to the next — over any time frame.

   Profit is revenue − expenses. Personal spending is shown beside it and never
   subtracted. Every figure on the Overview and Clients tabs is summed from the
   month lines — nothing is stored twice. Lines are scoped to the signed-in
   user by the API; nobody shares a sheet.
   ──────────────────────────────────────────────────────────────────────────── */

type Kind = "revenue" | "expense" | "personal";

type Line = {
  id: string;
  month: string;        // YYYY-MM-01
  kind: Kind;
  label: string;
  amount: number;
  leisure: boolean;
  position: number;
};

type Totals = {
  revenue: number; expenses: number; personal: number;
  necessary: number; leisure: number;
  profit: number; margin: number | null;
};

type MonthRow = Totals & { month: string };

const CARD = "#ffffff";
const BORDER = "1px solid rgba(0,0,0,0.07)";
const SHADOW = "0 1px 2px rgba(0,0,0,0.03), 0 10px 28px -12px rgba(0,0,0,0.10)";
const INK = "#111111";
const MUTED = "#767676";
const FAINT = "#a8a8a8";
const GOOD = "#1a7f4b";
const BAD = "#b4472e";
const GREY_BAR = "#8c8c8c";

const MONTHS = ["January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];
const MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/* ── helpers ──────────────────────────────────────────────────────────────── */

function money(n: number): string {
  const whole = Math.abs(n % 1) < 0.005;
  const digits = whole ? 0 : 2;
  const text = Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return `${n < 0 ? "−" : ""}$${text}`;
}

const pct = (v: number | null) => (v === null ? "n/a" : `${v < 0 ? "−" : ""}${Math.abs(v * 100).toFixed(1)}%`);

const monthKey = (year: number, month0: number) => `${year}-${String(month0 + 1).padStart(2, "0")}-01`;
const partsOf = (key: string) => ({ year: Number(key.slice(0, 4)), month0: Number(key.slice(5, 7)) - 1 });

function shiftMonth(key: string, by: number): string {
  const { year, month0 } = partsOf(key);
  const d = new Date(year, month0 + by, 1);
  return monthKey(d.getFullYear(), d.getMonth());
}

function monthName(key: string, short = false): string {
  const { year, month0 } = partsOf(key);
  return `${(short ? MONTHS_SHORT : MONTHS)[month0]} ${year}`;
}

// "$1,200.50" → 1200.5. Blank is zero; anything unreadable is null and the
// save is refused rather than stored as 0.
function parseAmount(text: string): number | null {
  const clean = text.replace(/[$,\s]/g, "");
  if (!clean) return 0;
  const n = Number(clean);
  return Number.isFinite(n) ? n : null;
}

function totalsOf(lines: Line[]): Totals {
  let revenue = 0, expenses = 0, necessary = 0, leisure = 0;
  for (const l of lines) {
    if (l.kind === "revenue") revenue += l.amount;
    else if (l.kind === "expense") expenses += l.amount;
    else if (l.leisure) leisure += l.amount;
    else necessary += l.amount;
  }
  const profit = revenue - expenses;
  return {
    revenue, expenses, necessary, leisure,
    personal: necessary + leisure,
    profit,
    margin: revenue ? profit / revenue : null,
  };
}

function sumRows(rows: MonthRow[]): Totals {
  const t = { revenue: 0, expenses: 0, personal: 0, necessary: 0, leisure: 0 };
  for (const r of rows) {
    t.revenue += r.revenue; t.expenses += r.expenses; t.personal += r.personal;
    t.necessary += r.necessary; t.leisure += r.leisure;
  }
  const profit = t.revenue - t.expenses;
  return { ...t, profit, margin: t.revenue ? profit / t.revenue : null };
}

// Round a chart ceiling up to a figure that divides into clean gridlines.
function niceCeil(v: number): number {
  if (v <= 0) return 1000;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  for (const step of [1, 2, 2.5, 5, 10]) if (v <= step * pow) return step * pow;
  return 10 * pow;
}

const compact = (n: number) => (n >= 1000 ? `$${(n / 1000).toFixed(n % 1000 ? 1 : 0)}k` : `$${n}`);

/* ── small pieces ─────────────────────────────────────────────────────────── */

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "good" | "bad" }) {
  return (
    <div style={{ background: CARD, border: BORDER, boxShadow: SHADOW, borderRadius: 16, padding: "14px 16px" }}>
      <p style={{ fontSize: 11, fontWeight: 600, color: MUTED, marginBottom: 8 }}>{label}</p>
      <p style={{
        fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em",
        color: tone === "good" ? GOOD : tone === "bad" ? BAD : INK,
      }}>{value}</p>
      {sub && <p style={{ fontSize: 11, color: FAINT, marginTop: 6 }}>{sub}</p>}
    </div>
  );
}

const TILE_GRID: React.CSSProperties = {
  display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12,
};

const INPUT: React.CSSProperties = {
  padding: "7px 7px", borderRadius: 8, fontSize: 13, color: INK,
  background: "transparent", border: "1px solid transparent", outline: "none",
  fontFamily: "inherit", minWidth: 0,
};

const BTN_QUIET: React.CSSProperties = {
  padding: "7px 12px", borderRadius: 9, fontSize: 12.5, fontWeight: 600,
  background: "rgba(0,0,0,0.06)", color: "#4a4a4a",
};

// One editable line. Saves on blur (or Enter); the parent re-keys the row when
// the saved values change, so local state never drifts from what is stored.
function Row({ line, onPatch, onRemove, move }: {
  line: Line;
  onPatch: (id: string, patch: Partial<Pick<Line, "label" | "amount" | "leisure">>) => void;
  onRemove: (id: string) => void;
  move?: { title: string; onMove: () => void };
}) {
  const [label, setLabel] = useState(line.label);
  const [amount, setAmount] = useState(String(line.amount));
  const [bad, setBad] = useState(false);

  const commitLabel = () => {
    const next = label.trim();
    if (next !== line.label) onPatch(line.id, { label: next });
  };
  const commitAmount = () => {
    const next = parseAmount(amount);
    if (next === null) { setBad(true); return; }
    setBad(false);
    if (next !== line.amount) onPatch(line.id, { amount: next });
  };
  const blurOnEnter = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") e.currentTarget.blur();
  };

  return (
    <div className="pnl-row" style={{ display: "flex", alignItems: "center", gap: 4 }}>
      <input value={label} onChange={e => setLabel(e.target.value)} onBlur={commitLabel} onKeyDown={blurOnEnter}
        aria-label="Name" placeholder="Name" className="pnl-input" style={{ ...INPUT, flex: 1, textOverflow: "ellipsis" }} />
      <span style={{ fontSize: 13, color: FAINT }}>$</span>
      <input value={amount} onChange={e => { setAmount(e.target.value); setBad(false); }} onBlur={commitAmount} onKeyDown={blurOnEnter}
        aria-label={`Amount for ${line.label || "line"}`} inputMode="decimal" className="pnl-input"
        style={{
          ...INPUT, width: 78, textAlign: "right", fontVariantNumeric: "tabular-nums",
          ...(bad ? { borderColor: BAD, color: BAD } : null),
        }} />
      {move && (
        <button onClick={move.onMove} title={move.title} aria-label={move.title} className="pnl-ghost"
          style={{ padding: 5, borderRadius: 7, color: FAINT, lineHeight: 0 }}>
          <svg width={14} height={14} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M7 4v16m0 0l-4-4m4 4l4-4M17 20V4m0 0l-4 4m4-4l4 4" />
          </svg>
        </button>
      )}
      <button onClick={() => onRemove(line.id)} title="Delete" aria-label={`Delete ${line.label || "line"}`} className="pnl-ghost"
        style={{ padding: 5, borderRadius: 7, color: FAINT, lineHeight: 0 }}>
        <svg width={14} height={14} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </div>
  );
}

function AddRow({ placeholder, onAdd }: { placeholder: string; onAdd: (label: string, amount: number) => Promise<boolean> }) {
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [bad, setBad] = useState(false);
  const [busy, setBusy] = useState(false);
  const labelRef = useRef<HTMLInputElement>(null);

  const submit = async () => {
    if (busy || (!label.trim() && !amount.trim())) return;
    const value = parseAmount(amount);
    if (value === null) { setBad(true); return; }
    setBusy(true);
    const ok = await onAdd(label.trim(), value);
    setBusy(false);
    if (ok) { setLabel(""); setAmount(""); labelRef.current?.focus(); }
  };
  const onKey = (e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === "Enter") submit(); };

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 4, marginTop: 6 }}>
      <input ref={labelRef} value={label} onChange={e => setLabel(e.target.value)} onKeyDown={onKey}
        placeholder={placeholder} aria-label={placeholder}
        style={{ ...INPUT, flex: 1, background: "rgba(0,0,0,0.035)" }} />
      <span style={{ fontSize: 13, color: FAINT }}>$</span>
      <input value={amount} onChange={e => { setAmount(e.target.value); setBad(false); }} onKeyDown={onKey}
        placeholder="0" aria-label="Amount" inputMode="decimal"
        style={{
          ...INPUT, width: 78, textAlign: "right", background: "rgba(0,0,0,0.035)",
          ...(bad ? { borderColor: BAD, color: BAD } : null),
        }} />
      <button onClick={submit} disabled={busy}
        style={{ ...BTN_QUIET, padding: "7px 10px", opacity: busy ? 0.5 : 1 }}>
        Add
      </button>
    </div>
  );
}

function Section({ title, caption, total, children }: {
  title: string; caption: string; total: number; children: React.ReactNode;
}) {
  return (
    <div style={{ background: CARD, border: BORDER, boxShadow: SHADOW, borderRadius: 16, padding: 16, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginBottom: 10 }}>
        <h3 style={{ fontSize: 12, fontWeight: 700, color: INK, letterSpacing: "0.08em" }}>{title}</h3>
        <span style={{ fontSize: 12, color: MUTED, flex: 1 }}>{caption}</span>
        <span style={{ fontSize: 15, fontWeight: 700, color: INK, fontVariantNumeric: "tabular-nums" }}>{money(total)}</span>
      </div>
      {children}
    </div>
  );
}

/* ── chart ────────────────────────────────────────────────────────────────── */

type ChartCol = {
  month: string;
  // Bars side by side; each bar is a stack of segments, bottom first.
  groups: { value: number; color: string }[][];
  tip: { l: string; v: string }[];
  aria: string;
};

// Month-by-month bars on one shared scale. Hover (or tap) a month for its
// figures; click it to open that month.
function BarChart({ title, legend, cols, top, tick, onPick }: {
  title: string;
  legend: { c: string; l: string }[];
  cols: ChartCol[];
  top: number;
  tick: (n: number) => string;
  onPick: (month: string) => void;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const ticks = [1, 0.75, 0.5, 0.25, 0];
  const PLOT = 200;

  return (
    <div style={{ background: CARD, border: BORDER, boxShadow: SHADOW, borderRadius: 16, padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", marginBottom: 14 }}>
        <h3 style={{ fontSize: 13, fontWeight: 700, color: INK, flex: 1 }}>{title}</h3>
        {legend.map(s => (
          <span key={s.l} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: MUTED }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: s.c }} />{s.l}
          </span>
        ))}
      </div>

      <div style={{ display: "flex", gap: 8, paddingTop: 6 }}>
        <div style={{ height: PLOT, display: "flex", flexDirection: "column", justifyContent: "space-between", flexShrink: 0 }}>
          {ticks.map(t => (
            <span key={t} style={{ fontSize: 10, color: FAINT, lineHeight: "1px", textAlign: "right", fontVariantNumeric: "tabular-nums" }}>
              {tick(top * t)}
            </span>
          ))}
        </div>

        <div style={{ flex: 1, minWidth: 0, overflowX: "auto" }}>
          <div style={{ minWidth: cols.length * 26, position: "relative" }}>
            <div style={{ position: "absolute", inset: 0, height: PLOT, display: "flex", flexDirection: "column", justifyContent: "space-between", pointerEvents: "none" }}>
              {ticks.map(t => <div key={t} style={{ height: 1, background: t === 0 ? "rgba(0,0,0,0.18)" : "rgba(0,0,0,0.06)" }} />)}
            </div>

            <div style={{ display: "flex" }} onMouseLeave={() => setHover(null)}>
              {cols.map((c, i) => {
                const { year, month0 } = partsOf(c.month);
                const side = i < cols.length / 3 ? { left: 0 } : i > (cols.length * 2) / 3 ? { right: 0 } : { left: "50%", transform: "translateX(-50%)" };
                return (
                  <button key={c.month} onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}
                    onClick={() => onPick(c.month)} aria-label={c.aria}
                    style={{ flex: 1, minWidth: 0, padding: 0, position: "relative", cursor: "pointer", background: "transparent" }}>
                    <div style={{
                      height: PLOT, display: "flex", alignItems: "flex-end", justifyContent: "center", gap: 2,
                      background: hover === i ? "rgba(0,0,0,0.04)" : "transparent", borderRadius: 6,
                    }}>
                      {c.groups.map((stack, g) => {
                        const shown = stack.filter(seg => seg.value > 0);
                        return (
                          <div key={g} style={{
                            width: `${64 / c.groups.length}%`, maxWidth: c.groups.length === 1 ? 24 : 16,
                            height: "100%", display: "flex", flexDirection: "column-reverse", gap: 2,
                          }}>
                            {shown.map((seg, k) => (
                              <div key={k} style={{
                                height: `${(seg.value / top) * 100}%`, minHeight: 2, background: seg.color,
                                borderRadius: k === shown.length - 1 ? "4px 4px 0 0" : 0,
                              }} />
                            ))}
                          </div>
                        );
                      })}
                    </div>
                    <div style={{ fontSize: 10, color: hover === i ? INK : MUTED, marginTop: 6, lineHeight: 1.3 }}>
                      {MONTHS_SHORT[month0]}
                      <div style={{ color: FAINT, minHeight: 13 }}>{month0 === 0 || i === 0 ? year : ""}</div>
                    </div>

                    {hover === i && (
                      <div style={{
                        position: "absolute", top: 0, zIndex: 2, ...side, pointerEvents: "none",
                        background: INK, color: "#ffffff", borderRadius: 10, padding: "9px 11px",
                        fontSize: 11.5, textAlign: "left", whiteSpace: "nowrap", boxShadow: "0 8px 24px rgba(0,0,0,0.22)",
                      }}>
                        <div style={{ fontWeight: 700, marginBottom: 5 }}>{monthName(c.month)}</div>
                        {c.tip.map(x => (
                          <div key={x.l} style={{ display: "flex", justifyContent: "space-between", gap: 18, lineHeight: 1.6 }}>
                            <span style={{ opacity: 0.65 }}>{x.l}</span>
                            <span style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{x.v}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── tables ───────────────────────────────────────────────────────────────── */

const TH: React.CSSProperties = {
  fontSize: 11, fontWeight: 600, color: MUTED, textAlign: "right", padding: "8px 12px", whiteSpace: "nowrap",
};
const TD: React.CSSProperties = {
  fontSize: 13, color: INK, textAlign: "right", padding: "9px 12px", whiteSpace: "nowrap",
  fontVariantNumeric: "tabular-nums", borderTop: "1px solid rgba(0,0,0,0.05)",
};

const profitColor = (n: number) => (n < 0 ? BAD : INK);

/* ── the tool ─────────────────────────────────────────────────────────────── */

type Tab = "month" | "overview" | "clients";

const TABS: { id: Tab; label: string }[] = [
  { id: "month", label: "Month" },
  { id: "overview", label: "Overview" },
  { id: "clients", label: "Clients" },
];

export default function ProfitLoss() {
  const thisMonth = useMemo(() => { const d = new Date(); return monthKey(d.getFullYear(), d.getMonth()); }, []);
  const [lines, setLines] = useState<Line[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("month");
  const [month, setMonth] = useState(thisMonth);
  const [scope, setScope] = useState<number | "all">("all");
  const [copying, setCopying] = useState(false);
  const [clientRange, setClientRange] = useState<{ from: string; to: string } | null>(null);

  const load = useCallback(async (pickMonth: boolean) => {
    try {
      const res = await fetch("/api/profit-loss");
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not load");
      const loaded: Line[] = (body.lines ?? []).map((l: Line) => ({ ...l, amount: Number(l.amount) }));
      setLines(loaded);
      // Open on this month if it has been started, otherwise the latest month that has.
      if (pickMonth && loaded.length && !loaded.some(l => l.month === thisMonth)) {
        setMonth(loaded.reduce((latest, l) => (l.month > latest ? l.month : latest), loaded[0].month));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load");
      setLines(prev => prev ?? []);
    }
  }, [thisMonth]);

  useEffect(() => { load(true); }, [load]);

  const send = useCallback(async (method: string, url: string, body?: unknown) => {
    const res = await fetch(url, {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? "Could not save");
    return data;
  }, []);

  // A failed save reloads, so the screen never shows a figure that isn't stored.
  const failed = useCallback((e: unknown) => {
    setError(e instanceof Error ? e.message : "Could not save");
    load(false);
  }, [load]);

  const addLine = useCallback(async (kind: Kind, leisure: boolean, label: string, amount: number) => {
    try {
      const { line } = await send("POST", "/api/profit-loss", { month, kind, leisure, label, amount });
      setLines(prev => [...(prev ?? []), { ...line, amount: Number(line.amount) }]);
      setError(null);
      return true;
    } catch (e) { failed(e); return false; }
  }, [month, send, failed]);

  const patchLine = useCallback((id: string, patch: Partial<Pick<Line, "label" | "amount" | "leisure">>) => {
    setLines(prev => (prev ?? []).map(l => (l.id === id ? { ...l, ...patch } : l)));
    send("PATCH", "/api/profit-loss", { id, ...patch }).then(() => setError(null)).catch(failed);
  }, [send, failed]);

  const removeLine = useCallback((id: string) => {
    setLines(prev => (prev ?? []).filter(l => l.id !== id));
    send("DELETE", `/api/profit-loss?id=${encodeURIComponent(id)}`).then(() => setError(null)).catch(failed);
  }, [send, failed]);

  const all = useMemo(() => lines ?? [], [lines]);

  const monthRows: MonthRow[] = useMemo(() => {
    const byMonth = new Map<string, Line[]>();
    for (const l of all) {
      if (!byMonth.has(l.month)) byMonth.set(l.month, []);
      byMonth.get(l.month)!.push(l);
    }
    return [...byMonth.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([m, ls]) => ({ month: m, ...totalsOf(ls) }));
  }, [all]);

  const current = useMemo(() => all.filter(l => l.month === month), [all, month]);
  const totals = useMemo(() => totalsOf(current), [current]);
  const ofKind = (kind: Kind, leisure = false) =>
    current.filter(l => l.kind === kind && (kind !== "personal" || l.leisure === leisure));

  // The nearest earlier month with lines — what "copy" starts an empty month from.
  const previous = useMemo(
    () => [...monthRows].reverse().find(r => r.month < month)?.month ?? null,
    [monthRows, month],
  );

  const copyPrevious = async () => {
    if (!previous || copying) return;
    setCopying(true);
    try {
      const { lines: copied } = await send("POST", "/api/profit-loss", { action: "copy", from: previous, to: month });
      setLines(prev => [...(prev ?? []), ...(copied as Line[]).map(l => ({ ...l, amount: Number(l.amount) }))]);
      setError(null);
    } catch (e) { failed(e); }
    setCopying(false);
  };

  const years = useMemo(() => [...new Set(monthRows.map(r => partsOf(r.month).year))], [monthRows]);
  const scoped = useMemo(
    () => (scope === "all" ? monthRows : monthRows.filter(r => partsOf(r.month).year === scope)),
    [monthRows, scope],
  );
  const scopedTotals = useMemo(() => sumRows(scoped), [scoped]);

  // ── Clients tab: everything below is counted inside the chosen time frame ──
  const firstMonth = monthRows[0]?.month ?? thisMonth;
  const latestMonth = monthRows[monthRows.length - 1]?.month ?? thisMonth;
  const from = clientRange && clientRange.from > firstMonth ? clientRange.from : firstMonth;
  const to = clientRange && clientRange.to < latestMonth ? clientRange.to : latestMonth;

  const clientStats = useMemo(() => {
    // Same client typed two ways ("Dave", "dave ") is one client; first spelling wins.
    const logged = new Set(monthRows.map(r => r.month));
    const paid = new Map<string, Map<string, number>>();   // month → client → amount
    const names = new Map<string, string>();
    const firstEver = new Map<string, string>();
    for (const l of all) {
      if (l.kind !== "revenue" || !l.amount) continue;
      const key = l.label.trim().toLowerCase();
      if (!key) continue;
      if (!names.has(key)) names.set(key, l.label.trim());
      if (!paid.has(l.month)) paid.set(l.month, new Map());
      const m = paid.get(l.month)!;
      m.set(key, (m.get(key) ?? 0) + l.amount);
      const first = firstEver.get(key);
      if (!first || l.month < first) firstEver.set(key, l.month);
    }

    const months = monthRows.map(r => r.month).filter(m => m >= from && m <= to);
    const lastMonth = months[months.length - 1] ?? to;

    // Month to month: of the clients who paid last month, who paid again?
    // A month with nothing logged before it has no one to keep, so no rate.
    const byMonth = months.map(m => {
      const now = paid.get(m) ?? new Map<string, number>();
      const before = shiftMonth(m, -1);
      const prev = logged.has(before) ? (paid.get(before) ?? new Map<string, number>()) : null;
      let stayed = 0, fresh = 0, back = 0;
      for (const key of now.keys()) {
        if (prev?.has(key)) stayed++;
        else if (firstEver.get(key) === m) fresh++;
        else back++;
      }
      const base = prev ? prev.size : null;
      return {
        month: m, paying: now.size, stayed, fresh, back, base,
        lost: base === null ? null : base - stayed,
        retention: base ? stayed / base : null,
      };
    });

    const perClient = new Map<string, { total: number; months: string[] }>();
    for (const m of months) {
      for (const [key, amount] of paid.get(m) ?? []) {
        if (!perClient.has(key)) perClient.set(key, { total: 0, months: [] });
        const c = perClient.get(key)!;
        c.total += amount;
        c.months.push(m);
      }
    }
    const total = [...perClient.values()].reduce((s, c) => s + c.total, 0);
    const list = [...perClient.entries()]
      .map(([key, c]) => ({
        name: names.get(key)!, total: c.total, months: c.months.length,
        share: total ? c.total / total : 0,
        first: c.months[0], last: c.months[c.months.length - 1],
        isNew: firstEver.get(key)! >= from,
        paying: c.months[c.months.length - 1] === lastMonth,
      }))
      .sort((a, b) => b.total - a.total);

    const base = byMonth.reduce((s, r) => s + (r.base ?? 0), 0);
    const kept = byMonth.reduce((s, r) => s + (r.base === null ? 0 : r.stayed), 0);
    return {
      months, lastMonth, byMonth, list, total, base, kept,
      clientMonths: list.reduce((s, c) => s + c.months, 0),
      newCount: list.filter(c => c.isNew).length,
      payingNow: list.filter(c => c.paying).length,
      retention: base ? kept / base : null,
    };
  }, [all, monthRows, from, to]);

  // Time-frame shortcuts. "Last N months" counts back from the latest month logged.
  const frames = useMemo(() => {
    const clamp = (f: string, t: string) => ({ from: f < firstMonth ? firstMonth : f, to: t > latestMonth ? latestMonth : t });
    return [
      { label: "All time", ...clamp(firstMonth, latestMonth) },
      ...years.map(y => ({ label: String(y), ...clamp(monthKey(y, 0), monthKey(y, 11)) })),
      ...[3, 6, 12].map(n => ({ label: `Last ${n} months`, ...clamp(shiftMonth(latestMonth, -(n - 1)), latestMonth) })),
    ];
  }, [years, firstMonth, latestMonth]);

  const openMonth = (m: string) => { setMonth(m); setTab("month"); };
  const rowKey = (l: Line) => `${l.id}:${l.label}:${l.amount}`;

  if (lines === null) {
    return <p style={{ fontSize: 13, color: MUTED, padding: 24 }}>Loading…</p>;
  }

  const list = (kind: Kind, leisure: boolean, placeholder: string) => (
    <>
      {ofKind(kind, leisure).map(l => (
        <Row key={rowKey(l)} line={l} onPatch={patchLine} onRemove={removeLine}
          move={kind === "personal"
            ? { title: leisure ? "Move to Necessary" : "Move to Leisure", onMove: () => patchLine(l.id, { leisure: !leisure }) }
            : undefined} />
      ))}
      <AddRow placeholder={placeholder} onAdd={(label, amount) => addLine(kind, leisure, label, amount)} />
    </>
  );

  const cs = clientStats;
  const SELECT: React.CSSProperties = {
    padding: "6px 8px", borderRadius: 9, fontSize: 12.5, fontWeight: 600, color: INK,
    background: CARD, border: "1px solid rgba(0,0,0,0.14)", fontFamily: "inherit",
  };

  return (
    <div style={{ maxWidth: 1180, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 180 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: INK, letterSpacing: "-0.02em" }}>Profit and Loss</h2>
          <p style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>
            Profit is revenue minus expenses. Personal spending is tracked beside it.
          </p>
        </div>
        <div style={{ display: "flex", background: "rgba(0,0,0,0.05)", borderRadius: 10, padding: 3 }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              style={{
                padding: "6px 14px", borderRadius: 8, fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap",
                background: tab === t.id ? "#ffffff" : "transparent",
                color: tab === t.id ? INK : MUTED,
                boxShadow: tab === t.id ? "0 1px 3px rgba(0,0,0,0.10)" : "none",
              }}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {error && (
        <div role="alert" style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 12.5, color: BAD, background: "rgba(180,71,46,0.08)", borderRadius: 10, padding: "9px 12px" }}>
          <span style={{ flex: 1 }}>{error}</span>
          <button onClick={() => setError(null)} style={{ fontWeight: 600, color: BAD }}>Dismiss</button>
        </div>
      )}

      {/* ── Month ── */}
      {tab === "month" && (<>
        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <button onClick={() => setMonth(shiftMonth(month, -1))} aria-label="Previous month" style={{ ...BTN_QUIET, padding: "7px 11px" }}>‹</button>
          <h3 style={{ fontSize: 16, fontWeight: 700, color: INK, minWidth: 150, textAlign: "center" }}>{monthName(month)}</h3>
          <button onClick={() => setMonth(shiftMonth(month, 1))} aria-label="Next month" style={{ ...BTN_QUIET, padding: "7px 11px" }}>›</button>
          {month !== thisMonth && (
            <button onClick={() => setMonth(thisMonth)} style={BTN_QUIET}>This month</button>
          )}
        </div>

        <div style={TILE_GRID}>
          <Tile label="Revenue" value={money(totals.revenue)} />
          <Tile label="Expenses" value={money(totals.expenses)} />
          <Tile label="Profit" value={money(totals.profit)} tone={totals.profit < 0 ? "bad" : totals.profit > 0 ? "good" : undefined} />
          <Tile label="Profit margin" value={pct(totals.margin)} />
          <Tile label="Personal" value={money(totals.personal)}
            sub={`Necessary ${money(totals.necessary)} · Leisure ${money(totals.leisure)}`} />
        </div>

        {current.length === 0 && previous && (
          <div style={{ background: CARD, border: BORDER, borderRadius: 16, padding: 16, display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
            <p style={{ fontSize: 13, color: MUTED, flex: 1, minWidth: 200 }}>
              Nothing logged for {monthName(month)} yet. Start from {monthName(previous)}’s clients and expenses, then adjust the amounts.
            </p>
            <button onClick={copyPrevious} disabled={copying}
              style={{ padding: "9px 16px", borderRadius: 10, fontSize: 13, fontWeight: 600, background: "#000000", color: "#ffffff", opacity: copying ? 0.5 : 1 }}>
              {copying ? "Copying…" : `Copy ${monthName(previous)}`}
            </button>
          </div>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(290px, 1fr))", gap: 12, alignItems: "start" }}>
          <Section title="PROFIT" caption="Clients" total={totals.revenue}>
            {list("revenue", false, "Add a client")}
          </Section>
          <Section title="LOSS" caption="Expenses" total={totals.expenses}>
            {list("expense", false, "Add an expense")}
          </Section>
          <Section title="PERSONAL" caption="Expenses" total={totals.personal}>
            {([["Necessary", false, totals.necessary], ["Leisure", true, totals.leisure]] as const).map(([name, leisure, sum], i) => (
              <div key={name} style={{ marginTop: i ? 16 : 0 }}>
                <div style={{ display: "flex", alignItems: "baseline", padding: "0 9px 4px", borderBottom: "1px solid rgba(0,0,0,0.06)", marginBottom: 4 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: MUTED, letterSpacing: "0.06em", flex: 1 }}>{name.toUpperCase()}</span>
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: INK, fontVariantNumeric: "tabular-nums" }}>{money(sum)}</span>
                </div>
                {list("personal", leisure, `Add ${name.toLowerCase()}`)}
              </div>
            ))}
          </Section>
        </div>
      </>)}

      {/* ── Overview ── */}
      {tab === "overview" && (monthRows.length === 0 ? (
        <p style={{ fontSize: 13, color: MUTED, padding: "24px 4px" }}>No months logged yet. Add lines on the Month tab and they will add up here.</p>
      ) : (<>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {(["all", ...years] as const).map(y => (
            <button key={y} onClick={() => setScope(y)}
              style={{
                padding: "6px 13px", borderRadius: 999, fontSize: 12.5, fontWeight: 600,
                background: scope === y ? "#000000" : "rgba(0,0,0,0.06)",
                color: scope === y ? "#ffffff" : "#4a4a4a",
              }}>
              {y === "all" ? "All time" : y}
            </button>
          ))}
        </div>

        <div style={TILE_GRID}>
          <Tile label="Revenue" value={money(scopedTotals.revenue)} />
          <Tile label="Expenses" value={money(scopedTotals.expenses)} />
          <Tile label="Profit" value={money(scopedTotals.profit)} tone={scopedTotals.profit < 0 ? "bad" : scopedTotals.profit > 0 ? "good" : undefined} />
          <Tile label="Profit margin" value={pct(scopedTotals.margin)} />
          <Tile label="Personal" value={money(scopedTotals.personal)} />
        </div>

        <BarChart title="Revenue and expenses by month" onPick={openMonth}
          legend={[{ c: INK, l: "Revenue" }, { c: GREY_BAR, l: "Expenses" }]}
          top={niceCeil(Math.max(...scoped.map(r => Math.max(r.revenue, r.expenses)), 0))} tick={compact}
          cols={scoped.map(r => ({
            month: r.month,
            groups: [[{ value: r.revenue, color: INK }], [{ value: r.expenses, color: GREY_BAR }]],
            tip: [
              { l: "Revenue", v: money(r.revenue) }, { l: "Expenses", v: money(r.expenses) },
              { l: "Profit", v: money(r.profit) }, { l: "Margin", v: pct(r.margin) },
            ],
            aria: `${monthName(r.month)}: revenue ${money(r.revenue)}, expenses ${money(r.expenses)}, profit ${money(r.profit)}`,
          }))} />

        <div style={{ background: CARD, border: BORDER, boxShadow: SHADOW, borderRadius: 16, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ ...TH, textAlign: "left" }}>Month</th>
                <th style={TH}>Revenue</th><th style={TH}>Expenses</th><th style={TH}>Personal</th>
                <th style={TH}>Profit</th><th style={TH}>Margin</th>
              </tr>
            </thead>
            <tbody>
              {scoped.map(r => (
                <tr key={r.month} onClick={() => openMonth(r.month)} className="pnl-click" style={{ cursor: "pointer" }}>
                  <td style={{ ...TD, textAlign: "left", fontWeight: 600 }}>{monthName(r.month)}</td>
                  <td style={TD}>{money(r.revenue)}</td>
                  <td style={TD}>{money(r.expenses)}</td>
                  <td style={TD}>{money(r.personal)}</td>
                  <td style={{ ...TD, fontWeight: 600, color: profitColor(r.profit) }}>{money(r.profit)}</td>
                  <td style={{ ...TD, color: r.margin !== null && r.margin < 0 ? BAD : MUTED }}>{pct(r.margin)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              {(() => {
                const n = scoped.length;
                const margins = scoped.map(r => r.margin).filter((m): m is number => m !== null);
                const pick = (fn: (...v: number[]) => number) => ({
                  revenue: fn(...scoped.map(r => r.revenue)), expenses: fn(...scoped.map(r => r.expenses)),
                  personal: fn(...scoped.map(r => r.personal)), profit: fn(...scoped.map(r => r.profit)),
                  margin: margins.length ? fn(...margins) : null,
                });
                const summary = [
                  { label: `Total · ${n} month${n === 1 ? "" : "s"}`, ...scopedTotals, strong: true },
                  {
                    label: "Monthly average", strong: false,
                    revenue: scopedTotals.revenue / n, expenses: scopedTotals.expenses / n,
                    personal: scopedTotals.personal / n, profit: scopedTotals.profit / n,
                    margin: margins.length ? margins.reduce((s, m) => s + m, 0) / margins.length : null,
                  },
                  { label: "Highest month", strong: false, ...pick(Math.max) },
                  { label: "Lowest month", strong: false, ...pick(Math.min) },
                ];
                return summary.map((s, i) => (
                  <tr key={s.label} style={{ background: "rgba(0,0,0,0.025)" }}>
                    <td style={{ ...TD, textAlign: "left", fontWeight: s.strong ? 700 : 600, color: s.strong ? INK : MUTED, borderTop: i === 0 ? "1px solid rgba(0,0,0,0.14)" : TD.borderTop }}>{s.label}</td>
                    {[s.revenue, s.expenses, s.personal].map((v, j) => (
                      <td key={j} style={{ ...TD, fontWeight: s.strong ? 700 : 400, borderTop: i === 0 ? "1px solid rgba(0,0,0,0.14)" : TD.borderTop }}>{money(Math.round(v * 100) / 100)}</td>
                    ))}
                    <td style={{ ...TD, fontWeight: s.strong ? 700 : 600, color: profitColor(s.profit), borderTop: i === 0 ? "1px solid rgba(0,0,0,0.14)" : TD.borderTop }}>{money(Math.round(s.profit * 100) / 100)}</td>
                    <td style={{ ...TD, color: MUTED, borderTop: i === 0 ? "1px solid rgba(0,0,0,0.14)" : TD.borderTop }}>{pct(s.margin)}</td>
                  </tr>
                ));
              })()}
            </tfoot>
          </table>
        </div>
      </>))}

      {/* ── Clients ── */}
      {tab === "clients" && (monthRows.length === 0 ? (
        <p style={{ fontSize: 13, color: MUTED, padding: "24px 4px" }}>No client revenue logged yet.</p>
      ) : (<>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
          {frames.map(f => {
            const on = f.from === from && f.to === to;
            return (
              <button key={f.label} onClick={() => setClientRange({ from: f.from, to: f.to })}
                style={{
                  padding: "6px 13px", borderRadius: 999, fontSize: 12.5, fontWeight: 600,
                  background: on ? "#000000" : "rgba(0,0,0,0.06)", color: on ? "#ffffff" : "#4a4a4a",
                }}>
                {f.label}
              </button>
            );
          })}
          <span style={{ flex: 1 }} />
          <label style={{ fontSize: 12, color: MUTED, display: "flex", alignItems: "center", gap: 6 }}>
            From
            <select value={from} style={SELECT}
              onChange={e => setClientRange({ from: e.target.value, to: e.target.value > to ? e.target.value : to })}>
              {monthRows.map(r => <option key={r.month} value={r.month}>{monthName(r.month, true)}</option>)}
            </select>
          </label>
          <label style={{ fontSize: 12, color: MUTED, display: "flex", alignItems: "center", gap: 6 }}>
            to
            <select value={to} style={SELECT}
              onChange={e => setClientRange({ from: e.target.value < from ? e.target.value : from, to: e.target.value })}>
              {monthRows.map(r => <option key={r.month} value={r.month}>{monthName(r.month, true)}</option>)}
            </select>
          </label>
        </div>

        <div style={TILE_GRID}>
          <Tile label="Clients" value={String(cs.list.length)}
            sub={`${cs.newCount} new · ${cs.payingNow} paying in ${monthName(cs.lastMonth, true)}`} />
          <Tile label="Client revenue" value={money(cs.total)}
            sub={`${cs.months.length} month${cs.months.length === 1 ? "" : "s"}`} />
          <Tile label="Average value per client" value={cs.list.length ? money(Math.round(cs.total / cs.list.length)) : "n/a"} />
          <Tile label="Average monthly per client" value={cs.clientMonths ? money(Math.round(cs.total / cs.clientMonths)) : "n/a"}
            sub={cs.list.length ? `${(cs.clientMonths / cs.list.length).toFixed(1)} months per client` : undefined} />
          <Tile label="Retention rate" value={pct(cs.retention)}
            sub={cs.base ? `${cs.kept} of ${cs.base} paid again the next month` : "Needs two months in a row"} />
          <Tile label="Churn rate" value={pct(cs.retention === null ? null : 1 - cs.retention)}
            sub={cs.base ? `${cs.base - cs.kept} of ${cs.base} did not pay the next month` : undefined} />
        </div>

        <BarChart title="Paying clients by month" onPick={openMonth}
          legend={[{ c: INK, l: "Stayed from last month" }, { c: GREY_BAR, l: "New or back" }]}
          top={Math.max(4, Math.ceil(Math.max(...cs.byMonth.map(r => r.paying), 0) / 4) * 4)} tick={n => String(n)}
          cols={cs.byMonth.map(r => ({
            month: r.month,
            groups: [[{ value: r.stayed, color: INK }, { value: r.fresh + r.back, color: GREY_BAR }]],
            tip: [
              { l: "Paying", v: String(r.paying) }, { l: "Stayed", v: String(r.stayed) },
              { l: "New", v: String(r.fresh) }, { l: "Back", v: String(r.back) },
              { l: "Lost", v: r.lost === null ? "n/a" : String(r.lost) }, { l: "Retention", v: pct(r.retention) },
            ],
            aria: `${monthName(r.month)}: ${r.paying} paying, ${r.stayed} stayed, ${r.fresh} new, ${r.back} back, ${r.lost ?? 0} lost`,
          }))} />

        {cs.list.length === 0 ? (
          <p style={{ fontSize: 13, color: MUTED, padding: "8px 4px" }}>No client payments in this time frame.</p>
        ) : (
          <div style={{ background: CARD, border: BORDER, boxShadow: SHADOW, borderRadius: 16, overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ ...TH, textAlign: "left" }}>Client</th>
                  <th style={TH}>Paid</th><th style={TH}>Share</th><th style={TH}>Months</th>
                  <th style={TH}>Avg / month</th><th style={TH}>First paid</th><th style={TH}>Last paid</th>
                  <th style={TH}>Paying in {monthName(cs.lastMonth, true)}</th>
                </tr>
              </thead>
              <tbody>
                {cs.list.map(c => (
                  <tr key={c.name}>
                    <td style={{ ...TD, textAlign: "left", fontWeight: 600 }}>
                      {c.name}
                      {c.isNew && (
                        <span style={{ marginLeft: 8, padding: "2px 7px", borderRadius: 999, fontSize: 10.5, fontWeight: 700, background: "rgba(0,0,0,0.06)", color: "#4a4a4a" }}>New</span>
                      )}
                    </td>
                    <td style={{ ...TD, fontWeight: 600 }}>{money(c.total)}</td>
                    <td style={{ ...TD, color: MUTED }}>{pct(c.share)}</td>
                    <td style={TD}>{c.months}</td>
                    <td style={TD}>{money(Math.round(c.total / c.months))}</td>
                    <td style={{ ...TD, color: MUTED }}>{monthName(c.first, true)}</td>
                    <td style={{ ...TD, color: MUTED }}>{monthName(c.last, true)}</td>
                    <td style={{ ...TD, fontWeight: 600, color: c.paying ? INK : FAINT }}>{c.paying ? "Yes" : "No"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div style={{ background: CARD, border: BORDER, boxShadow: SHADOW, borderRadius: 16, overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ ...TH, textAlign: "left" }}>Month</th>
                <th style={TH}>Paying</th><th style={TH}>Stayed</th><th style={TH}>New</th>
                <th style={TH}>Back</th><th style={TH}>Lost</th><th style={TH}>Retention</th><th style={TH}>Churn</th>
              </tr>
            </thead>
            <tbody>
              {cs.byMonth.map(r => (
                <tr key={r.month} onClick={() => openMonth(r.month)} className="pnl-click" style={{ cursor: "pointer" }}>
                  <td style={{ ...TD, textAlign: "left", fontWeight: 600 }}>{monthName(r.month)}</td>
                  <td style={{ ...TD, fontWeight: 600 }}>{r.paying}</td>
                  <td style={TD}>{r.stayed}</td>
                  <td style={TD}>{r.fresh}</td>
                  <td style={TD}>{r.back}</td>
                  <td style={TD}>{r.lost ?? "n/a"}</td>
                  <td style={{ ...TD, color: MUTED }}>{pct(r.retention)}</td>
                  <td style={{ ...TD, color: MUTED }}>{pct(r.retention === null ? null : 1 - r.retention)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>))}

      <style>{`
        .pnl-input:hover { background: rgba(0,0,0,0.035) !important; }
        .pnl-input:focus { background: #ffffff !important; border-color: rgba(0,0,0,0.28) !important; }
        .pnl-ghost { opacity: 0.55; }
        .pnl-row:hover .pnl-ghost, .pnl-ghost:focus { opacity: 1; }
        .pnl-ghost:hover { background: rgba(0,0,0,0.06); color: #111111 !important; }
        .pnl-click:hover td { background: rgba(0,0,0,0.025); }
      `}</style>
    </div>
  );
}
