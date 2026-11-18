"use client";

// A client's card, stored locked (lib/card-vault.ts has the rules). This is the
// only screen that takes a card in or shows one. Cards are locked and unlocked
// here in the browser (lib/vault-crypto.ts): saving needs no password; showing
// one takes an admin and the vault password, which never leaves this page.

import { useEffect, useState } from "react";
import { EMPTY_CARD, brandOf, cardProblem, cardStarted, formatExp, formatNumber, tidyCard, type CardInput } from "@/lib/card-format";
import { changePassword, createVault, lockCard, openCard, passwordProblem, type Envelope, type KeyMaterial } from "@/lib/vault-crypto";

const BORDER = "1px solid rgba(0,0,0,0.08)";
const INPUT = { background: "#ffffff", border: "1px solid rgba(0,0,0,0.162)", color: "#111111" } as const;
const SHOW_SECONDS = 60;

type Summary = { brand: string; last4: string; saved_by: string | null; saved_at: string | null };
type Status = {
  enabled: boolean; ready: boolean; setup?: boolean; public_key?: string | null; can_reveal?: boolean;
  card?: Summary | null; history?: { user_name: string; action: string; at: string }[]; error?: string;
};

const ACTION: Record<string, string> = { saved: "Saved", replaced: "Replaced", revealed: "Opened", denied: "Refused", deleted: "Deleted" };
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
const readStatus = (clientId?: string): Promise<Status> =>
  fetch(`/api/card-vault${clientId ? `?client_id=${encodeURIComponent(clientId)}` : ""}`, { cache: "no-store" }).then(r => r.json());

/**
 * Whether a card can be saved here: storage on, and the vault password set.
 * `waiting` = on but no vault password yet; `admin` = this person may set it.
 */
export function useCardVault(): { on: boolean; waiting: boolean; admin: boolean; checked: boolean; refresh: () => void } {
  const [state, setState] = useState({ on: false, waiting: false, admin: false, checked: false });
  const [tick, setTick] = useState(0);
  useEffect(() => {
    readStatus().then(d => setState({ on: !!d.enabled && !!d.ready && !!d.setup, waiting: !!d.enabled && !!d.ready && !d.setup, admin: !!d.can_reveal, checked: true }))
      .catch(() => setState({ on: false, waiting: false, admin: false, checked: true }));
  }, [tick]);
  return { ...state, refresh: () => setTick(n => n + 1) };
}

/** Lock a card in this browser and save it for a client. */
export async function saveCard(clientId: string, card: CardInput, publicKey?: string | null): Promise<{ card?: Summary; error?: string }> {
  try {
    const key = publicKey ?? (await readStatus()).public_key;
    if (!key) return { error: "The vault password has not been set yet" };
    const clean = tidyCard(card);
    const envelope = await lockCard(key, clean, clientId);
    return await call({ action: "save", client_id: clientId, envelope, brand: brandOf(clean.number), last4: clean.number.slice(-4) });
  } catch {
    return { error: "This browser could not lock the card" };
  }
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

function Secret({ id, label, value, onChange, autoFocus = false }: { id: string; label: string; value: string; onChange: (v: string) => void; autoFocus?: boolean }) {
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-semibold mb-1.5" style={{ color: "#4a4a4a" }}>{label}</label>
      <input id={id} type="password" autoFocus={autoFocus} autoComplete="off" data-lpignore="true" data-1p-ignore value={value} onChange={e => onChange(e.target.value)}
        className="w-full px-3 py-1.5 rounded-lg text-sm outline-none" style={INPUT} />
    </div>
  );
}

/**
 * Choosing the vault password, once. Shown to admins wherever a card would be
 * saved — the survey and the onboarding card — until it has been set. Not a
 * <form> on purpose: it sits inside the survey's own form.
 */
export function VaultSetup({ onDone, idPrefix = "vault-setup" }: { onDone: () => void; idPrefix?: string }) {
  const [open, setOpen] = useState(false);
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = !busy && agreed && !!next;

  async function submit() {
    if (!ready) return;
    const problem = passwordProblem(next, again);
    if (problem) { setError(problem); return; }
    setBusy(true); setError(null);
    try {
      const r = await call({ action: "setup", ...(await createVault(next)) });
      if (r.error) setError(r.error);
      else { setNext(""); setAgain(""); onDone(); }
    } catch (e) { setError(e instanceof Error ? e.message : "This browser could not set up the vault"); }
    setBusy(false);
  }
  const onEnter = (e: React.KeyboardEvent) => { if (e.key === "Enter") { e.preventDefault(); submit(); } };

  if (!open) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs" style={{ color: "#4a4a4a" }}>Set a vault password before any card can be saved.</span>
        <button type="button" className="px-3 py-1.5 rounded-lg text-xs font-semibold" style={{ background: "#000000", color: "#ffffff" }} onClick={() => setOpen(true)}>Set Vault Password</button>
      </div>
    );
  }
  return (
    <div className="space-y-3" onKeyDown={onEnter}>
      <p className="text-xs" style={{ color: "#4a4a4a" }}>
        This password opens every stored card. It is not saved anywhere — not in the dashboard, not by anyone who works on it.
        <span className="font-semibold" style={{ color: "#b91c1c" }}> If it is forgotten, the stored cards are gone for good.</span> Write it down somewhere safe.
      </p>
      <Secret id={`${idPrefix}-new`} label="Vault Password (12 characters or more)" value={next} onChange={v => { setError(null); setNext(v); }} autoFocus />
      <Secret id={`${idPrefix}-again`} label="Type It Again" value={again} onChange={v => { setError(null); setAgain(v); }} />
      <label className="flex items-start gap-2 text-xs" style={{ color: "#4a4a4a" }}>
        <input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)} className="mt-0.5" />
        I have written it down, and I understand it cannot be recovered.
      </label>
      <div className="flex items-center justify-end gap-2">
        <button type="button" className="text-xs px-2" style={{ color: "#767676" }} onClick={() => { setOpen(false); setNext(""); setAgain(""); setAgreed(false); setError(null); }}>Cancel</button>
        <button type="button" disabled={!ready} onClick={submit} className="px-3 py-1.5 rounded-lg text-xs font-semibold" style={{ background: "#000000", color: "#ffffff", opacity: ready ? 1 : 0.4 }}>{busy ? "Setting Up…" : "Set Vault Password"}</button>
      </div>
      {error && <p className="text-xs" style={{ color: "#b91c1c" }}>{error}</p>}
    </div>
  );
}

type Mode = "idle" | "add" | "ask" | "confirm-delete" | "change";

export default function CardVaultPanel({ clientId }: { clientId: string }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [mode, setMode] = useState<Mode>("idle");
  const [draft, setDraft] = useState<CardInput>(EMPTY_CARD);
  const [pw, setPw] = useState({ current: "", next: "", again: "" });
  const [shown, setShown] = useState<CardInput | null>(null);
  const [left, setLeft] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reloads, setReloads] = useState(0);
  const uid = clientId.slice(0, 6);

  useEffect(() => {
    readStatus(clientId).then(d => setStatus(d)).catch(() => setStatus({ enabled: false, ready: false, error: "Could not load the card" }));
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

  const reset = () => { setMode("idle"); setDraft(EMPTY_CARD); setPw({ current: "", next: "", again: "" }); setError(null); };
  const go = (m: Mode) => { setError(null); setNotice(null); setMode(m); };
  const fail = (e: unknown, fallback: string) => setError(e instanceof Error ? e.message : fallback);

  async function change() {
    const problem = passwordProblem(pw.next, pw.again);
    if (problem) { setError(problem); return; }
    setBusy(true); setError(null);
    try {
      const got = await call({ action: "key" });
      if (got.error || !got.key) setError(got.error ?? "Could not reach the vault");
      else {
        const r = await call({ action: "rewrap", ...(await changePassword(got.key as KeyMaterial, pw.current, pw.next)) });
        if (r.error) setError(r.error);
        else { reset(); setNotice("Vault password changed."); }
      }
    } catch (e) { fail(e, "Could not change the vault password"); }
    setBusy(false);
  }

  async function save() {
    const problem = cardProblem(draft);
    if (problem) { setError(problem); return; }
    setBusy(true); setError(null);
    const r = await saveCard(clientId, draft, status?.public_key);
    setBusy(false);
    if (r.error) { setError(r.error); return; }
    reset(); setShown(null); setReloads(n => n + 1);
  }

  async function reveal() {
    if (!pw.current) return;
    setBusy(true); setError(null);
    try {
      const r = await call({ action: "open", client_id: clientId });
      if (r.error || !r.envelope || !r.key) setError(r.error ?? "Could not fetch the card");
      else {
        const card = await openCard(r.key as KeyMaterial, pw.current, r.envelope as Envelope, clientId);
        reset(); setShown(card); setLeft(SHOW_SECONDS); setReloads(n => n + 1);
      }
    } catch (e) { fail(e, "Could not open the card"); setPw(p => ({ ...p, current: "" })); }
    setBusy(false);
  }

  async function remove() {
    setBusy(true); setError(null);
    const r = await call({ action: "delete", client_id: clientId });
    setBusy(false);
    if (r.error) { setError(r.error); return; }
    reset(); setShown(null); setReloads(n => n + 1);
  }

  if (!status) return null;
  const head = <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#949494" }}>Card on File</p>;
  const btn = "px-3 py-1.5 rounded-lg text-xs font-semibold";
  const black = { background: "#000000", color: "#ffffff" };
  const grey = { background: "rgba(0,0,0,0.06)", color: "#111111" };

  if (!status.ready || !status.enabled) {
    return (
      <div>
        {head}
        <p className="text-xs mt-1.5" style={{ color: "#949494" }}>{!status.ready ? (status.error ?? "Card storage needs a database update first.") : "Card storage is not switched on yet."}</p>
      </div>
    );
  }

  // Nothing can be saved until an admin has chosen the vault password.
  if (!status.setup) {
    return (
      <div>
        {head}
        <div className="rounded-xl mt-1.5 px-3 py-3" style={{ background: "#fafafa", border: BORDER }}>
          {!status.can_reveal ? (
            <p className="text-xs" style={{ color: "#4a4a4a" }}>Cards can be saved once an admin has set the vault password.</p>
          ) : (
            <VaultSetup idPrefix={`vault-setup-${uid}`} onDone={() => { setNotice("Vault password set. Cards can be saved now."); setReloads(n => n + 1); }} />
          )}
          {error && <p className="text-xs mt-2" style={{ color: "#b91c1c" }}>{error}</p>}
        </div>
      </div>
    );
  }

  const card = status.card ?? null;
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
              {card && status.can_reveal && <button type="button" className={btn} style={black} onClick={() => go("ask")}>Show Card</button>}
              <button type="button" className={btn} style={grey} onClick={() => go("add")}>{card ? "Replace" : "Add Card"}</button>
              {card && status.can_reveal && <button type="button" className="text-xs px-1" style={{ color: "#949494" }} onClick={() => go("confirm-delete")}>Delete</button>}
            </span>
          )}
        </div>

        {mode === "add" && (
          <div className="mt-3">
            <CardFields value={draft} onChange={c => { setError(null); setDraft(c); }} idPrefix={`vault-${uid}`} />
            <div className="flex items-center justify-end gap-2 mt-3">
              <button type="button" className="text-xs px-2" style={{ color: "#767676" }} onClick={reset}>Cancel</button>
              <button type="button" disabled={busy || !cardStarted(draft)} className={btn} style={{ ...black, opacity: busy || !cardStarted(draft) ? 0.4 : 1 }} onClick={save}>
                {busy ? "Saving…" : "Save Card"}
              </button>
            </div>
          </div>
        )}

        {mode === "ask" && (
          <form className="mt-3" onSubmit={e => { e.preventDefault(); reveal(); }}>
            <div className="flex items-end gap-2">
              <div className="flex-1" style={{ minWidth: 0 }}>
                <Secret id={`vault-pw-${uid}`} label="Vault Password" value={pw.current} onChange={v => { setError(null); setPw(p => ({ ...p, current: v })); }} autoFocus />
              </div>
              <button type="submit" disabled={busy || !pw.current} className={btn} style={{ ...black, opacity: busy || !pw.current ? 0.4 : 1 }}>{busy ? "Opening…" : "Show"}</button>
              <button type="button" className="text-xs px-1 pb-2" style={{ color: "#767676" }} onClick={reset}>Cancel</button>
            </div>
            <p className="text-xs mt-1.5" style={{ color: "#949494" }}>Each opening is logged with your name and the time.</p>
          </form>
        )}

        {mode === "change" && (
          <form className="mt-3 space-y-3" onSubmit={e => { e.preventDefault(); change(); }}>
            <Secret id={`vault-old-${uid}`} label="Current Vault Password" value={pw.current} onChange={v => { setError(null); setPw(p => ({ ...p, current: v })); }} autoFocus />
            <Secret id={`vault-new-${uid}`} label="New Vault Password (12 characters or more)" value={pw.next} onChange={v => { setError(null); setPw(p => ({ ...p, next: v })); }} />
            <Secret id={`vault-again-${uid}`} label="Type the New One Again" value={pw.again} onChange={v => { setError(null); setPw(p => ({ ...p, again: v })); }} />
            <div className="flex items-center justify-end gap-2">
              <button type="button" className="text-xs px-2" style={{ color: "#767676" }} onClick={reset}>Cancel</button>
              <button type="submit" disabled={busy || !pw.current || !pw.next} className={btn} style={{ ...black, opacity: busy || !pw.current || !pw.next ? 0.4 : 1 }}>{busy ? "Changing…" : "Change Vault Password"}</button>
            </div>
          </form>
        )}

        {mode === "confirm-delete" && (
          <div className="flex items-center justify-end gap-2 mt-3">
            <span className="text-xs" style={{ color: "#4a4a4a" }}>Delete this card for good?</span>
            <button type="button" disabled={busy} className={btn} style={{ color: "#b91c1c", background: "rgba(185,28,28,0.12)" }} onClick={remove}>{busy ? "Deleting…" : "Delete Card"}</button>
            <button type="button" className="text-xs px-1" style={{ color: "#767676" }} onClick={reset}>Cancel</button>
          </div>
        )}

        {shown && (
          <div className="mt-3">
            <CopyRow label="Name on Card" value={shown.name} />
            <CopyRow label="Card Number" value={formatNumber(shown.number)} />
            <CopyRow label="Expiry" value={shown.exp} />
            <CopyRow label="Security Code" value={shown.cvc} />
            <CopyRow label="Billing Zip Code" value={shown.zip} />
            <div className="flex items-center justify-between pt-2" style={{ borderTop: BORDER }}>
              <span className="text-xs" style={{ color: "#949494" }}>Hides itself in {left}s</span>
              <button type="button" className={btn} style={grey} onClick={() => setShown(null)}>Hide Now</button>
            </div>
          </div>
        )}

        {error && <p className="text-xs mt-2" style={{ color: "#b91c1c" }}>{error}</p>}
        {notice && <p className="text-xs mt-2" style={{ color: "#15803d" }}>{notice}</p>}

        {!!status.history?.length && (
          <details className="mt-2">
            <summary className="text-xs cursor-pointer" style={{ color: "#949494" }}>Who Has Touched This Card</summary>
            <ul className="mt-1 space-y-0.5">
              {status.history.map((h, i) => (
                <li key={i} className="text-xs" style={{ color: h.action === "denied" ? "#b91c1c" : "#4a4a4a" }}>{ACTION[h.action] ?? h.action} by {h.user_name} · {when(h.at)}</li>
              ))}
            </ul>
          </details>
        )}
      </div>
      <p className="text-xs mt-1.5" style={{ color: "#949494" }}>
        Locked with the vault password. Only an admin who knows it can open a card.
        {status.can_reveal && mode === "idle" && <> <button type="button" className="underline" onClick={() => go("change")}>Change Vault Password</button></>}
      </p>
    </div>
  );
}
