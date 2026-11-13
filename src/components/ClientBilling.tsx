"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

/* ────────────────────────────────────────────────────────────────────────────
   Client Billing

   Every client on the roster, with what they have been charged and credited.
   Open a client to see their appointments as cards. One nobody has decided
   on yet is "Not tracked" and says so: Bill it, Credit it, or mark it Not
   billed, right on the card (or tick several and do them together).

   Where a tracked appointment stands (the words are in STATE below):
     Billed            charged, or recorded as paid
     Credit given      a bad appointment — the client was given a credit for it
     Paid with credit  a good appointment — a credit paid for it, so no bill
     Not billed        no charge and nothing owed

   A charge goes to the client's saved card, out as an emailed invoice (both
   through Stripe), or is just recorded when they paid some other way. Credit
   is always worth one appointment, whether the dashboard billed it or not:
   the client's next booking is marked "Paid with credit" on its own and never
   billed. Until that booking exists the credit shows as still owed. Every
   figure is worked out by the API from the charges and credits themselves.
   ──────────────────────────────────────────────────────────────────────────── */

type StripeState = { configured: boolean; test: boolean };

type ClientRow = {
  id: string; name: string; status: string;
  price: number; stripe_linked: boolean;
  appointments: number; uncharged: number; uncharged_value: number;
  charged: number; paid: number; outstanding: number; credited: number; balance: number;
  covered: number; credits_owed: number; cancelled: number;
  service: string | null; sms_appointments: number; ads_appointments: number; unknown_appointments: number;
  assumed_appointments?: number;
};

type Source = "ads" | "sms" | "unknown";

// What one source (Facebook Ads or SMS) cost over the period and what its
// appointments bring in.
type SourceReturn = {
  appointments: number; credited: number; cancelled: number; untracked: number;
  billed: number; to_bill: number; revenue: number;
  cost: number; profit: number; multiple: number | null; cost_per_appointment: number | null;
};
type Returns = { ads: SourceReturn; sms: SourceReturn; unknown: number; sms_sent: number };

// Contact details — the same record Profit and Loss shows for this client.
type Profile = {
  name_key: string; name: string; contact_name: string | null; email: string | null;
  phone: string | null; website: string | null; notes: string | null;
};

type ApptBilling = {
  state: "charged" | "credited" | "covered" | "cancelled"; price: number; charged: boolean;
  charge_id: string | null; charge_status: string | null;
  credit_amount: number; credited_at: string | null; credit_reason: string | null;
};

type Appointment = {
  event_id: string; outcome: string; booked_at: string; scheduled_at: string | null;
  lead_name: string | null; lead_phone: string | null; calendar: string | null;
  source: Source;
  /** Nothing was recorded on the booking: the source is what the client runs. */
  source_assumed?: boolean;
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
  returns: Returns | null;
  profile: Profile | null; profile_available: boolean; profile_key: string;
  pnl: { paid: number; months: number; last_month: string | null };
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

type PeriodId = "this_month" | "last_month" | "last_90" | "all";
const PERIODS: { id: PeriodId; label: string }[] = [
  { id: "this_month", label: "This month" },
  { id: "last_month", label: "Last month" },
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
  back.setDate(back.getDate() - 89);
  return { start: ymd(back), end: ymd(now) };
}

/** The dates the figures cover, in words. */
const moneyLabel = (id: PeriodId) => PERIODS.find(p => p.id === id)?.label ?? "";

// Where a tracked appointment stands — one set of words for every screen. The
// two that involve credit are opposites and must never read alike:
//   credited = a bad appointment, the client GOT a credit for it;
//   covered  = a good appointment, a credit PAID for it.
const STATE = {
  charged:   { label: "Billed", color: GOOD, hint: "" },
  credited:  { label: "Credit given", color: BAD, hint: "Bad appointment — the client got a credit for it" },
  covered:   { label: "Paid with credit", color: FREE, hint: "Good appointment — a credit paid for it, not billed" },
  cancelled: { label: "Not billed", color: MUTED, hint: "" },
} as const;

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

/* ── return by source ─────────────────────────────────────────────────────── */

const SOURCE_LABEL: Record<Source, string> = { ads: "FB Ads", sms: "SMS", unknown: "No source" };
const SOURCE_COLOR: Record<Source, string> = { ads: "#2b5fad", sms: "#7a3fb0", unknown: FAINT };

function ReturnCard({ source, r, smsSent }: { source: "ads" | "sms"; r: SourceReturn; smsSent: number }) {
  const line = (label: string, value: string, strong?: boolean, color?: string) => (
    <div style={{ display: "flex", alignItems: "baseline", gap: 8, padding: "5px 0", borderTop: "1px solid rgba(0,0,0,0.05)" }}>
      <span style={{ flex: 1, fontSize: 12.5, color: MUTED }}>{label}</span>
      <span style={{ ...NUM, fontSize: 13, fontWeight: strong ? 700 : 500, color: color ?? INK }}>{value}</span>
    </div>
  );
  const counts = [plural(r.appointments, "appointment"),
    r.credited > 0 ? `${r.credited} credit given` : null, r.cancelled > 0 ? `${r.cancelled} not billed` : null].filter(Boolean).join(" · ");
  // SMS is the only source that costs us anything; ads are paid for by the client.
  const sms = source === "sms";
  return (
    <div style={{ ...PANEL, padding: 16, minWidth: 0 }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 10 }}>
        <div style={{ flex: 1 }}>
          <p style={{ fontSize: 12, fontWeight: 700, color: SOURCE_COLOR[source], letterSpacing: "0.08em" }}>{SOURCE_LABEL[source].toUpperCase()}</p>
          <p style={{ fontSize: 11.5, color: FAINT, marginTop: 3 }}>{counts}</p>
        </div>
        <div style={{ textAlign: "right" }}>
          {sms ? (<>
            <p style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em", color: r.multiple === null ? FAINT : r.profit >= 0 ? GOOD : BAD }}>
              {r.multiple === null ? "—" : `${r.multiple.toFixed(r.multiple >= 10 ? 0 : 1)}x`}
            </p>
            <p style={{ fontSize: 11, color: FAINT }}>return on SMS cost</p>
          </>) : (<>
            <p style={{ fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em", color: r.revenue > 0 ? GOOD : FAINT }}>{money(r.revenue)}</p>
            <p style={{ fontSize: 11, color: FAINT }}>revenue</p>
          </>)}
        </div>
      </div>
      {sms && line(`SMS cost${smsSent ? ` · ${smsSent.toLocaleString("en-US")} sent` : ""}`, money(r.cost))}
      {sms && line("Cost per appointment", r.cost_per_appointment === null ? "—" : money(r.cost_per_appointment))}
      {line("Billed", money(r.billed))}
      {line(`Not tracked yet${r.untracked ? ` · ${r.untracked}` : ""}`, money(r.to_bill))}
      {line("Revenue", money(r.revenue), true)}
      {sms
        ? line("Profit", money(r.profit), true, r.profit >= 0 ? GOOD : BAD)
        : <p style={{ fontSize: 11.5, color: FAINT, paddingTop: 7, borderTop: "1px solid rgba(0,0,0,0.05)" }}>No cost to you — the client pays the ad spend.</p>}
    </div>
  );
}

// Facebook Ads and SMS side by side: what each cost, and what its appointments
// are worth. A source with nothing spent and nothing booked is left out.
function ReturnPanel({ returns, scope }: { returns: Returns; scope: string }) {
  const shown = (["ads", "sms"] as const).filter(k => returns[k].appointments > 0 || returns[k].cost > 0);
  if (!shown.length && !returns.unknown) return null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <h4 style={{ fontSize: 12, fontWeight: 700, color: INK, letterSpacing: "0.08em" }}>RETURN BY SOURCE</h4>
        <span style={{ fontSize: 12, color: MUTED }}>{`${scope} · revenue is appointments billed, plus those not tracked yet at the client’s price`}</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
        {shown.map(k => <ReturnCard key={k} source={k} r={returns[k]} smsSent={returns.sms_sent} />)}
      </div>
      {returns.unknown > 0 && (
        <Notice tone="warn">
          {`${plural(returns.unknown, "appointment")} ${returns.unknown === 1 ? "has" : "have"} no recorded source, so ${returns.unknown === 1 ? "it is" : "they are"} in neither figure. Open a client and filter by “No source” to see which.`}
        </Notice>
      )}
    </div>
  );
}

/* ── client details (shared with Profit and Loss) ─────────────────────────── */

const PROFILE_FIELDS: { id: "contact_name" | "email" | "phone" | "website"; label: string; type?: string }[] = [
  { id: "contact_name", label: "Contact name" },
  { id: "email", label: "Email", type: "email" },
  { id: "phone", label: "Phone", type: "tel" },
  { id: "website", label: "Website" },
];

function ProfileCard({ detail, onSaved, onOpenProfitLoss }: {
  detail: Detail; onSaved: (message: string, failed?: boolean) => void; onOpenProfitLoss?: (key: string) => void;
}) {
  const stored = useMemo(() => ({
    contact_name: detail.profile?.contact_name ?? "", email: detail.profile?.email ?? "",
    phone: detail.profile?.phone ?? "", website: detail.profile?.website ?? "", notes: detail.profile?.notes ?? "",
  }), [detail.profile]);
  const [form, setForm] = useState(stored);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const dirty = (Object.keys(stored) as (keyof typeof stored)[]).some(k => form[k].trim() !== stored[k].trim());
  const filled = PROFILE_FIELDS.map(f => stored[f.id]).filter(Boolean);

  const save = async () => {
    if (busy || !dirty) return;
    setBusy(true);
    try {
      await api("/api/billing", { action: "profile", client_id: detail.client.id, ...form });
      onSaved("Client details saved — Profit and Loss shows the same");
    } catch (e) { onSaved(e instanceof Error ? e.message : "Could not save", true); }
    finally { setBusy(false); }
  };

  const month = detail.pnl.last_month ? new Date(`${detail.pnl.last_month}T12:00:00`).toLocaleDateString("en-US", { month: "short", year: "numeric" }) : null;

  return (
    <div style={{ ...PANEL, padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 200 }}>
          <p style={{ fontSize: 11.5, fontWeight: 600, color: MUTED, marginBottom: 4 }}>Client details · same as Profit and Loss</p>
          <p style={{ fontSize: 13, color: filled.length ? INK : MUTED }}>
            {filled.length ? filled.join(" · ") : "No contact details yet."}
          </p>
          <p style={{ fontSize: 12, color: MUTED, marginTop: 3 }}>
            {detail.pnl.paid > 0
              ? <>Paid <strong style={{ color: INK }}>{money(detail.pnl.paid)}</strong> over {plural(detail.pnl.months, "month")} on Profit and Loss{month ? `, last in ${month}` : ""}.</>
              : "No payments logged on Profit and Loss yet."}
          </p>
        </div>
        <button onClick={() => setOpen(v => !v)} style={BTN_QUIET}>{open ? "Hide" : "Edit details"}</button>
        {onOpenProfitLoss && <button onClick={() => onOpenProfitLoss(detail.profile_key)} style={BTN_QUIET}>Open in Profit and Loss</button>}
      </div>
      {open && (<>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10 }}>
          {PROFILE_FIELDS.map(f => (
            <label key={f.id} style={LABEL}>
              {f.label}
              <input type={f.type ?? "text"} value={form[f.id]} onChange={e => setForm(v => ({ ...v, [f.id]: e.target.value }))}
                onKeyDown={e => { if (e.key === "Enter") save(); }} style={FIELD} />
            </label>
          ))}
        </div>
        <label style={LABEL}>
          Notes
          <textarea value={form.notes} onChange={e => setForm(v => ({ ...v, notes: e.target.value }))} rows={3} style={{ ...FIELD, resize: "vertical", lineHeight: 1.5 }} />
        </label>
        <div>
          <button onClick={save} disabled={busy || !dirty} style={{ ...BTN_DARK, opacity: busy || !dirty ? 0.35 : 1 }}>{busy ? "Saving…" : "Save"}</button>
        </div>
      </>)}
    </div>
  );
}

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
  const [confirmFor, setConfirmFor] = useState<string | null>(null);

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

  // Anything that reaches the client — a card charge or an emailed invoice —
  // is asked twice. The question is tied to this method and this total, so
  // changing either asks again.
  const stamp = `${effective}|${cents(total)}`;
  const confirming = confirmFor === stamp;
  const reaches = effective !== "manual";

  const submit = async () => {
    if (busy || blocked || tooSmall) return;
    if (reaches && !confirming) { setConfirmFor(stamp); return; }
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
      else { setError(message); setBusy(false); setConfirmFor(null); setRequestId(newRequestId()); }
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

      {confirming && reaches && !blocked && !tooSmall ? (
        <div role="alertdialog" aria-label="Confirm billing" style={{ background: "rgba(138,97,0,0.10)", borderRadius: 12, padding: 14, display: "flex", flexDirection: "column", gap: 10 }}>
          <p style={{ fontSize: 14, fontWeight: 700, color: INK }}>{`Are you sure you want to bill ${detail.client.name}?`}</p>
          <p style={{ fontSize: 12.5, color: WARN }}>
            {effective === "card"
              ? `This charges ${customer?.payment?.label ?? "their card"} ${money(total)} right now${count ? ` for ${plural(count, "appointment")}` : ""}.`
              : `This emails ${customer?.email ?? "them"} an invoice for ${money(total)}${count ? ` for ${plural(count, "appointment")}` : ""}.`}
          </p>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button onClick={submit} disabled={busy} style={{ ...BTN_DARK, padding: "10px 18px", fontSize: 13, opacity: busy ? 0.35 : 1 }}>
              {busy ? "Working…" : effective === "card" ? `Yes, charge ${money(total)}` : `Yes, send the invoice`}
            </button>
            <button onClick={() => setConfirmFor(null)} disabled={busy} style={{ ...BTN_QUIET, padding: "10px 18px", fontSize: 13 }}>No, go back</button>
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <button onClick={submit} disabled={busy || !!blocked || !!tooSmall}
            style={{ ...BTN_DARK, padding: "10px 18px", fontSize: 13, opacity: busy || blocked || tooSmall ? 0.35 : 1 }}>
            {busy ? "Working…" : action}
          </button>
          {(blocked || tooSmall) && !busy && <span style={{ fontSize: 12.5, color: MUTED }}>{blocked ?? tooSmall}</span>}
        </div>
      )}
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
  const n = picked.length;
  const back = picked.reduce((s, a) => s + (a.billing?.price || detail.settings.price), 0);

  const submit = async () => {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const res = await api("/api/billing", { action: "credit", client_id: detail.client.id, event_ids: picked.map(a => a.event_id), reason });
      const covered = Number(res.covered ?? 0);
      onDone(`${plural(n, "credit")} given`
        + (covered > 0 ? ` — ${plural(covered, "booking")} now paid with credit` : ` — their next ${n === 1 ? "booking" : `${n} bookings`} won't be billed`));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong"); setBusy(false);
    }
  };

  return (
    <Modal title={`Credit ${plural(n, "appointment")}`} sub={detail.client.name} onClose={busy ? () => {} : onClose}>
      <div style={{ ...PANEL, padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
        <p style={{ fontSize: 13, color: INK, lineHeight: 1.5 }}>
          {`${n === 1 ? "This was a bad appointment" : "These were bad appointments"}: ${detail.client.name} gets ${plural(n, "credit")} (${money(back)}), so their next ${n === 1 ? "booking is" : `${n} bookings are`} paid with credit instead of billed.`}
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
          {busy ? "Working…" : `Give ${plural(n, "credit")}`}
        </button>
      </div>
    </Modal>
  );
}

/* ── prepaid credits ──────────────────────────────────────────────────────── */

// A client who pays for a batch up front: issue that many appointments as
// credit, and their next bookings are covered by it instead of billed.
function IssueCreditsModal({ detail, onClose, onDone }: {
  detail: Detail; onClose: () => void; onDone: (message: string) => void;
}) {
  const saved = detail.settings.price;
  const [countText, setCountText] = useState("");
  const [priceText, setPriceText] = useState("");
  const [reason, setReason] = useState("");
  const [record, setRecord] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [requestId, setRequestId] = useState(newRequestId);

  const count = /^\d+$/.test(countText.trim()) ? Number(countText.trim()) : 0;
  const price = saved > 0 ? saved : (parseAmount(priceText) ?? 0);
  const value = (cents(price) * count) / 100;
  const holding = detail.credits_owed;
  const blocked = count < 1 ? "Enter how many appointments" : count > 1000 ? "That is too many at once" : price <= 0 ? "Set a price per appointment" : null;

  const submit = async () => {
    if (busy || blocked) return;
    setBusy(true); setError(null);
    try {
      await api("/api/billing", {
        action: "issue_credits", client_id: detail.client.id, count,
        price: saved > 0 ? undefined : price, reason, record_payment: record, request_id: requestId,
      });
      onDone(`${plural(count, "credit")} given — their next ${count === 1 ? "booking" : `${count} bookings`} won't be billed${record ? `, and ${money(value)} recorded as paid` : ""}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong"); setBusy(false); setRequestId(newRequestId());
    }
  };

  return (
    <Modal title="Give credits" sub={`${detail.client.name} · one credit pays for one appointment`} onClose={busy ? () => {} : onClose}>
      <div style={{ ...PANEL, padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          <label style={{ ...LABEL, flex: 1, minWidth: 140 }}>
            How many credits
            <input value={countText} onChange={e => setCountText(e.target.value)} inputMode="numeric" placeholder="e.g. 10" autoFocus style={FIELD} />
          </label>
          <label style={{ ...LABEL, flex: 1, minWidth: 140 }}>
            Price per appointment
            {saved > 0
              ? <span style={{ ...FIELD, background: "rgba(0,0,0,0.04)", fontWeight: 600 }}>{money(saved)}</span>
              : <input value={priceText} onChange={e => setPriceText(e.target.value)} inputMode="decimal" placeholder="$0" style={FIELD} />}
          </label>
        </div>
        {saved <= 0 && <p style={{ fontSize: 12, color: MUTED, marginTop: -4 }}>This also becomes their price per appointment.</p>}
        <label style={LABEL}>
          Note (optional)
          <input value={reason} onChange={e => setReason(e.target.value)} maxLength={300}
            placeholder={count ? `Prepaid — ${plural(count, "appointment")}` : "e.g. Prepaid batch, November"} style={FIELD} />
        </label>

        <div style={{ borderTop: "1px solid rgba(0,0,0,0.07)", paddingTop: 12, display: "flex", flexDirection: "column", gap: 5, fontSize: 13, color: MUTED }}>
          <div style={{ display: "flex" }}>
            <span style={{ flex: 1 }}>{count && price ? `${count} × ${money(price)}` : "Credit"}</span>
            <span style={NUM}>{money(value)}</span>
          </div>
          <div style={{ display: "flex", alignItems: "baseline", color: INK, marginTop: 4 }}>
            <span style={{ flex: 1, fontWeight: 700 }}>Credits they will hold</span>
            <span style={{ ...NUM, fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em" }}>{plural(holding + count, "appointment")}</span>
          </div>
          {holding > 0 && <p style={{ fontSize: 12, color: FAINT }}>{`${holding} already held + ${count} new`}</p>}
        </div>
      </div>

      <Notice tone="warn">
        {"Each booking made from now on uses one credit and is marked Paid with credit — it is not billed. If one turns out bad, press Return the credit on its card. Appointments already booked are not touched."}
      </Notice>

      <label style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "10px 12px", borderRadius: 12, background: CARD, border: BORDER, cursor: "pointer" }}>
        <input type="checkbox" checked={record} onChange={e => setRecord(e.target.checked)} style={{ marginTop: 3 }} />
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: INK }}>{`Also record the payment${value > 0 ? ` — ${money(value)} already paid` : ""}`}</span>
          <span style={{ display: "block", fontSize: 12, color: MUTED, marginTop: 1 }}>Nothing is sent to Stripe.</span>
        </span>
      </label>

      {error && <Notice tone="bad">{error}</Notice>}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <button onClick={submit} disabled={busy || !!blocked} style={{ ...BTN_DARK, padding: "10px 18px", fontSize: 13, opacity: busy || blocked ? 0.35 : 1 }}>
          {busy ? "Working…" : count ? `Give ${plural(count, "credit")}` : "Give credits"}
        </button>
        {blocked && !busy && <span style={{ fontSize: 12.5, color: MUTED }}>{blocked}</span>}
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
  const [email, setEmail] = useState(detail.profile?.email ?? "");

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

/* ── one appointment ──────────────────────────────────────────────────────── */

// One appointment as a card. Undecided ones carry their three choices; the
// rest show where they stand, with the one thing that can still be done.
function AppointmentCard({ a, price, busy, ticked, onTick, onBill, onCredit, onCancel, onUncancel, onUncredit, onCreditBilled, holdsCredit }: {
  a: Appointment; price: number; busy: boolean;
  ticked?: boolean; onTick?: () => void;
  /** onCancel = not billed. It also serves a booking a credit paid for: that gives the credit back. */
  onBill: () => void; onCredit: () => void; onCancel: () => void;
  onUncancel: () => void; onUncredit: () => void; onCreditBilled?: () => void;
  /** The client holds a credit: billing this one would use it. */
  holdsCredit?: boolean;
}) {
  const b = a.billing;
  const on = !!ticked;
  const waiting = b?.charge_status === "pending" || b?.charge_status === "draft";
  const status = !b ? { text: "Not tracked", color: WARN, hint: "" }
    : b.state === "cancelled" ? { text: STATE.cancelled.label, color: STATE.cancelled.color, hint: "" }
    : b.state === "credited" ? { text: `${STATE.credited.label} · ${money(b.credit_amount)}`, color: STATE.credited.color, hint: STATE.credited.hint }
    : b.state === "covered" ? { text: STATE.covered.label, color: STATE.covered.color, hint: STATE.covered.hint }
    : { text: `Billed ${money(b.price)}${waiting ? " · awaiting payment" : ""}`, color: waiting ? WARN : GOOD, hint: "" };
  const small: React.CSSProperties = { padding: "6px 10px", borderRadius: 8, fontSize: 12, fontWeight: 600, whiteSpace: "nowrap", flex: 1 };
  const quiet: React.CSSProperties = { ...small, flex: "none", background: "transparent", color: MUTED, padding: "4px 0" };
  const last = !b ? null
    : b.state === "cancelled" ? <button disabled={busy} onClick={onUncancel} style={quiet}>Undo</button>
    : b.state === "credited" ? <button disabled={busy} onClick={onUncredit} style={quiet}>Undo credit</button>
    // A credit paid for it: if it turns out bad, the credit goes back to them.
    : b.state === "covered" ? <button disabled={busy} onClick={onCancel} title="Bad appointment: mark it not billed and give the credit back" style={{ ...small, flex: "none", background: "rgba(0,0,0,0.06)", color: "#4a4a4a" }}>Return the credit</button>
    : onCreditBilled ? <button disabled={busy} onClick={onCreditBilled} style={quiet}>Credit it</button>
    : null;
  // The two credit states are told apart at a glance: a coloured edge each.
  const edge = b?.state === "credited" ? STATE.credited.color : b?.state === "covered" ? STATE.covered.color : null;
  return (
    <div
      style={{
        background: CARD, borderRadius: 14, padding: 14, display: "flex", flexDirection: "column", gap: 10, minWidth: 0,
        border: on ? "1.5px solid #000000" : !b ? "1px solid rgba(138,97,0,0.35)" : BORDER,
        ...(edge && !on ? { borderLeft: `4px solid ${edge}` } : {}),
        boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
      }}>
      <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
        {!b && onTick && (
          <input type="checkbox" aria-label={`Select ${a.lead_name ?? "appointment"}`} checked={on} onChange={onTick} style={{ marginTop: 3 }} />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontSize: 14, fontWeight: 700, color: INK, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{a.lead_name ?? "No name"}</p>
          <p style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>
            {day(a.scheduled_at ?? a.booked_at)}
            {a.scheduled_at && <span style={{ color: FAINT }}> · booked {day(a.booked_at)}</span>}
          </p>
        </div>
        <Pill text={`${SOURCE_LABEL[a.source]}${a.source_assumed ? " · assumed" : ""}`} color={a.source_assumed ? MUTED : SOURCE_COLOR[a.source]}
          title={a.source === "unknown" ? "No ad or SMS source was recorded for this booking, and this client runs both"
            : a.source_assumed ? `No source was recorded on this booking. Counted as ${SOURCE_LABEL[a.source]} because that is all this client runs.`
            : `Recorded on the booking: ${SOURCE_LABEL[a.source]}`} />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 }}>
        <span style={{ color: a.outcome === "no_show" ? BAD : a.outcome === "show" ? GOOD : MUTED, fontWeight: 600 }}>{OUTCOME[a.outcome] ?? a.outcome}</span>
        <span style={{ flex: 1 }} />
        <span style={{ color: status.color, fontWeight: 700 }} title={b?.credit_reason ?? undefined}>{status.text}</span>
      </div>
      {status.hint && <p style={{ fontSize: 11.5, color: MUTED, marginTop: -4 }}>{status.hint}</p>}
      {(!b || last) && (
        <div style={{ display: "flex", gap: 6, borderTop: "1px solid rgba(0,0,0,0.06)", paddingTop: 10 }}>
          {!b ? (<>
            <button disabled={busy} onClick={onBill} title={holdsCredit ? "They hold a credit — it pays for this one" : undefined} style={{ ...small, background: "#000000", color: "#ffffff" }}>
              {holdsCredit ? "Use a credit" : `Bill${price ? ` ${money(price)}` : ""}`}
            </button>
            <button disabled={busy} onClick={onCredit} title="Bad appointment they paid for: the client gets a credit, and their next booking is not billed" style={{ ...small, background: "rgba(0,0,0,0.06)", color: "#4a4a4a" }}>Credit</button>
            <button disabled={busy} onClick={onCancel} title="No charge and no credit" style={{ ...small, background: "rgba(0,0,0,0.06)", color: "#4a4a4a" }}>Not billed</button>
          </>) : last}
        </div>
      )}
    </div>
  );
}

/* ── today, every client ──────────────────────────────────────────────────── */

// The first thing on the page: what was booked today (or yesterday, or this
// week) across every client, and which of those nobody has billed, credited or
// marked not billed yet. "Today" is the day on this computer's clock.
/** credits = whole appointments of credit the client still holds. */
type RecentAppt = Appointment & { client_id: string; client_name: string; price: number; credits: number };
type RecentSpan = "today" | "yesterday" | "week";

const startOfDay = (back: number) => { const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() - back); return d; };

function TodayPanel({ stripe, tick, onChanged, onOpenClient }: {
  stripe: StripeState;
  /** Bumped when something outside the panel changed what it shows. */
  tick: number;
  onChanged: () => void; onOpenClient: (id: string) => void;
}) {
  const [rows, setRows] = useState<RecentAppt[] | null>(null);
  const [span, setSpan] = useState<RecentSpan>("today");
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [charging, setCharging] = useState<{ detail: Detail; eventIds: string[] } | null>(null);
  const [issuing, setIssuing] = useState<Detail | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let live = true;
    api(`/api/billing${query({ view: "recent", from: startOfDay(6).toISOString(), to: new Date().toISOString() })}`)
      .then(data => {
        if (!live) return;
        setRows((data.appointments ?? []).map((a: RecentAppt) => ({
          ...a, source: a.source ?? "ads", price: Number(a.price ?? 0) || 0,
          credits: Number((a as { credits_owed?: number }).credits_owed ?? 0) || 0,
        })));
        setError(null);
      })
      .catch(e => { if (live) { setError(e instanceof Error ? e.message : "Could not load today's appointments"); setRows(prev => prev ?? []); } });
    return () => { live = false; };
  }, [version, tick]);

  const refresh = () => { setVersion(v => v + 1); onChanged(); };

  const act = async (body: Record<string, unknown>, text: string) => {
    if (busy) return;
    setBusy(true); setError(null);
    try { await api("/api/billing", body); setFlash(text); refresh(); }
    catch (e) { setFlash(null); setError(e instanceof Error ? e.message : "Something went wrong"); setVersion(v => v + 1); }
    finally { setBusy(false); }
  };

  // Charging and giving credits need the client's card, credit and price: read them, then ask.
  const withClient = async (clientId: string, then: (detail: Detail) => void) => {
    if (busy) return;
    setBusy(true); setError(null);
    try {
      const today = ymd(new Date());
      const data = await api(`/api/billing${query({ client_id: clientId, start: today, end: today })}`);
      then({ ...data, credits_owed: Number(data.credits_owed ?? 0) || 0, appointments: [], ledger: [], charges: [], returns: null } as Detail);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not open this client"); }
    finally { setBusy(false); }
  };
  const bill = (clientId: string, eventIds: string[]) => withClient(clientId, detail => setCharging({ detail, eventIds }));

  const today0 = startOfDay(0).getTime(), yesterday0 = startOfDay(1).getTime();
  const inSpan = (a: RecentAppt, which: RecentSpan) => {
    const t = new Date(a.booked_at).getTime();
    return which === "today" ? t >= today0 : which === "yesterday" ? t >= yesterday0 && t < today0 : true;
  };
  const all = rows ?? [];
  const open = (which: RecentSpan) => all.filter(a => inSpan(a, which) && !a.billing).length;
  const shown = all.filter(a => inSpan(a, span));
  const openToday = open("today"), openYesterday = open("yesterday"), openWeek = open("week");

  const groups = useMemo(() => {
    const map = new Map<string, RecentAppt[]>();
    for (const a of shown) map.set(a.client_id, [...(map.get(a.client_id) ?? []), a]);
    return [...map.values()].sort((x, y) => y.filter(a => !a.billing).length - x.filter(a => !a.billing).length || x[0].client_name.localeCompare(y[0].client_name));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, span]);

  const todayCount = all.filter(a => inSpan(a, "today")).length;
  const title = rows === null ? "Today's appointments"
    : openToday > 0 ? `Track today's appointments — ${openToday} not tracked`
    : todayCount > 0 ? `Today's ${plural(todayCount, "appointment")} — all tracked`
    : "No appointments booked today";
  const older = openWeek - openToday;
  const spanWord = span === "today" ? "today" : span === "yesterday" ? "yesterday" : "in the last 7 days";

  return (
    <div style={{ ...PANEL, padding: 16, display: "flex", flexDirection: "column", gap: 12, border: openToday > 0 ? "1px solid rgba(138,97,0,0.35)" : BORDER }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <p style={{ fontSize: 16, fontWeight: 700, letterSpacing: "-0.01em", color: openToday > 0 ? WARN : todayCount > 0 ? GOOD : INK }}>{title}</p>
          <p style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>
            {rows === null ? "Loading…"
              : older > 0 ? `${plural(older, "appointment")} from earlier this week ${older === 1 ? "is" : "are"} still not tracked.`
              : "Bill, credit or mark each booking not billed as the day ends."}
          </p>
        </div>
        <Segments<RecentSpan> value={span} onChange={setSpan} options={[
          { id: "today", label: `Today${openToday ? ` (${openToday})` : ""}` },
          { id: "yesterday", label: `Yesterday${openYesterday ? ` (${openYesterday})` : ""}` },
          { id: "week", label: `7 days${openWeek ? ` (${openWeek})` : ""}` },
        ]} />
      </div>

      {error && <Notice tone="bad" onDismiss={() => setError(null)}>{error}</Notice>}
      {flash && <Notice tone="good" onDismiss={() => setFlash(null)}>{flash}</Notice>}

      {rows !== null && shown.length === 0 && span !== "today" && (
        <p style={{ fontSize: 13, color: MUTED }}>{`No appointments booked ${spanWord}.`}</p>
      )}

      {groups.map(list => {
        const first = list[0];
        const waiting = list.filter(a => !a.billing);
        return (
          <div key={first.client_id} style={{ display: "flex", flexDirection: "column", gap: 8, borderTop: "1px solid rgba(0,0,0,0.06)", paddingTop: 12 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <button onClick={() => onOpenClient(first.client_id)} style={{ fontSize: 14, fontWeight: 700, color: INK }}>{first.client_name}</button>
              <span style={{ flex: 1, fontSize: 12.5, color: waiting.length ? WARN : MUTED }}>
                {`${plural(list.length, "appointment")} ${spanWord}${waiting.length ? ` · ${waiting.length} not tracked` : " · all tracked"}`}
              </span>
              {first.credits > 0 && (
                <Pill text={`Holds ${plural(first.credits, "credit")}`} color={STATE.covered.color}
                  title="Credits not used yet — their next bookings are paid with them instead of billed" />
              )}
              <button disabled={busy} onClick={() => withClient(first.client_id, setIssuing)} style={{ ...BTN_QUIET, opacity: busy ? 0.4 : 1 }}
                title="Give this client credits: their next bookings are paid with them">Give credits</button>
              {waiting.length > 1 && (
                <button disabled={busy} onClick={() => bill(first.client_id, waiting.map(a => a.event_id))} style={{ ...BTN_DARK, opacity: busy ? 0.4 : 1 }}>
                  {`Bill all ${waiting.length}${first.price ? ` · ${money(waiting.length * first.price)}` : ""}`}
                </button>
              )}
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 12 }}>
              {list.map(a => (
                <AppointmentCard key={a.event_id} a={a} price={a.price} busy={busy}
                  onBill={() => bill(a.client_id, [a.event_id])}
                  onCredit={() => act({ action: "credit", client_id: a.client_id, event_ids: [a.event_id] }, `${a.lead_name ?? "Appointment"}: credit given — the client's next booking won't be billed`)}
                  onCancel={() => act({ action: "cancel", client_id: a.client_id, event_ids: [a.event_id] }, a.billing?.state === "covered" ? `${a.lead_name ?? "Appointment"} not billed — the credit is back with the client` : `${a.lead_name ?? "Appointment"} marked not billed`)}
                  onUncancel={() => act({ action: "uncancel", client_id: a.client_id, event_ids: [a.event_id] }, "Back to not tracked")}
                  onUncredit={() => act({ action: "uncredit", client_id: a.client_id, event_ids: [a.event_id] }, "Credit removed")}
                  holdsCredit={a.credits > 0} />
              ))}
            </div>
          </div>
        );
      })}

      {charging && (
        <ChargeModal detail={charging.detail} stripe={stripe} eventIds={charging.eventIds}
          onClose={() => setCharging(null)}
          onDone={(message, failed) => { setCharging(null); if (failed) { setFlash(null); setError(message); } else setFlash(message); refresh(); }} />
      )}
      {issuing && (
        <IssueCreditsModal detail={issuing} onClose={() => setIssuing(null)}
          onDone={message => { setIssuing(null); setFlash(message); refresh(); }} />
      )}
    </div>
  );
}

type ApptFilter = "all" | "uncharged" | "charged" | "credited" | "covered" | "cancelled";
type DetailTab = "appointments" | "charges" | "credits" | "returns";

const stateOf = (a: Appointment): Exclude<ApptFilter, "all"> => (a.billing ? a.billing.state : "uncharged");

function ClientDetail({ clientId, period, stripe, onBack, onChanged, onOpenProfitLoss }: {
  clientId: string; period: PeriodId; stripe: StripeState; onBack: () => void; onChanged: () => void;
  onOpenProfitLoss?: (key: string) => void;
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
  const [issuing, setIssuing] = useState(false);
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
        appointments: (data.appointments ?? []).map((a: Appointment) => ({ ...a, source: a.source ?? "ads" })),
        ledger: data.ledger ?? [],
        returns: data.returns ?? null,
        profile: data.profile ?? null, profile_available: data.profile_available !== false, profile_key: data.profile_key ?? "",
        pnl: { paid: num(data.pnl?.paid), months: num(data.pnl?.months), last_month: data.pnl?.last_month ?? null },
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
    setCharging(null); setCrediting(null); setLinking(false); setIssuing(false);
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
    const c = { all: 0, uncharged: 0, charged: 0, credited: 0, covered: 0, cancelled: 0 };
    for (const a of detail?.appointments ?? []) {
      c.all++; c[stateOf(a)]++;
    }
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

  // No source buttons in here (the owner found them one set too many): each
  // card carries its source, and the split is on the client list and Return by source.
  const shown = detail.appointments.filter(a => filter === "all" || stateOf(a) === filter);
  // Ticking is for dealing with several undecided appointments at once.
  const untracked = detail.appointments.filter(a => !a.billing);
  const chosen = untracked.filter(a => picked.has(a.event_id));
  const chosenIds = chosen.map(a => a.event_id);
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
  const some = (n: number) => plural(n, "appointment");

  const card = (a: Appointment) => (
    <AppointmentCard key={a.event_id} a={a} price={price} busy={busy}
      ticked={picked.has(a.event_id)} onTick={() => toggle(a.event_id)}
      onBill={() => setCharging([a.event_id])}
      onCredit={() => act({ action: "credit", client_id: clientId, event_ids: [a.event_id] }, `${a.lead_name ?? "Appointment"}: credit given — the client's next booking won't be billed`)}
      onCancel={() => act({ action: "cancel", client_id: clientId, event_ids: [a.event_id] }, a.billing?.state === "covered" ? `${a.lead_name ?? "Appointment"} not billed — the credit is back with the client` : `${a.lead_name ?? "Appointment"} marked not billed`)}
      onUncancel={() => act({ action: "uncancel", client_id: clientId, event_ids: [a.event_id] }, "Back to not tracked")}
      onUncredit={() => act({ action: "uncredit", client_id: clientId, event_ids: [a.event_id] }, "Credit removed")}
      onCreditBilled={() => setCrediting([a])} holdsCredit={owed > 0} />
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <button onClick={onBack} style={BTN_QUIET}>← All clients</button>
        <h3 style={{ flex: 1, minWidth: 160, fontSize: 20, fontWeight: 700, color: INK, letterSpacing: "-0.02em" }}>{detail.client.name}</h3>
        <button onClick={() => setIssuing(true)} style={BTN_QUIET} title="Give this client credits: their next bookings are paid with them">Give credits</button>
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
        <Tile label="Not tracked" value={String(counts.uncharged)} tone={counts.uncharged > 0 ? "warn" : undefined}
          sub={counts.uncharged === 0 ? "every appointment is dealt with" : price ? `${money(counts.uncharged * price)} if billed at ${money(price)} each` : "bill, credit or mark each one not billed"} />
        <Tile label="Paid" value={money(paidTotal)} sub="all time" tone={paidTotal > 0 ? "good" : undefined} />
        <Tile label="Awaiting payment" value={money(outstanding)} sub="invoices not paid yet" tone={outstanding > 0 ? "warn" : undefined} />
        <Tile label={STATE.credited.label} value={String(issued.filter(l => l.source === "appointment").length)}
          sub="bad appointments they got a credit for" tone={issued.some(l => l.source === "appointment") ? "bad" : undefined} />
        <Tile label={STATE.covered.label} value={String(used.filter(l => l.source === "cover").length)}
          sub={`good appointments a credit paid for · ${counts.cancelled} not billed`} />
        <Tile label="Credits still owed"
          value={owed > 0 ? plural(owed, "appointment") : detail.balance > 0 ? money(detail.balance) : "None"}
          sub={owed > 0 ? `next ${owed === 1 ? "booking" : `${owed} bookings`} won't be billed${loose > 0 ? ` · plus ${money(loose)}` : ""}`
            : loose > 0 ? `${money(loose)} comes off the next charge` : "nothing owed"}
          tone={owed > 0 || loose > 0 ? "warn" : undefined} />
      </div>

      {detail.profile_available && <ProfileCard key={JSON.stringify(detail.profile)} detail={detail} onSaved={done} onOpenProfitLoss={onOpenProfitLoss} />}

      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <Segments<DetailTab> value={tab} onChange={setTab} options={[
          { id: "appointments", label: `Appointments (${detail.appointments.length})` },
          { id: "charges", label: `Charges (${detail.charges.length})` },
          { id: "credits", label: `Credits (${issued.length})` },
          ...(detail.returns ? [{ id: "returns" as DetailTab, label: "Return by source" }] : []),
        ]} />
      </div>

      {/* ── appointments ── */}
      {tab === "appointments" && (<>
        {untracked.length > 0 && (
          <div role="status" style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap", background: "rgba(138,97,0,0.08)", borderRadius: 12, padding: "11px 14px" }}>
            <span style={{ flex: 1, minWidth: 220, fontSize: 13, color: WARN }}>
              <strong>{`${some(untracked.length)} not tracked yet.`}</strong>{" Bill, credit or mark each one not billed on its card — or tick several and do them together."}
            </span>
            <button onClick={() => setPicked(chosen.length === untracked.length ? new Set() : new Set(untracked.map(a => a.event_id)))} style={{ ...BTN_QUIET, color: WARN }}>
              {chosen.length === untracked.length ? "Untick all" : `Tick all ${untracked.length}`}
            </button>
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <Segments<ApptFilter> value={filter} onChange={setFilter} options={[
            { id: "uncharged", label: `Not tracked (${counts.uncharged})` },
            { id: "charged", label: `Billed (${counts.charged})` },
            { id: "credited", label: `${STATE.credited.label} (${counts.credited})` },
            { id: "covered", label: `${STATE.covered.label} (${counts.covered})` },
            { id: "cancelled", label: `${STATE.cancelled.label} (${counts.cancelled})` },
            { id: "all", label: `All (${counts.all})` },
          ]} />
        </div>

        <p style={{ fontSize: 12, color: MUTED, display: "flex", gap: 16, flexWrap: "wrap" }}>
          <span><strong style={{ color: STATE.credited.color }}>{STATE.credited.label}</strong>{" = a bad appointment; the client got a credit for it."}</span>
          <span><strong style={{ color: STATE.covered.color }}>{STATE.covered.label}</strong>{" = a good appointment; a credit paid for it, so it was not billed."}</span>
        </p>
        {owed > 0 && untracked.length > 0 && (
          <Notice tone="warn">
            {`They hold ${plural(owed, "credit")}. New bookings use them on their own; for one already here, press Use a credit on its card.`}
          </Notice>
        )}

        {chosen.length > 0 && (
          <div style={{ ...PANEL, padding: "10px 12px", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", position: "sticky", top: 8, zIndex: 5 }}>
            <span style={{ flex: 1, minWidth: 120, fontSize: 13, fontWeight: 600, color: INK }}>{chosen.length} ticked</span>
            <button disabled={busy} onClick={() => setCharging(chosenIds)} style={BTN_DARK}>
              Bill {chosen.length}{price ? ` · ${money(chosen.length * price)}` : ""}
            </button>
            <button disabled={busy} onClick={() => act({ action: "credit", client_id: clientId, event_ids: chosenIds }, `${plural(chosen.length, "credit")} given — their next ${chosen.length === 1 ? "booking" : `${chosen.length} bookings`} won't be billed`)} style={BTN_QUIET}>Credit {chosen.length}</button>
            <button disabled={busy} onClick={() => act({ action: "cancel", client_id: clientId, event_ids: chosenIds }, `${some(chosen.length)} marked not billed`)} style={BTN_QUIET}>Not billed {chosen.length}</button>
            <button onClick={() => setPicked(new Set())} style={{ fontSize: 12.5, fontWeight: 600, color: MUTED, padding: "0 4px" }}>Clear</button>
          </div>
        )}

        {shown.length === 0 ? (
          <div style={{ ...PANEL, padding: "22px 16px" }}>
            <p style={{ fontSize: 13, color: MUTED }}>
              {counts.all === 0 ? "No appointments in this period."
                : filter === "uncharged" ? "Nothing left to track here — every appointment in this period is dealt with."
                : "Nothing here in this period."}
            </p>
          </div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))", gap: 12 }}>
            {shown.map(card)}
          </div>
        )}
      </>)}

      {/* ── return by source ── */}
      {tab === "returns" && detail.returns && <ReturnPanel returns={detail.returns} scope={moneyLabel(period)} />}

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
                        <td style={TD}>{c.total === 0 && c.credit_applied > 0 ? "Credit" : c.method === "manual" && c.stripe_invoice_url ? "Stripe" : METHOD_LABEL[c.method]}</td>
                        <td style={TD}><Pill text={st.label} color={st.color} /></td>
                        <td style={{ ...TD, whiteSpace: "nowrap", textAlign: "right" }}>
                          {c.stripe_invoice_url && !dead && (
                            <a href={c.stripe_invoice_url} target="_blank" rel="noreferrer" style={{ fontSize: 12.5, fontWeight: 600, color: INK, marginRight: 12 }}>{c.method === "manual" ? "Receipt ↗" : "Invoice ↗"}</a>
                          )}
                          {canCancel && (
                            <button disabled={busy} style={{ fontSize: 12.5, fontWeight: 600, color: BAD }}
                              onClick={() => {
                                const what = c.method === "manual" ? `Remove this ${money(c.total)} charge?` : `Cancel this ${money(c.total)} invoice in Stripe?`;
                                if (window.confirm(`${what} Its appointments go back to Not tracked.`)) act({ action: "void", id: c.id }, c.method === "manual" ? "Charge removed" : "Invoice cancelled");
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
                      : l.lead_name ?? (l.source === "cover" ? "Bookings paid with credit" : "Appointment");
                    return (
                      <tr key={`${l.type}-${l.id}`}>
                        <td style={{ ...TD, whiteSpace: "nowrap" }}>{day(l.at)}</td>
                        <td style={TD}>
                          {l.type === "issued"
                            ? <Pill text="Credit issued" color={BAD} />
                            : <Pill text={l.source === "cover" ? "Paid for a booking" : "Credit used"} color={FREE} />}
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
      {issuing && <IssueCreditsModal detail={detail} onClose={() => setIssuing(false)} onDone={done} />}
    </div>
  );
}

/* ── every client ─────────────────────────────────────────────────────────── */

export default function ClientBilling({ openClientId, onOpenProfitLoss }: {
  /** Open straight on this roster client (coming from Profit and Loss). */
  openClientId?: string | null;
  /** Jump to this client on Profit and Loss; absent when that page isn't available. */
  onOpenProfitLoss?: (clientKey: string) => void;
} = {}) {
  const [period, setPeriod] = useState<PeriodId>("this_month");
  const [rows, setRows] = useState<ClientRow[] | null>(null);
  const [stripe, setStripe] = useState<StripeState>({ configured: false, test: false });
  const [ready, setReady] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(openClientId ?? null);
  const [returns, setReturns] = useState<Returns | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [todayTick, setTodayTick] = useState(0);

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
        setReturns(data.returns ?? null);
        // Credit was just spent on a new booking: the Today panel, which loads
        // alongside, may have read it a moment too early.
        if (Number(data.covered ?? 0) > 0) setTodayTick(t => t + 1);
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

  const periodLabel = moneyLabel(period).toLowerCase();

  return (
    <div style={{ maxWidth: 1180, margin: "0 auto", display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 180 }}>
          <h2 style={{ fontSize: 20, fontWeight: 700, color: INK, letterSpacing: "-0.02em" }}>Client Billing</h2>
          <p style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>
            Every appointment per client: not tracked, billed, credit given, paid with credit or not billed — and the credits still owed.
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
        <ClientDetail key={openId} clientId={openId} period={period} stripe={stripe} onBack={() => setOpenId(null)} onChanged={reload} onOpenProfitLoss={onOpenProfitLoss} />
      ) : (<>
        {/* Loads on its own, alongside the figures below — neither waits for the other. */}
        <TodayPanel stripe={stripe} tick={todayTick} onChanged={reload} onOpenClient={setOpenId} />

        {rows === null ? <p style={{ fontSize: 13, color: FAINT }}>Loading the rest…</p> : (<>
        <div style={TILE_GRID}>
          <Tile label="Not tracked" value={String(totals.uncharged)} tone={totals.uncharged > 0 ? "warn" : undefined}
            sub={totals.uncharged === 0 ? "every appointment is dealt with" : `${money(totals.value)} if billed · ${periodLabel}`} />
          <Tile label="Billed" value={money(totals.charged)} sub={periodLabel} />
          <Tile label="Paid" value={money(totals.paid)} sub={periodLabel} tone={totals.paid > 0 ? "good" : undefined} />
          <Tile label="Awaiting payment" value={money(totals.outstanding)} sub="invoices not paid yet" tone={totals.outstanding > 0 ? "warn" : undefined} />
          <Tile label="Credits still owed" value={plural(totals.owed, "appointment")} sub={`${money(totals.balance)} · bookings that won't be billed`} tone={totals.balance > 0 ? "warn" : undefined} />
        </div>

        {totals.uncharged > 0 && (
          <Notice tone="warn">
            {`${plural(totals.uncharged, "appointment")} across ${plural((rows ?? []).filter(c => c.uncharged > 0).length, "client")} ${totals.uncharged === 1 ? "has" : "have"} not been tracked yet. Open a client to deal with them.`}
          </Notice>
        )}

        {returns && <ReturnPanel returns={returns} scope={`All clients · ${moneyLabel(period)}`} />}

        <div style={{ ...PANEL, padding: 12 }}>
          {visible.length === 0 ? (
            <p style={{ fontSize: 13, color: MUTED, padding: "18px 8px" }}>No clients to show.</p>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 940 }}>
                <thead>
                  <tr>
                    <th style={TH}>Client</th>
                    <th style={{ ...TH, ...NUM }}>Price</th>
                    <th style={{ ...TH, ...NUM }}>Appointments</th>
                    <th style={{ ...TH, ...NUM }}>Not tracked</th>
                    <th style={{ ...TH, ...NUM }}>Billed</th>
                    <th style={{ ...TH, ...NUM }} title={STATE.credited.hint}>{STATE.credited.label}</th>
                    <th style={{ ...TH, ...NUM }} title={STATE.covered.hint}>{STATE.covered.label}</th>
                    <th style={{ ...TH, ...NUM }}>{STATE.cancelled.label}</th>
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
                      <td style={{ ...TD, ...NUM }}>
                        {c.appointments}
                        {c.appointments > 0 && (
                          <span style={{ display: "block", fontSize: 11, color: FAINT, whiteSpace: "nowrap" }}
                            title={c.assumed_appointments ? `${c.assumed_appointments} had no source recorded on the booking — counted by what this client runs` : undefined}>
                            {[c.ads_appointments ? `${c.ads_appointments} FB Ads` : null, c.sms_appointments ? `${c.sms_appointments} SMS` : null,
                              c.unknown_appointments ? `${c.unknown_appointments} no source` : null,
                              c.assumed_appointments ? `${c.assumed_appointments} assumed` : null].filter(Boolean).join(" · ")}
                          </span>
                        )}
                      </td>
                      <td style={{ ...TD, ...NUM, fontWeight: c.uncharged ? 700 : 400, color: c.uncharged ? WARN : FAINT }}>
                        {c.uncharged}{c.uncharged > 0 && c.price > 0 && <span style={{ fontWeight: 400, color: MUTED }}> · {money(c.uncharged_value)}</span>}
                      </td>
                      <td style={{ ...TD, ...NUM, color: c.charged ? INK : FAINT }}>{money(c.charged)}</td>
                      <td style={{ ...TD, ...NUM, color: c.credited ? STATE.credited.color : FAINT }}>{c.credited}</td>
                      <td style={{ ...TD, ...NUM, color: c.covered ? FREE : FAINT }}>{c.covered ?? 0}</td>
                      <td style={{ ...TD, ...NUM, color: c.cancelled ? INK : FAINT }}>{c.cancelled ?? 0}</td>
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
                {showAll ? "Hide clients with nothing to track" : `Show ${plural(hidden, "more client")} with nothing to track`}
              </button>
            </div>
          )}
        </div>
        </>)}
      </>)}
    </div>
  );
}
