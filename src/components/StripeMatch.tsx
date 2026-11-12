"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

// Client Billing — Match with Stripe.
//
// Lists the payments Stripe took outside this dashboard and, for each, the
// client and appointments it most likely paid for. Nothing is saved until a
// match is confirmed; a saved match bills those appointments at what Stripe
// took, and can be removed again from the client's Charges tab.

type Source = "ads" | "sms" | "unknown";

type Payment = {
  id: string; date: string; amount: number;
  customer_id: string | null; customer_name: string | null; customer_email: string | null;
  description: string; url: string | null;
  client_id: string | null; how: "linked" | "email" | "name" | null;
  count: number; suggested: string[];
};
type MatchClient = { id: string; name: string; price: number; linked: boolean };
type Appt = { event_id: string; booked_at: string; scheduled_at: string | null; lead_name: string | null; outcome: string; source: Source };
type Data = {
  ready: boolean; connected: boolean; test?: boolean; limited?: boolean; more?: boolean;
  payments: Payment[]; clients: MatchClient[]; appointments: Record<string, Appt[]>;
  matched: { count: number; total: number }; other_currency: number;
};
type Choice = { client_id: string | null; ticked: string[] };

const CARD = "#ffffff";
const BORDER = "1px solid rgba(0,0,0,0.07)";
const SHADOW = "0 1px 2px rgba(0,0,0,0.03), 0 10px 28px -12px rgba(0,0,0,0.10)";
const INK = "#111111";
const MUTED = "#767676";
const FAINT = "#a8a8a8";
const GOOD = "#1a7f4b";
const BAD = "#b4472e";
const WARN = "#8a6100";

const PANEL: React.CSSProperties = { background: CARD, border: BORDER, boxShadow: SHADOW, borderRadius: 16 };
const FIELD: React.CSSProperties = {
  padding: "8px 10px", borderRadius: 9, fontSize: 13, color: INK, background: CARD,
  border: "1px solid rgba(0,0,0,0.14)", outline: "none", fontFamily: "inherit", minWidth: 0,
};
const BTN: React.CSSProperties = { padding: "8px 14px", borderRadius: 10, fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap" };
const BTN_DARK: React.CSSProperties = { ...BTN, background: "#000000", color: "#ffffff" };
const BTN_QUIET: React.CSSProperties = { ...BTN, background: "rgba(0,0,0,0.06)", color: "#4a4a4a" };
const TILE_GRID: React.CSSProperties = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 };

const SOURCE_LABEL: Record<Source, string> = { ads: "FB Ads", sms: "SMS", unknown: "No source" };
const SOURCE_COLOR: Record<Source, string> = { ads: "#2b5fad", sms: "#7a3fb0", unknown: FAINT };
const OUTCOME: Record<string, string> = { appointment_booked: "Booked", show: "Showed", no_show: "No-show" };
const HOW: Record<string, { text: string; color: string }> = {
  linked: { text: "Linked to this Stripe customer", color: GOOD },
  email: { text: "Found by email — check it's right", color: WARN },
  name: { text: "Found by name — check it's right", color: WARN },
};

const SHOWN = 8;
const DAY_MS = 86_400_000;

function money(n: number): string {
  const digits = Math.abs(n % 1) < 0.005 ? 0 : 2;
  return `${n < 0 ? "−" : ""}$${Math.abs(n).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}
function day(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
}
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const cents = (n: number) => Math.round(n * 100);

/** How many appointments the amount pays for at this price; 0 = it doesn't divide. */
function countFor(amount: number, price: number): number {
  const a = cents(amount), p = cents(price);
  return p > 0 && a > 0 && a % p === 0 ? a / p : 0;
}

async function api(url: string, body?: unknown) {
  const res = await fetch(url, body === undefined ? undefined : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "Something went wrong");
  return data;
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "good" | "warn" }) {
  return (
    <div style={{ ...PANEL, padding: "14px 16px" }}>
      <p style={{ fontSize: 11, fontWeight: 600, color: MUTED, marginBottom: 8 }}>{label}</p>
      <p style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em", color: tone === "good" ? GOOD : tone === "warn" ? WARN : INK }}>{value}</p>
      {sub && <p style={{ fontSize: 11, color: FAINT, marginTop: 6 }}>{sub}</p>}
    </div>
  );
}

function Note({ tone, children }: { tone: "bad" | "good" | "warn"; children: React.ReactNode }) {
  const color = tone === "bad" ? BAD : tone === "good" ? GOOD : WARN;
  const bg = tone === "bad" ? "rgba(180,71,46,0.08)" : tone === "good" ? "rgba(26,127,75,0.08)" : "rgba(138,97,0,0.08)";
  return <div role={tone === "bad" ? "alert" : "status"} style={{ fontSize: 12.5, color, background: bg, borderRadius: 10, padding: "9px 12px" }}>{children}</div>;
}

/* ── one payment ──────────────────────────────────────────────────────────── */

function PaymentCard({ payment, choice, clients, pool, elsewhere, busy, onClient, onToggle, onSave, onOther }: {
  payment: Payment; choice: Choice; clients: MatchClient[];
  /** The chosen client's untracked appointments, newest first. */
  pool: Appt[];
  /** Appointments ticked on another payment. */
  elsewhere: Set<string>;
  busy: boolean;
  onClient: (id: string | null) => void; onToggle: (eventId: string) => void;
  onSave: () => void; onOther: () => void;
}) {
  const [all, setAll] = useState(false);
  const client = clients.find(c => c.id === choice.client_id) ?? null;
  const ticked = new Set(choice.ticked);
  const expected = client ? countFor(payment.amount, client.price) : 0;
  const each = ticked.size ? payment.amount / ticked.size : 0;
  const offPrice = !!client && client.price > 0 && ticked.size > 0 && cents(each) !== cents(client.price);
  const free = pool.filter(a => !elsewhere.has(a.event_id));
  const shown = all ? free : free.filter((a, i) => i < SHOWN || ticked.has(a.event_id));
  const how = choice.client_id && choice.client_id === payment.client_id && payment.how ? HOW[payment.how] : null;
  const who = [payment.customer_name, payment.customer_email].filter(Boolean).join(" · ") || "No customer on this payment";

  let sum: string;
  if (!client) sum = "Choose the client this payment came from.";
  else if (client.price <= 0) sum = "No price set for this client — tick the appointments it paid for.";
  else if (expected > 0) sum = `${money(payment.amount)} ÷ ${money(client.price)} = ${plural(expected, "appointment")}`;
  else sum = `${money(payment.amount)} doesn't divide by their ${money(client.price)} price — tick the appointments it paid for.`;

  return (
    <div style={{ ...PANEL, padding: 16, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", gap: 14, alignItems: "baseline", flexWrap: "wrap" }}>
        <span style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-0.02em", color: INK }}>{money(payment.amount)}</span>
        <span style={{ fontSize: 13, color: INK, fontWeight: 600 }}>{who}</span>
        <span style={{ fontSize: 12.5, color: MUTED }}>paid {day(payment.date)}</span>
        <span style={{ flex: 1 }} />
        {payment.url && <a href={payment.url} target="_blank" rel="noreferrer" style={{ fontSize: 12.5, fontWeight: 600, color: INK }}>Open in Stripe ↗</a>}
      </div>
      {payment.description && <p style={{ fontSize: 12.5, color: MUTED, marginTop: -6 }}>{payment.description}</p>}

      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <select aria-label="Client" value={choice.client_id ?? ""} onChange={e => onClient(e.target.value || null)}
          style={{ ...FIELD, minWidth: 220, fontWeight: 600, borderColor: client ? "rgba(0,0,0,0.14)" : WARN }}>
          <option value="">Choose client…</option>
          {clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        {how && <span style={{ fontSize: 12, fontWeight: 600, color: how.color }}>{how.text}</span>}
        <span style={{ fontSize: 12.5, color: client && expected > 0 ? INK : WARN }}>{sum}</span>
      </div>

      {client && (free.length === 0 ? (
        <p style={{ fontSize: 12.5, color: MUTED }}>No untracked appointments left for this client in this period. Try a longer period, or mark it as not for appointments.</p>
      ) : (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {shown.map(a => {
            const on = ticked.has(a.event_id);
            return (
              <button key={a.event_id} aria-pressed={on} onClick={() => onToggle(a.event_id)}
                style={{
                  textAlign: "left", padding: "8px 11px", borderRadius: 11, minWidth: 150,
                  border: on ? "1.5px solid #111111" : "1.5px solid rgba(0,0,0,0.10)",
                  background: on ? "rgba(0,0,0,0.045)" : CARD,
                }}>
                <span style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: INK }}>
                  {on ? "✓ " : ""}{a.lead_name || "No name"}
                </span>
                <span style={{ display: "block", fontSize: 11.5, color: MUTED, marginTop: 2 }}>
                  {`Booked ${day(a.booked_at)} · ${OUTCOME[a.outcome] ?? a.outcome} · `}
                  <span style={{ color: SOURCE_COLOR[a.source], fontWeight: 600 }}>{SOURCE_LABEL[a.source]}</span>
                </span>
              </button>
            );
          })}
          {free.length > shown.length && (
            <button onClick={() => setAll(true)} style={{ ...BTN_QUIET, alignSelf: "center" }}>{`Show all ${free.length}`}</button>
          )}
        </div>
      ))}

      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ flex: 1, minWidth: 160, fontSize: 12.5, color: offPrice ? WARN : MUTED, fontWeight: offPrice ? 600 : 400 }}>
          {ticked.size === 0 ? "Nothing ticked"
            : offPrice ? `${ticked.size} ticked — that is ${money(each)} each, not their ${money(client!.price)} price`
            : `${ticked.size} ticked · ${money(each)} each`}
        </span>
        <button disabled={busy || !client} onClick={onOther} title="A set-up fee, retainer or anything else that wasn't appointments"
          style={{ ...BTN_QUIET, opacity: busy || !client ? 0.4 : 1 }}>Not for appointments</button>
        <button disabled={busy || !client || ticked.size === 0} onClick={onSave}
          style={{ ...BTN_DARK, opacity: busy || !client || ticked.size === 0 ? 0.35 : 1 }}>
          {busy ? "Saving…" : ticked.size ? `Bill ${plural(ticked.size, "appointment")} to this payment` : "Save match"}
        </button>
      </div>
    </div>
  );
}

/* ── the screen ───────────────────────────────────────────────────────────── */

export default function StripeMatch({ start, end, periodLabel, onBack, onChanged }: {
  start: string | null; end: string | null; periodLabel: string;
  onBack: () => void;
  /** Something was saved — figures elsewhere are out of date. */
  onChanged: () => void;
}) {
  const [data, setData] = useState<Data | null>(null);
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);     // a payment id, or "all"
  const [saved, setSaved] = useState({ count: 0, total: 0 });
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let live = true;
    const q = new URLSearchParams();
    if (start) q.set("start", start);
    if (end) q.set("end", end);
    api(`/api/billing/stripe-match${q.toString() ? `?${q}` : ""}`)
      .then((d: Data) => {
        if (!live) return;
        setData({ ...d, payments: d.payments ?? [], clients: d.clients ?? [], appointments: d.appointments ?? {}, matched: d.matched ?? { count: 0, total: 0 }, other_currency: d.other_currency ?? 0 });
        setChoices(Object.fromEntries((d.payments ?? []).map(p => [p.id, { client_id: p.client_id, ticked: p.suggested ?? [] }])));
        setSaved({ count: 0, total: 0 });
        setError(null);
      })
      .catch(e => { if (live) setError(e instanceof Error ? e.message : "Could not load"); });
    return () => { live = false; };
  }, [start, end, version]);

  const payments = useMemo(() => [...(data?.payments ?? [])].sort((a, b) => b.date.localeCompare(a.date)), [data]);
  const clientById = useMemo(() => new Map((data?.clients ?? []).map(c => [c.id, c])), [data]);

  const tickedElsewhere = useCallback((paymentId: string) => {
    const out = new Set<string>();
    for (const [id, c] of Object.entries(choices)) if (id !== paymentId) c.ticked.forEach(t => out.add(t));
    return out;
  }, [choices]);

  // The same guess the server makes: the most recent untracked appointments
  // booked before the payment, as many as the amount pays for.
  const guess = (p: Payment, clientId: string): string[] => {
    const n = countFor(p.amount, clientById.get(clientId)?.price ?? 0);
    if (!n) return [];
    const elsewhere = tickedElsewhere(p.id);
    const paidAt = new Date(p.date).getTime() + DAY_MS;
    return (data?.appointments[clientId] ?? [])
      .filter(a => !elsewhere.has(a.event_id) && new Date(a.booked_at).getTime() <= paidAt)
      .slice(0, n).map(a => a.event_id);
  };

  const setClient = (p: Payment, clientId: string | null) =>
    setChoices(prev => ({ ...prev, [p.id]: { client_id: clientId, ticked: clientId ? guess(p, clientId) : [] } }));
  const toggle = (p: Payment, eventId: string) => setChoices(prev => {
    const cur = prev[p.id] ?? { client_id: null, ticked: [] };
    const ticked = cur.ticked.includes(eventId) ? cur.ticked.filter(t => t !== eventId) : [...cur.ticked, eventId];
    return { ...prev, [p.id]: { ...cur, ticked } };
  });

  // Take a saved payment and its appointments off the screen without reloading,
  // so the other cards keep what has been ticked on them.
  const settle = (p: Payment, choice: Choice) => {
    setData(prev => prev && ({
      ...prev,
      payments: prev.payments.filter(x => x.id !== p.id),
      appointments: choice.client_id
        ? { ...prev.appointments, [choice.client_id]: (prev.appointments[choice.client_id] ?? []).filter(a => !choice.ticked.includes(a.event_id)) }
        : prev.appointments,
    }));
    setChoices(prev => { const next = { ...prev }; delete next[p.id]; return next; });
    setSaved(prev => ({ count: prev.count + 1, total: prev.total + p.amount }));
  };

  const send = (p: Payment, choice: Choice, other: boolean) => api("/api/billing/stripe-match", other
    ? { payment_id: p.id, client_id: choice.client_id, other: true }
    : { payment_id: p.id, client_id: choice.client_id, event_ids: choice.ticked });

  const save = async (p: Payment, other: boolean) => {
    const choice = choices[p.id];
    const client = choice?.client_id ? clientById.get(choice.client_id) : null;
    if (!choice || !client) return;
    if (other && !window.confirm(`Log this ${money(p.amount)} for ${client.name} as a payment that wasn't for appointments?`)) return;
    setBusy(p.id); setError(null); setFlash(null);
    try {
      const res = await send(p, other ? { ...choice, ticked: [] } : choice, other);
      settle(p, other ? { ...choice, ticked: [] } : choice);
      setFlash((other ? `${money(p.amount)} logged for ${client.name}` : `${money(p.amount)} matched to ${plural(choice.ticked.length, "appointment")} for ${client.name}`)
        + (res?.noted === false ? ". Stripe would not take the note — the match itself is saved." : ""));
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
    } finally { setBusy(null); }
  };

  // Payments whose ticked appointments add up to the amount at the client's price.
  const clean = payments.filter(p => {
    const c = choices[p.id];
    const price = c?.client_id ? clientById.get(c.client_id)?.price ?? 0 : 0;
    return !!c?.client_id && c.ticked.length > 0 && countFor(p.amount, price) === c.ticked.length;
  });
  const cleanTotal = clean.reduce((t, p) => t + p.amount, 0);

  const saveAll = async () => {
    if (!clean.length) return;
    if (!window.confirm(`Save ${plural(clean.length, "match")} — ${money(cleanTotal)} against the appointments ticked on each?`)) return;
    setBusy("all"); setError(null); setFlash(null);
    let done = 0;
    try {
      for (const p of clean) {
        const choice = choices[p.id];
        await send(p, choice, false);
        settle(p, choice);
        done++;
      }
      setFlash(`${plural(done, "payment")} matched`);
    } catch (e) {
      setError(`${done ? `${plural(done, "payment")} saved, then: ` : ""}${e instanceof Error ? e.message : "Could not save"}`);
    } finally {
      setBusy(null);
      if (done) onChanged();
    }
  };

  const openTotal = payments.reduce((t, p) => t + p.amount, 0);
  const matched = { count: (data?.matched.count ?? 0) + saved.count, total: (data?.matched.total ?? 0) + saved.total };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <button onClick={onBack} style={BTN_QUIET}>← All clients</button>
        <div style={{ flex: 1, minWidth: 200 }}>
          <h3 style={{ fontSize: 17, fontWeight: 700, color: INK, letterSpacing: "-0.02em" }}>Match with Stripe</h3>
          <p style={{ fontSize: 12, color: MUTED, marginTop: 2 }}>
            {`Payments taken in Stripe, ${periodLabel}, not tied to appointments yet. Nothing is saved until you confirm. In Stripe, the payment only gets a note naming its appointments.`}
          </p>
        </div>
        <button onClick={() => setVersion(v => v + 1)} disabled={busy !== null} style={BTN_QUIET}>Refresh</button>
      </div>

      {error && <Note tone="bad">{error}</Note>}
      {flash && <Note tone="good">{flash}</Note>}

      {data === null ? (
        !error && <p style={{ fontSize: 13, color: FAINT }}>Reading Stripe…</p>
      ) : !data.connected ? (
        <div style={{ ...PANEL, padding: 24 }}>
          <p style={{ fontSize: 15, fontWeight: 700, color: INK }}>Stripe is not connected</p>
          <p style={{ fontSize: 13, color: MUTED, marginTop: 6 }}>Add the Stripe key to the live site to read payments.</p>
        </div>
      ) : !data.ready ? (
        <div style={{ ...PANEL, padding: 24 }}>
          <p style={{ fontSize: 13, color: MUTED }}>Client Billing needs a one-off database update first.</p>
        </div>
      ) : (<>
        <div style={TILE_GRID}>
          <Tile label="To match" value={String(payments.length)} sub={payments.length ? money(openTotal) : "nothing waiting"} tone={payments.length ? "warn" : undefined} />
          <Tile label="Ready to save" value={String(clean.length)} sub={clean.length ? `${money(cleanTotal)} · add up at the client's price` : "none add up on their own"} />
          <Tile label="Already matched" value={String(matched.count)} sub={money(matched.total)} tone={matched.count ? "good" : undefined} />
        </div>

        {data.limited && <Note tone="warn">{"Stripe would not share invoice details, so descriptions are thin and a payment charged from this dashboard may appear here too. Leave those unmatched."}</Note>}
        {data.more && <Note tone="warn">There are more payments in this period than could be read at once. Match these, then refresh.</Note>}
        {data.other_currency > 0 && <Note tone="warn">{`${plural(data.other_currency, "payment")} not in US dollars ${data.other_currency === 1 ? "is" : "are"} left out.`}</Note>}

        {payments.length === 0 ? (
          <div style={{ ...PANEL, padding: 24 }}>
            <p style={{ fontSize: 15, fontWeight: 700, color: INK }}>Nothing to match</p>
            <p style={{ fontSize: 13, color: MUTED, marginTop: 6 }}>{`Every payment Stripe took ${periodLabel} is already tied to a client.`}</p>
          </div>
        ) : (<>
          {clean.length > 0 && (
            <div style={{ ...PANEL, padding: "12px 16px", display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
              <span style={{ flex: 1, minWidth: 200, fontSize: 12.5, color: MUTED }}>
                {`${plural(clean.length, "payment")} already ${clean.length === 1 ? "adds" : "add"} up: the appointments ticked × the client's price = the amount paid. Check the ticks, then save them together.`}
              </span>
              <button onClick={saveAll} disabled={busy !== null} style={{ ...BTN_DARK, opacity: busy !== null ? 0.35 : 1 }}>
                {busy === "all" ? "Saving…" : `Save all ${clean.length} · ${money(cleanTotal)}`}
              </button>
            </div>
          )}
          {payments.map(p => {
            const choice = choices[p.id] ?? { client_id: null, ticked: [] };
            return (
              <PaymentCard key={p.id} payment={p} choice={choice} clients={data.clients}
                pool={choice.client_id ? data.appointments[choice.client_id] ?? [] : []}
                elsewhere={tickedElsewhere(p.id)} busy={busy === p.id || busy === "all"}
                onClient={id => setClient(p, id)} onToggle={id => toggle(p, id)}
                onSave={() => save(p, false)} onOther={() => save(p, true)} />
            );
          })}
        </>)}
      </>)}
    </div>
  );
}
