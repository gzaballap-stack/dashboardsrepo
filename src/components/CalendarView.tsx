"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

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

type Feed = { id: string; label: string | null; error: string | null };

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

export default function CalendarView({ embedded = false, date: fixedDate }: { embedded?: boolean; date?: string } = {}) {
  const [ownDate, setOwnDate] = useState(() => iso(new Date()));
  const date = fixedDate ?? ownDate;
  const setDate = setOwnDate;
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
        {saving ? "Checking…" : "Connect calendar"}
      </button>
      {addError && <p style={{ fontSize: 11.5, color: "#c0392b", lineHeight: 1.5 }}>{addError}</p>}
    </div>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>

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
            <p style={{ fontSize: 17, fontWeight: 800, color: "#111111", marginBottom: 4 }}>Connect your calendar</p>
            <p style={{ fontSize: 12.5, color: "#767676", lineHeight: 1.6 }}>
              Your calls will show up here automatically. This is read-only — nothing is ever
              added, changed or removed in Google Calendar.
            </p>
          </div>

          <div style={{ background: "rgba(0,0,0,0.03)", borderRadius: 10, padding: "14px 16px" }}>
            <p style={{ fontSize: 9, fontWeight: 800, letterSpacing: "0.12em", color: "#949494", marginBottom: 10 }}>WHERE TO FIND THE LINK</p>
            <ol style={{ fontSize: 12.5, color: "#4a4a4a", lineHeight: 1.85, paddingLeft: 20, margin: 0, listStyle: "decimal" }}>
              <li>Open Google Calendar on a computer.</li>
              <li>Hover the calendar you want in the left list, click the three dots, then <strong>Settings and sharing</strong>.</li>
              <li>Scroll to <strong>Integrate calendar</strong>.</li>
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
