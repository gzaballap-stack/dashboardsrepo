"use client";

// Build Campaign — on a Facebook client's Submitted Survey (Facebook Setup box).
// Picks the page, budget and creatives, shows what will be made, then builds it
// all paused in their ad account (lib/campaign-builder.ts).

import { useEffect, useState } from "react";

const BORDER = "1px solid rgba(0,0,0,0.08)";
const INPUT = { background: "#ffffff", border: "1px solid rgba(0,0,0,0.162)", color: "#111111" } as const;

type Options = {
  client: { id: string; name: string };
  token: { set: boolean; missing: string[] };
  ad_account: string | null;
  pages: { id: string; name: string }[]; pages_error: string | null; page_id: string | null;
  budget: number;
  targeting: { kind: "radius" | "zips"; radius: number | null; zip: string | null; zips?: number; address?: string; note?: string | null };
  pack: { name: string; bodies: number; headlines: number; descriptions: number } | null;
  thank_you_url: string;
  template_client: string;
  names: { campaign: string };
};
type Built = { ok: boolean; done: string[]; error?: string; ad_ids: string[]; failed_ads: string[]; ads_manager_url?: string; at?: string };
type HubCreative = { key: string; code: string | null; name: string; meta: { thumbnail_url?: string | null; format?: string | null } | null; ads: { ad_id: string; ad_name: string; client_name: string; last: string }[]; spend: number };

async function call(method: "GET" | "POST", body?: Record<string, unknown>, clientId?: string) {
  try {
    const res = await fetch(method === "GET" ? `/api/campaign-builder?client_id=${clientId}` : "/api/campaign-builder", {
      method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined,
    });
    const json = await res.json().catch(() => ({}));
    return res.ok ? json : { error: json.error ?? "Something went wrong" };
  } catch {
    return { error: "Could not reach the server" };
  }
}

export default function CampaignBuilder({ clientId }: { clientId: string }) {
  const [open, setOpen] = useState(false);
  const [opts, setOpts] = useState<Options | null>(null);
  const [last, setLast] = useState<Built | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pageId, setPageId] = useState("");
  const [budget, setBudget] = useState("");
  const [thanks, setThanks] = useState("");
  const [hub, setHub] = useState<HubCreative[] | null>(null);
  const [picked, setPicked] = useState<Record<string, { ad_id: string; name: string }>>({});
  const [search, setSearch] = useState("");
  const [preview, setPreview] = useState<{ problems: string[]; names: { campaign: string; adset: string; form: string; ads: string[] } } | null>(null);
  const [busy, setBusy] = useState<"" | "preview" | "build">("");
  const [result, setResult] = useState<Built | null>(null);

  useEffect(() => {
    if (!open || opts) return;
    call("GET", undefined, clientId).then(r => {
      if (r.error) { setError(r.error); return; }
      setOpts(r.options); setLast(r.last ?? null);
      setPageId(r.options.page_id ?? ""); setBudget(String(r.options.budget)); setThanks(r.options.thank_you_url);
    });
    fetch("/api/creative-hub?scope=b2c").then(r => r.json()).then(j => setHub(((j.creatives ?? []) as HubCreative[]).filter(c => c.ads?.length).sort((a, b) => b.spend - a.spend))).catch(() => setHub([]));
  }, [open, opts, clientId]);

  const body = () => ({ client_id: clientId, page_id: pageId, budget: Number(budget), thank_you_url: thanks, ads: Object.values(picked) });
  async function doPreview() {
    setBusy("preview"); setResult(null);
    const r = await call("POST", { action: "preview", ...body() });
    setBusy("");
    if (r.error) { setError(r.error); return; }
    setError(null); setPreview(r);
  }
  async function doBuild() {
    if (!window.confirm("Build this campaign in the client's ad account? Everything is made paused — nothing spends until you turn it on in Ads Manager.")) return;
    setBusy("build");
    const r = await call("POST", { action: "build", ...body() });
    setBusy("");
    if (r.error && !r.done) { setError(r.error); return; }
    setResult(r); setLast({ ...r, at: new Date().toISOString() }); setPreview(null);
  }
  const toggle = (c: HubCreative) => setPicked(p => {
    const n = { ...p };
    if (n[c.key]) delete n[c.key];
    else n[c.key] = { ad_id: c.ads[0].ad_id, name: c.ads[0].ad_name || c.name };
    return n;
  });

  if (!open) {
    return (
      <section style={{ borderTop: BORDER }} className="pt-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold" style={{ color: "#111111" }}>Campaign</p>
            <p className="text-xs" style={{ color: "#767676" }}>Build their first campaign in their ad account, paused.</p>
          </div>
          <button type="button" onClick={() => setOpen(true)} className="px-3 py-1.5 rounded-lg text-xs font-semibold" style={{ background: "#000000", color: "#ffffff" }}>Build Campaign</button>
        </div>
      </section>
    );
  }

  const q = search.trim().toLowerCase();
  const shownHub = (hub ?? []).filter(c => !q || `${c.code ?? ""} ${c.name}`.toLowerCase().includes(q)).slice(0, 60);
  const count = Object.keys(picked).length;
  return (
    <section style={{ borderTop: BORDER }} className="pt-4 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold" style={{ color: "#111111" }}>Build Campaign</p>
        <button type="button" onClick={() => setOpen(false)} className="text-xs underline" style={{ color: "#767676" }}>Close</button>
      </div>
      {error && <p className="text-sm" style={{ color: "#b91c1c" }}>{error}</p>}
      {!opts && !error && <p className="text-sm" style={{ color: "#767676" }}>Loading…</p>}
      {opts && (<>
        {opts.token.missing.length > 0 && (
          <div className="rounded-xl p-3 text-sm" style={{ background: "#fffbeb", color: "#92400e" }}>
            {opts.token.set ? "The Meta token can't build campaigns yet." : "Building needs a Meta token with permission to create ads."} Missing: {opts.token.missing.join(", ")}. You can still pick everything and preview.
          </div>
        )}
        {last && (
          <div className="rounded-xl p-3 text-sm" style={{ background: last.ok ? "rgba(21,128,61,0.08)" : "#fffbeb", color: last.ok ? "#15803d" : "#92400e" }}>
            Last built {last.at ? new Date(last.at).toLocaleString() : ""}: {last.done.join(" · ") || "nothing"}{last.error ? ` — stopped: ${last.error}` : ""}
            {last.ads_manager_url && <> · <a href={last.ads_manager_url} target="_blank" rel="noreferrer" className="underline">Open in Ads Manager</a></>}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <div><span className="text-xs" style={{ color: "#767676" }}>Ad account</span><div style={{ color: opts.ad_account ? "#111111" : "#b91c1c" }}>{opts.ad_account ?? "Not linked yet"}</div></div>
          <div><span className="text-xs" style={{ color: "#767676" }}>Copy</span><div style={{ color: opts.pack ? "#111111" : "#b91c1c" }}>{opts.pack ? `${opts.pack.bodies} primary · ${opts.pack.headlines} headlines · ${opts.pack.descriptions} description` : "No copy pack"}</div></div>
          <div className="sm:col-span-2"><span className="text-xs" style={{ color: "#767676" }}>Targeting</span><div style={{ color: "#111111" }}>
            {opts.targeting.kind === "radius" ? `${opts.targeting.radius} miles around ${opts.targeting.address || opts.targeting.zip}` : opts.targeting.zips ? `${opts.targeting.zips} zip codes (from the survey)` : opts.targeting.note}
          </div></div>
          <label className="block">
            <span className="text-xs" style={{ color: "#767676" }}>Facebook page</span>
            {opts.pages.length ? (
              <select value={pageId} onChange={e => setPageId(e.target.value)} className="mt-1 w-full px-3 py-2 rounded-lg text-sm outline-none" style={INPUT}>
                <option value="">Pick the client&rsquo;s page…</option>
                {opts.pages.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            ) : (
              <input value={pageId} onChange={e => setPageId(e.target.value)} placeholder="Page ID" className="mt-1 w-full px-3 py-2 rounded-lg text-sm outline-none" style={INPUT} />
            )}
          </label>
          <label className="block">
            <span className="text-xs" style={{ color: "#767676" }}>Daily budget ($)</span>
            <input value={budget} onChange={e => setBudget(e.target.value.replace(/[^0-9.]/g, ""))} inputMode="decimal" className="mt-1 w-full px-3 py-2 rounded-lg text-sm outline-none" style={INPUT} />
          </label>
          <label className="block sm:col-span-2">
            <span className="text-xs" style={{ color: "#767676" }}>Form&rsquo;s thank-you link (copied from {opts.template_client}&rsquo;s form)</span>
            <input value={thanks} onChange={e => setThanks(e.target.value)} className="mt-1 w-full px-3 py-2 rounded-lg text-sm outline-none" style={INPUT} />
          </label>
        </div>

        <div>
          <div className="flex items-center justify-between gap-3 mb-2">
            <span className="text-xs font-semibold" style={{ color: "#111111" }}>Creatives ({count} picked)</span>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search the hub…" className="px-3 py-1.5 rounded-lg text-xs outline-none w-48" style={INPUT} />
          </div>
          {!hub && <p className="text-xs" style={{ color: "#767676" }}>Loading the Creative Hub…</p>}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-80 overflow-y-auto">
            {shownHub.map(c => {
              const on = !!picked[c.key];
              return (
                <button key={c.key} type="button" onClick={() => toggle(c)} className="text-left rounded-lg p-2 flex gap-2 items-center"
                  style={{ border: on ? "2px solid #000000" : BORDER, background: on ? "#f7f7f7" : "#ffffff" }}>
                  {c.meta?.thumbnail_url
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={c.meta.thumbnail_url} alt="" className="w-10 h-10 rounded object-cover flex-shrink-0" />
                    : <span className="w-10 h-10 rounded flex-shrink-0" style={{ background: "#eeeeee" }} />}
                  <span className="text-xs min-w-0" style={{ color: "#111111" }}>
                    <span className="block truncate font-semibold">{c.code ? `${c.code} ` : ""}{c.name}</span>
                    <span className="block truncate" style={{ color: "#767676" }}>{c.meta?.format ?? ""}{c.ads[0] ? ` · ${c.ads[0].client_name}` : ""}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        {preview && (
          <div className="rounded-xl p-3 text-sm space-y-1" style={{ background: "#f7f7f7" }}>
            <p><b>Campaign:</b> {preview.names.campaign} — ${budget}/day, paused</p>
            <p><b>Ad set:</b> {preview.names.adset}</p>
            <p><b>Form:</b> {preview.names.form}</p>
            <p><b>Ads:</b> {preview.names.ads.join(", ") || "none"}</p>
            {preview.problems.length > 0 && <ul className="pt-1">{preview.problems.map(p => <li key={p} style={{ color: "#b91c1c" }}>{p}</li>)}</ul>}
          </div>
        )}
        {result && (
          <div className="rounded-xl p-3 text-sm space-y-1" style={{ background: result.ok ? "rgba(21,128,61,0.08)" : "#fffbeb" }}>
            {result.done.map(d => <p key={d} style={{ color: "#15803d" }}>{d}</p>)}
            {result.failed_ads.map(f => <p key={f} style={{ color: "#92400e" }}>{f}</p>)}
            {result.error && <p style={{ color: "#b91c1c" }}>Stopped: {result.error}</p>}
            {result.ads_manager_url && <a href={result.ads_manager_url} target="_blank" rel="noreferrer" className="underline" style={{ color: "#111111" }}>Open in Ads Manager</a>}
          </div>
        )}

        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={doPreview} disabled={!!busy} className="px-3 py-1.5 rounded-lg text-xs font-semibold" style={{ background: "rgba(0,0,0,0.06)", color: "#111111", opacity: busy ? 0.5 : 1 }}>
            {busy === "preview" ? "Checking…" : "Preview"}
          </button>
          <button type="button" onClick={doBuild} disabled={!!busy || !preview || preview.problems.length > 0} className="px-3 py-1.5 rounded-lg text-xs font-semibold"
            style={{ background: "#000000", color: "#ffffff", opacity: busy || !preview || preview.problems.length ? 0.4 : 1 }}>
            {busy === "build" ? "Building… (a few minutes)" : "Build (Paused)"}
          </button>
        </div>
      </>)}
    </section>
  );
}
