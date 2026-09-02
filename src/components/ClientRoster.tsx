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
      setLinkedNote(d.linked_session
        ? `Territory session “${d.linked_session.name}” moved into ${d.client.name} in the Zip Tool.`
        : null);
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

  if (loading) return <p className="text-sm py-8 text-center" style={{ color: "#949494" }}>Loading…</p>;

  return (
    <div className="space-y-6 max-w-2xl mx-auto w-full">
      <div>
        <h2 className="text-xl font-semibold" style={{ color: "#111111" }}>Client Roster</h2>
        <p className="text-sm mt-0.5" style={{ color: "#767676" }}>Add clients and manage their live status.</p>
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

      {/* Stats */}
      <div className="flex items-center gap-6">
        <div className="text-center">
          <p className="text-2xl font-bold" style={{ color: "#15803d" }}>{live.length}</p>
          <p className="text-xs mt-0.5" style={{ color: "#767676" }}>Live</p>
        </div>
        <div className="text-center">
          <p className="text-2xl font-bold" style={{ color: "#b91c1c" }}>{offline.length}</p>
          <p className="text-xs mt-0.5" style={{ color: "#767676" }}>Offline</p>
        </div>
        <div className="text-center">
          <p className="text-2xl font-bold" style={{ color: "#111111" }}>{clients.length}</p>
          <p className="text-xs mt-0.5" style={{ color: "#767676" }}>Total</p>
        </div>
      </div>

      {/* Table */}
      <div className="rounded-2xl overflow-hidden" style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.06)", boxShadow: "0 1px 2px rgba(0,0,0,0.03), 0 10px 28px -12px rgba(0,0,0,0.10)" }}>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: "#fafafa" }}>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: "#949494" }}>Client</th>
              <th className="text-left px-4 py-3 text-xs font-semibold uppercase tracking-wider" style={{ color: "#949494" }}>Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {clients.length === 0 ? (
              <tr><td colSpan={3} className="px-4 py-8 text-center text-sm" style={{ color: "#949494" }}>No clients yet. Add one above.</td></tr>
            ) : clients.map((c, i) => (
              <tr key={c.id} style={{ background: i % 2 === 0 ? "#ffffff" : "#fafafa", borderTop: "1px solid rgba(0,0,0,0.054)" }}>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: c.is_live ? "#15803d" : "#94a3b8" }} />
                    <span className="font-medium" style={{ color: "#111111" }}>{c.name}</span>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => toggleLive(c)}
                    disabled={toggling === c.id}
                    className="px-3 py-1 rounded-full text-xs font-semibold transition-colors"
                    style={c.is_live
                      ? { color: "#15803d", background: "rgba(21,128,61,0.10)", opacity: toggling === c.id ? 0.5 : 1 }
                      : { color: "#b91c1c", background: "rgba(185,28,28,0.10)", opacity: toggling === c.id ? 0.5 : 1 }}>
                    {c.is_live ? "Live" : "Offline"}
                  </button>
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
