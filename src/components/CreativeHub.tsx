"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

// Creative & Copy Hub — the library and the timeline. One record per creative,
// named exactly as the ad is named, so everything here lines up with the
// creative leaderboard. Media is shown straight from Meta; only text is ours.

type Scope = "b2b" | "b2c";
type Run = { start: string; end: string };

type Entry = {
  id: string; name: string; kind: string | null; campaign_label: string | null; launch_date: string | null;
  headline: string | null; primary_text: string | null; prompt: string | null; script: string | null;
  background_notes: string | null; notes: string | null; media_url: string | null;
};

type Meta = {
  format: string | null; status: string | null; headline: string | null; primary_text: string | null;
  description: string | null; preview_link: string | null; thumbnail_url: string | null;
  image_url: string | null; video_url: string | null; video_length: number | null;
};

type AdRun = {
  ad_id: string; ad_name: string; client_name: string; campaign_name: string; adset_name: string;
  first: string; last: string; spend: number; status: string | null;
};

type Creative = {
  key: string; name: string; names: string[]; entry: Entry | null; kind: string | null;
  first: string | null; last: string | null; days: number; runs: Run[]; live: boolean;
  spend: number; leads: number; appts: number; shows: number; closes: number;
  cost_per_lead: number; cost_per_appt: number;
  clients: { id: string; name: string }[]; ads: AdRun[]; meta: Meta | null;
};

type Campaign = {
  campaign_id: string; name: string; client_name: string; spend: number;
  first: string | null; last: string | null; runs: Run[];
  creatives: { key: string; name: string; spend: number; runs: Run[] }[];
};

type HubData = { today: string; creatives: Creative[]; campaigns: Campaign[]; meta_error: string | null };

const KINDS = ["Talking head", "UGC video", "Voiceover video", "AI image", "AI video", "Static image", "Carousel"];

const CARD = {
  background: "#ffffff",
  border: "1px solid rgba(0,0,0,0.07)",
  boxShadow: "0 1px 2px rgba(0,0,0,0.03), 0 10px 28px -12px rgba(0,0,0,0.10)",
};
const INPUT = { background: "#f7f7f7", border: "1px solid rgba(0,0,0,0.162)", color: "#111111" };

const DAY = 86_400_000;
const dayNum = (d: string) => Math.round(new Date(`${d}T00:00:00Z`).getTime() / DAY);
const dayStr = (n: number) => new Date(n * DAY).toISOString().slice(0, 10);
const fmtDay = (d: string, withYear = false) =>
  new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: withYear ? "numeric" : undefined, timeZone: "UTC" });
const fmt$ = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const fmtRange = (a: string | null, b: string | null) =>
  !a || !b ? "Not launched" : a === b ? fmtDay(a) : `${fmtDay(a)} – ${fmtDay(b)}`;

const isVideo = (c: Creative) => c.meta?.format === "Video" || /video|head|ugc|voice/i.test(c.kind ?? "");
const statusOf = (c: Creative) => (c.live ? "live" : c.days > 0 ? "off" : "draft");
const STATUS: Record<string, { label: string; color: string; bg: string }> = {
  live:  { label: "Live",         color: "#15803d", bg: "rgba(21,128,61,0.10)" },
  off:   { label: "Off",          color: "#6b6b6b", bg: "rgba(0,0,0,0.06)" },
  draft: { label: "Not launched", color: "#92400e", bg: "rgba(217,119,6,0.12)" },
};

// What we know that Meta doesn't — used for the "what's filled in" marks.
const OUR_FIELDS: { id: keyof Entry; label: string }[] = [
  { id: "script", label: "Script" },
  { id: "prompt", label: "Prompt" },
  { id: "background_notes", label: "Background" },
];

function Chip({ children, color = "#4a4a4a", bg = "rgba(0,0,0,0.06)" }: { children: React.ReactNode; color?: string; bg?: string }) {
  return <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap" style={{ color, background: bg }}>{children}</span>;
}

function Thumb({ c, className = "" }: { c: Creative; className?: string }) {
  const [broken, setBroken] = useState(false);
  // The grid takes Meta's 600px thumbnail when there is a real one (it's nulled
  // server-side when Meta returns the page logo instead) — far lighter than the
  // full-size image the drawer shows.
  const src = c.meta?.thumbnail_url ?? c.meta?.image_url ?? null;
  if (!src || broken) {
    return (
      <div className={`flex items-center justify-center ${className}`} style={{ background: "#f2f2f2", color: "#c2c2c2" }}>
        <svg className="w-8 h-8" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      </div>
    );
  }
  // Meta's CDN refuses requests that carry our page as the referrer.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={c.name} referrerPolicy="no-referrer" loading="lazy" onError={() => setBroken(true)} className={`object-cover ${className}`} style={{ background: "#f2f2f2" }} />;
}

export default function CreativeHub({ scope, tab, clients }: {
  scope: Scope;
  tab: "library" | "timeline";
  clients: { id: string; name: string }[];
}) {
  const [data, setData] = useState<HubData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [clientId, setClientId] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"all" | "live" | "off" | "draft">("all");
  const [kind, setKind] = useState("");
  const [sort, setSort] = useState<"recent" | "spend" | "cost">("recent");
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const apptWord = scope === "b2b" ? "Demos" : "Appts";

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const res = await fetch(`/api/creative-hub?scope=${scope}${scope === "b2c" && clientId ? `&client_id=${clientId}` : ""}`);
      const json = await res.json();
      if (!res.ok || json.error) setError(json.error ?? "Could not load the hub.");
      else setData(json);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [scope, clientId]);

  useEffect(() => { load(); }, [load]);

  const kinds = useMemo(() => [...new Set((data?.creatives ?? []).map(c => c.kind).filter((k): k is string => !!k))].sort(), [data]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = (data?.creatives ?? []).filter(c => {
      if (status !== "all" && statusOf(c) !== status) return false;
      if (kind && c.kind !== kind) return false;
      if (!q) return true;
      const hay = [c.name, ...c.names, c.kind, c.entry?.campaign_label, c.entry?.script, c.entry?.prompt, c.entry?.notes,
        c.entry?.headline ?? c.meta?.headline, c.entry?.primary_text ?? c.meta?.primary_text,
        ...c.ads.map(a => a.campaign_name), ...c.clients.map(cl => cl.name)];
      return hay.some(h => h?.toLowerCase().includes(q));
    });
    if (sort === "spend") list.sort((a, b) => b.spend - a.spend);
    if (sort === "cost") list.sort((a, b) => (a.appts > 0 ? a.cost_per_appt : Infinity) - (b.appts > 0 ? b.cost_per_appt : Infinity) || b.spend - a.spend);
    return list;
  }, [data, search, status, kind, sort]);

  const open = openKey ? data?.creatives.find(c => c.key === openKey) ?? null : null;

  return (
    <div className="space-y-4">
      {/* Controls */}
      {(tab === "library" || scope === "b2c") && <div className="rounded-2xl p-4 flex items-center gap-3 flex-wrap" style={CARD}>
        {scope === "b2c" && (
          <select value={clientId} onChange={e => setClientId(e.target.value)} className="px-3 py-1.5 rounded-lg text-xs font-medium outline-none" style={INPUT}>
            <option value="">All clients</option>
            {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        )}
        {tab === "library" && (<>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, copy, script…"
            className="px-3 py-1.5 rounded-lg text-xs outline-none w-56" style={INPUT} />
          <div className="flex rounded-lg overflow-hidden" style={{ border: "1px solid rgba(0,0,0,0.162)" }}>
            {(["all", "live", "off", "draft"] as const).map(s => (
              <button key={s} onClick={() => setStatus(s)} className="px-3 py-1.5 text-xs font-semibold"
                style={{ background: status === s ? "rgba(0,0,0,0.09)" : "#f7f7f7", color: status === s ? "#111111" : "#6b6b6b" }}>
                {s === "all" ? "All" : STATUS[s].label}
              </button>
            ))}
          </div>
          {kinds.length > 1 && (
            <select value={kind} onChange={e => setKind(e.target.value)} className="px-3 py-1.5 rounded-lg text-xs font-medium outline-none" style={INPUT}>
              <option value="">All types</option>
              {kinds.map(k => <option key={k} value={k}>{k}</option>)}
            </select>
          )}
          <select value={sort} onChange={e => setSort(e.target.value as typeof sort)} className="px-3 py-1.5 rounded-lg text-xs font-medium outline-none" style={INPUT}>
            <option value="recent">Most recent</option>
            <option value="spend">Most spend</option>
            <option value="cost">Best cost per {scope === "b2b" ? "demo" : "appt"}</option>
          </select>
        </>)}
        {tab === "library" && (
          <button onClick={() => setCreating(true)} className="ml-auto px-3 py-1.5 rounded-lg text-xs font-semibold" style={{ background: "#000000", color: "#ffffff" }}>
            + New creative
          </button>
        )}
      </div>}

      {error && (
        <div className="rounded-2xl p-4 text-sm" style={{ background: "rgba(192,57,43,0.08)", border: "1px solid rgba(192,57,43,0.2)", color: "#b91c1c" }}>{error}</div>
      )}
      {data?.meta_error && (
        <div className="rounded-2xl p-3 text-xs" style={{ ...CARD, color: "#92400e" }}>
          Facebook previews are unavailable right now ({data.meta_error}). Everything else is up to date.
        </div>
      )}

      {loading && !data && <div className="rounded-2xl p-8 text-center text-sm" style={{ ...CARD, color: "#6b6b6b" }}>Loading creatives…</div>}

      {data && tab === "library" && (
        shown.length === 0 ? (
          <div className="rounded-2xl p-8 text-center text-sm" style={{ ...CARD, color: "#6b6b6b" }}>
            {data.creatives.length === 0 ? "No creatives yet. Ads appear here automatically once they run — or add one with “New creative”." : "Nothing matches these filters."}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4" style={{ opacity: loading ? 0.6 : 1 }}>
            {shown.map(c => {
              const st = STATUS[statusOf(c)];
              return (
                <button key={c.key} onClick={() => setOpenKey(c.key)} className="text-left rounded-2xl overflow-hidden transition-transform duration-150 hover:-translate-y-0.5" style={CARD}>
                  <div className="relative">
                    <Thumb c={c} className="w-full aspect-[4/5]" />
                    <div className="absolute top-2 left-2"><Chip color={st.color} bg="#ffffff">● {st.label}</Chip></div>
                    {isVideo(c) && (c.meta?.thumbnail_url || c.meta?.image_url) && (
                      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                        <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: "rgba(0,0,0,0.55)" }}>
                          <svg className="w-4 h-4 ml-0.5" fill="#ffffff" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="p-3 space-y-1.5">
                    <div className="text-sm font-semibold truncate" style={{ color: "#111111" }} title={c.name}>{c.name}</div>
                    <div className="text-[11px] truncate" style={{ color: "#767676" }}>
                      {[c.kind, fmtRange(c.first, c.last)].filter(Boolean).join(" · ")}
                    </div>
                    {c.days > 0 && (
                      <div className="text-[11px]" style={{ color: "#4a4a4a" }}>
                        {fmt$(c.spend)} · {c.leads} leads · {c.appts} {apptWord.toLowerCase()}
                        {scope === "b2c" && c.clients.length > 1 && <span style={{ color: "#949494" }}> · {c.clients.length} clients</span>}
                      </div>
                    )}
                    <div className="flex gap-1 flex-wrap pt-0.5">
                      {OUR_FIELDS.filter(f => c.entry?.[f.id]).map(f => <Chip key={f.id}>{f.label}</Chip>)}
                      {!OUR_FIELDS.some(f => c.entry?.[f.id]) && <span className="text-[10px]" style={{ color: "#b8b8b8" }}>No script or prompt yet</span>}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )
      )}

      {data && tab === "timeline" && (
        <Timeline data={data} scope={scope} showClient={scope === "b2c" && !clientId} onOpen={setOpenKey} />
      )}

      {(open || creating) && (
        <Drawer
          key={open?.key ?? "new"}
          creative={open}
          scope={scope}
          apptWord={apptWord}
          onClose={() => { setOpenKey(null); setCreating(false); }}
          onSaved={async key => { setCreating(false); await load(); setOpenKey(key); }}
        />
      )}
    </div>
  );
}

// ── Timeline ────────────────────────────────────────────────────────────────

type TRow = { id: string; label: string; sub?: string; runs: Run[]; spend: number; live: boolean; marker?: string | null;
  indent?: boolean; onClick?: () => void; toggle?: boolean; openState?: boolean };

function Timeline({ data, scope, showClient, onOpen }: {
  data: HubData; scope: Scope; showClient: boolean; onOpen: (key: string) => void;
}) {
  const [mode, setMode] = useState<"campaign" | "creative">("campaign");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const todayN = dayNum(data.today);
  const isLive = (runs: Run[]) => runs.length > 0 && todayN - dayNum(runs[runs.length - 1].end) <= 2;

  const rows: TRow[] = useMemo(() => {
    if (mode === "creative") {
      return data.creatives
        .filter(c => c.runs.length || c.entry?.launch_date)
        .sort((a, b) => (a.first ?? a.entry?.launch_date ?? "").localeCompare(b.first ?? b.entry?.launch_date ?? ""))
        .map(c => ({ id: c.key, label: c.name, sub: c.kind ?? undefined, runs: c.runs, spend: c.spend, live: c.live,
          marker: c.entry?.launch_date, onClick: () => onOpen(c.key) }));
    }
    return data.campaigns.flatMap(c => {
      const isOpen = expanded.has(c.campaign_id);
      // Across clients the campaigns are all named alike, so the client leads.
      const head: TRow = { id: c.campaign_id, label: showClient ? c.client_name : c.name,
        sub: showClient ? c.name : `${c.creatives.length} creative${c.creatives.length === 1 ? "" : "s"}`,
        runs: c.runs, spend: c.spend, live: isLive(c.runs), toggle: true, openState: isOpen,
        onClick: () => setExpanded(prev => { const n = new Set(prev); if (n.has(c.campaign_id)) n.delete(c.campaign_id); else n.add(c.campaign_id); return n; }) };
      const kids: TRow[] = isOpen ? c.creatives.map(cc => ({ id: `${c.campaign_id}:${cc.key}`, label: cc.name, runs: cc.runs, spend: cc.spend,
        live: isLive(cc.runs), indent: true, onClick: () => onOpen(cc.key) })) : [];
      return [head, ...kids];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, mode, expanded, showClient]);

  const starts = rows.flatMap(r => [r.runs[0]?.start, r.marker]).filter((d): d is string => !!d).map(dayNum);
  if (!starts.length) {
    return <div className="rounded-2xl p-8 text-center text-sm" style={{ ...CARD, color: "#6b6b6b" }}>Nothing has run yet — the timeline fills in as ads go live.</div>;
  }
  const min = Math.min(...starts) - 1;
  const total = todayN - min + 2;
  const dayW = total <= 45 ? 18 : total <= 100 ? 11 : total <= 220 ? 6 : 4;
  const LABEL_W = 280, TAIL = 90, trackW = total * dayW + TAIL;
  const x = (d: string) => (dayNum(d) - min) * dayW;

  // Month bands and Monday ticks for the header.
  const months: { label: string; left: number; width: number }[] = [];
  const ticks: { label: string; left: number }[] = [];
  for (let n = min; n < min + total; n++) {
    const d = new Date(n * DAY);
    const label = d.toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });
    const last = months[months.length - 1];
    if (last && last.label === label) last.width += dayW;
    else months.push({ label, left: (n - min) * dayW, width: dayW });
    if (d.getUTCDay() === 1) ticks.push({ label: String(d.getUTCDate()), left: (n - min) * dayW });
  }
  const mondayOffset = ticks[0]?.left ?? 0;
  const grid = {
    backgroundImage: "linear-gradient(to right, rgba(0,0,0,0.06) 1px, transparent 1px)",
    backgroundSize: `${7 * dayW}px 100%`, backgroundPosition: `${mondayOffset}px 0`,
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex rounded-lg overflow-hidden" style={{ border: "1px solid rgba(0,0,0,0.162)" }}>
          {([["campaign", "By campaign"], ["creative", "By creative"]] as const).map(([id, label]) => (
            <button key={id} onClick={() => setMode(id)} className="px-3 py-1.5 text-xs font-semibold"
              style={{ background: mode === id ? "rgba(0,0,0,0.09)" : "#f7f7f7", color: mode === id ? "#111111" : "#6b6b6b" }}>{label}</button>
          ))}
        </div>
        <div className="text-xs flex items-center gap-3" style={{ color: "#6b6b6b" }}>
          <span className="flex items-center gap-1.5"><span className="inline-block w-4 h-2 rounded-sm" style={{ background: "#15803d" }} /> Live</span>
          <span className="flex items-center gap-1.5"><span className="inline-block w-4 h-2 rounded-sm" style={{ background: "#b0b0b0" }} /> Off</span>
          <span>{mode === "campaign" ? "Click a campaign to see its creatives." : "Click a creative to open it."}</span>
        </div>
      </div>

      <div className="rounded-2xl overflow-x-auto" style={CARD}>
        <div style={{ width: LABEL_W + trackW, minWidth: "100%" }}>
          {/* Header */}
          <div className="flex" style={{ borderBottom: "1px solid rgba(0,0,0,0.07)", background: "#f7f7f7" }}>
            <div className="sticky left-0 z-10 flex-shrink-0 px-3 py-2 text-[10px] font-bold uppercase tracking-wider"
              style={{ width: LABEL_W, background: "#f7f7f7", color: "#6b6b6b", borderRight: "1px solid rgba(0,0,0,0.07)" }}>
              {mode === "creative" ? "Creative" : showClient ? "Client · campaign" : "Campaign"}
            </div>
            <div className="relative" style={{ width: trackW, height: 40 }}>
              {months.map(m => (
                <div key={m.label} className="absolute top-1 text-[10px] font-bold uppercase tracking-wider truncate" style={{ left: m.left + 4, width: m.width - 4, color: "#4a4a4a" }}>{m.label}</div>
              ))}
              {ticks.map(t => (
                <div key={t.left} className="absolute bottom-1 text-[10px]" style={{ left: t.left + 3, color: "#949494" }}>{t.label}</div>
              ))}
            </div>
          </div>

          {rows.map(r => (
            <div key={r.id} className="flex group" style={{ borderBottom: "1px solid rgba(0,0,0,0.05)" }}>
              <button onClick={r.onClick} className="sticky left-0 z-10 flex-shrink-0 text-left px-3 py-2 flex items-center gap-2"
                style={{ width: LABEL_W, background: r.indent ? "#fafafa" : "#ffffff", borderRight: "1px solid rgba(0,0,0,0.07)", paddingLeft: r.indent ? 30 : 12 }}>
                {r.toggle && (
                  <svg className="w-3 h-3 flex-shrink-0" style={{ transform: r.openState ? "rotate(90deg)" : "none", transition: "transform 150ms ease", color: "#949494" }} fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                )}
                <span className="min-w-0">
                  <span className={`block truncate text-xs ${r.indent ? "font-medium" : "font-semibold"}`} style={{ color: "#111111" }} title={r.label}>{r.label}</span>
                  {r.sub && <span className="block truncate text-[10px]" style={{ color: "#949494" }}>{r.sub}</span>}
                </span>
              </button>
              <div className="relative" style={{ width: trackW, minHeight: 40, ...grid, backgroundColor: r.indent ? "#fafafa" : undefined }}>
                <div className="absolute top-0 bottom-0" style={{ left: (todayN - min + 1) * dayW, width: 1, background: "rgba(192,57,43,0.45)" }} />
                {r.runs.map((run, i) => {
                  const liveBar = r.live && i === r.runs.length - 1;
                  return (
                    <div key={run.start} className="absolute rounded" title={`${fmtRange(run.start, run.end)} · ${dayNum(run.end) - dayNum(run.start) + 1} days`}
                      style={{ left: x(run.start), width: Math.max((dayNum(run.end) - dayNum(run.start) + 1) * dayW - 1, 3), top: "50%", height: r.indent ? 10 : 14, marginTop: r.indent ? -5 : -7,
                        background: liveBar ? "#15803d" : r.indent ? "#c4c4c4" : "#9a9a9a" }} />
                  );
                })}
                {r.marker && (
                  <div className="absolute" title={`Launch date: ${fmtDay(r.marker, true)}`}
                    style={{ left: x(r.marker) + dayW / 2 - 4, top: "50%", width: 8, height: 8, marginTop: -4, transform: "rotate(45deg)", background: "#111111" }} />
                )}
                {r.runs.length > 0 && (
                  <div className="absolute text-[10px] whitespace-nowrap" style={{ left: x(r.runs[r.runs.length - 1].end) + dayW + 6, top: "50%", marginTop: -7, color: "#767676" }}>
                    {fmt$(r.spend)}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="text-[11px]" style={{ color: "#949494" }}>
        Bars show the days each {mode === "campaign" ? "campaign" : "creative"} was delivering, from {fmtDay(dayStr(min + 1), true)} to today{scope === "b2c" ? ", across every client it ran for" : ""}. The red line is today.
      </div>
    </div>
  );
}

// ── Detail drawer ───────────────────────────────────────────────────────────

const FORM_FIELDS: { id: keyof Entry; label: string; hint?: string; rows?: number }[] = [
  { id: "headline", label: "Headline", hint: "Leave empty to use what Facebook has." },
  { id: "primary_text", label: "Primary text", hint: "Leave empty to use what Facebook has.", rows: 6 },
  { id: "script", label: "Script", hint: "What is said — talking head or voiceover.", rows: 8 },
  { id: "prompt", label: "Prompt", hint: "The prompt used to generate the image or video.", rows: 8 },
  { id: "background_notes", label: "Background", hint: "What's in the shot: location, props, actions.", rows: 3 },
  { id: "notes", label: "Notes", rows: 3 },
];

function TextBlock({ label, text, source, onAdd }: { label: string; text: string | null; source?: string; onAdd: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <section>
      <div className="flex items-center gap-2 mb-1.5">
        <h3 className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "#949494" }}>{label}</h3>
        {source && text && <span className="text-[10px]" style={{ color: "#b8b8b8" }}>{source}</span>}
        {text && (
          <button onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
            className="ml-auto text-[10px] font-semibold" style={{ color: copied ? "#15803d" : "#767676" }}>{copied ? "Copied" : "Copy"}</button>
        )}
      </div>
      {text
        ? <div className="text-sm whitespace-pre-wrap rounded-xl p-3" style={{ background: "#f7f7f7", color: "#111111", lineHeight: 1.55 }}>{text}</div>
        : <button onClick={onAdd} className="text-xs" style={{ color: "#949494" }}>+ Add {label.toLowerCase()}</button>}
    </section>
  );
}

function Drawer({ creative, scope, apptWord, onClose, onSaved }: {
  creative: Creative | null; scope: Scope; apptWord: string;
  onClose: () => void; onSaved: (key: string) => Promise<void>;
}) {
  const entry = creative?.entry ?? null;
  const hasAds = (creative?.ads.length ?? 0) > 0;
  const [editing, setEditing] = useState(!creative);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const blank = () => ({
    name: creative?.name ?? "", kind: entry?.kind ?? "", campaign_label: entry?.campaign_label ?? "", launch_date: entry?.launch_date ?? "",
    headline: entry?.headline ?? "", primary_text: entry?.primary_text ?? "", script: entry?.script ?? "", prompt: entry?.prompt ?? "",
    background_notes: entry?.background_notes ?? "", notes: entry?.notes ?? "", media_url: entry?.media_url ?? "",
  });
  const [form, setForm] = useState(blank);
  const set = (k: keyof ReturnType<typeof blank>, v: string) => setForm(f => ({ ...f, [k]: v }));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !editing) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing, onClose]);

  async function save() {
    setSaving(true); setErr("");
    try {
      const res = await fetch("/api/creative-hub", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: entry?.id, scope, ...form }),
      });
      const json = await res.json();
      if (!res.ok || json.error) { setErr(json.error ?? "Could not save."); return; }
      setEditing(false);
      await onSaved(json.entry.pool_key);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!entry) return;
    if (!window.confirm(hasAds ? "Clear the saved script, prompt and notes for this creative? The ad itself stays." : "Delete this creative?")) return;
    setSaving(true);
    await fetch(`/api/creative-hub?id=${entry.id}`, { method: "DELETE" });
    setSaving(false);
    if (hasAds) await onSaved(creative!.key); else { await onSaved(""); onClose(); }
  }

  const m = creative?.meta ?? null;
  const st = creative ? STATUS[statusOf(creative)] : STATUS.draft;
  const stats: [string, string][] = creative && creative.days > 0 ? [
    ["Spend", fmt$(creative.spend)],
    ["Leads", String(creative.leads)],
    ["Cost / lead", creative.leads ? fmt$(creative.cost_per_lead) : "—"],
    [apptWord, String(creative.appts)],
    [`Cost / ${apptWord.toLowerCase().replace(/s$/, "")}`, creative.appts ? fmt$(creative.cost_per_appt) : "—"],
    ["Shows", String(creative.shows)],
    ["Closes", String(creative.closes)],
    ["Days live", String(creative.days)],
  ] : [];

  return (
    <div className="fixed inset-0 z-50 flex justify-end" style={{ background: "rgba(0,0,0,0.35)" }} onClick={() => { if (!editing) onClose(); }}>
      <div className="h-full w-full md:w-[980px] max-w-full overflow-y-auto" style={{ background: "#ffffff" }} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center gap-3 px-5 py-3 flex-wrap" style={{ background: "#ffffff", borderBottom: "1px solid rgba(0,0,0,0.07)" }}>
          <div className="min-w-0 mr-auto">
            <div className="text-base font-semibold truncate" style={{ color: "#111111" }}>{creative?.name ?? "New creative"}</div>
            {creative && (
              <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                <Chip color={st.color} bg={st.bg}>{st.label}</Chip>
                {creative.kind && <Chip>{creative.kind}</Chip>}
                {entry?.campaign_label && <Chip>{entry.campaign_label}</Chip>}
                <span className="text-[11px]" style={{ color: "#767676" }}>{fmtRange(creative.first, creative.last)}</span>
              </div>
            )}
          </div>
          {editing ? (<>
            {creative && <button onClick={() => { setForm(blank()); setEditing(false); setErr(""); }} className="px-3 py-1.5 rounded-lg text-xs font-semibold" style={{ color: "#4a4a4a", border: "1px solid rgba(0,0,0,0.162)" }}>Cancel</button>}
            <button onClick={save} disabled={saving || !form.name.trim()} className="px-3 py-1.5 rounded-lg text-xs font-semibold" style={{ background: "#000000", color: "#ffffff", opacity: saving || !form.name.trim() ? 0.5 : 1 }}>{saving ? "Saving…" : "Save"}</button>
          </>) : (
            <button onClick={() => setEditing(true)} className="px-3 py-1.5 rounded-lg text-xs font-semibold" style={{ background: "#000000", color: "#ffffff" }}>Edit</button>
          )}
          <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg" style={{ color: "#767676" }}>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className={`p-5 grid grid-cols-1 gap-6 ${creative ? "md:grid-cols-[320px_1fr]" : ""}`}>
          {/* Media + numbers */}
          <div className="space-y-4" style={{ display: creative ? undefined : "none" }}>
            {creative && (
              <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid rgba(0,0,0,0.07)", background: "#f2f2f2" }}>
                {m?.video_url
                  ? <video src={m.video_url} poster={m.image_url ?? m.thumbnail_url ?? undefined} controls playsInline preload="none" className="w-full" style={{ maxHeight: 520, background: "#000000" }} />
                  : m?.image_url || m?.thumbnail_url
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={m.image_url ?? m.thumbnail_url ?? ""} alt={creative.name} referrerPolicy="no-referrer" className="w-full" />
                    : <div className="p-8 text-center text-xs" style={{ color: "#949494" }}>{hasAds ? "No preview available from Facebook for this ad." : "No preview yet — it appears automatically once an ad with this exact name runs."}</div>}
              </div>
            )}
            <div className="flex gap-2 flex-wrap">
              {m?.preview_link && <a href={m.preview_link} target="_blank" rel="noreferrer" className="px-3 py-1.5 rounded-lg text-xs font-semibold" style={{ border: "1px solid rgba(0,0,0,0.162)", color: "#111111" }}>View on Facebook ↗</a>}
              {entry?.media_url && <a href={entry.media_url} target="_blank" rel="noreferrer" className="px-3 py-1.5 rounded-lg text-xs font-semibold" style={{ border: "1px solid rgba(0,0,0,0.162)", color: "#111111" }}>Source file ↗</a>}
            </div>
            {stats.length > 0 && (
              <div className="grid grid-cols-2 gap-2">
                {stats.map(([label, value]) => (
                  <div key={label} className="rounded-xl px-3 py-2" style={{ background: "#f7f7f7" }}>
                    <div className="text-[10px] font-medium" style={{ color: "#767676" }}>{label}</div>
                    <div className="text-sm font-bold" style={{ color: "#111111" }}>{value}</div>
                  </div>
                ))}
              </div>
            )}
            {creative && creative.days > 0 && <div className="text-[10px]" style={{ color: "#b8b8b8" }}>All time, first-touch — same counting as the Creative Leaderboard.</div>}
          </div>

          {/* Copy + our notes */}
          <div className="space-y-5 min-w-0">
            {err && <div className="rounded-xl p-3 text-xs" style={{ background: "rgba(192,57,43,0.08)", color: "#b91c1c" }}>{err}</div>}

            {editing ? (
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="block sm:col-span-2">
                    <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "#949494" }}>Name</span>
                    <input value={form.name} onChange={e => set("name", e.target.value)} disabled={hasAds} placeholder="Exactly as the ad will be named, e.g. UGC 3"
                      className="mt-1 w-full px-3 py-2 rounded-lg text-sm outline-none" style={{ ...INPUT, opacity: hasAds ? 0.6 : 1 }} />
                    <span className="text-[10px]" style={{ color: "#949494" }}>{hasAds ? "Taken from the ad name in Facebook." : "Name the ad exactly this in Facebook and its preview and results attach automatically."}</span>
                  </label>
                  <label className="block">
                    <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "#949494" }}>Type</span>
                    <input value={form.kind} onChange={e => set("kind", e.target.value)} list="creative-kinds" placeholder={creative?.kind ?? "e.g. Talking head"}
                      className="mt-1 w-full px-3 py-2 rounded-lg text-sm outline-none" style={INPUT} />
                    <datalist id="creative-kinds">{KINDS.map(k => <option key={k} value={k} />)}</datalist>
                  </label>
                  <label className="block">
                    <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "#949494" }}>Campaign / batch</span>
                    <input value={form.campaign_label} onChange={e => set("campaign_label", e.target.value)} placeholder="e.g. Campaign V1"
                      className="mt-1 w-full px-3 py-2 rounded-lg text-sm outline-none" style={INPUT} />
                  </label>
                  <label className="block">
                    <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "#949494" }}>Launch date</span>
                    <input type="date" value={form.launch_date} onChange={e => set("launch_date", e.target.value)}
                      className="mt-1 w-full px-3 py-2 rounded-lg text-sm outline-none" style={INPUT} />
                  </label>
                  <label className="block">
                    <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "#949494" }}>Source file link</span>
                    <input value={form.media_url} onChange={e => set("media_url", e.target.value)} placeholder="Drive / Dropbox link"
                      className="mt-1 w-full px-3 py-2 rounded-lg text-sm outline-none" style={INPUT} />
                  </label>
                </div>
                {FORM_FIELDS.map(f => (
                  <label key={f.id} className="block">
                    <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "#949494" }}>{f.label}</span>
                    {f.rows
                      ? <textarea value={form[f.id as keyof typeof form]} onChange={e => set(f.id as keyof typeof form, e.target.value)} rows={f.rows}
                          placeholder={f.id === "primary_text" ? m?.primary_text ?? "" : ""} className="mt-1 w-full px-3 py-2 rounded-lg text-sm outline-none" style={{ ...INPUT, lineHeight: 1.5 }} />
                      : <input value={form[f.id as keyof typeof form]} onChange={e => set(f.id as keyof typeof form, e.target.value)}
                          placeholder={f.id === "headline" ? m?.headline ?? "" : ""} className="mt-1 w-full px-3 py-2 rounded-lg text-sm outline-none" style={INPUT} />}
                    {f.hint && <span className="text-[10px]" style={{ color: "#949494" }}>{f.hint}</span>}
                  </label>
                ))}
                {entry && (
                  <button onClick={remove} disabled={saving} className="text-xs font-semibold" style={{ color: "#b91c1c" }}>
                    {hasAds ? "Clear saved details" : "Delete this creative"}
                  </button>
                )}
              </div>
            ) : creative && (<>
              <TextBlock label="Headline" text={entry?.headline ?? m?.headline ?? null} source={entry?.headline ? undefined : "from Facebook"} onAdd={() => setEditing(true)} />
              <TextBlock label="Primary text" text={entry?.primary_text ?? m?.primary_text ?? null} source={entry?.primary_text ? undefined : "from Facebook"} onAdd={() => setEditing(true)} />
              <TextBlock label="Script" text={entry?.script ?? null} onAdd={() => setEditing(true)} />
              <TextBlock label="Prompt" text={entry?.prompt ?? null} onAdd={() => setEditing(true)} />
              <TextBlock label="Background" text={entry?.background_notes ?? null} onAdd={() => setEditing(true)} />
              <TextBlock label="Notes" text={entry?.notes ?? null} onAdd={() => setEditing(true)} />

              {creative.ads.length > 0 && (
                <section>
                  <h3 className="text-[10px] font-bold uppercase tracking-widest mb-1.5" style={{ color: "#949494" }}>Where it ran</h3>
                  <div className="rounded-xl overflow-x-auto" style={{ border: "1px solid rgba(0,0,0,0.07)" }}>
                    <table className="w-full text-xs" style={{ borderCollapse: "collapse", minWidth: 520 }}>
                      <thead style={{ background: "#f7f7f7" }}>
                        <tr>
                          {[scope === "b2c" ? "Client" : null, "Campaign", "Ad set", "Ran", "Spend"].filter(Boolean).map(h => (
                            <th key={h} className="text-left px-3 py-2 text-[10px] font-bold uppercase tracking-wider" style={{ color: "#6b6b6b" }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {creative.ads.map(a => (
                          <tr key={a.ad_id} style={{ borderTop: "1px solid rgba(0,0,0,0.05)" }}>
                            {scope === "b2c" && <td className="px-3 py-2" style={{ color: "#111111" }}>{a.client_name}</td>}
                            <td className="px-3 py-2" style={{ color: "#4a4a4a" }}>{a.campaign_name || "—"}</td>
                            <td className="px-3 py-2" style={{ color: "#4a4a4a" }}>{a.adset_name || "—"}</td>
                            <td className="px-3 py-2 whitespace-nowrap" style={{ color: "#4a4a4a" }}>{fmtRange(a.first, a.last)}</td>
                            <td className="px-3 py-2 whitespace-nowrap" style={{ color: "#111111" }}>{fmt$(a.spend)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {creative.names.length > 1 && <div className="text-[10px] mt-1.5" style={{ color: "#949494" }}>Also named: {creative.names.slice(1).join(", ")}</div>}
                </section>
              )}
            </>)}
          </div>
        </div>
      </div>
    </div>
  );
}
