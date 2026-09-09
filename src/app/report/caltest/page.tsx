"use client";

// TEMPORARY local harness. Not for commit.
import { useEffect, useState } from "react";
import CalendarView from "@/components/CalendarView";

export default function CalTest() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let connected = new URLSearchParams(location.search).get("empty") !== "1";
    const real = window.fetch.bind(window);
    const at = (h: number, m: number) => { const d = new Date(); d.setHours(h, m, 0, 0); return d.toISOString(); };
    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (!url.includes("/api/calendar")) return real(input, init);
      const json = (v: unknown) => new Response(JSON.stringify(v), { headers: { "Content-Type": "application/json" } });
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "POST") { connected = true; return json({ feed: { id: "f1", label: "Sales calls" } }); }
      if (method === "DELETE") { connected = false; return json({ success: true }); }
      if (!connected) return json({ feeds: [], events: [] });
      return json({
        feeds: [{ id: "f1", label: "Sales calls", error: null }],
        events: [
          { uid: "a", title: "Q3 planning day", start: at(0, 0), end: at(23, 59), allDay: true, location: null, description: null, organizer: null, attendees: [], meetUrl: null, status: null, feed: "Sales calls" },
          { uid: "b", title: "Sales call — Steve (roofing)", start: at(9, 0), end: at(9, 45), allDay: false, location: "https://meet.google.com/abc-defg-hij", description: null, organizer: "Gonzalo", attendees: ["Steve Miller", "Dana"], meetUrl: "https://meet.google.com/abc-defg-hij", status: null, feed: "Sales calls" },
          { uid: "c", title: "Pipeline review", start: at(new Date().getHours(), 0), end: at(new Date().getHours() + 1, 0), allDay: false, location: "Office", description: null, organizer: null, attendees: ["Dana"], meetUrl: "https://meet.google.com/xyz", status: null, feed: "Sales calls" },
          { uid: "d", title: "Demo — Skywave Agency", start: at(17, 30), end: at(18, 15), allDay: false, location: null, description: null, organizer: null, attendees: ["David Hodson", "Jordan", "Mike"], meetUrl: "https://zoom.us/j/123456", status: null, feed: "Sales calls" },
        ],
      });
    };
    setReady(true);
  }, []);
  if (!ready) return <p style={{ padding: 40 }}>booting…</p>;
  return <div style={{ padding: 20, background: "#f6f6f6", minHeight: "100vh" }}><CalendarView /></div>;
}
