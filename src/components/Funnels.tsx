"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
type Funnel = { id: string; slug: string; name: string; site_url: string | null; versions: Version[]; stats: Record<string, VersionStats> };
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
        {!locked && <button style={btn(editing)} onClick={() => setEditing(!editing)}>{editing ? "Close editor" : "Edit"}</button>}
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

      {editing && !locked && <Editor v={v} act={act} busy={busy} previewUrl={previewUrl} />}
    </div>
  );
}

/* ── Editor ─────────────────────────────────────────────────────────────── */

type PageKey = "landing" | "form" | "booked";

function Editor({ v, act, busy, previewUrl }: { v: Version; act: (b: Record<string, unknown>) => Promise<Record<string, unknown> | null>; busy: boolean; previewUrl: string }) {
  const [content, setContent] = useState<FunnelContent>(v.content);
  const [page, setPage] = useState<PageKey>("landing");
  const [saved, setSaved] = useState(false);
  const dirty = useMemo(() => JSON.stringify(content) !== JSON.stringify(v.content), [content, v.content]);

  const setSections = (key: "landing" | "booked", next: FunnelSection[]) => { setContent(c => ({ ...c, [key]: next })); setSaved(false); };
  const patchSection = (key: "landing" | "booked", id: string, patch: Partial<FunnelSection>) =>
    setSections(key, content[key].map(s => (s.id === id ? { ...s, ...patch } : s)));
  const move = (key: "landing" | "booked", i: number, by: number) => {
    const list = [...content[key]]; const j = i + by;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j], list[i]];
    setSections(key, list);
  };
  const add = (key: "landing" | "booked", type: SectionType) => {
    const fresh: FunnelSection = { id: `${type}-${Date.now().toString(36)}`, type };
    if (type === "testimonials") { fresh.layout = key === "booked" ? "stack" : "grid"; fresh.videos = []; fresh.heading = ""; fresh.sub = ""; }
    if (type === "headline") fresh.lines = ["New headline"];
    if (type === "steps") { fresh.heading = "Your Next Steps:"; fresh.items = ["First step"]; }
    setSections(key, [...content[key], fresh]);
  };

  return (
    <div style={{ background: CARD, border: BORDER, borderRadius: 12, padding: 16 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: 14 }}>
        <div style={{ display: "flex", gap: 6 }}>
          {([["landing", "Landing page"], ["form", "Form"], ["booked", "Booked page"]] as [PageKey, string][]).map(([k, label]) => (
            <button key={k} onClick={() => setPage(k)} style={{ ...btn(page === k), borderRadius: 999 }}>{label}</button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {saved && !dirty && <span style={{ fontSize: 12, color: GOOD }}>Saved</span>}
          <a href={previewUrl} target="_blank" rel="noreferrer" style={{ ...btn(), textDecoration: "none" }}>Preview</a>
          <button disabled={busy || !dirty} style={{ ...btn(true), opacity: dirty ? 1 : 0.4 }} onClick={async () => { if (await act({ action: "save", id: v.id, content })) setSaved(true); }}>Save changes</button>
        </div>
      </div>
      <p style={{ fontSize: 12, color: MUTED, marginBottom: 14 }}>Put *asterisks* around words to highlight them. Save, then Preview to see the page.</p>

      {page === "form" ? (
        <div style={{ display: "grid", gap: 12 }}>
          {FORM_FIELDS.map(f => (
            <Labeled key={f.key} label={f.label}>
              {f.kind === "long"
                ? <textarea rows={3} value={content.form[f.key]} onChange={e => { setContent(c => ({ ...c, form: { ...c.form, [f.key]: e.target.value } })); setSaved(false); }} style={{ ...inputStyle, resize: "vertical" }} />
                : <input value={content.form[f.key]} onChange={e => { setContent(c => ({ ...c, form: { ...c.form, [f.key]: e.target.value } })); setSaved(false); }} style={inputStyle} />}
            </Labeled>
          ))}
          <Labeled label="Revenue answers that end the form (they do not qualify)">
            <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
              {REVENUE_OPTIONS.map(o => (
                <label key={o} style={{ fontSize: 13, color: INK, display: "flex", gap: 6, alignItems: "center" }}>
                  <input type="checkbox" checked={content.form.disqualify.includes(o)} onChange={e => {
                    const next = e.target.checked ? [...content.form.disqualify, o] : content.form.disqualify.filter(x => x !== o);
                    setContent(c => ({ ...c, form: { ...c.form, disqualify: next } })); setSaved(false);
                  }} />
                  {o}
                </label>
              ))}
            </div>
          </Labeled>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {content[page].map((s, i) => (
            <div key={s.id} style={{ border: BORDER, borderRadius: 10, padding: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: SECTION_INFO[s.type].fields.length ? 10 : 0 }}>
                <p style={{ fontSize: 12, fontWeight: 700, color: INK }}>{i + 1}. {SECTION_INFO[s.type].label}</p>
                <div style={{ display: "flex", gap: 6 }}>
                  <button style={btn()} disabled={i === 0} onClick={() => move(page, i, -1)}>↑</button>
                  <button style={btn()} disabled={i === content[page].length - 1} onClick={() => move(page, i, 1)}>↓</button>
                  {s.type !== "form" && <button style={btn(false, true)} onClick={() => setSections(page, content[page].filter(x => x.id !== s.id))}>Remove</button>}
                </div>
              </div>
              <div style={{ display: "grid", gap: 10 }}>
                {SECTION_INFO[s.type].fields.map(f => (
                  <Labeled key={String(f.key)} label={f.label}>
                    {f.kind === "text" && <input value={(s[f.key] as string) ?? ""} onChange={e => patchSection(page, s.id, { [f.key]: e.target.value })} style={inputStyle} />}
                    {f.kind === "long" && <textarea rows={3} value={(s[f.key] as string) ?? ""} onChange={e => patchSection(page, s.id, { [f.key]: e.target.value })} style={{ ...inputStyle, resize: "vertical" }} />}
                    {f.kind === "lines" && <textarea rows={Math.max(2, ((s[f.key] as string[]) ?? []).length + 1)} value={((s[f.key] as string[]) ?? []).join("\n")} onChange={e => patchSection(page, s.id, { [f.key]: e.target.value.split("\n") })} style={{ ...inputStyle, resize: "vertical" }} />}
                    {f.kind === "layout" && (
                      <select value={s.layout ?? "grid"} onChange={e => patchSection(page, s.id, { layout: e.target.value as "grid" | "stack" })} style={{ ...inputStyle, width: 220 }}>
                        <option value="grid">Two per row</option>
                        <option value="stack">One per row</option>
                      </select>
                    )}
                    {f.kind === "videos" && <Videos videos={s.videos ?? []} onChange={videos => patchSection(page, s.id, { videos })} />}
                  </Labeled>
                ))}
              </div>
            </div>
          ))}
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <select value="" onChange={e => { if (e.target.value) add(page, e.target.value as SectionType); }} style={{ ...inputStyle, width: 240 }}>
              <option value="">+ Add a section…</option>
              {(Object.keys(SECTION_INFO) as SectionType[]).filter(t => t !== "form" && SECTION_INFO[t].pages.includes(page)).map(t => (
                <option key={t} value={t}>{SECTION_INFO[t].label}</option>
              ))}
            </select>
          </div>
        </div>
      )}
    </div>
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
