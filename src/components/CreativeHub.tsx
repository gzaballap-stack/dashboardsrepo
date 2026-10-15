"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

// Creative & Copy Hub — the library and the timeline. One record per creative,
// named exactly as the ad is named, so everything here lines up with the
// creative leaderboard. Media is shown straight from Meta; only text is ours.

type Scope = "b2b" | "b2c";
type Run = { start: string; end: string };

type Entry = {
  id: string; name: string; code: string | null; category: string | null; folder_id: string | null; seq: number | null;
  copy_set_id: string | null; tags: string | null; kind: string | null; campaign_label: string | null; launch_date: string | null;
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

type Folder = { id: string; category: string; name: string; slug: string };
type CopySetRef = { id: string; name: string; campaign_label: string | null };
type CopySetFull = CopySetRef & { bodies: string[]; headlines: string[]; descriptions: string[] };
type Category = { code: string; label: string };

type Creative = {
  key: string; code: string | null; name: string; names: string[]; entry: Entry | null; kind: string | null;
  category: string | null; folder_id: string | null; seq: number | null;
  fb_name: string; names_match: boolean;
  copy_set: CopySetFull | null; suggested_copy_set_id: string | null;
  first: string | null; last: string | null; days: number; runs: Run[]; live: boolean;
  spend: number; meta_leads: number; leads: number; appts: number; shows: number; closes: number;
  cost_per_lead: number; cost_per_appt: number;
  clients: { id: string; name: string }[]; ads: AdRun[]; meta: Meta | null;
};

type Campaign = {
  campaign_id: string; name: string; client_name: string; spend: number;
  first: string | null; last: string | null; runs: Run[];
  creatives: { key: string; name: string; spend: number; runs: Run[] }[];
};

type HubData = {
  today: string; creatives: Creative[]; campaigns: Campaign[]; folders: Folder[]; categories: Category[];
  copy_sets: CopySetRef[]; can_rename: boolean; meta_error: string | null;
};

const UNFILED = "__unfiled__";

async function postJson(url: string, body: unknown, method = "POST") {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) throw new Error(json.error ?? `Request failed (${res.status})`);
  return json;
}

// What a "new folder" request needs to know; the modal below does the asking.
type FolderAsk = { category: string; hasFolders: boolean; rootCount: number; onDone: (f: Folder) => void | Promise<void> };

// The in-app dialog for naming a new folder. When the category already holds
// creatives at its root and this is its first folder, it offers to move them
// all in — a category either has folders or it doesn't.
// The folder's name in the breadcrumb: click it to edit in place. The code
// part stays, so renaming never renumbers anything.
function FolderName({ folder, count, onChanged }: { folder: Folder; count: number; onChanged: (deleted: boolean) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(folder.name);
  const [busy, setBusy] = useState(false);
  async function save() {
    const v = name.trim();
    setEditing(false);
    if (!v || v === folder.name) { setName(folder.name); return; }
    setBusy(true);
    try { await postJson("/api/creative-hub/folders", { id: folder.id, name: v }, "PATCH"); await onChanged(false); }
    catch { setName(folder.name); }
    finally { setBusy(false); }
  }
  async function remove() {
    setBusy(true);
    try { const r = await fetch(`/api/creative-hub/folders?id=${folder.id}`, { method: "DELETE" }); if (r.ok) await onChanged(true); }
    finally { setBusy(false); }
  }
  if (editing) {
    return (
      <input autoFocus value={name} onChange={e => setName(e.target.value)} onBlur={save}
        onKeyDown={e => { if (e.key === "Enter") save(); if (e.key === "Escape") { setName(folder.name); setEditing(false); } }}
        className="px-2 py-0.5 rounded-md text-sm font-semibold outline-none" style={{ ...INPUT, minWidth: 160 }} />
    );
  }
  return (
    <span className="flex items-center gap-2">
      <button onClick={() => setEditing(true)} className="font-semibold rounded-md px-1 -mx-1" style={{ color: "#111111", opacity: busy ? 0.5 : 1 }} title="Click to rename">{name}</button>
      {count === 0 && <button onClick={remove} disabled={busy} className="text-[10px] font-semibold" style={{ color: "#b91c1c" }} title="This folder is empty">Delete</button>}
    </span>
  );
}

function NewFolderModal({ ask, scope, categoryLabel, onClose }: { ask: FolderAsk; scope: Scope; categoryLabel: string; onClose: () => void }) {
  const [name, setName] = useState("");
  const [moveRoot, setMoveRoot] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const offerMove = !ask.hasFolders && ask.rootCount > 0;
  const slug = name.toUpperCase().replace(/[^A-Z0-9]+/g, " ").trim().split(" ")[0]?.slice(0, 12) ?? "";

  async function create() {
    if (!name.trim()) return;
    setBusy(true); setErr("");
    try {
      const json = await postJson("/api/creative-hub/folders", { scope, category: ask.category, name: name.trim(), move_root: offerMove && moveRoot });
      await ask.onDone(json.folder as Folder);
      onClose();
    } catch (e) { setErr((e as Error).message); setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.4)" }} onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl p-5 space-y-4" style={{ ...CARD, boxShadow: "0 24px 60px -12px rgba(0,0,0,0.35)" }} onClick={e => e.stopPropagation()}>
        <div>
          <div className="text-base font-semibold" style={{ color: "#111111" }}>New folder in {categoryLabel}</div>
          <div className="text-xs mt-0.5" style={{ color: "#767676" }}>A style, an angle or a batch — whatever you&apos;d group creatives by.</div>
        </div>
        <label className="block">
          <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "#949494" }}>Folder name</span>
          <input autoFocus value={name} onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === "Enter") create(); if (e.key === "Escape") onClose(); }}
            placeholder="e.g. Slop, Realistic, Billboard" className="mt-1 w-full px-3 py-2 rounded-lg text-sm outline-none" style={INPUT} />
          <span className="text-[10px]" style={{ color: "#949494" }}>
            {slug ? <>Codes in it will look like <b>{ask.category}/{slug}/001</b>. The first word becomes the code and can&apos;t change later; the name can.</> : "The first word of the name goes into the code."}
          </span>
        </label>
        {offerMove && (
          <label className="flex items-start gap-2 text-xs" style={{ color: "#111111" }}>
            <input type="checkbox" checked={moveRoot} onChange={e => setMoveRoot(e.target.checked)} className="mt-0.5" />
            <span>Move the {ask.rootCount} creative{ask.rootCount === 1 ? "" : "s"} already in {categoryLabel} into this folder (they get new numbers). A category either has folders or it doesn&apos;t.</span>
          </label>
        )}
        {err && <div className="text-xs" style={{ color: "#b91c1c" }}>{err}</div>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-3 py-1.5 rounded-lg text-xs font-semibold" style={{ color: "#4a4a4a", border: "1px solid rgba(0,0,0,0.162)" }}>Cancel</button>
          <button onClick={create} disabled={busy || !name.trim()} className="px-3 py-1.5 rounded-lg text-xs font-semibold" style={{ background: "#000000", color: "#ffffff", opacity: busy || !name.trim() ? 0.5 : 1 }}>{busy ? "Creating…" : "Create folder"}</button>
        </div>
      </div>
    </div>
  );
}

// Names the ads currently have in Meta, so a rename only touches wrong ones.
const currentNames = (c: Creative | null) => Object.fromEntries((c?.ads ?? []).map(a => [a.ad_id, a.ad_name]));

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
// An ad can be set up in Facebook and still not have served a single impression.
const ranLabel = (c: Creative) => (c.first ? fmtRange(c.first, c.last) : c.ads.length ? "No delivery yet" : "Not launched");

const isVideo = (c: Creative) => c.meta?.format === "Video" || /video|head|ugc|voice/i.test(c.kind ?? "");
const statusOf = (c: Creative) => (c.live ? "live" : c.ads.length > 0 ? "off" : "draft");
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

// A folder box, Airbnb-wishlist style: the first four pictures inside it as a
// 2×2 collage, then the name and how many creatives it holds.
// Click-to-edit text: shows as plain text, turns into a box on click, saves on
// Enter or when you click away, Esc cancels.
function InlineEdit({ value, onSave, className = "", style, inputStyle, title, prefix, suffix }: {
  value: string; onSave: (v: string) => Promise<void>; className?: string; style?: React.CSSProperties;
  inputStyle?: React.CSSProperties; title?: string; prefix?: string; suffix?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(value);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  async function save() {
    setEditing(false);
    const next = v.trim();
    if (!next || next === value) { setV(value); return; }
    setBusy(true); setErr("");
    try { await onSave(next); } catch (e) { setErr((e as Error).message); setV(value); } finally { setBusy(false); }
  }
  if (editing) {
    return (
      <span className="inline-flex items-center gap-0.5">
        {prefix && <span className={className} style={style}>{prefix}</span>}
        <input autoFocus value={v} onChange={e => setV(e.target.value)} onBlur={save} onClick={e => e.stopPropagation()}
          onKeyDown={e => { if (e.key === "Enter") save(); if (e.key === "Escape") { setV(value); setEditing(false); } }}
          className={`px-1.5 py-0.5 rounded-md outline-none ${className}`} style={{ ...INPUT, ...style, ...inputStyle }} />
        {suffix && <span className={className} style={style}>{suffix}</span>}
      </span>
    );
  }
  return (
    <span className="inline-flex flex-col">
      <button onClick={e => { e.stopPropagation(); setV(value); setEditing(true); }} title={title ?? "Click to edit"}
        className={`text-left rounded-md px-1 -mx-1 hover:bg-black/5 ${className}`} style={{ ...style, opacity: busy ? 0.5 : 1 }}>
        {prefix}{value}{suffix}
      </button>
      {err && <span className="text-[10px]" style={{ color: "#b91c1c" }}>{err}</span>}
    </span>
  );
}

function FolderBox({ label, sub, items, onClick, dashed, edit }: {
  label: string; sub: string; items: Creative[]; onClick: () => void; dashed?: boolean;
  // A real folder: its name and code can be edited right on the box.
  edit?: { category: string; slug: string; onRename: (v: string) => Promise<void>; onRecode: (v: string) => Promise<void> };
}) {
  // Creatives that have a picture first, so the box isn't four grey tiles.
  const pics = [...items].sort((a, b) => Number(!!(b.meta?.thumbnail_url || b.meta?.image_url)) - Number(!!(a.meta?.thumbnail_url || a.meta?.image_url))).slice(0, 4);
  if (edit) {
    return (
      <div className="text-left group">
        <button onClick={onClick} className="block w-full" title="Open folder">
          <div className="grid grid-cols-2 rounded-2xl overflow-hidden aspect-square transition-transform duration-150 group-hover:-translate-y-0.5"
            style={{ gap: 2, background: "#ffffff", border: "1px solid rgba(0,0,0,0.07)", boxShadow: CARD.boxShadow }}>
            {[0, 1, 2, 3].map(i => pics[i]
              ? <Thumb key={pics[i].key} c={pics[i]} className="w-full h-full" />
              : <div key={i} style={{ background: "#9a9a9a" }} />)}
          </div>
        </button>
        <div className="mt-2">
          <InlineEdit value={label} onSave={edit.onRename} title="Click to rename" className="text-sm font-semibold" style={{ color: "#111111" }} inputStyle={{ width: "100%" }} />
        </div>
        <div className="text-xs flex items-center gap-1 flex-wrap" style={{ color: "#767676" }}>
          <span>{sub}</span><span>·</span>
          <InlineEdit value={edit.slug} onSave={edit.onRecode} title="Click to change the code" prefix={`${edit.category}/`}
            className="text-xs font-semibold" style={{ color: "#4a4a4a" }} inputStyle={{ width: 90, textTransform: "uppercase" }} />
        </div>
      </div>
    );
  }
  return (
    <button onClick={onClick} className="text-left group">
      <div className="grid grid-cols-2 rounded-2xl overflow-hidden aspect-square transition-transform duration-150 group-hover:-translate-y-0.5"
        style={{ gap: 2, background: "#ffffff", border: dashed ? "2px dashed rgba(0,0,0,0.2)" : "1px solid rgba(0,0,0,0.07)", boxShadow: dashed ? "none" : CARD.boxShadow }}>
        {dashed
          ? <div className="col-span-2 flex items-center justify-center text-3xl font-light" style={{ color: "#949494" }}>+</div>
          : [0, 1, 2, 3].map(i => pics[i]
            ? <Thumb key={pics[i].key} c={pics[i]} className="w-full h-full" />
            : <div key={i} style={{ background: "#9a9a9a" }} />)}
      </div>
      <div className="mt-2 text-sm font-semibold" style={{ color: "#111111" }}>{label}</div>
      <div className="text-xs" style={{ color: "#767676" }}>{sub}</div>
    </button>
  );
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
  const [view, setView] = useState<"folders" | "all" | "live" | "off" | "draft">("folders");
  const [cat, setCat] = useState<string>("");            // folders view: "" = the top level (category boxes), a category code, or UNFILED
  const [folderSel, setFolderSel] = useState<string>(""); // folders view: "" = whole category, "root" = no folder, else folder id
  const [sort, setSort] = useState<"code" | "recent" | "spend" | "cost">("code");
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [fileTo, setFileTo] = useState<{ category: string; folder_id: string }>({ category: "", folder_id: "" });
  const [copySetTo, setCopySetTo] = useState("");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [folderAsk, setFolderAsk] = useState<FolderAsk | null>(null);

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

  const categories = data?.categories ?? [];
  const folders = data?.folders ?? [];
  const inCat = (code: string) => (data?.creatives ?? []).filter(c => (c.category ?? UNFILED) === code);
  const countIn = (code: string) => inCat(code).length;
  const activeCat = cat;
  const catFolders = folders.filter(f => f.category === activeCat);
  const rootItems = (data?.creatives ?? []).filter(c => c.category === activeCat && !c.folder_id);
  const rootCount = rootItems.length;
  const q = search.trim().toLowerCase();
  // Where the folders view is: the category boxes, a category's folder boxes,
  // or a grid of creatives. A search cuts straight to a grid of everything.
  const level: "categories" | "folders" | "grid" =
    view !== "folders" || q ? "grid"
    : !cat ? "categories"
    : !folderSel && catFolders.length > 0 ? "folders"
    : "grid";

  const shown = useMemo(() => {
    const list = (data?.creatives ?? []).filter(c => {
      if (view === "folders" && !q) {
        if ((c.category ?? UNFILED) !== activeCat) return false;
        if (folderSel === "root" && c.folder_id) return false;
        if (folderSel && folderSel !== "root" && c.folder_id !== folderSel) return false;
      } else if (view !== "all" && statusOf(c) !== view) return false;
      if (!q) return true;
      const hay = [c.code, c.name, ...c.names, c.kind, c.entry?.tags, c.entry?.campaign_label, c.entry?.script, c.entry?.prompt, c.entry?.notes,
        c.copy_set?.name, ...(c.copy_set?.headlines ?? []), ...(c.copy_set?.bodies ?? []), c.meta?.headline, c.meta?.primary_text,
        ...c.ads.map(a => a.campaign_name), ...c.clients.map(cl => cl.name)];
      return hay.some(h => h?.toLowerCase().includes(q));
    });
    if (sort === "code") list.sort((a, b) => (a.code ?? "\uffff").localeCompare(b.code ?? "\uffff") || b.spend - a.spend);
    if (sort === "spend") list.sort((a, b) => b.spend - a.spend);
    if (sort === "cost") list.sort((a, b) => (a.appts > 0 ? a.cost_per_appt : Infinity) - (b.appts > 0 ? b.cost_per_appt : Infinity) || b.spend - a.spend);
    return list;
  }, [data, q, view, activeCat, folderSel, sort]);

  const open = openKey ? data?.creatives.find(c => c.key === openKey) ?? null : null;

  const toggle = (key: string) => setSelected(prev => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n; });

  // File every selected creative into the chosen category / folder. Creatives
  // that only exist as an ad name get a record first.
  // Attach one copy set to every selected creative.
  async function attachCopySet() {
    if (!data || !copySetTo) return;
    setBusy("Attaching…"); setNotice("");
    try {
      const picked = data.creatives.filter(c => selected.has(c.key));
      await postJson("/api/creative-hub", { scope, copy_set_id: copySetTo, assign: picked.map(c => (c.entry ? { id: c.entry.id } : { name: c.name })) });
      setSelected(new Set());
      await load();
    } catch (e) { setNotice((e as Error).message); } finally { setBusy(""); }
  }

  async function fileSelected() {
    if (!data || !fileTo.category) return;
    setBusy("Filing…"); setNotice("");
    try {
      const picked = data.creatives.filter(c => selected.has(c.key));
      const names: Record<string, string> = {};
      for (const c of picked) for (const a of c.ads) names[a.ad_id] = a.ad_name;
      const json = await postJson("/api/creative-hub", {
        scope, category: fileTo.category, folder_id: fileTo.folder_id || null, current_names: names,
        assign: picked.map(c => (c.entry ? { id: c.entry.id } : { name: c.name })),
      });
      setSelected(new Set());
      const renamed = (json.renamed ?? []) as { ok: boolean }[];
      if (renamed.length) setNotice(`${renamed.filter(r => r.ok).length} ad name${renamed.filter(r => r.ok).length === 1 ? "" : "s"} updated in Facebook${renamed.some(r => !r.ok) ? `, ${renamed.filter(r => !r.ok).length} failed` : ""}.`);
      await load();
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setBusy("");
    }
  }

  function newFolder() {
    if (activeCat === UNFILED) return;
    setFolderAsk({ category: activeCat, hasFolders: catFolders.length > 0, rootCount, onDone: async f => { await load(); setFolderSel(f.id); } });
  }

  async function renameAll() {
    if (!data) return;
    setBusy("Renaming…"); setNotice("");
    try {
      const names: Record<string, string> = {};
      for (const c of data.creatives) for (const a of c.ads) names[a.ad_id] = a.ad_name;
      const json = await postJson("/api/creative-hub/push-names", { scope, current_names: names });
      setNotice(`${json.renamed} ad name${json.renamed === 1 ? "" : "s"} updated in Facebook${json.failed ? `, ${json.failed} failed` : ""}.`);
      await load();
    } catch (e) { setNotice((e as Error).message); } finally { setBusy(""); }
  }

  const needsRename = (data?.creatives ?? []).filter(c => c.code && !c.names_match).length;
  const chip = (active: boolean) => ({ background: active ? "rgba(0,0,0,0.09)" : "#f7f7f7", color: active ? "#111111" : "#6b6b6b" });

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
          <div className="flex rounded-lg overflow-hidden" style={{ border: "1px solid rgba(0,0,0,0.162)" }}>
            {(["folders", "all", "live", "off", "draft"] as const).map(v => (
              <button key={v} onClick={() => { setView(v); setSelected(new Set()); }} className="px-3 py-1.5 text-xs font-semibold" style={chip(view === v)}>
                {v === "folders" ? "Folders" : v === "all" ? "All" : STATUS[v].label}
              </button>
            ))}
          </div>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search code, name, copy, script, tags…"
            className="px-3 py-1.5 rounded-lg text-xs outline-none w-56" style={INPUT} />
          <select value={sort} onChange={e => setSort(e.target.value as typeof sort)} className="px-3 py-1.5 rounded-lg text-xs font-medium outline-none" style={INPUT}>
            <option value="code">By code</option>
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

      {/* Folders: breadcrumb, then boxes (categories → folders) or the grid */}
      {data && tab === "library" && view === "folders" && !q && (
        <div className="flex items-center gap-2 flex-wrap text-sm">
          <button onClick={() => { setCat(""); setFolderSel(""); setSelected(new Set()); }} className="font-semibold" style={{ color: cat ? "#767676" : "#111111" }}>Folders</button>
          {cat && (<>
            <span style={{ color: "#c2c2c2" }}>›</span>
            <button onClick={() => { setFolderSel(""); setSelected(new Set()); }} className="font-semibold" style={{ color: folderSel ? "#767676" : "#111111" }}>
              {cat === UNFILED ? "Uncategorised" : categories.find(c => c.code === cat)?.label ?? cat}
            </button>
          </>)}
          {folderSel && (<>
            <span style={{ color: "#c2c2c2" }}>›</span>
            {folderSel === "root" || !folders.some(f => f.id === folderSel)
              ? <span className="font-semibold" style={{ color: "#111111" }}>Needs a folder</span>
              : <FolderName key={folderSel} folder={folders.find(f => f.id === folderSel)!} count={(data?.creatives ?? []).filter(c => c.folder_id === folderSel).length}
                  onChanged={async deleted => { await load(); if (deleted) setFolderSel(""); }} />}
          </>)}
          {cat && cat !== UNFILED && (
            <button onClick={newFolder} className="px-2.5 py-1 rounded-md text-xs font-semibold" style={{ color: "#111111", border: "1px dashed rgba(0,0,0,0.25)" }}>+ New folder</button>
          )}
          {cat && cat !== UNFILED && (
            <span className="text-[10px] ml-auto" style={{ color: "#949494" }}>
              Codes here look like <b>{cat}{folderSel && folderSel !== "root" ? `/${folders.find(f => f.id === folderSel)?.slug}` : catFolders.length ? `/${catFolders[0].slug}` : ""}/001</b>
            </span>
          )}
          {cat === UNFILED && countIn(UNFILED) > 0 && (
            <span className="text-xs ml-auto" style={{ color: "#6b6b6b" }}>Tick creatives and file them into a category — that gives each one its code.</span>
          )}
        </div>
      )}

      {data && tab === "library" && level === "categories" && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-6">
          {[...categories, { code: UNFILED, label: "Uncategorised" }].filter(c => c.code !== UNFILED || countIn(UNFILED) > 0).map(c => {
            const items = inCat(c.code);
            const n = items.length;
            return (
              <FolderBox key={c.code} label={c.label} items={items}
                sub={n === 0 ? "Empty" : `${n} creative${n === 1 ? "" : "s"}${folders.some(f => f.category === c.code) ? ` · ${folders.filter(f => f.category === c.code).length} folders` : ""}`}
                onClick={() => { setCat(c.code); setFolderSel(""); setSelected(new Set()); }} />
            );
          })}
        </div>
      )}

      {data && tab === "library" && level === "folders" && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-6">
          {catFolders.map(f => {
            const items = (data.creatives ?? []).filter(c => c.folder_id === f.id);
            return (
              <FolderBox key={f.id} label={f.name} items={items} sub={`${items.length} creative${items.length === 1 ? "" : "s"}`}
                onClick={() => { setFolderSel(f.id); setSelected(new Set()); }}
                edit={{
                  category: cat, slug: f.slug,
                  onRename: async name => { await postJson("/api/creative-hub/folders", { id: f.id, name }, "PATCH"); await load(); },
                  onRecode: async code => {
                    const j = await postJson("/api/creative-hub/folders", { id: f.id, code }, "PATCH");
                    await load();
                    if (j.recoded) setNotice(`${j.recoded} creative${j.recoded === 1 ? "" : "s"} recoded to ${cat}/${j.folder.slug}/…`);
                  },
                }} />
            );
          })}
          {rootCount > 0 && (
            <FolderBox label="Needs a folder" items={rootItems} sub={`${rootCount} not in a folder yet`} onClick={() => { setFolderSel("root"); setSelected(new Set()); }} />
          )}
          <FolderBox label="New folder" sub="" items={[]} dashed onClick={newFolder} />
        </div>
      )}

      {error && (
        <div className="rounded-2xl p-4 text-sm" style={{ background: "rgba(192,57,43,0.08)", border: "1px solid rgba(192,57,43,0.2)", color: "#b91c1c" }}>{error}</div>
      )}
      {notice && (
        <div className="rounded-2xl p-3 text-xs flex items-center gap-3" style={{ ...CARD, color: "#111111" }}>
          {notice}<button onClick={() => setNotice("")} className="ml-auto text-[10px] font-semibold" style={{ color: "#949494" }}>Dismiss</button>
        </div>
      )}
      {data?.meta_error && (
        <div className="rounded-2xl p-3 text-xs" style={{ ...CARD, color: "#92400e" }}>
          Facebook previews are unavailable right now ({data.meta_error}). Everything else is up to date.
        </div>
      )}
      {data && tab === "library" && needsRename > 0 && (
        <div className="rounded-2xl p-3 text-xs flex items-center gap-3 flex-wrap" style={{ ...CARD, color: "#4a4a4a" }}>
          {needsRename} ad{needsRename === 1 ? " is" : "s are"} still named the old way in Facebook.
          {data.can_rename
            ? <button onClick={renameAll} disabled={!!busy} className="px-2.5 py-1 rounded-md text-xs font-semibold" style={{ background: "#000000", color: "#ffffff", opacity: busy ? 0.6 : 1 }}>{busy || "Rename them in Facebook"}</button>
            : <span style={{ color: "#949494" }}>Open each one and copy its Facebook name into Ads Manager — automatic renaming needs a Facebook token that can edit ads.</span>}
        </div>
      )}

      {loading && !data && <div className="rounded-2xl p-8 text-center text-sm" style={{ ...CARD, color: "#6b6b6b" }}>Loading creatives…</div>}

      {data && tab === "library" && level === "grid" && (
        shown.length === 0 ? (
          <div className="rounded-2xl p-8 text-center text-sm" style={{ ...CARD, color: "#6b6b6b" }}>
            {data.creatives.length === 0 ? "No creatives yet. Ads appear here automatically once they run — or add one with “New creative”."
              : view === "folders" ? "Nothing filed here yet." : "Nothing matches these filters."}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4" style={{ opacity: loading ? 0.6 : 1 }}>
            {shown.map(c => {
              const st = STATUS[statusOf(c)];
              const isSel = selected.has(c.key);
              return (
                <div key={c.key} className="relative rounded-2xl overflow-hidden transition-transform duration-150 hover:-translate-y-0.5" style={{ ...CARD, outline: isSel ? "2px solid #111111" : "none" }}>
                  <button onClick={() => setOpenKey(c.key)} className="text-left w-full">
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
                      <div className="flex items-center gap-1.5 min-w-0">
                        {c.code
                          ? <span className="text-[10px] font-bold px-1.5 py-0.5 rounded flex-shrink-0" style={{ background: "#111111", color: "#ffffff", letterSpacing: "0.02em" }}>{c.code}</span>
                          : <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded flex-shrink-0" style={{ background: "rgba(217,119,6,0.12)", color: "#92400e" }}>No code</span>}
                        {c.code && !c.names_match && <span title="Facebook still has the old name" className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: "#d97706" }} />}
                      </div>
                      <div className="text-sm font-semibold truncate" style={{ color: "#111111" }} title={c.name}>{c.name}</div>
                      <div className="text-[11px] truncate" style={{ color: "#767676" }}>
                        {[c.kind, ranLabel(c)].filter(Boolean).join(" · ")}
                      </div>
                      {c.copy_set && <div className="text-[10px] truncate" style={{ color: "#4a4a4a" }} title={c.copy_set.name}>✎ {c.copy_set.name}</div>}
                      {c.days > 0 && (
                        <div className="text-[11px]" style={{ color: "#4a4a4a" }}>
                          {fmt$(c.spend)} · {c.leads} leads · {c.appts} {apptWord.toLowerCase()}
                          {c.meta_leads > 0 && <span style={{ color: "#949494" }}> · {c.meta_leads} on FB</span>}
                          {scope === "b2c" && c.clients.length > 1 && <span style={{ color: "#949494" }}> · {c.clients.length} clients</span>}
                        </div>
                      )}
                      <div className="flex gap-1 flex-wrap pt-0.5">
                        {(c.entry?.tags ?? "").split(",").map(t => t.trim()).filter(Boolean).slice(0, 4).map(t => <Chip key={t}>{t}</Chip>)}
                        {OUR_FIELDS.filter(f => c.entry?.[f.id]).map(f => <Chip key={f.id} color="#6b6b6b" bg="transparent">{f.label} ✓</Chip>)}
                        {!OUR_FIELDS.some(f => c.entry?.[f.id]) && !c.entry?.tags && <span className="text-[10px]" style={{ color: "#b8b8b8" }}>No script or prompt yet</span>}
                      </div>
                    </div>
                  </button>
                  {/* Select for bulk filing */}
                  <button onClick={e => { e.stopPropagation(); toggle(c.key); }} aria-label={isSel ? "Unselect" : "Select"}
                    className="absolute top-2 right-2 w-6 h-6 rounded-md flex items-center justify-center"
                    style={{ background: isSel ? "#111111" : "rgba(255,255,255,0.92)", border: "1px solid rgba(0,0,0,0.2)", color: "#ffffff" }}>
                    {isSel && <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={3} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
                  </button>
                </div>
              );
            })}
          </div>
        )
      )}

      {/* Bulk filing bar */}
      {data && selected.size > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 rounded-2xl px-4 py-3 flex items-center gap-3 flex-wrap" style={{ ...CARD, boxShadow: "0 12px 40px -8px rgba(0,0,0,0.3)", maxWidth: "calc(100vw - 32px)" }}>
          <span className="text-xs font-semibold" style={{ color: "#111111" }}>{selected.size} selected</span>
          <span className="text-xs" style={{ color: "#6b6b6b" }}>File in</span>
          <select value={fileTo.category} onChange={e => setFileTo({ category: e.target.value, folder_id: "" })} className="px-2.5 py-1.5 rounded-lg text-xs font-medium outline-none" style={INPUT}>
            <option value="">Category…</option>
            {categories.map(c => <option key={c.code} value={c.code}>{c.label} ({c.code})</option>)}
          </select>
          {fileTo.category && folders.some(f => f.category === fileTo.category) && (
            <select value={fileTo.folder_id} onChange={e => setFileTo(ft => ({ ...ft, folder_id: e.target.value }))} className="px-2.5 py-1.5 rounded-lg text-xs font-medium outline-none" style={INPUT}>
              <option value="">Folder…</option>
              {folders.filter(f => f.category === fileTo.category).map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          )}
          <button onClick={fileSelected} disabled={!!busy || !fileTo.category || (folders.some(f => f.category === fileTo.category) && !fileTo.folder_id)}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold" style={{ background: "#000000", color: "#ffffff", opacity: busy || !fileTo.category || (folders.some(f => f.category === fileTo.category) && !fileTo.folder_id) ? 0.5 : 1 }}>
            {busy || "Apply"}
          </button>
          {(data.copy_sets ?? []).length > 0 && (<>
            <span style={{ color: "#e0e0e0" }}>|</span>
            <span className="text-xs" style={{ color: "#6b6b6b" }}>Copy set</span>
            <select value={copySetTo} onChange={e => setCopySetTo(e.target.value)} className="px-2.5 py-1.5 rounded-lg text-xs font-medium outline-none max-w-[200px]" style={INPUT}>
              <option value="">Choose…</option>
              {data.copy_sets.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <button onClick={attachCopySet} disabled={!!busy || !copySetTo} className="px-3 py-1.5 rounded-lg text-xs font-semibold" style={{ background: "#000000", color: "#ffffff", opacity: busy || !copySetTo ? 0.5 : 1 }}>Attach</button>
          </>)}
          <button onClick={() => setSelected(new Set())} className="text-xs font-semibold" style={{ color: "#767676" }}>Clear</button>
        </div>
      )}

      {data && tab === "timeline" && (
        <Timeline data={data} scope={scope} showClient={scope === "b2c" && !clientId} onOpen={setOpenKey} />
      )}

      {(open || creating) && data && (
        <Drawer
          key={open?.key ?? "new"}
          creative={open}
          scope={scope}
          apptWord={apptWord}
          folders={folders}
          categories={categories}
          copySets={data.copy_sets ?? []}
          canRename={data.can_rename}
          defaultCategory={view === "folders" && activeCat && activeCat !== UNFILED ? activeCat : ""}
          defaultFolder={view === "folders" && folderSel && folderSel !== "root" ? folderSel : ""}
          onFoldersChanged={load}
          onAskFolder={setFolderAsk}
          onClose={() => { setOpenKey(null); setCreating(false); }}
          onSaved={async key => { setCreating(false); await load(); setOpenKey(key); }}
          onNotice={setNotice}
        />
      )}

      {folderAsk && (
        <NewFolderModal ask={folderAsk} scope={scope} categoryLabel={categories.find(c => c.code === folderAsk.category)?.label ?? folderAsk.category} onClose={() => setFolderAsk(null)} />
      )}
    </div>
  );
}

// ── Timeline ────────────────────────────────────────────────────────────────

type TRow = { id: string; label: string; sub?: string; runs: Run[]; spend: number; live: boolean; marker?: string | null;
  entryId?: string | null; campaignId?: string | null;
  indent?: boolean; onClick?: () => void; toggle?: boolean; openState?: boolean };

// One line in the change log: what was done to the ads, when, and to what.
type Change = { id: string; happened_on: string; note: string; entry_id: string | null; campaign_id: string | null };

function Timeline({ data, scope, showClient, onOpen }: {
  data: HubData; scope: Scope; showClient: boolean; onOpen: (key: string) => void;
}) {
  const [mode, setMode] = useState<"campaign" | "creative">("campaign");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [changes, setChanges] = useState<Change[]>([]);
  const loadChanges = useCallback(() =>
    fetch(`/api/creative-hub/changes?scope=${scope}`).then(r => r.json()).then(j => { if (j.changes) setChanges(j.changes); }).catch(() => {}),
  [scope]);
  useEffect(() => { loadChanges(); }, [loadChanges]);
  const todayN = dayNum(data.today);
  const entryIdOf = (key: string) => data.creatives.find(c => c.key === key)?.entry?.id ?? null;
  const isLive = (runs: Run[]) => runs.length > 0 && todayN - dayNum(runs[runs.length - 1].end) <= 2;

  const rows: TRow[] = useMemo(() => {
    if (mode === "creative") {
      return data.creatives
        .filter(c => c.runs.length || c.entry?.launch_date)
        .sort((a, b) => (a.first ?? a.entry?.launch_date ?? "").localeCompare(b.first ?? b.entry?.launch_date ?? ""))
        .map(c => ({ id: c.key, label: c.name, sub: c.kind ?? undefined, runs: c.runs, spend: c.spend, live: c.live,
          marker: c.entry?.launch_date, entryId: c.entry?.id ?? null, onClick: () => onOpen(c.key) }));
    }
    return data.campaigns.flatMap(c => {
      const isOpen = expanded.has(c.campaign_id);
      // Across clients the campaigns are all named alike, so the client leads.
      const head: TRow = { id: c.campaign_id, label: showClient ? c.client_name : c.name,
        sub: showClient ? c.name : `${c.creatives.length} creative${c.creatives.length === 1 ? "" : "s"}`,
        runs: c.runs, spend: c.spend, live: isLive(c.runs), toggle: true, openState: isOpen, campaignId: c.campaign_id,
        onClick: () => setExpanded(prev => { const n = new Set(prev); if (n.has(c.campaign_id)) n.delete(c.campaign_id); else n.add(c.campaign_id); return n; }) };
      const kids: TRow[] = isOpen ? c.creatives.map(cc => ({ id: `${c.campaign_id}:${cc.key}`, label: cc.name, runs: cc.runs, spend: cc.spend,
        live: isLive(cc.runs), indent: true, entryId: entryIdOf(cc.key), onClick: () => onOpen(cc.key) })) : [];
      return [head, ...kids];
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, mode, expanded, showClient]);

  const starts = [...rows.flatMap(r => [r.runs[0]?.start, r.marker]), ...changes.map(ch => ch.happened_on)].filter((d): d is string => !!d).map(dayNum);
  if (!starts.length) {
    return (
      <div className="space-y-3">
        <div className="rounded-2xl p-8 text-center text-sm" style={{ ...CARD, color: "#6b6b6b" }}>Nothing has run yet — the timeline fills in as ads go live.</div>
        <ChangeLog scope={scope} data={data} changes={changes} onChanged={loadChanges} />
      </div>
    );
  }
  // Changes that belong to this row (by creative or by campaign), and the
  // ones tied to nothing, which sit in the header.
  const changesFor = (r: TRow) => changes.filter(ch => (r.entryId && ch.entry_id === r.entryId) || (r.campaignId && ch.campaign_id === r.campaignId));
  const globalChanges = changes.filter(ch => !ch.entry_id && !ch.campaign_id);
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
              {globalChanges.map(ch => (
                <div key={ch.id} className="absolute rounded-full" title={`${fmtDay(ch.happened_on, true)} — ${ch.note}`}
                  style={{ left: x(ch.happened_on) + dayW / 2 - 4, top: 15, width: 8, height: 8, background: "#d97706", border: "2px solid #ffffff" }} />
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
                {changesFor(r).map(ch => (
                  <div key={ch.id} className="absolute rounded-full" title={`${fmtDay(ch.happened_on, true)} — ${ch.note}`}
                    style={{ left: x(ch.happened_on) + dayW / 2 - 5, top: 3, width: 10, height: 10, background: "#d97706", border: "2px solid #ffffff", zIndex: 1 }} />
                ))}
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
        Bars show the days each {mode === "campaign" ? "campaign" : "creative"} was delivering, from {fmtDay(dayStr(min + 1), true)} to today{scope === "b2c" ? ", across every client it ran for" : ""}. The red line is today; orange dots are logged changes (hover to read them).
      </div>
      <ChangeLog scope={scope} data={data} changes={changes} onChanged={loadChanges} />
    </div>
  );
}

// ── Change log ──────────────────────────────────────────────────────────────

function ChangeLog({ scope, data, changes, onChanged }: {
  scope: Scope; data: HubData; changes: Change[]; onChanged: () => Promise<void>;
}) {
  const [day, setDay] = useState(data.today);
  const [note, setNote] = useState("");
  const [tie, setTie] = useState("");         // "" | "c:<campaign_id>" | "e:<entry_id>"
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState(true);

  const creativeOptions = data.creatives.filter(c => c.entry?.id).map(c => ({ id: c.entry!.id, label: `${c.code ? c.code + " " : ""}${c.name}` }))
    .sort((a, b) => a.label.localeCompare(b.label));
  const campaignOptions = data.campaigns.map(c => ({ id: c.campaign_id, label: `${c.client_name !== "—" && scope === "b2c" ? c.client_name + " — " : ""}${c.name}` }));
  const tieLabel = (ch: Change) =>
    ch.entry_id ? creativeOptions.find(o => o.id === ch.entry_id)?.label ?? "a creative"
    : ch.campaign_id ? campaignOptions.find(o => o.id === ch.campaign_id)?.label ?? "a campaign"
    : null;

  async function add() {
    if (!note.trim()) return;
    setBusy(true); setErr("");
    try {
      await postJson("/api/creative-hub/changes", {
        scope, happened_on: day, note,
        entry_id: tie.startsWith("e:") ? tie.slice(2) : null,
        campaign_id: tie.startsWith("c:") ? tie.slice(2) : null,
      });
      setNote("");
      await onChanged();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  }
  async function remove(id: string) {
    if (!window.confirm("Delete this change?")) return;
    await fetch(`/api/creative-hub/changes?id=${id}`, { method: "DELETE" });
    await onChanged();
  }

  return (
    <div className="rounded-2xl" style={CARD}>
      <button onClick={() => setOpen(o => !o)} className="w-full flex items-center gap-2 px-4 py-3 text-left">
        <svg className="w-3 h-3" style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform 150ms ease", color: "#949494" }} fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
        <span className="text-sm font-semibold" style={{ color: "#111111" }}>Changes</span>
        <span className="text-xs" style={{ color: "#949494" }}>{changes.length ? `${changes.length} logged` : "What you did to the ads, and when"}</span>
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-3">
          <div className="flex gap-2 flex-wrap items-start">
            <input type="date" value={day} onChange={e => setDay(e.target.value)} className="px-3 py-2 rounded-lg text-xs outline-none" style={INPUT} />
            <select value={tie} onChange={e => setTie(e.target.value)} className="px-3 py-2 rounded-lg text-xs font-medium outline-none max-w-[260px]" style={INPUT}>
              <option value="">Whole account</option>
              {campaignOptions.length > 0 && <optgroup label="Campaign">{campaignOptions.map(o => <option key={o.id} value={`c:${o.id}`}>{o.label}</option>)}</optgroup>}
              {creativeOptions.length > 0 && <optgroup label="Creative">{creativeOptions.map(o => <option key={o.id} value={`e:${o.id}`}>{o.label}</option>)}</optgroup>}
            </select>
            <input value={note} onChange={e => setNote(e.target.value)} onKeyDown={e => { if (e.key === "Enter") add(); }}
              placeholder="What changed? e.g. Paused AI/SLOP/004, budget up to $150/day" className="flex-1 min-w-[240px] px-3 py-2 rounded-lg text-xs outline-none" style={INPUT} />
            <button onClick={add} disabled={busy || !note.trim()} className="px-3 py-2 rounded-lg text-xs font-semibold" style={{ background: "#000000", color: "#ffffff", opacity: busy || !note.trim() ? 0.5 : 1 }}>{busy ? "Saving…" : "Log it"}</button>
          </div>
          {err && <div className="text-xs" style={{ color: "#b91c1c" }}>{err}</div>}
          {changes.length > 0 && (
            <div className="rounded-xl overflow-hidden" style={{ border: "1px solid rgba(0,0,0,0.07)" }}>
              {changes.map(ch => (
                <div key={ch.id} className="flex items-start gap-3 px-3 py-2 text-xs group" style={{ borderTop: "1px solid rgba(0,0,0,0.05)" }}>
                  <span className="w-2 h-2 rounded-full flex-shrink-0 mt-1.5" style={{ background: "#d97706" }} />
                  <span className="whitespace-nowrap font-semibold" style={{ color: "#111111", minWidth: 84 }}>{fmtDay(ch.happened_on, true)}</span>
                  <span className="flex-1 min-w-0" style={{ color: "#111111" }}>
                    {ch.note}
                    {tieLabel(ch) && <span className="ml-2" style={{ color: "#949494" }}>· {tieLabel(ch)}</span>}
                  </span>
                  <button onClick={() => remove(ch.id)} className="text-[10px] opacity-0 group-hover:opacity-100" style={{ color: "#b91c1c" }}>Delete</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Detail drawer ───────────────────────────────────────────────────────────

const FORM_FIELDS: { id: keyof Entry; label: string; hint?: string; rows?: number }[] = [
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

function Drawer({ creative, scope, apptWord, folders, categories, copySets, canRename, defaultCategory, defaultFolder, onFoldersChanged, onAskFolder, onClose, onSaved, onNotice }: {
  creative: Creative | null; scope: Scope; apptWord: string;
  folders: Folder[]; categories: Category[]; copySets: CopySetRef[]; canRename: boolean;
  defaultCategory: string; defaultFolder: string;
  onFoldersChanged: () => Promise<void>;
  onAskFolder: (ask: FolderAsk) => void;
  onClose: () => void; onSaved: (key: string) => Promise<void>; onNotice: (s: string) => void;
}) {
  const entry = creative?.entry ?? null;
  const hasAds = (creative?.ads.length ?? 0) > 0;
  const [editing, setEditing] = useState(!creative);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);   // the copy set starts folded
  const blank = () => ({
    name: creative?.name ?? "", category: entry?.category ?? creative?.category ?? defaultCategory, folder_id: entry?.folder_id ?? creative?.folder_id ?? defaultFolder,
    tags: entry?.tags ?? "", kind: entry?.kind ?? "", campaign_label: entry?.campaign_label ?? "", launch_date: entry?.launch_date ?? "",
    copy_set_id: entry?.copy_set_id ?? "", script: entry?.script ?? "", prompt: entry?.prompt ?? "",
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
      const json = await postJson("/api/creative-hub", { id: entry?.id, scope, ...form, folder_id: form.folder_id || null, current_names: currentNames(creative) });
      setEditing(false);
      const renamed = (json.renamed ?? []) as { ok: boolean; error?: string }[];
      if (renamed.length) onNotice(renamed.every(r => r.ok) ? `Ad name${renamed.length === 1 ? "" : "s"} updated in Facebook.` : `Facebook rename failed: ${renamed.find(r => !r.ok)?.error ?? "unknown error"}`);
      const saved = json.entry as Entry;
      await onSaved(saved.code ? saved.code.toLowerCase() : (creative?.key ?? saved.name));
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

  async function renameInMeta() {
    if (!entry) return;
    setSaving(true); setErr("");
    try {
      const json = await postJson("/api/creative-hub/push-names", { scope, entry_id: entry.id, current_names: currentNames(creative) });
      onNotice(json.failed ? `Facebook rename failed: ${(json.results as { error?: string }[]).find(r => r.error)?.error ?? ""}` : `${json.renamed} ad name${json.renamed === 1 ? "" : "s"} updated in Facebook.`);
      await onSaved(creative!.key);
    } catch (e) { setErr((e as Error).message); } finally { setSaving(false); }
  }

  function addFolder() {
    if (!form.category) return;
    onAskFolder({ category: form.category, hasFolders: folders.some(x => x.category === form.category), rootCount: 0,
      onDone: async f => { await onFoldersChanged(); set("folder_id", f.id); } });
  }

  const m = creative?.meta ?? null;
  const st = creative ? STATUS[statusOf(creative)] : STATUS.draft;
  const formFolders = folders.filter(f => f.category === form.category);
  const folderName = (id: string | null) => folders.find(f => f.id === id)?.name ?? null;
  const stats: [string, string][] = creative && creative.days > 0 ? [
    ["Spend", fmt$(creative.spend)],
    ["Leads (CRM)", String(creative.leads)],
    ["Cost / lead", creative.leads ? fmt$(creative.cost_per_lead) : "—"],
    ["Leads (Facebook)", String(creative.meta_leads)],
    ["Cost / FB lead", creative.meta_leads ? fmt$(creative.spend / creative.meta_leads) : "—"],
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
            <div className="text-base font-semibold truncate flex items-center gap-2" style={{ color: "#111111" }}>
              {creative?.code && <span className="text-[11px] font-bold px-1.5 py-0.5 rounded" style={{ background: "#111111", color: "#ffffff" }}>{creative.code}</span>}
              {creative?.name ?? "New creative"}
            </div>
            {creative && (
              <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                <Chip color={st.color} bg={st.bg}>{st.label}</Chip>
                {creative.category && <Chip>{categories.find(c => c.code === creative.category)?.label ?? creative.category}{folderName(creative.folder_id) ? ` › ${folderName(creative.folder_id)}` : ""}</Chip>}
                {!creative.category && <Chip color="#92400e" bg="rgba(217,119,6,0.12)">Not filed yet</Chip>}
                {creative.kind && <Chip>{creative.kind}</Chip>}
                {entry?.campaign_label && <Chip>{entry.campaign_label}</Chip>}
                <span className="text-[11px]" style={{ color: "#767676" }}>{ranLabel(creative)}</span>
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
            {creative && creative.days > 0 && <div className="text-[10px]" style={{ color: "#b8b8b8" }}>All time. CRM figures are first-touch, as on the Creative Leaderboard; Facebook leads are Meta&apos;s own count.</div>}
          </div>

          {/* Copy + our notes */}
          <div className="space-y-5 min-w-0">
            {err && <div className="rounded-xl p-3 text-xs" style={{ background: "rgba(192,57,43,0.08)", color: "#b91c1c" }}>{err}</div>}

            {editing ? (
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="block sm:col-span-2">
                    <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "#949494" }}>Title</span>
                    <input value={form.name} onChange={e => set("name", e.target.value)} placeholder="e.g. Kitchen Made of Money"
                      className="mt-1 w-full px-3 py-2 rounded-lg text-sm outline-none" style={INPUT} />
                    <span className="text-[10px]" style={{ color: "#949494" }}>
                      {form.category ? "The ad is named “code + title” in Facebook; the code comes from the category and folder below." : "Pick a category to give it a code."}
                    </span>
                  </label>
                  <label className="block">
                    <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "#949494" }}>Category</span>
                    <select value={form.category} onChange={e => { set("category", e.target.value); set("folder_id", ""); }} className="mt-1 w-full px-3 py-2 rounded-lg text-sm outline-none" style={INPUT}>
                      <option value="">Not filed</option>
                      {categories.map(c => <option key={c.code} value={c.code}>{c.label} ({c.code})</option>)}
                    </select>
                  </label>
                  <label className="block">
                    <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "#949494" }}>Folder</span>
                    <div className="flex gap-2 mt-1">
                      <select value={form.folder_id} onChange={e => set("folder_id", e.target.value)} disabled={!form.category} className="flex-1 min-w-0 px-3 py-2 rounded-lg text-sm outline-none" style={{ ...INPUT, opacity: form.category ? 1 : 0.6 }}>
                        <option value="">{formFolders.length ? "Choose a folder…" : "No folders in this category"}</option>
                        {formFolders.map(f => <option key={f.id} value={f.id}>{f.name} ({form.category}/{f.slug})</option>)}
                      </select>
                      <button type="button" onClick={addFolder} disabled={!form.category} className="px-2.5 rounded-lg text-xs font-semibold" style={{ border: "1px dashed rgba(0,0,0,0.25)", color: "#111111", opacity: form.category ? 1 : 0.5 }}>+ New</button>
                    </div>
                    {formFolders.length > 0 && !form.folder_id && <span className="text-[10px]" style={{ color: "#92400e" }}>This category uses folders — pick one.</span>}
                  </label>
                  <label className="block sm:col-span-2">
                    <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "#949494" }}>Tags</span>
                    <input value={form.tags} onChange={e => set("tags", e.target.value)} placeholder="hook-1, body-2, garbage-leads, $1-down"
                      className="mt-1 w-full px-3 py-2 rounded-lg text-sm outline-none" style={INPUT} />
                    <span className="text-[10px]" style={{ color: "#949494" }}>Comma-separated. What it&apos;s made of and what angle it takes — searchable.</span>
                  </label>
                  <label className="block sm:col-span-2">
                    <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "#949494" }}>Copy set</span>
                    <select value={form.copy_set_id} onChange={e => set("copy_set_id", e.target.value)} className="mt-1 w-full px-3 py-2 rounded-lg text-sm outline-none" style={INPUT}>
                      <option value="">None — show what Facebook has</option>
                      {copySets.map(s => <option key={s.id} value={s.id}>{s.name}{s.campaign_label ? ` · ${s.campaign_label}` : ""}</option>)}
                    </select>
                    <span className="text-[10px]" style={{ color: "#949494" }}>The combination of primary texts, headlines and descriptions this creative runs with. Sets live on the Copy page.</span>
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
                          className="mt-1 w-full px-3 py-2 rounded-lg text-sm outline-none" style={{ ...INPUT, lineHeight: 1.5 }} />
                      : <input value={form[f.id as keyof typeof form]} onChange={e => set(f.id as keyof typeof form, e.target.value)}
                          className="mt-1 w-full px-3 py-2 rounded-lg text-sm outline-none" style={INPUT} />}
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
              {creative.code && (
                <section className="rounded-xl p-3 flex items-center gap-3 flex-wrap" style={{ background: "#f7f7f7" }}>
                  <div className="min-w-0">
                    <div className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "#949494" }}>Name in Facebook</div>
                    <div className="text-sm font-semibold truncate" style={{ color: "#111111" }}>{creative.fb_name}</div>
                    <div className="text-[10px]" style={{ color: creative.names_match ? "#15803d" : "#92400e" }}>
                      {!hasAds ? "Use this exact name when you create the ad." : creative.names_match ? "Matches Facebook." : `Facebook still has: ${[...new Set(creative.ads.map(a => a.ad_name))].join(", ")}`}
                    </div>
                  </div>
                  <div className="ml-auto flex gap-2">
                    <button onClick={() => { navigator.clipboard.writeText(creative.fb_name); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
                      className="px-2.5 py-1 rounded-md text-xs font-semibold" style={{ border: "1px solid rgba(0,0,0,0.162)", color: copied ? "#15803d" : "#111111" }}>{copied ? "Copied" : "Copy"}</button>
                    {hasAds && !creative.names_match && canRename && (
                      <button onClick={renameInMeta} disabled={saving} className="px-2.5 py-1 rounded-md text-xs font-semibold" style={{ background: "#000000", color: "#ffffff", opacity: saving ? 0.6 : 1 }}>Rename in Facebook</button>
                    )}
                  </div>
                </section>
              )}
              {(entry?.tags) && (
                <div className="flex gap-1 flex-wrap">{entry.tags.split(",").map(t => t.trim()).filter(Boolean).map(t => <Chip key={t}>{t}</Chip>)}</div>
              )}
              {creative.copy_set ? (
                <section className="rounded-xl p-3 space-y-3" style={{ background: "#f7f7f7" }}>
                  <button onClick={() => setCopyOpen(o => !o)} className="w-full flex items-center gap-2 flex-wrap text-left">
                    <svg className="w-3 h-3 flex-shrink-0" style={{ transform: copyOpen ? "rotate(90deg)" : "none", transition: "transform 150ms ease", color: "#949494" }} fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                    <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "#949494" }}>Copy set</span>
                    <span className="text-sm font-semibold" style={{ color: "#111111" }}>{creative.copy_set.name}</span>
                    {creative.copy_set.campaign_label && <Chip>{creative.copy_set.campaign_label}</Chip>}
                    <span className="text-[10px] ml-auto" style={{ color: "#949494" }}>
                      {creative.copy_set.bodies.length} primary · {creative.copy_set.headlines.length} headline{creative.copy_set.headlines.length === 1 ? "" : "s"} · {creative.copy_set.descriptions.length} description{creative.copy_set.descriptions.length === 1 ? "" : "s"}
                    </span>
                  </button>
                  {copyOpen && <div className="flex justify-end -mt-1"><button onClick={() => setEditing(true)} className="text-[10px] font-semibold" style={{ color: "#767676" }}>Change set</button></div>}
                  {copyOpen && ([["Primary texts", creative.copy_set.bodies], ["Headlines", creative.copy_set.headlines], ["Descriptions", creative.copy_set.descriptions]] as const).filter(([, l]) => l.length).map(([label, list]) => (
                    <div key={label}>
                      <div className="text-[10px] font-semibold mb-1" style={{ color: "#949494" }}>{label} · {list.length}</div>
                      <div className="space-y-1.5">
                        {list.map((t, i) => (
                          <div key={i} className="rounded-lg px-3 py-2 text-sm whitespace-pre-wrap flex gap-2 items-start" style={{ background: "#ffffff", color: "#111111", lineHeight: 1.5 }}>
                            <span className="text-[10px] font-bold pt-0.5" style={{ color: "#c2c2c2" }}>{i + 1}</span><span className="flex-1 min-w-0">{t}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </section>
              ) : (<>
                {creative.suggested_copy_set_id && copySets.find(s => s.id === creative.suggested_copy_set_id) && (
                  <div className="rounded-xl p-3 text-xs flex items-center gap-3 flex-wrap" style={{ background: "rgba(217,119,6,0.10)", color: "#92400e" }}>
                    This ad&apos;s copy matches the set <b>{copySets.find(s => s.id === creative.suggested_copy_set_id)!.name}</b>.
                    <button onClick={async () => { set("copy_set_id", creative.suggested_copy_set_id!); try { await postJson("/api/creative-hub", { id: entry?.id, scope, name: creative.name, copy_set_id: creative.suggested_copy_set_id, assign: entry ? undefined : [{ name: creative.name }] }); await onSaved(creative.key); } catch (e) { setErr((e as Error).message); } }}
                      className="px-2.5 py-1 rounded-md text-[11px] font-semibold" style={{ background: "#111111", color: "#ffffff" }}>Attach it</button>
                  </div>
                )}
                <TextBlock label="Headline" text={m?.headline ?? null} source="from Facebook" onAdd={() => setEditing(true)} />
                <TextBlock label="Primary text" text={m?.primary_text ?? null} source="from Facebook" onAdd={() => setEditing(true)} />
              </>)}
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
                            <td className="px-3 py-2 whitespace-nowrap" style={{ color: "#4a4a4a" }}>{a.first ? fmtRange(a.first, a.last) : "No delivery yet"}</td>
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
