"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { callKindOf, isBookedHere } from "@/lib/call-kind";

type CalEvent = {
  uid: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location: string | null;
  description: string | null;
  organizer: string | null;
  attendees: string[];
  meetUrl: string | null;
  status: string | null;
  feed: string | null;
};

type Feed = { id: string; label: string | null; error: string | null; calendar_id?: string | null };

const PANEL = "#ffffff";
const BORDER = "1px solid rgba(0,0,0,0.07)";

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseISO = (s: string) => new Date(`${s}T00:00:00`);
const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const weekStart = (d: Date) => addDays(d, -((d.getDay() + 6) % 7));

const time = (s: string) =>
  new Date(s).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }).toLowerCase().replace(" ", "");

// A call is an event with someone else on it — an invitee or a meeting link.
// Solo time blocks ("Driving", "Cold Calling", "Out of office") have neither, so
// they stay out of the count. Cancelled events never reach here; the calendar
// parser drops them.
function isCall(e: CalEvent): boolean {
  if (e.allDay) return false;
  if (isBookedHere(e.title)) return true;
  return e.attendees.length > 0 || !!e.meetUrl;
}

function dayLabel(dateISO: string) {
  const d = parseISO(dateISO);
  const diff = Math.round((d.getTime() - parseISO(iso(new Date())).getTime()) / 86400000);
  return {
    main: d.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" }),
    badge: diff === 0 ? "Today" : diff === -1 ? "Yesterday" : diff === 1 ? "Tomorrow" : null,
  };
}

const field: React.CSSProperties = {
  background: "#f6f6f6", border: "1px solid rgba(0,0,0,0.10)", borderRadius: 6,
  padding: "8px 11px", fontSize: 12.5, color: "#111111", outline: "none", width: "100%",
};

export default function CalendarView({ embedded = false, date: startDate, onBooked, onDeleted }: {
  embedded?: boolean;
  date?: string;
  /** A follow-up was booked; it comes back as that day's non-negotiable. */
  onBooked?: (task: unknown) => void;
  /** A call was deleted; its non-negotiable row (if any) went with it. */
  onDeleted?: (taskId: string) => void;
} = {}) {
  const [date, setDate] = useState(() => startDate ?? iso(new Date()));
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const [newUrl, setNewUrl] = useState("");
  const [newLabel, setNewLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [manage, setManage] = useState(false);
  const [callsOnly, setCallsOnly] = useState(false);

  // Booking a follow-up call straight onto Google Calendar.
  const [fuOpen, setFuOpen] = useState(false);
  const [fuName, setFuName] = useState("");
  const [fuDate, setFuDate] = useState("");
  const [fuTime, setFuTime] = useState("10:00");
  const [fuMinutes, setFuMinutes] = useState(30);
  const [fuGuest, setFuGuest] = useState("");
  const [fuNote, setFuNote] = useState("");
  const [fuSaving, setFuSaving] = useState(false);
  const [fuMsg, setFuMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [showGcal, setShowGcal] = useState(false);

  const load = useCallback(async (d: string) => {
    try {
      const res = await fetch(`/api/calendar?start=${d}&end=${d}`);
      const data = await res.json();
      setFeeds(data.feeds ?? []);
      setEvents(data.events ?? []);
    } catch {
      setFeeds([]); setEvents([]);
    }
    setLoadedFor(d);
  }, []);

  // Showing data that belongs to another date is what "loading" means here.
  const loading = loadedFor !== date;

  useEffect(() => { load(date); }, [date, load]);

  // Keeps the "on now" marker and the next-up highlight honest.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(t);
  }, []);

  // Refresh when the tab is brought back into view — a calendar goes stale fast.
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") load(date); };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [date, load]);

  const allDay = events.filter(e => e.allDay);
  const timed = events.filter(e => !e.allDay);
  const calls = timed.filter(isCall);
  const shown = callsOnly ? calls : timed;

  const nextUp = useMemo(
    () => timed.find(e => new Date(e.end).getTime() > now) ?? null,
    [timed, now],
  );

  const strip = useMemo(() => {
    const s = weekStart(parseISO(date));
    return Array.from({ length: 7 }, (_, i) => {
      const d = addDays(s, i);
      return {
        key: iso(d),
        letter: d.toLocaleDateString("en-US", { weekday: "narrow" }),
        num: d.getDate(),
        isToday: iso(d) === iso(new Date()),
      };
    });
  }, [date]);

  const [deleting, setDeleting] = useState<string | null>(null);
  const [deleteMsg, setDeleteMsg] = useState<string | null>(null);

  async function deleteCall(e: CalEvent) {
    const name = e.title.split(/\s*\|\s*/)[0] || e.title;
    if (!window.confirm(`Delete "${name}" at ${time(e.start)} from Google Calendar too? This can't be undone.`)) return;
    setDeleting(e.uid + e.start); setDeleteMsg(null);
    try {
      const res = await fetch(`/api/calendar/event?id=${encodeURIComponent(e.uid)}&start=${encodeURIComponent(e.start)}`, { method: "DELETE" });
      const d = await res.json();
      if (!res.ok || d.error) setDeleteMsg(d.error ?? "Could not delete it.");
      else {
        setEvents(prev => prev.filter(x => !(x.uid === e.uid && x.start === e.start)));
        if (d.removed_task_id) onDeleted?.(d.removed_task_id);
      }
    } catch {
      setDeleteMsg("Could not reach Google Calendar.");
    }
    setDeleting(null);
  }

  async function bookFollowUp() {
    const name = fuName.trim();
    const day = fuDate || date;
    if (!name || !fuTime) return;
    setFuSaving(true); setFuMsg(null);
    const start = new Date(`${day}T${fuTime}:00`);
    try {
      const res = await fetch("/api/calendar/event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, start: start.toISOString(), day, minutes: fuMinutes, guest: fuGuest, note: fuNote }),
      });
      const d = await res.json();
      if (!res.ok || d.error) {
        setFuMsg({ ok: false, text: d.error ?? "Could not add it to Google Calendar." });
      } else {
        // Show it straight away; Google's feed can take a few minutes to catch up.
        if (day === date) {
          setEvents(prev => [...prev, {
            uid: d.id ?? `fu-${start.getTime()}`, title: `${name} | ${fuGuest ? "Follow-up call" : "Dial"}`, start: d.start, end: d.end,
            allDay: false, location: null, description: fuNote || null, organizer: null,
            attendees: fuGuest ? [fuGuest] : [], meetUrl: null, status: null, feed: null,
          }].sort((a, b) => a.start.localeCompare(b.start)));
        }
        if (d.task) onBooked?.(d.task);
        setFuMsg({ ok: true, text: fuGuest
          ? "Follow-up added to Google Calendar and the non-negotiables — invite sent."
          : "Dial added to Google Calendar and the non-negotiables." });
        setFuName(""); setFuGuest(""); setFuNote("");
        setTimeout(() => { setFuOpen(false); setFuMsg(null); }, 1600);
      }
    } catch {
      setFuMsg({ ok: false, text: "Could not reach Google Calendar." });
    }
    setFuSaving(false);
  }

  async function addFeed() {
    const url = newUrl.trim();
    if (!url) return;
    setSaving(true); setAddError(null);
    const res = await fetch("/api/calendar", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, label: newLabel }),
    });
    const data = await res.json();
    setSaving(false);
    if (data.error) { setAddError(data.error); return; }
    setNewUrl(""); setNewLabel(""); setManage(false);
    load(date);
  }

  async function removeFeed(id: string) {
    setFeeds(prev => prev.filter(f => f.id !== id));
    await fetch(`/api/calendar?id=${id}`, { method: "DELETE" });
    load(date);
  }

  const label = dayLabel(date);
  const connected = feeds.length > 0;

  const addForm = (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 520 }}>
      <input
        value={newUrl}
        onChange={e => setNewUrl(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter") addFeed(); }}
        placeholder="Paste the secret calendar address here"
        style={field}
      />
      <input
        value={newLabel}
        onChange={e => setNewLabel(e.target.value)}
        placeholder="Name it (optional) — e.g. Sales calls"
        style={field}
      />
      <button
        onClick={addFeed}
        disabled={saving || !newUrl.trim()}
        style={{
          alignSelf: "flex-start", background: saving || !newUrl.trim() ? "rgba(0,0,0,0.15)" : "#000000",
          color: "#fff", fontSize: 12.5, fontWeight: 700, padding: "9px 18px", borderRadius: 8,
          cursor: saving || !newUrl.trim() ? "default" : "pointer",
        }}
      >
        {saving ? "Checking…" : "Connect Calendar"}
      </button>
      {addError && <p style={{ fontSize: 11.5, color: "#c0392b", lineHeight: 1.5 }}>{addError}</p>}
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

      {embedded && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          {(["left", "right"] as const).map(dir => (
            <button
              key={dir}
              onClick={() => setDate(iso(addDays(parseISO(date), dir === "left" ? -1 : 1)))}
              title={dir === "left" ? "Previous day" : "Next day"}
              style={{ width: 26, height: 26, borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center", color: "#767676", cursor: "pointer", background: "rgba(0,0,0,0.041)" }}
            >
              <svg style={{ width: 12, height: 12 }} fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d={dir === "left" ? "M15 19l-7-7 7-7" : "M9 5l7 7-7 7"} />
              </svg>
            </button>
          ))}
          <span style={{ fontSize: 12, fontWeight: 700, color: "#111111", whiteSpace: "nowrap" }}>
            {parseISO(date).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}
          </span>
          {label.badge && (
            <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.06em", padding: "2px 6px", borderRadius: 20, background: "rgba(245,158,11,0.14)", color: "#000000" }}>
              {label.badge.toUpperCase()}
            </span>
          )}
          {date !== iso(new Date()) && (
            <button
              onClick={() => setDate(iso(new Date()))}
              style={{ marginLeft: "auto", fontSize: 11, fontWeight: 700, color: "#000000", cursor: "pointer" }}
            >
              Today
            </button>
          )}
        </div>
      )}

      {embedded && (
        fuOpen ? (
          <div style={{ border: "1px solid rgba(0,0,0,0.12)", borderRadius: 10, padding: 10, display: "flex", flexDirection: "column", gap: 7 }}>
            <p style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.1em", color: "#949494" }}>
              {fuGuest.trim() ? "NEW FOLLOW-UP CALL" : "NEW DIAL"}
            </p>
            <p style={{ fontSize: 10.5, color: "#949494", lineHeight: 1.5 }}>
              Add their email to invite them — that makes it a follow-up call. Leave it blank for a dial, a reminder for you to ring them.
            </p>
            <input value={fuName} onChange={e => setFuName(e.target.value)} placeholder="Who with — e.g. Derick Garner" style={{ ...field, fontSize: 12 }} autoFocus />
            <div style={{ display: "flex", gap: 6 }}>
              <input type="date" value={fuDate || date} onChange={e => setFuDate(e.target.value)} style={{ ...field, fontSize: 11.5, flex: 1.3 }} />
              <input type="time" value={fuTime} onChange={e => setFuTime(e.target.value)} style={{ ...field, fontSize: 11.5, flex: 1 }} />
            </div>
            <div style={{ display: "flex", gap: 4 }}>
              {[15, 30, 45, 60].map(m => (
                <button
                  key={m}
                  onClick={() => setFuMinutes(m)}
                  style={{
                    flex: 1, height: 26, borderRadius: 6, fontSize: 10.5, fontWeight: 700, cursor: "pointer",
                    background: fuMinutes === m ? "#111111" : "rgba(0,0,0,0.05)", color: fuMinutes === m ? "#ffffff" : "#767676",
                  }}
                >{m} min</button>
              ))}
            </div>
            <input value={fuGuest} onChange={e => setFuGuest(e.target.value)} placeholder="Their email (optional — sends an invite)" style={{ ...field, fontSize: 11.5 }} />
            <textarea value={fuNote} onChange={e => setFuNote(e.target.value)} placeholder="Note (optional)" rows={2} style={{ ...field, fontSize: 11.5, resize: "vertical" }} />
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button
                onClick={bookFollowUp}
                disabled={fuSaving || !fuName.trim()}
                style={{
                  background: fuSaving || !fuName.trim() ? "rgba(0,0,0,0.15)" : "#000000", color: "#fff",
                  fontSize: 11.5, fontWeight: 700, padding: "7px 14px", borderRadius: 7,
                  cursor: fuSaving || !fuName.trim() ? "default" : "pointer",
                }}
              >
                {fuSaving ? "Adding…" : fuGuest.trim() ? "Add follow-up" : "Add dial"}
              </button>
              <button onClick={() => { setFuOpen(false); setFuMsg(null); }} style={{ fontSize: 11, fontWeight: 700, color: "#767676", cursor: "pointer" }}>
                Cancel
              </button>
            </div>
            {fuMsg && <p style={{ fontSize: 11, lineHeight: 1.5, color: fuMsg.ok ? "#111111" : "#c0392b" }}>{fuMsg.text}</p>}
          </div>
        ) : (
          <div style={{ display: "flex", gap: 6 }}>
            <button
              onClick={() => { setFuOpen(true); setFuDate(date); setFuMsg(null); }}
              style={{
                fontSize: 11, fontWeight: 700, padding: "6px 11px", borderRadius: 7, cursor: "pointer",
                background: "rgba(0,0,0,0.045)", border: "1px solid rgba(0,0,0,0.09)", color: "#111111",
              }}
            >
              + Follow-up / Dial
            </button>
            <button
              onClick={() => setShowGcal(true)}
              title="See your week, with a link to open Google Calendar itself"
              style={{
                display: "flex", alignItems: "center", gap: 5,
                fontSize: 11, fontWeight: 700, padding: "6px 11px", borderRadius: 7, cursor: "pointer",
                background: "rgba(0,0,0,0.045)", border: "1px solid rgba(0,0,0,0.09)", color: "#111111",
              }}
            >
              <svg style={{ width: 12, height: 12 }} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              Google Calendar
            </button>
          </div>
        )
      )}

      {showGcal && (
        <GoogleCalendarPopup
          startDate={date}
          onClose={() => setShowGcal(false)}
        />
      )}

      {!embedded && (<>
      {/* ── Date bar ── */}
      <div style={{ background: PANEL, border: BORDER, borderRadius: 12, padding: 12, display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <div style={{ display: "flex", gap: 2 }}>
            {(["left", "right"] as const).map(dir => (
              <button
                key={dir}
                onClick={() => setDate(iso(addDays(parseISO(date), dir === "left" ? -1 : 1)))}
                style={{ width: 28, height: 28, borderRadius: 7, display: "flex", alignItems: "center", justifyContent: "center", color: "#767676", cursor: "pointer", background: "rgba(0,0,0,0.041)" }}
              >
                <svg style={{ width: 13, height: 13 }} fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d={dir === "left" ? "M15 19l-7-7 7-7" : "M9 5l7 7-7 7"} />
                </svg>
              </button>
            ))}
          </div>

          <div style={{ display: "flex", alignItems: "baseline", gap: 8, minWidth: 0 }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: "#111111", whiteSpace: "nowrap" }}>{label.main}</span>
            {label.badge && (
              <span style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.06em", padding: "2px 7px", borderRadius: 20, background: "rgba(245,158,11,0.12)", color: "#000000" }}>
                {label.badge.toUpperCase()}
              </span>
            )}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: "auto", flexWrap: "wrap" }}>
            <input
              type="date"
              value={date}
              onChange={e => { if (e.target.value) setDate(e.target.value); }}
              style={{ ...field, width: "auto", fontSize: 11, padding: "6px 9px" }}
            />
            {date !== iso(new Date()) && (
              <button onClick={() => setDate(iso(new Date()))} style={{ fontSize: 11, fontWeight: 700, color: "#000000", cursor: "pointer", whiteSpace: "nowrap" }}>
                Today
              </button>
            )}
            <button
              onClick={() => load(date)}
              title="Refresh"
              style={{ width: 30, height: 30, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,0.045)", border: "1px solid rgba(0,0,0,0.09)", color: "#767676", cursor: "pointer" }}
            >
              <svg style={{ width: 13, height: 13 }} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
            {connected && (
              <button onClick={() => setManage(v => !v)} style={{ fontSize: 11, fontWeight: 700, color: manage ? "#000000" : "#767676", cursor: "pointer", whiteSpace: "nowrap" }}>
                Calendars
              </button>
            )}
          </div>
        </div>

        {/* Mon–Sun strip */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 5 }}>
          {strip.map(d => {
            const active = d.key === date;
            return (
              <button
                key={d.key}
                onClick={() => setDate(d.key)}
                style={{
                  padding: "6px 2px 5px", borderRadius: 8, cursor: "pointer", textAlign: "center",
                  background: active ? "rgba(245,158,11,0.12)" : "rgba(0,0,0,0.027)",
                  border: `1px solid ${active ? "rgba(245,158,11,0.35)" : d.isToday ? "rgba(0,0,0,0.189)" : "transparent"}`,
                }}
              >
                <p style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: "0.08em", color: active ? "#000000" : "#949494" }}>{d.letter}</p>
                <p style={{ fontSize: 14, fontWeight: 700, color: active ? "#000000" : d.isToday ? "#111111" : "#767676", lineHeight: 1.3 }}>{d.num}</p>
              </button>
            );
          })}
        </div>
      </div>
      </>)}

      {/* ── Manage calendars ── */}
      {manage && connected && (
        <div style={{ background: PANEL, border: BORDER, borderRadius: 12, padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          <p style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.12em", color: "#949494" }}>CONNECTED CALENDARS</p>
          {feeds.map(f => (
            <div key={f.id} style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={{ fontSize: 12.5, fontWeight: 600, color: "#111111", flex: 1, minWidth: 120 }}>
                {f.label || "Calendar"}
              </span>
              {f.error
                ? <span style={{ fontSize: 10.5, color: "#c0392b" }}>{f.error}</span>
                : <span style={{ fontSize: 10.5, color: "#949494" }}>Connected</span>}
              <button
                onClick={() => removeFeed(f.id)}
                style={{ fontSize: 11, fontWeight: 700, color: "#767676", cursor: "pointer" }}
              >
                Remove
              </button>
            </div>
          ))}
          <div style={{ paddingTop: 10, borderTop: BORDER }}>
            <p style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.12em", color: "#949494", marginBottom: 10 }}>ADD ANOTHER</p>
            {addForm}
          </div>
        </div>
      )}

      {/* ── Not connected yet ── */}
      {!loading && !connected && (
        <div style={{ background: PANEL, border: BORDER, borderRadius: 12, padding: 24, display: "flex", flexDirection: "column", gap: 18, maxWidth: 640 }}>
          <div>
            <p style={{ fontSize: 17, fontWeight: 800, color: "#111111", marginBottom: 4 }}>Connect Your Calendar</p>
            <p style={{ fontSize: 12.5, color: "#767676", lineHeight: 1.6 }}>
              Your calls will show up here automatically. This is read-only — nothing is ever
              added, changed or removed in Google Calendar.
            </p>
          </div>

          <div style={{ background: "rgba(0,0,0,0.03)", borderRadius: 10, padding: "14px 16px" }}>
            <p style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.12em", color: "#949494", marginBottom: 10 }}>WHERE TO FIND THE LINK</p>
            <ol style={{ fontSize: 12.5, color: "#4a4a4a", lineHeight: 1.85, paddingLeft: 20, margin: 0, listStyle: "decimal" }}>
              <li>Open Google Calendar on a computer.</li>
              <li>Hover the calendar you want in the left list, click the three dots, then <strong>Settings and Sharing</strong>.</li>
              <li>Scroll to <strong>Integrate Calendar</strong>.</li>
              <li>Copy <strong>Secret address in iCal format</strong> — the long link ending in <strong>.ics</strong>.</li>
              <li>Paste it below.</li>
            </ol>
            <p style={{ fontSize: 11, color: "#949494", marginTop: 10, lineHeight: 1.6 }}>
              Keep that link private — anyone who has it can see this calendar. It is stored securely
              and never shown again once saved.
            </p>
          </div>

          {addForm}
        </div>
      )}

      {/* ── Feed problems ── */}
      {connected && feeds.some(f => f.error) && (
        <div style={{ background: "rgba(192,57,43,0.05)", border: "1px solid rgba(192,57,43,0.18)", borderRadius: 10, padding: "10px 14px" }}>
          {feeds.filter(f => f.error).map(f => (
            <p key={f.id} style={{ fontSize: 11.5, color: "#c0392b" }}>
              {f.label || "Calendar"}: {f.error}
            </p>
          ))}
        </div>
      )}

      {/* ── The day ── */}
      {loading ? (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: 60, gap: 12, color: "#949494" }}>
          <svg style={{ width: 20, height: 20 }} className="animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span style={{ fontSize: 13, fontWeight: 500 }}>Loading your calls…</span>
        </div>
      ) : connected && (
        <div style={{ background: PANEL, border: BORDER, borderRadius: 12, padding: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
            <p style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.12em", color: "#949494", flex: 1 }}>
              {events.length === 0 ? "NOTHING SCHEDULED" : `${events.length} ${events.length === 1 ? "EVENT" : "EVENTS"}`}
            </p>
            {calls.length > 0 && (
              <button
                onClick={() => setCallsOnly(v => !v)}
                title={callsOnly ? "Show everything on this day" : "Show only calls"}
                style={{
                  display: "flex", alignItems: "center", gap: 6, cursor: "pointer",
                  padding: "4px 10px", borderRadius: 999, fontSize: 11, fontWeight: 700,
                  border: callsOnly ? "1px solid #111111" : "1px solid rgba(0,0,0,0.12)",
                  background: callsOnly ? "#111111" : "rgba(0,0,0,0.04)",
                  color: callsOnly ? "#ffffff" : "#4a4a4a",
                  transition: "background 0.15s ease, color 0.15s ease",
                }}
              >
                <svg style={{ width: 11, height: 11 }} fill="none" stroke="currentColor" strokeWidth={2.2} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                </svg>
                {calls.length} {calls.length === 1 ? "call" : "calls"}
              </button>
            )}
          </div>

          {allDay.length > 0 && !callsOnly && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
              {allDay.map(e => (
                <span key={e.uid + e.start} style={{ fontSize: 11.5, fontWeight: 600, padding: "5px 10px", borderRadius: 6, background: "rgba(0,0,0,0.055)", color: "#4a4a4a" }}>
                  {e.title}
                </span>
              ))}
            </div>
          )}

          {events.length === 0 ? (
            <p style={{ fontSize: 12.5, color: "#949494", padding: "20px 0" }}>
              Nothing on this day.
            </p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column" }}>
              {deleteMsg && (
                <p style={{ fontSize: 11, color: "#c0392b", lineHeight: 1.5, padding: "6px 0" }}>{deleteMsg}</p>
              )}
              {shown.map(e => {
                const started = new Date(e.start).getTime();
                const ended = new Date(e.end).getTime();
                const live = now >= started && now < ended;
                const past = now >= ended;
                const isNext = nextUp?.uid === e.uid && nextUp?.start === e.start && !live;
                return (
                  <div
                    key={e.uid + e.start}
                    style={{
                      display: "flex", gap: embedded ? 9 : 14, padding: "12px 0", borderTop: BORDER,
                      opacity: past ? 0.45 : 1,
                    }}
                  >
                    <div style={{ flexShrink: 0, width: embedded ? 56 : 74, textAlign: "right" }}>
                      <p style={{ fontSize: 12.5, fontWeight: 700, color: "#111111" }}>{time(e.start)}</p>
                      <p style={{ fontSize: 10.5, color: "#949494" }}>{time(e.end)}</p>
                    </div>

                    <div style={{
                      flexShrink: 0, width: 3, borderRadius: 3,
                      background: live ? "#000000" : isNext ? "rgba(0,0,0,0.55)" : "rgba(0,0,0,0.13)",
                    }} />

                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                        <p style={{ fontSize: 13.5, fontWeight: 700, color: "#111111", wordBreak: "break-word" }}>{e.title}</p>
                        {isCall(e) && (
                          <span style={{
                            fontSize: 9, fontWeight: 800, letterSpacing: "0.06em", padding: "2px 7px", borderRadius: 20,
                            background: callKindOf(e.title) === "followup" ? "rgba(213,0,0,0.1)" : callKindOf(e.title) === "dial" ? "rgba(244,81,30,0.12)" : "rgba(0,0,0,0.06)",
                            color: callKindOf(e.title) === "followup" ? "#D50000" : callKindOf(e.title) === "dial" ? "#c2410c" : "#4a4a4a",
                          }}>
                            {callKindOf(e.title) === "followup" ? "FOLLOW-UP" : callKindOf(e.title) === "dial" ? "DIAL" : "SALES CALL"}
                          </span>
                        )}
                        {live && <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.06em", padding: "2px 7px", borderRadius: 20, background: "#000000", color: "#ffffff" }}>ON NOW</span>}
                        {isNext && <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.06em", padding: "2px 7px", borderRadius: 20, background: "rgba(245,158,11,0.16)", color: "#000000" }}>NEXT</span>}
                      </div>

                      {(e.location || e.attendees.length > 0 || e.feed) && (
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 4 }}>
                          {e.location && !e.meetUrl && (
                            <span style={{ fontSize: 11, color: "#767676", wordBreak: "break-word" }}>{e.location}</span>
                          )}
                          {e.attendees.length > 0 && (
                            <span style={{ fontSize: 11, color: "#767676" }} title={e.attendees.join(", ")}>
                              {e.attendees.length} {e.attendees.length === 1 ? "guest" : "guests"}
                            </span>
                          )}
                          {e.feed && <span style={{ fontSize: 11, color: "#a8a8a8" }}>{e.feed}</span>}
                        </div>
                      )}
                    </div>

                    {embedded && (
                      <button
                        onClick={() => deleteCall(e)}
                        disabled={deleting === e.uid + e.start}
                        title="Delete from Google Calendar"
                        style={{ flexShrink: 0, alignSelf: "center", color: "#c2c2c2", cursor: "pointer", lineHeight: 0, padding: 4 }}
                        onMouseEnter={ev => (ev.currentTarget as HTMLElement).style.color = "#c0392b"}
                        onMouseLeave={ev => (ev.currentTarget as HTMLElement).style.color = "#c2c2c2"}
                      >
                        <svg style={{ width: 13, height: 13 }} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    )}

                    {e.meetUrl && !past && (
                      <a
                        href={e.meetUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{
                          flexShrink: 0, alignSelf: "center", background: live ? "#000000" : "rgba(0,0,0,0.055)",
                          color: live ? "#ffffff" : "#111111", fontSize: 11.5, fontWeight: 700,
                          padding: "7px 14px", borderRadius: 7, whiteSpace: "nowrap", textDecoration: "none",
                        }}
                      >
                        Join
                      </a>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}


/**
 * Google won't let its full calendar be shown inside another site, so the real,
 * editable thing opens as its own pop-up window, centred over the dashboard.
 * Reusing the window name brings an already-open one back to the front.
 */
function openGoogleCalendar(day: string) {
  const w = Math.min(1320, window.screen.availWidth - 80);
  const h = Math.min(900, window.screen.availHeight - 80);
  const left = Math.round(window.screenX + (window.outerWidth - w) / 2);
  const top = Math.round(window.screenY + (window.outerHeight - h) / 2);
  const win = window.open(
    `https://calendar.google.com/calendar/r/week/${day.replace(/-/g, "/")}`,
    "google-calendar",
    `popup,width=${w},height=${h},left=${left},top=${top}`,
  );
  win?.focus();
}

/* ── Your calendar, a week at a time, in a pop-up ──
   Built from the same private feed as the Calls panel. Google's own embed can't
   be used here: inside another site Google shows a private calendar as empty.
   Rendered into <body> so it sits above the dashboard's top bar. */

const HOUR_PX = 58;

type Placed = CalEvent & { top: number; height: number; col: number; cols: number };

/** Lays out one day's events, splitting the width where they overlap. */
function placeDay(list: CalEvent[]): Placed[] {
  const items = list
    .map(e => {
      const s = new Date(e.start), en = new Date(e.end);
      const startMin = s.getHours() * 60 + s.getMinutes();
      const endMin = Math.max(startMin + 15, en.getDate() !== s.getDate() ? 24 * 60 : en.getHours() * 60 + en.getMinutes());
      return { e, startMin, endMin };
    })
    .sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);

  const out: Placed[] = [];
  let cluster: typeof items = [];
  let clusterEnd = -1;
  const flush = () => {
    const colEnds: number[] = [];
    const cols = cluster.map(it => {
      let c = colEnds.findIndex(end => end <= it.startMin);
      if (c === -1) { c = colEnds.length; colEnds.push(it.endMin); } else colEnds[c] = it.endMin;
      return c;
    });
    cluster.forEach((it, i) => out.push({
      ...it.e,
      top: (it.startMin / 60) * HOUR_PX,
      height: Math.max(((it.endMin - it.startMin) / 60) * HOUR_PX - 2, 18),
      col: cols[i],
      cols: colEnds.length,
    }));
    cluster = []; clusterEnd = -1;
  };
  for (const it of items) {
    if (cluster.length && it.startMin >= clusterEnd) flush();
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, it.endMin);
  }
  if (cluster.length) flush();
  return out;
}

/** "Derick Garner | Custom Area Breakdown Tomsi Media" → "Derick Garner". */
const shortTitle = (t: string) => t.split(/\s*\|\s*/)[0] || t;

function GoogleCalendarPopup({ startDate, onClose }: { startDate: string; onClose: () => void }) {
  const [week, setWeek] = useState(() => iso(weekStart(parseISO(startDate))));
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [picked, setPicked] = useState<CalEvent | null>(null);
  const [colors, setColors] = useState<{ byEvent: Record<string, string>; calendar: string | null }>({ byEvent: {}, calendar: null });
  const [now, setNow] = useState(() => Date.now());
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { if (picked) setPicked(null); else onClose(); } };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose, picked]);

  useEffect(() => {
    const end = iso(addDays(parseISO(week), 6));
    let live = true;
    fetch(`/api/calendar?start=${week}&end=${end}`)
      .then(r => r.json())
      .then(d => { if (live) { setEvents(d.events ?? []); setLoadedFor(week); } })
      .catch(() => { if (live) { setEvents([]); setLoadedFor(week); } });
    // Google's own colours, when the script can supply them.
    const from = parseISO(week).toISOString();
    const to = addDays(parseISO(week), 7).toISOString();
    fetch(`/api/calendar/colors?start=${encodeURIComponent(from)}&end=${encodeURIComponent(to)}`)
      .then(r => r.json())
      .then(d => { if (live) setColors({ byEvent: d.colors ?? {}, calendar: d.calendar_color ?? null }); })
      .catch(() => {});
    return () => { live = false; };
  }, [week]);

  // An event's colour as Google shows it: its own, else the calendar's, else Google's blue.
  const colorOf = (e: CalEvent) =>
    callKindOf(e.title) === "followup" ? "#D50000"      // follow-ups: Google's Tomato
      : callKindOf(e.title) === "dial" ? "#F4511E"         // dials: Google's Tangerine
      : colors.byEvent[`${e.uid}|${e.start}`] ?? colors.calendar ?? "#039BE5";

  // Open on the working day rather than at midnight.
  useEffect(() => {
    if (loadedFor === week && scroller.current) scroller.current.scrollTop = 7 * HOUR_PX;
  }, [loadedFor, week]);

  const days = Array.from({ length: 7 }, (_, i) => iso(addDays(parseISO(week), i)));
  const today = iso(new Date());
  const loading = loadedFor !== week;

  const allDayOn = (d: string) => events.filter(e => e.allDay
    && e.start.slice(0, 10) <= d && new Date(new Date(e.end).getTime() - 1).toISOString().slice(0, 10) >= d);
  const timedOn = (d: string) => placeDay(events.filter(e => !e.allDay && iso(new Date(e.start)) === d));
  const hasAllDay = days.some(d => allDayOn(d).length > 0);

  const first = parseISO(week), last = addDays(first, 6);
  const range = first.getMonth() === last.getMonth()
    ? `${first.toLocaleDateString("en-US", { month: "long" })} ${first.getDate()} – ${last.getDate()}, ${last.getFullYear()}`
    : `${first.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${last.toLocaleDateString("en-US", { month: "short", day: "numeric" })}, ${last.getFullYear()}`;

  const openFull = () => openGoogleCalendar(week);

  const nowDate = new Date(now);
  const nowTop = ((nowDate.getHours() * 60 + nowDate.getMinutes()) / 60) * HOUR_PX;

  const navBtn: React.CSSProperties = {
    width: 30, height: 30, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center",
    color: "#4a4a4a", cursor: "pointer", background: "rgba(0,0,0,0.045)",
  };

  return createPortal(
    <div
      onClick={onClose}
      style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{ background: "#ffffff", borderRadius: 16, width: "100%", maxWidth: 1240, height: "100%", maxHeight: 880, display: "flex", flexDirection: "column", overflow: "hidden", boxShadow: "0 24px 60px rgba(0,0,0,0.28)" }}
      >
        {/* Header */}
        <div style={{ padding: "14px 18px", borderBottom: BORDER, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <button onClick={() => setWeek(iso(weekStart(new Date())))} style={{ ...navBtn, width: "auto", padding: "0 12px", fontSize: 12, fontWeight: 700 }}>
            Today
          </button>
          {(["left", "right"] as const).map(dir => (
            <button key={dir} onClick={() => setWeek(iso(addDays(parseISO(week), dir === "left" ? -7 : 7)))} style={navBtn}>
              <svg style={{ width: 13, height: 13 }} fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d={dir === "left" ? "M15 19l-7-7 7-7" : "M9 5l7 7-7 7"} />
              </svg>
            </button>
          ))}
          <p style={{ fontSize: 16, fontWeight: 800, color: "#111111", marginRight: "auto" }}>{range}</p>
          {loading && <span style={{ fontSize: 11, color: "#949494" }}>Loading…</span>}
          <button onClick={openFull} style={{ fontSize: 11.5, fontWeight: 700, color: "#4a4a4a", cursor: "pointer", padding: "6px 10px", borderRadius: 8, background: "rgba(0,0,0,0.045)" }}>
            Open in Google Calendar ↗
          </button>
          <button onClick={onClose} style={{ ...navBtn, color: "#949494" }}>
            <svg style={{ width: 14, height: 14 }} fill="none" stroke="currentColor" strokeWidth={2.2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Day headings */}
        <div style={{ display: "grid", gridTemplateColumns: "56px repeat(7, 1fr)", borderBottom: BORDER, paddingRight: 8 }}>
          <div />
          {days.map(d => {
            const dt = parseISO(d);
            const isToday = d === today;
            return (
              <div key={d} style={{ padding: "8px 0 6px", textAlign: "center", borderLeft: BORDER }}>
                <p style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.08em", color: isToday ? "#1a73e8" : "#70757a" }}>
                  {dt.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase()}
                </p>
                <span style={{
                  display: "inline-flex", alignItems: "center", justifyContent: "center", marginTop: 3,
                  width: 40, height: 40, borderRadius: "50%", fontSize: 22, fontWeight: 400,
                  background: isToday ? "#1a73e8" : "transparent", color: isToday ? "#ffffff" : "#3c4043",
                }}>{dt.getDate()}</span>
              </div>
            );
          })}
        </div>

        {/* All-day row */}
        {hasAllDay && (
          <div style={{ display: "grid", gridTemplateColumns: "56px repeat(7, 1fr)", borderBottom: BORDER, paddingRight: 8 }}>
            <p style={{ fontSize: 9, color: "#949494", textAlign: "right", padding: "6px 6px 0 0" }}>all day</p>
            {days.map(d => (
              <div key={d} style={{ borderLeft: BORDER, padding: 3, display: "flex", flexDirection: "column", gap: 2 }}>
                {allDayOn(d).map(e => (
                  <button key={e.uid + e.start} onClick={() => setPicked(e)} style={{
                    textAlign: "left", fontSize: 10.5, fontWeight: 600, padding: "2px 6px", borderRadius: 4, cursor: "pointer",
                    background: colorOf(e), color: "#ffffff", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                  }}>{e.title}</button>
                ))}
              </div>
            ))}
          </div>
        )}

        {/* The grid */}
        <div ref={scroller} style={{ flex: 1, overflowY: "auto", position: "relative" }}>
          <div style={{ display: "grid", gridTemplateColumns: "56px repeat(7, 1fr)", position: "relative", height: 24 * HOUR_PX }}>
            <div style={{ position: "relative" }}>
              {Array.from({ length: 24 }, (_, h) => (
                <span key={h} style={{ position: "absolute", top: h * HOUR_PX - 6, right: 8, fontSize: 10, color: "#70757a" }}>
                  {h === 0 ? "" : new Date(2000, 0, 1, h).toLocaleTimeString("en-US", { hour: "numeric" })}
                </span>
              ))}
            </div>

            {days.map(d => (
              <div key={d} style={{
                position: "relative", borderLeft: BORDER,
                backgroundImage: `repeating-linear-gradient(to bottom, rgba(0,0,0,0.06) 0, rgba(0,0,0,0.06) 1px, transparent 1px, transparent ${HOUR_PX}px)`,
              }}>
                {d === today && (
                  <div style={{ position: "absolute", left: 0, right: 0, top: nowTop, height: 2, background: "#d92d20", zIndex: 3 }}>
                    <span style={{ position: "absolute", left: -4, top: -4, width: 10, height: 10, borderRadius: "50%", background: "#d92d20" }} />
                  </div>
                )}
                {timedOn(d).map(e => {
                  const call = e.attendees.length > 0 || !!e.meetUrl || isBookedHere(e.title);
                  const past = new Date(e.end).getTime() < now;
                  const c = colorOf(e);
                  return (
                    <button
                      key={e.uid + e.start}
                      onClick={() => setPicked(e)}
                      title={e.title}
                      style={{
                        position: "absolute", top: e.top, height: e.height,
                        left: `calc(${(e.col / e.cols) * 100}% + 2px)`, width: `calc(${100 / e.cols}% - 4px)`,
                        textAlign: "left", padding: "2px 6px", borderRadius: 4, overflow: "hidden", cursor: "pointer", zIndex: 2,
                        background: c,
                        color: "#ffffff",
                        border: "1px solid #ffffff",
                        opacity: past ? 0.6 : 1,
                      }}
                    >
                      <p style={{ fontSize: 10.5, fontWeight: 700, lineHeight: 1.25, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                        {call ? shortTitle(e.title) : e.title}
                        {e.height <= 34 && <span style={{ fontWeight: 500, opacity: 0.75 }}> · {time(e.start)}</span>}
                      </p>
                      {e.height > 34 && (
                        <p style={{ fontSize: 9.5, opacity: 0.75, whiteSpace: "nowrap" }}>
                          {time(e.start)} – {time(e.end)}
                        </p>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>

        {/* One event, opened */}
        {picked && (
          <div style={{ borderTop: BORDER, padding: "12px 18px", display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap", background: "#fafafa" }}>
            <div style={{ flex: 1, minWidth: 220 }}>
              <p style={{ fontSize: 13.5, fontWeight: 800, color: "#111111" }}>{picked.title}</p>
              <p style={{ fontSize: 11.5, color: "#767676", marginTop: 2 }}>
                {new Date(picked.start).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })}
                {!picked.allDay && ` · ${time(picked.start)} – ${time(picked.end)}`}
                {picked.attendees.length > 0 && ` · ${picked.attendees.length} ${picked.attendees.length === 1 ? "guest" : "guests"}`}
              </p>
            </div>
            {picked.meetUrl && (
              <a href={picked.meetUrl} target="_blank" rel="noopener noreferrer"
                style={{ background: "#111111", color: "#ffffff", fontSize: 12, fontWeight: 700, padding: "7px 14px", borderRadius: 8, textDecoration: "none" }}>
                Join
              </a>
            )}
            <button onClick={() => setPicked(null)} style={{ fontSize: 11.5, fontWeight: 700, color: "#767676", cursor: "pointer" }}>Close</button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
