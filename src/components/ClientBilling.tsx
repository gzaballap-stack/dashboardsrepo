"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

/* ────────────────────────────────────────────────────────────────────────────
   Client Billing

   Every client on the roster, with what they have been charged and credited.
   Open a client to see their appointments — each one is To bill, Charged
   or Credited — and to charge the ones you pick, credit ones that went wrong,
   or charge a one-off amount.

   A charge goes to the client's saved card, out as an emailed invoice (both
   through Stripe), or is just recorded when they paid some other way. Credit
   on an appointment that was already charged is owed back as a free
   appointment: the client's next booking is marked "Covered by credit" on its
   own and never billed. Until that booking exists the credit shows as still
   owed. Every figure is worked out by the API from the charges and credits
   themselves.
   ──────────────────────────────────────────────────────────────────────────── */

type StripeState = { configured: boolean; test: boolean };

type ClientRow = {
  id: string; name: string; status: string;
  price: number; stripe_linked: boolean;
  appointments: number; uncharged: number; uncharged_value: number;
  charged: number; paid: number; outstanding: number; credited: number; balance: number;
  covered: number; credits_owed: number;
};

type ApptBilling = {
  state: "charged" | "credited" | "covered"; price: number; charged: boolean;
  charge_id: string | null; charge_status: string | null;
  credit_amount: number; credited_at: string | null; credit_reason: string | null;
};

type Appointment = {
  event_id: string; outcome: string; booked_at: string; scheduled_at: string | null;
  lead_name: string | null; lead_phone: string | null; calendar: string | null;
  billing: ApptBilling | null;
};

type Charge = {
  id: string; kind: "appointments" | "custom"; description: string; appointment_count: number;
  subtotal: number; credit_applied: number; total: number;
  method: "card" | "invoice" | "manual"; status: "draft" | "pending" | "paid" | "failed" | "void";
  stripe_invoice_url: string | null; error: string | null; created_at: string; paid_at: string | null;
};

// One line of a client's credit history: a credit issued (for an appointment,
// or added by hand), or credit used (a booking it covered, or part of a charge).
type LedgerEntry = {
  type: "issued" | "used"; source: "appointment" | "manual" | "cover" | "charge";
  id: string; at: string; amount: number;
  lead_name: string | null; appointment_at: string | null; reason: string | null;
};

type Customer = { id: string; name: string | null; email: string | null; payment?: { id: string | null; label: string } | null };

type Detail = {
  client: { id: string; name: string; status: string };
  settings: { price: number; stripe_customer_id: string | null };
  customer: Customer | null; customer_error: string | null;
  balance: number; credits_owed: number;
  appointments: Appointment[]; ledger: LedgerEntry[]; charges: Charge[];
};

type Method = "card" | "invoice" | "manual";

const CARD = "#ffffff";
const BORDER = "1px solid rgba(0,0,0,0.07)";
const SHADOW = "0 1px 2px rgba(0,0,0,0.03), 0 10px 28px -12px rgba(0,0,0,0.10)";
const INK = "#111111";
const MUTED = "#767676";
const FAINT = "#a8a8a8";
const GOOD = "#1a7f4b";
const BAD = "#b4472e";
const WARN = "#8a6100";
const FREE = "#2b5fad";

const PANEL: React.CSSProperties = { background: CARD, border: BORDER, boxShadow: SHADOW, borderRadius: 16 };
const FIELD: React.CSSProperties = {
  padding: "8px 10px", borderRadius: 9, fontSize: 13, color: INK, background: CARD,
  border: "1px solid rgba(0,0,0,0.14)", outline: "none", fontFamily: "inherit", minWidth: 0,
};
const BTN: React.CSSProperties = { padding: "8px 14px", borderRadius: 10, fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap" };
const BTN_DARK: React.CSSProperties = { ...BTN, background: "#000000", color: "#ffffff" };
const BTN_QUIET: React.CSSProperties = { ...BTN, background: "rgba(0,0,0,0.06)", color: "#4a4a4a" };
const TH: React.CSSProperties = { textAlign: "left", fontSize: 11, fontWeight: 600, color: MUTED, padding: "8px 10px", whiteSpace: "nowrap" };
const TD: React.CSSProperties = { fontSize: 13, color: INK, padding: "9px 10px", borderTop: "1px solid rgba(0,0,0,0.05)", verticalAlign: "middle" };
const NUM: React.CSSProperties = { textAlign: "right", fontVariantNumeric: "tabular-nums" };

/* ── helpers ──────────────────────────────────────────────────────────────── */

function money(n: number): string {
  const whole = Math.abs(n % 1) < 0.005;
  const digits = whole ? 0 : 2;
  const text = Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return `${n < 0 ? "−" : ""}$${text}`;
}

// "$1,200.50" → 1200.5. Blank or unreadable is null.
function parseAmount(text: string): number | null {
  const clean = text.replace(/[$,\s]/g, "");
  if (!clean) return null;
  const n = Number(clean);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

const cents = (n: number) => Math.round(n * 100);

function day(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

type PeriodId = "this_month" | "last_month" | "last_30" | "last_90" | "all";
const PERIODS: { id: PeriodId; label: string }[] = [
  { id: "this_month", label: "This month" },
  { id: "last_month", label: "Last month" },
  { id: "last_30", label: "30 days" },
  { id: "last_90", label: "90 days" },
  { id: "all", label: "All time" },
];

function rangeOf(id: PeriodId): { start: string | null; end: string | null } {
  const now = new Date();
  if (id === "all") return { start: null, end: null };
  if (id === "this_month") return { start: ymd(new Date(now.getFullYear(), now.getMonth(), 1)), end: ymd(now) };
  if (id === "last_month") {
    return { start: ymd(new Date(now.getFullYear(), now.getMonth() - 1, 1)), end: ymd(new Date(now.getFullYear(), now.getMonth(), 0)) };
  }
  const back = new Date(now);
  back.setDate(back.getDate() - (id === "last_30" ? 29 : 89));
  return { start: ymd(back), end: ymd(now) };
}

function query(params: Record<string, string | null | undefined>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) q.set(k, v);
  const text = q.toString();
  return text ? `?${text}` : "";
}

async function api(url: string, body?: unknown) {
  const res = await fetch(url, body === undefined ? undefined : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "Something went wrong");
  return data;
}

// One id per charge dialog, so pressing twice can't make two charges.
let idCounter = 0;
function newRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  idCounter += 1;
  return `req-${Date.now()}-${idCounter}`;
}

const OUTCOME: Record<string, string> = { appointment_booked: "Booked", show: "Showed", no_show: "No-show" };

const METHOD_LABEL: Record<Method, string> = { card: "Card", invoice: "Invoice", manual: "Recorded" };

const CHARGE_STATUS: Record<Charge["status"], { label: string; color: string }> = {
  paid:    { label: "Paid", color: GOOD },
  pending: { label: "Awaiting payment", color: WARN },
  draft:   { label: "In progress", color: MUTED },
  failed:  { label: "Failed", color: BAD },
  void:    { label: "Cancelled", color: FAINT },
};

/* ── small pieces ─────────────────────────────────────────────────────────── */

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "good" | "bad" | "warn" }) {
  return (
    <div style={{ ...PANEL, padding: "14px 16px" }}>
      <p style={{ fontSize: 11, fontWeight: 600, color: MUTED, marginBottom: 8 }}>{label}</p>
      <p style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em", color: tone === "good" ? GOOD : tone === "bad" ? BAD : tone === "warn" ? WARN : INK }}>{value}</p>
      {sub && <p style={{ fontSize: 11, color: FAINT, marginTop: 6 }}>{sub}</p>}
    </div>
  );
}

const TILE_GRID: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 };

function Pill({ text, color, title }: { text: string; color: string; title?: string }) {
  return (
    <span title={title} style={{
      display: "inline-block", padding: "2px 8px", borderRadius: 999, fontSize: 11.5, fontWeight: 600,
      color, background: "rgba(0,0,0,0.045)", whiteSpace: "nowrap",
    }}>{text}</span>
  );
}

function Segments<T extends string>({ value, options, onChange }: {
  value: T; options: { id: T; label: string }[]; onChange: (id: T) => void;
}) {
  return (
    <div style={{ display: "flex", background: "rgba(0,0,0,0.05)", borderRadius: 10, padding: 3, flexWrap: "wrap" }}>
      {options.map(o => (
        <button key={o.id} onClick={() => onChange(o.id)}
          style={{
            padding: "6px 12px", borderRadius: 8, fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap",
            background: value === o.id ? "#ffffff" : "transparent",
            color: value === o.id ? INK : MUTED,
            boxShadow: value === o.id ? "0 1px 3px rgba(0,0,0,0.10)" : "none",
          }}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Notice({ tone, children, onDismiss }: { tone: "bad" | "good" | "warn"; children: React.ReactNode; onDismiss?: () => void }) {
  const color = tone === "bad" ? BAD : tone === "good" ? GOOD : WARN;
  const bg = tone === "bad" ? "rgba(180,71,46,0.08)" : tone === "good" ? "rgba(26,127,75,0.08)" : "rgba(138,97,0,0.08)";
  return (
    <div role={tone === "bad" ? "alert" : "status"} style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 12.5, color, background: bg, borderRadius: 10, padding: "9px 12px" }}>
      <span style={{ flex: 1 }}>{children}</span>
      {onDismiss && <button onClick={onDismiss} style={{ fontWeight: 600, color }}>Dismiss</button>}
    </div>
  );
}

function Modal({ title, sub, onClose, children, width = 480 }: {
  title: string; sub?: string; onClose: () => void; children: React.ReactNode; width?: number;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={title}
      onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}
      style={{ position: "fixed", inset: 0, zIndex: 100, background: "rgba(0,0,0,0.42)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div style={{ width: `min(${width}px, 100%)`, maxHeight: "100%", overflowY: "auto", background: "#f6f6f5", borderRadius: 18, padding: 20, display: "flex", flexDirection: "column", gap: 14, boxShadow: "0 24px 60px rgba(0,0,0,0.30)" }}>
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h3 style={{ fontSize: 18, fontWeight: 700, color: INK, letterSpacing: "-0.02em" }}>{title}</h3>
            {sub && <p style={{ fontSize: 12.5, color: MUTED, marginTop: 2 }}>{sub}</p>}
          </div>
          <button onClick={onClose} style={{ ...BTN_QUIET, padding: "7px 11px" }}>Close</button>
        </div>
        {children}
      </div>
    </div>,
    document.body,
  );
}

const LABEL: React.CSSProperties = { fontSize: 11.5, fontWeight: 600, color: MUTED, display: "flex", flexDirection: "column", gap: 5 };

/* ── charge ───────────────────────────────────────────────────────────────── */

function ChargeModal({ detail, stripe, eventIds, onClose, onDone }: {
  detail: Detail; stripe: StripeState; eventIds: string[];
  onClose: () => void; onDone: (message: string, failed?: boolean) => void;
}) {
  const count = eventIds.length;
  const [price, setPrice] = useState(detail.settings.price ? String(detail.settings.price) : "");
  const [custom, setCustom] = useState("");
  const [note, setNote] = useState("");
  const [creditText, setCreditText] = useState<string | null>(null);   // null = use all there is
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requestId, setRequestId] = useState(newRequestId);

  const customer = detail.customer;
  const cardWhy = !stripe.configured ? "Stripe isn't connected yet"
    : !customer ? (detail.customer_error ?? "Link their Stripe customer first")
    : !customer.payment ? "No card on file in Stripe" : null;
  const invoiceWhy = !stripe.configured ? "Stripe isn't connected yet"
    : !customer ? (detail.customer_error ?? "Link their Stripe customer first")
    : !customer.email ? "Their Stripe customer has no email" : null;
  const [method, setMethod] = useState<Method>(cardWhy === null ? "card" : invoiceWhy === null ? "invoice" : "manual");

  const unit = parseAmount(price) ?? 0;
  const subtotal = count ? (cents(unit) * count) / 100 : (parseAmount(custom) ?? 0);
  const available = Math.max(0, Math.min(detail.balance, subtotal));
  const typedCredit = creditText === null ? available : (parseAmount(creditText) ?? 0);
  const credit = Math.max(0, Math.min(typedCredit, available));
  const total = (cents(subtotal) - cents(credit)) / 100;
  const covered = subtotal > 0 && total === 0;
  const effective: Method = covered ? "manual" : method;

  const blocked = subtotal <= 0 ? (count ? "Set a price per appointment" : "Enter an amount")
    : effective === "card" ? cardWhy
    : effective === "invoice" ? invoiceWhy
    : null;
  const tooSmall = effective !== "manual" && total > 0 && total < 0.5 ? "Stripe needs at least $0.50" : null;

  const submit = async () => {
    if (busy || blocked || tooSmall) return;
    setBusy(true); setError(null);
    try {
      const done = await api("/api/billing", {
        action: "charge", client_id: detail.client.id, event_ids: eventIds,
        price: count ? unit : undefined, amount: count ? undefined : subtotal,
        description: note, apply_credit: credit, expected_total: total,
        method: effective, request_id: requestId,
      });
      onDone(`${money(total)} — ${done.message ?? "done"}`);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Something went wrong";
      // Stripe was reached (or may have been): the charge is on record, so
      // close and show it rather than invite a second attempt.
      if (/card failed|couldn't confirm|still open in stripe/i.test(message)) onDone(message, true);
      else { setError(message); setBusy(false); setRequestId(newRequestId()); }
    }
  };

  const action = covered ? "Use credit"
    : effective === "card" ? `Charge ${money(total)} now`
    : effective === "invoice" ? `Email invoice for ${money(total)}`
    : `Record ${money(total)} as paid`;

  const option = (id: Method, title: string, sub: string, why: string | null) => (
    <label key={id} style={{
      display: "flex", gap: 10, alignItems: "flex-start", padding: "10px 12px", borderRadius: 12, cursor: why ? "not-allowed" : "pointer",
      background: CARD, border: method === id && !why ? "1.5px solid #000000" : BORDER, opacity: why ? 0.55 : 1,
    }}>
      <input type="radio" name="billing-method" checked={method === id} disabled={!!why} onChange={() => setMethod(id)} style={{ marginTop: 3 }} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: INK }}>{title}</span>
        <span style={{ display: "block", fontSize: 12, color: why ? BAD : MUTED, marginTop: 1 }}>{why ?? sub}</span>
      </span>
    </label>
  );

  return (
    <Modal title={`Charge ${detail.client.name}`} sub={count ? plural(count, "appointment") : "A one-off amount"} onClose={busy ? () => {} : onClose}>
      <div style={{ ...PANEL, padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
        {count ? (
          <label style={LABEL}>
            Price per appointment
            <input value={price} onChange={e => setPrice(e.target.value)} inputMode="decimal" placeholder="$0" autoFocus={!price} style={FIELD} />
          </label>
        ) : (
          <label style={LABEL}>
            Amount
            <input value={custom} onChange={e => setCustom(e.target.value)} inputMode="decimal" placeholder="$0" autoFocus style={FIELD} />
          </label>
        )}
        <label style={LABEL}>
          {count ? "Note on the invoice (optional)" : "What it's for"}
          <input value={note} onChange={e => setNote(e.target.value)} maxLength={300}
            placeholder={count ? `${plural(count, "appointment")}` : "e.g. Setup fee"} style={FIELD} />
        </label>
        {detail.balance > 0 && (
          <label style={LABEL}>
            Credit to use — {money(detail.balance)} available
            <input value={creditText ?? (available ? String(available) : "")} onChange={e => setCreditText(e.target.value)}
              inputMode="decimal" placeholder="$0" style={FIELD} />
          </label>
        )}

        <div style={{ borderTop: "1px solid rgba(0,0,0,0.07)", paddingTop: 12, display: "flex", flexDirection: "column", gap: 5, fontSize: 13, color: MUTED }}>
          <div style={{ display: "flex" }}>
            <span style={{ flex: 1 }}>{count ? `${count} × ${money(unit)}` : "Amount"}</span>
            <span style={NUM}>{money(subtotal)}</span>
          </div>
          {credit > 0 && (
            <div style={{ display: "flex" }}>
              <span style={{ flex: 1 }}>Credit</span>
              <span style={NUM}>{money(-credit)}</span>
            </div>
          )}
          <div style={{ display: "flex", alignItems: "baseline", color: INK, marginTop: 4 }}>
            <span style={{ flex: 1, fontWeight: 700 }}>Total</span>
            <span style={{ ...NUM, fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em" }}>{money(total)}</span>
          </div>
        </div>
      </div>

      {covered ? (
        <Notice tone="good">Their credit covers all of it — nothing to collect.</Notice>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {option("card", "Charge their card now", customer?.payment?.label ?? "", cardWhy)}
          {option("invoice", "Email an invoice", customer?.email ? `To ${customer.email} — they pay from the link` : "", invoiceWhy)}
          {option("manual", "Already paid — just record it", "Nothing is sent to Stripe", null)}
        </div>
      )}

      {stripe.configured && stripe.test && effective !== "manual" && (
        <Notice tone="warn">Stripe is in test mode — no real money moves.</Notice>
      )}
      {error && <Notice tone="bad">{error}</Notice>}

      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button onClick={submit} disabled={busy || !!blocked || !!tooSmall}
          style={{ ...BTN_DARK, padding: "10px 18px", fontSize: 13, opacity: busy || blocked || tooSmall ? 0.35 : 1 }}>
          {busy ? "Working…" : action}
        </button>
        {(blocked || tooSmall) && !busy && <span style={{ fontSize: 12.5, color: MUTED }}>{blocked ?? tooSmall}</span>}
      </div>
    </Modal>
  );
}

/* ── credit ───────────────────────────────────────────────────────────────── */

function CreditModal({ detail, picked, onClose, onDone }: {
  detail: Detail; picked: Appointment[]; onClose: () => void; onDone: (message: string) => void;
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const charged = picked.filter(a => a.billing?.charged);
  const back = charged.reduce((s, a) => s + (a.billing?.price ?? 0), 0);

  const submit = async () => {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const res = await api("/api/billing", { action: "credit", client_id: detail.client.id, event_ids: picked.map(a => a.event_id), reason });
      const covered = Number(res.covered ?? 0);
      onDone(`Credited ${plural(picked.length, "appointment")}`
        + (covered > 0 ? ` — ${plural(covered, "booking")} now covered by credit` : back > 0 ? " — their next booking won't be billed" : ""));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong"); setBusy(false);
    }
  };

  return (
    <Modal title={`Credit ${plural(picked.length, "appointment")}`} sub={detail.client.name} onClose={busy ? () => {} : onClose}>
      <div style={{ ...PANEL, padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
        <p style={{ fontSize: 13, color: INK, lineHeight: 1.5 }}>
          {charged.length > 0 && <>{plural(charged.length, "appointment")} already charged: {charged.length === 1 ? "it is" : "they are"} owed back, so their next {charged.length === 1 ? "booking" : `${charged.length} bookings`} won&rsquo;t be billed ({money(back)}). </>}
          {picked.length - charged.length > 0 && <>{plural(picked.length - charged.length, "appointment")} not charged yet: {picked.length - charged.length === 1 ? "it" : "they"} won&rsquo;t be billed.</>}
        </p>
        <label style={LABEL}>
          Reason (optional)
          <input value={reason} onChange={e => setReason(e.target.value)} maxLength={300} placeholder="e.g. No-show, out of area" autoFocus
            onKeyDown={e => { if (e.key === "Enter") submit(); }} style={FIELD} />
        </label>
      </div>
      {error && <Notice tone="bad">{error}</Notice>}
      <div>
        <button onClick={submit} disabled={busy} style={{ ...BTN_DARK, padding: "10px 18px", fontSize: 13, opacity: busy ? 0.35 : 1 }}>
          {busy ? "Working…" : `Credit ${plural(picked.length, "appointment")}`}
        </button>
      </div>
    </Modal>
  );
}

/* ── Stripe customer ──────────────────────────────────────────────────────── */

function StripeLinkModal({ detail, onClose, onDone }: {
  detail: Detail; onClose: () => void; onDone: (message: string) => void;
}) {
  const [q, setQ] = useState(detail.client.name);
  const [results, setResults] = useState<Customer[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState(detail.client.name);
  const [email, setEmail] = useState("");

  useEffect(() => {
    let live = true;
    const timer = setTimeout(async () => {
      try {
        const data = await api(`/api/billing/stripe-customers${query({ q })}`);
        if (live) { setResults(data.customers ?? []); setError(null); }
      } catch (e) {
        if (live) { setResults([]); setError(e instanceof Error ? e.message : "Couldn't reach Stripe"); }
      }
    }, 300);
    return () => { live = false; clearTimeout(timer); };
  }, [q]);

  const link = async (id: string | null, label: string) => {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      await api("/api/billing", { action: "settings", client_id: detail.client.id, stripe_customer_id: id ?? "" });
      onDone(label);
    } catch (e) { setError(e instanceof Error ? e.message : "Something went wrong"); setBusy(false); }
  };

  const create = async () => {
    if (busy || !name.trim()) return;
    setBusy(true); setError(null);
    try {
      await api("/api/billing/stripe-customers", { client_id: detail.client.id, name, email });
      onDone("Created in Stripe and linked");
    } catch (e) { setError(e instanceof Error ? e.message : "Something went wrong"); setBusy(false); }
  };

  return (
    <Modal title="Stripe customer" sub={`Who ${detail.client.name} is in Stripe`} onClose={busy ? () => {} : onClose} width={540}>
      <div style={{ ...PANEL, padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
        <input value={q} onChange={e => { setQ(e.target.value); setResults(null); }} placeholder="Search Stripe by name or email" autoFocus style={FIELD} />
        <div style={{ maxHeight: 260, overflowY: "auto", display: "flex", flexDirection: "column" }}>
          {results === null && <p style={{ fontSize: 12.5, color: FAINT, padding: "8px 2px" }}>Searching…</p>}
          {results?.length === 0 && !error && <p style={{ fontSize: 12.5, color: MUTED, padding: "8px 2px" }}>Nobody in Stripe matches. Try fewer letters, or create them below.</p>}
          {results?.map(c => {
            const current = c.id === detail.settings.stripe_customer_id;
            return (
              <div key={c.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 2px", borderTop: "1px solid rgba(0,0,0,0.05)" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 13, fontWeight: 600, color: INK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name ?? "No name"}</p>
                  <p style={{ fontSize: 12, color: MUTED, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.email ?? "No email"}</p>
                </div>
                {current
                  ? <Pill text="Linked" color={GOOD} />
                  : <button onClick={() => link(c.id, `Linked to ${c.name ?? c.email ?? "the Stripe customer"}`)} disabled={busy} style={{ ...BTN_QUIET, opacity: busy ? 0.4 : 1 }}>Link</button>}
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ ...PANEL, padding: 16, display: "flex", flexDirection: "column", gap: 10 }}>
        {!creating ? (
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button onClick={() => setCreating(true)} style={BTN_QUIET}>Not in Stripe yet — create them</button>
            {detail.settings.stripe_customer_id && (
              <button onClick={() => link(null, "Unlinked from Stripe")} disabled={busy} style={{ ...BTN_QUIET, color: BAD }}>Unlink</button>
            )}
          </div>
        ) : (<>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
            <label style={LABEL}>Name<input value={name} onChange={e => setName(e.target.value)} style={FIELD} /></label>
            <label style={LABEL}>Email (for invoices)<input type="email" value={email} onChange={e => setEmail(e.target.value)} style={FIELD} /></label>
          </div>
          <div>
            <button onClick={create} disabled={busy || !name.trim()} style={{ ...BTN_DARK, opacity: busy || !name.trim() ? 0.35 : 1 }}>
              {busy ? "Working…" : "Create in Stripe and link"}
            </button>
          </div>
        </>)}
      </div>
      {error && <Notice tone="bad">{error}</Notice>}
    </Modal>
  );
}

/* ── one client ───────────────────────────────────────────────────────────── */

type ApptFilter = "all" | "uncharged" | "charged" | "credited" | "covered";
type DetailTab = "appointments" | "charges" | "credits";

const stateOf = (a: Appointment): Exclude<ApptFilter, "all"> => (a.billing ? a.billing.state : "uncharged");

function ClientDetail({ clientId, period, stripe, onBack, onChanged }: {
  clientId: string; period: PeriodId; stripe: StripeState; onBack: () => void; onChanged: () => void;
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<{ text: string; bad?: boolean } | null>(null);
  const [tab, setTab] = useState<DetailTab>("appointments");
  const [filter, setFilter] = useState<ApptFilter>("uncharged");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [charging, setCharging] = useState<string[] | null>(null);     // event ids; [] = one-off amount
  const [crediting, setCrediting] = useState<Appointment[] | null>(null);
  const [linking, setLinking] = useState(false);
  const [priceText, setPriceText] = useState("");
  const [busy, setBusy] = useState(false);
  const [creditAmount, setCreditAmount] = useState("");
  const [creditReason, setCreditReason] = useState("");

  const load = useCallback(async () => {
    try {
      const range = rangeOf(period);
      const data = await api(`/api/billing${query({ client_id: clientId, start: range.start, end: range.end })}`);
      const num = (v: unknown) => Number(v ?? 0) || 0;
      const next: Detail = {
        ...data,
        credits_owed: num(data.credits_owed),
        ledger: data.ledger ?? [],
        charges: (data.charges ?? []).map((c: Charge) => ({ ...c, subtotal: num(c.subtotal), credit_applied: num(c.credit_applied), total: num(c.total) })),
      };
      setDetail(next);
      setPriceText(next.settings.price ? String(next.settings.price) : "");
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load");
    }
  }, [clientId, period]);

  useEffect(() => { load(); }, [load]);

  const done = (text: string, failed?: boolean) => {
    setCharging(null); setCrediting(null); setLinking(false);
    setPicked(new Set());
    setFlash({ text, bad: failed });
    load(); onChanged();
  };

  const act = async (body: Record<string, unknown>, text: string) => {
    if (busy) return;
    setBusy(true);
    try { await api("/api/billing", body); done(text); }
    catch (e) { setFlash({ text: e instanceof Error ? e.message : "Something went wrong", bad: true }); }
    finally { setBusy(false); }
  };

  const savePrice = async () => {
    if (!detail) return;
    const value = priceText.trim() === "" ? 0 : parseAmount(priceText);
    if (value === null || value < 0) { setFlash({ text: "Price is not a number", bad: true }); return; }
    if (value === detail.settings.price) return;
    await act({ action: "settings", client_id: clientId, price: value }, `Price set to ${money(value)} per appointment`);
  };

  const counts = useMemo(() => {
    const c = { all: 0, uncharged: 0, charged: 0, credited: 0, covered: 0 };
    for (const a of detail?.appointments ?? []) { c.all++; c[stateOf(a)]++; }
    return c;
  }, [detail]);

  if (!detail) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div><button onClick={onBack} style={BTN_QUIET}>← All clients</button></div>
        {error ? <Notice tone="bad">{error}</Notice> : <p style={{ fontSize: 13, color: FAINT }}>Loading…</p>}
      </div>
    );
  }

  const shown = detail.appointments.filter(a => filter === "all" || stateOf(a) === filter);
  const chosen = detail.appointments.filter(a => picked.has(a.event_id));
  const toCharge = chosen.filter(a => !a.billing);
  const toCredit = chosen.filter(a => a.billing?.state !== "credited");
  const toUncredit = chosen.filter(a => a.billing?.state === "credited");
  const allShownPicked = shown.length > 0 && shown.every(a => picked.has(a.event_id));
  const price = detail.settings.price;
  const outstanding = detail.charges.filter(c => c.status === "pending").reduce((s, c) => s + c.total, 0);
  const paidTotal = detail.charges.filter(c => c.status === "paid").reduce((s, c) => s + c.total, 0);
  const issued = detail.ledger.filter(l => l.type === "issued");
  const used = detail.ledger.filter(l => l.type === "used");
  const owed = detail.credits_owed;
  // Credit worth less than one appointment (or no price set): it comes off the next charge instead.
  const loose = price > 0 ? Math.round((detail.balance - owed * price) * 100) / 100 : detail.balance;

  const toggle = (id: string) => setPicked(prev => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const toggleAll = () => setPicked(prev => {
    const next = new Set(prev);
    if (allShownPicked) shown.forEach(a => next.delete(a.event_id));
    else shown.forEach(a => next.add(a.event_id));
    return next;
  });

  const billingPill = (a: Appointment) => {
    const b = a.billing;
    if (!b) return <Pill text="To bill" color={MUTED} />;
    if (b.state === "credited") {
      return <Pill text={b.credit_amount > 0 ? `Credited ${money(b.credit_amount)}` : "Credited · not billed"} color={BAD}
        title={[b.credit_reason, b.credit_amount > 0 ? "Was charged — added to their credit" : "Never charged"].filter(Boolean).join(" · ")} />;
    }
    if (b.state === "covered") return <Pill text="Covered by credit · not billed" color={FREE} title="Their credit paid for this one" />;
    const waiting = b.charge_status === "pending" || b.charge_status === "draft";
    return <Pill text={`Charged ${money(b.price)}${waiting ? " · awaiting payment" : ""}`} color={waiting ? WARN : GOOD} />;
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <button onClick={onBack} style={BTN_QUIET}>← All clients</button>
        <h3 style={{ flex: 1, minWidth: 160, fontSize: 20, fontWeight: 700, color: INK, letterSpacing: "-0.02em" }}>{detail.client.name}</h3>
        <button onClick={() => setCharging([])} style={BTN_QUIET}>Charge another amount</button>
      </div>

      {flash && <Notice tone={flash.bad ? "bad" : "good"} onDismiss={() => setFlash(null)}>{flash.text}</Notice>}
      {error && <Notice tone="bad">{error}</Notice>}

      {/* ── settings ── */}
      <div style={{ ...PANEL, padding: 16, display: "flex", gap: 20, flexWrap: "wrap", alignItems: "flex-end" }}>
        <label style={{ ...LABEL, width: 170 }}>
          Price per appointment
          <input value={priceText} onChange={e => setPriceText(e.target.value)} onBlur={savePrice}
            onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
            inputMode="decimal" placeholder="$0" style={FIELD} />
        </label>
        <div style={{ flex: 1, minWidth: 220 }}>
          <p style={{ fontSize: 11.5, fontWeight: 600, color: MUTED, marginBottom: 5 }}>Stripe</p>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", minHeight: 35 }}>
            {!stripe.configured ? (
              <span style={{ fontSize: 13, color: MUTED }}>Not connected — charges can be recorded, not collected.</span>
            ) : detail.customer ? (<>
              <span style={{ fontSize: 13, color: INK }}>
                <strong>{detail.customer.name ?? detail.customer.email ?? "Customer"}</strong>
                <span style={{ color: MUTED }}>{detail.customer.email && detail.customer.name ? ` · ${detail.customer.email}` : ""} · {detail.customer.payment?.label ?? "no card on file"}</span>
              </span>
              <button onClick={() => setLinking(true)} style={BTN_QUIET}>Change</button>
            </>) : (<>
              <span style={{ fontSize: 13, color: detail.customer_error ? BAD : MUTED }}>{detail.customer_error ?? "Not linked to a Stripe customer yet."}</span>
              <button onClick={() => setLinking(true)} style={BTN_DARK}>Link Stripe customer</button>
            </>)}
          </div>
        </div>
      </div>

      <div style={TILE_GRID}>
        <Tile label="To bill" value={String(counts.uncharged)} sub={price ? `${money(counts.uncharged * price)} at ${money(price)} each` : "Set a price to see the value"} />
        <Tile label="Paid" value={money(paidTotal)} sub="all time" tone={paidTotal > 0 ? "good" : undefined} />
        <Tile label="Awaiting payment" value={money(outstanding)} sub="invoices not paid yet" tone={outstanding > 0 ? "warn" : undefined} />
        <Tile label="Credited" value={String(issued.filter(l => l.source === "appointment").length)}
          sub={`${plural(used.filter(l => l.source === "cover").length, "booking")} covered by credit`} />
        <Tile label="Credits still owed"
          value={price > 0 ? plural(owed, "appointment") : money(detail.balance)}
          sub={owed > 0 ? `next ${owed === 1 ? "booking" : `${owed} bookings`} won't be billed${loose > 0 ? ` · plus ${money(loose)}` : ""}`
            : loose > 0 ? `${money(loose)} comes off the next charge` : "nothing owed"}
          tone={owed > 0 || loose > 0 ? "warn" : undefined} />
      </div>

      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <Segments<DetailTab> value={tab} onChange={setTab} options={[
          { id: "appointments", label: `Appointments (${counts.all})` },
          { id: "charges", label: `Charges (${detail.charges.length})` },
          { id: "credits", label: `Credits (${issued.length})` },
        ]} />
      </div>

      {/* ── appointments ── */}
      {tab === "appointments" && (
        <div style={{ ...PANEL, padding: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "4px 4px 10px" }}>
            <Segments<ApptFilter> value={filter} onChange={setFilter} options={[
              { id: "uncharged", label: `To bill (${counts.uncharged})` },
              { id: "charged", label: `Charged (${counts.charged})` },
              { id: "credited", label: `Credited (${counts.credited})` },
              { id: "covered", label: `Covered by credit (${counts.covered})` },
              { id: "all", label: `All (${counts.all})` },
            ]} />
            <span style={{ flex: 1 }} />
            {chosen.length > 0 && <span style={{ fontSize: 12.5, color: MUTED }}>{chosen.length} selected</span>}
            {toUncredit.length > 0 && (
              <button disabled={busy} onClick={() => act({ action: "uncredit", client_id: clientId, event_ids: toUncredit.map(a => a.event_id) }, `Credit removed from ${plural(toUncredit.length, "appointment")}`)}
                style={BTN_QUIET}>Remove credit ({toUncredit.length})</button>
            )}
            {toCredit.length > 0 && <button onClick={() => setCrediting(toCredit)} style={BTN_QUIET}>Credit ({toCredit.length})</button>}
            {toCharge.length > 0 && (
              <button onClick={() => setCharging(toCharge.map(a => a.event_id))} style={BTN_DARK}>
                Charge {toCharge.length}{price ? ` · ${money(toCharge.length * price)}` : ""}
              </button>
            )}
          </div>
          {shown.length === 0 ? (
            <p style={{ fontSize: 13, color: MUTED, padding: "18px 8px" }}>
              {counts.all === 0 ? "No appointments in this period." : "Nothing here in this period."}
            </p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 560 }}>
                <thead>
                  <tr>
                    <th style={{ ...TH, width: 34 }}>
                      <input type="checkbox" aria-label="Select all shown" checked={allShownPicked} onChange={toggleAll} />
                    </th>
                    <th style={TH}>Appointment</th>
                    <th style={TH}>Lead</th>
                    <th style={TH}>Outcome</th>
                    <th style={TH}>Billing</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map(a => (
                    <tr key={a.event_id} onClick={() => toggle(a.event_id)} style={{ cursor: "pointer", background: picked.has(a.event_id) ? "rgba(0,0,0,0.03)" : undefined }}>
                      <td style={TD}>
                        <input type="checkbox" aria-label={`Select ${a.lead_name ?? "appointment"}`} checked={picked.has(a.event_id)}
                          onClick={e => e.stopPropagation()} onChange={() => toggle(a.event_id)} />
                      </td>
                      <td style={{ ...TD, whiteSpace: "nowrap" }}>
                        {day(a.scheduled_at ?? a.booked_at)}
                        {a.scheduled_at && <span style={{ color: FAINT, fontSize: 11.5 }}> · booked {day(a.booked_at)}</span>}
                      </td>
                      <td style={TD}>{a.lead_name ?? <span style={{ color: FAINT }}>No name</span>}</td>
                      <td style={{ ...TD, color: a.outcome === "no_show" ? BAD : a.outcome === "show" ? GOOD : MUTED }}>{OUTCOME[a.outcome] ?? a.outcome}</td>
                      <td style={TD}>{billingPill(a)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── charges ── */}
      {tab === "charges" && (
        <div style={{ ...PANEL, padding: 12 }}>
          {detail.charges.length === 0 ? (
            <p style={{ fontSize: 13, color: MUTED, padding: "18px 8px" }}>No charges yet.</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 640 }}>
                <thead>
                  <tr>
                    <th style={TH}>Date</th><th style={TH}>For</th>
                    <th style={{ ...TH, ...NUM }}>Amount</th><th style={{ ...TH, ...NUM }}>Credit used</th><th style={{ ...TH, ...NUM }}>Total</th>
                    <th style={TH}>How</th><th style={TH}>Status</th><th style={TH} />
                  </tr>
                </thead>
                <tbody>
                  {detail.charges.map(c => {
                    const st = CHARGE_STATUS[c.status];
                    const dead = c.status === "void" || c.status === "failed";
                    const canCancel = c.status === "pending" || c.status === "draft" || (c.status === "paid" && c.method === "manual");
                    return (
                      <tr key={c.id} style={{ opacity: dead ? 0.6 : 1 }}>
                        <td style={{ ...TD, whiteSpace: "nowrap" }}>{day(c.created_at)}</td>
                        <td style={TD}>
                          {c.description}
                          {c.error && <span style={{ display: "block", fontSize: 11.5, color: BAD }}>{c.error}</span>}
                        </td>
                        <td style={{ ...TD, ...NUM }}>{money(c.subtotal)}</td>
                        <td style={{ ...TD, ...NUM, color: c.credit_applied ? INK : FAINT }}>{c.credit_applied ? money(-c.credit_applied) : "—"}</td>
                        <td style={{ ...TD, ...NUM, fontWeight: 700, textDecoration: dead ? "line-through" : undefined }}>{money(c.total)}</td>
                        <td style={TD}>{c.total === 0 && c.credit_applied > 0 ? "Credit" : METHOD_LABEL[c.method]}</td>
                        <td style={TD}><Pill text={st.label} color={st.color} /></td>
                        <td style={{ ...TD, whiteSpace: "nowrap", textAlign: "right" }}>
                          {c.stripe_invoice_url && !dead && (
                            <a href={c.stripe_invoice_url} target="_blank" rel="noreferrer" style={{ fontSize: 12.5, fontWeight: 600, color: INK, marginRight: 12 }}>Invoice ↗</a>
                          )}
                          {canCancel && (
                            <button disabled={busy} style={{ fontSize: 12.5, fontWeight: 600, color: BAD }}
                              onClick={() => {
                                const what = c.method === "manual" ? `Remove this ${money(c.total)} charge?` : `Cancel this ${money(c.total)} invoice in Stripe?`;
                                if (window.confirm(`${what} Its appointments go back to To bill.`)) act({ action: "void", id: c.id }, c.method === "manual" ? "Charge removed" : "Invoice cancelled");
                              }}>
                              {c.method === "manual" ? "Remove" : "Cancel"}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── credits ── */}
      {tab === "credits" && (<>
        <div style={{ ...PANEL, padding: 16, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "flex-end" }}>
          <label style={{ ...LABEL, width: 130 }}>
            Add credit
            <input value={creditAmount} onChange={e => setCreditAmount(e.target.value)} inputMode="decimal" placeholder="$0" style={FIELD} />
          </label>
          <label style={{ ...LABEL, flex: 1, minWidth: 180 }}>
            Reason
            <input value={creditReason} onChange={e => setCreditReason(e.target.value)} maxLength={300} placeholder="e.g. Goodwill" style={FIELD} />
          </label>
          <button disabled={busy || !(parseAmount(creditAmount) ?? 0)} style={{ ...BTN_DARK, opacity: busy || !(parseAmount(creditAmount) ?? 0) ? 0.35 : 1 }}
            onClick={async () => {
              const value = parseAmount(creditAmount);
              if (!value || value <= 0) return;
              await act({ action: "add_credit", client_id: clientId, amount: value, reason: creditReason }, `${money(value)} credit added`);
              setCreditAmount(""); setCreditReason("");
            }}>
            Add
          </button>
        </div>
        <div style={{ ...PANEL, padding: 12 }}>
          <div style={{ display: "flex", gap: 18, flexWrap: "wrap", padding: "4px 8px 10px", fontSize: 12.5, color: MUTED }}>
            <span>Issued <strong style={{ color: INK }}>{money(issued.reduce((t, l) => t + l.amount, 0))}</strong></span>
            <span>Used <strong style={{ color: INK }}>{money(used.reduce((t, l) => t + l.amount, 0))}</strong></span>
            <span>Still owed <strong style={{ color: detail.balance > 0 ? WARN : INK }}>{money(detail.balance)}</strong>
              {owed > 0 && ` · ${plural(owed, "appointment")}`}</span>
          </div>
          {detail.ledger.length === 0 ? (
            <p style={{ fontSize: 13, color: MUTED, padding: "18px 8px" }}>No credits yet.</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 600 }}>
                <thead>
                  <tr>
                    <th style={TH}>Date</th><th style={TH} /><th style={TH}>For</th><th style={TH}>Reason</th>
                    <th style={{ ...TH, ...NUM }}>Credit</th><th style={TH} />
                  </tr>
                </thead>
                <tbody>
                  {detail.ledger.map(l => {
                    const what = l.source === "manual" ? "Added by hand"
                      : l.source === "charge" ? "Taken off a charge"
                      : l.lead_name ?? (l.source === "cover" ? "Bookings covered" : "Appointment");
                    return (
                      <tr key={`${l.type}-${l.id}`}>
                        <td style={{ ...TD, whiteSpace: "nowrap" }}>{day(l.at)}</td>
                        <td style={TD}>
                          {l.type === "issued"
                            ? <Pill text="Credit issued" color={BAD} />
                            : <Pill text={l.source === "cover" ? "Covered a booking" : "Credit used"} color={FREE} />}
                        </td>
                        <td style={TD}>{what}{l.appointment_at && <span style={{ color: FAINT, fontSize: 11.5 }}> · {day(l.appointment_at)}</span>}</td>
                        <td style={{ ...TD, color: l.reason ? INK : FAINT }}>{l.reason || "—"}</td>
                        <td style={{ ...TD, ...NUM, fontWeight: 700, color: l.amount ? INK : FAINT }}>
                          {l.type === "used" ? money(-l.amount) : l.amount ? `+${money(l.amount)}` : "not billed"}
                        </td>
                        <td style={{ ...TD, textAlign: "right" }}>
                          {l.type === "issued" && (
                            <button disabled={busy} style={{ fontSize: 12.5, fontWeight: 600, color: BAD }}
                              onClick={() => {
                                if (l.source === "manual") { if (window.confirm(`Remove this ${money(l.amount)} credit?`)) act({ action: "delete_credit", id: l.id }, "Credit removed"); }
                                else act({ action: "uncredit", client_id: clientId, event_ids: [l.id] }, "Credit removed");
                              }}>
                              Remove
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </>)}

      {charging && <ChargeModal detail={detail} stripe={stripe} eventIds={charging} onClose={() => setCharging(null)} onDone={done} />}
      {crediting && <CreditModal detail={detail} picked={crediting} onClose={() => setCrediting(null)} onDone={done} />}
      {linking && <StripeLinkModal detail={detail} onClose={() => setLinking(false)} onDone={done} />}
    </div>
  );
}

/* ── every client ─────────────────────────────────────────────────────────── */

export default function ClientBilling() {
  const [period, setPeriod] = useState<PeriodId>("this_month");
  const [rows, setRows] = useState<ClientRow[] | null>(null);
  const [stripe, setStripe] = useState<StripeState>({ configured: false, test: false });
  const [ready, setReady] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const [version, setVersion] = useState(0);
  const reload = useCallback(() => setVersion(v => v + 1), []);

  useEffect(() => {
    let live = true;
    const range = rangeOf(period);
    api(`/api/billing${query({ start: range.start, end: range.end })}`)
      .then(data => {
        if (!live) return;
        setStripe(data.stripe ?? { configured: false, test: false });
        setReady(data.ready !== false);
        setRows(data.clients ?? []);
        setError(null);
      })
      .catch(e => {
        if (!live) return;
        setError(e instanceof Error ? e.message : "Could not load");
        setRows(prev => prev ?? []);
      });
    return () => { live = false; };
  }, [period, version]);

  const active = (c: ClientRow) => c.status === "live" || c.appointments > 0 || c.charged > 0 || c.outstanding > 0 || c.balance > 0;
  const visible = useMemo(() => (rows ?? [])
    .filter(c => showAll || active(c))
    .sort((a, b) => b.uncharged - a.uncharged || a.name.localeCompare(b.name)), [rows, showAll]);
  const hidden = (rows ?? []).length - (rows ?? []).filter(active).length;

  const totals = useMemo(() => (rows ?? []).reduce((t, c) => ({
    uncharged: t.uncharged + c.uncharged, value: t.value + c.uncharged_value,
    charged: t.charged + c.charged, paid: t.paid + c.paid,
    outstanding: t.outstanding + c.outstanding, balance: t.balance + c.balance,
    owed: t.owed + (c.credits_owed ?? 0),
  }), { uncharged: 0, value: 0, charged: 0, paid: 0, outstanding: 0, balance: 0, owed: 0 }), [rows]);

  const periodLabel = PERIODS.find(p => p.id === period)?.label.toLowerCase() ?? "";

  return (
    <div style={{ maxWidth: 1180, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 180 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: INK, letterSpacing: "-0.02em" }}>Client Billing</h2>
          <p style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>
            What each client still has to be billed, what was credited, and the credits still owed.
            {" "}
            <span style={{ color: stripe.configured ? (stripe.test ? WARN : GOOD) : FAINT, fontWeight: 600 }}>
              {stripe.configured ? (stripe.test ? "Stripe: test mode" : "Stripe connected") : "Stripe not connected"}
            </span>
          </p>
        </div>
        <Segments<PeriodId> value={period} onChange={setPeriod} options={PERIODS} />
      </div>

      {error && <Notice tone="bad" onDismiss={() => setError(null)}>{error}</Notice>}

      {!ready ? (
        <div style={{ ...PANEL, padding: 24 }}>
          <p style={{ fontSize: 15, fontWeight: 700, color: INK }}>Almost ready</p>
          <p style={{ fontSize: 13, color: MUTED, marginTop: 6, lineHeight: 1.5 }}>
            Client Billing needs a one-off database update before it can store charges and credits.
          </p>
        </div>
      ) : openId ? (
        <ClientDetail key={openId} clientId={openId} period={period} stripe={stripe} onBack={() => setOpenId(null)} onChanged={reload} />
      ) : rows === null ? (
        <p style={{ fontSize: 13, color: FAINT }}>Loading…</p>
      ) : (<>
        <div style={TILE_GRID}>
          <Tile label="To bill" value={String(totals.uncharged)} sub={`${money(totals.value)} · appointments ${period === "all" ? "ever" : periodLabel}`} />
          <Tile label="Charged" value={money(totals.charged)} sub={periodLabel} />
          <Tile label="Paid" value={money(totals.paid)} sub={periodLabel} tone={totals.paid > 0 ? "good" : undefined} />
          <Tile label="Awaiting payment" value={money(totals.outstanding)} sub="invoices not paid yet" tone={totals.outstanding > 0 ? "warn" : undefined} />
          <Tile label="Credits still owed" value={plural(totals.owed, "appointment")} sub={`${money(totals.balance)} · bookings that won't be billed`} tone={totals.balance > 0 ? "warn" : undefined} />
        </div>

        <div style={{ ...PANEL, padding: 12 }}>
          {visible.length === 0 ? (
            <p style={{ fontSize: 13, color: MUTED, padding: "18px 8px" }}>No clients to show.</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 860 }}>
                <thead>
                  <tr>
                    <th style={TH}>Client</th>
                    <th style={{ ...TH, ...NUM }}>Price</th>
                    <th style={{ ...TH, ...NUM }}>Appointments</th>
                    <th style={{ ...TH, ...NUM }}>To bill</th>
                    <th style={{ ...TH, ...NUM }}>Charged</th>
                    <th style={{ ...TH, ...NUM }}>Credited</th>
                    <th style={{ ...TH, ...NUM }}>Covered</th>
                    <th style={{ ...TH, ...NUM }}>Awaiting</th>
                    <th style={{ ...TH, ...NUM }}>Credits owed</th>
                    <th style={TH}>Stripe</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map(c => (
                    <tr key={c.id} onClick={() => setOpenId(c.id)} style={{ cursor: "pointer" }}
                      onMouseEnter={e => { e.currentTarget.style.background = "rgba(0,0,0,0.025)"; }}
                      onMouseLeave={e => { e.currentTarget.style.background = ""; }}>
                      <td style={{ ...TD, fontWeight: 600 }}>
                        <button onClick={e => { e.stopPropagation(); setOpenId(c.id); }} style={{ fontWeight: 600, color: INK, textAlign: "left" }}>{c.name}</button>
                        {c.status !== "live" && <span style={{ fontSize: 11.5, fontWeight: 400, color: FAINT }}> · {c.status}</span>}
                      </td>
                      <td style={{ ...TD, ...NUM, color: c.price ? INK : FAINT }}>{c.price ? money(c.price) : "not set"}</td>
                      <td style={{ ...TD, ...NUM }}>{c.appointments}</td>
                      <td style={{ ...TD, ...NUM, fontWeight: c.uncharged ? 700 : 400, color: c.uncharged ? INK : FAINT }}>
                        {c.uncharged}{c.uncharged > 0 && c.price > 0 && <span style={{ fontWeight: 400, color: MUTED }}> · {money(c.uncharged_value)}</span>}
                      </td>
                      <td style={{ ...TD, ...NUM, color: c.charged ? INK : FAINT }}>{money(c.charged)}</td>
                      <td style={{ ...TD, ...NUM, color: c.credited ? INK : FAINT }}>{c.credited}</td>
                      <td style={{ ...TD, ...NUM, color: c.covered ? FREE : FAINT }}>{c.covered ?? 0}</td>
                      <td style={{ ...TD, ...NUM, color: c.outstanding ? WARN : FAINT }}>{money(c.outstanding)}</td>
                      <td style={{ ...TD, ...NUM, color: c.balance > 0 ? WARN : FAINT, fontWeight: c.balance > 0 ? 700 : 400 }}>
                        {c.credits_owed > 0 ? `${c.credits_owed} appt${c.credits_owed === 1 ? "" : "s"}` : c.balance > 0 ? money(c.balance) : "—"}
                      </td>
                      <td style={{ ...TD, color: c.stripe_linked ? GOOD : FAINT }}>{c.stripe_linked ? "Linked" : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {hidden > 0 && (
            <div style={{ padding: "10px 8px 2px" }}>
              <button onClick={() => setShowAll(v => !v)} style={{ fontSize: 12.5, fontWeight: 600, color: MUTED }}>
                {showAll ? "Hide clients with nothing to bill" : `Show ${plural(hidden, "more client")} with nothing to bill`}
              </button>
            </div>
          )}
        </div>
      </>)}
    </div>
  );
}
