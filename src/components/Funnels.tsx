"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  FORM_FIELDS, REVENUE_OPTIONS, SECTION_INFO,
  type FunnelContent, type FunnelSection, type FunnelVideo, type SectionType,
} from "@/lib/funnel-content";
import type { VersionStats } from "@/lib/funnels";

/* ────────────────────────────────────────────────────────────────────────────
   Funnels (Tomsi Media)

   Every version of the website funnel, which ones are live, and what each one
   produced: visitors, how far they got through the form, leads, booked calls,
   shows, closes and its share of ad spend. A version that has been live is
   frozen, so its numbers always describe one page; a change is made by copying
   a version, editing the copy and making it live (on its own, or sharing
   traffic with the current one as a split test).
   ──────────────────────────────────────────────────────────────────────────── */

type Version = {
  id: string; funnel_id: string; number: number; name: string; notes: string; content: FunnelContent;
  status: "draft" | "live" | "paused" | "archived"; weight: number; published_at: string | null; created_at: string;
};
type Funnel = { id: string; slug: string; name: string; site_url: string | null; versions: Version[]; stats: Record<string, VersionStats>; legacy: VersionStats | null };
type Data = { ready: boolean; funnels: Funnel[] };

const CARD = "#ffffff";
const BORDER = "1px solid rgba(0,0,0,0.07)";
const SHADOW = "0 1px 2px rgba(0,0,0,0.03), 0 10px 28px -12px rgba(0,0,0,0.10)";
const INK = "#111111";
const MUTED = "#767676";
const FAINT = "#a8a8a8";
const GOOD = "#1a7f4b";
const BLUE = "#2563eb";
const PREVIEW_KEY = "tomsi";

const RANGES = [
  { id: "all", label: "All time", days: null },
  { id: "today", label: "Today", days: 0 },
  { id: "7", label: "7 days", days: 6 },
  { id: "30", label: "30 days", days: 29 },
] as const;

const STATUS: Record<Version["status"], { label: string; color: string; bg: string }> = {
  live:     { label: "Live",     color: GOOD,  bg: "rgba(26,127,75,0.10)" },
  draft:    { label: "Draft",    color: BLUE,  bg: "rgba(37,99,235,0.10)" },
  paused:   { label: "Paused",   color: MUTED, bg: "rgba(0,0,0,0.06)" },
  archived: { label: "Archived", color: FAINT, bg: "rgba(0,0,0,0.04)" },
};

const ZERO: VersionStats = { visitors: 0, started: 0, q2: 0, q3: 0, disqualified: 0, leads: 0, calendar: 0, booked: 0, shown: 0, closed: 0, revenue: 0, spend: 0, first_seen: null, last_seen: null };
const num = (n: number) => n.toLocaleString("en-US");
const pct = (a: number, b: number) => (b > 0 ? `${((a / b) * 100).toFixed(1)}%` : "—");
const money = (v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
const per = (spend: number, n: number) => (n > 0 && spend > 0 ? `$${(spend / n).toFixed(2)}` : "—");
const day = (d: string | null) => (d ? new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "");
const iso = (d: Date) => d.toISOString().slice(0, 10);

const inputStyle: React.CSSProperties = { border: "1px solid rgba(0,0,0,0.14)", borderRadius: 8, padding: "7px 10px", fontSize: 13, color: INK, background: "#fff", width: "100%" };
const btn = (primary = false, danger = false): React.CSSProperties => ({
  border: primary ? "1px solid #111" : "1px solid rgba(0,0,0,0.14)", background: primary ? "#111" : "#fff",
  color: primary ? "#fff" : danger ? "#b42318" : INK, borderRadius: 8, padding: "6px 12px", fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
});

export default function Funnels() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<(typeof RANGES)[number]["id"]>("all");
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState<string | null>(null);        // version shown in detail
  const [editing, setEditing] = useState<string | null>(null);  // version open in the editor
  const [busy, setBusy] = useState(false);
  const [showArchived, setShowArchived] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = RANGES.find(x => x.id === range)!;
      const q = new URLSearchParams();
      if (r.days !== null) {
        const end = new Date(), start = new Date(Date.now() - r.days * 86_400_000);
        q.set("start_date", iso(start)); q.set("end_date", iso(end));
      }
      const res = await fetch(`/api/funnels?${q}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Could not load the funnels");
      setData(body); setError(null);
    } catch (e) { setError((e as Error).message); }
    setLoading(false);
  }, [range]);
  useEffect(() => { load(); }, [load]);

  const act = async (body: Record<string, unknown>): Promise<Record<string, unknown> | null> => {
    setBusy(true);
    try {
      const res = await fetch("/api/funnels", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const out = await res.json();
      if (!res.ok) throw new Error(out.error || "That did not work");
      await load();
      setBusy(false);
      return out;
    } catch (e) { alertError((e as Error).message); setBusy(false); return null; }
  };
  const alertError = (m: string) => { setError(m); window.setTimeout(() => setError(null), 6000); };

  if (!data && !error) return <p style={{ color: MUTED, fontSize: 13, padding: 24 }}>Loading funnels…</p>;
  if (data && !data.ready) {
    return (
      <div style={{ background: CARD, border: BORDER, borderRadius: 16, boxShadow: SHADOW, padding: 24, maxWidth: 640 }}>
        <p style={{ fontWeight: 700, color: INK, fontSize: 15 }}>Funnels is not set up in this environment yet</p>
        <p style={{ color: MUTED, fontSize: 13, marginTop: 6 }}>The database tables for it have not been created here. Once they are, the website funnel and its versions appear on this page.</p>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: INK, letterSpacing: "-0.01em" }}>Funnels</h2>
          <p style={{ fontSize: 13, color: MUTED, marginTop: 2 }}>Every version of the funnel and what it produced.</p>
        </div>
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          {loading && <span style={{ fontSize: 12, color: FAINT }}>Loading…</span>}
          {RANGES.map(r => (
            <button key={r.id} onClick={() => setRange(r.id)} style={{ ...btn(range === r.id), borderRadius: 999 }}>{r.label}</button>
          ))}
        </div>
      </div>

      {error && <div style={{ background: "#fef3f2", border: "1px solid #fecdca", color: "#b42318", borderRadius: 10, padding: "10px 14px", fontSize: 13 }}>{error}</div>}

      {(data?.funnels ?? []).map(f => (
        <FunnelCard key={f.id} funnel={f} open={open} setOpen={setOpen} editing={editing} setEditing={setEditing}
          act={act} busy={busy} showArchived={showArchived} setShowArchived={setShowArchived} />
      ))}

      <p style={{ fontSize: 12, color: FAINT, lineHeight: 1.6, maxWidth: 820 }}>
        People are counted once per version. Booked calls, shows and closes belong to the version the lead came in on, whenever they happen.
        Ad spend is shared out day by day, by where that day&apos;s visitors landed. Your own visits with the test link are not counted.
        The old funnel is the GoHighLevel pages the ads used before: its numbers start the day page visits began being recorded and are counted by the date each thing happened.
      </p>
    </div>
  );
}

function FunnelCard({ funnel, open, setOpen, editing, setEditing, act, busy, showArchived, setShowArchived }: {
  funnel: Funnel; open: string | null; setOpen: (v: string | null) => void; editing: string | null; setEditing: (v: string | null) => void;
  act: (b: Record<string, unknown>) => Promise<Record<string, unknown> | null>; busy: boolean; showArchived: boolean; setShowArchived: (v: boolean) => void;
}) {
  const live = funnel.versions.filter(v => v.status === "live");
  const totalWeight = live.reduce((a, v) => a + v.weight, 0) || 1;
  const share = (v: Version) => Math.round((v.weight / totalWeight) * 100);
  const archived = funnel.versions.filter(v => v.status === "archived").length;
  const rows = funnel.versions.filter(v => showArchived || v.status !== "archived");
  const previewUrl = (v: Version) => `${funnel.site_url}?version=${v.id}&preview=${PREVIEW_KEY}`;

  const th: React.CSSProperties = { textAlign: "right", fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: FAINT, padding: "10px 12px", whiteSpace: "nowrap" };
  const td: React.CSSProperties = { textAlign: "right", fontSize: 13, color: INK, padding: "12px", whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" };

  return (
    <div style={{ background: CARD, border: BORDER, borderRadius: 16, boxShadow: SHADOW, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "18px 20px", flexWrap: "wrap" }}>
        <div>
          <p style={{ fontSize: 16, fontWeight: 700, color: INK }}>{funnel.name}</p>
          <p style={{ fontSize: 12, color: MUTED, marginTop: 3 }}>
            {funnel.site_url && <a href={funnel.site_url} target="_blank" rel="noreferrer" style={{ color: BLUE }}>{funnel.site_url.replace(/^https?:\/\//, "")}</a>}
            {" · "}
            {live.length === 0 ? "Nothing live" : live.length === 1 ? `Version ${live[0].number} is live` : `Split test: ${live.map(v => `version ${v.number} ${share(v)}%`).join(" · ")}`}
          </p>
        </div>
        <button disabled={busy} style={btn(true)} onClick={async () => {
          const out = await act({ action: "new_version", funnel_id: funnel.id, from_version_id: live[0]?.id });
          const v = out?.version as Version | undefined;
          if (v) { setOpen(v.id); setEditing(v.id); }
        }}>+ New version</button>
      </div>

      <div style={{ overflowX: "auto", borderTop: BORDER }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 980 }}>
          <thead>
            <tr style={{ background: "rgba(0,0,0,0.018)" }}>
              <th style={{ ...th, textAlign: "left", paddingLeft: 20 }}>Version</th>
              <th style={th}>Visitors</th><th style={th}>Started form</th><th style={th}>Leads</th><th style={th}>Lead rate</th>
              <th style={th}>Booked</th><th style={th}>Booking rate</th><th style={th}>Shows</th><th style={th}>Closed</th>
              <th style={th}>Ad spend</th><th style={th}>Cost / lead</th><th style={{ ...th, paddingRight: 20 }}>Cost / booked</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(v => {
              const s = funnel.stats[v.id] ?? ZERO;
              const st = STATUS[v.status];
              const isOpen = open === v.id;
              return (
                <FragmentRow key={v.id}>
                  <tr onClick={() => { setOpen(isOpen ? null : v.id); if (isOpen) setEditing(null); }} style={{ borderTop: BORDER, cursor: "pointer", background: isOpen ? "rgba(0,0,0,0.02)" : undefined }}>
                    <td style={{ ...td, textAlign: "left", paddingLeft: 20 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontWeight: 700 }}>V{v.number}</span>
                        <span style={{ color: MUTED, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis" }}>{v.name}</span>
                        <span style={{ fontSize: 11, fontWeight: 700, color: st.color, background: st.bg, borderRadius: 999, padding: "2px 8px" }}>
                          {st.label}{v.status === "live" && live.length > 1 ? ` · ${share(v)}%` : ""}
                        </span>
                      </div>
                      {s.first_seen && <p style={{ fontSize: 11, color: FAINT, marginTop: 3 }}>{day(s.first_seen)} – {day(s.last_seen)}</p>}
                    </td>
                    <td style={td}>{num(s.visitors)}</td>
                    <td style={td}>{num(s.started)}</td>
                    <td style={{ ...td, fontWeight: 700 }}>{num(s.leads)}</td>
                    <td style={td}>{pct(s.leads, s.visitors)}</td>
                    <td style={{ ...td, fontWeight: 700 }}>{num(s.booked)}</td>
                    <td style={td}>{pct(s.booked, s.leads)}</td>
                    <td style={td}>{num(s.shown)}</td>
                    <td style={td}>{num(s.closed)}{s.revenue > 0 ? ` · ${money(s.revenue)}` : ""}</td>
                    <td style={td}>{s.spend > 0 ? money(s.spend) : "—"}</td>
                    <td style={td}>{per(s.spend, s.leads)}</td>
                    <td style={{ ...td, paddingRight: 20 }}>{per(s.spend, s.booked)}</td>
                  </tr>
                  {isOpen && (
                    <tr>
                      <td colSpan={12} style={{ padding: 0, borderTop: BORDER, background: "rgba(0,0,0,0.012)" }}>
                        <VersionDetail v={v} s={s} liveCount={live.length} previewUrl={previewUrl(v)} act={act} busy={busy}
                          editing={editing === v.id} setEditing={on => setEditing(on ? v.id : null)}
                          onCopied={id => { setOpen(id); setEditing(id); }} />
                      </td>
                    </tr>
                  )}
                </FragmentRow>
              );
            })}
            {funnel.legacy && (() => {
              const s = funnel.legacy;
              return (
                <tr style={{ borderTop: "2px solid rgba(0,0,0,0.08)", background: "rgba(0,0,0,0.018)" }}>
                  <td style={{ ...td, textAlign: "left", paddingLeft: 20 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{ fontWeight: 700 }}>Old funnel</span>
                      <span style={{ color: MUTED }}>GoHighLevel pages</span>
                      <span style={{ fontSize: 11, fontWeight: 700, color: MUTED, background: "rgba(0,0,0,0.06)", borderRadius: 999, padding: "2px 8px" }}>Before</span>
                    </div>
                    {s.first_seen && <p style={{ fontSize: 11, color: FAINT, marginTop: 3 }}>{day(s.first_seen)} – {day(s.last_seen)}</p>}
                  </td>
                  <td style={td}>{num(s.visitors)}</td>
                  <td style={{ ...td, color: FAINT }}>—</td>
                  <td style={{ ...td, fontWeight: 700 }}>{num(s.leads)}</td>
                  <td style={td}>{pct(s.leads, s.visitors)}</td>
                  <td style={{ ...td, fontWeight: 700 }}>{num(s.booked)}</td>
                  <td style={td}>{pct(s.booked, s.leads)}</td>
                  <td style={td}>{num(s.shown)}</td>
                  <td style={td}>{num(s.closed)}{s.revenue > 0 ? ` · ${money(s.revenue)}` : ""}</td>
                  <td style={td}>{s.spend > 0 ? money(s.spend) : "—"}</td>
                  <td style={td}>{per(s.spend, s.leads)}</td>
                  <td style={{ ...td, paddingRight: 20 }}>{per(s.spend, s.booked)}</td>
                </tr>
              );
            })()}
          </tbody>
        </table>
      </div>
      {archived > 0 && (
        <button onClick={() => setShowArchived(!showArchived)} style={{ fontSize: 12, color: MUTED, padding: "10px 20px", background: "none", border: "none", cursor: "pointer" }}>
          {showArchived ? "Hide" : "Show"} {archived} archived
        </button>
      )}
    </div>
  );
}

function FragmentRow({ children }: { children: React.ReactNode }) { return <>{children}</>; }

function VersionDetail({ v, s, liveCount, previewUrl, act, busy, editing, setEditing, onCopied }: {
  v: Version; s: VersionStats; liveCount: number; previewUrl: string;
  act: (b: Record<string, unknown>) => Promise<Record<string, unknown> | null>; busy: boolean;
  editing: boolean; setEditing: (on: boolean) => void; onCopied: (id: string) => void;
}) {
  const [name, setName] = useState(v.name);
  const [notes, setNotes] = useState(v.notes);
  const [weight, setWeight] = useState(String(v.weight));
  const locked = !!v.published_at;
  const steps: [string, number][] = [
    ["Opened the page", s.visitors], ["Answered question 1", s.started], ["Answered revenue", s.q2],
    ["Gave their company", s.q3], ["Sent contact details (lead)", s.leads], ["Booked a call", s.booked],
  ];
  const top = Math.max(s.visitors, 1);

  return (
    <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <a href={previewUrl} target="_blank" rel="noreferrer" style={{ ...btn(), textDecoration: "none" }}>Preview</a>
        {!locked && <button style={btn(true)} onClick={() => setEditing(true)}>Open editor</button>}
        <button disabled={busy} style={btn()} onClick={async () => {
          const out = await act({ action: "new_version", funnel_id: v.funnel_id, from_version_id: v.id });
          const made = out?.version as Version | undefined;
          if (made) onCopied(made.id);
        }}>{locked ? "Copy to change it" : "Duplicate"}</button>
        {v.status !== "live" && v.status !== "archived" && (
          <>
            <button disabled={busy} style={btn(true)} onClick={() => { if (window.confirm(`Make version ${v.number} the only live version? The current one is paused.`)) act({ action: "publish", id: v.id, mode: "replace" }); }}>Make live</button>
            {liveCount > 0 && <button disabled={busy} style={btn()} onClick={() => { if (window.confirm(`Send half of the traffic to version ${v.number} as a split test?`)) act({ action: "publish", id: v.id, mode: "split", weight: 50 }); }}>Add to split test</button>}
          </>
        )}
        {v.status === "live" && liveCount > 1 && (
          <>
            <span style={{ fontSize: 12, color: MUTED }}>Traffic weight</span>
            <input value={weight} onChange={e => setWeight(e.target.value)} style={{ ...inputStyle, width: 64 }} inputMode="numeric" />
            <button disabled={busy || weight === String(v.weight)} style={btn()} onClick={() => act({ action: "weight", id: v.id, weight: Number(weight) })}>Set</button>
            <button disabled={busy} style={btn()} onClick={() => act({ action: "pause", id: v.id })}>Pause</button>
            <button disabled={busy} style={btn(true)} onClick={() => { if (window.confirm(`End the split test and send all traffic to version ${v.number}?`)) act({ action: "publish", id: v.id, mode: "replace" }); }}>Make it the winner</button>
          </>
        )}
        {v.status === "archived"
          ? <button disabled={busy} style={btn()} onClick={() => act({ action: "restore", id: v.id })}>Restore</button>
          : v.status !== "live" && <button disabled={busy} style={btn()} onClick={() => act({ action: "archive", id: v.id })}>Archive</button>}
        {!locked && <button disabled={busy} style={btn(false, true)} onClick={() => { if (window.confirm(`Delete draft version ${v.number}? This cannot be undone.`)) act({ action: "delete", id: v.id }); }}>Delete</button>}
      </div>

      {locked && <p style={{ fontSize: 12, color: MUTED }}>This version has been live, so its page is frozen and its numbers always describe the same page. To change something, copy it.</p>}

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.2fr) minmax(0,1fr)", gap: 20 }}>
        <div style={{ background: CARD, border: BORDER, borderRadius: 12, padding: 16 }}>
          <p style={{ fontSize: 12, fontWeight: 700, color: INK, marginBottom: 12 }}>Where people stop</p>
          {steps.map(([label, n], i) => (
            <div key={label} style={{ marginBottom: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: INK }}>
                <span>{label}</span>
                <span style={{ fontVariantNumeric: "tabular-nums" }}>
                  {num(n)} <span style={{ color: FAINT }}>· {pct(n, s.visitors)}{i > 0 ? ` · ${pct(n, steps[i - 1][1])} of previous` : ""}</span>
                </span>
              </div>
              <div style={{ height: 6, borderRadius: 999, background: "rgba(0,0,0,0.06)", marginTop: 4 }}>
                <div style={{ height: 6, borderRadius: 999, background: i === 4 || i === 5 ? GOOD : "#111", width: `${Math.min(100, (n / top) * 100)}%` }} />
              </div>
            </div>
          ))}
          <p style={{ fontSize: 12, color: MUTED, marginTop: 12 }}>
            Did not qualify: {num(s.disqualified)} · Saw the calendar: {num(s.calendar)} · Shows: {num(s.shown)} · Closed: {num(s.closed)}{s.revenue > 0 ? ` (${money(s.revenue)})` : ""}
          </p>
        </div>
        <div style={{ background: CARD, border: BORDER, borderRadius: 12, padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
          <p style={{ fontSize: 12, fontWeight: 700, color: INK }}>Name and notes</p>
          <input value={name} onChange={e => setName(e.target.value)} placeholder="Name of this version" style={inputStyle} />
          <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="What changed in this version, and why" rows={4} style={{ ...inputStyle, resize: "vertical" }} />
          <div>
            <button disabled={busy || (name === v.name && notes === v.notes)} style={btn(true)} onClick={() => act({ action: "save", id: v.id, name, notes })}>Save</button>
          </div>
        </div>
      </div>

      {editing && !locked && <Editor v={v} act={act} busy={busy} previewUrl={previewUrl} onClose={() => setEditing(false)} />}
    </div>
  );
}

/* ── Editor ─────────────────────────────────────────────────────────────────
   A full-screen editor for a draft: the real page in the middle (the website
   itself, in an editor mode that takes its wording from here as it is typed),
   the list of sections on the left, and on the right what the picked section
   says. Nothing reaches visitors until the draft is saved and made live.
   ──────────────────────────────────────────────────────────────────────────── */

type PageKey = "landing" | "booked";

const FORM_STEPS: [number, string][] = [[1, "Question 1"], [2, "Revenue"], [3, "Company"], [4, "Contact"], [5, "Calendar"], [0, "Not qualified"]];

function Editor({ v, act, busy, previewUrl, onClose }: {
  v: Version; act: (b: Record<string, unknown>) => Promise<Record<string, unknown> | null>; busy: boolean; previewUrl: string; onClose: () => void;
}) {
  const [content, setContent] = useState<FunnelContent>(v.content);
  const [page, setPage] = useState<PageKey>("landing");
  const [selected, setSelected] = useState<string | null>(null);
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [undo, setUndo] = useState<FunnelContent[]>([]);
  const [saved, setSaved] = useState(false);
  const [ready, setReady] = useState(0);                 // bumps each time the page in the frame says it is ready
  const [formStep, setFormStep] = useState<number | null>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const dirty = useMemo(() => JSON.stringify(content) !== JSON.stringify(v.content), [content, v.content]);

  const site = useMemo(() => new URL(previewUrl), [previewUrl]);
  const frameUrl = `${site.origin}${site.pathname}${page === "booked" ? "/booked" : ""}${site.search}&edit=1`;
  const send = useCallback((msg: Record<string, unknown>) => frame.current?.contentWindow?.postMessage(msg, site.origin), [site.origin]);

  // The page in the frame: it says when it is ready, and which section was clicked.
  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== site.origin || e.source !== frame.current?.contentWindow) return;
      const d = (e.data ?? {}) as { type?: string; id?: string };
      if (d.type === "tm-funnel:ready") setReady(n => n + 1);
      if (d.type === "tm-funnel:picked" && d.id) { setSelected(d.id); }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [site.origin]);

  // Keep the page in the frame showing exactly what is being typed here.
  useEffect(() => {
    if (!ready) return;
    const t = window.setTimeout(() => send({ type: "tm-funnel:content", content }), 120);
    return () => window.clearTimeout(t);
  }, [content, ready, send]);
  useEffect(() => { if (ready) send({ type: "tm-funnel:select", id: selected }); }, [selected, ready, send]);
  useEffect(() => { if (ready) send({ type: "tm-funnel:step", step: formStep }); }, [formStep, ready, send]);

  const change = (next: FunnelContent, undoable = false) => {
    if (undoable) setUndo(u => [...u.slice(-19), content]);
    setContent(next); setSaved(false);
  };
  const sections = content[page];
  const setSections = (next: FunnelSection[], undoable = false) => change({ ...content, [page]: next }, undoable);
  const patch = (id: string, p: Partial<FunnelSection>) => setSections(sections.map(s => (s.id === id ? { ...s, ...p } : s)));
  const move = (from: number, to: number) => {
    if (to < 0 || to >= sections.length || from === to) return;
    const list = [...sections]; const [it] = list.splice(from, 1); list.splice(to, 0, it);
    setSections(list, true);
  };
  const add = (type: SectionType) => {
    const fresh: FunnelSection = { id: `${type}-${Date.now().toString(36)}`, type };
    if (type === "testimonials") { fresh.layout = page === "booked" ? "stack" : "grid"; fresh.videos = []; fresh.heading = ""; fresh.sub = ""; }
    if (type === "headline") fresh.lines = ["New headline"];
    if (type === "text") { fresh.heading = "New heading"; fresh.text = "Your text here."; }
    if (type === "badge" || type === "pill" || type === "button" || type === "subline") fresh.text = "New text";
    if (type === "steps") { fresh.heading = "Your Next Steps:"; fresh.items = ["First step"]; }
    if (type === "link") { fresh.text = "Learn more"; fresh.url = "https://"; }
    if (type === "booked_heading") { fresh.heading = "New heading"; fresh.sub = ""; }
    const at = selected ? sections.findIndex(s => s.id === selected) : -1;
    const list = [...sections]; list.splice(at === -1 ? list.length : at + 1, 0, fresh);
    setSections(list, true); setSelected(fresh.id);
  };
  const close = () => { if (!dirty || window.confirm("Close without saving your changes?")) onClose(); };

  const sel = sections.find(s => s.id === selected) ?? null;
  const side: React.CSSProperties = { background: CARD, borderRight: BORDER, overflowY: "auto", padding: 14 };
  const pill = (on: boolean): React.CSSProperties => ({ ...btn(on), borderRadius: 999 });
  const setForm = (key: string, value: unknown) => change({ ...content, form: { ...content.form, [key]: value } });

  // Drawn over the whole window, above the dashboard's own menu.
  return createPortal(
    <div style={{ position: "fixed", inset: 0, zIndex: 100000, background: "#f1f1f2", display: "flex", flexDirection: "column" }}>
      <div style={{ height: 54, flexShrink: 0, background: CARD, borderBottom: BORDER, display: "flex", alignItems: "center", gap: 10, padding: "0 14px" }}>
        <button style={btn()} onClick={close}>← Back</button>
        <span style={{ fontSize: 13, fontWeight: 700, color: INK }}>Version {v.number}</span>
        <span style={{ fontSize: 13, color: MUTED, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v.name}</span>
        <div style={{ display: "flex", gap: 6, marginLeft: 14 }}>
          <button style={pill(page === "landing")} onClick={() => { setPage("landing"); setSelected(null); setReady(0); }}>Landing page</button>
          <button style={pill(page === "booked")} onClick={() => { setPage("booked"); setSelected(null); setFormStep(null); setReady(0); }}>Booked page</button>
        </div>
        <div style={{ display: "flex", gap: 6, marginLeft: 14 }}>
          <button style={pill(device === "desktop")} onClick={() => setDevice("desktop")}>Desktop</button>
          <button style={pill(device === "mobile")} onClick={() => setDevice("mobile")}>Phone</button>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" }}>
          {saved && !dirty && <span style={{ fontSize: 12, color: GOOD }}>Saved</span>}
          {dirty && <span style={{ fontSize: 12, color: MUTED }}>Unsaved changes</span>}
          <button style={btn()} disabled={!undo.length} onClick={() => { const last = undo[undo.length - 1]; setUndo(u => u.slice(0, -1)); setContent(last); setSaved(false); }}>Undo</button>
          <a href={previewUrl} target="_blank" rel="noreferrer" style={{ ...btn(), textDecoration: "none" }}>Open saved page</a>
          <button disabled={busy || !dirty} style={{ ...btn(true), opacity: dirty ? 1 : 0.4 }} onClick={async () => { if (await act({ action: "save", id: v.id, content })) setSaved(true); }}>Save</button>
        </div>
      </div>

      <div style={{ flex: 1, minHeight: 0, display: "grid", gridTemplateColumns: "230px minmax(0,1fr) 340px" }}>
        {/* Sections */}
        <div style={side}>
          <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase", color: FAINT, marginBottom: 8 }}>Sections</p>
          {sections.map((s, i) => (
            <div key={s.id} draggable onDragStart={() => setDragFrom(i)} onDragOver={e => e.preventDefault()}
              onDrop={() => { if (dragFrom !== null) move(dragFrom, i); setDragFrom(null); }}
              onClick={() => { setSelected(s.id); }}
              style={{ display: "flex", alignItems: "center", gap: 6, padding: "7px 8px", borderRadius: 8, marginBottom: 4, cursor: "grab", fontSize: 13,
                background: selected === s.id ? "rgba(255,90,31,0.10)" : "transparent", border: selected === s.id ? "1px solid rgba(255,90,31,0.5)" : "1px solid transparent", color: INK }}>
              <span style={{ color: FAINT, fontSize: 11 }}>⋮⋮</span>
              <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{SECTION_INFO[s.type].label}</span>
              <button title="Move up" style={{ ...btn(), padding: "1px 6px" }} disabled={i === 0} onClick={e => { e.stopPropagation(); move(i, i - 1); }}>↑</button>
              <button title="Move down" style={{ ...btn(), padding: "1px 6px" }} disabled={i === sections.length - 1} onClick={e => { e.stopPropagation(); move(i, i + 1); }}>↓</button>
            </div>
          ))}
          <select value="" onChange={e => { if (e.target.value) add(e.target.value as SectionType); }} style={{ ...inputStyle, marginTop: 8 }}>
            <option value="">+ Add a section…</option>
            {(Object.keys(SECTION_INFO) as SectionType[]).filter(t => t !== "form" && SECTION_INFO[t].pages.includes(page)).map(t => (
              <option key={t} value={t}>{SECTION_INFO[t].label}</option>
            ))}
          </select>
          <p style={{ fontSize: 11, color: FAINT, marginTop: 10, lineHeight: 1.5 }}>Click a section on the page or here to edit it. Drag to reorder. A new section goes under the picked one.</p>
        </div>

        {/* The page */}
        <div style={{ overflow: "auto", display: "flex", justifyContent: "center", padding: device === "mobile" ? "18px 0" : 0 }}>
          <iframe ref={frame} key={frameUrl} src={frameUrl} title="Funnel preview"
            style={{ border: device === "mobile" ? "1px solid rgba(0,0,0,0.15)" : "none", borderRadius: device === "mobile" ? 18 : 0, background: "#fff",
              width: device === "mobile" ? 390 : "100%", height: device === "mobile" ? 780 : "100%", flexShrink: 0 }} />
        </div>

        {/* What it says / the AI */}
        <div style={{ ...side, borderRight: "none", borderLeft: BORDER, display: "flex", flexDirection: "column" }}>
          {!sel && <p style={{ fontSize: 13, color: MUTED, lineHeight: 1.6 }}>Click any part of the page to change it. Put *asterisks* around words to highlight them.</p>}

          {sel && (
            <div style={{ display: "grid", gap: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <p style={{ fontSize: 14, fontWeight: 700, color: INK }}>{SECTION_INFO[sel.type].label}</p>
                {sel.type !== "form" && <button style={btn(false, true)} onClick={() => { setSections(sections.filter(s => s.id !== sel.id), true); setSelected(null); }}>Remove</button>}
              </div>
              {SECTION_INFO[sel.type].fields.map(f => (
                <Labeled key={String(f.key)} label={f.label}>
                  {f.kind === "text" && <input value={(sel[f.key] as string) ?? ""} onChange={e => patch(sel.id, { [f.key]: e.target.value })} style={inputStyle} />}
                  {f.kind === "long" && <textarea rows={4} value={(sel[f.key] as string) ?? ""} onChange={e => patch(sel.id, { [f.key]: e.target.value })} style={{ ...inputStyle, resize: "vertical" }} />}
                  {f.kind === "lines" && <textarea rows={Math.max(3, ((sel[f.key] as string[]) ?? []).length + 1)} value={((sel[f.key] as string[]) ?? []).join("\n")} onChange={e => patch(sel.id, { [f.key]: e.target.value.split("\n") })} style={{ ...inputStyle, resize: "vertical" }} />}
                  {f.kind === "layout" && (
                    <select value={sel.layout ?? "grid"} onChange={e => patch(sel.id, { layout: e.target.value as "grid" | "stack" })} style={inputStyle}>
                      <option value="grid">Two per row</option>
                      <option value="stack">One per row</option>
                    </select>
                  )}
                  {f.kind === "videos" && <Videos videos={sel.videos ?? []} onChange={videos => patch(sel.id, { videos })} />}
                </Labeled>
              ))}
              {SECTION_INFO[sel.type].fields.length === 0 && sel.type !== "form" && <p style={{ fontSize: 13, color: MUTED }}>Nothing to change here. You can move it or remove it.</p>}

              {sel.type === "form" && (
                <>
                  <Labeled label="Show this step on the page">
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      {FORM_STEPS.map(([n, label]) => <button key={n} style={pill(formStep === n)} onClick={() => setFormStep(n)}>{label}</button>)}
                    </div>
                  </Labeled>
                  {FORM_FIELDS.map(f => (
                    <Labeled key={f.key} label={f.label}>
                      {f.kind === "long"
                        ? <textarea rows={3} value={content.form[f.key]} onChange={e => setForm(f.key, e.target.value)} style={{ ...inputStyle, resize: "vertical" }} />
                        : <input value={content.form[f.key]} onChange={e => setForm(f.key, e.target.value)} style={inputStyle} />}
                    </Labeled>
                  ))}
                  <Labeled label="Revenue answers that end the form (they do not qualify)">
                    <div style={{ display: "grid", gap: 6 }}>
                      {REVENUE_OPTIONS.map(o => (
                        <label key={o} style={{ fontSize: 13, color: INK, display: "flex", gap: 6, alignItems: "center" }}>
                          <input type="checkbox" checked={content.form.disqualify.includes(o)} onChange={e => setForm("disqualify", e.target.checked ? [...content.form.disqualify, o] : content.form.disqualify.filter(x => x !== o))} />
                          {o}
                        </label>
                      ))}
                    </div>
                  </Labeled>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "block" }}>
      <span style={{ display: "block", fontSize: 11, fontWeight: 600, color: MUTED, marginBottom: 4 }}>{label}</span>
      {children}
    </label>
  );
}

function Videos({ videos, onChange }: { videos: FunnelVideo[]; onChange: (v: FunnelVideo[]) => void }) {
  const set = (i: number, patch: Partial<FunnelVideo>) => onChange(videos.map((v, j) => (j === i ? { ...v, ...patch } : v)));
  return (
    <div style={{ display: "grid", gap: 8 }}>
      {videos.map((v, i) => (
        <div key={i} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,2fr) auto", gap: 8 }}>
          <input value={v.id} onChange={e => set(i, { id: e.target.value })} placeholder="YouTube link or id" style={inputStyle} />
          <input value={v.headline} onChange={e => set(i, { headline: e.target.value, title: e.target.value })} placeholder="Line shown with the video" style={inputStyle} />
          <button style={btn(false, true)} onClick={() => onChange(videos.filter((_, j) => j !== i))}>Remove</button>
        </div>
      ))}
      <div><button style={btn()} onClick={() => onChange([...videos, { id: "", title: "", headline: "" }])}>+ Add a video</button></div>
    </div>
  );
}
