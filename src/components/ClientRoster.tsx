"use client";

import { useEffect, useState } from "react";

type Client = { id: string; name: string; is_live?: boolean };

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
      style={{ background: "#0f2040", border: "1px solid rgba(255,255,255,0.12)", color: "#e2e8f0" }}
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

  useEffect(() => {
    fetch("/api/clients")
      .then(r => r.json())
      .then(d => { setClients(d.clients ?? []); setLoading(false); });
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
      setClients(prev => [...prev, { ...d.client, is_live: true }].sort((a, b) => a.name.localeCompare(b.name)));
      setNewName("");
    }
    setSaving(false);
  }

  async function toggleLive(c: Client) {
    setToggling(c.id);
    const res = await fetch(`/api/clients/${c.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_live: !c.is_live }),
    });
    const d = await res.json();
    if (d.client) setClients(prev => prev.map(x => x.id === c.id ? { ...x, is_live: d.client.is_live } : x));
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

  const live = clients.filter(c => c.is_live);
  const offline = clients.filter(c => !c.is_live);

  if (loading) return <p className="text-sm py-8 text-center" style={{ color: "#334155" }}>Loading…</p>;

  return (
    <div className="space-y-6 max-w-xl">
      <div>
        <h2 className="text-xl font-semibold" style={{ color: "#e2e8f0" }}>Client Roster</h2>
        <p className="text-sm mt-0.5" style={{ color: "#475569" }}>Add clients and manage their live status.</p>
      </div>

      {/* Add form */}
      <div className="rounded-xl p-5" style={{ background: "#0a1628", border: "1px solid rgba(255,255,255,0.06)" }}>
        <p className="text-sm font-semibold mb-3" style={{ color: "#e2e8f0" }}>Add Client</p>
        <div className="flex gap-3">
          <Input value={newName} onChange={setNewName} placeholder="Client name…" className="flex-1" />
          <button
            onClick={handleAdd}
            disabled={!newName.trim() || saving}
            className="px-4 py-2 rounded-lg text-sm font-semibold transition-opacity flex-shrink-0"
            style={{ background: "#f59e0b", color: "#fff", opacity: (!newName.trim() || saving) ? 0.5 : 1 }}>
            {saving ? "Adding…" : "Add Client"}
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="flex items-center gap-6">
        <div className="text-center">
          <p className="text-2xl font-bold" style={{ color: "#22c55e" }}>{live.length}</p>
          <p className="text-xs mt-0.5" style={{ color: "#475569" }}>Live</p>
        </div>
        <div className="text-center">
          <p className="text-2xl font-bold" style={{ color: "#ef4444" }}>{offline.length}</p>
          <p className="text-xs mt-0.5" style={{ color: "#475569" }}>Offline</p>
        </div>
        <div className="text-center">
          <p className="text-2xl font-bold" style={{ color: "#e2e8f0" }}>{clients.length}</p>
          <p className="text-xs mt-0.5" style={{ color: "#475569" }}>Total</p>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-xl overflow-hidden" style={{ border: "1px solid rgba(255,255,255,0.06)" }}>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: "#0a1628" }}>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: "#334155" }}>Client</th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: "#334155" }}>Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {clients.length === 0 ? (
              <tr><td colSpan={3} className="px-4 py-8 text-center text-sm" style={{ color: "#334155" }}>No clients yet. Add one above.</td></tr>
            ) : clients.map((c, i) => (
              <tr key={c.id} style={{ background: i % 2 === 0 ? "#080f1e" : "#060d1a", borderTop: "1px solid rgba(255,255,255,0.04)" }}>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: c.is_live ? "#22c55e" : "#475569" }} />
                    <span className="font-medium" style={{ color: "#e2e8f0" }}>{c.name}</span>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => toggleLive(c)}
                    disabled={toggling === c.id}
                    className="px-3 py-1 rounded-full text-xs font-semibold transition-colors"
                    style={c.is_live
                      ? { color: "#22c55e", background: "rgba(34,197,94,0.1)", opacity: toggling === c.id ? 0.5 : 1 }
                      : { color: "#ef4444", background: "rgba(239,68,68,0.1)", opacity: toggling === c.id ? 0.5 : 1 }}>
                    {c.is_live ? "Live" : "Offline"}
                  </button>
                </td>
                <td className="px-4 py-3 text-right">
                  {confirmDelete === c.id ? (
                    <span className="flex items-center justify-end gap-2">
                      <button onClick={() => handleDelete(c.id)}
                        className="text-xs font-semibold px-2 py-1 rounded"
                        style={{ color: "#ef4444", background: "rgba(239,68,68,0.12)" }}>
                        Confirm
                      </button>
                      <button onClick={() => setConfirmDelete(null)} className="text-xs" style={{ color: "#475569" }}>
                        Cancel
                      </button>
                    </span>
                  ) : (
                    <button onClick={() => setConfirmDelete(c.id)}
                      className="text-xs transition-colors"
                      style={{ color: "#334155" }}
                      onMouseEnter={e => (e.currentTarget.style.color = "#ef4444")}
                      onMouseLeave={e => (e.currentTarget.style.color = "#334155")}>
                      Remove
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs" style={{ color: "#334155" }}>
        Offline clients are excluded when using the &ldquo;Live Clients&rdquo; filter on the dashboard.
      </p>
    </div>
  );
}
