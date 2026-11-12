"use client";

// Clients > Onboarding. A three-column board, one card per client being
// onboarded. Open a card, pick Facebook Ads or SMS, and its checklist loads;
// tick or fill in the steps as you go, then drag the card to Done.
// Rules live in lib/onboarding.ts; see NOTES.md 2026-11-12.

import { useEffect, useMemo, useState } from "react";
import {
  STAGES, STAGE_LABEL, TRACKS, TRACK_LABEL, progress,
  type Card, type CardItem, type Stage, type TemplateItem, type Track,
} from "@/lib/onboarding";

const CARD_SHADOW = "0 1px 2px rgba(0,0,0,0.03), 0 10px 28px -12px rgba(0,0,0,0.10)";
const BORDER = "1px solid rgba(0,0,0,0.08)";
const STAGE_DOT: Record<Stage, string> = { not_started: "#94a3b8", in_progress: "#f59e0b", done: "#15803d" };
const TRACK_STYLE: Record<Track, { color: string; bg: string; short: string }> = {
  facebook: { color: "#1d4ed8", bg: "rgba(29,78,216,0.10)", short: "FB Ads" },
  sms:      { color: "#7c3aed", bg: "rgba(124,58,237,0.10)", short: "SMS" },
};

type Templates = Record<Track, TemplateItem[]>;
type ApiResult = { card?: Card; templates?: Templates; error?: string; message?: string; existing?: boolean; ok?: boolean };

async function post(body: Record<string, unknown>): Promise<ApiResult> {
  try {
    const res = await fetch("/api/onboarding", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    return res.ok ? json : { error: json.error ?? "Something went wrong" };
  } catch {
    return { error: "Could not reach the server" };
  }
}

const day = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short" });
function age(iso: string): string {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  return d <= 0 ? "today" : d === 1 ? "1 day" : `${d} days`;
}

function TrackChip({ track }: { track: Track | null }) {
  if (!track) return <span className="text-xs font-semibold px-2 py-0.5 rounded-md whitespace-nowrap flex-shrink-0" style={{ color: "#949494", background: "rgba(0,0,0,0.05)" }}>Pick a service</span>;
  const s = TRACK_STYLE[track];
  return <span className="text-xs font-semibold px-2 py-0.5 rounded-md whitespace-nowrap flex-shrink-0" style={{ color: s.color, background: s.bg }}>{s.short}</span>;
}

function Bar({ done, total }: { done: number; total: number }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 rounded-full overflow-hidden" style={{ height: 4, background: "rgba(0,0,0,0.07)" }}>
        <div style={{ width: `${pct}%`, height: "100%", background: pct === 100 ? "#15803d" : "#111111", transition: "width .2s" }} />
      </div>
      <span className="text-xs tabular-nums" style={{ color: "#767676" }}>{done}/{total}</span>
    </div>
  );
}

export default function OnboardingBoard() {
  const [ready, setReady] = useState<boolean | null>(null);
  const [setupNote, setSetupNote] = useState("");
  const [cards, setCards] = useState<Card[]>([]);
  const [templates, setTemplates] = useState<Templates | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Drag state: the card in hand, and where it would land.
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<{ stage: Stage; beforeId: string | null } | null>(null);

  useEffect(() => {
    fetch("/api/onboarding").then(r => r.json()).then(d => {
      if (d.ready === false) { setReady(false); setSetupNote(d.error ?? ""); return; }
      if (d.error) { setError(d.error); setReady(true); return; }
      setCards(d.cards ?? []); setTemplates(d.templates ?? null); setIsAdmin(!!d.is_admin); setReady(true);
    }).catch(() => { setError("Could not load the board"); setReady(true); });
  }, []);

  const byStage = useMemo(() => {
    const out: Record<Stage, Card[]> = { not_started: [], in_progress: [], done: [] };
    for (const c of cards) (out[c.stage] ?? out.not_started).push(c);
    for (const s of STAGES) out[s].sort((a, b) => a.position - b.position);
    return out;
  }, [cards]);

  const put = (card: Card) => setCards(prev => prev.some(c => c.id === card.id) ? prev.map(c => c.id === card.id ? card : c) : [...prev, card]);

  async function add() {
    const name = newName.trim();
    if (!name || adding) return;
    setAdding(true); setError(null); setNotice(null);
    const r = await post({ action: "create", client_name: name });
    setAdding(false);
    if (r.error || !r.card) { setError(r.error ?? "Could not add the card"); return; }
    put(r.card); setNewName(""); setOpenId(r.card.id);
    if (r.existing) setNotice(`${r.card.client_name} already has a card under way — opened it.`);
  }

  // Drop: before the card being hovered, else at the bottom of the column.
  async function move(id: string, stage: Stage, beforeId: string | null) {
    const card = cards.find(c => c.id === id);
    if (!card) return;
    const col = byStage[stage].filter(c => c.id !== id);
    const i = beforeId ? col.findIndex(c => c.id === beforeId) : -1;
    const position = i < 0 ? (col.length ? col[col.length - 1].position + 1 : 1)
      : i === 0 ? col[0].position - 1
      : (col[i - 1].position + col[i].position) / 2;
    if (card.stage === stage && card.position === position) return;
    const before = card;
    put({ ...card, stage, position, completed_at: stage === "done" ? (card.completed_at ?? new Date().toISOString()) : null });
    const r = await post({ action: "move", id, stage, position });
    if (r.error || !r.card) { put(before); setError(r.error ?? "Could not move the card"); } else put(r.card);
  }

  function drop(stage: Stage) {
    if (dragId) move(dragId, stage, over?.stage === stage ? over.beforeId : null);
    setDragId(null); setOver(null);
  }

  if (ready === null) return <p className="text-sm py-8 text-center" style={{ color: "#949494" }}>Loading…</p>;
  if (ready === false) {
    return (
      <div className="max-w-xl mx-auto rounded-2xl p-6" style={{ background: "#ffffff", border: BORDER, boxShadow: CARD_SHADOW }}>
        <h2 className="text-xl font-semibold" style={{ color: "#111111" }}>Onboarding</h2>
        <p className="text-sm mt-2" style={{ color: "#767676" }}>{setupNote || "Onboarding needs a one-off database update before it can be used."}</p>
      </div>
    );
  }

  const open = cards.find(c => c.id === openId) ?? null;

  return (
    <div className="space-y-5 w-full max-w-6xl mx-auto">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold" style={{ color: "#111111" }}>Onboarding</h2>
          <p className="text-sm mt-0.5" style={{ color: "#767676" }}>One card per new client. Open it, pick Facebook Ads or SMS, and work down the list.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={newName} onChange={e => setNewName(e.target.value)} onKeyDown={e => { if (e.key === "Enter") add(); }}
            placeholder="New client name…" aria-label="New client name"
            className="px-3 py-2 rounded-lg text-sm outline-none" style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.162)", color: "#111111", width: 220, flex: "1 1 160px" }} />
          <button onClick={add} disabled={!newName.trim() || adding}
            className="px-4 py-2 rounded-lg text-sm font-semibold flex-shrink-0"
            style={{ background: "#000000", color: "#fff", opacity: !newName.trim() || adding ? 0.5 : 1 }}>
            {adding ? "Adding…" : "Add client"}
          </button>
          {isAdmin && (
            <button onClick={() => setEditing(true)} className="px-3 py-2 rounded-lg text-sm font-medium flex-shrink-0"
              style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.162)", color: "#111111" }}>
              Edit checklists
            </button>
          )}
        </div>
      </div>

      {error && (
        <p className="text-sm px-3 py-2 rounded-lg flex items-center justify-between gap-3" style={{ color: "#b91c1c", background: "rgba(185,28,28,0.08)" }}>
          {error}
          <button onClick={() => setError(null)} className="text-xs underline flex-shrink-0">dismiss</button>
        </p>
      )}

      {notice && (
        <p className="text-sm px-3 py-2 rounded-lg flex items-center justify-between gap-3" style={{ color: "#4a4a4a", background: "rgba(0,0,0,0.05)" }}>
          {notice}
          <button onClick={() => setNotice(null)} className="text-xs underline flex-shrink-0">dismiss</button>
        </p>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-start">
        {STAGES.map(stage => {
          const col = byStage[stage];
          const target = dragId && over?.stage === stage;
          return (
            <section key={stage} aria-label={STAGE_LABEL[stage]}
              onDragOver={e => { if (!dragId) return; e.preventDefault(); if (over?.stage !== stage) setOver({ stage, beforeId: null }); }}
              onDrop={e => { e.preventDefault(); drop(stage); }}
              className="rounded-2xl p-3"
              style={{ background: target ? "rgba(0,0,0,0.055)" : "rgba(0,0,0,0.03)", border: "1px solid rgba(0,0,0,0.05)", minHeight: 180, transition: "background .12s" }}>
              <header className="flex items-center gap-2 px-1 pb-3">
                <span className="w-2 h-2 rounded-full" style={{ background: STAGE_DOT[stage] }} />
                <h3 className="text-sm font-semibold" style={{ color: "#111111" }}>{STAGE_LABEL[stage]}</h3>
                <span className="text-xs tabular-nums" style={{ color: "#949494" }}>{col.length}</span>
              </header>
              <div className="space-y-2">
                {col.map(c => {
                  const p = progress(c.items);
                  const landing = dragId && dragId !== c.id && over?.stage === stage && over.beforeId === c.id;
                  return (
                    <div key={c.id}>
                      {landing && <div className="rounded-full mb-2" style={{ height: 3, background: "#111111" }} />}
                      <article
                        draggable
                        onDragStart={e => { setDragId(c.id); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", c.id); }}
                        onDragEnd={() => { setDragId(null); setOver(null); }}
                        onDragOver={e => { if (!dragId || dragId === c.id) return; e.preventDefault(); e.stopPropagation(); if (over?.stage !== stage || over.beforeId !== c.id) setOver({ stage, beforeId: c.id }); }}
                        onClick={() => setOpenId(c.id)}
                        onKeyDown={e => { if (e.key === "Enter") setOpenId(c.id); }}
                        role="button" tabIndex={0} aria-label={`Open ${c.client_name}`}
                        className="rounded-xl p-3 cursor-pointer select-none"
                        style={{ background: "#ffffff", border: BORDER, boxShadow: "0 1px 2px rgba(0,0,0,0.04)", opacity: dragId === c.id ? 0.4 : 1 }}>
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-semibold leading-snug" style={{ color: "#111111", wordBreak: "break-word" }}>{c.client_name}</p>
                          <TrackChip track={c.track} />
                        </div>
                        {c.track && <div className="mt-2.5"><Bar done={p.done} total={p.total} /></div>}
                        <p className="text-xs mt-2" style={{ color: "#949494" }}>
                          {stage === "done" && c.completed_at ? `Done ${day(c.completed_at)}` : `Added ${age(c.created_at) === "today" ? "today" : `${age(c.created_at)} ago`}`}
                        </p>
                      </article>
                    </div>
                  );
                })}
                {col.length === 0 && (
                  <p className="text-xs text-center py-6" style={{ color: "#949494" }}>
                    {stage === "not_started" ? "Add a client above to start." : stage === "in_progress" ? "Cards move here on their first tick." : "Drag a card here when it's finished."}
                  </p>
                )}
              </div>
            </section>
          );
        })}
      </div>

      {open && (
        <CardPanel
          key={open.id} card={open} templates={templates}
          onChange={put} onClose={() => setOpenId(null)}
          onStage={stage => move(open.id, stage, null)}
          onDelete={async () => {
            const r = await post({ action: "delete", id: open.id });
            if (r.error) { setError(r.error); return; }
            setCards(prev => prev.filter(c => c.id !== open.id)); setOpenId(null);
          }} />
      )}
      {editing && templates && (
        <TemplateEditor templates={templates} onClose={() => setEditing(false)} onSaved={t => setTemplates(t)} />
      )}
    </div>
  );
}

// ── The card, opened ─────────────────────────────────────────────────────────

function CardPanel({ card, templates, onChange, onClose, onStage, onDelete }: {
  card: Card; templates: Templates | null;
  onChange: (c: Card) => void; onClose: () => void; onStage: (s: Stage) => void; onDelete: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [name, setName] = useState(card.client_name);
  const [notes, setNotes] = useState(card.notes ?? "");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function send(key: string, body: Record<string, unknown>): Promise<boolean> {
    setBusy(key); setError(null); setNotice(null);
    const r = await post({ ...body, id: card.id });
    setBusy(null);
    if (r.error || !r.card) { setError(r.error ?? "Could not save"); return false; }
    onChange(r.card); if (r.message) setNotice(r.message);
    return true;
  }

  const p = progress(card.items);
  const allDone = p.total > 0 && p.done === p.total;
  // The checklist on the card is its own copy; say so when the template has moved on.
  const stale = !!card.track && !!templates &&
    JSON.stringify(templates[card.track].map(t => [t.id, t.kind, t.label, t.auto ?? ""])) !==
    JSON.stringify(card.items.map(t => [t.id, t.kind, t.label, t.auto ?? ""]));

  return (
    <div className="fixed inset-0 z-50 flex justify-end" style={{ background: "rgba(0,0,0,0.32)" }} onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <aside role="dialog" aria-label={`Onboarding — ${card.client_name}`} className="h-full w-full flex flex-col" style={{ maxWidth: 520, background: "#ffffff", boxShadow: "-12px 0 40px -12px rgba(0,0,0,0.25)" }}>
        <div className="px-5 pt-5 pb-4" style={{ borderBottom: BORDER }}>
          <div className="flex items-start gap-3">
            <input
              value={name} onChange={e => setName(e.target.value)} aria-label="Client name"
              onBlur={() => { const v = name.trim(); if (v && v !== card.client_name) send("name", { action: "update", client_name: v }); else setName(card.client_name); }}
              onKeyDown={e => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
              className="flex-1 text-lg font-semibold outline-none rounded-md px-1 -mx-1" style={{ color: "#111111", background: "transparent" }} />
            <button onClick={onClose} aria-label="Close" className="text-xl leading-none px-1" style={{ color: "#767676" }}>×</button>
          </div>
          <p className="text-xs mt-1" style={{ color: "#949494" }}>
            The name is what goes on the Client Roster — keep it exactly as GHL sends it.
          </p>
          <div className="flex items-center gap-1 mt-3">
            {STAGES.map(s => (
              <button key={s} onClick={() => { if (s !== card.stage) onStage(s); }} aria-pressed={card.stage === s}
                className="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-semibold"
                style={card.stage === s ? { background: "#111111", color: "#ffffff" } : { background: "rgba(0,0,0,0.05)", color: "#767676" }}>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: STAGE_DOT[s] }} />{STAGE_LABEL[s]}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-auto px-5 py-4 space-y-5">
          {error && <p className="text-sm px-3 py-2 rounded-lg" style={{ color: "#b91c1c", background: "rgba(185,28,28,0.08)" }}>{error}</p>}
          {notice && <p className="text-sm px-3 py-2 rounded-lg" style={{ color: "#15803d", background: "rgba(21,128,61,0.08)" }}>{notice}</p>}

          {(!card.track || switching) ? (
            <div>
              <p className="text-sm font-semibold mb-2" style={{ color: "#111111" }}>{switching ? "Switch to which service?" : "What are we onboarding?"}</p>
              <div className="grid grid-cols-2 gap-3">
                {TRACKS.map(t => (
                  <button key={t} disabled={!!busy}
                    onClick={async () => { if (t === card.track) { setSwitching(false); return; } if (await send("track", { action: "update", track: t })) setSwitching(false); }}
                    className="rounded-xl p-4 text-left"
                    style={{ background: card.track === t ? TRACK_STYLE[t].bg : "#fafafa", border: BORDER, opacity: busy ? 0.6 : 1 }}>
                    <span className="block text-base font-semibold" style={{ color: TRACK_STYLE[t].color }}>{TRACK_LABEL[t]}</span>
                    <span className="block text-xs mt-1" style={{ color: "#767676" }}>{templates ? `${templates[t].filter(i => i.kind !== "heading").length} steps` : "Checklist"}</span>
                  </button>
                ))}
              </div>
              {switching && <p className="text-xs mt-2" style={{ color: "#949494" }}>Steps both lists share keep their ticks. <button className="underline" onClick={() => setSwitching(false)}>Cancel</button></p>}
            </div>
          ) : (
            <div>
              <div className="flex items-center justify-between gap-3 mb-2">
                <div className="flex items-center gap-2">
                  <TrackChip track={card.track} />
                  <button onClick={() => setSwitching(true)} className="text-xs underline" style={{ color: "#949494" }}>change</button>
                </div>
                <div style={{ width: 150 }}><Bar done={p.done} total={p.total} /></div>
              </div>
              {stale && (
                <p className="text-xs mb-2 px-3 py-2 rounded-lg" style={{ color: "#92400e", background: "rgba(245,158,11,0.12)" }}>
                  The checklist has been edited since this card started.{" "}
                  <button className="underline font-semibold" disabled={!!busy} onClick={() => send("refresh", { action: "refresh" })}>Update this card</button> (ticks are kept).
                </p>
              )}
              <ul className="space-y-1">
                {card.items.map(item => item.kind === "heading" ? (
                  <li key={item.id} className="text-xs font-semibold uppercase tracking-wider pt-3 pb-1" style={{ color: "#949494" }}>{item.label}</li>
                ) : (
                  <Step key={`${item.id}:${item.value ?? ""}`} item={item} busy={busy === item.id}
                    onTick={done => send(item.id, { action: "item", item_id: item.id, done })}
                    onValue={value => send(item.id, { action: "item", item_id: item.id, value })} />
                ))}
              </ul>
              {allDone && card.stage !== "done" && (
                <button onClick={() => onStage("done")} className="w-full mt-4 py-2.5 rounded-lg text-sm font-semibold" style={{ background: "#15803d", color: "#ffffff" }}>
                  Everything is ticked — move to Done
                </button>
              )}
            </div>
          )}

          {(card.contact_name || card.contact_email || card.contact_phone) && (
            <div className="rounded-xl px-3 py-2.5 text-xs" style={{ background: "#fafafa", border: BORDER, color: "#4a4a4a" }}>
              <span className="font-semibold" style={{ color: "#111111" }}>Contact</span>{" "}
              {[card.contact_name, card.contact_email, card.contact_phone].filter(Boolean).join(" · ")}
            </div>
          )}

          <div>
            <label htmlFor="onb-notes" className="text-xs font-semibold uppercase tracking-wider" style={{ color: "#949494" }}>Notes</label>
            <textarea id="onb-notes" value={notes} onChange={e => setNotes(e.target.value)} rows={3}
              onBlur={() => { if (notes !== (card.notes ?? "")) send("notes", { action: "update", notes }); }}
              placeholder="Logins, links, anything the next person needs…"
              className="w-full mt-1.5 px-3 py-2 rounded-lg text-sm outline-none" style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.162)", color: "#111111", resize: "vertical" }} />
          </div>
        </div>

        <div className="px-5 py-3 flex items-center justify-between" style={{ borderTop: BORDER }}>
          <span className="text-xs" style={{ color: "#949494" }}>Added {day(card.created_at)}{card.source === "ghl_form" ? " from the onboarding form" : ""}</span>
          {confirmDelete ? (
            <span className="flex items-center gap-2">
              <button onClick={onDelete} className="text-xs font-semibold px-2 py-1 rounded" style={{ color: "#b91c1c", background: "rgba(185,28,28,0.12)" }}>Delete card</button>
              <button onClick={() => setConfirmDelete(false)} className="text-xs" style={{ color: "#767676" }}>Cancel</button>
            </span>
          ) : (
            <button onClick={() => setConfirmDelete(true)} className="text-xs" style={{ color: "#949494" }}>Delete</button>
          )}
        </div>
      </aside>
    </div>
  );
}

function Step({ item, busy, onTick, onValue }: {
  item: CardItem; busy: boolean; onTick: (done: boolean) => void; onValue: (value: string) => void;
}) {
  // Keyed on the saved value by the caller, so this starts from it each time it changes.
  const saved = item.value ?? "";
  const [value, setValue] = useState(saved);
  const who = item.done && item.by ? `${item.by}${item.at ? ` · ${day(item.at)}` : ""}` : "";
  const commit = () => { if (value.trim() !== saved) onValue(value.trim()); };

  if (item.kind === "text") {
    return (
      <li className="rounded-lg px-2 py-2" style={{ opacity: busy ? 0.6 : 1 }}>
        <div className="flex items-center gap-2.5">
          <Tick done={!!item.done} />
          <label htmlFor={`onb-${item.id}`} className="text-sm flex-1" style={{ color: "#111111" }}>{item.label}</label>
          {who && <span className="text-xs flex-shrink-0" style={{ color: "#949494" }}>{who}</span>}
        </div>
        <div className="flex gap-2 mt-1.5" style={{ paddingLeft: 28 }}>
          <input id={`onb-${item.id}`} value={value} onChange={e => setValue(e.target.value)} disabled={busy}
            onKeyDown={e => { if (e.key === "Enter") commit(); }}
            placeholder={item.auto === "ad_account" ? "act_… or paste the Ads Manager link" : "Type it in…"}
            className="flex-1 px-3 py-1.5 rounded-lg text-sm outline-none" style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.162)", color: "#111111", minWidth: 0 }} />
          <button onClick={commit} disabled={busy || value.trim() === saved}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold flex-shrink-0"
            style={{ background: "#000000", color: "#ffffff", opacity: busy || value.trim() === saved ? 0.35 : 1 }}>
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
        {item.note && <p className="text-xs mt-1" style={{ paddingLeft: 28, color: "#15803d" }}>{item.note}</p>}
      </li>
    );
  }

  return (
    <li>
      <button onClick={() => onTick(!item.done)} disabled={busy} aria-pressed={!!item.done}
        className="w-full flex items-start gap-2.5 text-left rounded-lg px-2 py-2 transition-colors"
        style={{ opacity: busy ? 0.6 : 1 }}
        onMouseEnter={e => (e.currentTarget.style.background = "rgba(0,0,0,0.03)")}
        onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
        <Tick done={!!item.done} />
        <span className="flex-1">
          <span className="block text-sm" style={{ color: item.done ? "#767676" : "#111111", textDecoration: item.done ? "line-through" : "none" }}>{item.label}</span>
          {item.auto === "roster" && !item.done && <span className="block text-xs mt-0.5" style={{ color: "#949494" }}>Tick it and the client is added to the roster for you.</span>}
          {item.note && <span className="block text-xs mt-0.5" style={{ color: "#15803d" }}>{item.note}</span>}
        </span>
        {who && <span className="text-xs flex-shrink-0 pt-0.5" style={{ color: "#949494" }}>{who}</span>}
      </button>
    </li>
  );
}

function Tick({ done }: { done: boolean }) {
  return (
    <span aria-hidden className="flex items-center justify-center flex-shrink-0 rounded-md" style={{ width: 18, height: 18, marginTop: 1, background: done ? "#15803d" : "#ffffff", border: done ? "1px solid #15803d" : "1.5px solid rgba(0,0,0,0.28)" }}>
      {done && <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="#ffffff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M2.5 6.5l2.5 2.5 4.5-5.5" /></svg>}
    </span>
  );
}

// ── The two checklists (admins) ──────────────────────────────────────────────

const AUTO_NOTE: Record<string, string> = {
  roster: "Automatic — adds the client to the Client Roster",
  ad_account: "Automatic — saves the ad account so spend syncs",
};

function TemplateEditor({ templates, onClose, onSaved }: {
  templates: Templates; onClose: () => void; onSaved: (t: Templates) => void;
}) {
  const [track, setTrack] = useState<Track>("facebook");
  const [draft, setDraft] = useState<Templates>(templates);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<Track | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);   // the row just added takes the cursor
  const rows = draft[track];
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const dirty = JSON.stringify(draft[track]) !== JSON.stringify(templates[track]);

  const setRows = (next: TemplateItem[]) => { setSavedAt(null); setDraft(d => ({ ...d, [track]: next })); };
  const edit = (i: number, patch: Partial<TemplateItem>) => setRows(rows.map((r, j) => j === i ? { ...r, ...patch } : r));
  const shift = (i: number, by: number) => {
    const j = i + by; if (j < 0 || j >= rows.length) return;
    const next = [...rows]; [next[i], next[j]] = [next[j], next[i]]; setRows(next);
  };
  const addRow = (kind: TemplateItem["kind"]) => {
    const id = `s_${Math.random().toString(36).slice(2, 10)}`;
    setFocusId(id); setRows([...rows, { id, kind, label: "" }]);
  };

  async function save(items: TemplateItem[] | null) {
    setSaving(true); setError(null);
    const r = await post({ action: "template", track, items });
    setSaving(false);
    if (r.error || !r.templates) { setError(r.error ?? "Could not save"); return; }
    onSaved(r.templates); setDraft(d => ({ ...d, [track]: r.templates![track] })); setSavedAt(track);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.32)" }} onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-label="Edit checklists" className="w-full flex flex-col rounded-2xl" style={{ maxWidth: 640, maxHeight: "90vh", background: "#ffffff", boxShadow: "0 24px 60px -20px rgba(0,0,0,0.4)" }}>
        <div className="px-5 pt-5 pb-3" style={{ borderBottom: BORDER }}>
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold" style={{ color: "#111111" }}>Checklists</h3>
            <button onClick={onClose} aria-label="Close" className="text-xl leading-none px-1" style={{ color: "#767676" }}>×</button>
          </div>
          <p className="text-xs mt-1" style={{ color: "#767676" }}>New cards get the list as it is here. Cards already under way offer to update.</p>
          <div className="flex gap-1 mt-3">
            {TRACKS.map(t => (
              <button key={t} onClick={() => { setTrack(t); setError(null); }} aria-pressed={track === t}
                className="flex-1 py-1.5 rounded-lg text-sm font-semibold"
                style={track === t ? { background: "#111111", color: "#ffffff" } : { background: "rgba(0,0,0,0.05)", color: "#767676" }}>
                {TRACK_LABEL[t]}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-auto px-5 py-3 space-y-1.5">
          {rows.map((r, i) => (
            <div key={r.id} className="flex items-center gap-1.5">
              <select value={r.kind} disabled={!!r.auto} aria-label="Step type"
                onChange={e => edit(i, { kind: e.target.value as TemplateItem["kind"] })}
                className="outline-none flex-shrink-0" style={{ padding: "6px 6px", borderRadius: 8, fontSize: 12, fontWeight: 600, color: "#111111", background: "#ffffff", border: "1px solid rgba(0,0,0,0.14)", width: 92 }}>
                <option value="check">Tick</option>
                <option value="text">Fill in</option>
                <option value="heading">Heading</option>
              </select>
              <div className="flex-1" style={{ minWidth: 0 }}>
                <input value={r.label} onChange={e => edit(i, { label: e.target.value })} aria-label="Step" autoFocus={r.id === focusId}
                  placeholder={r.kind === "heading" ? "Section name…" : "What needs doing…"}
                  className="w-full px-3 py-1.5 rounded-lg text-sm outline-none"
                  style={{ background: r.kind === "heading" ? "#fafafa" : "#ffffff", border: "1px solid rgba(0,0,0,0.162)", color: "#111111", fontWeight: r.kind === "heading" ? 600 : 400 }} />
                {r.auto && <p className="text-xs mt-0.5" style={{ color: "#15803d" }}>{AUTO_NOTE[r.auto]}</p>}
              </div>
              <button onClick={() => shift(i, -1)} disabled={i === 0} aria-label="Move up" className="px-1.5 text-sm" style={{ color: "#767676", opacity: i === 0 ? 0.3 : 1 }}>↑</button>
              <button onClick={() => shift(i, 1)} disabled={i === rows.length - 1} aria-label="Move down" className="px-1.5 text-sm" style={{ color: "#767676", opacity: i === rows.length - 1 ? 0.3 : 1 }}>↓</button>
              <button onClick={() => setRows(rows.filter((_, j) => j !== i))} aria-label="Remove step" className="px-1.5 text-sm" style={{ color: "#b91c1c" }}>×</button>
            </div>
          ))}
          <div className="flex gap-2 pt-2">
            <button onClick={() => addRow("check")} className="px-3 py-1.5 rounded-lg text-xs font-semibold" style={{ background: "rgba(0,0,0,0.06)", color: "#111111" }}>+ Step</button>
            <button onClick={() => addRow("text")} className="px-3 py-1.5 rounded-lg text-xs font-semibold" style={{ background: "rgba(0,0,0,0.06)", color: "#111111" }}>+ Fill-in step</button>
            <button onClick={() => addRow("heading")} className="px-3 py-1.5 rounded-lg text-xs font-semibold" style={{ background: "rgba(0,0,0,0.06)", color: "#111111" }}>+ Heading</button>
          </div>
        </div>

        <div className="px-5 py-3 flex items-center justify-between gap-3" style={{ borderTop: BORDER }}>
          <button onClick={() => save(null)} disabled={saving} className="text-xs underline" style={{ color: "#949494" }}>Reset to the starter list</button>
          <div className="flex items-center gap-3">
            {error && <span className="text-xs" style={{ color: "#b91c1c" }}>{error}</span>}
            {savedAt === track && !dirty && <span className="text-xs" style={{ color: "#15803d" }}>Saved</span>}
            <button onClick={() => save(rows.filter(r => r.label.trim()))} disabled={saving || !dirty}
              className="px-4 py-2 rounded-lg text-sm font-semibold" style={{ background: "#000000", color: "#ffffff", opacity: saving || !dirty ? 0.4 : 1 }}>
              {saving ? "Saving…" : `Save ${TRACK_LABEL[track]} list`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
