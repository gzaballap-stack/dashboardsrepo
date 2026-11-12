"use client";

import { useCallback, useEffect, useState } from "react";
import type { PayoutRow } from "@/lib/sms-payout";

/* ────────────────────────────────────────────────────────────────────────────
   Johnny's Payout (SMS Dashboard)

   Johnny gets a share of the first month's revenue from every client he signs
   through the B2B SMS system. One row per client signed in the period: when
   they signed (the SMS close), when their first text blast went out (the clock
   starts there), what Client Billing has collected inside those 30 days, the
   share, and the payout. Tracking until the 30 days are up, then Final.

   An SMS close becomes a row once it is tied to a roster client — by hand
   below, or on its own when the close named the client. A client can also be
   added without a close.
   ──────────────────────────────────────────────────────────────────────────── */

type Unlinked = { id: string; occurred_at: string; lead_name: string | null; lead_email: string | null; lead_phone: string | null; revenue: number; suggested_client_id: string | null };
type Data = {
  ready: boolean; error?: string; default_pct: number; rows: PayoutRow[];
  totals: { clients: number; revenue: number; payout: number; payout_final: number; payout_tracking: number };
  unlinked: Unlinked[]; clients: { id: string; name: string; linked: boolean }[];
};

const CARD = "#ffffff";
const BORDER = "1px solid rgba(0,0,0,0.07)";
const SHADOW = "0 1px 2px rgba(0,0,0,0.03), 0 10px 28px -12px rgba(0,0,0,0.10)";
const INK = "#111111";
const MUTED = "#767676";
const FAINT = "#a8a8a8";
const GOOD = "#1a7f4b";
const WARN = "#8a6d1f";

const money = (v: number) => `$${v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const date = (d: string | null | undefined) => {
  if (!d) return "—";
  const [y, m, day] = d.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day)).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
};

const STATUS: Record<PayoutRow["status"], { label: (r: PayoutRow) => string; color: string; bg: string }> = {
  not_started: { label: () => "No blast yet", color: MUTED, bg: "rgba(0,0,0,0.06)" },
  tracking:    { label: r => `Tracking · ${r.days_left} day${r.days_left === 1 ? "" : "s"} left`, color: WARN, bg: "rgba(160,130,40,0.13)" },
  final:       { label: () => "Final", color: GOOD, bg: "rgba(26,127,75,0.10)" },
};

const inputStyle: React.CSSProperties = { border: "1px solid rgba(0,0,0,0.14)", borderRadius: 8, padding: "4px 8px", fontSize: 13, color: INK, background: "#fff" };

export default function SmsPayout({ startDate, endDate }: { startDate: string; endDate: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pick, setPick] = useState<Record<string, string>>({});   // unlinked close id → chosen client
  const [addId, setAddId] = useState("");
  const [pctDraft, setPctDraft] = useState<Record<string, string>>({});
  const [defaultDraft, setDefaultDraft] = useState<string | null>(null);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (startDate) params.set("start_date", startDate);
    if (endDate) params.set("end_date", endDate);
    try {
      const r = await fetch(`/api/sms-payout?${params}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "Could not load the payout tracker");
      setData(j); setError(null);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not load the payout tracker"); }
  }, [startDate, endDate]);

  useEffect(() => { load(); }, [load]);

  async function act(key: string, body: Record<string, unknown>) {
    setBusy(key);
    try {
      const r = await fetch("/api/sms-payout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error ?? "That did not save");
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "That did not save"); }
    finally { setBusy(null); }
  }

  const header = (
    <div className="flex items-end justify-between gap-4 flex-wrap mb-4">
      <div>
        <h2 className="text-xs font-bold uppercase tracking-widest" style={{ color: "#949494" }}>Johnny&rsquo;s Payout</h2>
        <p className="text-xs mt-1" style={{ color: MUTED }}>
          Share of each signed client&rsquo;s first 30 days of revenue, counted from their first text blast. Revenue is what Client Billing has collected.
        </p>
      </div>
      {data?.ready && (
        <label className="flex items-center gap-2 text-xs" style={{ color: MUTED }}>
          Default share
          <input type="number" min={0} max={100} step={0.5} style={{ ...inputStyle, width: 72 }}
            value={defaultDraft ?? String(data.default_pct)}
            onChange={e => setDefaultDraft(e.target.value)}
            onBlur={() => { if (defaultDraft != null && defaultDraft !== String(data.default_pct)) act("default", { action: "default_pct", pct: Number(defaultDraft) }); setDefaultDraft(null); }}
            onKeyDown={e => { if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur(); }} />
          %
        </label>
      )}
    </div>
  );

  if (error && !data) return <section>{header}<p className="text-sm" style={{ color: "#b4472e" }}>{error}</p></section>;
  if (!data) return <section>{header}<p className="text-sm" style={{ color: FAINT }}>Loading…</p></section>;
  if (!data.ready) return <section>{header}<p className="text-sm" style={{ color: WARN }}>{data.error}</p></section>;

  const free = data.clients.filter(c => !c.linked);
  const t = data.totals;

  return (
    <section>
      {header}
      {error && <p className="text-xs mb-3" style={{ color: "#b4472e" }}>{error}</p>}

      {/* Totals */}
      <div className="grid gap-3 mb-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}>
        {([
          ["Clients signed", String(t.clients)],
          ["Revenue in window", money(t.revenue)],
          ["Payout so far", money(t.payout)],
          ["Final", money(t.payout_final)],
          ["Still tracking", money(t.payout_tracking)],
        ] as [string, string][]).map(([label, value]) => (
          <div key={label} className="rounded-2xl p-4" style={{ background: CARD, border: BORDER, boxShadow: SHADOW }}>
            <div className="text-xs font-medium" style={{ color: MUTED }}>{label}</div>
            <div className="text-2xl font-bold mt-1" style={{ color: INK }}>{value}</div>
          </div>
        ))}
      </div>

      {/* Rows */}
      <div className="rounded-2xl overflow-x-auto" style={{ background: CARD, border: BORDER, boxShadow: SHADOW }}>
        <table className="w-full text-sm" style={{ borderCollapse: "collapse", minWidth: 860 }}>
          <thead>
            <tr style={{ background: "#fafafa" }}>
              {["Client", "Signed", "Started", "Ends", "Revenue", "Share", "Payout", "Status", ""].map(h => (
                <th key={h} className={`px-3 py-2 text-[10px] font-bold uppercase tracking-wide ${["Revenue", "Share", "Payout"].includes(h) ? "text-right" : "text-left"}`} style={{ color: MUTED }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.rows.length === 0 && (
              <tr><td colSpan={9} className="px-3 py-6 text-center text-sm" style={{ color: FAINT }}>No clients signed through SMS in this period.</td></tr>
            )}
            {data.rows.map(r => {
              const s = STATUS[r.status];
              return (
                <tr key={r.id} style={{ borderTop: "1px solid rgba(0,0,0,0.05)" }}>
                  <td className="px-3 py-2 font-medium" style={{ color: INK }}>
                    {r.client_name}
                    {r.cash_at_close > 0 && <div className="text-[11px]" style={{ color: FAINT }}>{money(r.cash_at_close)} collected at the close (not counted)</div>}
                  </td>
                  <td className="px-3 py-2" style={{ color: "#4a4a4a" }}>{date(r.signed_on)}</td>
                  <td className="px-3 py-2" style={{ color: "#4a4a4a" }}>
                    <input type="date" style={{ ...inputStyle, width: 140 }} value={r.started_on ?? ""}
                      title={r.start_source === "blast" ? "First text blast — change it to set the start by hand" : r.start_source === "manual" ? "Set by hand" : "No blast sent yet — set a start by hand if needed"}
                      onChange={e => act(r.id, { action: "update", id: r.id, started_on: e.target.value || null })} />
                    <div className="text-[11px]" style={{ color: FAINT }}>
                      {r.start_source === "blast" ? "First blast" : r.start_source === "manual" ? (
                        <>Set by hand · <button className="underline" onClick={() => act(r.id, { action: "update", id: r.id, started_on: null })}>use first blast</button></>
                      ) : "Waiting for the first blast"}
                    </div>
                  </td>
                  <td className="px-3 py-2" style={{ color: "#4a4a4a" }}>{date(r.ends_on)}</td>
                  <td className="px-3 py-2 text-right" style={{ color: INK }}>
                    {money(r.revenue)}
                    <div className="text-[11px]" style={{ color: FAINT }}>{r.charges} charge{r.charges === 1 ? "" : "s"}</div>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <input type="number" min={0} max={100} step={0.5} style={{ ...inputStyle, width: 64, textAlign: "right" }}
                      value={pctDraft[r.id] ?? String(r.pct)}
                      onChange={e => setPctDraft(d => ({ ...d, [r.id]: e.target.value }))}
                      onBlur={() => { const v = pctDraft[r.id]; if (v != null && v !== String(r.pct)) act(r.id, { action: "update", id: r.id, pct: Number(v) }); setPctDraft(d => { const n = { ...d }; delete n[r.id]; return n; }); }}
                      onKeyDown={e => { if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur(); }} />
                    <span className="ml-1 text-xs" style={{ color: MUTED }}>%</span>
                  </td>
                  <td className="px-3 py-2 text-right font-semibold" style={{ color: INK }}>{money(r.payout)}</td>
                  <td className="px-3 py-2">
                    <span className="inline-block px-2 py-0.5 rounded-md text-[11px] font-semibold whitespace-nowrap" style={{ color: s.color, background: s.bg }}>{s.label(r)}</span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button className="text-xs" style={{ color: FAINT }} disabled={busy === r.id}
                      onClick={() => { if (confirm(`Take ${r.client_name} off Johnny's payout tracker?`)) act(r.id, { action: "remove", id: r.id }); }}>Remove</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
          {data.rows.length > 0 && (
            <tfoot>
              <tr style={{ borderTop: "1px solid rgba(0,0,0,0.1)", background: "#fafafa" }}>
                <td className="px-3 py-2 font-semibold" style={{ color: INK }} colSpan={4}>Total</td>
                <td className="px-3 py-2 text-right font-semibold" style={{ color: INK }}>{money(t.revenue)}</td>
                <td />
                <td className="px-3 py-2 text-right font-bold" style={{ color: INK }}>{money(t.payout)}</td>
                <td colSpan={2} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* Add a client by hand */}
      <div className="flex items-center gap-2 mt-3 text-xs" style={{ color: MUTED }}>
        Signed a client without a close here?
        <select style={{ ...inputStyle, maxWidth: 260 }} value={addId} onChange={e => setAddId(e.target.value)}>
          <option value="">Pick a client…</option>
          {free.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <button className="px-3 py-1 rounded-lg text-xs font-medium" style={{ background: "#000", color: "#fff", opacity: addId ? 1 : 0.4 }} disabled={!addId || busy === "add"}
          onClick={() => { act("add", { action: "add", client_id: addId }); setAddId(""); }}>Add</button>
      </div>

      {/* SMS closes not yet tied to a client */}
      {data.unlinked.length > 0 && (
        <div className="mt-6">
          <h3 className="text-xs font-bold uppercase tracking-widest mb-2" style={{ color: WARN }}>
            {data.unlinked.length} SMS close{data.unlinked.length === 1 ? "" : "s"} not yet tied to a client
          </h3>
          <p className="text-xs mb-3" style={{ color: MUTED }}>Pick which roster client each one became, so their billing can be tracked for Johnny.</p>
          <div className="rounded-2xl overflow-hidden" style={{ background: CARD, border: BORDER, boxShadow: SHADOW }}>
            {data.unlinked.map(u => {
              const chosen = pick[u.id] ?? u.suggested_client_id ?? "";
              return (
                <div key={u.id} className="flex items-center gap-3 flex-wrap px-4 py-3" style={{ borderTop: "1px solid rgba(0,0,0,0.05)" }}>
                  <div className="flex-1 min-w-[180px]">
                    <div className="text-sm font-medium" style={{ color: INK }}>{u.lead_name || "Name not recorded"}</div>
                    <div className="text-[11px]" style={{ color: FAINT }}>
                      Closed {date(u.occurred_at)}{u.revenue > 0 ? ` · ${money(u.revenue)} collected` : ""}{u.lead_email ? ` · ${u.lead_email}` : ""}
                    </div>
                  </div>
                  <select style={{ ...inputStyle, maxWidth: 260 }} value={chosen} onChange={e => setPick(p => ({ ...p, [u.id]: e.target.value }))}>
                    <option value="">Which client did they become?</option>
                    {free.map(c => <option key={c.id} value={c.id}>{c.name}{c.id === u.suggested_client_id ? " (looks like a match)" : ""}</option>)}
                  </select>
                  <button className="px-3 py-1.5 rounded-lg text-xs font-medium" style={{ background: "#000", color: "#fff", opacity: chosen ? 1 : 0.4 }} disabled={!chosen || busy === u.id}
                    onClick={() => act(u.id, { action: "link", close_event_id: u.id, client_id: chosen })}>Link</button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </section>
  );
}
