"use client";

// The client's side of the New Client Survey — /survey/<token>, no sign-in.
// One page at a time. Page one (service, price, prepaid) was filled in by us
// and travels with the link; the client never sees it. The card, if they give
// one, is locked in this browser before it leaves (lib/vault-crypto.ts) and
// sent only after the survey is in, tied to the client it made.
// Rules in lib/survey-links.ts.

import { useEffect, useRef, useState } from "react";
import { CARD_AFTER, CLIENT_SECTIONS, pageProblem, type Answers } from "@/lib/client-survey";
import { EMPTY_CARD, brandOf, cardProblem, cardStarted, tidyCard, type CardInput } from "@/lib/card-format";
import { lockCard } from "@/lib/vault-crypto";
import { CardFields } from "./CardVault";
import { Field } from "./ClientSurvey";

const BORDER = "1px solid rgba(0,0,0,0.08)";
const SHADOW = "0 1px 2px rgba(0,0,0,0.03), 0 18px 40px -18px rgba(0,0,0,0.14)";

type Status = { submitted?: boolean; service?: string | null; card?: { on: boolean; public_key: string | null }; error?: string };

async function call(body: Record<string, unknown>) {
  try {
    const res = await fetch("/api/survey", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
    const json = await res.json().catch(() => ({}));
    return res.ok ? json : { error: json.error ?? "Something went wrong" };
  } catch {
    return { error: "Could not reach us. Check your connection and try again." };
  }
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen flex flex-col items-center px-4 py-8 sm:py-14" style={{ background: "#f6f6f4" }}>
      <style>{`@keyframes surveyIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}.survey-in{animation:surveyIn .28s ease-out}`}</style>
      <p className="text-xs font-semibold tracking-[0.18em] uppercase mb-6" style={{ color: "#111111" }}>Tomsi Media</p>
      <div className="w-full" style={{ maxWidth: 560 }}>{children}</div>
    </main>
  );
}

function Message({ title, text }: { title: string; text: string }) {
  return (
    <div className="survey-in rounded-3xl p-8 text-center" style={{ background: "#ffffff", border: BORDER, boxShadow: SHADOW }}>
      <h1 className="text-2xl font-semibold" style={{ color: "#111111" }}>{title}</h1>
      <p className="text-sm mt-2" style={{ color: "#767676" }}>{text}</p>
    </div>
  );
}

export default function PublicSurvey({ token }: { token: string }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [page, setPage] = useState(-1);                  // -1 = the welcome page
  const [a, setA] = useState<Answers>({});
  const [card, setCard] = useState<CardInput>(EMPTY_CARD);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState<{ cardError?: string } | null>(null);
  const top = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch(`/api/survey?token=${encodeURIComponent(token)}`, { cache: "no-store" })
      .then(r => r.json()).then((d: Status) => {
        setStatus(d);
        // The service is ours, not a question: it only decides which questions are asked.
        if (d.service) setA({ service: d.service });
      })
      .catch(() => setStatus({ error: "Could not reach us. Check your connection and refresh the page." }));
  }, [token]);

  useEffect(() => { top.current?.scrollIntoView({ behavior: "smooth", block: "start" }); }, [page]);

  if (!status) return <Shell><p className="text-sm text-center" style={{ color: "#949494" }}>Loading…</p></Shell>;
  if (status.error) return <Shell><Message title="Link Not Available" text={status.error} /></Shell>;
  if (status.submitted && !done) return <Shell><Message title="Already Sent" text="This survey has already been filled in. Thank you!" /></Shell>;
  if (done) {
    return (
      <Shell>
        <div className="survey-in rounded-3xl p-8 text-center" style={{ background: "#ffffff", border: BORDER, boxShadow: SHADOW }}>
          <span className="inline-flex items-center justify-center rounded-full" style={{ width: 48, height: 48, background: "#15803d" }}>
            <svg width="22" height="22" viewBox="0 0 12 12" fill="none" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2.5 6.5l2.5 2.5 4.5-5.5" /></svg>
          </span>
          <h1 className="text-2xl font-semibold mt-4" style={{ color: "#111111" }}>You&rsquo;re All Set</h1>
          <p className="text-sm mt-2" style={{ color: "#767676" }}>Thank you. We have everything we need to get started.</p>
          {done.cardError && <p className="text-sm mt-4" style={{ color: "#92400e" }}>Your card could not be saved. We will get in touch about it.</p>}
        </div>
      </Shell>
    );
  }

  const cardOn = !!status.card?.on && !!status.card.public_key;
  const total = CLIENT_SECTIONS.length;
  const set = (key: string, v: string | string[]) => { setError(null); setA(prev => ({ ...prev, [key]: v })); };

  if (page < 0) {
    return (
      <Shell>
        <div className="survey-in rounded-3xl p-8 sm:p-10" style={{ background: "#ffffff", border: BORDER, boxShadow: SHADOW }}>
          <h1 className="text-3xl font-semibold leading-tight" style={{ color: "#111111" }}>Welcome Aboard</h1>
          <p className="text-base mt-3" style={{ color: "#4a4a4a" }}>A few quick questions so we can get everything set up for you. It takes about five minutes.</p>
          <button type="button" onClick={() => setPage(0)} className="mt-8 w-full sm:w-auto px-7 py-3 rounded-full text-sm font-semibold" style={{ background: "#111111", color: "#ffffff" }}>
            Get Started
          </button>
        </div>
      </Shell>
    );
  }

  const section = CLIENT_SECTIONS[page];
  const last = page === total - 1;
  const withCard = cardOn && section.title === CARD_AFTER;

  async function next(e: React.FormEvent) {
    e.preventDefault();
    const problem = pageProblem(section, a) ?? (withCard && cardStarted(card) ? cardProblem(card) : null);
    if (problem) { setError(problem); return; }
    setError(null);
    if (!last) { setPage(p => p + 1); return; }

    setSending(true);
    const r = await call({ action: "submit", token, answers: a });
    if (r.error || !r.client_id) { setSending(false); setError(r.error ?? "Could not send the survey"); return; }
    let cardError: string | undefined;
    if (cardOn && cardStarted(card) && status?.card?.public_key) {
      try {
        const clean = tidyCard(card);
        const envelope = await lockCard(status.card.public_key, clean, r.client_id);
        const saved = await call({ action: "card", token, envelope, brand: brandOf(clean.number), last4: clean.number.slice(-4) });
        if (saved.error) cardError = saved.error;
      } catch {
        cardError = "This browser could not lock the card";
      }
      setCard(EMPTY_CARD);
    }
    setSending(false);
    setDone({ cardError });
  }

  const fields = section.fields.filter(f => !f.when || f.when(a));
  return (
    <Shell>
      <div ref={top} style={{ scrollMarginTop: 24 }} />
      <div className="mb-5">
        <div className="flex items-center justify-between text-xs font-medium mb-2" style={{ color: "#767676" }}>
          <span>Step {page + 1} of {total}</span>
          <span>{Math.round(((page + 1) / total) * 100)}%</span>
        </div>
        <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "rgba(0,0,0,0.08)" }}>
          <div className="h-full rounded-full" style={{ width: `${((page + 1) / total) * 100}%`, background: "#111111", transition: "width .35s ease" }} />
        </div>
      </div>

      <form key={page} onSubmit={next} noValidate className="survey-in rounded-3xl p-6 sm:p-8" style={{ background: "#ffffff", border: BORDER, boxShadow: SHADOW }}>
        <h1 className="text-2xl font-semibold mb-6" style={{ color: "#111111" }}>{section.title}</h1>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-4">
          {fields.map(f => <Field key={f.key} f={f} a={a} set={set} />)}
        </div>

        {withCard && (
          <div className="mt-8 pt-6" style={{ borderTop: BORDER }}>
            <h2 className="text-lg font-semibold mb-4" style={{ color: "#111111" }}>Card on File</h2>
            <CardFields value={card} onChange={c => { setError(null); setCard(c); }} idPrefix="client-card" />
          </div>
        )}

        {error && <p className="text-sm mt-5" style={{ color: "#b91c1c" }}>{error}</p>}
        <div className="flex items-center justify-between gap-3 mt-8">
          {page > 0 ? (
            <button type="button" onClick={() => { setError(null); setPage(p => p - 1); }} className="px-4 py-2.5 rounded-full text-sm font-medium" style={{ color: "#4a4a4a" }}>Back</button>
          ) : <span />}
          <button type="submit" disabled={sending} className="px-7 py-3 rounded-full text-sm font-semibold" style={{ background: "#111111", color: "#ffffff", opacity: sending ? 0.5 : 1 }}>
            {sending ? "Sending…" : last ? "Submit" : "Next"}
          </button>
        </div>
      </form>
    </Shell>
  );
}
