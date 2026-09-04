"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Bucket = "A" | "B" | "C" | "D" | "E";
type Scope = "day" | "week" | "backlog" | "inbox";
type ListTab = "daily" | "long";
type ViewMode = "day" | "week" | "month";

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
  task_date: string | null;
  scope: Scope;
  from_list: boolean;
  origin: string | null;
};

const BUCKETS: { id: Bucket; letter: string; name: string; blurb: string; color: string }[] = [
  { id: "A", letter: "A", name: "Must Do",    blurb: "Serious consequences if left undone. The frog.", color: "#000000" },
  { id: "B", letter: "B", name: "Should Do",  blurb: "Mild consequences if delayed. Not critical.",     color: "#333333" },
  { id: "C", letter: "C", name: "Nice to Do", blurb: "No consequences. Casual or social.",              color: "#5a5a5a" },
  { id: "D", letter: "D", name: "Delegate",   blurb: "Important, but someone else can do it.",          color: "#8c8c8c" },
  { id: "E", letter: "E", name: "Eliminate",  blurb: "Unnecessary and wasteful. Cut it.",               color: "#b0b0b0" },
];

// A carries three levels (A1-A3). Weight, not hue, signals urgency: darkest
// first.
const LEVEL_SHADES = ["#111111", "#5a5a5a", "#8c8c8c"];
const LEVEL_HINTS  = ["do first", "next", "last"];

// Only A is ranked — everything below the must-do bucket is a flat list.
const HAS_LEVELS = new Set<Bucket>(["A"]);

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
const monthStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), 1);
const addMonths = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth() + n, 1);

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

function monthLabel(startISO: string) {
  const d = parseISO(startISO);
  const now = monthStart(new Date());
  const diff = (d.getFullYear() - now.getFullYear()) * 12 + (d.getMonth() - now.getMonth());
  return {
    main: d.toLocaleDateString("en-US", { month: "long", year: "numeric" }),
    badge: diff === 0 ? "This Month" : diff === -1 ? "Last Month" : null,
    past: diff < 0,
  };
}

// Phones get a stacked, tap-driven layout — drag and drop is a desktop affordance.
function usePhone() {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 768px)");
    const sync = () => setPhone(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  return phone;
}

export default function TaskBoard() {
  const phone = usePhone();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>("day");
  const [dayDate, setDayDate] = useState(() => iso(new Date()));
  const [weekDate, setWeekDate] = useState(() => iso(weekStart(new Date())));
  const [monthDate, setMonthDate] = useState(() => iso(monthStart(new Date())));
  const [hideDone, setHideDone] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newBucket, setNewBucket] = useState<Bucket>("A");
  const [newPriority, setNewPriority] = useState(1);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropZone, setDropZone] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showGuide, setShowGuide] = useState(false);
  const [catchUpIds, setCatchUpIds] = useState<string[] | null>(null);
  const [past, setPast] = useState<{ undo: () => Promise<void>; redo: () => Promise<void> }[]>([]);
  const [future, setFuture] = useState<{ undo: () => Promise<void>; redo: () => Promise<void> }[]>([]);
  const [showList, setShowList] = useState(false);
  const [listTitle, setListTitle] = useState("");
  const [listTab, setListTab] = useState<ListTab>("daily");
  const [monthTab, setMonthTab] = useState<ListTab>("daily");
  const [editingListId, setEditingListId] = useState<string | null>(null);
  const [dragFromList, setDragFromList] = useState(false);
  const addRef = useRef<HTMLInputElement>(null);

  // The board only ever plans a day or a week; "month" is a review of what got done.
  const scope: Scope = view === "week" ? "week" : "day";
  const anchor = view === "week" ? weekDate : dayDate;

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
    () => tasks.filter(t => t.scope === scope && !t.done && !!t.task_date && t.task_date < anchor),
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

  // The quick list for the day (or week) in view: captured, not yet given a letter.
  const inboxAnchor = view === "month" ? iso(new Date()) : anchor;
  const inbox = useMemo(
    () => tasks.filter(t => t.scope === "inbox" && !t.done && t.task_date === inboxAnchor)
                .sort((a, b) => a.position - b.position),
    [tasks, inboxAnchor],
  );

  // The long-term to-do list: everything captured but not yet placed on a day.
  const backlog = useMemo(
    () => tasks.filter(t => !t.done && (t.scope === "backlog" || t.from_list))
                .sort((a, b) => a.position - b.position),
    [tasks],
  );

  // Scheduling a list item keeps it on the list — only ticking it off removes it.
  // The flag is only ever set, never cleared here, so a drag can't silently unlink a task.
  const listLink = (id: string | null) => {
    const t = tasks.find(x => x.id === id);
    if (t?.scope === "inbox") return { origin: "inbox" };
    const fromProjects = dragFromList || (!!t && (t.scope === "backlog" || t.from_list || t.origin === "backlog"));
    return fromProjects ? { from_list: true, origin: "backlog" } : {};
  };

  const rows = listTab === "daily" ? inbox : backlog;

  // Month review: a Mon-Sun grid of the month, plus everything completed in it.
  const month = useMemo(() => {
    const first = parseISO(monthDate);
    const gridStart = weekStart(first);
    const last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
    const weeks = Math.ceil((Math.round((last.getTime() - gridStart.getTime()) / 86400000) + 1) / 7);

    const cells = Array.from({ length: weeks * 7 }, (_, i) => {
      const d = addDays(gridStart, i);
      const key = iso(d);
      const dayTasks = tasks.filter(t => t.scope === "day" && t.task_date === key);
      return {
        key,
        num: d.getDate(),
        inMonth: d.getMonth() === first.getMonth(),
        isToday: key === iso(new Date()),
        total: dayTasks.length,
        done: dayTasks.filter(t => t.done).length,
      };
    });

    // Grouped by the day it was actually ticked off.
    const prefix = monthDate.slice(0, 7);
    const doneOn = (t: Task) => (t.completed_at ? t.completed_at.slice(0, 10) : t.task_date) ?? "";
    const finished = tasks.filter(t => t.done && doneOn(t).startsWith(prefix));
    const isProject = (t: Task) => t.origin === "backlog" || t.from_list;

    const group = (list: Task[]) => {
      const out: { date: string; items: Task[] }[] = [];
      for (const t of [...list].sort((a, b) => doneOn(b).localeCompare(doneOn(a)) || a.position - b.position)) {
        const key = doneOn(t);
        const row = out.find(r => r.date === key);
        if (row) row.items.push(t); else out.push({ date: key, items: [t] });
      }
      return out;
    };

    const projects = finished.filter(isProject);
    const small = finished.filter(t => !isProject(t));
    return { cells, weeks, projects: group(projects), small: group(small), projectCount: projects.length, smallCount: small.length };
  }, [tasks, monthDate]);

  /* ── Server writes, and the history that lets them be undone ───────────────
     Every change records how to reverse it. Undoing a delete has to create a
     fresh row, so ids are resolved through a map before each replay. */

  type Action = { undo: () => Promise<void>; redo: () => Promise<void> };
  const idMap = useRef<Record<string, string>>({});

  const liveId = (id: string) => {
    let cur = id;
    const seen = new Set<string>();
    while (idMap.current[cur] && !seen.has(cur)) { seen.add(cur); cur = idMap.current[cur]; }
    return cur;
  };

  function record(action: Action) {
    setPast(p => [...p, action]);
    setFuture([]);
  }

  async function applyPatch(id: string, changes: Partial<Task>) {
    setTasks(prev => prev.map(t => (t.id === id ? { ...t, ...changes } as Task : t)));
    const res = await fetch("/api/tasks", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...changes }),
    });
    const d = await res.json();
    if (d.task) setTasks(prev => prev.map(t => (t.id === id ? d.task : t)));
  }

  async function applyRemove(id: string) {
    setTasks(prev => prev.filter(t => t.id !== id));
    await fetch(`/api/tasks?id=${id}`, { method: "DELETE" });
  }

  // Re-creates a row from a snapshot and returns the new task.
  async function applyCreate(fields: Record<string, unknown>, wasDone = false) {
    const res = await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(fields),
    });
    const d = await res.json();
    if (!d.task) return null;
    let task: Task = d.task;
    if (wasDone) {
      const done = await fetch("/api/tasks", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: task.id, done: true }),
      }).then(r => r.json());
      if (done.task) task = done.task;
    }
    setTasks(prev => [...prev, task]);
    return task;
  }

  const nextPos = (list: Task[]) => list.reduce((m, t) => Math.max(m, t.position), 0) + 1000;

  const snapshot = (t: Task) => ({
    title: t.title, notes: t.notes, bucket: t.bucket, priority: t.priority, position: t.position,
    due_date: t.due_date, delegate_to: t.delegate_to, task_date: t.task_date, scope: t.scope,
    from_list: t.from_list, origin: t.origin,
  });

  // Recreate-then-remap, so later history entries still point at the live row.
  function restoreAction(task: Task): Action {
    const originalId = task.id;
    return {
      undo: async () => {
        const fresh = await applyCreate(snapshot(task), task.done);
        if (fresh) idMap.current[liveId(originalId)] = fresh.id;
      },
      redo: async () => { await applyRemove(liveId(originalId)); },
    };
  }

  function patch(id: string, changes: Partial<Task>) {
    const t = tasks.find(x => x.id === id);
    if (t) {
      const before: Partial<Task> = {};
      for (const k of Object.keys(changes) as (keyof Task)[]) {
        (before as Record<string, unknown>)[k] = t[k];
      }
      record({
        undo: () => applyPatch(liveId(id), before),
        redo: () => applyPatch(liveId(id), changes),
      });
    }
    return applyPatch(id, changes);
  }

  function remove(id: string) {
    const t = tasks.find(x => x.id === id);
    if (t) record(restoreAction(t));
    return applyRemove(id);
  }

  async function create(fields: Record<string, unknown>) {
    const task = await applyCreate(fields);
    if (!task) return null;
    const originalId = task.id;
    record({
      undo: async () => { await applyRemove(liveId(originalId)); },
      redo: async () => {
        const fresh = await applyCreate(fields);
        if (fresh) idMap.current[liveId(originalId)] = fresh.id;
      },
    });
    return task;
  }

  async function undo() {
    const action = past[past.length - 1];
    if (!action) return;
    setPast(p => p.slice(0, -1));
    setFuture(f => [...f, action]);
    await action.undo();
  }

  async function redo() {
    const action = future[future.length - 1];
    if (!action) return;
    setFuture(f => f.slice(0, -1));
    setPast(p => [...p, action]);
    await action.redo();
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "z") return;
      const el = e.target as HTMLElement | null;
      if (el && ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)) return;
      e.preventDefault();
      if (e.shiftKey) redo(); else undo();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  async function addTask() {
    const title = newTitle.trim();
    if (!title) return;
    setNewTitle("");
    await create({
      title, bucket: newBucket,
      // Unranked buckets all sit at one level, whatever the hidden selector still holds.
      priority: HAS_LEVELS.has(newBucket) ? newPriority : 1,
      position: nextPos(visible.filter(t => t.bucket === newBucket)),
      task_date: anchor, scope,
    });
    addRef.current?.focus();
  }

  // Capture something into the long-term list (no date yet).
  async function addToList() {
    const title = listTitle.trim();
    if (!title) return;
    setListTitle("");
    await create(listTab === "daily"
      ? { title, bucket: "B", priority: 2, position: nextPos(inbox), scope: "inbox", task_date: inboxAnchor }
      : { title, bucket: "B", priority: 2, position: nextPos(backlog), scope: "backlog" });
  }

  // The X on a board card takes it off the day. Anything that came from a list
  // goes back to that list; only something typed straight onto the board is deleted.
  function clearFromBoard(task: Task) {
    if (task.origin === "backlog" || task.from_list) patch(task.id, { scope: "backlog", task_date: null });
    else if (task.origin === "inbox") patch(task.id, { scope: "inbox" });
    else remove(task.id);
  }

  // The X inside the list takes it off the list. If it is already sitting on a day,
  // that card stays put — only the link to the list goes.
  function removeFromList(t: Task) {
    if (t.scope === "backlog" || t.scope === "inbox") remove(t.id);
    else patch(t.id, { from_list: false, origin: null });
  }

  // Put a planned task back on the long-term list.
  function unschedule(task: Task) {
    patch(task.id, { scope: "backlog", task_date: null, from_list: false });
    setExpandedId(null);
  }

  async function pullForward(only?: string[]) {
    const ids = only ?? stranded.map(t => t.id);
    if (ids.length === 0) return;
    const before = ids.map(id => ({ id, task_date: tasks.find(t => t.id === id)?.task_date ?? null }));
    const target = anchor;
    record({
      undo: async () => { await Promise.all(before.map(b => applyPatch(liveId(b.id), { task_date: b.task_date }))); },
      redo: async () => { await Promise.all(ids.map(id => applyPatch(liveId(id), { task_date: target }))); },
    });
    await Promise.all(ids.map(id => applyPatch(id, { task_date: target })));
  }

  // Drop onto a column (or an A-level lane) → append to the end of it.
  function dropInto(dragged: string, bucket: Bucket, priority: number) {
    const dragId = dragged;
    const siblings = visible.filter(t => t.bucket === bucket && t.priority === priority && t.id !== dragId);
    const max = siblings.reduce((m, t) => Math.max(m, t.position), 0);
    patch(dragId, { bucket, priority, position: max + 1000, scope, task_date: anchor, ...listLink(dragId) });
    setDragId(null); setDropZone(null); setDragFromList(false);
  }

  // Drop onto a card → land immediately above it.
  function dropBefore(dragged: string, target: Task) {
    const dragId = dragged;
    if (dragId === target.id) return;
    const lane = visible
      .filter(t => t.bucket === target.bucket && t.priority === target.priority && t.id !== dragId)
      .sort((a, b) => a.position - b.position);
    const i = lane.findIndex(t => t.id === target.id);
    const before = i > 0 ? lane[i - 1].position : target.position - 2000;
    patch(dragId, { bucket: target.bucket, priority: target.priority, position: (before + target.position) / 2, scope, task_date: anchor, ...listLink(dragId) });
    setDragId(null); setDropZone(null); setDragFromList(false);
  }

  // Dropping onto a date in the day strip or the month grid schedules it there.
  function dropOnDate(dragged: string, dateISO: string) {
    const dragId = dragged;
    const max = tasks
      .filter(t => t.scope === "day" && t.task_date === dateISO && t.id !== dragId)
      .reduce((m, t) => Math.max(m, t.position), 0);
    patch(dragId, { scope: "day", task_date: dateISO, position: max + 1000, ...listLink(dragId) });
    setDragId(null); setDropZone(null); setDragFromList(false);
  }

  /* ── Dragging ───────────────────────────────────────────────────────────────
     Driven by pointer events rather than HTML5 drag-and-drop: the native API
     kept refusing to start a drag session here, and never worked on touch at
     all. A press only becomes a drag once the pointer has moved a few pixels,
     so ordinary clicks still open a card. */

  const drag = useRef<{ id: string; x: number; y: number; fromList: boolean; active: boolean } | null>(null);
  const [ghost, setGhost] = useState<{ x: number; y: number; title: string } | null>(null);

  function startDrag(e: React.PointerEvent, id: string, fromList: boolean) {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    drag.current = { id, x: e.clientX, y: e.clientY, fromList, active: false };
  }

  useEffect(() => {
    const zoneAt = (x: number, y: number) => {
      const el = document.elementFromPoint(x, y) as HTMLElement | null;
      return el?.closest("[data-drop]")?.getAttribute("data-drop") ?? null;
    };
    const stop = () => {
      drag.current = null;
      document.body.style.userSelect = "";
      setGhost(null); setDragId(null); setDropZone(null); setDragFromList(false);
    };
    function move(e: PointerEvent) {
      const d = drag.current;
      if (!d) return;
      if (!d.active) {
        if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 6) return;
        d.active = true;
        document.body.style.userSelect = "none";
        setDragId(d.id);
        setDragFromList(d.fromList);
      }
      e.preventDefault();
      setGhost({ x: e.clientX, y: e.clientY, title: tasks.find(t => t.id === d.id)?.title ?? "" });
      setDropZone(zoneAt(e.clientX, e.clientY));
    }
    function end(e: PointerEvent) {
      const d = drag.current;
      const zone = d?.active ? zoneAt(e.clientX, e.clientY) : null;
      stop();
      if (!d || !zone) return;
      if (zone.startsWith("lane:")) {
        const [, bucket, priority] = zone.split(":");
        dropInto(d.id, bucket as Bucket, Number(priority));
      } else if (zone.startsWith("card:")) {
        const target = tasks.find(t => t.id === zone.slice(5));
        if (target) dropBefore(d.id, target);
      } else if (zone.startsWith("date:")) {
        dropOnDate(d.id, zone.slice(5));
      }
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") stop(); };
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      window.removeEventListener("keydown", onKey);
    };
  });

  function step(n: number) {
    if (view === "day") setDayDate(iso(addDays(parseISO(dayDate), n)));
    else if (view === "week") setWeekDate(iso(addDays(parseISO(weekDate), n * 7)));
    else setMonthDate(iso(addMonths(parseISO(monthDate), n)));
  }

  function jumpToToday() {
    if (view === "day") setDayDate(iso(new Date()));
    else if (view === "week") setWeekDate(iso(weekStart(new Date())));
    else setMonthDate(iso(monthStart(new Date())));
  }

  const atToday =
    view === "day"   ? dayDate   === iso(new Date())
  : view === "week"  ? weekDate  === iso(weekStart(new Date()))
                     : monthDate === iso(monthStart(new Date()));

  const ctx: BoardCtx = {
    expandedId, setExpandedId, frog, dragId, dropZone, startDrag,
    patch, clearFromBoard, unschedule, scope, phone, listFor,
  };

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

  const label = view === "day" ? dayLabel(dayDate) : view === "week" ? weekLabel(weekDate) : monthLabel(monthDate);

  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>

      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 12 }}>

      {/* ── Priority banner ── */}
      {view !== "month" && (
      <div style={{
        background: frog ? "linear-gradient(90deg, rgba(0,0,0,0.07), rgba(0,0,0,0.014))" : PANEL_BG,
        border: `1px solid ${frog ? "rgba(0,0,0,0.14)" : "rgba(0,0,0,0.081)"}`,
        borderRadius: 12, padding: "12px 16px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap",
      }}>
        <span style={{ fontSize: 24, lineHeight: 1 }}>🌊</span>
        <div style={{ flex: 1, minWidth: 180 }}>
          <p style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.12em", color: "#6b6b6b", marginBottom: 2 }}>
            {scope === "day" ? "THE NEXT STEP IN THE CURRENT" : "BIGGEST OBJECTIVE THIS WEEK"}
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
      )}

      {showGuide && <FrogGuide onClose={() => setShowGuide(false)} />}

      {/* ── Date bar ── */}
      <div style={{ background: PANEL_BG, border: BORDER, borderRadius: 12, padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>

          {/* Day / Week / Month switch */}
          <div style={{ display: "flex", background: "rgba(0,0,0,0.054)", borderRadius: 8, padding: 2 }}>
            {(["day", "week", "month"] as ViewMode[]).map(v => (
              <button
                key={v}
                onClick={() => setView(v)}
                style={{
                  padding: "6px 13px", borderRadius: 6, fontSize: 11.5, fontWeight: 700, cursor: "pointer", textTransform: "capitalize",
                  background: view === v ? "#000000" : "transparent",
                  color: view === v ? "#fff" : "#767676",
                }}
              >{v}</button>
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
            {view === "month" ? (
              <input
                type="month"
                value={monthDate.slice(0, 7)}
                onChange={e => { if (e.target.value) setMonthDate(`${e.target.value}-01`); }}
                style={{ ...fieldStyle, width: "auto", fontSize: 11 }}
              />
            ) : phone ? null : (
              <input
                type="date"
                value={anchor}
                onChange={e => {
                  if (!e.target.value) return;
                  const d = parseISO(e.target.value);
                  if (view === "day") setDayDate(iso(d)); else setWeekDate(iso(weekStart(d)));
                }}
                style={{ ...fieldStyle, width: "auto", fontSize: 11 }}
              />
            )}
            {!atToday && (
              <button
                onClick={jumpToToday}
                style={{ fontSize: 11, fontWeight: 700, color: "#000000", cursor: "pointer", whiteSpace: "nowrap" }}
              >
                {view === "day" ? "Today" : view === "week" ? "This week" : "This month"}
              </button>
            )}
            <div style={{ display: "flex", gap: 4 }}>
              {([["undo", past.length > 0, undo, "Undo"], ["redo", future.length > 0, redo, "Redo"]] as const).map(([id, active, run, label]) => (
                <button
                  key={id}
                  onClick={() => { if (active) run(); }}
                  disabled={!active}
                  title={`${label} (${id === "undo" ? "⌘Z" : "⇧⌘Z"})`}
                  style={{
                    width: 30, height: 30, borderRadius: "50%", fontSize: 14,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    background: "rgba(0,0,0,0.045)", border: "1px solid rgba(0,0,0,0.09)",
                    color: active ? "#111111" : "#c2c2c2",
                    cursor: active ? "pointer" : "default", transition: "color 0.15s",
                  }}
                >
                  {id === "undo" ? "↩" : "↪"}
                </button>
              ))}
            </div>

            <button
              onClick={() => setShowList(true)}
              title="Your long-term to-do list"
              style={{
                display: "flex", alignItems: "center", gap: 6, padding: "6px 11px", borderRadius: 8, cursor: "pointer",
                background: "rgba(0,0,0,0.045)", border: "1px solid rgba(0,0,0,0.09)", color: "#111111",
                fontSize: 11.5, fontWeight: 700, whiteSpace: "nowrap",
              }}
            >
              <svg style={{ width: 13, height: 13 }} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
              </svg>
              To-Do List
              {backlog.length + inbox.length > 0 && (
                <span style={{ background: "#000000", color: "#fff", fontSize: 9.5, fontWeight: 800, padding: "1px 6px", borderRadius: 20 }}>
                  {backlog.length + inbox.length}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Day strip (Mon–Sun of the week in view) */}
        {view === "day" && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 5 }}>
            {strip.map(d => {
              const active = d.key === dayDate;
              return (
                <button
                  key={d.key}
                  onClick={() => setDayDate(d.key)}
                  data-drop={`date:${d.key}`}
                  style={{
                    padding: "6px 2px 5px", borderRadius: 8, cursor: "pointer", textAlign: "center",
                    background: dropZone === `date:${d.key}` ? "rgba(0,0,0,0.12)" : active ? "rgba(245,158,11,0.12)" : "rgba(0,0,0,0.027)",
                    border: `1px solid ${dropZone === `date:${d.key}` ? "rgba(0,0,0,0.5)" : active ? "rgba(245,158,11,0.35)" : d.isToday ? "rgba(0,0,0,0.189)" : "transparent"}`,
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
        {view !== "month" && (
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ flex: 1, height: 4, borderRadius: 4, background: "rgba(0,0,0,0.068)", overflow: "hidden" }}>
            <div style={{ width: `${pct}%`, height: "100%", background: pct === 100 ? "#5a5a5a" : "#000000", transition: "width 200ms" }} />
          </div>
          <span style={{ fontSize: 10.5, fontWeight: 700, color: "#767676", whiteSpace: "nowrap" }}>
            {doneCount} of {visible.length} done
          </span>
        </div>
        )}
      </div>

      {view !== "month" && (<>

      {/* ── Carried-over work ── */}
      {stranded.length > 0 && (
        <div style={{ background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.18)", borderRadius: 10, padding: "9px 14px", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, color: "#4a4a4a", flex: 1 }}>
            <strong style={{ color: "#000000" }}>{stranded.length}</strong> unfinished from earlier {scope === "day" ? "days" : "weeks"}.
          </span>
          <button
            onClick={() => setCatchUpIds(stranded.map(t => t.id))}
            style={{ fontSize: 11, fontWeight: 700, color: "#000000", cursor: "pointer", whiteSpace: "nowrap" }}
          >
            Review them
          </button>
        </div>
      )}

      {catchUpIds && (
        <CatchUp
          ids={catchUpIds}
          tasks={tasks}
          label={view === "week" ? "this week" : dayDate === iso(new Date()) ? "today" : "this day"}
          onTick={id => patch(id, { done: true })}
          onReAdd={ids => { pullForward(ids); setCatchUpIds(null); }}
          onClose={() => setCatchUpIds(null)}
        />
      )}

      {/* ── Add bar ── */}
      <div style={{ background: PANEL_BG, border: BORDER, borderRadius: 12, padding: 10, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <input
          ref={addRef}
          value={newTitle}
          onChange={e => setNewTitle(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") addTask(); }}
          placeholder={view === "week" ? "What's the objective this week?" : "What needs doing this day?"}
          style={{ ...fieldStyle, flex: 1, minWidth: phone ? "100%" : 180, fontSize: 12.5, padding: "8px 11px" }}
        />
        <div style={{ display: "flex", gap: 3, flex: phone ? 1 : "0 0 auto" }}>
          {BUCKETS.map(b => (
            <button
              key={b.id}
              onClick={() => setNewBucket(b.id)}
              title={`${b.name} — ${b.blurb}`}
              style={{
                width: phone ? undefined : 28, flex: phone ? 1 : "0 0 auto",
                height: 32, borderRadius: 7, fontSize: 12, fontWeight: 800, cursor: "pointer",
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
          style={{ background: "#000000", color: "#fff", fontSize: 12.5, fontWeight: 700, padding: "8px 16px", borderRadius: 8, cursor: "pointer", width: phone ? "100%" : undefined }}
        >
          Add
        </button>
      </div>

      {/* ── Board controls ── */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <p style={{ fontSize: 10.5, color: "#949494", marginRight: "auto" }}>
          {phone ? "Tap a task to change its letter or move it." : "Drag any task between columns to re-prioritise."}
        </p>
        <button
          onClick={() => setHideDone(v => !v)}
          style={{ fontSize: 10.5, fontWeight: 600, color: hideDone ? "#000000" : "#767676", cursor: "pointer" }}
        >
          {hideDone ? "Show completed" : "Hide completed"}
        </button>
      </div>

      {/* ── Five columns, always side by side ── */}
      <div style={{ overflowX: phone ? "visible" : "auto", paddingBottom: 4 }}>
        <div style={{ display: "grid", gridTemplateColumns: phone ? "1fr" : "repeat(5, minmax(0, 1fr))", gap: 9, minWidth: phone ? 0 : 900, alignItems: "stretch" }}>
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
                  {!phone && <p style={{ fontSize: 9.5, color: "#949494", lineHeight: 1.45 }}>{b.blurb}</p>}
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
                        <Lane bucket={b.id} priority={l.priority} accent={l.color} empty="Drop here" ctx={ctx} />
                      </div>
                    ))
                  ) : (
                    <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
                      <Lane bucket={b.id} priority={1} accent={b.color} empty="Empty" fill ctx={ctx} />
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      </>)}

      {/* ── Month review ── */}
      {view === "month" && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

          <div style={{ background: PANEL_BG, border: BORDER, borderRadius: 12, padding: 12 }}>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 5, marginBottom: 6 }}>
              {["M", "T", "W", "T", "F", "S", "S"].map((d, i) => (
                <p key={i} style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: "0.08em", color: "#949494", textAlign: "center" }}>{d}</p>
              ))}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 5 }}>
              {month.cells.map(c => {
                const complete = c.total > 0 && c.done === c.total;
                return (
                  <button
                    key={c.key}
                    onClick={() => { setDayDate(c.key); setView("day"); }}
                    data-drop={`date:${c.key}`}
                    title={c.total ? `${c.done} of ${c.total} done` : "Nothing planned"}
                    style={{
                      minHeight: phone ? 46 : 62, padding: phone ? "4px 2px" : "6px 4px", borderRadius: 8, cursor: "pointer", textAlign: "center",
                      opacity: c.inMonth ? 1 : 0.32,
                      background: dropZone === `date:${c.key}` ? "rgba(0,0,0,0.14)" : complete ? "rgba(0,0,0,0.08)" : "rgba(0,0,0,0.027)",
                      border: `1px solid ${dropZone === `date:${c.key}` ? "rgba(0,0,0,0.5)" : c.isToday ? "rgba(0,0,0,0.42)" : "transparent"}`,
                      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3,
                    }}
                  >
                    <span style={{ fontSize: 13, fontWeight: 700, color: "#111111", lineHeight: 1 }}>{c.num}</span>
                    {c.total > 0 ? (
                      <>
                        <span style={{ fontSize: 9, fontWeight: 700, color: complete ? "#111111" : "#767676" }}>{c.done}/{c.total}</span>
                        <span style={{ width: "72%", height: 3, borderRadius: 3, background: "rgba(0,0,0,0.09)", overflow: "hidden", display: "block" }}>
                          <span style={{ display: "block", height: "100%", width: `${Math.round((c.done / c.total) * 100)}%`, background: "#111111" }} />
                        </span>
                      </>
                    ) : (
                      <span style={{ fontSize: 9, color: "#c2c2c2" }}>—</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          <div style={{ background: PANEL_BG, border: BORDER, borderRadius: 12, padding: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12, flexWrap: "wrap" }}>
              <p style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.12em", color: "#949494", marginRight: "auto" }}>
                COMPLETED THIS MONTH
              </p>
              <div style={{ display: "flex", background: "rgba(0,0,0,0.054)", borderRadius: 8, padding: 2 }}>
                {([["daily", "Small Tasks", month.smallCount], ["long", "Big Projects", month.projectCount]] as [ListTab, string, number][]).map(([id, lbl, n]) => (
                  <button
                    key={id}
                    onClick={() => setMonthTab(id)}
                    style={{
                      padding: "5px 12px", borderRadius: 6, fontSize: 11, fontWeight: 700, cursor: "pointer",
                      background: monthTab === id ? "#000000" : "transparent",
                      color: monthTab === id ? "#fff" : "#767676",
                    }}
                  >
                    {lbl} <span style={{ opacity: 0.7 }}>{n}</span>
                  </button>
                ))}
              </div>
            </div>

            {(monthTab === "daily" ? month.small : month.projects).length === 0 ? (
              <p style={{ fontSize: 12, color: "#949494" }}>
                No {monthTab === "daily" ? "small tasks" : "big projects"} completed this month.
              </p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {(monthTab === "daily" ? month.small : month.projects).map(row => (
                  <div key={row.date}>
                    <button
                      onClick={() => { setDayDate(row.date); setView("day"); }}
                      style={{ fontSize: 10.5, fontWeight: 800, color: "#4a4a4a", marginBottom: 5, cursor: "pointer" }}
                    >
                      {parseISO(row.date).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
                    </button>
                    <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                      {row.items.map(t => (
                        <div key={t.id} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <span style={{
                            flexShrink: 0, width: 16, height: 16, borderRadius: 5, fontSize: 9, fontWeight: 900,
                            display: "flex", alignItems: "center", justifyContent: "center",
                            background: "rgba(0,0,0,0.07)", color: "#4a4a4a",
                          }}>{t.bucket}</span>
                          <span style={{ fontSize: 12, color: "#4a4a4a", textDecoration: "line-through" }}>{t.title}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>
      )}

      </div>

      {/* ── Long-term to-do list, docked beside the board so items can be dragged straight in ── */}
      {ghost && (
        <div style={{
          position: "fixed", left: ghost.x + 12, top: ghost.y + 12, zIndex: 200, pointerEvents: "none",
          background: "#111111", color: "#ffffff", fontSize: 11.5, fontWeight: 600,
          padding: "6px 10px", borderRadius: 7, maxWidth: 240, whiteSpace: "nowrap",
          overflow: "hidden", textOverflow: "ellipsis", boxShadow: "0 8px 20px rgba(0,0,0,0.25)",
        }}>
          {ghost.title}
        </div>
      )}

      {showList && (
        <div
          style={phone ? {
            position: "fixed", inset: 0, zIndex: 60, background: "#ffffff",
            display: "flex", flexDirection: "column",
          } : {
            width: 300, flexShrink: 0, alignSelf: "flex-start", position: "sticky", top: 0,
            maxHeight: "calc(100vh - 140px)", background: "#ffffff", border: BORDER, borderRadius: 12,
            display: "flex", flexDirection: "column", overflow: "hidden",
          }}
        >
            <div style={{ padding: "16px 18px", borderBottom: BORDER, display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 15, fontWeight: 800, color: "#111111" }}>To-Do List</p>
                <p style={{ fontSize: 10.5, color: "#949494" }}>
                  {listTab === "daily"
                    ? (view === "week" ? weekLabel(weekDate).main : dayLabel(inboxAnchor).main)
                    : backlog.length === 0 ? "No projects on the go" : `${backlog.length} project${backlog.length === 1 ? "" : "s"} on the go`}
                </p>
              </div>
              <button
                onClick={() => setShowList(false)}
                style={{ width: 28, height: 28, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", color: "#949494", cursor: "pointer", background: "rgba(0,0,0,0.045)" }}
              >
                <svg style={{ width: 14, height: 14 }} fill="none" stroke="currentColor" strokeWidth={2.2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div style={{ padding: "10px 14px 0" }}>
              <div style={{ display: "flex", background: "rgba(0,0,0,0.054)", borderRadius: 8, padding: 2 }}>
                {([["daily", "Small Tasks"], ["long", "Big Projects"]] as [ListTab, string][]).map(([id, label]) => (
                  <button
                    key={id}
                    onClick={() => { setListTab(id); setEditingListId(null); }}
                    style={{
                      flex: 1, padding: "6px 10px", borderRadius: 6, fontSize: 11.5, fontWeight: 700, cursor: "pointer",
                      background: listTab === id ? "#000000" : "transparent",
                      color: listTab === id ? "#fff" : "#767676",
                    }}
                  >
                    {label}
                    {(id === "daily" ? inbox.length : backlog.length) > 0 && (
                      <span style={{ marginLeft: 5, opacity: 0.7 }}>{id === "daily" ? inbox.length : backlog.length}</span>
                    )}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ padding: "12px 14px", borderBottom: BORDER, display: "flex", flexDirection: "column", gap: 8 }}>
              <input
                value={listTitle}
                onChange={e => setListTitle(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") addToList(); }}
                placeholder={listTab === "daily" ? "A small task for this " + (view === "week" ? "week" : "day") + "…" : "A big project you\u2019re working on…"}
                style={{ ...fieldStyle, fontSize: 12.5, padding: "8px 11px" }}
              />
              <button
                onClick={addToList}
                style={{ alignSelf: "flex-start", background: "#000000", color: "#fff", fontSize: 12, fontWeight: 700, padding: "7px 15px", borderRadius: 7, cursor: "pointer" }}
              >
                Add
              </button>
            </div>

            <div style={{ flex: 1, overflowY: "auto", padding: 12 }}>
              {rows.length === 0 ? (
                <p style={{ fontSize: 12, color: "#949494", textAlign: "center", padding: "40px 20px", lineHeight: 1.6 }}>
                  {listTab === "daily"
                    ? "No small tasks yet. Jot them down, then drag each one into a letter."
                    : "No big projects yet. Add one, then drag it into a letter whenever you work on it — it stays here until it is done."}
                </p>
              ) : (
                <>
                  <p style={{ fontSize: 10, color: "#949494", marginBottom: 8, lineHeight: 1.5 }}>
                    {listTab === "daily"
                      ? "Drag each one onto a letter column to prioritise it."
                      : "Drag a project onto a letter column, a day in the strip, or a date in Month view. It stays on this list until it is done."}
                  </p>
                  {rows.map(t => {
                    const placed = t.scope !== "backlog" && !!t.task_date;
                    return (
                      <div
                        key={t.id}
                        onPointerDown={e => startDrag(e, t.id, true)}
                        style={{
                          display: "flex", alignItems: "center", gap: 8, padding: "8px 9px", marginBottom: 5,
                          background: "#ffffff",
                          borderTop: "1px solid rgba(0,0,0,0.09)", borderRight: "1px solid rgba(0,0,0,0.09)",
                          borderBottom: "1px solid rgba(0,0,0,0.09)", borderLeft: "2px solid rgba(0,0,0,0.35)",
                          borderRadius: 7, cursor: "grab", touchAction: "none",
                          opacity: dragId === t.id ? 0.4 : 1,
                        }}
                      >
                        <button
                          onClick={() => patch(t.id, placed
                            ? { done: true }
                            : t.scope === "inbox"
                            ? { done: true, scope: view === "week" ? "week" : "day", task_date: t.task_date }
                            : { done: true, scope: "day", task_date: iso(new Date()) })}
                          title="Mark done"
                          style={{
                            flexShrink: 0, width: 14, height: 14, borderRadius: 4, cursor: "pointer",
                            border: "1.5px solid rgba(0,0,0,0.22)", background: "transparent",
                          }}
                        />
                        {editingListId === t.id ? (
                          <input
                            autoFocus
                            defaultValue={t.title}
                            onBlur={e => {
                              const v = e.target.value.trim();
                              if (v && v !== t.title) patch(t.id, { title: v });
                              setEditingListId(null);
                            }}
                            onKeyDown={e => { if (e.key === "Enter" || e.key === "Escape") (e.target as HTMLInputElement).blur(); }}
                            style={{ flex: 1, minWidth: 0, fontSize: 12, color: "#111111", background: "transparent", outline: "none", border: "none" }}
                          />
                        ) : (
                          // A span, not an input — an input would swallow the drag when grabbed.
                          <span
                            onClick={() => setEditingListId(t.id)}
                            style={{ flex: 1, minWidth: 0, fontSize: 12, color: "#111111", wordBreak: "break-word" }}
                          >
                            {t.title}
                          </span>
                        )}
                        <button
                          onClick={() => removeFromList(t)}
                          title={t.scope === "backlog" || t.scope === "inbox"
                            ? "Delete"
                            : "Remove from this list (stays on its day)"}
                          style={{ flexShrink: 0, color: "#c2c2c2", cursor: "pointer", lineHeight: 0, padding: 2 }}
                          onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = "#c0392b"}
                          onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = "#c2c2c2"}
                        >
                          <svg style={{ width: 11, height: 11 }} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    );
                  })}
                </>
              )}
            </div>
        </div>
      )}

    </div>
  );
}


/* Card and Lane live at module scope on purpose. Declared inside TaskBoard they
   would be a new component type on every render, so React would tear down and
   rebuild each card — which cancels any drag in progress the moment state
   changes. Everything they need arrives in one ctx prop. */

type BoardCtx = {
  expandedId: string | null;
  setExpandedId: (v: string | null) => void;
  frog: Task | null;
  dragId: string | null;
  dropZone: string | null;
  startDrag: (e: React.PointerEvent, id: string, fromList: boolean) => void;
  patch: (id: string, changes: Partial<Task>) => void;
  clearFromBoard: (t: Task) => void;
  unschedule: (t: Task) => void;
  scope: Scope;
  phone: boolean;
  listFor: (b: Bucket, p?: number) => Task[];
};

function Card({ task, accent, ctx }: { task: Task; accent: string; ctx: BoardCtx }) {
  const open = ctx.expandedId === task.id;
  const isFrog = ctx.frog?.id === task.id;
  return (
    <div
      data-drop={`card:${task.id}`}
      onPointerDown={e => ctx.startDrag(e, task.id, false)}
      style={{
        background: CARD_BG,
        borderTop: `1px solid ${isFrog && !task.done ? hexA(accent, 0.4) : "rgba(0,0,0,0.095)"}`,
        borderRight: `1px solid ${isFrog && !task.done ? hexA(accent, 0.4) : "rgba(0,0,0,0.095)"}`,
        borderBottom: `1px solid ${isFrog && !task.done ? hexA(accent, 0.4) : "rgba(0,0,0,0.095)"}`,
        borderLeft: `2px solid ${task.done ? "rgba(0,0,0,0.108)" : hexA(accent, 0.75)}`,
        borderRadius: 7,
        padding: ctx.phone ? "10px 10px" : "7px 8px",
        marginBottom: 5,
        cursor: "grab",
        touchAction: "none",
        opacity: ctx.dragId === task.id ? 0.4 : task.done ? 0.45 : 1,
        boxShadow: ctx.dropZone === `card:${task.id}` ? `0 -2px 0 ${accent}` : "none",
        transition: "opacity 120ms, box-shadow 120ms",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", gap: 7 }}>
        <button
          onClick={() => ctx.patch(task.id, { done: !task.done })}
          title={task.done ? "Mark as not done" : "Mark as done"}
          style={{
            flexShrink: 0, width: ctx.phone ? 18 : 14, height: ctx.phone ? 18 : 14, marginTop: ctx.phone ? 0 : 2, borderRadius: 4,
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

        <div style={{ flex: 1, minWidth: 0 }} onClick={() => ctx.setExpandedId(open ? null : task.id)}>
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
          onClick={() => ctx.clearFromBoard(task)}
          title={task.origin === "backlog" || task.from_list ? "Take off this day (stays in Big Projects)"
               : task.origin === "inbox" ? "Take off this day (back to Small Tasks)"
               : "Delete task"}
          style={{ flexShrink: 0, color: "#949494", cursor: "pointer", lineHeight: 0, padding: ctx.phone ? 5 : 1 }}
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
              onBlur={e => { const v = e.target.value.trim(); if (v && v !== task.title) ctx.patch(task.id, { title: v }); }}
              style={fieldStyle}
            />
          </Field>
          <Field label="Notes">
            <textarea
              defaultValue={task.notes ?? ""}
              rows={2}
              onBlur={e => { if (e.target.value !== (task.notes ?? "")) ctx.patch(task.id, { notes: e.target.value }); }}
              style={{ ...fieldStyle, resize: "vertical" }}
            />
          </Field>
          <Field label={ctx.scope === "day" ? "Move to day" : "Move to week"}>
            <input
              type="date"
              value={task.task_date ?? ""}
              onChange={e => {
                if (!e.target.value) return;
                const d = parseISO(e.target.value);
                ctx.patch(task.id, { task_date: ctx.scope === "day" ? iso(d) : iso(weekStart(d)) });
              }}
              style={fieldStyle}
            />
          </Field>
          <Field label="Deadline (optional)">
            <input
              type="date"
              defaultValue={task.due_date ?? ""}
              onChange={e => ctx.patch(task.id, { due_date: e.target.value || null })}
              style={fieldStyle}
            />
          </Field>
          {task.bucket === "D" && (
            <Field label="Delegate to">
              <input
                defaultValue={task.delegate_to ?? ""}
                onBlur={e => { if (e.target.value !== (task.delegate_to ?? "")) ctx.patch(task.id, { delegate_to: e.target.value }); }}
                style={fieldStyle}
              />
            </Field>
          )}
          <div style={{ display: "flex", gap: 3, flexWrap: "wrap" }}>
            {BUCKETS.map(b => (
              <button
                key={b.id}
                onClick={() => ctx.patch(task.id, { bucket: b.id })}
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
                onClick={() => ctx.patch(task.id, { priority: l.priority })}
                style={{
                  fontSize: 9, fontWeight: 800, padding: "3px 7px", borderRadius: 4, cursor: "pointer",
                  background: task.priority === l.priority ? hexA(l.color, 0.18) : "rgba(0,0,0,0.054)",
                  color: task.priority === l.priority ? l.color : "#767676",
                }}
              >{l.label}</button>
            ))}
          </div>
          <button
            onClick={() => ctx.unschedule(task)}
            style={{ alignSelf: "flex-start", fontSize: 10, fontWeight: 700, color: "#767676", cursor: "pointer" }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = "#111111"}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = "#767676"}
          >
            ← Back to big projects
          </button>
        </div>
      )}
    </div>
  );
}

function Lane({ bucket, priority, accent, empty, fill, ctx }: { bucket: Bucket; priority: number; accent: string; empty: string; fill?: boolean; ctx: BoardCtx }) {
  const items = ctx.listFor(bucket, HAS_LEVELS.has(bucket) ? priority : undefined);
  const zone = `lane:${bucket}:${priority}`;
  return (
    <div
      data-drop={zone}
      style={{
        minHeight: ctx.phone ? 0 : 46, borderRadius: 7, padding: 3,
        ...(fill ? { flex: 1 } : null),
        background: ctx.dropZone === zone ? hexA(accent, 0.07) : "transparent",
        border: `1px dashed ${ctx.dropZone === zone ? hexA(accent, 0.35) : "transparent"}`,
        transition: "background 120ms",
      }}
    >
      {items.map(t => <Card key={t.id} task={t} accent={accent} ctx={ctx} />)}
      {items.length === 0 && (
        <p style={{ fontSize: ctx.phone ? 9.5 : 10, color: "#c2c2c2", textAlign: "center", padding: ctx.phone ? "3px 4px" : "12px 4px" }}>
          {ctx.phone ? "—" : empty}
        </p>
      )}
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

/* ── Catch-up on unfinished work from earlier days ── */

function CatchUp({ ids, tasks, label, onTick, onReAdd, onClose }: {
  ids: string[];
  tasks: Task[];
  label: string;
  onTick: (id: string) => void;
  onReAdd: (ids: string[]) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Keep every row on screen while you tick, so the list doesn't jump under the cursor.
  const rows = ids.map(id => tasks.find(t => t.id === id)).filter((t): t is Task => !!t);
  const remaining = rows.filter(t => !t.done);

  const byDate: { date: string; items: Task[] }[] = [];
  for (const t of rows) {
    const key = t.task_date ?? "";
    const row = byDate.find(r => r.date === key);
    if (row) row.items.push(t); else byDate.push({ date: key, items: [t] });
  }
  byDate.sort((a, b) => b.date.localeCompare(a.date));

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
          background: "#ffffff", borderRadius: 14, maxWidth: 520, width: "100%", maxHeight: "84vh",
          display: "flex", flexDirection: "column", boxShadow: "0 24px 60px rgba(0,0,0,0.28)",
        }}
      >
        <div style={{ padding: "16px 20px", borderBottom: BORDER, display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ fontSize: 15, fontWeight: 800, color: "#111111" }}>Unfinished from earlier</p>
            <p style={{ fontSize: 11, color: "#949494" }}>
              Tick anything you actually did. The rest can move to {label}.
            </p>
          </div>
          <button
            onClick={onClose}
            style={{ width: 28, height: 28, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", color: "#949494", cursor: "pointer", background: "rgba(0,0,0,0.045)" }}
          >
            <svg style={{ width: 14, height: 14 }} fill="none" stroke="currentColor" strokeWidth={2.2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "14px 18px" }}>
          {byDate.map(group => (
            <div key={group.date} style={{ marginBottom: 14 }}>
              <p style={{ fontSize: 10, fontWeight: 800, letterSpacing: "0.08em", color: "#949494", marginBottom: 6 }}>
                {group.date
                  ? parseISO(group.date).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" }).toUpperCase()
                  : "NO DATE"}
              </p>
              {group.items.map(t => (
                <div
                  key={t.id}
                  style={{
                    display: "flex", alignItems: "center", gap: 9, padding: "7px 9px", marginBottom: 4,
                    border: "1px solid rgba(0,0,0,0.09)", borderRadius: 7,
                    opacity: t.done ? 0.45 : 1,
                  }}
                >
                  <button
                    onClick={() => { if (!t.done) onTick(t.id); }}
                    title="I did this"
                    style={{
                      flexShrink: 0, width: 15, height: 15, borderRadius: 4, cursor: t.done ? "default" : "pointer",
                      border: `1.5px solid ${t.done ? "#111111" : "rgba(0,0,0,0.22)"}`,
                      background: t.done ? "#111111" : "transparent",
                      display: "flex", alignItems: "center", justifyContent: "center",
                    }}
                  >
                    {t.done && (
                      <svg style={{ width: 9, height: 9, color: "#ffffff" }} fill="none" stroke="currentColor" strokeWidth={4} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                  <span style={{
                    flexShrink: 0, width: 17, height: 17, borderRadius: 5, fontSize: 9.5, fontWeight: 900,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    background: "rgba(0,0,0,0.07)", color: "#4a4a4a",
                  }}>
                    {t.bucket}{HAS_LEVELS.has(t.bucket) ? t.priority : ""}
                  </span>
                  <span style={{
                    flex: 1, minWidth: 0, fontSize: 12.5, color: "#111111",
                    textDecoration: t.done ? "line-through" : "none",
                  }}>
                    {t.title}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>

        <div style={{ padding: "12px 18px", borderTop: BORDER, display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 11, color: "#949494", flex: 1 }}>
            {remaining.length === 0 ? "All caught up." : `${remaining.length} still to do`}
          </span>
          <button
            onClick={onClose}
            style={{ fontSize: 11.5, fontWeight: 700, color: "#767676", cursor: "pointer" }}
          >
            Leave them
          </button>
          <button
            onClick={() => onReAdd(remaining.map(t => t.id))}
            disabled={remaining.length === 0}
            style={{
              background: remaining.length === 0 ? "rgba(0,0,0,0.12)" : "#000000", color: "#fff",
              fontSize: 12, fontWeight: 700, padding: "8px 16px", borderRadius: 8,
              cursor: remaining.length === 0 ? "default" : "pointer", whiteSpace: "nowrap",
            }}
          >
            Re-add to {label}
          </button>
        </div>
      </div>
    </div>
  );
}
