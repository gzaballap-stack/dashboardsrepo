"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Bucket = "A" | "B" | "C" | "D" | "E";
type Scope = "day" | "week";

type Task = {
  id: string;
  title: string;
  notes: string | null;
  bucket: Bucket;
  priority: number;
  position: number;
  done: boolean;
  due_date: string | null;
  delegate_to: string | null;
  created_at: string;
  completed_at: string | null;
  task_date: string;
  scope: Scope;
};

const BUCKETS: { id: Bucket; letter: string; name: string; blurb: string; color: string }[] = [
  { id: "A", letter: "A", name: "Must Do",    blurb: "Serious consequences if left undone. The frog.", color: "#000000" },
  { id: "B", letter: "B", name: "Should Do",  blurb: "Mild consequences if delayed. Not critical.",     color: "#333333" },
  { id: "C", letter: "C", name: "Nice to Do", blurb: "No consequences. Casual or social.",              color: "#5a5a5a" },
  { id: "D", letter: "D", name: "Delegate",   blurb: "Important, but someone else can do it.",          color: "#8c8c8c" },
  { id: "E", letter: "E", name: "Eliminate",  blurb: "Unnecessary and wasteful. Cut it.",               color: "#b0b0b0" },
];

// Every bucket carries the same three levels (A1-A3, B1-B3, ...). Weight, not
// hue, signals urgency: darkest first.
const LEVEL_SHADES = ["#111111", "#5a5a5a", "#8c8c8c"];
const LEVEL_HINTS  = ["do first", "next", "last"];

// Only A and B are ranked — C, D and E don't warrant ordering within themselves.
const HAS_LEVELS = new Set<Bucket>(["A", "B"]);

function levelsFor(bucket: Bucket) {
  return LEVEL_SHADES.map((color, i) => ({
    priority: i + 1,
    label: `${bucket}${i + 1}`,
    color,
    hint: LEVEL_HINTS[i],
  }));
}

const CARD_BG = "#ffffff";
const PANEL_BG = "#ffffff";
const BORDER = "1px solid rgba(0,0,0,0.07)";

function hexA(hex: string, alpha: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/* ── Local-time date helpers (never touch UTC — the board is a wall calendar) ── */
const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseISO = (s: string) => new Date(`${s}T00:00:00`);
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
// Weeks run Monday → Sunday.
const weekStart = (d: Date) => addDays(d, -((d.getDay() + 6) % 7));

function dayLabel(dateISO: string) {
  const d = parseISO(dateISO);
  const diff = Math.round((d.getTime() - parseISO(iso(new Date())).getTime()) / 86400000);
  const badge = diff === 0 ? "Today" : diff === -1 ? "Yesterday" : diff === 1 ? "Tomorrow" : null;
  return {
    main: d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" }),
    badge,
    past: diff < 0,
  };
}

function weekLabel(startISO: string) {
  const s = parseISO(startISO);
  const e = addDays(s, 6);
  const thisWeek = iso(weekStart(new Date()));
  const diff = Math.round((s.getTime() - parseISO(thisWeek).getTime()) / 86400000 / 7);
  const badge = diff === 0 ? "This Week" : diff === -1 ? "Last Week" : diff === 1 ? "Next Week" : null;
  const sameMonth = s.getMonth() === e.getMonth();
  return {
    main: `${s.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${e.toLocaleDateString("en-US", sameMonth ? { day: "numeric" } : { month: "short", day: "numeric" })}`,
    badge,
    past: diff < 0,
  };
}

export default function TaskBoard() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scope, setScope] = useState<Scope>("day");
  const [dayDate, setDayDate] = useState(() => iso(new Date()));
  const [weekDate, setWeekDate] = useState(() => iso(weekStart(new Date())));
  const [hideDone, setHideDone] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newBucket, setNewBucket] = useState<Bucket>("A");
  const [newPriority, setNewPriority] = useState(1);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropZone, setDropZone] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showGuide, setShowGuide] = useState(false);
  const addRef = useRef<HTMLInputElement>(null);

  const anchor = scope === "day" ? dayDate : weekDate;

  useEffect(() => {
    fetch("/api/tasks")
      .then(r => r.json())
      .then(d => {
        if (d.error) setError(d.error);
        else setTasks(d.tasks ?? []);
        setLoading(false);
      })
      .catch(() => { setError("Couldn't load your tasks."); setLoading(false); });
  }, []);

  // Everything on the board is scoped to the day (or week) currently in view.
  const visible = useMemo(
    () => tasks.filter(t => t.scope === scope && t.task_date === anchor),
    [tasks, scope, anchor],
  );

  const listFor = (bucket: Bucket, priority?: number) =>
    visible
      .filter(t => t.bucket === bucket && (priority == null || t.priority === priority))
      .filter(t => !(hideDone && t.done))
      .sort((a, b) => (a.done === b.done ? a.position - b.position : a.done ? 1 : -1));

  const frog = useMemo(
    () => visible.filter(t => t.bucket === "A" && !t.done)
                 .sort((a, b) => a.priority - b.priority || a.position - b.position)[0] ?? null,
    [visible],
  );

  const doneCount = visible.filter(t => t.done).length;
  const pct = visible.length ? Math.round((doneCount / visible.length) * 100) : 0;

  // Unfinished work left behind on earlier days/weeks.
  const stranded = useMemo(
    () => tasks.filter(t => t.scope === scope && !t.done && t.task_date < anchor),
    [tasks, scope, anchor],
  );

  // Day strip: the Mon–Sun week containing the selected day, with per-day progress.
  const strip = useMemo(() => {
    const s = weekStart(parseISO(dayDate));
    return Array.from({ length: 7 }, (_, i) => {
      const d = addDays(s, i);
      const key = iso(d);
      const dayTasks = tasks.filter(t => t.scope === "day" && t.task_date === key);
      return {
        key,
        letter: d.toLocaleDateString("en-US", { weekday: "narrow" }),
        num: d.getDate(),
        total: dayTasks.length,
        done: dayTasks.filter(t => t.done).length,
        isToday: key === iso(new Date()),
      };
    });
  }, [tasks, dayDate]);

  async function addTask() {
    const title = newTitle.trim();
    if (!title) return;
    setNewTitle("");
    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, bucket: newBucket, priority: newPriority, position: Date.now(), task_date: anchor, scope }),
    });
    const d = await res.json();
    if (d.task) setTasks(prev => [...prev, d.task]);
    addRef.current?.focus();
  }

  async function patch(id: string, changes: Partial<Task>) {
    setTasks(prev => prev.map(t => (t.id === id ? { ...t, ...changes } as Task : t)));
    const res = await fetch("/api/tasks", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...changes }),
    });
    const d = await res.json();
    if (d.task) setTasks(prev => prev.map(t => (t.id === id ? d.task : t)));
  }

  async function remove(id: string) {
    setTasks(prev => prev.filter(t => t.id !== id));
    await fetch(`/api/tasks?id=${id}`, { method: "DELETE" });
  }

  async function pullForward() {
    const ids = stranded.map(t => t.id);
    setTasks(prev => prev.map(t => (ids.includes(t.id) ? { ...t, task_date: anchor } : t)));
    await Promise.all(ids.map(id => fetch("/api/tasks", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, task_date: anchor }),
    })));
  }

  // Drop onto a column (or an A-level lane) → append to the end of it.
  function dropInto(bucket: Bucket, priority: number) {
    if (!dragId) return;
    const siblings = visible.filter(t => t.bucket === bucket && t.priority === priority && t.id !== dragId);
    const max = siblings.reduce((m, t) => Math.max(m, t.position), 0);
    patch(dragId, { bucket, priority, position: max + 1000 });
    setDragId(null); setDropZone(null);
  }

  // Drop onto a card → land immediately above it.
  function dropBefore(target: Task) {
    if (!dragId || dragId === target.id) { setDragId(null); setDropZone(null); return; }
    const lane = visible
      .filter(t => t.bucket === target.bucket && t.priority === target.priority && t.id !== dragId)
      .sort((a, b) => a.position - b.position);
    const i = lane.findIndex(t => t.id === target.id);
    const before = i > 0 ? lane[i - 1].position : target.position - 2000;
    patch(dragId, { bucket: target.bucket, priority: target.priority, position: (before + target.position) / 2 });
    setDragId(null); setDropZone(null);
  }

  function step(n: number) {
    if (scope === "day") setDayDate(iso(addDays(parseISO(dayDate), n)));
    else setWeekDate(iso(addDays(parseISO(weekDate), n * 7)));
  }

  function jumpToToday() {
    if (scope === "day") setDayDate(iso(new Date()));
    else setWeekDate(iso(weekStart(new Date())));
  }

  function Card({ task, accent }: { task: Task; accent: string }) {
    const open = expandedId === task.id;
    const isFrog = frog?.id === task.id;
    return (
      <div
        draggable
        onDragStart={e => { setDragId(task.id); e.dataTransfer.effectAllowed = "move"; }}
        onDragEnd={() => { setDragId(null); setDropZone(null); }}
        onDragOver={e => { e.preventDefault(); e.stopPropagation(); setDropZone(`card:${task.id}`); }}
        onDrop={e => { e.preventDefault(); e.stopPropagation(); dropBefore(task); }}
        style={{
          background: CARD_BG,
          border: `1px solid ${isFrog && !task.done ? hexA(accent, 0.4) : "rgba(0,0,0,0.095)"}`,
          borderLeft: `2px solid ${task.done ? "rgba(0,0,0,0.108)" : hexA(accent, 0.75)}`,
          borderRadius: 7,
          padding: "7px 8px",
          marginBottom: 5,
          cursor: "grab",
          opacity: dragId === task.id ? 0.4 : task.done ? 0.45 : 1,
          boxShadow: dropZone === `card:${task.id}` ? `0 -2px 0 ${accent}` : "none",
          transition: "opacity 120ms, box-shadow 120ms",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 7 }}>
          <button
            onClick={() => patch(task.id, { done: !task.done })}
            title={task.done ? "Mark as not done" : "Mark as done"}
            style={{
              flexShrink: 0, width: 14, height: 14, marginTop: 2, borderRadius: 4,
              border: `1.5px solid ${task.done ? accent : "rgba(0,0,0,0.27)"}`,
              background: task.done ? accent : "transparent",
              display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
            }}
          >
            {task.done && (
              <svg style={{ width: 8, height: 8, color: "#ffffff" }} fill="none" stroke="currentColor" strokeWidth={4} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            )}
          </button>

          <div style={{ flex: 1, minWidth: 0 }} onClick={() => setExpandedId(open ? null : task.id)}>
            <p style={{
              fontSize: 12, lineHeight: 1.45, color: task.done ? "#767676" : "#111111",
              textDecoration: task.done ? "line-through" : "none", wordBreak: "break-word", cursor: "pointer",
            }}>
              {isFrog && !task.done && <span style={{ marginRight: 4 }}>🐸</span>}
              {task.title}
            </p>

            {!open && (task.due_date || task.delegate_to || task.notes) && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 5 }}>
                {task.due_date && (
                  <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 5px", borderRadius: 4, background: "rgba(245,158,11,0.12)", color: "#000000" }}>
                    due {parseISO(task.due_date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                  </span>
                )}
                {task.delegate_to && (
                  <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 5px", borderRadius: 4, background: "rgba(168,85,247,0.12)", color: "#c084fc" }}>
                    → {task.delegate_to}
                  </span>
                )}
                {task.notes && (
                  <span style={{ fontSize: 9, fontWeight: 700, padding: "2px 5px", borderRadius: 4, background: "rgba(0,0,0,0.068)", color: "#767676" }}>note</span>
                )}
              </div>
            )}
          </div>

          <button
            onClick={() => remove(task.id)}
            title="Delete task"
            style={{ flexShrink: 0, color: "#949494", cursor: "pointer", lineHeight: 0, padding: 1 }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = "#c0392b"}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = "#949494"}
          >
            <svg style={{ width: 11, height: 11 }} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {open && (
          <div style={{ marginTop: 7, paddingTop: 7, borderTop: BORDER, display: "flex", flexDirection: "column", gap: 6 }}>
            <Field label="Task">
              <input
                defaultValue={task.title}
                onBlur={e => { const v = e.target.value.trim(); if (v && v !== task.title) patch(task.id, { title: v }); }}
                style={fieldStyle}
              />
            </Field>
            <Field label="Notes">
              <textarea
                defaultValue={task.notes ?? ""}
                rows={2}
                onBlur={e => { if (e.target.value !== (task.notes ?? "")) patch(task.id, { notes: e.target.value }); }}
                style={{ ...fieldStyle, resize: "vertical" }}
              />
            </Field>
            <Field label={scope === "day" ? "Move to day" : "Move to week"}>
              <input
                type="date"
                value={task.task_date}
                onChange={e => {
                  if (!e.target.value) return;
                  const d = parseISO(e.target.value);
                  patch(task.id, { task_date: scope === "day" ? iso(d) : iso(weekStart(d)) });
                }}
                style={fieldStyle}
              />
            </Field>
            <Field label="Deadline (optional)">
              <input
                type="date"
                defaultValue={task.due_date ?? ""}
                onChange={e => patch(task.id, { due_date: e.target.value || null })}
                style={fieldStyle}
              />
            </Field>
            {task.bucket === "D" && (
              <Field label="Delegate to">
                <input
                  defaultValue={task.delegate_to ?? ""}
                  onBlur={e => { if (e.target.value !== (task.delegate_to ?? "")) patch(task.id, { delegate_to: e.target.value }); }}
                  style={fieldStyle}
                />
              </Field>
            )}
            <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
              {BUCKETS.map(b => (
                <button
                  key={b.id}
                  onClick={() => patch(task.id, { bucket: b.id })}
                  style={{
                    fontSize: 9, fontWeight: 800, padding: "3px 7px", borderRadius: 4, cursor: "pointer",
                    background: task.bucket === b.id ? hexA(b.color, 0.18) : "rgba(0,0,0,0.054)",
                    color: task.bucket === b.id ? b.color : "#767676",
                  }}
                >{b.letter}</button>
              ))}
              {HAS_LEVELS.has(task.bucket) && levelsFor(task.bucket).map(l => (
                <button
                  key={l.priority}
                  onClick={() => patch(task.id, { priority: l.priority })}
                  style={{
                    fontSize: 9, fontWeight: 800, padding: "3px 7px", borderRadius: 4, cursor: "pointer",
                    background: task.priority === l.priority ? hexA(l.color, 0.18) : "rgba(0,0,0,0.054)",
                    color: task.priority === l.priority ? l.color : "#767676",
                  }}
                >{l.label}</button>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  function Lane({ bucket, priority, accent, empty, fill }: { bucket: Bucket; priority: number; accent: string; empty: string; fill?: boolean }) {
    const items = listFor(bucket, HAS_LEVELS.has(bucket) ? priority : undefined);
    const zone = `lane:${bucket}:${priority}`;
    return (
      <div
        onDragOver={e => { e.preventDefault(); setDropZone(zone); }}
        onDragLeave={() => setDropZone(z => (z === zone ? null : z))}
        onDrop={e => { e.preventDefault(); dropInto(bucket, priority); }}
        style={{
          minHeight: 46, borderRadius: 7, padding: 3,
          ...(fill ? { flex: 1 } : null),
          background: dropZone === zone ? hexA(accent, 0.07) : "transparent",
          border: `1px dashed ${dropZone === zone ? hexA(accent, 0.35) : "transparent"}`,
          transition: "background 120ms",
        }}
      >
        {items.map(t => <Card key={t.id} task={t} accent={accent} />)}
        {items.length === 0 && (
          <p style={{ fontSize: 10, color: "#c2c2c2", textAlign: "center", padding: "12px 4px" }}>{empty}</p>
        )}
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 80, gap: 12, color: "#949494" }}>
        <svg style={{ width: 20, height: 20 }} className="animate-spin" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        <span style={{ fontSize: 13, fontWeight: 500 }}>Loading your tasks…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ padding: 40, textAlign: "center" }}>
        <p style={{ fontSize: 14, color: "#c0392b", fontWeight: 600, marginBottom: 6 }}>{error}</p>
        <p style={{ fontSize: 12, color: "#767676" }}>Refresh the page to try again.</p>
      </div>
    );
  }

  const label = scope === "day" ? dayLabel(dayDate) : weekLabel(weekDate);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

      {/* ── Frog banner ── */}
      <div style={{
        background: frog ? "linear-gradient(90deg, rgba(0,0,0,0.07), rgba(0,0,0,0.014))" : PANEL_BG,
        border: `1px solid ${frog ? "rgba(0,0,0,0.14)" : "rgba(0,0,0,0.081)"}`,
        borderRadius: 12, padding: "12px 16px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
      }}>
        <span style={{ fontSize: 24, lineHeight: 1 }}>🐸</span>
        <div style={{ flex: 1, minWidth: 180 }}>
          <p style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.12em", color: "#6b6b6b", marginBottom: 2 }}>
            {scope === "day" ? "EAT THIS FROG FIRST" : "BIGGEST OBJECTIVE THIS WEEK"}
          </p>
          <p style={{ fontSize: 14.5, fontWeight: 700, color: frog ? "#111111" : "#949494" }}>
            {frog ? frog.title : `Nothing in A — add your must-do ${scope === "day" ? "task" : "objective"}.`}
          </p>
        </div>
        <button
          onClick={() => setShowGuide(true)}
          title="Eat That Frog — the 21 principles"
          style={{
            width: 30, height: 30, borderRadius: 8, flexShrink: 0, cursor: "pointer",
            display: "flex", alignItems: "center", justifyContent: "center",
            background: "rgba(0,0,0,0.045)", border: "1px solid rgba(0,0,0,0.09)", color: "#6b6b6b",
          }}
          onMouseEnter={e => { const el = e.currentTarget as HTMLElement; el.style.color = "#111111"; el.style.background = "rgba(0,0,0,0.08)"; }}
          onMouseLeave={e => { const el = e.currentTarget as HTMLElement; el.style.color = "#6b6b6b"; el.style.background = "rgba(0,0,0,0.045)"; }}
        >
          <svg style={{ width: 15, height: 15 }} fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
          </svg>
        </button>

        {frog && (
          <button
            onClick={() => patch(frog.id, { done: true })}
            style={{ background: "#111111", color: "#fff", fontSize: 11.5, fontWeight: 700, padding: "7px 15px", borderRadius: 8, cursor: "pointer", whiteSpace: "nowrap" }}
          >
            Mark Done
          </button>
        )}
      </div>

      {showGuide && <FrogGuide onClose={() => setShowGuide(false)} />}

      {/* ── Date bar ── */}
      <div style={{ background: PANEL_BG, border: BORDER, borderRadius: 12, padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>

          {/* Day / Week switch */}
          <div style={{ display: "flex", background: "rgba(0,0,0,0.054)", borderRadius: 8, padding: 2 }}>
            {(["day", "week"] as Scope[]).map(s => (
              <button
                key={s}
                onClick={() => setScope(s)}
                style={{
                  padding: "6px 14px", borderRadius: 6, fontSize: 11.5, fontWeight: 700, cursor: "pointer",
                  background: scope === s ? "#000000" : "transparent",
                  color: scope === s ? "#fff" : "#767676",
                }}
              >{s === "day" ? "Day" : "Week"}</button>
            ))}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 2 }}>
            <Arrow dir="left" onClick={() => step(-1)} />
            <Arrow dir="right" onClick={() => step(1)} />
          </div>

          <div style={{ display: "flex", alignItems: "baseline", gap: 8, minWidth: 0 }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: label.past ? "#4a4a4a" : "#111111", whiteSpace: "nowrap" }}>
              {label.main}
            </span>
            {label.badge && (
              <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.06em", padding: "2px 7px", borderRadius: 20, background: "rgba(245,158,11,0.12)", color: "#000000", whiteSpace: "nowrap" }}>
                {label.badge.toUpperCase()}
              </span>
            )}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto", flexWrap: "wrap" }}>
            <input
              type="date"
              value={anchor}
              onChange={e => {
                if (!e.target.value) return;
                const d = parseISO(e.target.value);
                if (scope === "day") setDayDate(iso(d)); else setWeekDate(iso(weekStart(d)));
              }}
              style={{ ...fieldStyle, width: "auto", fontSize: 11 }}
            />
            {anchor !== (scope === "day" ? iso(new Date()) : iso(weekStart(new Date()))) && (
              <button
                onClick={jumpToToday}
                style={{ fontSize: 11, fontWeight: 700, color: "#000000", cursor: "pointer", whiteSpace: "nowrap" }}
              >
                {scope === "day" ? "Today" : "This week"}
              </button>
            )}
          </div>
        </div>

        {/* Day strip (Mon–Sun of the week in view) */}
        {scope === "day" && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 5 }}>
            {strip.map(d => {
              const active = d.key === dayDate;
              return (
                <button
                  key={d.key}
                  onClick={() => setDayDate(d.key)}
                  style={{
                    padding: "6px 2px 5px", borderRadius: 8, cursor: "pointer", textAlign: "center",
                    background: active ? "rgba(245,158,11,0.12)" : "rgba(0,0,0,0.027)",
                    border: `1px solid ${active ? "rgba(245,158,11,0.35)" : d.isToday ? "rgba(0,0,0,0.189)" : "transparent"}`,
                  }}
                >
                  <p style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: "0.08em", color: active ? "#000000" : "#949494" }}>{d.letter}</p>
                  <p style={{ fontSize: 14, fontWeight: 700, color: active ? "#000000" : d.isToday ? "#111111" : "#767676", lineHeight: 1.3 }}>{d.num}</p>
                  <p style={{ fontSize: 8.5, fontWeight: 700, color: d.total === 0 ? "#16233d" : d.done === d.total ? "#5a5a5a" : "#949494" }}>
                    {d.total === 0 ? "—" : `${d.done}/${d.total}`}
                  </p>
                </button>
              );
            })}
          </div>
        )}

        {/* Progress */}
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ flex: 1, height: 4, borderRadius: 4, background: "rgba(0,0,0,0.068)", overflow: "hidden" }}>
            <div style={{ width: `${pct}%`, height: "100%", background: pct === 100 ? "#5a5a5a" : "#000000", transition: "width 200ms" }} />
          </div>
          <span style={{ fontSize: 10.5, fontWeight: 700, color: "#767676", whiteSpace: "nowrap" }}>
            {doneCount} of {visible.length} done
          </span>
        </div>
      </div>

      {/* ── Carried-over work ── */}
      {stranded.length > 0 && (
        <div style={{ background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.18)", borderRadius: 10, padding: "9px 14px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, color: "#4a4a4a", flex: 1 }}>
            <strong style={{ color: "#000000" }}>{stranded.length}</strong> unfinished from earlier {scope === "day" ? "days" : "weeks"}.
          </span>
          <button
            onClick={pullForward}
            style={{ fontSize: 11, fontWeight: 700, color: "#000000", cursor: "pointer", whiteSpace: "nowrap" }}
          >
            Move to this {scope}
          </button>
        </div>
      )}

      {/* ── Add bar ── */}
      <div style={{ background: PANEL_BG, border: BORDER, borderRadius: 12, padding: 10, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input
          ref={addRef}
          value={newTitle}
          onChange={e => setNewTitle(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") addTask(); }}
          placeholder={scope === "day" ? "What needs doing this day?" : "What's the objective this week?"}
          style={{ ...fieldStyle, flex: 1, minWidth: 180, fontSize: 12.5, padding: "8px 11px" }}
        />
        <div style={{ display: "flex", gap: 3 }}>
          {BUCKETS.map(b => (
            <button
              key={b.id}
              onClick={() => setNewBucket(b.id)}
              title={`${b.name} — ${b.blurb}`}
              style={{
                width: 28, height: 32, borderRadius: 7, fontSize: 12, fontWeight: 800, cursor: "pointer",
                background: newBucket === b.id ? hexA(b.color, 0.16) : "rgba(0,0,0,0.041)",
                border: `1px solid ${newBucket === b.id ? hexA(b.color, 0.4) : "rgba(0,0,0,0.081)"}`,
                color: newBucket === b.id ? b.color : "#767676",
              }}
            >{b.letter}</button>
          ))}
        </div>
        {HAS_LEVELS.has(newBucket) && (
          <div style={{ display: "flex", gap: 3 }}>
            {levelsFor(newBucket).map(l => (
              <button
                key={l.priority}
                onClick={() => setNewPriority(l.priority)}
                style={{
                  height: 32, padding: "0 9px", borderRadius: 7, fontSize: 11, fontWeight: 800, cursor: "pointer",
                  background: newPriority === l.priority ? hexA(l.color, 0.16) : "rgba(0,0,0,0.041)",
                  border: `1px solid ${newPriority === l.priority ? hexA(l.color, 0.4) : "rgba(0,0,0,0.081)"}`,
                  color: newPriority === l.priority ? l.color : "#767676",
                }}
              >{l.label}</button>
            ))}
          </div>
        )}
        <button
          onClick={addTask}
          style={{ background: "#000000", color: "#fff", fontSize: 12.5, fontWeight: 700, padding: "8px 16px", borderRadius: 8, cursor: "pointer" }}
        >
          Add
        </button>
      </div>

      {/* ── Board controls ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <p style={{ fontSize: 10.5, color: "#949494", marginRight: "auto" }}>
          Drag any task between columns to re-prioritise.
        </p>
        <button
          onClick={() => setHideDone(v => !v)}
          style={{ fontSize: 10.5, fontWeight: 600, color: hideDone ? "#000000" : "#767676", cursor: "pointer" }}
        >
          {hideDone ? "Show completed" : "Hide completed"}
        </button>
      </div>

      {/* ── Five columns, always side by side ── */}
      <div style={{ overflowX: "auto", paddingBottom: 4 }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, minmax(0, 1fr))", gap: 9, minWidth: 900, alignItems: "stretch" }}>
          {BUCKETS.map(b => {
            const total = visible.filter(t => t.bucket === b.id).length;
            const open = visible.filter(t => t.bucket === b.id && !t.done).length;
            return (
              <div key={b.id} style={{ background: PANEL_BG, border: BORDER, borderRadius: 11, display: "flex", flexDirection: "column", minWidth: 0 }}>
                <div style={{ padding: "10px 10px 8px", borderBottom: BORDER }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 4 }}>
                    <span style={{
                      width: 20, height: 20, borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center",
                      background: hexA(b.color, 0.14), color: b.color, fontSize: 11.5, fontWeight: 900, flexShrink: 0,
                    }}>{b.letter}</span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: "#111111", flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{b.name}</span>
                    <span style={{ fontSize: 10, fontWeight: 700, color: "#949494" }}>
                      {open}{total !== open ? `/${total}` : ""}
                    </span>
                  </div>
                  <p style={{ fontSize: 9.5, color: "#949494", lineHeight: 1.45 }}>{b.blurb}</p>
                </div>

                <div style={{ padding: 7, flex: 1, display: "flex", flexDirection: "column" }}>
                  {HAS_LEVELS.has(b.id) ? (
                    levelsFor(b.id).map(l => (
                      <div key={l.priority} style={{ marginBottom: 5 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "2px 3px 4px" }}>
                          <span style={{ width: 5, height: 5, borderRadius: "50%", background: l.color, flexShrink: 0 }} />
                          <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.08em", color: l.color }}>{l.label}</span>
                          <span style={{ fontSize: 8.5, color: "#c2c2c2" }}>{l.hint}</span>
                        </div>
                        <Lane bucket={b.id} priority={l.priority} accent={l.color} empty="Drop here" />
                      </div>
                    ))
                  ) : (
                    <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
                      <Lane bucket={b.id} priority={1} accent={b.color} empty="Empty" fill />
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: "0.08em", color: "#949494", marginBottom: 3 }}>
        {label.toUpperCase()}
      </p>
      {children}
    </div>
  );
}

function Arrow({ dir, onClick }: { dir: "left" | "right"; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{ width: 28, height: 28, borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center", color: "#767676", cursor: "pointer", background: "rgba(0,0,0,0.041)" }}
      onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = "#111111"}
      onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = "#767676"}
    >
      <svg style={{ width: 13, height: 13 }} fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d={dir === "left" ? "M15 19l-7-7 7-7" : "M9 5l7 7-7 7"} />
      </svg>
    </button>
  );
}

const fieldStyle: React.CSSProperties = {
  background: "#ffffff",
  border: "1px solid rgba(0,0,0,0.135)",
  borderRadius: 6,
  padding: "6px 9px",
  fontSize: 11.5,
  color: "#111111",
  outline: "none",
  width: "100%",
};

/* ── Eat That Frog: the 21 principles, on demand ── */

const PRINCIPLES: [string, string][] = [
  ["Set the Table", "Get absolute clarity on what you want. Write down the goal, the deadline and the actions it needs."],
  ["Plan Every Day in Advance", "Decide tomorrow's priorities tonight. Planning makes the next action obvious."],
  ["Apply the 80/20 Rule", "A small number of activities produce most of your results. Concentrate your best effort there."],
  ["Consider the Consequences", "Rank by long-term payoff or cost. The tasks with the biggest consequences deserve you first."],
  ["Practice Creative Procrastination", "You cannot do everything. Deliberately postpone, delegate or drop low-value work."],
  ["Use the ABCDE Method", "A must do, B should do, C nice to do, D delegate, E eliminate. Always work the highest letter available."],
  ["Focus on Key Result Areas", "Identify the few results your role actually requires. Your weakest important area caps the rest."],
  ["Apply the Law of Three", "Three activities create most of your value. Build the day around them."],
  ["Prepare Thoroughly Before You Begin", "Gather everything first. Preparation removes friction and makes starting easy."],
  ["Take It One Oil Barrel at a Time", "Focus on the next step, not the whole journey. Big goals move one action at a time."],
  ["Upgrade Your Key Skills", "Improve the skills with the greatest impact on your results. Competence makes hard tasks easier."],
  ["Leverage Your Special Talents", "Find what you naturally do well and spend more of your time doing it."],
  ["Identify Your Key Constraints", "Find the bottleneck limiting progress. Removing it unlocks disproportionate results."],
  ["Put the Pressure on Yourself", "Set your own deadlines and standards instead of waiting for someone else's."],
  ["Maximise Your Personal Powers", "Protect your physical and mental energy. Work with your natural energy cycles."],
  ["Motivate Yourself into Action", "Don't wait to feel motivated. Action creates the momentum, not the other way round."],
  ["Get Out of the Technological Time Sinks", "Control email, notifications and social media. Technology should serve your priorities."],
  ["Slice and Dice the Task", "Break intimidating projects into small pieces so starting stops being the hard part."],
  ["Create Large Chunks of Time", "Reserve uninterrupted blocks for important work and defend them."],
  ["Develop a Sense of Urgency", "Once you know what matters, move fast. Speed prevents procrastination taking hold."],
  ["Single Handle Every Task", "Start it, stay with it, finish it. Switching is what kills the return."],
];

const CHECKLIST = [
  "What is my number one priority — my frog — right now?",
  "Have I planned this day in advance?",
  "Am I working on the 20% that matters most?",
  "What can I eliminate, delegate or postpone?",
  "Have I identified the next concrete action?",
  "Have I blocked enough uninterrupted time to finish it?",
  "Are notifications, email and other distractions turned off?",
  "Can I start now rather than wait to feel motivated?",
];

function FrogGuide({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed", inset: 0, zIndex: 60, background: "rgba(0,0,0,0.45)",
        display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: "#ffffff", borderRadius: 14, maxWidth: 940, width: "100%", maxHeight: "88vh",
          overflowY: "auto", boxShadow: "0 24px 60px rgba(0,0,0,0.28)",
        }}
      >
        {/* Header */}
        <div style={{
          position: "sticky", top: 0, background: "#ffffff", borderBottom: "1px solid rgba(0,0,0,0.08)",
          padding: "16px 22px", display: "flex", alignItems: "center", gap: 12, zIndex: 1,
        }}>
          <span style={{ fontSize: 24, lineHeight: 1 }}>🐸</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 17, fontWeight: 800, color: "#111111", letterSpacing: "-0.01em" }}>Eat That Frog!</p>
            <p style={{ fontSize: 11, color: "#8c8c8c" }}>Brian Tracy — 21 ways to stop procrastinating and get more done</p>
          </div>
          <button
            onClick={onClose}
            style={{ width: 28, height: 28, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", color: "#8c8c8c", cursor: "pointer", background: "rgba(0,0,0,0.045)" }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = "#111111"}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = "#8c8c8c"}
          >
            <svg style={{ width: 14, height: 14 }} fill="none" stroke="currentColor" strokeWidth={2.2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div style={{ padding: 22 }}>
          {/* Core idea */}
          <div style={{ background: "rgba(0,0,0,0.035)", border: "1px solid rgba(0,0,0,0.07)", borderRadius: 10, padding: "12px 15px", marginBottom: 20 }}>
            <p style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.12em", color: "#8c8c8c", marginBottom: 4 }}>THE CORE IDEA</p>
            <p style={{ fontSize: 13, lineHeight: 1.6, color: "#333333" }}>
              Your frog is the most important task you can do — the one with the biggest payoff and the one you are
              most likely to put off. <strong style={{ color: "#111111" }}>Identify it, prioritise it, and do it first.</strong>
            </p>
          </div>

          {/* 21 principles */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: "14px 26px" }}>
            {PRINCIPLES.map(([title, body], i) => (
              <div key={title} style={{ display: "flex", gap: 10 }}>
                <span style={{
                  flexShrink: 0, width: 20, height: 20, borderRadius: "50%", background: "#111111", color: "#ffffff",
                  fontSize: 10, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center", marginTop: 1,
                }}>{i + 1}</span>
                <div style={{ minWidth: 0 }}>
                  <p style={{ fontSize: 12.5, fontWeight: 700, color: "#111111", marginBottom: 2 }}>{title}</p>
                  <p style={{ fontSize: 11.5, lineHeight: 1.55, color: "#6b6b6b" }}>{body}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Daily checklist */}
          <div style={{ marginTop: 24, paddingTop: 20, borderTop: "1px solid rgba(0,0,0,0.08)" }}>
            <p style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.12em", color: "#8c8c8c", marginBottom: 10 }}>DAILY FROG CHECKLIST</p>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "7px 26px" }}>
              {CHECKLIST.map(q => (
                <div key={q} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                  <span style={{ flexShrink: 0, width: 11, height: 11, borderRadius: 3, border: "1.5px solid rgba(0,0,0,0.22)", marginTop: 3 }} />
                  <p style={{ fontSize: 11.5, lineHeight: 1.5, color: "#333333" }}>{q}</p>
                </div>
              ))}
            </div>
          </div>

          <p style={{ marginTop: 22, textAlign: "center", fontSize: 12, fontStyle: "italic", color: "#8c8c8c" }}>
            “Nature does not hurry, yet everything is accomplished.” — Lao Tzu
          </p>
        </div>
      </div>
    </div>
  );
}
