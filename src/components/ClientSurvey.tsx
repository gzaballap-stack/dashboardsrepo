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
  SETUP_FIELDS, SURVEY_SECTIONS, cleanAnswers, setupAnswers, setupProblem, surveyProblem, type Answers, type SurveyField,
} from "@/lib/client-survey";
import CardVaultPanel from "./CardVault";

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
  const set = (key: string, v: string | string[]) => { setError(null); setA(prev => ({ ...prev, [key]: v })); };

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

type SavedSurvey = { client_id: string | null; past_id?: string; name: string; contact?: string | null; service: string | null; submitted_by_name: string | null; created_at: string };
type WaitingLink = { id: string; token: string; setup: Answers; created_by_name: string | null; created_at: string };
type Notes = { done: string[]; warnings: string[] } | null;

/**
 * Clients > Submitted Surveys: links still waiting for the client, and every
 * survey on file — click one to read or correct it.
 */
export function SubmittedSurveysPage() {
  const [list, setList] = useState<SavedSurvey[]>([]);
  const [links, setLinks] = useState<WaitingLink[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState<{ clientId: string | null; pastId?: string; key: string; name: string; answers: Answers; notes: Notes } | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloads, setReloads] = useState(0);

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
    setOpen({ clientId: row.client_id, pastId: row.past_id, key, name: row.contact ? `${row.name} — ${row.contact}` : row.name, answers: r.survey.answers as Answers, notes: r.notes ?? null });
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
            <div className="w-full max-w-2xl mx-auto rounded-2xl p-5" style={BOX}>
              <CardVaultPanel key={open.clientId} clientId={open.clientId} />
              <div className="mt-4 pt-4" style={{ borderTop: BORDER }}>
                <p className="text-sm font-semibold mb-2" style={{ color: "#111111" }}>Card for Billing (Stripe)</p>
                <ClientCardLink clientId={open.clientId} />
              </div>
            </div>
            <ClientSurvey key={open.key} initial={open.answers} clientId={open.clientId} onCancel={close} />
          </>
        ) : (
          // A past client: answers kept for the record. Not on the roster, so nothing to save or bill —
          // but their card can still be kept (the owner's choice, 2026-11-20), filed under the survey.
          <>
            {open.pastId && (
              <div className="w-full max-w-2xl mx-auto rounded-2xl p-5" style={BOX}>
                <CardVaultPanel key={open.pastId} pastId={open.pastId} />
              </div>
            )}
            <ClientSurvey key={open.key} initial={open.answers} readOnly onCancel={close} />
          </>
        )}
      </div>
    );
  }

  return (
    <div className="w-full max-w-2xl mx-auto space-y-4">
      <h2 className="text-xl font-semibold" style={{ color: "#111111" }}>Submitted Surveys</h2>
      {error && <p className="text-sm" style={{ color: "#b91c1c" }}>{error}</p>}

      {links.length > 0 && (
        <div className="rounded-2xl p-5" style={BOX}>
          <p className="text-sm font-semibold" style={{ color: "#111111" }}>Waiting for the Client ({links.length})</p>
          <ul className="mt-3">
            {links.map(l => (
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
        <p className="text-sm font-semibold" style={{ color: "#111111" }}>Surveys ({list.length})</p>
        {loaded && !list.length && <p className="text-sm mt-2" style={{ color: "#767676" }}>None yet.</p>}
        <ul className="mt-3">
          {list.map(row => (
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
