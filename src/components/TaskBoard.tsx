"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Bucket = "A" | "B" | "C" | "D" | "E";

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
};

const BUCKETS: {
  id: Bucket; letter: string; name: string; blurb: string; color: string; icon: string;
}[] = [
  { id: "A", letter: "A", name: "Must Do",   blurb: "Serious consequences if left undone. This is the frog.", color: "#c0392b",
    icon: "M13 10V3L4 14h7v7l9-11h-7z" },
  { id: "B", letter: "B", name: "Should Do", blurb: "Mild consequences if delayed. Important, not critical.",  color: "#000000",
    icon: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" },
  { id: "C", letter: "C", name: "Nice to Do", blurb: "No consequences either way. Casual or social.",          color: "#000000",
    icon: "M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.86 9.86 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" },
  { id: "D", letter: "D", name: "Delegate",  blurb: "Important, but someone (or something) else can do it.",   color: "#4a4a4a",
    icon: "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" },
  { id: "E", letter: "E", name: "Eliminate", blurb: "Unnecessary and wasteful. Cut it.",                       color: "#6b6b6b",
    icon: "M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" },
];

const A_LEVELS: { priority: number; label: string; color: string; hint: string }[] = [
  { priority: 1, label: "A1", color: "#c0392b", hint: "The frog — do it first" },
  { priority: 2, label: "A2", color: "#f97316", hint: "Next most serious" },
  { priority: 3, label: "A3", color: "#000000", hint: "Still a must, but last" },
];

const CARD_BG = "#0b1628";
const PANEL_BG = "#ffffff";
const BORDER = "1px solid rgba(0,0,0,0.081)";

function hexA(hex: string, alpha: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function fmtDue(d: string) {
  const due = new Date(`${d}T00:00:00`);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const days = Math.round((due.getTime() - today.getTime()) / 86400000);
  if (days === 0) return { text: "Today", overdue: false, soon: true };
  if (days === 1) return { text: "Tomorrow", overdue: false, soon: true };
  if (days < 0) return { text: `${Math.abs(days)}d overdue`, overdue: true, soon: false };
  return { text: due.toLocaleDateString("en-US", { month: "short", day: "numeric" }), overdue: false, soon: days <= 3 };
}

export default function TaskBoard() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hideDone, setHideDone] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newBucket, setNewBucket] = useState<Bucket>("A");
  const [newPriority, setNewPriority] = useState(1);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropZone, setDropZone] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const addRef = useRef<HTMLInputElement>(null);

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

  const listFor = useMemo(() => {
    return (bucket: Bucket, priority?: number) =>
      tasks
        .filter(t => t.bucket === bucket && (priority == null || t.priority === priority))
        .filter(t => !(hideDone && t.done))
        .sort((a, b) => (a.done === b.done ? a.position - b.position : a.done ? 1 : -1));
  }, [tasks, hideDone]);

  const frog = useMemo(
    () => tasks.filter(t => t.bucket === "A" && !t.done)
               .sort((a, b) => a.priority - b.priority || a.position - b.position)[0] ?? null,
    [tasks],
  );

  const doneCount = tasks.filter(t => t.done).length;

  async function addTask() {
    const title = newTitle.trim();
    if (!title) return;
    setNewTitle("");
    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, bucket: newBucket, priority: newPriority, position: Date.now() }),
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

  async function clearCompleted() {
    setTasks(prev => prev.filter(t => !t.done));
    await fetch("/api/tasks?clear_completed=true", { method: "DELETE" });
  }

  // Drop onto a column (or an A-level lane) → append to the end of it.
  function dropInto(bucket: Bucket, priority: number) {
    if (!dragId) return;
    const siblings = tasks.filter(t => t.bucket === bucket && t.priority === priority && t.id !== dragId);
    const max = siblings.reduce((m, t) => Math.max(m, t.position), 0);
    patch(dragId, { bucket, priority, position: max + 1000 });
    setDragId(null); setDropZone(null);
  }

  // Drop onto a card → land immediately above it.
  function dropBefore(target: Task) {
    if (!dragId || dragId === target.id) { setDragId(null); setDropZone(null); return; }
    const lane = tasks
      .filter(t => t.bucket === target.bucket && t.priority === target.priority && t.id !== dragId)
      .sort((a, b) => a.position - b.position);
    const i = lane.findIndex(t => t.id === target.id);
    const before = i > 0 ? lane[i - 1].position : target.position - 2000;
    patch(dragId, { bucket: target.bucket, priority: target.priority, position: (before + target.position) / 2 });
    setDragId(null); setDropZone(null);
  }

  function Card({ task, accent }: { task: Task; accent: string }) {
    const open = expandedId === task.id;
    const due = task.due_date ? fmtDue(task.due_date) : null;
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
          borderRadius: 8,
          padding: "8px 10px",
          marginBottom: 6,
          cursor: "grab",
          opacity: dragId === task.id ? 0.4 : task.done ? 0.45 : 1,
          boxShadow: dropZone === `card:${task.id}` ? `0 -2px 0 ${accent}` : "none",
          transition: "opacity 120ms, box-shadow 120ms",
        }}
      >
        <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
          <button
            onClick={() => patch(task.id, { done: !task.done })}
            title={task.done ? "Mark as not done" : "Mark as done"}
            style={{
              flexShrink: 0, width: 15, height: 15, marginTop: 2, borderRadius: 4,
              border: `1.5px solid ${task.done ? accent : "rgba(0,0,0,0.27)"}`,
              background: task.done ? accent : "transparent",
              display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer",
            }}
          >
            {task.done && (
              <svg style={{ width: 9, height: 9, color: "#0b1628" }} fill="none" stroke="currentColor" strokeWidth={3.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            )}
          </button>

          <div style={{ flex: 1, minWidth: 0 }} onClick={() => setExpandedId(open ? null : task.id)}>
            <p style={{
              fontSize: 12.5, lineHeight: 1.45, color: task.done ? "#767676" : "#111111",
              textDecoration: task.done ? "line-through" : "none", wordBreak: "break-word", cursor: "pointer",
            }}>
              {isFrog && !task.done && <span style={{ marginRight: 5 }}>🐸</span>}
              {task.title}
            </p>

            {(due || task.delegate_to || task.notes) && !open && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 5 }}>
                {due && (
                  <span style={{
                    fontSize: 9.5, fontWeight: 700, padding: "2px 6px", borderRadius: 4, letterSpacing: "0.02em",
                    background: due.overdue ? "rgba(192,57,43,0.14)" : due.soon ? "rgba(0,0,0,0.072)" : "rgba(0,0,0,0.068)",
                    color: due.overdue ? "#c0392b" : due.soon ? "#000000" : "#6b6b6b",
                  }}>{due.text}</span>
                )}
                {task.delegate_to && (
                  <span style={{ fontSize: 9.5, fontWeight: 700, padding: "2px 6px", borderRadius: 4, background: "rgba(0,0,0,0.06)", color: "#6b6b6b" }}>
                    → {task.delegate_to}
                  </span>
                )}
                {task.notes && (
                  <span style={{ fontSize: 9.5, fontWeight: 700, padding: "2px 6px", borderRadius: 4, background: "rgba(0,0,0,0.068)", color: "#767676" }}>
                    note
                  </span>
                )}
              </div>
            )}
          </div>

          <button
            onClick={() => remove(task.id)}
            title="Delete task"
            style={{ flexShrink: 0, color: "#949494", cursor: "pointer", lineHeight: 0, padding: 2 }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = "#c0392b"}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = "#949494"}
          >
            <svg style={{ width: 12, height: 12 }} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {open && (
          <div style={{ marginTop: 8, paddingTop: 8, borderTop: BORDER, display: "flex", flexDirection: "column", gap: 6 }}>
            <input
              defaultValue={task.title}
              onBlur={e => { const v = e.target.value.trim(); if (v && v !== task.title) patch(task.id, { title: v }); }}
              style={fieldStyle}
            />
            <textarea
              defaultValue={task.notes ?? ""}
              placeholder="Notes…"
              rows={2}
              onBlur={e => { if (e.target.value !== (task.notes ?? "")) patch(task.id, { notes: e.target.value }); }}
              style={{ ...fieldStyle, resize: "vertical" }}
            />
            <div style={{ display: "flex", gap: 6 }}>
              <input
                type="date"
                defaultValue={task.due_date ?? ""}
                onChange={e => patch(task.id, { due_date: e.target.value || null })}
                style={{ ...fieldStyle, flex: 1 }}
              />
              {task.bucket === "D" && (
                <input
                  defaultValue={task.delegate_to ?? ""}
                  placeholder="Delegate to…"
                  onBlur={e => { if (e.target.value !== (task.delegate_to ?? "")) patch(task.id, { delegate_to: e.target.value }); }}
                  style={{ ...fieldStyle, flex: 1 }}
                />
              )}
            </div>
            <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
              {BUCKETS.map(b => (
                <button
                  key={b.id}
                  onClick={() => patch(task.id, { bucket: b.id })}
                  style={{
                    fontSize: 9.5, fontWeight: 800, padding: "3px 8px", borderRadius: 4, cursor: "pointer",
                    background: task.bucket === b.id ? hexA(b.color, 0.18) : "rgba(0,0,0,0.054)",
                    color: task.bucket === b.id ? b.color : "#767676",
                  }}
                >{b.letter}</button>
              ))}
              {task.bucket === "A" && A_LEVELS.map(l => (
                <button
                  key={l.priority}
                  onClick={() => patch(task.id, { priority: l.priority })}
                  style={{
                    fontSize: 9.5, fontWeight: 800, padding: "3px 8px", borderRadius: 4, cursor: "pointer",
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

  function Lane({ bucket, priority, accent, empty }: { bucket: Bucket; priority: number; accent: string; empty: string }) {
    const items = listFor(bucket, bucket === "A" ? priority : undefined);
    const zone = `lane:${bucket}:${priority}`;
    return (
      <div
        onDragOver={e => { e.preventDefault(); setDropZone(zone); }}
        onDragLeave={() => setDropZone(z => (z === zone ? null : z))}
        onDrop={e => { e.preventDefault(); dropInto(bucket, priority); }}
        style={{
          minHeight: 54, borderRadius: 8, padding: 4,
          background: dropZone === zone ? hexA(accent, 0.07) : "transparent",
          border: `1px dashed ${dropZone === zone ? hexA(accent, 0.35) : "transparent"}`,
          transition: "background 120ms",
        }}
      >
        {items.map(t => <Card key={t.id} task={t} accent={accent} />)}
        {items.length === 0 && (
          <p style={{ fontSize: 10.5, color: "#c2c2c2", textAlign: "center", padding: "14px 6px", lineHeight: 1.5 }}>
            {empty}
          </p>
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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* Frog banner */}
      <div style={{
        background: frog ? "linear-gradient(90deg, rgba(192,57,43,0.10), rgba(192,57,43,0.02))" : PANEL_BG,
        border: `1px solid ${frog ? "rgba(192,57,43,0.20)" : "rgba(0,0,0,0.081)"}`,
        borderRadius: 12, padding: "14px 18px", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap",
      }}>
        <span style={{ fontSize: 26, lineHeight: 1 }}>🐸</span>
        <div style={{ flex: 1, minWidth: 200 }}>
          <p style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.12em", color: "#6b6b6b", marginBottom: 3 }}>
            EAT THIS FROG FIRST
          </p>
          <p style={{ fontSize: 15, fontWeight: 700, color: frog ? "#111111" : "#949494" }}>
            {frog ? frog.title : "Nothing in A — add your must-do task to get started."}
          </p>
        </div>
        {frog && (
          <button
            onClick={() => patch(frog.id, { done: true })}
            style={{ background: "#c0392b", color: "#fff", fontSize: 12, fontWeight: 700, padding: "8px 16px", borderRadius: 8, cursor: "pointer", whiteSpace: "nowrap" }}
          >
            Mark Done
          </button>
        )}
      </div>

      {/* Add bar */}
      <div style={{ background: PANEL_BG, border: BORDER, borderRadius: 12, padding: 12, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input
          ref={addRef}
          value={newTitle}
          onChange={e => setNewTitle(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") addTask(); }}
          placeholder="What needs doing?"
          style={{ ...fieldStyle, flex: 1, minWidth: 200, fontSize: 13, padding: "9px 12px" }}
        />
        <div style={{ display: "flex", gap: 4 }}>
          {BUCKETS.map(b => (
            <button
              key={b.id}
              onClick={() => setNewBucket(b.id)}
              title={`${b.name} — ${b.blurb}`}
              style={{
                width: 30, height: 34, borderRadius: 7, fontSize: 12.5, fontWeight: 800, cursor: "pointer",
                background: newBucket === b.id ? hexA(b.color, 0.16) : "rgba(0,0,0,0.041)",
                border: `1px solid ${newBucket === b.id ? hexA(b.color, 0.4) : "rgba(0,0,0,0.081)"}`,
                color: newBucket === b.id ? b.color : "#767676",
              }}
            >{b.letter}</button>
          ))}
        </div>
        {newBucket === "A" && (
          <div style={{ display: "flex", gap: 4 }}>
            {A_LEVELS.map(l => (
              <button
                key={l.priority}
                onClick={() => setNewPriority(l.priority)}
                title={l.hint}
                style={{
                  height: 34, padding: "0 10px", borderRadius: 7, fontSize: 11.5, fontWeight: 800, cursor: "pointer",
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
          style={{ background: "#000000", color: "#fff", fontSize: 13, fontWeight: 700, padding: "9px 18px", borderRadius: 8, cursor: "pointer" }}
        >
          Add Task
        </button>
      </div>

      {/* Board controls */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <p style={{ fontSize: 11, color: "#949494", marginRight: "auto" }}>
          Drag any task between columns to re-prioritise.
        </p>
        <button
          onClick={() => setHideDone(v => !v)}
          style={{ fontSize: 11, fontWeight: 600, color: hideDone ? "#000000" : "#767676", cursor: "pointer" }}
        >
          {hideDone ? "Show completed" : "Hide completed"}
        </button>
        {doneCount > 0 && (
          <button
            onClick={clearCompleted}
            style={{ fontSize: 11, fontWeight: 600, color: "#767676", cursor: "pointer" }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = "#c0392b"}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = "#767676"}
          >
            Clear {doneCount} completed
          </button>
        )}
      </div>

      {/* Columns */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 12, alignItems: "start" }}>
        {BUCKETS.map(b => {
          const total = tasks.filter(t => t.bucket === b.id).length;
          const open = tasks.filter(t => t.bucket === b.id && !t.done).length;
          return (
            <div key={b.id} style={{ background: PANEL_BG, border: BORDER, borderRadius: 12, display: "flex", flexDirection: "column", minWidth: 0 }}>
              {/* Column header */}
              <div style={{ padding: "12px 12px 10px", borderBottom: BORDER }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
                  <span style={{
                    width: 22, height: 22, borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center",
                    background: hexA(b.color, 0.14), color: b.color, fontSize: 12, fontWeight: 900,
                  }}>{b.letter}</span>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: "#111111", flex: 1 }}>{b.name}</span>
                  <span style={{ fontSize: 10.5, fontWeight: 700, color: "#949494" }}>
                    {open}{total !== open ? `/${total}` : ""}
                  </span>
                </div>
                <p style={{ fontSize: 10, color: "#949494", lineHeight: 1.5 }}>{b.blurb}</p>
              </div>

              {/* Column body */}
              <div style={{ padding: 8 }}>
                {b.id === "A" ? (
                  A_LEVELS.map(l => (
                    <div key={l.priority} style={{ marginBottom: 6 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "2px 4px 5px" }}>
                        <span style={{ width: 6, height: 6, borderRadius: "50%", background: l.color }} />
                        <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.08em", color: l.color }}>{l.label}</span>
                        <span style={{ fontSize: 9, color: "#c2c2c2" }}>{l.hint}</span>
                      </div>
                      <Lane bucket="A" priority={l.priority} accent={l.color} empty="Drop here" />
                    </div>
                  ))
                ) : (
                  <Lane bucket={b.id} priority={1} accent={b.color} empty="Nothing here yet" />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
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
