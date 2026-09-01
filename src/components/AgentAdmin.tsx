"use client";

import { useEffect, useState } from "react";

type Agent = { id: string; phone: string; name: string; created_at: string };

type EditState = { phone: string; name: string };

export default function AgentAdmin() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [newAgent, setNewAgent] = useState<EditState>({ phone: "", name: "" });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editState, setEditState] = useState<EditState>({ phone: "", name: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  function load() {
    setLoading(true);
    fetch("/api/agents")
      .then(r => r.json())
      .then(d => { setAgents(d.agents ?? []); setLoading(false); })
      .catch(() => setLoading(false));
  }

  useEffect(() => { load(); }, []);

  async function handleAdd() {
    if (!newAgent.phone.trim() || !newAgent.name.trim()) return;
    setSaving(true);
    setError("");
    const res = await fetch("/api/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newAgent),
    });
    const data = await res.json();
    setSaving(false);
    if (!res.ok) { setError(data.error ?? "Failed to add agent"); return; }
    setNewAgent({ phone: "", name: "" });
    setAdding(false);
    load();
  }

  async function handleUpdate(id: string) {
    if (!editState.phone.trim() || !editState.name.trim()) return;
    setSaving(true);
    setError("");
    const res = await fetch(`/api/agents/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(editState),
    });
    const data = await res.json();
    setSaving(false);
    if (!res.ok) { setError(data.error ?? "Failed to update agent"); return; }
    setEditingId(null);
    load();
  }

  async function handleDelete(id: string, name: string) {
    if (!confirm(`Remove ${name} from the agent roster?`)) return;
    const res = await fetch(`/api/agents/${id}`, { method: "DELETE" });
    if (!res.ok) { setError("Failed to delete agent"); return; }
    load();
  }

  const inputStyle = {
    background: "#fafafa",
    border: "1px solid rgba(0,0,0,0.162)",
    color: "#111111",
    borderRadius: "0.5rem",
    padding: "0.5rem 0.75rem",
    fontSize: "0.875rem",
    outline: "none",
    width: "100%",
  } as React.CSSProperties;

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold" style={{ color: "#111111" }}>Agent Roster</h2>
          <p className="text-sm mt-0.5" style={{ color: "#767676" }}>
            Map agent phone numbers to names — used to auto-assign agents when they claim appointments
          </p>
        </div>
        {!adding && (
          <button
            onClick={() => { setAdding(true); setError(""); }}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors"
            style={{ background: "#000000", color: "#fff" }}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
            Add Agent
          </button>
        )}
      </div>

      {error && (
        <div className="px-4 py-3 rounded-lg text-sm" style={{ background: "rgba(192,57,43,0.12)", border: "1px solid rgba(192,57,43,0.25)", color: "#c0392b" }}>
          {error}
        </div>
      )}

      {/* Add form */}
      {adding && (
        <div className="rounded-2xl p-4 space-y-3" style={{ background: "#fafafa", border: "1px solid rgba(0,0,0,0.15)" }}>
          <p className="text-sm font-semibold" style={{ color: "#000000" }}>New Agent</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: "#767676" }}>Agent Number</label>
              <input
                style={inputStyle}
                placeholder={`ex: ${agents.length + 1}`}
                value={newAgent.phone}
                onChange={e => setNewAgent(s => ({ ...s, phone: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1" style={{ color: "#767676" }}>Agent Name</label>
              <input
                style={inputStyle}
                placeholder="Jane Smith"
                value={newAgent.name}
                onChange={e => setNewAgent(s => ({ ...s, name: e.target.value }))}
                onKeyDown={e => { if (e.key === "Enter") handleAdd(); }}
              />
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => { setAdding(false); setError(""); setNewAgent({ phone: "", name: "" }); }}
              className="px-4 py-2 rounded-lg text-sm font-medium"
              style={{ background: "rgba(0,0,0,0.068)", color: "#6b6b6b" }}>
              Cancel
            </button>
            <button onClick={handleAdd} disabled={saving || !newAgent.phone || !newAgent.name}
              className="px-4 py-2 rounded-lg text-sm font-semibold disabled:opacity-40"
              style={{ background: "#000000", color: "#fff" }}>
              {saving ? "Saving…" : "Save Agent"}
            </button>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="rounded-2xl overflow-hidden" style={{ border: "1px solid rgba(0,0,0,0.06)", boxShadow: "0 1px 2px rgba(0,0,0,0.03), 0 10px 28px -12px rgba(0,0,0,0.10)" }}>
        <table className="w-full text-sm">
          <thead>
            <tr style={{ background: "#ffffff" }}>
              {["Agent Name", "Agent Number", "Added", ""].map(h => (
                <th key={h} className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider"
                  style={{ color: "#767676", borderBottom: "1px solid rgba(0,0,0,0.081)" }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={4} className="px-4 py-12 text-center text-sm" style={{ color: "#c2c2c2" }}>Loading…</td></tr>
            ) : agents.length === 0 ? (
              <tr><td colSpan={4} className="px-4 py-12 text-center text-sm" style={{ color: "#c2c2c2" }}>
                No agents yet — add your first agent above
              </td></tr>
            ) : agents.map((a, i) => (
              <tr key={a.id} style={{ borderTop: "1px solid rgba(0,0,0,0.041)", background: i % 2 === 0 ? "rgba(0,0,0,0.02)" : "transparent" }}>
                {editingId === a.id ? (
                  <>
                    <td className="px-4 py-2">
                      <input style={inputStyle} value={editState.name} onChange={e => setEditState(s => ({ ...s, name: e.target.value }))} />
                    </td>
                    <td className="px-4 py-2">
                      <input style={inputStyle} value={editState.phone} onChange={e => setEditState(s => ({ ...s, phone: e.target.value }))} />
                    </td>
                    <td className="px-4 py-2" style={{ color: "#767676" }}>—</td>
                    <td className="px-4 py-2">
                      <div className="flex items-center gap-2 justify-end">
                        <button onClick={() => setEditingId(null)} className="text-xs px-3 py-1.5 rounded-lg"
                          style={{ background: "rgba(0,0,0,0.068)", color: "#6b6b6b" }}>Cancel</button>
                        <button onClick={() => handleUpdate(a.id)} disabled={saving}
                          className="text-xs px-3 py-1.5 rounded-lg font-semibold disabled:opacity-40"
                          style={{ background: "#000000", color: "#fff" }}>Save</button>
                      </div>
                    </td>
                  </>
                ) : (
                  <>
                    <td className="px-4 py-3 font-medium" style={{ color: "#111111" }}>{a.name}</td>
                    <td className="px-4 py-3 font-mono text-xs" style={{ color: "#6b6b6b" }}>{a.phone}</td>
                    <td className="px-4 py-3" style={{ color: "#949494" }}>
                      {new Date(a.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 justify-end">
                        <button onClick={() => { setEditingId(a.id); setEditState({ phone: a.phone, name: a.name }); setError(""); }}
                          className="text-xs px-3 py-1.5 rounded-lg transition-colors"
                          style={{ background: "rgba(0,0,0,0.068)", color: "#6b6b6b" }}
                          onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = "#4a4a4a"}
                          onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = "#6b6b6b"}>
                          Edit
                        </button>
                        <button onClick={() => handleDelete(a.id, a.name)}
                          className="text-xs px-3 py-1.5 rounded-lg transition-colors"
                          style={{ background: "rgba(192,57,43,0.08)", color: "#c0392b" }}
                          onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = "rgba(192,57,43,0.18)"}
                          onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = "rgba(192,57,43,0.08)"}>
                          Remove
                        </button>
                      </div>
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
