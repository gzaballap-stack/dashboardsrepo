"use client";

import { useEffect, useState } from "react";

type Props = {
  type: "show_rate" | "pickup_rate" | "new_leads";
  startDate?: string;
  endDate?: string;
  clientId?: string;
  liveOnly?: boolean;
};

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const HOUR_LABELS = Array.from({ length: 24 }, (_, i) => {
  if (i === 0)   return "12 am";
  if (i < 12)    return `${i} am`;
  if (i === 12)  return "12 pm";
  return `${i - 12} pm`;
});

// ── Color scales ──────────────────────────────────────────────────────────────

type CellColor = { bg: string; text: string; bold?: boolean };

const NO_DATA: CellColor = { bg: "#0d1929", text: "#1e3a5f" };

const PCT_SCALE: { min: number; bg: string; text: string; label: string }[] = [
  { min: 80, bg: "#064e3b", text: "#6ee7b7", label: "80%+"       },
  { min: 60, bg: "#065f46", text: "#a7f3d0", label: "60 – 79%"   },
  { min: 40, bg: "#78350f", text: "#fde68a", label: "40 – 59%"   },
  { min: 20, bg: "#7c2d12", text: "#fed7aa", label: "20 – 39%"   },
  { min:  0, bg: "#450a0a", text: "#fca5a5", label: "0 – 19%"    },
];

const LEAD_SCALE: { min: number; bg: string; text: string; label: string }[] = [
  { min: 11, bg: "#4f46e5", text: "#ffffff", label: "11+"       },
  { min:  6, bg: "#3730a3", text: "#c7d2fe", label: "6 – 10"    },
  { min:  3, bg: "#1e1b4b", text: "#a5b4fc", label: "3 – 5"     },
  { min:  1, bg: "#13104a", text: "#818cf8", label: "1 – 2"     },
  { min:  0, bg: "#0d1929", text: "#1e3a5f", label: "0"         },
];

function getCellColor(value: number, type: string): CellColor {
  if (value === -1) return NO_DATA;
  const scale = type === "new_leads" ? LEAD_SCALE : PCT_SCALE;
  for (const tier of scale) {
    if (value >= tier.min) return { bg: tier.bg, text: tier.text, bold: tier === scale[0] };
  }
  return NO_DATA;
}

function formatValue(value: number, type: string): string {
  if (value === -1) return "";
  if (type === "new_leads") return String(value);
  return `${value}%`;
}

// ── Legend ────────────────────────────────────────────────────────────────────

function Legend({ type }: { type: string }) {
  const scale = type === "new_leads" ? [...LEAD_SCALE].reverse() : [...PCT_SCALE].reverse();
  return (
    <div className="flex flex-wrap items-center gap-2 mt-4">
      <span className="text-xs font-medium mr-1" style={{ color: "#334155" }}>Scale:</span>
      {[{ bg: NO_DATA.bg, text: NO_DATA.text, label: "No data" }, ...scale].map(tier => (
        <div key={tier.label} className="flex items-center gap-1.5 px-2.5 py-1 rounded-md"
          style={{ background: tier.bg, border: "1px solid rgba(255,255,255,0.08)" }}>
          <span className="text-xs font-semibold" style={{ color: tier.text }}>{tier.label}</span>
        </div>
      ))}
      <span className="ml-auto text-xs" style={{ color: "#1e3a5f" }}>Times in UTC</span>
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function HeatMap({ type, startDate, endDate, clientId, liveOnly }: Props) {
  const [grid, setGrid] = useState<number[][] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ type });
    if (startDate) params.set("start_date", startDate);
    if (endDate)   params.set("end_date", endDate);
    if (liveOnly)  params.set("live_only", "true");
    else if (clientId) params.set("client_id", clientId);

    fetch(`/api/heatmap?${params}`)
      .then(r => r.json())
      .then(d => { setGrid(d.grid ?? null); setLoading(false); })
      .catch(() => setLoading(false));
  }, [type, startDate, endDate, clientId, liveOnly]);

  const TYPE_LABELS: Record<string, string> = {
    new_leads:    "Lead volume by time of day",
    pickup_rate:  "Pickup rate by time of dial",
    show_rate:    "Show rate by scheduled appointment time",
  };

  return (
    <div className="space-y-1">
      <p className="text-xs mb-4" style={{ color: "#334155" }}>{TYPE_LABELS[type]}</p>

      {loading || !grid ? (
        <div className="flex items-center justify-center py-24">
          <div className="flex items-center gap-3" style={{ color: "#334155" }}>
            {loading && (
              <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
              </svg>
            )}
            <span className="text-sm font-medium">{loading ? "Loading…" : "No data"}</span>
          </div>
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-xl" style={{ border: "1px solid rgba(255,255,255,0.06)" }}>
            <table className="text-xs border-collapse w-full">
              <thead>
                <tr style={{ background: "#050c18" }}>
                  <th className="px-4 py-3 text-left font-medium sticky left-0 z-10 w-16"
                    style={{ color: "#334155", background: "#050c18", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                    Hour
                  </th>
                  {DAYS.map(d => (
                    <th key={d} className="px-2 py-3 font-semibold text-center"
                      style={{ color: "#64748b", minWidth: "4.5rem", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                      {d}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {grid.map((row, hour) => {
                  const hasData = row.some(v => v !== -1);
                  return (
                    <tr key={hour} style={{ borderTop: "1px solid rgba(255,255,255,0.03)" }}>
                      <td className="px-4 py-1.5 font-medium sticky left-0 z-10 whitespace-nowrap"
                        style={{ color: hasData ? "#475569" : "#1e3a5f", background: "#050c18", width: "4rem" }}>
                        {HOUR_LABELS[hour]}
                      </td>
                      {row.map((val, day) => {
                        const { bg, text, bold } = getCellColor(val, type);
                        return (
                          <td key={day} className="py-1.5 text-center"
                            style={{ background: bg, color: text, fontWeight: bold ? 700 : 500, padding: "0.375rem 0.25rem" }}>
                            {formatValue(val, type)}
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Legend type={type} />
        </>
      )}
    </div>
  );
}
