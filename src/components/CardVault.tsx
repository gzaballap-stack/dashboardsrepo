"use client";

// A client's card, stored encrypted (lib/card-vault.ts has the rules). This is
// the only screen that takes a card in or shows one. A card is shown only to an
// admin who re-enters their password, for a minute, and each view is logged.

import { useEffect, useState } from "react";
import { EMPTY_CARD, cardProblem, cardStarted, formatExp, formatNumber, type CardInput } from "@/lib/card-format";

const BORDER = "1px solid rgba(0,0,0,0.08)";
const INPUT = { background: "#ffffff", border: "1px solid rgba(0,0,0,0.162)", color: "#111111" } as const;
const SHOW_SECONDS = 60;

type Summary = { brand: string; last4: string; saved_by: string | null; saved_at: string | null };
type Status = { enabled: boolean; ready: boolean; card?: Summary | null; can_reveal?: boolean; history?: { user_name: string; action: string; at: string }[]; error?: string };

const ACTION: Record<string, string> = { saved: "Saved", replaced: "Replaced", revealed: "Viewed", denied: "Refused", deleted: "Deleted" };
const when = (iso: string) => new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

async function call(body: Record<string, unknown>) {
  try {
    const res = await fetch("/api/card-vault", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
    const json = await res.json().catch(() => ({}));
    return res.ok ? json : { error: json.error ?? "Something went wrong" };
  } catch {
    return { error: "Could not reach the server" };
  }
}

/** Whether card storage is switched on here (and its tables exist). */
export function useCardVault(): { on: boolean; checked: boolean } {
  const [state, setState] = useState({ on: false, checked: false });
  useEffect(() => {
    fetch("/api/card-vault", { cache: "no-store" }).then(r => r.json())
      .then(d => setState({ on: !!d.enabled && !!d.ready, checked: true }))
      .catch(() => setState({ on: false, checked: true }));
  }, []);
  return state;
}

/** Save a card for a client. Resolves to the summary, or the reason it failed. */
export async function saveCard(clientId: string, card: CardInput): Promise<{ card?: Summary; error?: string }> {
  return call({ action: "save", client_id: clientId, card });
}

/** The five boxes. Nothing typed here is kept by the browser's own card autofill. */
export function CardFields({ value, onChange, idPrefix = "vault" }: { value: CardInput; onChange: (c: CardInput) => void; idPrefix?: string }) {
  const set = (k: keyof CardInput, v: string) => onChange({ ...value, [k]: v });
  const box = (k: keyof CardInput, label: string, props: React.InputHTMLAttributes<HTMLInputElement>, wide = false) => (
    <div className={wide ? "sm:col-span-2" : ""}>
      <label htmlFor={`${idPrefix}-${k}`} className="block text-xs font-semibold mb-1.5" style={{ color: "#4a4a4a" }}>{label}</label>
      <input id={`${idPrefix}-${k}`} type="text" value={value[k]} autoComplete="off" data-lpignore="true" data-1p-ignore spellCheck={false}
        className="w-full px-3 py-2 rounded-lg text-sm outline-none" style={INPUT} {...props} />
    </div>
  );
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3.5">
      {box("name", "Name on card", { onChange: e => set("name", e.target.value) }, true)}
      {box("number", "Card number", { inputMode: "numeric", placeholder: "0000 0000 0000 0000", onChange: e => set("number", formatNumber(e.target.value)) }, true)}
      {box("exp", "Expiry", { inputMode: "numeric", placeholder: "MM/YY", onChange: e => set("exp", formatExp(e.target.value)) })}
      {box("cvc", "Security code", { inputMode: "numeric", placeholder: "CVC", onChange: e => set("cvc", e.target.value.replace(/\D/g, "").slice(0, 4)) })}
      {box("zip", "Billing zip code", { onChange: e => set("zip", e.target.value) })}
    </div>
  );
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  if (!value) return null;
  return (
    <div className="flex items-center justify-between gap-3 py-1.5" style={{ borderTop: BORDER }}>
      <span className="text-xs" style={{ color: "#767676" }}>{label}</span>
      <span className="flex items-center gap-2">
        <span className="text-sm font-semibold tabular-nums" style={{ color: "#111111", userSelect: "all" }}>{value}</span>
        <button type="button" className="text-xs px-2 py-1 rounded-md font-medium" style={{ background: "rgba(0,0,0,0.06)", color: "#111111" }}
          onClick={async () => { try { await navigator.clipboard.writeText(value.replace(/\s/g, "")); setCopied(true); setTimeout(() => setCopied(false), 1200); } catch { /* select and copy by hand */ } }}>
          {copied ? "Copied" : "Copy"}
        </button>
      </span>
    </div>
  );
}

export default function CardVaultPanel({ clientId }: { clientId: string }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [mode, setMode] = useState<"idle" | "add" | "ask" | "confirm-delete">("idle");
  const [draft, setDraft] = useState<CardInput>(EMPTY_CARD);
  const [password, setPassword] = useState("");
  const [shown, setShown] = useState<CardInput | null>(null);
  const [left, setLeft] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    fetch(`/api/card-vault?client_id=${encodeURIComponent(clientId)}`, { cache: "no-store" }).then(r => r.json())
      .then(d => setStatus(d)).catch(() => setStatus({ enabled: false, ready: false, error: "Could not load the card" }));
  }, [clientId, reloads]);

  // A card on screen hides itself.
  useEffect(() => {
    if (!shown) return;
    const t = setInterval(() => setLeft(n => {
      if (n <= 1) { setShown(null); return 0; }
      return n - 1;
    }), 1000);
    return () => clearInterval(t);
  }, [shown]);

  const reset = () => { setMode("idle"); setDraft(EMPTY_CARD); setPassword(""); setError(null); };

  async function save() {
    const problem = cardProblem(draft);
    if (problem) { setError(problem); return; }
    setBusy(true); setError(null);
    const r = await saveCard(clientId, draft);
    setBusy(false);
    if (r.error) { setError(r.error); return; }
    reset(); setShown(null); setReloads(n => n + 1);
  }
  async function reveal() {
    if (!password) return;
    setBusy(true); setError(null);
    const r = await call({ action: "reveal", client_id: clientId, password });
    setBusy(false); setPassword("");
    if (r.error || !r.card) { setError(r.error ?? "Could not show the card"); return; }
    setMode("idle"); setShown(r.card as CardInput); setLeft(SHOW_SECONDS); setReloads(n => n + 1);
  }
  async function remove() {
    setBusy(true); setError(null);
    const r = await call({ action: "delete", client_id: clientId });
    setBusy(false);
    if (r.error) { setError(r.error); return; }
    reset(); setShown(null); setReloads(n => n + 1);
  }

  if (!status) return null;
  const head = <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#949494" }}>Card on file</p>;
  if (!status.ready || !status.enabled) {
    return (
      <div>
        {head}
        <p className="text-xs mt-1.5" style={{ color: "#949494" }}>{!status.ready ? (status.error ?? "Card storage needs a database update first.") : "Card storage is not switched on yet."}</p>
      </div>
    );
  }
  const card = status.card ?? null;
  const btn = "px-3 py-1.5 rounded-lg text-xs font-semibold";

  return (
    <div>
      {head}
      <div className="rounded-xl mt-1.5 px-3 py-2.5" style={{ background: "#fafafa", border: BORDER }}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          {card ? (
            <span className="text-sm" style={{ color: "#111111" }}>
              <span className="font-semibold">{card.brand} •••• {card.last4}</span>
              <span className="text-xs" style={{ color: "#949494" }}>{card.saved_by ? ` · saved by ${card.saved_by}` : ""}{card.saved_at ? `, ${when(card.saved_at)}` : ""}</span>
            </span>
          ) : <span className="text-xs" style={{ color: "#4a4a4a" }}>No card saved for this client.</span>}
          {mode === "idle" && !shown && (
            <span className="flex items-center gap-1.5">
              {card && status.can_reveal && <button type="button" className={btn} style={{ background: "#000000", color: "#ffffff" }} onClick={() => { setError(null); setMode("ask"); }}>Show card</button>}
              <button type="button" className={btn} style={{ background: "rgba(0,0,0,0.06)", color: "#111111" }} onClick={() => { setError(null); setMode("add"); }}>{card ? "Replace" : "Add card"}</button>
              {card && status.can_reveal && <button type="button" className="text-xs px-1" style={{ color: "#949494" }} onClick={() => { setError(null); setMode("confirm-delete"); }}>Delete</button>}
            </span>
          )}
        </div>

        {mode === "add" && (
          <div className="mt-3">
            <CardFields value={draft} onChange={c => { setError(null); setDraft(c); }} idPrefix={`vault-${clientId.slice(0, 6)}`} />
            <div className="flex items-center justify-end gap-2 mt-3">
              <button type="button" className="text-xs px-2" style={{ color: "#767676" }} onClick={reset}>Cancel</button>
              <button type="button" disabled={busy || !cardStarted(draft)} className={btn} style={{ background: "#000000", color: "#ffffff", opacity: busy || !cardStarted(draft) ? 0.4 : 1 }} onClick={save}>
                {busy ? "Saving…" : "Save card"}
              </button>
            </div>
          </div>
        )}

        {mode === "ask" && (
          <form className="mt-3" onSubmit={e => { e.preventDefault(); reveal(); }}>
            <label htmlFor={`vault-pw-${clientId.slice(0, 6)}`} className="block text-xs font-semibold mb-1.5" style={{ color: "#4a4a4a" }}>Your dashboard password, to show this card</label>
            <div className="flex gap-2">
              <input id={`vault-pw-${clientId.slice(0, 6)}`} type="password" autoFocus autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)}
                className="flex-1 px-3 py-1.5 rounded-lg text-sm outline-none" style={{ ...INPUT, minWidth: 0 }} />
              <button type="submit" disabled={busy || !password} className={btn} style={{ background: "#000000", color: "#ffffff", opacity: busy || !password ? 0.4 : 1 }}>{busy ? "Checking…" : "Show"}</button>
              <button type="button" className="text-xs px-1" style={{ color: "#767676" }} onClick={reset}>Cancel</button>
            </div>
            <p className="text-xs mt-1.5" style={{ color: "#949494" }}>Each view is logged with your name and the time.</p>
          </form>
        )}

        {mode === "confirm-delete" && (
          <div className="flex items-center justify-end gap-2 mt-3">
            <span className="text-xs" style={{ color: "#4a4a4a" }}>Delete this card for good?</span>
            <button type="button" disabled={busy} className={btn} style={{ color: "#b91c1c", background: "rgba(185,28,28,0.12)" }} onClick={remove}>{busy ? "Deleting…" : "Delete card"}</button>
            <button type="button" className="text-xs px-1" style={{ color: "#767676" }} onClick={reset}>Cancel</button>
          </div>
        )}

        {shown && (
          <div className="mt-3">
            <CopyRow label="Name on card" value={shown.name} />
            <CopyRow label="Card number" value={formatNumber(shown.number)} />
            <CopyRow label="Expiry" value={shown.exp} />
            <CopyRow label="Security code" value={shown.cvc} />
            <CopyRow label="Billing zip code" value={shown.zip} />
            <div className="flex items-center justify-between pt-2" style={{ borderTop: BORDER }}>
              <span className="text-xs" style={{ color: "#949494" }}>Hides itself in {left}s</span>
              <button type="button" className={btn} style={{ background: "rgba(0,0,0,0.06)", color: "#111111" }} onClick={() => setShown(null)}>Hide now</button>
            </div>
          </div>
        )}

        {error && <p className="text-xs mt-2" style={{ color: "#b91c1c" }}>{error}</p>}

        {!!status.history?.length && (
          <details className="mt-2">
            <summary className="text-xs cursor-pointer" style={{ color: "#949494" }}>Who has touched this card</summary>
            <ul className="mt-1 space-y-0.5">
              {status.history.map((h, i) => (
                <li key={i} className="text-xs" style={{ color: h.action === "denied" ? "#b91c1c" : "#4a4a4a" }}>{ACTION[h.action] ?? h.action} by {h.user_name} · {when(h.at)}</li>
              ))}
            </ul>
          </details>
        )}
      </div>
      <p className="text-xs mt-1.5" style={{ color: "#949494" }}>Stored encrypted. Only an admin can view it, with their password.</p>
    </div>
  );
}
