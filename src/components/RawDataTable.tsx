"use client";

import { useEffect, useState } from "react";

type Client = { id: string; name: string };

type Props = {
  type: "leads" | "dials" | "appointments" | "speed_to_lead" | "ad_spend";
  clients: Client[];
  preset: string;
  startDate: string;
  endDate: string;
};

const COLUMNS: Record<string, { key: string; label: string }[]> = {
  leads: [
    { key: "client", label: "Client" },
    { key: "occurred_at", label: "Date / Time" },
    { key: "lead_name", label: "Name" },
    { key: "lead_phone", label: "Phone" },
  ],
  dials: [
    { key: "client", label: "Client" },
    { key: "occurred_at", label: "Date / Time" },
    { key: "lead_name", label: "Lead Name" },
    { key: "lead_phone", label: "Lead Phone" },
    { key: "agent_name", label: "Agent" },
    { key: "duration_seconds", label: "Duration (s)" },
    { key: "is_pickup", label: "Pickup" },
    { key: "is_conversation", label: "Conversation" },
    { key: "direction", label: "Direction" },
    { key: "call_status", label: "Status" },
    { key: "speed_to_lead_seconds", label: "Speed to Lead (min)" },
    { key: "recording_url", label: "Recording" },
  ],
  appointments: [
    { key: "client", label: "Client" },
    { key: "occurred_at", label: "Booked At" },
    { key: "event_type", label: "Status" },
    { key: "lead_name", label: "Lead Name" },
    { key: "lead_phone", label: "Lead Phone" },
    { key: "lead_email", label: "Email" },
    { key: "agent_name", label: "Agent" },
    { key: "calendar_name", label: "Calendar" },
    { key: "stage_booked", label: "Stage" },
    { key: "scheduled_at", label: "Scheduled For" },
  ],
  speed_to_lead: [
    { key: "client", label: "Client" },
    { key: "occurred_at", label: "Date / Time" },
    { key: "lead_name", label: "Lead Name" },
    { key: "speed_to_lead_seconds", label: "Speed to Lead (min)" },
    { key: "is_pickup", label: "Pickup" },
    { key: "is_conversation", label: "Conversation" },
  ],
  ad_spend: [
    { key: "client", label: "Client" },
    { key: "spend_date", label: "Date" },
    { key: "platform", label: "Platform" },
    { key: "amount", label: "Amount" },
  ],
};

const EVENT_TYPE_LABELS: Record<string, string> = {
  appointment_booked: "Booked",
  show: "Show",
  no_show: "No Show",
  callback_booked: "Callback",
};

function formatCell(key: string, value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (key === "occurred_at" || key === "scheduled_at" || key === "spend_date") {
    return new Date(value as string).toLocaleDateString("en-US", {
      month: "short", day: "numeric", year: "numeric",
      ...(key !== "spend_date" ? { hour: "2-digit", minute: "2-digit" } : {}),
    });
  }
  if (key === "is_pickup" || key === "is_conversation") return value ? "✓" : "✗";
  if (key === "speed_to_lead_seconds") return ((value as number) / 60).toFixed(1);
  if (key === "amount") return `$${Number(value).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
  if (key === "event_type") return EVENT_TYPE_LABELS[value as string] ?? String(value);
  if (key === "platform") return (value as string).replace("_", " ").toUpperCase();
  if (key === "client") {
    const c = value as { name: string } | null;
    return c?.name ?? "—";
  }
  if (key === "recording_url") return value as string;
  return String(value);
}

export default function RawDataTable({ type, clients: allClients, preset, startDate, endDate }: Props) {
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [clientFilter, setClientFilter] = useState("");

  useEffect(() => { setPage(1); }, [type, clientFilter, preset, startDate, endDate]);

  useEffect(() => {
    setLoading(true);
    const params = new URLSearchParams({ type, page: String(page) });
    if (clientFilter === "__live__") params.set("live_only", "true");
    else if (clientFilter) params.set("client_id", clientFilter);
    if (startDate) params.set("start_date", startDate);
    if (endDate) params.set("end_date", endDate);

    fetch(`/api/raw?${params}`)
      .then(r => r.json())
      .then(d => { setRows(d.rows ?? []); setTotal(d.total ?? 0); setLoading(false); })
      .catch(() => setLoading(false));
  }, [type, clientFilter, page, startDate, endDate]);

  const cols = COLUMNS[type] ?? [];
  const totalPages = Math.ceil(total / 100);

  return (
    <div className="space-y-4">
      {/* Client filter */}
      <div className="flex items-center gap-3">
        <select
          value={clientFilter}
          onChange={e => setClientFilter(e.target.value)}
          className="px-4 py-2 rounded-lg text-sm font-medium outline-none"
          style={{ background: "#0f2040", border: "1px solid rgba(255,255,255,0.12)", color: "#e2e8f0", minWidth: "11rem" }}
        >
          <option value="">All Clients</option>
          <option value="__live__">Live Clients</option>
          {allClients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <span className="text-sm" style={{ color: "#334155" }}>{total.toLocaleString()} rows</span>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-xl" style={{ border: "1px solid rgba(255,255,255,0.06)" }}>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: "#050c18" }}>
              {cols.map(c => (
                <th key={c.key} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider whitespace-nowrap"
                  style={{ color: "#475569", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={cols.length} className="px-4 py-12 text-center text-sm" style={{ color: "#1e3a5f" }}>Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={cols.length} className="px-4 py-12 text-center text-sm" style={{ color: "#1e3a5f" }}>No data</td></tr>
            ) : rows.map((row, i) => (
              <tr key={i} style={{ borderTop: "1px solid rgba(255,255,255,0.03)", background: i % 2 === 0 ? "rgba(255,255,255,0.015)" : "transparent" }}>
                {cols.map(c => {
                  const val = formatCell(c.key, c.key === "client" ? row["clients"] : row[c.key]);
                  return (
                    <td key={c.key} className="px-4 py-2.5 whitespace-nowrap text-sm" style={{ color: "#94a3b8" }}>
                      {c.key === "recording_url" && val !== "—"
                        ? <a href={val} target="_blank" rel="noopener noreferrer" style={{ color: "#f59e0b" }}>▶ Listen</a>
                        : val}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center gap-3 justify-end">
          <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
            className="px-3 py-1.5 rounded-lg text-sm font-medium disabled:opacity-30 transition-colors"
            style={{ background: "#0f2040", border: "1px solid rgba(255,255,255,0.10)", color: "#94a3b8" }}>
            ← Prev
          </button>
          <span className="text-sm" style={{ color: "#334155" }}>Page {page} of {totalPages}</span>
          <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
            className="px-3 py-1.5 rounded-lg text-sm font-medium disabled:opacity-30 transition-colors"
            style={{ background: "#0f2040", border: "1px solid rgba(255,255,255,0.10)", color: "#94a3b8" }}>
            Next →
          </button>
        </div>
      )}
    </div>
  );
}
