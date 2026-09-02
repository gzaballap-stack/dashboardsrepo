"use client";

import { useEffect, useState } from "react";

type Agent = { id: string; name: string; phone: string };
type Client = { id: string; name: string; is_live?: boolean };
type AvailRow = {
  id: string; agent_id: string; weekday: string;
  time_start: string; time_end: string; is_live: boolean;
  agents: { name: string };
};
type WindowRow = {
  id: string; client_id: string; weekday: string;
  time_slot_1: string | null; time_slot_2: string | null; is_live: boolean;
  clients: { name: string };
};
type ScheduleRow = {
  id: string; client_id: string; agent_id: string | null;
  scheduled_date: string; slot_time: string; status: string; notes: string | null;
  clients: { name: string }; agents: { name: string } | null;
};
type WatchEntry = {
  id: string; agent_id: string; scheduled_date: string; slot_hour: number;
  agents: { name: string };
};

type Tab = "watch" | "pd" | "availability" | "windows";

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const HOURS = Array.from({ length: 13 }, (_, i) => i + 8); // 8–20

const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  pending:    { label: "Pending",    color: "#4a4a4a", bg: "rgba(0,0,0,0.06)" },
  completed:  { label: "Completed",  color: "#000000", bg: "rgba(0,0,0,0.06)"  },
  leads_left: { label: "Leads Left", color: "#000000", bg: "rgba(0,0,0,0.06)" },
  no_leads:   { label: "No Leads",   color: "#000000", bg: "rgba(0,0,0,0.06)" },
  no_setters: { label: "No Setters", color: "#c0392b", bg: "rgba(192,57,43,0.1)"  },
};

function nextWeekday(current: string) {
  return WEEKDAYS[(WEEKDAYS.indexOf(current) + 1) % 7];
}

function getMondayOfWeek(offset = 0) {
  const d = new Date();
  const day = d.getDay();
  d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day) + offset * 7);
  return d.toISOString().split("T")[0];
}

function getWeekDates(weekStart: string): { date: string; weekday: string }[] {
  const start = new Date(weekStart + "T12:00:00Z");
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start.getTime() + i * 86400000);
    return { date: d.toISOString().split("T")[0], weekday: WEEKDAY_NAMES[d.getUTCDay()] };
  });
}

function fmtTime(t: string | null | undefined) {
  if (!t) return "—";
  const [h, m] = t.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}

function fmtHour(h: number) {
  return `${h % 12 || 12}:00 ${h >= 12 ? "PM" : "AM"}`;
}

function formatDate(iso: string) {
  return new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", {
    weekday: "short", month: "short", day: "numeric", timeZone: "UTC",
  });
}

function Input({ value, onChange, type = "text", placeholder = "", className = "" }: {
  value: string; onChange: (v: string) => void; type?: string; placeholder?: string; className?: string;
}) {
  return (
    <input type={type} value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)}
      className={`px-3 py-2 rounded-lg text-sm outline-none ${className}`}
      style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.162)", color: "#111111" }} />
  );
}

function Sel({ value, onChange, children }: { value: string; onChange: (v: string) => void; children: React.ReactNode }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)}
      className="px-3 py-2 rounded-lg text-sm outline-none cursor-pointer"
      style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.162)", color: "#111111" }}>
      {children}
    </select>
  );
}

function WeekNav({ weekStart, setWeekStart }: { weekStart: string; setWeekStart: (v: string) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex flex-col gap-1">
        <label className="text-xs" style={{ color: "#767676" }}>Week Starting</label>
        <Input type="date" value={weekStart} onChange={setWeekStart} />
      </div>
      <div className="flex gap-2 mt-4">
        <button onClick={() => setWeekStart(getMondayOfWeek(0))}
          className="px-3 py-2 rounded-lg text-xs font-medium"
          style={{ background: "#ffffff", color: "#4a4a4a", border: "1px solid rgba(0,0,0,0.108)" }}>
          This Week
        </button>
        <button onClick={() => setWeekStart(getMondayOfWeek(1))}
          className="px-3 py-2 rounded-lg text-xs font-medium"
          style={{ background: "#ffffff", color: "#4a4a4a", border: "1px solid rgba(0,0,0,0.108)" }}>
          Next Week
        </button>
      </div>
    </div>
  );
}

// ─── Watch Schedule Tab ───────────────────────────────────────────────────────

function WatchScheduleTab({ agents, availability, weekStart, setWeekStart, onGenerated }: {
  agents: Agent[];
  availability: AvailRow[];
  weekStart: string;
  setWeekStart: (v: string) => void;
  onGenerated: () => void;
}) {
  const [entries, setEntries] = useState<WatchEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [hoveredAgent, setHoveredAgent] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/watch-schedule?week_start=${weekStart}`)
      .then(r => r.json())
      .then(d => { setEntries(d.rows ?? []); setLoading(false); });
  }, [weekStart]);

  const weekDates = getWeekDates(weekStart);

  const entryMap: Record<string, WatchEntry[]> = {};
  for (const e of entries) {
    const key = `${e.scheduled_date}_${e.slot_hour}`;
    if (!entryMap[key]) entryMap[key] = [];
    entryMap[key].push(e);
  }

  function isAvailable(agentId: string, weekday: string, hour: number) {
    const hhmm = `${String(hour).padStart(2, "0")}:00:00`;
    return availability.some(a =>
      a.agent_id === agentId && a.weekday === weekday && a.is_live &&
      a.time_start <= hhmm && a.time_end > hhmm
    );
  }

  async function handleDrop(date: string, hour: number, agentId: string) {
    if (entryMap[`${date}_${hour}`]?.some(e => e.agent_id === agentId)) return;
    const res = await fetch("/api/watch-schedule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent_id: agentId, scheduled_date: date, slot_hour: hour }),
    });
    const d = await res.json();
    if (d.row) setEntries(prev => [...prev, d.row]);
  }

  async function handleRemove(id: string) {
    await fetch(`/api/watch-schedule/${id}`, { method: "DELETE" });
    setEntries(prev => prev.filter(e => e.id !== id));
  }

  async function handleGenerate() {
    setGenerating(true);
    await fetch("/api/pd-schedule", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ week_start: weekStart }),
    });
    setGenerating(false);
    onGenerated();
  }

  return (
    <div className="space-y-5">
      <WeekNav weekStart={weekStart} setWeekStart={setWeekStart} />

      {loading ? (
        <div className="py-12 text-center text-sm" style={{ color: "#949494" }}>Loading…</div>
      ) : (
        <div className="overflow-x-auto rounded-2xl" style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.06)", boxShadow: "0 1px 2px rgba(0,0,0,0.03), 0 10px 28px -12px rgba(0,0,0,0.10)" }}>
          <table className="text-xs border-collapse" style={{ minWidth: "860px", width: "100%" }}>
            <thead>
              <tr style={{ background: "#fafafa" }}>
                <th className="text-left px-3 py-3 text-xs font-semibold uppercase tracking-wider"
                  style={{ color: "#949494", borderBottom: "1px solid rgba(0,0,0,0.081)", borderRight: "1px solid rgba(0,0,0,0.054)", width: "80px" }}>
                  Time
                </th>
                {weekDates.map(({ date, weekday }) => {
                  const d = new Date(date + "T12:00:00Z");
                  return (
                    <th key={date} className="px-2 py-3 text-center"
                      style={{ color: "#4a4a4a", borderBottom: "1px solid rgba(0,0,0,0.081)", borderLeft: "1px solid rgba(0,0,0,0.054)" }}>
                      <div className="font-semibold">{weekday.slice(0, 3)}</div>
                      <div className="font-normal" style={{ color: "#767676" }}>{d.getUTCMonth() + 1}/{d.getUTCDate()}</div>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {HOURS.map((hour, hi) => (
                <tr key={hour} style={{ background: hi % 2 === 0 ? "#ffffff" : "#fafafa" }}>
                  <td className="px-3 py-2 font-mono whitespace-nowrap"
                    style={{ color: "#767676", borderRight: "1px solid rgba(0,0,0,0.054)", verticalAlign: "top", paddingTop: "10px" }}>
                    {fmtHour(hour)}
                  </td>
                  {weekDates.map(({ date, weekday }) => {
                    const key = `${date}_${hour}`;
                    const cellEntries = entryMap[key] ?? [];
                    const highlighted = hoveredAgent ? isAvailable(hoveredAgent, weekday, hour) : false;
                    return (
                      <td key={date}
                        style={{
                          borderLeft: "1px solid rgba(0,0,0,0.054)",
                          background: dragOver === key
                            ? "rgba(0,0,0,0.09)"
                            : highlighted
                            ? "rgba(0,0,0,0.06)"
                            : "transparent",
                          transition: "background 0.1s",
                          verticalAlign: "top",
                          padding: "4px",
                          minWidth: "110px",
                        }}
                        onDragOver={e => { e.preventDefault(); setDragOver(key); }}
                        onDragLeave={e => {
                          if (!e.relatedTarget || !e.currentTarget.contains(e.relatedTarget as Node)) setDragOver(null);
                        }}
                        onDrop={e => {
                          e.preventDefault();
                          const agentId = e.dataTransfer.getData("agentId");
                          if (agentId) handleDrop(date, hour, agentId);
                          setDragOver(null);
                        }}>
                        <div className="flex flex-col gap-0.5">
                          {cellEntries.map(entry => (
                            <div key={entry.id}
                              className="flex items-center gap-1 rounded px-1.5 py-0.5"
                              style={{ background: "rgba(0,0,0,0.09)", border: "1px solid rgba(0,0,0,0.12)" }}
                              onMouseEnter={() => setHoveredAgent(entry.agent_id)}
                              onMouseLeave={() => setHoveredAgent(null)}>
                              <span className="truncate text-xs" style={{ color: "#000000", maxWidth: "72px" }}>{entry.agents?.name}</span>
                              <button onClick={() => handleRemove(entry.id)}
                                className="flex-shrink-0 leading-none opacity-40 hover:opacity-100 transition-opacity"
                                style={{ color: "#000000", fontSize: "12px" }}>×</button>
                            </div>
                          ))}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Setter bench */}
      <div className="rounded-2xl p-4 space-y-3" style={{ background: "#fafafa", border: "1px solid rgba(0,0,0,0.06)", boxShadow: "0 1px 2px rgba(0,0,0,0.03), 0 10px 28px -12px rgba(0,0,0,0.10)" }}>
        <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#767676" }}>
          Setters — drag onto a slot to assign · hover to highlight availability
        </p>
        <div className="flex flex-wrap gap-2">
          {agents.length === 0 ? (
            <p className="text-xs" style={{ color: "#949494" }}>No setters yet. Add them in the Agent Roster first.</p>
          ) : agents.map(agent => (
            <div key={agent.id}
              draggable
              onDragStart={e => { e.dataTransfer.setData("agentId", agent.id); setHoveredAgent(agent.id); }}
              onDragEnd={() => setHoveredAgent(null)}
              onMouseEnter={() => setHoveredAgent(agent.id)}
              onMouseLeave={() => setHoveredAgent(null)}
              className="px-3 py-1.5 rounded-full text-xs font-medium cursor-grab active:cursor-grabbing select-none"
              style={{
                background: hoveredAgent === agent.id ? "rgba(0,0,0,0.15)" : "rgba(0,0,0,0.06)",
                border: `1px solid ${hoveredAgent === agent.id ? "rgba(0,0,0,0.3)" : "rgba(0,0,0,0.12)"}`,
                color: "#000000",
                transition: "background 0.1s, border-color 0.1s",
              }}>
              {agent.name}
            </div>
          ))}
        </div>
      </div>

      <div className="flex justify-end pt-1">
        <button onClick={handleGenerate} disabled={generating}
          className="px-6 py-2.5 rounded-lg text-sm font-semibold flex items-center gap-2"
          style={{ background: generating ? "#000000" : "#000000", color: "#fff", opacity: generating ? 0.7 : 1 }}>
          {generating ? (
            <>
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Generating…
            </>
          ) : "Generate PD Schedule →"}
        </button>
      </div>
    </div>
  );
}

// ─── PD Schedule Tab ──────────────────────────────────────────────────────────

function PDScheduleTab({ agents, weekStart, setWeekStart }: {
  agents: Agent[];
  weekStart: string;
  setWeekStart: (v: string) => void;
}) {
  const [rows, setRows] = useState<ScheduleRow[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/pd-schedule?week_start=${weekStart}`)
      .then(r => r.json())
      .then(d => { setRows(d.rows ?? []); setLoading(false); });
  }, [weekStart]);

  async function updateStatus(id: string, status: string) {
    const res = await fetch(`/api/pd-schedule/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    const d = await res.json();
    if (d.row) setRows(prev => prev.map(r => r.id === id ? d.row : r));
  }

  async function updateAgent(id: string, agent_id: string) {
    const res = await fetch(`/api/pd-schedule/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent_id: agent_id || null }),
    });
    const d = await res.json();
    if (d.row) setRows(prev => prev.map(r => r.id === id ? d.row : r));
  }

  const byDate: Record<string, ScheduleRow[]> = {};
  for (const row of rows) {
    if (!byDate[row.scheduled_date]) byDate[row.scheduled_date] = [];
    byDate[row.scheduled_date].push(row);
  }
  for (const d of Object.keys(byDate)) {
    byDate[d].sort((a, b) => a.slot_time.localeCompare(b.slot_time));
  }
  const dates = Object.keys(byDate).sort();
  const completedCount = rows.filter(r => r.status === "completed").length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-4">
        <WeekNav weekStart={weekStart} setWeekStart={setWeekStart} />
        {rows.length > 0 && (
          <div className="ml-auto mt-4 text-right">
            <p className="text-xs" style={{ color: "#767676" }}>Completion</p>
            <p className="text-sm font-semibold" style={{ color: "#000000" }}>{completedCount} / {rows.length}</p>
          </div>
        )}
      </div>

      {loading ? (
        <div className="py-12 text-center text-sm" style={{ color: "#949494" }}>Loading…</div>
      ) : dates.length === 0 ? (
        <div className="rounded-2xl px-5 py-12 text-center" style={{ background: "#fafafa", border: "1px solid rgba(0,0,0,0.06)", boxShadow: "0 1px 2px rgba(0,0,0,0.03), 0 10px 28px -12px rgba(0,0,0,0.10)" }}>
          <p className="text-sm" style={{ color: "#949494" }}>
            No PD schedule for this week. Build the Watch Schedule first, then click &ldquo;Generate PD Schedule&rdquo;.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {dates.map(date => (
            <div key={date} className="rounded-2xl overflow-hidden" style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.06)", boxShadow: "0 1px 2px rgba(0,0,0,0.03), 0 10px 28px -12px rgba(0,0,0,0.10)" }}>
              <div className="px-4 py-3 flex items-center justify-between"
                style={{ background: "#fafafa", borderBottom: "1px solid rgba(0,0,0,0.081)" }}>
                <p className="text-sm font-semibold" style={{ color: "#111111" }}>{formatDate(date)}</p>
                <p className="text-xs" style={{ color: "#767676" }}>
                  {byDate[date].filter(r => r.status === "completed").length} / {byDate[date].length} completed
                </p>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ background: "#fafafa" }}>
                    {["Time", "Client", "Setter", "Status"].map(h => (
                      <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold uppercase tracking-wider"
                        style={{ color: "#949494" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {byDate[date].map((row, i) => (
                    <tr key={row.id} style={{ background: i % 2 === 0 ? "#ffffff" : "#fafafa", borderTop: "1px solid rgba(0,0,0,0.041)" }}>
                      <td className="px-4 py-3 font-mono text-xs" style={{ color: "#6b6b6b" }}>{fmtTime(row.slot_time)}</td>
                      <td className="px-4 py-3 font-medium" style={{ color: "#111111" }}>{row.clients?.name ?? "—"}</td>
                      <td className="px-4 py-3">
                        <select value={row.agent_id ?? ""} onChange={e => updateAgent(row.id, e.target.value)}
                          className="text-xs rounded-lg px-2 py-1 outline-none cursor-pointer"
                          style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.135)", color: row.agent_id ? "#111111" : "#767676" }}>
                          <option value="">Unassigned</option>
                          {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                        </select>
                      </td>
                      <td className="px-4 py-3">
                        <select value={row.status} onChange={e => updateStatus(row.id, e.target.value)}
                          className="text-xs rounded-lg px-2 py-1 outline-none cursor-pointer font-medium"
                          style={{
                            background: STATUS_META[row.status]?.bg ?? "rgba(0,0,0,0.06)",
                            border: "1px solid rgba(0,0,0,0.108)",
                            color: STATUS_META[row.status]?.color ?? "#4a4a4a",
                          }}>
                          {Object.entries(STATUS_META).map(([k, v]) => (
                            <option key={k} value={k}>{v.label}</option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Setter Availability Tab ──────────────────────────────────────────────────

function AvailabilityTab({ agents }: { agents: Agent[] }) {
  const [rows, setRows] = useState<AvailRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [agentId, setAgentId] = useState("");
  const [weekday, setWeekday] = useState("Monday");
  const [timeStart, setTimeStart] = useState("09:00");
  const [timeEnd, setTimeEnd] = useState("17:00");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/setter-availability")
      .then(r => r.json())
      .then(d => { setRows(d.rows ?? []); setLoading(false); });
  }, []);

  async function handleAdd() {
    if (!agentId) return;
    setSaving(true);
    const res = await fetch("/api/setter-availability", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent_id: agentId, weekday, time_start: timeStart, time_end: timeEnd }),
    });
    const d = await res.json();
    if (d.row) { setRows(prev => [...prev, d.row]); setWeekday(nextWeekday(weekday)); }
    setSaving(false);
  }

  async function toggleLive(row: AvailRow) {
    const res = await fetch(`/api/setter-availability/${row.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_live: !row.is_live }),
    });
    const d = await res.json();
    if (d.row) setRows(prev => prev.map(r => r.id === row.id ? d.row : r));
  }

  async function handleDelete(id: string) {
    await fetch(`/api/setter-availability/${id}`, { method: "DELETE" });
    setRows(prev => prev.filter(r => r.id !== id));
  }

  if (loading) return <div className="py-8 text-center text-sm" style={{ color: "#949494" }}>Loading…</div>;

  return (
    <div className="space-y-6">
      <div className="rounded-2xl p-5 space-y-4" style={{ background: "#fafafa", border: "1px solid rgba(0,0,0,0.06)", boxShadow: "0 1px 2px rgba(0,0,0,0.03), 0 10px 28px -12px rgba(0,0,0,0.10)" }}>
        <p className="text-sm font-semibold" style={{ color: "#111111" }}>Add Availability</p>
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex flex-col gap-1">
            <label className="text-xs" style={{ color: "#767676" }}>Setter</label>
            <Sel value={agentId} onChange={setAgentId}>
              <option value="">Select setter…</option>
              {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Sel>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs" style={{ color: "#767676" }}>Day</label>
            <Sel value={weekday} onChange={setWeekday}>
              {WEEKDAYS.map(d => <option key={d} value={d}>{d}</option>)}
            </Sel>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs" style={{ color: "#767676" }}>Available From</label>
            <Input type="time" value={timeStart} onChange={setTimeStart} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs" style={{ color: "#767676" }}>Available Until</label>
            <Input type="time" value={timeEnd} onChange={setTimeEnd} />
          </div>
          <button onClick={handleAdd} disabled={!agentId || saving}
            className="px-4 py-2 rounded-lg text-sm font-semibold transition-opacity"
            style={{ background: "#000000", color: "#fff", opacity: (!agentId || saving) ? 0.5 : 1 }}>
            {saving ? "Adding…" : "Add"}
          </button>
        </div>
      </div>

      <div className="rounded-2xl overflow-x-auto md:overflow-hidden" style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.06)", boxShadow: "0 1px 2px rgba(0,0,0,0.03), 0 10px 28px -12px rgba(0,0,0,0.10)" }}>
        <table className="w-full text-sm min-w-[640px] md:min-w-0">
          <thead>
            <tr style={{ background: "#fafafa" }}>
              {["Setter", "Day", "Available From", "Available Until", "Status", ""].map(h => (
                <th key={h} className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider"
                  style={{ color: "#949494" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-sm" style={{ color: "#949494" }}>No availability configured yet.</td></tr>
            ) : rows.map((row, i) => (
              <tr key={row.id} style={{ background: i % 2 === 0 ? "#ffffff" : "#fafafa", borderTop: "1px solid rgba(0,0,0,0.054)" }}>
                <td className="px-4 py-3 font-medium" style={{ color: "#111111" }}>{row.agents?.name ?? "—"}</td>
                <td className="px-4 py-3" style={{ color: "#4a4a4a" }}>{row.weekday}</td>
                <td className="px-4 py-3" style={{ color: "#4a4a4a" }}>{fmtTime(row.time_start)}</td>
                <td className="px-4 py-3" style={{ color: "#4a4a4a" }}>{fmtTime(row.time_end)}</td>
                <td className="px-4 py-3">
                  <button onClick={() => toggleLive(row)}
                    className="px-2 py-0.5 rounded-full text-xs font-medium"
                    style={row.is_live
                      ? { color: "#000000", background: "rgba(0,0,0,0.06)" }
                      : { color: "#c0392b", background: "rgba(192,57,43,0.1)" }}>
                    {row.is_live ? "Live" : "Off"}
                  </button>
                </td>
                <td className="px-4 py-3 text-right">
                  <button onClick={() => handleDelete(row.id)} className="text-xs transition-colors"
                    style={{ color: "#949494" }}
                    onMouseEnter={e => (e.currentTarget.style.color = "#c0392b")}
                    onMouseLeave={e => (e.currentTarget.style.color = "#949494")}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Client Calling Windows Tab ───────────────────────────────────────────────

function ClientWindowsTab({ clients }: { clients: Client[] }) {
  const [rows, setRows] = useState<WindowRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [clientId, setClientId] = useState("");
  const [weekday, setWeekday] = useState("Monday");
  const [slot1, setSlot1] = useState("09:00");
  const [slot2, setSlot2] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch("/api/client-windows")
      .then(r => r.json())
      .then(d => { setRows(d.rows ?? []); setLoading(false); });
  }, []);

  async function handleAdd() {
    if (!clientId) return;
    setSaving(true);
    const res = await fetch("/api/client-windows", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: clientId, weekday, time_slot_1: slot1 || null, time_slot_2: slot2 || null }),
    });
    const d = await res.json();
    if (d.row) { setRows(prev => [...prev, d.row]); setWeekday(nextWeekday(weekday)); }
    setSaving(false);
  }

  async function toggleLive(row: WindowRow) {
    const res = await fetch(`/api/client-windows/${row.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_live: !row.is_live }),
    });
    const d = await res.json();
    if (d.row) setRows(prev => prev.map(r => r.id === row.id ? d.row : r));
  }

  async function handleDelete(id: string) {
    await fetch(`/api/client-windows/${id}`, { method: "DELETE" });
    setRows(prev => prev.filter(r => r.id !== id));
  }

  if (loading) return <div className="py-8 text-center text-sm" style={{ color: "#949494" }}>Loading…</div>;

  return (
    <div className="space-y-6">
      <div className="rounded-2xl p-5 space-y-4" style={{ background: "#fafafa", border: "1px solid rgba(0,0,0,0.06)", boxShadow: "0 1px 2px rgba(0,0,0,0.03), 0 10px 28px -12px rgba(0,0,0,0.10)" }}>
        <p className="text-sm font-semibold" style={{ color: "#111111" }}>Add Calling Window</p>
        <div className="flex flex-wrap gap-3 items-end">
          <div className="flex flex-col gap-1">
            <label className="text-xs" style={{ color: "#767676" }}>Client</label>
            <Sel value={clientId} onChange={setClientId}>
              <option value="">Select client…</option>
              {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Sel>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs" style={{ color: "#767676" }}>Day</label>
            <Sel value={weekday} onChange={setWeekday}>
              {WEEKDAYS.map(d => <option key={d} value={d}>{d}</option>)}
            </Sel>
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs" style={{ color: "#767676" }}>Session 1 Start</label>
            <Input type="time" value={slot1} onChange={setSlot1} />
          </div>
          <div className="flex flex-col gap-1">
            <label className="text-xs" style={{ color: "#767676" }}>Session 2 Start (optional)</label>
            <Input type="time" value={slot2} onChange={setSlot2} />
          </div>
          <button onClick={handleAdd} disabled={!clientId || saving}
            className="px-4 py-2 rounded-lg text-sm font-semibold transition-opacity"
            style={{ background: "#000000", color: "#fff", opacity: (!clientId || saving) ? 0.5 : 1 }}>
            {saving ? "Adding…" : "Add"}
          </button>
        </div>
      </div>

      <div className="rounded-2xl overflow-x-auto md:overflow-hidden" style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.06)", boxShadow: "0 1px 2px rgba(0,0,0,0.03), 0 10px 28px -12px rgba(0,0,0,0.10)" }}>
        <table className="w-full text-sm min-w-[640px] md:min-w-0">
          <thead>
            <tr style={{ background: "#fafafa" }}>
              {["Client", "Day", "Session 1", "Session 2", "Status", ""].map(h => (
                <th key={h} className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider"
                  style={{ color: "#949494" }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-sm" style={{ color: "#949494" }}>No calling windows configured yet.</td></tr>
            ) : rows.map((row, i) => (
              <tr key={row.id} style={{ background: i % 2 === 0 ? "#ffffff" : "#fafafa", borderTop: "1px solid rgba(0,0,0,0.054)" }}>
                <td className="px-4 py-3 font-medium" style={{ color: "#111111" }}>{row.clients?.name ?? "—"}</td>
                <td className="px-4 py-3" style={{ color: "#4a4a4a" }}>{row.weekday}</td>
                <td className="px-4 py-3" style={{ color: "#4a4a4a" }}>{fmtTime(row.time_slot_1)}</td>
                <td className="px-4 py-3" style={{ color: "#4a4a4a" }}>{fmtTime(row.time_slot_2)}</td>
                <td className="px-4 py-3">
                  <button onClick={() => toggleLive(row)}
                    className="px-2 py-0.5 rounded-full text-xs font-medium"
                    style={row.is_live
                      ? { color: "#000000", background: "rgba(0,0,0,0.06)" }
                      : { color: "#c0392b", background: "rgba(192,57,43,0.1)" }}>
                    {row.is_live ? "Live" : "Off"}
                  </button>
                </td>
                <td className="px-4 py-3 text-right">
                  <button onClick={() => handleDelete(row.id)} className="text-xs transition-colors"
                    style={{ color: "#949494" }}
                    onMouseEnter={e => (e.currentTarget.style.color = "#c0392b")}
                    onMouseLeave={e => (e.currentTarget.style.color = "#949494")}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Root Component ───────────────────────────────────────────────────────────

export default function SetterSchedule({ clients }: { clients: Client[] }) {
  const [tab, setTab] = useState<Tab>("watch");
  const [agents, setAgents] = useState<Agent[]>([]);
  const [availability, setAvailability] = useState<AvailRow[]>([]);
  const [weekStart, setWeekStart] = useState(getMondayOfWeek(1));

  useEffect(() => {
    fetch("/api/agents")
      .then(r => r.json())
      .then(d => setAgents(d.agents ?? []));
    fetch("/api/setter-availability")
      .then(r => r.json())
      .then(d => setAvailability(d.rows ?? []));
  }, []);

  const TABS: { key: Tab; label: string }[] = [
    { key: "watch",        label: "Watch Schedule" },
    { key: "pd",           label: "PD Schedule" },
    { key: "availability", label: "Setter Availability" },
    { key: "windows",      label: "Client Windows" },
  ];

  return (
    <div className="space-y-6 max-w-6xl">
      <div>
        <h2 className="text-xl font-semibold" style={{ color: "#111111" }}>Power Dialer Schedule</h2>
        <p className="text-sm mt-0.5" style={{ color: "#767676" }}>
          Build the watch schedule, then generate PD assignments from it.
        </p>
      </div>

      <div className="flex gap-1 p-1 rounded-2xl w-fit" style={{ background: "#fafafa" }}>
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className="px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            style={tab === t.key
              ? { background: "#000000", color: "#fff" }
              : { color: "#767676" }}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === "watch" && (
        <WatchScheduleTab
          agents={agents}
          availability={availability}
          weekStart={weekStart}
          setWeekStart={setWeekStart}
          onGenerated={() => setTab("pd")}
        />
      )}
      {tab === "pd" && (
        <PDScheduleTab
          agents={agents}
          weekStart={weekStart}
          setWeekStart={setWeekStart}
        />
      )}
      {tab === "availability" && <AvailabilityTab agents={agents} />}
      {tab === "windows" && <ClientWindowsTab clients={clients} />}
    </div>
  );
}
