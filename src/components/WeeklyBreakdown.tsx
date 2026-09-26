"use client";

import { useEffect, useMemo, useState } from "react";

// Raw per-week counts; every rate and cost below is derived from these.
type Raw = { spend: number; introsBooked: number; intros: number; demosBooked: number; demos: number; closes: number; cash: number };
const EMPTY: Raw = { spend: 0, introsBooked: 0, intros: 0, demosBooked: 0, demos: 0, closes: 0, cash: 0 };

type Kind = "count" | "money" | "pct";
type Col = { key: string; label: string; kind: Kind; lowerBetter?: boolean; value: (r: Raw) => number };

const safe = (n: number, d: number) => (d > 0 ? n / d : 0);

const COLS: Col[] = [
  { key: "spend",        label: "Ad Spend",        kind: "money", lowerBetter: true, value: r => r.spend },
  { key: "introsBooked", label: "Booked Intros",   kind: "count", value: r => r.introsBooked },
  { key: "intros",       label: "Intros",          kind: "count", value: r => r.intros },
  { key: "introRate",    label: "Intro Show Rate", kind: "pct",   value: r => safe(r.intros, r.introsBooked) * 100 },
  { key: "demosBooked",  label: "Booked Demos",    kind: "count", value: r => r.demosBooked },
  { key: "demos",        label: "Demos",           kind: "count", value: r => r.demos },
  { key: "demoRate",     label: "Demo Show Rate",  kind: "pct",   value: r => safe(r.demos, r.demosBooked) * 100 },
  { key: "closes",       label: "Closes",          kind: "count", value: r => r.closes },
  { key: "closeRate",    label: "Closing Rate",    kind: "pct",   value: r => safe(r.closes, r.demos) * 100 },
  { key: "cpIntro",      label: "Cost / Intro",    kind: "money", lowerBetter: true, value: r => safe(r.spend, r.intros) },
  { key: "cpDemo",       label: "Cost / Demo",     kind: "money", lowerBetter: true, value: r => safe(r.spend, r.demos) },
  { key: "cpa",          label: "Cost / Acq.",     kind: "money", lowerBetter: true, value: r => safe(r.spend, r.closes) },
  { key: "cash",         label: "Cash Collected",  kind: "money", value: r => r.cash },
];

function fmt(v: number, kind: Kind) {
  if (kind === "money") return v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${v.toFixed(0)}`;
  if (kind === "pct") return `${v.toFixed(0)}%`;
  return Math.round(v).toString();
}

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const short = (d: Date) => d.toLocaleString("en-US", { month: "short", day: "numeric" });

// Calendar weeks run Monday → Sunday. A week belongs to the month its Monday
// falls in, so a month lists every week that starts inside it (4 or 5), and
// a week that spills into the next month still counts here. Clamped to today.
function weeksOf(year: number, month: number) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const last = new Date(year, month + 1, 0);
  const d = new Date(year, month, 1);
  d.setDate(d.getDate() + ((8 - d.getDay()) % 7)); // first Monday on/after the 1st
  const out: { label: string; start: string; end: string }[] = [];
  while (d <= last && d <= today) {
    const s = new Date(d);
    const e = new Date(d); e.setDate(e.getDate() + 6);
    const end = e > today ? today : e;
    out.push({ label: `${short(s)} – ${short(end)}`, start: iso(s), end: iso(end) });
    d.setDate(d.getDate() + 7);
  }
  return out;
}

export default function WeeklyBreakdown({ onClose }: { onClose: () => void }) {
  const [now] = useState(() => new Date());
  const [offset, setOffset] = useState(0); // 0 = this month, -1 = last month
  const [rows, setRows] = useState<{ label: string; data: Raw }[]>([]);
  const [loading, setLoading] = useState(true);

  const base = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const monthLabel = base.toLocaleString("en-US", { month: "long", year: "numeric" });

  useEffect(() => {
    let alive = true;
    setLoading(true);
    const ref = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    const weeks = weeksOf(ref.getFullYear(), ref.getMonth());
    Promise.all(weeks.map(w =>
      fetch(`/api/b2b-metrics?start_date=${w.start}&end_date=${w.end}`).then(r => r.json()).catch(() => ({}))
        .then((d): { label: string; data: Raw } => ({
          label: w.label,
          data: {
            spend:        d.ad_spend ?? 0,
            introsBooked: d.intros_booked ?? 0,
            intros:       d.intros_shown ?? 0,
            demosBooked:  d.sales_calls_booked ?? 0,
            demos:        d.sales_calls_shown ?? 0,
            closes:       d.closes ?? 0,
            cash:         d.cash_collected ?? 0,
          },
        }))
    )).then(res => { if (alive) { setRows(res); setLoading(false); } });
    return () => { alive = false; };
  }, [offset]);

  // Month row: counts and money are averaged per week; every rate and cost is
  // recomputed from the month's totals, not averaged (an average of rates lies).
  const avg: Raw = useMemo(() => {
    if (!rows.length) return EMPTY;
    const n = rows.length;
    const sum = rows.reduce((a, r) => ({
      spend: a.spend + r.data.spend, introsBooked: a.introsBooked + r.data.introsBooked, intros: a.intros + r.data.intros,
      demosBooked: a.demosBooked + r.data.demosBooked, demos: a.demos + r.data.demos, closes: a.closes + r.data.closes, cash: a.cash + r.data.cash,
    }), { ...EMPTY });
    return { spend: sum.spend / n, introsBooked: sum.introsBooked / n, intros: sum.intros / n, demosBooked: sum.demosBooked / n, demos: sum.demos / n, closes: sum.closes / n, cash: sum.cash / n };
  }, [rows]);
  // Ratios for the month row come from totals (which equal averages here, ratio-wise).
  const totals: Raw = useMemo(() => rows.reduce((a, r) => ({
    spend: a.spend + r.data.spend, introsBooked: a.introsBooked + r.data.introsBooked, intros: a.intros + r.data.intros,
    demosBooked: a.demosBooked + r.data.demosBooked, demos: a.demos + r.data.demos, closes: a.closes + r.data.closes, cash: a.cash + r.data.cash,
  }), { ...EMPTY }), [rows]);
  const monthValue = (c: Col) => (c.kind === "pct" || c.key.startsWith("cp")) ? c.value(totals) : c.value(avg);

  function Delta({ cur, prev, lowerBetter }: { cur: number; prev: number | null; lowerBetter?: boolean }) {
    if (prev == null || prev === cur) return null;
    const up = cur > prev;
    const good = lowerBetter ? !up : up;
    return <span style={{ fontSize: 10, marginLeft: 4, color: good ? "#15803d" : "#b91c1c" }}>{up ? "▲" : "▼"}</span>;
  }

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(0,0,0,0.35)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "6vh 16px" }}>
      <div onClick={e => e.stopPropagation()} className="rounded-2xl" style={{ background: "#fff", border: "1px solid rgba(0,0,0,0.08)", boxShadow: "0 20px 60px -20px rgba(0,0,0,0.35)", width: "100%", maxWidth: 1240, overflow: "hidden" }}>
        <div className="flex items-center justify-between px-5 py-3" style={{ borderBottom: "1px solid rgba(0,0,0,0.07)" }}>
          <div className="flex items-center gap-2">
            <button onClick={() => setOffset(o => o - 1)} className="px-2 py-1 rounded-md" style={{ color: "#4a4a4a" }}>‹</button>
            <span className="text-sm font-semibold" style={{ color: "#111", minWidth: 130, textAlign: "center" }}>{monthLabel}</span>
            <button onClick={() => setOffset(o => Math.min(0, o + 1))} disabled={offset >= 0} className="px-2 py-1 rounded-md" style={{ color: offset >= 0 ? "#c2c2c2" : "#4a4a4a" }}>›</button>
          </div>
          <button onClick={onClose} style={{ color: "#6b6b6b", fontSize: 18, lineHeight: 1 }}>✕</button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm" style={{ borderCollapse: "collapse", minWidth: 1180 }}>
            <thead>
              <tr style={{ background: "#fafafa" }}>
                <th className="text-left px-3 py-2.5 text-[11px] font-bold uppercase tracking-wide whitespace-nowrap" style={{ color: "#6b6b6b" }}>Week</th>
                {COLS.map(c => <th key={c.key} className="text-right px-3 py-2.5 text-[11px] font-bold uppercase tracking-wide whitespace-nowrap" style={{ color: "#6b6b6b" }}>{c.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={COLS.length + 1} className="px-4 py-8 text-center text-sm" style={{ color: "#949494" }}>Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={COLS.length + 1} className="px-4 py-8 text-center text-sm" style={{ color: "#949494" }}>No weeks yet</td></tr>
              ) : rows.map((r, i) => (
                <tr key={r.label} style={{ borderTop: "1px solid rgba(0,0,0,0.05)" }}>
                  <td className="px-3 py-2.5 font-medium whitespace-nowrap" style={{ color: "#111" }}>{r.label}</td>
                  {COLS.map(c => {
                    const cur = c.value(r.data);
                    const prev = i > 0 ? c.value(rows[i - 1].data) : null;
                    return (
                      <td key={c.key} className="text-right px-3 py-2.5 whitespace-nowrap" style={{ color: "#111" }}>
                        {fmt(cur, c.kind)}
                        <Delta cur={cur} prev={prev} lowerBetter={c.lowerBetter} />
                      </td>
                    );
                  })}
                </tr>
              ))}
              {!loading && rows.length > 0 && (
                <tr style={{ borderTop: "2px solid rgba(0,0,0,0.12)", background: "#fafafa" }}>
                  <td className="px-3 py-2.5 font-bold whitespace-nowrap" style={{ color: "#111" }}>Month Avg</td>
                  {COLS.map(c => <td key={c.key} className="text-right px-3 py-2.5 font-semibold whitespace-nowrap" style={{ color: "#111" }}>{fmt(monthValue(c), c.kind)}</td>)}
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
