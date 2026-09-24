"use client";

import { useEffect, useMemo, useState } from "react";

type Row = { leads: number; booked: number; shows: number; spend: number; cpl: number };
const EMPTY: Row = { leads: 0, booked: 0, shows: 0, spend: 0, cpl: 0 };

const COLS: { key: keyof Row; label: string; money?: boolean; lowerBetter?: boolean }[] = [
  { key: "leads",  label: "Leads" },
  { key: "booked", label: "Demos Booked" },
  { key: "shows",  label: "Shows" },
  { key: "spend",  label: "Ad Spend", money: true },
  { key: "cpl",    label: "CPL", money: true, lowerBetter: true },
];

function fmt(v: number, money?: boolean) {
  if (money) return v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${v.toFixed(0)}`;
  return Math.round(v).toString();
}
const iso = (d: Date) => d.toISOString().split("T")[0];

// Split a month into 7-day buckets from day 1, clamped to month end and today.
function weeksOf(year: number, month: number) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const last = new Date(year, month + 1, 0).getDate();
  const out: { label: string; start: string; end: string }[] = [];
  for (let d = 1, w = 1; d <= last; d += 7, w++) {
    const s = new Date(year, month, d);
    const e = new Date(year, month, Math.min(d + 6, last));
    if (s > today) break;
    out.push({ label: `Week ${w}`, start: iso(s), end: iso(e > today ? today : e) });
  }
  return out;
}

export default function WeeklyBreakdown({ onClose }: { onClose: () => void }) {
  const [now] = useState(() => new Date());
  const [offset, setOffset] = useState(0); // 0 = this month, -1 = last month
  const [rows, setRows] = useState<{ label: string; data: Row }[]>([]);
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
        .then((d): { label: string; data: Row } => ({
          label: w.label,
          data: {
            leads: d.leads ?? 0,
            booked: d.sales_calls_booked ?? 0,
            shows: d.sales_calls_shown ?? 0,
            spend: d.ad_spend ?? 0,
            cpl: d.cost_per_lead ?? 0,
          },
        }))
    )).then(res => { if (alive) { setRows(res); setLoading(false); } });
    return () => { alive = false; };
  }, [offset]);

  const avg: Row = useMemo(() => {
    if (!rows.length) return EMPTY;
    const sum = rows.reduce((a, r) => ({
      leads: a.leads + r.data.leads, booked: a.booked + r.data.booked, shows: a.shows + r.data.shows,
      spend: a.spend + r.data.spend, cpl: a.cpl + r.data.cpl,
    }), { ...EMPTY });
    const n = rows.length;
    return { leads: sum.leads / n, booked: sum.booked / n, shows: sum.shows / n, spend: sum.spend / n, cpl: sum.cpl / n };
  }, [rows]);

  function Delta({ cur, prev, lowerBetter }: { cur: number; prev: number | null; lowerBetter?: boolean }) {
    if (prev == null || prev === cur) return null;
    const up = cur > prev;
    const good = lowerBetter ? !up : up;
    return <span style={{ fontSize: 10, marginLeft: 4, color: good ? "#15803d" : "#b91c1c" }}>{up ? "▲" : "▼"}</span>;
  }

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(0,0,0,0.35)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "6vh 16px" }}>
      <div onClick={e => e.stopPropagation()} className="rounded-2xl" style={{ background: "#fff", border: "1px solid rgba(0,0,0,0.08)", boxShadow: "0 20px 60px -20px rgba(0,0,0,0.35)", width: "100%", maxWidth: 860, overflow: "hidden" }}>
        <div className="flex items-center justify-between px-5 py-3" style={{ borderBottom: "1px solid rgba(0,0,0,0.07)" }}>
          <div className="flex items-center gap-2">
            <button onClick={() => setOffset(o => o - 1)} className="px-2 py-1 rounded-md" style={{ color: "#4a4a4a" }}>‹</button>
            <span className="text-sm font-semibold" style={{ color: "#111", minWidth: 130, textAlign: "center" }}>{monthLabel}</span>
            <button onClick={() => setOffset(o => Math.min(0, o + 1))} disabled={offset >= 0} className="px-2 py-1 rounded-md" style={{ color: offset >= 0 ? "#c2c2c2" : "#4a4a4a" }}>›</button>
          </div>
          <button onClick={onClose} style={{ color: "#6b6b6b", fontSize: 18, lineHeight: 1 }}>✕</button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm" style={{ borderCollapse: "collapse", minWidth: 640 }}>
            <thead>
              <tr style={{ background: "#fafafa" }}>
                <th className="text-left px-4 py-2.5 text-[11px] font-bold uppercase tracking-wide" style={{ color: "#6b6b6b" }}>Week</th>
                {COLS.map(c => <th key={c.key} className="text-right px-4 py-2.5 text-[11px] font-bold uppercase tracking-wide" style={{ color: "#6b6b6b" }}>{c.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={COLS.length + 1} className="px-4 py-8 text-center text-sm" style={{ color: "#949494" }}>Loading…</td></tr>
              ) : rows.map((r, i) => (
                <tr key={r.label} style={{ borderTop: "1px solid rgba(0,0,0,0.05)" }}>
                  <td className="px-4 py-2.5 font-medium" style={{ color: "#111" }}>{r.label}</td>
                  {COLS.map(c => (
                    <td key={c.key} className="text-right px-4 py-2.5" style={{ color: "#111" }}>
                      {fmt(r.data[c.key], c.money)}
                      <Delta cur={r.data[c.key]} prev={i > 0 ? rows[i - 1].data[c.key] : null} lowerBetter={c.lowerBetter} />
                    </td>
                  ))}
                </tr>
              ))}
              {!loading && rows.length > 0 && (
                <tr style={{ borderTop: "2px solid rgba(0,0,0,0.12)", background: "#fafafa" }}>
                  <td className="px-4 py-2.5 font-bold" style={{ color: "#111" }}>Month Avg</td>
                  {COLS.map(c => <td key={c.key} className="text-right px-4 py-2.5 font-semibold" style={{ color: "#111" }}>{fmt(avg[c.key], c.money)}</td>)}
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
