"use client";

import { useEffect, useRef, useState } from "react";

// A small range calendar: click the first day, click the last day, and the
// range is applied and the picker closes. No typing, no separate boxes.

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (s: string) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const short = (s: string) => parse(s).toLocaleString("en-US", { month: "short", day: "numeric" });

/** "Sep 1 – Sep 28" for a chip label; "Pick dates" when nothing is chosen. */
export function fmtRange(start: string, end: string) {
  if (!start || !end) return "Pick dates";
  return `${short(start)} – ${short(end)}`;
}

export default function DateRangePicker({ start, end, onChange, onClose }: {
  start: string; end: string;
  onChange: (start: string, end: string) => void;
  onClose: () => void;
}) {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const anchor = start ? parse(start) : today;
  const [month, setMonth] = useState(new Date(anchor.getFullYear(), anchor.getMonth(), 1));
  const [first, setFirst] = useState<string | null>(null);   // first click, while picking the second
  const [hover, setHover] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const h = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [onClose]);

  const pick = (day: string) => {
    if (!first) { setFirst(day); return; }
    const [a, b] = day < first ? [day, first] : [first, day];
    onChange(a, b);
    setFirst(null);
    onClose();
  };

  // What to shade: the committed range, or the in-progress one while picking.
  const rangeA = first ? (hover && hover < first ? hover : first) : start;
  const rangeB = first ? (hover && hover > first ? hover : first) : end;
  const inRange = (day: string) => !!rangeA && !!rangeB && day >= rangeA && day <= rangeB;
  const isEdge = (day: string) => day === rangeA || day === rangeB;

  const y = month.getFullYear(), m = month.getMonth();
  const firstDow = (new Date(y, m, 1).getDay() + 6) % 7;          // Monday = 0
  const daysIn = new Date(y, m + 1, 0).getDate();
  const cells: (string | null)[] = [...Array(firstDow).fill(null), ...Array.from({ length: daysIn }, (_, i) => iso(new Date(y, m, i + 1)))];
  while (cells.length % 7) cells.push(null);

  const nav = (delta: number) => setMonth(new Date(y, m + delta, 1));
  const monthLabel = month.toLocaleString("en-US", { month: "long", year: "numeric" });

  return (
    <div ref={ref} className="absolute top-full right-0 mt-1.5 rounded-2xl z-30 p-3"
      style={{ width: 300, background: "#ffffff", border: "1px solid rgba(0,0,0,0.08)", boxShadow: "0 12px 32px -8px rgba(0,0,0,0.18)" }}>
      <div className="flex items-center justify-between mb-2">
        <button onClick={() => nav(-1)} className="px-2 py-1 rounded-md" style={{ color: "#4a4a4a" }}>‹</button>
        <span className="text-sm font-semibold" style={{ color: "#111" }}>{monthLabel}</span>
        <button onClick={() => nav(1)} className="px-2 py-1 rounded-md" style={{ color: "#4a4a4a" }}>›</button>
      </div>
      <div className="grid grid-cols-7 mb-1">
        {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => <div key={i} className="text-center text-[10px] font-bold uppercase py-1" style={{ color: "#949494" }}>{d}</div>)}
      </div>
      <div className="grid grid-cols-7">
        {cells.map((day, i) => day ? (
          <button key={day} onClick={() => pick(day)} onMouseEnter={() => setHover(day)} onMouseLeave={() => setHover(null)}
            className="h-9 text-sm transition-colors"
            style={{
              background: isEdge(day) ? "#000" : inRange(day) ? "rgba(0,0,0,0.08)" : "transparent",
              color: isEdge(day) ? "#fff" : "#111",
              borderRadius: isEdge(day) ? 10 : 0,
              fontWeight: day === iso(today) ? 700 : 400,
            }}>
            {Number(day.slice(-2))}
          </button>
        ) : <div key={`b${i}`} />)}
      </div>
      <div className="flex items-center justify-between mt-3 text-xs">
        <span style={{ color: "#6b6b6b" }}>{first ? `${short(first)} → pick the last day` : (start && end ? fmtRange(start, end) : "Pick the first day")}</span>
        {(start || first) && (
          <button onClick={() => { setFirst(null); onChange("", ""); }} className="underline" style={{ color: "#6b6b6b" }}>Clear</button>
        )}
      </div>
    </div>
  );
}
