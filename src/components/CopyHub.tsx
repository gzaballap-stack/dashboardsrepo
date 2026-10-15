"use client";

import { useCallback, useEffect, useState } from "react";

// Creative & Copy Hub — Copy. A copy set is one combination of texts an ad
// rotates through (Advantage+ creative: up to five primary texts, headlines
// and descriptions), kept per campaign so it can be reused or compared.

type Scope = "b2b" | "b2c";
type CopySet = {
  id: string; name: string; campaign_label: string | null; notes: string | null;
  bodies: string[]; headlines: string[]; descriptions: string[]; cta: string | null; link: string | null; updated_at: string;
  used_by: string[];
  // Lifetime results of every ad carrying one of this set's primary texts.
  performance?: { ads: number; spend: number; ctr: number; cpc: number; meta_leads: number; leads: number; appts: number; shows: number; closes: number; cost_per_lead: number; cost_per_appt: number; first: string | null; last: string | null };
  // Meta's per-text split, aligned by index with bodies / headlines / descriptions.
  texts?: { bodies: TextPerf[]; headlines: TextPerf[]; descriptions: TextPerf[] };
};
type TextPerf = { ads: number; spend: number; impressions: number; clicks: number; ctr: number; cpc: number; leads: number; cost_per_lead: number };

// What one text did on its own, across every ad that rotated it (Meta's split).
function TextStats({ p }: { p?: TextPerf }) {
  if (!p || !p.ads) return <div className="text-[10px] mt-1.5" style={{ color: "#b8b8b8" }}>Not run yet</div>;
  const items: [string, string][] = [
    ["Spend", fmt$(p.spend)], ["Impr", p.impressions.toLocaleString()], ["CTR", `${p.ctr.toFixed(2)}%`], ["CPC", fmt$(p.cpc, 2)],
    ["Leads", String(p.leads)], ["CPL", p.cost_per_lead ? fmt$(p.cost_per_lead) : "—"], ["Ads", String(p.ads)],
  ];
  return (
    <div className="flex flex-wrap mt-2 pt-2" style={{ gap: "4px 12px", borderTop: "1px solid rgba(0,0,0,0.06)" }}>
      {items.map(([l, v]) => (
        <div key={l} className="flex items-baseline gap-1">
          <span className="text-[10px] uppercase font-semibold" style={{ color: "#949494" }}>{l}</span>
          <span className="text-xs font-semibold" style={{ color: "#111111" }}>{v}</span>
        </div>
      ))}
    </div>
  );
}
const fmt$ = (n: number, dp = 0) => `$${n.toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp })}`;

// Same numbers the creative cards show, for the words instead of the picture.
function PerfRow({ p, scope, big = false }: { p: CopySet["performance"]; scope: Scope; big?: boolean }) {
  if (!p || !p.ads) return <div className="text-[10px]" style={{ color: "#b8b8b8" }}>No ad has run with these texts yet</div>;
  const appt = scope === "b2b" ? "Demos" : "Appts";
  const items: [string, string][] = [
    ["Spend", fmt$(p.spend)], ["CTR", `${p.ctr.toFixed(2)}%`], ["CPC", fmt$(p.cpc, 2)],
    ["Leads", String(p.leads || p.meta_leads)], ["CPL", p.cost_per_lead ? fmt$(p.cost_per_lead) : "—"],
    [appt, String(p.appts)], [`Cost/${appt.toLowerCase().replace(/s$/, "")}`, p.cost_per_appt ? fmt$(p.cost_per_appt) : "—"],
  ];
  return (
    <div>
      <div className="flex flex-wrap" style={{ gap: big ? "8px 18px" : "4px 12px" }}>
        {items.map(([l, v]) => (
          <div key={l} className="flex items-baseline gap-1">
            <span className="text-[10px] uppercase font-semibold" style={{ color: "#949494" }}>{l}</span>
            <span className={big ? "text-sm font-semibold" : "text-xs font-semibold"} style={{ color: "#111111" }}>{v}</span>
          </div>
        ))}
      </div>
      <div className="text-[10px] mt-1" style={{ color: "#949494" }}>{p.ads} ad{p.ads === 1 ? "" : "s"}{p.first ? ` · ${p.first} → ${p.last}` : ""} · lifetime</div>
    </div>
  );
}
type AdOption = { ad_id: string; label: string };

const CARD = {
  background: "#ffffff",
  border: "1px solid rgba(0,0,0,0.07)",
  boxShadow: "0 1px 2px rgba(0,0,0,0.03), 0 10px 28px -12px rgba(0,0,0,0.10)",
};
const INPUT = { background: "#f7f7f7", border: "1px solid rgba(0,0,0,0.162)", color: "#111111" };

const GROUPS: { id: "bodies" | "headlines" | "descriptions"; label: string; single: string; rows: number; hint: string }[] = [
  { id: "bodies",       label: "Primary texts", single: "primary text", rows: 5, hint: "The main copy above the creative. Facebook rotates through these." },
  { id: "headlines",    label: "Headlines",     single: "headline",     rows: 1, hint: "Bold line under the creative. ~40 characters shows in full." },
  { id: "descriptions", label: "Descriptions",  single: "description",  rows: 1, hint: "Small line under the headline. Not shown in every placement." },
];

async function postJson(url: string, body: unknown, method = "POST") {
  const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) throw new Error(json.error ?? `Request failed (${res.status})`);
  return json;
}

function Chip({ children, color = "#4a4a4a", bg = "rgba(0,0,0,0.06)" }: { children: React.ReactNode; color?: string; bg?: string }) {
  return <span className="inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap" style={{ color, background: bg }}>{children}</span>;
}

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button onClick={e => { e.stopPropagation(); navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); }}
      className="text-[10px] font-semibold flex-shrink-0" style={{ color: done ? "#15803d" : "#767676" }}>{done ? "Copied" : label}</button>
  );
}

export default function CopyHub({ scope }: { scope: Scope }) {
  const [sets, setSets] = useState<CopySet[] | null>(null);
  const [limit, setLimit] = useState(5);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(() =>
    fetch(`/api/creative-hub/copy?scope=${scope}`)
      .then(async res => {
        const json = await res.json();
        if (!res.ok || json.error) setError(json.error ?? "Could not load copy sets.");
        else { setSets(json.sets); setLimit(json.limit ?? 5); setError(""); }
      })
      .catch(e => setError((e as Error).message)),
  [scope]);
  useEffect(() => { load(); }, [load]);

  const q = search.trim().toLowerCase();
  const shown = (sets ?? []).filter(s => !q || [s.name, s.campaign_label, s.notes, ...s.bodies, ...s.headlines, ...s.descriptions].some(t => t?.toLowerCase().includes(q)));
  const open = openId ? sets?.find(s => s.id === openId) ?? null : null;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl p-4 flex items-center gap-3 flex-wrap" style={CARD}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search sets, texts, campaigns…" className="px-3 py-1.5 rounded-lg text-xs outline-none w-64" style={INPUT} />
        <span className="text-xs" style={{ color: "#6b6b6b" }}>Each set is one combination: up to {limit} primary texts, {limit} headlines and {limit} descriptions.</span>
        <button onClick={() => setCreating(true)} className="ml-auto px-3 py-1.5 rounded-lg text-xs font-semibold" style={{ background: "#000000", color: "#ffffff" }}>+ New copy set</button>
      </div>

      {error && <div className="rounded-2xl p-4 text-sm" style={{ background: "rgba(192,57,43,0.08)", border: "1px solid rgba(192,57,43,0.2)", color: "#b91c1c" }}>{error}</div>}
      {!sets && !error && <div className="rounded-2xl p-8 text-center text-sm" style={{ ...CARD, color: "#6b6b6b" }}>Loading…</div>}

      {sets && (shown.length === 0 ? (
        <div className="rounded-2xl p-8 text-center text-sm" style={{ ...CARD, color: "#6b6b6b" }}>
          {sets.length === 0 ? "No copy sets yet. Start one from scratch, or pull the texts off an ad that's already running." : "Nothing matches."}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {shown.map(s => (
            <button key={s.id} onClick={() => setOpenId(s.id)} className="text-left rounded-2xl p-4 flex flex-col gap-2 transition-transform duration-150 hover:-translate-y-0.5" style={{ ...CARD, minHeight: 180 }}>
              <div className="flex items-start gap-2">
                <div className="text-sm font-semibold flex-1 min-w-0" style={{ color: "#111111" }}>{s.name}</div>
                {s.campaign_label && <Chip>{s.campaign_label}</Chip>}
              </div>
              <div className="text-[11px]" style={{ color: "#767676" }}>
                {s.bodies.length} primary · {s.headlines.length} headline{s.headlines.length === 1 ? "" : "s"} · {s.descriptions.length} description{s.descriptions.length === 1 ? "" : "s"}
              </div>
              {s.used_by?.length > 0 && <div className="text-[10px] truncate" style={{ color: "#4a4a4a" }} title={s.used_by.join(", ")}>Runs on {s.used_by.length} creative{s.used_by.length === 1 ? "" : "s"}: {s.used_by.join(", ")}</div>}
              {s.headlines[0] && <div className="text-xs font-semibold truncate" style={{ color: "#111111" }}>{s.headlines[0]}</div>}
              <div className="text-xs flex-1" style={{ color: "#4a4a4a", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden", lineHeight: 1.5 }}>
                {s.bodies[0] ?? <span style={{ color: "#b8b8b8" }}>No primary text yet</span>}
              </div>
              <div className="pt-2 mt-auto" style={{ borderTop: "1px solid rgba(0,0,0,0.06)" }}><PerfRow p={s.performance} scope={scope} /></div>
            </button>
          ))}
        </div>
      ))}

      {(open || creating) && (
        <SetDrawer key={open?.id ?? "new"} set={open} scope={scope} limit={limit}
          onClose={() => { setOpenId(null); setCreating(false); }}
          onSaved={async id => { setCreating(false); await load(); setOpenId(id); }} />
      )}
    </div>
  );
}

function SetDrawer({ set, scope, limit, onClose, onSaved }: {
  set: CopySet | null; scope: Scope; limit: number; onClose: () => void; onSaved: (id: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(!set);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const blank = () => ({
    name: set?.name ?? "", campaign_label: set?.campaign_label ?? "", notes: set?.notes ?? "", cta: set?.cta ?? "", link: set?.link ?? "",
    bodies: set?.bodies.length ? [...set.bodies] : [""], headlines: set?.headlines.length ? [...set.headlines] : [""], descriptions: set?.descriptions.length ? [...set.descriptions] : [""],
  });
  const [form, setForm] = useState(blank);
  const [ads, setAds] = useState<AdOption[] | null>(null);
  const [importing, setImporting] = useState(false);
  const setList = (k: "bodies" | "headlines" | "descriptions", i: number, v: string) => setForm(f => ({ ...f, [k]: f[k].map((x, j) => (j === i ? v : x)) }));
  const addTo = (k: "bodies" | "headlines" | "descriptions") => setForm(f => (f[k].length < limit ? { ...f, [k]: [...f[k], ""] } : f));
  const removeAt = (k: "bodies" | "headlines" | "descriptions", i: number) => setForm(f => ({ ...f, [k]: f[k].filter((_, j) => j !== i) }));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !editing) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editing, onClose]);

  async function save() {
    setSaving(true); setErr("");
    try {
      const json = await postJson("/api/creative-hub/copy", { id: set?.id, scope, ...form });
      setEditing(false);
      await onSaved(json.set.id);
    } catch (e) { setErr((e as Error).message); } finally { setSaving(false); }
  }

  async function remove() {
    if (!set || !window.confirm("Delete this copy set?")) return;
    await fetch(`/api/creative-hub/copy?id=${set.id}`, { method: "DELETE" });
    await onSaved(""); onClose();
  }

  // Pull the texts off an ad that is already running in Meta.
  async function loadAds() {
    if (ads) return;
    try {
      const res = await fetch(`/api/creative-hub?scope=${scope}`);
      const json = await res.json();
      const list: AdOption[] = [];
      for (const c of json.creatives ?? []) for (const a of c.ads ?? []) list.push({ ad_id: a.ad_id, label: `${c.code ? c.code + " " : ""}${c.name}${a.client_name && scope === "b2c" ? ` — ${a.client_name}` : ""}${a.last ? ` (${a.last})` : ""}` });
      setAds(list);
    } catch { setAds([]); }
  }
  async function importFrom(adId: string) {
    if (!adId) return;
    setImporting(true); setErr("");
    try {
      const res = await fetch(`/api/creative-hub/copy/import?ad_id=${adId}`);
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error ?? "Could not read that ad.");
      setForm(f => ({
        ...f,
        name: f.name || json.ad_name || "",
        bodies: json.bodies.length ? json.bodies.slice(0, limit) : f.bodies,
        headlines: json.headlines.length ? json.headlines.slice(0, limit) : f.headlines,
        descriptions: json.descriptions.length ? json.descriptions.slice(0, limit) : f.descriptions,
        cta: json.cta ?? f.cta, link: json.link ?? f.link,
      }));
    } catch (e) { setErr((e as Error).message); } finally { setImporting(false); }
  }

  const all = (s: CopySet) => [
    ...s.bodies.map((t, i) => `PRIMARY TEXT ${i + 1}\n${t}`),
    ...s.headlines.map((t, i) => `HEADLINE ${i + 1}\n${t}`),
    ...s.descriptions.map((t, i) => `DESCRIPTION ${i + 1}\n${t}`),
  ].join("\n\n");

  return (
    <div className="fixed inset-0 z-50 flex justify-end" style={{ background: "rgba(0,0,0,0.35)" }} onClick={() => { if (!editing) onClose(); }}>
      <div className="h-full w-full md:w-[760px] max-w-full overflow-y-auto" style={{ background: "#ffffff" }} onClick={e => e.stopPropagation()}>
        <div className="sticky top-0 z-10 flex items-center gap-3 px-5 py-3 flex-wrap" style={{ background: "#ffffff", borderBottom: "1px solid rgba(0,0,0,0.07)" }}>
          <div className="min-w-0 mr-auto">
            <div className="text-base font-semibold truncate" style={{ color: "#111111" }}>{set?.name ?? "New copy set"}</div>
            {set && <div className="flex items-center gap-1.5 mt-1 flex-wrap">{set.campaign_label && <Chip>{set.campaign_label}</Chip>}{set.cta && <Chip>{set.cta.replace(/_/g, " ").toLowerCase()}</Chip>}</div>}
          </div>
          {!editing && set && <CopyButton text={all(set)} label="Copy everything" />}
          {editing ? (<>
            {set && <button onClick={() => { setForm(blank()); setEditing(false); setErr(""); }} className="px-3 py-1.5 rounded-lg text-xs font-semibold" style={{ color: "#4a4a4a", border: "1px solid rgba(0,0,0,0.162)" }}>Cancel</button>}
            <button onClick={save} disabled={saving || !form.name.trim()} className="px-3 py-1.5 rounded-lg text-xs font-semibold" style={{ background: "#000000", color: "#ffffff", opacity: saving || !form.name.trim() ? 0.5 : 1 }}>{saving ? "Saving…" : "Save"}</button>
          </>) : (
            <button onClick={() => setEditing(true)} className="px-3 py-1.5 rounded-lg text-xs font-semibold" style={{ background: "#000000", color: "#ffffff" }}>Edit</button>
          )}
          <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg" style={{ color: "#767676" }}>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>

        <div className="p-5 space-y-5">
          {err && <div className="rounded-xl p-3 text-xs" style={{ background: "rgba(192,57,43,0.08)", color: "#b91c1c" }}>{err}</div>}

          {editing ? (<>
            <div className="rounded-xl p-3 flex items-center gap-3 flex-wrap" style={{ background: "#f7f7f7" }}>
              <span className="text-xs" style={{ color: "#4a4a4a" }}>Already running an ad with this copy?</span>
              <select onFocus={loadAds} onChange={e => importFrom(e.target.value)} disabled={importing} className="px-3 py-1.5 rounded-lg text-xs font-medium outline-none max-w-xs" style={INPUT} defaultValue="">
                <option value="">{importing ? "Reading…" : "Pull the texts off an ad…"}</option>
                {(ads ?? []).map(a => <option key={a.ad_id} value={a.ad_id}>{a.label}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block">
                <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "#949494" }}>Set name</span>
                <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. $1 Down — garbage leads angle" className="mt-1 w-full px-3 py-2 rounded-lg text-sm outline-none" style={INPUT} />
              </label>
              <label className="block">
                <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "#949494" }}>Campaign</span>
                <input value={form.campaign_label} onChange={e => setForm(f => ({ ...f, campaign_label: e.target.value }))} placeholder="e.g. TOF Cold Broad v1" className="mt-1 w-full px-3 py-2 rounded-lg text-sm outline-none" style={INPUT} />
              </label>
            </div>
            {GROUPS.map(g => (
              <section key={g.id}>
                <div className="flex items-center gap-2 mb-1.5">
                  <h3 className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "#949494" }}>{g.label}</h3>
                  <span className="text-[10px]" style={{ color: "#b8b8b8" }}>{form[g.id].length}/{limit}</span>
                </div>
                <div className="space-y-2">
                  {form[g.id].map((t, i) => (
                    <div key={i} className="flex gap-2 items-start">
                      <span className="text-[10px] font-bold w-4 pt-2.5 text-right" style={{ color: "#c2c2c2" }}>{i + 1}</span>
                      {g.rows > 1
                        ? <textarea value={t} onChange={e => setList(g.id, i, e.target.value)} rows={g.rows} className="flex-1 px-3 py-2 rounded-lg text-sm outline-none" style={{ ...INPUT, lineHeight: 1.5 }} />
                        : <input value={t} onChange={e => setList(g.id, i, e.target.value)} className="flex-1 px-3 py-2 rounded-lg text-sm outline-none" style={INPUT} />}
                      <button onClick={() => removeAt(g.id, i)} aria-label="Remove" className="text-xs pt-2.5" style={{ color: "#b8b8b8" }}>✕</button>
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-3 mt-1.5">
                  {form[g.id].length < limit && <button onClick={() => addTo(g.id)} className="text-xs font-semibold" style={{ color: "#111111" }}>+ Add {g.single}</button>}
                  <span className="text-[10px]" style={{ color: "#949494" }}>{g.hint}</span>
                </div>
              </section>
            ))}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block">
                <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "#949494" }}>Button</span>
                <input value={form.cta} onChange={e => setForm(f => ({ ...f, cta: e.target.value }))} placeholder="e.g. LEARN_MORE" className="mt-1 w-full px-3 py-2 rounded-lg text-sm outline-none" style={INPUT} />
              </label>
              <label className="block">
                <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "#949494" }}>Link</span>
                <input value={form.link} onChange={e => setForm(f => ({ ...f, link: e.target.value }))} placeholder="https://…" className="mt-1 w-full px-3 py-2 rounded-lg text-sm outline-none" style={INPUT} />
              </label>
            </div>
            <label className="block">
              <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "#949494" }}>Notes</span>
              <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={3} className="mt-1 w-full px-3 py-2 rounded-lg text-sm outline-none" style={{ ...INPUT, lineHeight: 1.5 }} />
            </label>
            {set && <button onClick={remove} disabled={saving} className="text-xs font-semibold" style={{ color: "#b91c1c" }}>Delete this copy set</button>}
          </>) : set && (<>
            {GROUPS.map(g => (
              <section key={g.id}>
                <div className="flex items-center gap-2 mb-1.5">
                  <h3 className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "#949494" }}>{g.label}</h3>
                  <span className="text-[10px]" style={{ color: "#b8b8b8" }}>{set[g.id].length}</span>
                  {set[g.id].length > 1 && <span className="ml-auto"><CopyButton text={set[g.id].join("\n\n")} label="Copy all" /></span>}
                </div>
                {set[g.id].length === 0
                  ? <button onClick={() => setEditing(true)} className="text-xs" style={{ color: "#949494" }}>+ Add {g.single}</button>
                  : <div className="space-y-2">
                      {set[g.id].map((t, i) => (
                        <div key={i} className="rounded-xl p-3" style={{ background: "#f7f7f7" }}>
                          <div className="flex gap-3 items-start">
                            <span className="text-[10px] font-bold pt-0.5" style={{ color: "#c2c2c2" }}>{i + 1}</span>
                            <div className="text-sm whitespace-pre-wrap flex-1 min-w-0" style={{ color: "#111111", lineHeight: 1.55 }}>{t}</div>
                            <CopyButton text={t} />
                          </div>
                          <TextStats p={set.texts?.[g.id]?.[i]} />
                        </div>
                      ))}
                    </div>}
              </section>
            ))}
            {(set.cta || set.link) && (
              <div className="text-xs flex gap-4 flex-wrap" style={{ color: "#4a4a4a" }}>
                {set.cta && <span><b>Button:</b> {set.cta.replace(/_/g, " ").toLowerCase()}</span>}
                {set.link && <span><b>Link:</b> <a href={set.link} target="_blank" rel="noreferrer" style={{ color: "#111111" }}>{set.link}</a></span>}
              </div>
            )}
            {set.used_by?.length > 0 && (
              <section>
                <h3 className="text-[10px] font-bold uppercase tracking-widest mb-1.5" style={{ color: "#949494" }}>Runs on</h3>
                <div className="flex gap-1.5 flex-wrap">{set.used_by.map(u => <Chip key={u}>{u}</Chip>)}</div>
              </section>
            )}
            {set.notes && <section><h3 className="text-[10px] font-bold uppercase tracking-widest mb-1.5" style={{ color: "#949494" }}>Notes</h3><div className="text-sm whitespace-pre-wrap rounded-xl p-3" style={{ background: "#f7f7f7", color: "#111111" }}>{set.notes}</div></section>}
          </>)}
        </div>
      </div>
    </div>
  );
}
