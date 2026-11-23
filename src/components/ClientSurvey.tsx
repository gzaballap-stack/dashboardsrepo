"use client";

// New client survey (Clients > New Client Survey, Clients > Submitted Surveys).
// Page one — service, price, prepaid, cash — is filled in here by us and turns
// into a link; the client opens it without signing in and fills in the rest,
// page by page (PublicSurvey.tsx, lib/survey-links.ts). Their submission puts
// them on the roster, fills their profile, sets them up in Client Billing and
// marks them closed in GHL. Questions in lib/client-survey.ts, what a
// submission does in lib/client-survey-server.ts. See NOTES.md 2026-11-12 and
// 2026-11-20.

import { useEffect, useState } from "react";
import {
  SETUP_FIELDS, SURVEY_SECTIONS, cleanAnswers, prepaidOf, priceOf, setupAnswers, setupProblem, surveyProblem, type Answers, type SurveyField,
} from "@/lib/client-survey";
import CardVaultPanel from "./CardVault";
import DateRangePicker, { fmtRange } from "./DateRangePicker";

const BORDER = "1px solid rgba(0,0,0,0.08)";
const SHADOW = "0 1px 2px rgba(0,0,0,0.03), 0 10px 28px -12px rgba(0,0,0,0.10)";
const INPUT = { background: "#ffffff", border: "1px solid rgba(0,0,0,0.162)", color: "#111111" } as const;
const BOX = { background: "#ffffff", border: BORDER, boxShadow: SHADOW } as const;

const SERVICE_LABEL: Record<string, string> = { facebook_ads: "Facebook Ads", sms: "SMS", both: "Facebook Ads and SMS" };

async function post(body: Record<string, unknown>) {
  try {
    const res = await fetch("/api/onboarding", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    return res.ok ? json : { error: json.error ?? "Something went wrong" };
  } catch {
    return { error: "Could not reach the server" };
  }
}

const linkUrl = (token: string) => `${window.location.origin}/survey/${token}`;
const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
const money = (v: unknown) => (typeof v === "string" && v ? `$${v}` : null);

function CopyLink({ url, compact = false }: { url: string; compact?: boolean }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* select and copy by hand */ }
  }
  const btn = compact ? "px-3 py-1.5 text-xs" : "px-4 py-2 text-sm";
  return (
    <div className="flex gap-2">
      <input readOnly value={url} aria-label="Survey link" onFocus={e => e.currentTarget.select()}
        className={`flex-1 px-3 ${compact ? "py-1.5 text-xs" : "py-2 text-sm"} rounded-lg outline-none`} style={{ ...INPUT, minWidth: 0 }} />
      <button type="button" onClick={copy} className={`${btn} rounded-lg font-semibold flex-shrink-0`} style={{ background: "#000000", color: "#ffffff" }}>
        {copied ? "Copied" : "Copy"}
      </button>
      <a href={url} target="_blank" rel="noreferrer" className={`${btn} rounded-lg font-semibold flex-shrink-0`} style={{ background: "rgba(0,0,0,0.06)", color: "#111111" }}>Open</a>
    </div>
  );
}

/** Stripe's own page for putting a roster client's card on file. The link is made on request. */
export function ClientCardLink({ clientId }: { clientId: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function make() {
    setBusy(true); setError(null);
    const r = await post({ action: "card_link_client", client_id: clientId });
    setBusy(false);
    if (r.error || !r.url) { setError(r.error ?? "Could not make the link"); return; }
    setUrl(r.url);
  }
  return (
    <div>
      {url ? <CopyLink url={url} compact /> : (
        <button type="button" onClick={make} disabled={busy} className="px-3 py-1.5 rounded-lg text-xs font-semibold" style={{ background: "#000000", color: "#ffffff", opacity: busy ? 0.5 : 1 }}>
          {busy ? "Making the Link…" : "Get Secure Card Link"}
        </button>
      )}
      {error && <p className="text-xs mt-1.5" style={{ color: "#b91c1c" }}>{error}</p>}
    </div>
  );
}

export function Field({ f, a, set }: { f: SurveyField; a: Answers; set: (key: string, v: string | string[]) => void }) {
  const id = `survey-${f.key}`;
  const v = a[f.key];
  const label = (
    <label htmlFor={id} className="block text-xs font-semibold mb-1.5" style={{ color: "#4a4a4a" }}>
      {f.label}{f.required && <span style={{ color: "#b91c1c" }}> *</span>}
    </label>
  );
  const hint = f.hint && <p className="text-xs mt-1" style={{ color: "#949494" }}>{f.hint}</p>;

  if (f.type === "choice") {
    return (
      <div className={f.wide ? "sm:col-span-2" : ""}>
        {label}
        <div id={id} role="radiogroup" aria-label={f.label} className="flex gap-2">
          {(f.options ?? []).map(o => {
            const on = v === o.value;
            return (
              <button key={o.value} type="button" role="radio" aria-checked={on} onClick={() => set(f.key, on && !f.required ? "" : o.value)}
                className="flex-1 py-2.5 rounded-lg text-sm font-semibold transition-colors"
                style={on ? { background: "#111111", color: "#ffffff", border: "1px solid #111111" } : { background: "#ffffff", color: "#4a4a4a", border: "1px solid rgba(0,0,0,0.162)" }}>
                {o.label}
              </button>
            );
          })}
        </div>
        {hint}
      </div>
    );
  }
  if (f.type === "multi") {
    const picked = Array.isArray(v) ? v : [];
    return (
      <div className={f.wide ? "sm:col-span-2" : ""}>
        {label}
        <div id={id} className="flex flex-wrap gap-2">
          {(f.options ?? []).map(o => {
            const on = picked.includes(o.value);
            return (
              <button key={o.value} type="button" aria-pressed={on}
                onClick={() => set(f.key, on ? picked.filter(x => x !== o.value) : [...picked, o.value])}
                className="px-3 py-2 rounded-lg text-sm font-medium transition-colors"
                style={on ? { background: "#111111", color: "#ffffff", border: "1px solid #111111" } : { background: "#ffffff", color: "#4a4a4a", border: "1px solid rgba(0,0,0,0.162)" }}>
                {o.label}
              </button>
            );
          })}
        </div>
        {hint}
      </div>
    );
  }
  if (f.type === "textarea") {
    return (
      <div className={f.wide ? "sm:col-span-2" : ""}>
        {label}
        <textarea id={id} rows={2} value={typeof v === "string" ? v : ""} placeholder={f.placeholder} onChange={e => set(f.key, e.target.value)}
          className="w-full px-3 py-2 rounded-lg text-sm outline-none" style={{ ...INPUT, resize: "vertical" }} />
        {hint}
      </div>
    );
  }
  return (
    <div className={f.wide ? "sm:col-span-2" : ""}>
      {label}
      <div className="relative">
        {f.type === "money" && <span className="absolute text-sm" style={{ left: 12, top: 8, color: "#949494" }}>$</span>}
        <input id={id} type={f.type === "email" ? "email" : f.type === "tel" ? "tel" : "text"} inputMode={f.type === "money" ? "decimal" : undefined}
          value={typeof v === "string" ? v : ""} placeholder={f.placeholder} onChange={e => set(f.key, e.target.value)}
          autoComplete="off"
          className="w-full py-2 rounded-lg text-sm outline-none" style={{ ...INPUT, paddingLeft: f.type === "money" ? 24 : 12, paddingRight: 12 }} />
      </div>
      {hint}
    </div>
  );
}

/**
 * Clients > New Client Survey: page one, filled in by us. "Create Client Link"
 * saves it and gives the link the client opens to fill in the rest.
 */
export function NewClientSurveyPage({ onSeeSubmitted }: { onSeeSubmitted?: () => void }) {
  const [a, setA] = useState<Answers>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [made, setMade] = useState<{ token: string; setup: Answers } | null>(null);
  // Cash collected = price × prepaid, worked out as either is typed. Still editable;
  // changing the price or the count works it out again.
  const set = (key: string, v: string | string[]) => {
    setError(null);
    setA(prev => {
      const next = { ...prev, [key]: v };
      if (key === "price_per_appointment" || key === "prepaid_appointments") {
        const price = priceOf(next), count = prepaidOf(next);
        next.cash_collected = price !== null && count ? String(Math.round(price * count * 100) / 100) : "";
      }
      return next;
    });
  };

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const setup = setupAnswers(cleanAnswers(a));
    const problem = setupProblem(setup);
    if (problem) { setError(problem); return; }
    setBusy(true); setError(null);
    const r = await post({ action: "link_create", answers: setup });
    setBusy(false);
    if (r.error || !r.link) { setError(r.error ?? "Could not make the link"); return; }
    setMade({ token: r.link.token, setup: r.link.setup ?? setup });
  }

  if (made) {
    const s = made.setup;
    const facts = [SERVICE_LABEL[String(s.service)] ?? null, money(s.price_per_appointment) && `${money(s.price_per_appointment)} per appointment`,
      s.prepaid_appointments && `${s.prepaid_appointments} prepaid`, money(s.cash_collected) && `${money(s.cash_collected)} collected`].filter(Boolean).join(" · ");
    return (
      <div className="w-full max-w-2xl mx-auto space-y-4">
        <div className="rounded-2xl p-6" style={BOX}>
          <div className="flex items-center gap-3">
            <span className="flex items-center justify-center rounded-full flex-shrink-0" style={{ width: 32, height: 32, background: "#15803d" }}>
              <svg width="16" height="16" viewBox="0 0 12 12" fill="none" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2.5 6.5l2.5 2.5 4.5-5.5" /></svg>
            </span>
            <div>
              <h2 className="text-xl font-semibold" style={{ color: "#111111" }}>Client Link Ready</h2>
              <p className="text-sm" style={{ color: "#767676" }}>{facts}</p>
            </div>
          </div>
          <div className="mt-5"><CopyLink url={linkUrl(made.token)} /></div>
        </div>
        <div className="flex items-center justify-end gap-2">
          {onSeeSubmitted && (
            <button type="button" onClick={onSeeSubmitted} className="px-4 py-2 rounded-lg text-sm font-medium" style={{ color: "#767676" }}>Submitted Surveys</button>
          )}
          <button type="button" onClick={() => { setMade(null); setA({}); }} className="px-4 py-2 rounded-lg text-sm font-semibold" style={{ background: "#000000", color: "#ffffff" }}>
            New Survey
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={create} className="w-full max-w-2xl mx-auto space-y-4" noValidate>
      <h2 className="text-xl font-semibold" style={{ color: "#111111" }}>New Client Survey</h2>
      <div className="rounded-2xl p-6" style={BOX}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-4">
          {SETUP_FIELDS.map(f => <Field key={f.key} f={f} a={a} set={set} />)}
        </div>
      </div>
      <div className="flex items-center justify-end gap-3 pb-2">
        {error && <span className="text-sm" style={{ color: "#b91c1c" }}>{error}</span>}
        <button type="submit" disabled={busy} className="px-5 py-2.5 rounded-lg text-sm font-semibold" style={{ background: "#000000", color: "#ffffff", opacity: busy ? 0.5 : 1 }}>
          {busy ? "Making the Link…" : "Create Client Link"}
        </button>
      </div>
    </form>
  );
}

// The time frame on Submitted Surveys — the same choices as the rest of the dashboard. All Time unless picked.
type Frame = "all_time" | "this_month" | "last_month" | "last_30" | "last_7" | "custom";
const FRAME_LABELS: Record<Frame, string> = {
  all_time: "All Time", this_month: "This Month", last_month: "Last Month", last_30: "Last 30 Days", last_7: "Last 7 Days", custom: "Custom Range",
};
const pad2 = (n: number) => String(n).padStart(2, "0");
const localDay = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
/** First and last day (inclusive) of a time frame; null = everything. */
function frameDays(f: Frame, start: string, end: string): [string, string] | null {
  const t = new Date(); t.setHours(0, 0, 0, 0);
  const back = (n: number) => { const d = new Date(t); d.setDate(d.getDate() - n); return localDay(d); };
  if (f === "this_month") return [localDay(new Date(t.getFullYear(), t.getMonth(), 1)), localDay(t)];
  if (f === "last_month") return [localDay(new Date(t.getFullYear(), t.getMonth() - 1, 1)), localDay(new Date(t.getFullYear(), t.getMonth(), 0))];
  if (f === "last_30") return [back(29), localDay(t)];
  if (f === "last_7") return [back(6), localDay(t)];
  if (f === "custom" && start && end) return [start, end];
  return null;
}
const inFrame = (iso: string, days: [string, string] | null) => { if (!days) return true; const d = localDay(new Date(iso)); return d >= days[0] && d <= days[1]; };

function FramePicker({ frame, start, end, onFrame, onRange }: {
  frame: Frame; start: string; end: string; onFrame: (f: Frame) => void; onRange: (s: string, e: string) => void;
}) {
  const [menu, setMenu] = useState(false);
  const [picking, setPicking] = useState(false);
  return (
    <div className="flex items-center gap-2">
      {frame === "custom" && (
        <div className="relative">
          <button type="button" onClick={() => setPicking(true)} className="px-3 py-2 rounded-lg text-sm" style={INPUT}>
            {fmtRange(start, end)}<span className="ml-2 text-xs" style={{ color: "#949494" }}>Change</span>
          </button>
          {picking && <DateRangePicker start={start} end={end} onChange={onRange} onClose={() => setPicking(false)} />}
        </div>
      )}
      <div className="relative">
        <button type="button" onClick={() => setMenu(v => !v)} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium min-w-[9rem]" style={{ background: "#000000", color: "#ffffff" }}>
          <span className="flex-1 text-left">{FRAME_LABELS[frame]}</span>
          <svg className="w-3.5 h-3.5 opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" /></svg>
        </button>
        {menu && (
          <div className="absolute top-full right-0 mt-1.5 rounded-2xl overflow-hidden z-20 w-48" style={{ background: "#ffffff", border: BORDER, boxShadow: "0 12px 32px -8px rgba(0,0,0,0.18)" }}>
            {(Object.keys(FRAME_LABELS) as Frame[]).map(f => (
              <button key={f} type="button" onClick={() => { onFrame(f); setMenu(false); if (f === "custom") setPicking(true); }}
                className="block w-full text-left px-4 py-2.5 text-sm"
                style={frame === f ? { background: "rgba(0,0,0,0.09)", color: "#000000", fontWeight: 600 } : { color: "#4a4a4a" }}>
                {FRAME_LABELS[f]}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

type SavedSurvey = { client_id: string | null; past_id?: string; name: string; contact?: string | null; service: string | null; submitted_by_name: string | null; created_at: string };
type WaitingLink = { id: string; token: string; setup: Answers; created_by_name: string | null; created_at: string };
type Notes = { done: string[]; warnings: string[] } | null;
type Audience = { zip: string | null; radius: number | null; zips: string[]; note: string | null; made_at: string };
type Pack = { id: string; name: string; bodies: string[]; headlines: string[]; descriptions: string[]; cta: string | null; notes: string | null };
type Setup = { audience: Audience | null; pack: Pack | null; runs_ads: boolean } | null;

function CopyText({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* copy by hand */ }
  }
  return (
    <button type="button" onClick={copy} className="px-2.5 py-1 rounded-lg text-xs font-semibold flex-shrink-0" style={{ background: copied ? "#15803d" : "#000000", color: "#ffffff" }}>
      {copied ? "Copied" : label}
    </button>
  );
}

/**
 * What the survey set up for the client's Facebook: their zip codes and (Facebook
 * clients) their copy pack, ready to copy and paste. Made on submit
 * (lib/client-setup.ts); Make Again redoes both from the latest answers.
 */
function SetupPack({ clientId, initial }: { clientId: string; initial: Setup }) {
  const [setup, setSetup] = useState<Setup>(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ done: string[]; warnings: string[] } | null>(null);
  const audience = setup?.audience ?? null;
  const pack = setup?.pack ?? null;

  async function make() {
    if (pack && !window.confirm("This refills the copy pack from the template. Changes made to the pack will be lost.")) return;
    setBusy(true); setMsg(null);
    const r = await post({ action: "setup_make", client_id: clientId });
    setBusy(false);
    if (r.error) { setMsg({ done: [], warnings: [r.error] }); return; }
    setSetup(r.setup ?? null);
    setMsg({ done: r.done ?? [], warnings: r.warnings ?? [] });
  }

  const groups: [string, string[]][] = pack ? [["Primary Texts", pack.bodies], ["Headlines", pack.headlines], ["Descriptions", pack.descriptions]] : [];
  return (
    <div className="w-full max-w-2xl mx-auto rounded-2xl p-5 space-y-5" style={BOX}>
      <div className="flex items-center justify-between gap-3">
        <p className="text-base font-semibold" style={{ color: "#111111" }}>Facebook Setup</p>
        <button type="button" onClick={make} disabled={busy} className="px-3 py-1.5 rounded-lg text-xs font-semibold" style={{ background: "rgba(0,0,0,0.06)", color: "#111111", opacity: busy ? 0.5 : 1 }}>
          {busy ? "Making…" : audience || pack ? "Make Again" : "Make Now"}
        </button>
      </div>
      {msg && (msg.done.length > 0 || msg.warnings.length > 0) && (
        <ul className="space-y-1">
          {msg.done.map(d => <li key={d} className="text-sm" style={{ color: "#15803d" }}>{d}</li>)}
          {msg.warnings.map(w => <li key={w} className="text-sm" style={{ color: "#92400e" }}>{w}</li>)}
        </ul>
      )}

      <section>
        <div className="flex items-center justify-between gap-3 mb-2">
          <p className="text-sm font-semibold" style={{ color: "#111111" }}>Zip Codes</p>
          {audience && audience.zips.length > 0 && <CopyText text={audience.zips.join(", ")} label="Copy All" />}
        </div>
        {!audience ? (
          <p className="text-sm" style={{ color: "#767676" }}>Not made yet.</p>
        ) : (
          <>
            {audience.zips.length > 0 && (
              <p className="text-sm mb-2" style={{ color: "#4a4a4a" }}>{audience.zips.length} zip codes within {audience.radius} miles of {audience.zip}</p>
            )}
            {audience.note && <p className="text-sm mb-2" style={{ color: "#92400e" }}>{audience.note}</p>}
            {audience.zips.length > 0 && (
              <textarea readOnly value={audience.zips.join(", ")} rows={4} onFocus={e => e.currentTarget.select()} aria-label="Zip codes"
                className="w-full px-3 py-2 rounded-lg text-xs outline-none" style={{ ...INPUT, lineHeight: 1.6 }} />
            )}
          </>
        )}
      </section>

      {setup?.runs_ads && (
        <section style={{ borderTop: BORDER }} className="pt-4">
          <p className="text-sm font-semibold mb-2" style={{ color: "#111111" }}>Copy Pack</p>
          {!pack ? (
            <p className="text-sm" style={{ color: "#767676" }}>Not made yet.</p>
          ) : (
            <div className="space-y-4">
              {pack.notes && /left as blanks/.test(pack.notes) && <p className="text-sm" style={{ color: "#92400e" }}>{pack.notes.slice(pack.notes.indexOf("Not in the survey"))}</p>}
              {groups.filter(([, list]) => list.length > 0).map(([label, list]) => (
                <div key={label}>
                  <p className="text-[10px] font-bold uppercase tracking-widest mb-1.5" style={{ color: "#949494" }}>{label}</p>
                  <div className="space-y-2">
                    {list.map((t, i) => (
                      <div key={i} className="rounded-xl p-3 flex gap-3 items-start" style={{ background: "#f7f7f7" }}>
                        <div className="text-sm whitespace-pre-wrap flex-1 min-w-0" style={{ color: "#111111", lineHeight: 1.55 }}>{t}</div>
                        <CopyText text={t} />
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              <p className="text-xs" style={{ color: "#949494" }}>Also on the Copy page of the Creative &amp; Copy Hub, where it can be edited.</p>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

/**
 * Clients > Submitted Surveys: links still waiting for the client, and every
 * survey on file — click one to read or correct it.
 */
export function SubmittedSurveysPage() {
  const [list, setList] = useState<SavedSurvey[]>([]);
  const [links, setLinks] = useState<WaitingLink[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState<{ clientId: string | null; pastId?: string; key: string; name: string; answers: Answers; notes: Notes; setup: Setup } | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloads, setReloads] = useState(0);
  const [frame, setFrame] = useState<Frame>("all_time");
  const [range, setRange] = useState({ start: "", end: "" });

  useEffect(() => {
    Promise.all([post({ action: "survey_list" }), post({ action: "link_list" })]).then(([s, l]) => {
      setList(Array.isArray(s.surveys) ? s.surveys : []);
      setLinks(Array.isArray(l.links) ? l.links : []);
      setLoaded(true);
    });
  }, [reloads]);

  async function view(row: SavedSurvey) {
    const key = row.client_id ?? row.past_id ?? "";
    setLoading(key); setError(null);
    const r = await post({ action: "survey_get", ...(row.client_id ? { client_id: row.client_id } : { past_id: row.past_id }) });
    setLoading(null);
    if (r.error || !r.survey) { setError(r.error ?? "Could not open that survey"); return; }
    setOpen({ clientId: row.client_id, pastId: row.past_id, key, name: row.contact ? `${row.name} — ${row.contact}` : row.name, answers: r.survey.answers as Answers, notes: r.notes ?? null, setup: r.setup ?? null });
  }
  async function removeLink(id: string) {
    const r = await post({ action: "link_delete", id });
    if (r.error) { setError(r.error); return; }
    setLinks(prev => prev.filter(l => l.id !== id));
  }

  if (open) {
    const close = () => { setOpen(null); setReloads(n => n + 1); };
    const warnings = open.notes?.warnings ?? [];
    return (
      <div className="space-y-4">
        <div className="w-full max-w-2xl mx-auto flex items-center justify-between gap-3">
          <h2 className="text-xl font-semibold" style={{ color: "#111111" }}>{open.name}</h2>
          <button type="button" onClick={close} className="text-sm underline" style={{ color: "#767676" }}>Back to Surveys</button>
        </div>
        {warnings.length > 0 && (
          <div className="w-full max-w-2xl mx-auto rounded-2xl p-5" style={{ background: "#fffbeb", border: "1px solid rgba(146,64,14,0.2)" }}>
            <p className="text-sm font-semibold mb-1.5" style={{ color: "#92400e" }}>Needs a Look</p>
            <ul className="space-y-1">{warnings.map(w => <li key={w} className="text-sm" style={{ color: "#92400e" }}>{w}</li>)}</ul>
          </div>
        )}
        {open.clientId ? (
          <>
            <SetupPack key={`setup-${open.clientId}`} clientId={open.clientId} initial={open.setup} />
            <ClientSurvey key={open.key} initial={open.answers} clientId={open.clientId} onCancel={close} />
            <div className="w-full max-w-2xl mx-auto rounded-2xl p-5" style={BOX}>
              <CardVaultPanel key={open.clientId} clientId={open.clientId} />
              <div className="mt-4 pt-4" style={{ borderTop: BORDER }}>
                <p className="text-sm font-semibold mb-2" style={{ color: "#111111" }}>Card for Billing (Stripe)</p>
                <ClientCardLink clientId={open.clientId} />
              </div>
            </div>
          </>
        ) : (
          // A past client: answers kept for the record. Not on the roster, so nothing to save or bill —
          // but their card can still be kept (the owner's choice, 2026-11-20), filed under the survey.
          <>
            <ClientSurvey key={open.key} initial={open.answers} readOnly onCancel={close} />
            {open.pastId && (
              <div className="w-full max-w-2xl mx-auto rounded-2xl p-5" style={BOX}>
                <CardVaultPanel key={open.pastId} pastId={open.pastId} />
              </div>
            )}
          </>
        )}
      </div>
    );
  }

  const days = frameDays(frame, range.start, range.end);
  const shownLinks = links.filter(l => inFrame(l.created_at, days));
  const shownList = list.filter(r => inFrame(r.created_at, days));

  return (
    <div className="w-full max-w-2xl mx-auto space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold" style={{ color: "#111111" }}>Submitted Surveys</h2>
        <FramePicker frame={frame} start={range.start} end={range.end} onFrame={setFrame} onRange={(start, end) => setRange({ start, end })} />
      </div>
      {error && <p className="text-sm" style={{ color: "#b91c1c" }}>{error}</p>}

      {shownLinks.length > 0 && (
        <div className="rounded-2xl p-5" style={BOX}>
          <p className="text-sm font-semibold" style={{ color: "#111111" }}>Waiting for the Client ({shownLinks.length})</p>
          <ul className="mt-3">
            {shownLinks.map(l => (
              <li key={l.id} className="py-3 space-y-2" style={{ borderTop: BORDER }}>
                <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5">
                  <span className="text-sm font-medium" style={{ color: "#111111" }}>
                    {[SERVICE_LABEL[String(l.setup?.service)] ?? "Survey", money(l.setup?.price_per_appointment) && `${money(l.setup?.price_per_appointment)} per appointment`].filter(Boolean).join(" · ")}
                  </span>
                  <span className="flex items-center gap-3 text-xs" style={{ color: "#949494" }}>
                    {[day(l.created_at), l.created_by_name].filter(Boolean).join(" · ")}
                    <button type="button" onClick={() => removeLink(l.id)} className="underline" style={{ color: "#767676" }}>Delete</button>
                  </span>
                </div>
                <CopyLink url={linkUrl(l.token)} compact />
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="rounded-2xl p-5" style={BOX}>
        <p className="text-sm font-semibold" style={{ color: "#111111" }}>Surveys ({shownList.length})</p>
        {loaded && !shownList.length && <p className="text-sm mt-2" style={{ color: "#767676" }}>{list.length ? "None in this time frame." : "None yet."}</p>}
        <ul className="mt-3">
          {shownList.map(row => (
            <li key={row.client_id ?? row.past_id} style={{ borderTop: BORDER }}>
              <button type="button" onClick={() => view(row)} disabled={loading !== null} className="w-full flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 py-2.5 text-left">
                <span className="text-sm font-medium" style={{ color: "#111111" }}>
                  {row.name}{row.contact && <span className="font-normal" style={{ color: "#767676" }}> — {row.contact}</span>}
                </span>
                <span className="text-xs" style={{ color: "#949494" }}>
                  {loading === (row.client_id ?? row.past_id) ? "Opening…" : [row.past_id ? "Past client" : row.service ? SERVICE_LABEL[row.service] : null, day(row.created_at), row.submitted_by_name].filter(Boolean).join(" · ")}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** One client's answers, all on one page: corrected and saved, or (a past client) only read. */
export default function ClientSurvey({ initial, clientId, readOnly, onCancel }: {
  initial?: Answers;
  /** The roster client whose answers these are. */
  clientId?: string;
  /** A past client's answers, kept for the record: shown, never saved. */
  readOnly?: boolean;
  onCancel?: () => void;
}) {
  const [a, setA] = useState<Answers>(initial ?? {});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const set = (key: string, v: string | string[]) => { setError(null); setSaved(false); setA(prev => ({ ...prev, [key]: v })); };
  // A past client's record shows everything it holds, even a question asked only of some clients.
  const shown = (f: SurveyField) => !f.when || f.when(a) || (!!readOnly && !!a[f.key]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (readOnly || !clientId) return;
    const clean = cleanAnswers(a);
    const problem = surveyProblem(clean);
    if (problem) { setError(problem); return; }
    setSaving(true); setError(null);
    const r = await post({ action: "survey_submit", answers: clean, client_id: clientId });
    setSaving(false);
    if (r.error || !r.client) { setError(r.error ?? "Could not save the survey"); return; }
    setSaved(true);
  }

  return (
    <form onSubmit={submit} className="w-full max-w-2xl mx-auto space-y-4" noValidate>
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-lg font-semibold" style={{ color: "#111111" }}>{readOnly ? "Past Client Survey" : "Client Survey"}</h2>
        {onCancel && <button type="button" onClick={onCancel} aria-label="Close" className="text-2xl leading-none px-1" style={{ color: "#767676" }}>×</button>}
      </div>

      {SURVEY_SECTIONS.map(section => {
        const fields = section.fields.filter(shown);
        if (!fields.length) return null;
        return (
          <fieldset key={section.title} disabled={readOnly} className="rounded-2xl p-5" style={BOX}>
            <legend className="sr-only">{section.title}</legend>
            <p className="text-sm font-semibold mb-3" style={{ color: "#111111" }} aria-hidden>{section.title}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3.5">
              {fields.map(f => <Field key={f.key} f={f} a={a} set={set} />)}
            </div>
          </fieldset>
        );
      })}

      <div className="flex items-center justify-end gap-3 pb-2">
        {error && <span className="text-sm" style={{ color: "#b91c1c" }}>{error}</span>}
        {saved && !error && <span className="text-sm" style={{ color: "#15803d" }}>Saved</span>}
        {onCancel && <button type="button" onClick={onCancel} className="px-4 py-2 rounded-lg text-sm" style={{ color: "#767676" }}>{readOnly ? "Back to Surveys" : "Close"}</button>}
        {!readOnly && <button type="submit" disabled={saving} className="px-5 py-2.5 rounded-lg text-sm font-semibold" style={{ background: "#000000", color: "#ffffff", opacity: saving ? 0.5 : 1 }}>
          {saving ? "Saving…" : "Save Answers"}
        </button>}
      </div>
    </form>
  );
}
