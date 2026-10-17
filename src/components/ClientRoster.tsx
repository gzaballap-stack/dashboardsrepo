"use client";

import { useEffect, useState } from "react";

type Status = "live" | "paused" | "offline" | "setup";
type Service = "facebook_ads" | "sms" | "both";
type Client = { id: string; name: string; is_live?: boolean; status?: Status; service?: Service | null };

// What we run for a client. Null = not set yet.
const SERVICES: { id: Service; label: string }[] = [
  { id: "facebook_ads", label: "Facebook Ads" },
  { id: "sms",          label: "SMS" },
  { id: "both",         label: "Both" },
];
const serviceLabel = (s: Service | null | undefined) => SERVICES.find(x => x.id === s)?.label ?? "Not set";

// Column sort orders. Status: live first. Service: Both first, then Facebook
// Ads, then SMS, with "not set" last. Ties fall back to the name.
type SortKey = "name" | "status" | "service";
const STATUS_RANK: Record<Status, number> = { live: 0, paused: 1, offline: 2, setup: 3 };
const SERVICE_RANK = (s: Service | null | undefined) => (s === "both" ? 0 : s === "facebook_ads" ? 1 : s === "sms" ? 2 : 3);

// Setup = being onboarded, not live yet: counted apart, and like paused it is
// kept out of live rollups and stale alerts (only "live" is live).
const STATUS_ORDER: Status[] = ["live", "paused", "offline", "setup"];
const STATUS_STYLE = {
  live:    { label: "Live",    color: "#15803d", bg: "rgba(21,128,61,0.10)", dot: "#15803d" },
  paused:  { label: "Paused",  color: "#b45309", bg: "rgba(180,83,9,0.10)",  dot: "#f59e0b" },
  offline: { label: "Offline", color: "#b91c1c", bg: "rgba(185,28,28,0.10)", dot: "#94a3b8" },
  setup:   { label: "Setup",   color: "#1d4ed8", bg: "rgba(29,78,216,0.10)", dot: "#3b82f6" },
} as const;
const statusOf = (c: Client): Status => c.status ?? (c.is_live ? "live" : "offline");

function Input({ value, onChange, placeholder = "", className = "" }: {
  value: string; onChange: (v: string) => void; placeholder?: string; className?: string;
}) {
  return (
    <input
      type="text"
      value={value}
      placeholder={placeholder}
      onChange={e => onChange(e.target.value)}
      className={`px-3 py-2 rounded-lg text-sm outline-none ${className}`}
      style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.162)", color: "#111111" }}
    />
  );
}

export default function ClientRoster() {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [linkedNote, setLinkedNote] = useState<string | null>(null);
  // Filters. Each bar's counts respect the other bar's pick, so "Live" then
  // the service bar reads how the live clients split.
  const [statusFilter, setStatusFilter] = useState<Status | null>(null);
  const [serviceFilter, setServiceFilter] = useState<Service | "none" | null>(null);
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "name", desc: false });

  useEffect(() => {
    fetch("/api/clients")
      .then(r => r.json())
      .then(d => { setClients((d.clients ?? []).filter((c: { is_internal?: boolean }) => !c.is_internal)); setLoading(false); });
  }, []);

  async function handleAdd() {
    if (!newName.trim()) return;
    setSaving(true);
    const res = await fetch("/api/clients", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.trim() }),
    });
    const d = await res.json();
    if (d.client) {
      setClients(prev => [...prev, { ...d.client, is_live: true, status: "live" }].sort((a, b) => a.name.localeCompare(b.name)));
      setNewName("");
      setLinkedNote(d.linked_session
        ? `Territory session “${d.linked_session.name}” moved into ${d.client.name} in the Zip Tool.`
        : null);
    }
    setSaving(false);
  }

  async function setStatus(c: Client, next: Status) {
    setToggling(c.id);
    const res = await fetch(`/api/clients/${c.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    const d = await res.json();
    if (d.client) setClients(prev => prev.map(x => x.id === c.id ? { ...x, is_live: d.client.is_live, status: d.client.status } : x));
    setToggling(null);
  }

  async function setService(c: Client, service: Service | null) {
    setToggling(c.id);
    const res = await fetch(`/api/clients/${c.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ service }),
    });
    const d = await res.json();
    if (d.client) setClients(prev => prev.map(x => x.id === c.id ? { ...x, service: d.client.service ?? null } : x));
    setToggling(null);
  }

  async function handleDelete(id: string) {
    await fetch("/api/clients", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    setClients(prev => prev.filter(x => x.id !== id));
    setConfirmDelete(null);
  }

  const matchesService = (c: Client) =>
    serviceFilter === null || (serviceFilter === "none" ? !c.service : c.service === serviceFilter);
  const matchesStatus = (c: Client) => statusFilter === null || statusOf(c) === statusFilter;
  const byService = clients.filter(matchesService);   // what the status bar counts
  const byStatus = clients.filter(matchesStatus);     // what the service bar counts
  const byName = (a: Client, b: Client) => a.name.localeCompare(b.name);
  const shown = clients.filter(c => matchesStatus(c) && matchesService(c)).sort((a, b) => {
    const d = sort.key === "status" ? STATUS_RANK[statusOf(a)] - STATUS_RANK[statusOf(b)]
      : sort.key === "service" ? SERVICE_RANK(a.service) - SERVICE_RANK(b.service)
      : byName(a, b);
    return (sort.desc ? -d : d) || byName(a, b);
  });
  const sortBy = (key: SortKey) => setSort(prev => ({ key, desc: prev.key === key ? !prev.desc : false }));
  const th = (k: SortKey, label: string) => (
    <th key={k} className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: "#949494" }}>
      <button onClick={() => sortBy(k)} title={`Sort by ${label.toLowerCase()}`}
        className="uppercase tracking-wider font-semibold flex items-center gap-1"
        style={{ color: sort.key === k ? "#111111" : "#949494" }}>
        {label}
        <span style={{ fontSize: 9, opacity: sort.key === k ? 1 : 0.35 }}>{sort.key === k && sort.desc ? "▼" : "▲"}</span>
      </button>
    </th>
  );

  const statusCounts: { id: Status | null; label: string; color: string; n: number }[] = [
    ...STATUS_ORDER.map(st => ({
      id: st as Status | null, label: STATUS_STYLE[st].label, color: STATUS_STYLE[st].color,
      n: byService.filter(c => statusOf(c) === st).length,
    })),
    { id: null, label: "Total", color: "#111111", n: byService.length },
  ];
  const serviceCounts: { id: Service | "none" | null; label: string; n: number }[] = [
    ...SERVICES.map(s => ({ id: s.id as Service | "none" | null, label: s.label, n: byStatus.filter(c => c.service === s.id).length })),
    { id: "none", label: "Not set", n: byStatus.filter(c => !c.service).length },
    { id: null,   label: "All",     n: byStatus.length },
  ];

  if (loading) return <p className="text-sm py-8 text-center" style={{ color: "#949494" }}>Loading…</p>;

  return (
    <div className="space-y-6 max-w-2xl mx-auto w-full">
      <div>
        <h2 className="text-xl font-semibold" style={{ color: "#111111" }}>Client Roster</h2>
        <p className="text-sm mt-0.5" style={{ color: "#767676" }}>Add clients, set their status and the service they are on.</p>
      </div>

      {/* Add form */}
      <div className="rounded-2xl p-5" style={{ background: "#fafafa", border: "1px solid rgba(0,0,0,0.06)", boxShadow: "0 1px 2px rgba(0,0,0,0.03), 0 10px 28px -12px rgba(0,0,0,0.10)" }}>
        <p className="text-sm font-semibold mb-3" style={{ color: "#111111" }}>Add Client</p>
        <div className="flex gap-3">
          <Input value={newName} onChange={setNewName} placeholder="Client name…" className="flex-1" />
          <button
            onClick={handleAdd}
            disabled={!newName.trim() || saving}
            className="px-4 py-2 rounded-lg text-sm font-semibold transition-opacity flex-shrink-0"
            style={{ background: "#000000", color: "#fff", opacity: (!newName.trim() || saving) ? 0.5 : 1 }}>
            {saving ? "Adding…" : "Add Client"}
          </button>
        </div>
        {linkedNote && (
          <p className="text-xs mt-3" style={{ color: "#15803d" }}>{linkedNote}</p>
        )}
      </div>

      {/* Status and service bars — click a figure to filter the list */}
      <div className="space-y-3">
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-xs font-semibold uppercase tracking-wider w-16" style={{ color: "#949494" }}>Status</span>
          {statusCounts.map(sc => {
            const on = statusFilter === sc.id;
            return (
              <button key={sc.label} onClick={() => setStatusFilter(sc.id)} aria-pressed={on}
                className="text-center px-3 py-2 rounded-xl transition-colors"
                style={{ background: on ? "rgba(0,0,0,0.06)" : "transparent", outline: on ? "1px solid rgba(0,0,0,0.12)" : "none", minWidth: 68 }}>
                <p className="text-2xl font-bold" style={{ color: sc.color }}>{sc.n}</p>
                <p className="text-xs mt-0.5" style={{ color: "#767676" }}>{sc.label}</p>
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-xs font-semibold uppercase tracking-wider w-16" style={{ color: "#949494" }}>Service</span>
          {serviceCounts.map(sc => {
            const on = serviceFilter === sc.id;
            return (
              <button key={sc.label} onClick={() => setServiceFilter(sc.id)} aria-pressed={on}
                className="text-center px-3 py-2 rounded-xl transition-colors"
                style={{ background: on ? "rgba(0,0,0,0.06)" : "transparent", outline: on ? "1px solid rgba(0,0,0,0.12)" : "none", minWidth: 68 }}>
                <p className="text-2xl font-bold" style={{ color: sc.id === "none" ? "#949494" : "#111111" }}>{sc.n}</p>
                <p className="text-xs mt-0.5" style={{ color: "#767676" }}>{sc.label}</p>
              </button>
            );
          })}
        </div>
        {(statusFilter || serviceFilter) && (
          <p className="text-xs" style={{ color: "#767676" }}>
            Showing {shown.length} of {clients.length}
            {statusFilter ? ` · ${statusCounts.find(x => x.id === statusFilter)?.label}` : ""}
            {serviceFilter ? ` · ${serviceCounts.find(x => x.id === serviceFilter)?.label}` : ""}
            {" — "}
            <button onClick={() => { setStatusFilter(null); setServiceFilter(null); }} className="underline">show all</button>
          </p>
        )}
      </div>

      {/* Table */}
      <div className="rounded-2xl overflow-hidden" style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.06)", boxShadow: "0 1px 2px rgba(0,0,0,0.03), 0 10px 28px -12px rgba(0,0,0,0.10)" }}>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: "#fafafa" }}>
              {th("name", "Client")}
              {th("status", "Status")}
              {th("service", "Service")}
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 ? (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-sm" style={{ color: "#949494" }}>{clients.length ? "No clients match this filter." : "No clients yet. Add one above."}</td></tr>
            ) : shown.map((c, i) => (
              <tr key={c.id} style={{ background: i % 2 === 0 ? "#ffffff" : "#fafafa", borderTop: "1px solid rgba(0,0,0,0.054)" }}>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: STATUS_STYLE[statusOf(c)].dot }} />
                    <span className="font-medium" style={{ color: "#111111" }}>{c.name}</span>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <select
                    value={statusOf(c)}
                    onChange={e => setStatus(c, e.target.value as Status)}
                    disabled={toggling === c.id}
                    aria-label={`Status for ${c.name}`}
                    title="Change status"
                    className="outline-none"
                    style={{
                      padding: "6px 8px", borderRadius: 9, fontSize: 12.5, fontWeight: 600, fontFamily: "inherit",
                      color: STATUS_STYLE[statusOf(c)].color, background: STATUS_STYLE[statusOf(c)].bg,
                      border: "1px solid transparent", opacity: toggling === c.id ? 0.5 : 1, cursor: "pointer",
                    }}>
                    {STATUS_ORDER.map(st => <option key={st} value={st}>{STATUS_STYLE[st].label}</option>)}
                  </select>
                </td>
                <td className="px-4 py-3">
                  <select
                    value={c.service ?? ""}
                    onChange={e => setService(c, (e.target.value || null) as Service | null)}
                    disabled={toggling === c.id}
                    aria-label={`Service for ${c.name}`}
                    title="Change service"
                    className="outline-none"
                    style={{
                      padding: "6px 8px", borderRadius: 9, fontSize: 12.5, fontWeight: 600, fontFamily: "inherit",
                      color: c.service ? "#111111" : "#949494",
                      background: "#ffffff", border: "1px solid rgba(0,0,0,0.14)",
                      opacity: toggling === c.id ? 0.5 : 1, cursor: "pointer",
                    }}>
                    <option value="">{serviceLabel(null)}</option>
                    {SERVICES.map(sv => <option key={sv.id} value={sv.id}>{sv.label}</option>)}
                  </select>
                </td>
                <td className="px-4 py-3 text-right">
                  {confirmDelete === c.id ? (
                    <span className="flex items-center justify-end gap-2">
                      <button onClick={() => handleDelete(c.id)}
                        className="text-xs font-semibold px-2 py-1 rounded"
                        style={{ color: "#b91c1c", background: "rgba(185,28,28,0.12)" }}>
                        Confirm
                      </button>
                      <button onClick={() => setConfirmDelete(null)} className="text-xs" style={{ color: "#767676" }}>
                        Cancel
                      </button>
                    </span>
                  ) : (
                    <button onClick={() => setConfirmDelete(c.id)}
                      className="text-xs transition-colors"
                      style={{ color: "#949494" }}
                      onMouseEnter={e => (e.currentTarget.style.color = "#c0392b")}
                      onMouseLeave={e => (e.currentTarget.style.color = "#949494")}>
                      Remove
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs" style={{ color: "#949494" }}>
        Offline clients are excluded when using the &ldquo;Live Clients&rdquo; filter on the dashboard.
      </p>
    </div>
  );
}
