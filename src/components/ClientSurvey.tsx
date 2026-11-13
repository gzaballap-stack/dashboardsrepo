"use client";

// New client survey. Filled in on the onboarding call; one submission puts the
// client on the roster, opens their onboarding card(s), fills their profile and
// sets them up in Client Billing. Questions in lib/client-survey.ts, what a
// submission does in lib/client-survey-server.ts. See NOTES.md 2026-11-12.

import { useState } from "react";
import {
  SURVEY_SECTIONS, cleanAnswers, surveyProblem, type Answers, type SurveyField,
} from "@/lib/client-survey";
import type { Card } from "@/lib/onboarding";

const BORDER = "1px solid rgba(0,0,0,0.08)";
const SHADOW = "0 1px 2px rgba(0,0,0,0.03), 0 10px 28px -12px rgba(0,0,0,0.10)";
const INPUT = { background: "#ffffff", border: "1px solid rgba(0,0,0,0.162)", color: "#111111" } as const;

export type SurveyResult = {
  client: { id: string; name: string; status: string | null; service: string | null; created: boolean };
  cards: Card[];
  stripe: { configured: boolean; made?: "existing" | "linked" | "created"; error?: string };
  warnings: string[];
  updated: boolean;
  /** Anything else the survey did, in words: credits issued, cash recorded, marked closed in GHL. */
  done?: string[];
};

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

/** Stripe's own page for typing the card in. The link is made on request. */
export function CardLink({ cardId, compact = false }: { cardId: string; compact?: boolean }) {
  const [url, setUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function make() {
    setBusy(true); setError(null);
    const r = await post({ action: "card_link", id: cardId });
    setBusy(false);
    if (r.error || !r.url) { setError(r.error ?? "Could not make the link"); return; }
    setUrl(r.url);
  }
  async function copy() {
    if (!url) return;
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* shown below to copy by hand */ }
  }

  return (
    <div>
      {!url ? (
        <button type="button" onClick={make} disabled={busy}
          className={`${compact ? "px-3 py-1.5 text-xs" : "px-4 py-2 text-sm"} rounded-lg font-semibold`}
          style={{ background: "#000000", color: "#ffffff", opacity: busy ? 0.5 : 1 }}>
          {busy ? "Making the link…" : "Get secure card link"}
        </button>
      ) : (
        <div className="space-y-1.5">
          <div className="flex gap-2">
            <input readOnly value={url} aria-label="Secure card link" onFocus={e => e.currentTarget.select()}
              className="flex-1 px-3 py-1.5 rounded-lg text-xs outline-none" style={{ ...INPUT, minWidth: 0 }} />
            <button type="button" onClick={copy} className="px-3 py-1.5 rounded-lg text-xs font-semibold flex-shrink-0" style={{ background: "#000000", color: "#ffffff" }}>
              {copied ? "Copied" : "Copy"}
            </button>
            <a href={url} target="_blank" rel="noreferrer" className="px-3 py-1.5 rounded-lg text-xs font-semibold flex-shrink-0" style={{ background: "rgba(0,0,0,0.06)", color: "#111111" }}>Open</a>
          </div>
          <p className="text-xs" style={{ color: "#949494" }}>Stripe&rsquo;s own page. Open it to type the card in on the call, or send it to the client. Works for 24 hours.</p>
        </div>
      )}
      {error && <p className="text-xs mt-1.5" style={{ color: "#b91c1c" }}>{error}</p>}
    </div>
  );
}

function Field({ f, a, set }: { f: SurveyField; a: Answers; set: (key: string, v: string | string[]) => void }) {
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

export default function ClientSurvey({ initial, cardId, clientId, onSaved, onDone, onCancel }: {
  /** Answers to start from (a card's name, or a survey being corrected). */
  initial?: Answers;
  /** The card the survey is being filled in from — that card is used, not a new one. */
  cardId?: string;
  /** Correcting this client's answers: nothing new is created. */
  clientId?: string;
  /** Called the moment the survey is saved. */
  onSaved?: (r: SurveyResult) => void;
  /** Called with the result when the person moves on from the confirmation. */
  onDone?: (r: SurveyResult) => void;
  onCancel?: () => void;
}) {
  const [a, setA] = useState<Answers>(initial ?? {});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SurveyResult | null>(null);

  const set = (key: string, v: string | string[]) => { setError(null); setA(prev => ({ ...prev, [key]: v })); };

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const clean = cleanAnswers(a);
    const problem = surveyProblem(clean);
    if (problem) { setError(problem); return; }
    setSaving(true); setError(null);
    const r = await post({ action: "survey_submit", answers: clean, ...(clientId ? { client_id: clientId } : cardId ? { card_id: cardId } : {}) });
    setSaving(false);
    if (r.error || !r.client) { setError(r.error ?? "Could not save the survey"); return; }
    setResult(r as SurveyResult);
    onSaved?.(r as SurveyResult);
  }

  if (result) {
    const { client, cards, stripe, warnings } = result;
    const lines: string[] = [
      client.created ? "Added to the Client Roster, in Setup" : "Already on the Client Roster — linked to it",
      `Service set to ${SERVICE_LABEL[client.service ?? ""] ?? "not set"}`,
      cards.length ? `${cards.length === 1 ? "Onboarding card" : `${cards.length} onboarding cards`} opened, survey step ticked` : "Answers saved",
      "Contact details saved to the client profile (Profit and Loss and Client Billing)",
      ...(stripe.configured && !stripe.error ? [stripe.made === "created" ? "Customer created in Stripe" : stripe.made === "linked" ? "Linked to their existing Stripe customer" : "Already linked to Stripe"] : []),
      ...(result.done ?? []),
    ];
    return (
      <div className="w-full max-w-2xl mx-auto space-y-4">
        <div className="rounded-2xl p-6" style={{ background: "#ffffff", border: BORDER, boxShadow: SHADOW }}>
          <div className="flex items-center gap-3">
            <span className="flex items-center justify-center rounded-full flex-shrink-0" style={{ width: 32, height: 32, background: "#15803d" }}>
              <svg width="16" height="16" viewBox="0 0 12 12" fill="none" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2.5 6.5l2.5 2.5 4.5-5.5" /></svg>
            </span>
            <div>
              <h2 className="text-xl font-semibold" style={{ color: "#111111" }}>{client.name} {result.updated && !cards.length ? "updated" : "is set up"}</h2>
              <p className="text-sm" style={{ color: "#767676" }}>Here is what the survey just did.</p>
            </div>
          </div>
          <ul className="mt-4 space-y-1.5">
            {lines.map(l => (
              <li key={l} className="flex items-start gap-2 text-sm" style={{ color: "#111111" }}>
                <span style={{ color: "#15803d" }}>✓</span>{l}
              </li>
            ))}
            {warnings.map(w => (
              <li key={w} className="flex items-start gap-2 text-sm" style={{ color: "#92400e" }}><span>!</span>{w}</li>
            ))}
          </ul>
        </div>

        {cards.length > 0 && (
          <div className="rounded-2xl p-6" style={{ background: "#ffffff", border: BORDER, boxShadow: SHADOW }}>
            <h3 className="text-sm font-semibold" style={{ color: "#111111" }}>Card on file</h3>
            {stripe.configured ? (
              <>
                <p className="text-sm mt-1 mb-3" style={{ color: "#767676" }}>The card is typed straight into Stripe, never into the dashboard. Once it is in, Client Billing can charge it.</p>
                <CardLink cardId={cards[0].id} />
              </>
            ) : (
              <p className="text-sm mt-1" style={{ color: "#767676" }}>Stripe is not connected on this site, so there is no card link here.</p>
            )}
          </div>
        )}

        <div className="flex items-center justify-end gap-2">
          <button type="button" onClick={() => { setResult(null); setA({}); }} className="px-4 py-2 rounded-lg text-sm font-medium" style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.162)", color: "#111111" }}>
            New survey
          </button>
          {onDone && (
            <button type="button" onClick={() => onDone(result)} className="px-4 py-2 rounded-lg text-sm font-semibold" style={{ background: "#000000", color: "#ffffff" }}>
              {cards.length ? "Open the card" : "Done"}
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="w-full max-w-2xl mx-auto space-y-4" noValidate>
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold" style={{ color: "#111111" }}>{clientId ? "Client survey" : "New client survey"}</h2>
          <p className="text-sm mt-0.5" style={{ color: "#767676" }}>
            {clientId ? "Correct the answers and save." : "Fill it in on the onboarding call. Submitting sets the client up across the dashboard."}
          </p>
        </div>
        {onCancel && <button type="button" onClick={onCancel} aria-label="Close" className="text-2xl leading-none px-1" style={{ color: "#767676" }}>×</button>}
      </div>

      {SURVEY_SECTIONS.map(section => {
        const fields = section.fields.filter(f => !f.when || f.when(a));
        return (
          <fieldset key={section.title} className="rounded-2xl p-5" style={{ background: "#ffffff", border: BORDER, boxShadow: SHADOW }}>
            <legend className="sr-only">{section.title}</legend>
            <p className="text-sm font-semibold mb-3" style={{ color: "#111111" }} aria-hidden>{section.title}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3.5">
              {fields.map(f => <Field key={f.key} f={f} a={a} set={set} />)}
            </div>
          </fieldset>
        );
      })}

      {!clientId && (
        <div className="rounded-2xl p-5" style={{ background: "#fafafa", border: BORDER }}>
          <p className="text-sm font-semibold" style={{ color: "#111111" }}>Card on file</p>
          <p className="text-sm mt-1" style={{ color: "#767676" }}>
            No card number here. After you submit you get a secure Stripe link — type the card in there on the call, or send it to the client. It lands on their Stripe customer, ready for Client Billing.
          </p>
        </div>
      )}

      <div className="flex items-center justify-end gap-3 pb-2">
        {error && <span className="text-sm" style={{ color: "#b91c1c" }}>{error}</span>}
        {onCancel && <button type="button" onClick={onCancel} className="px-4 py-2 rounded-lg text-sm" style={{ color: "#767676" }}>Cancel</button>}
        <button type="submit" disabled={saving} className="px-5 py-2.5 rounded-lg text-sm font-semibold" style={{ background: "#000000", color: "#ffffff", opacity: saving ? 0.5 : 1 }}>
          {saving ? "Saving…" : clientId ? "Save answers" : "Submit survey"}
        </button>
      </div>
    </form>
  );
}
