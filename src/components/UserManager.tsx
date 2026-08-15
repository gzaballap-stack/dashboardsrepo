"use client";

import { useEffect, useState } from "react";

type User = {
  id: string;
  email: string;
  is_admin: boolean;
  created_at: string;
};

function Row({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl px-5 py-4 flex items-center gap-4"
      style={{ background: "#0a1628", border: "1px solid rgba(255,255,255,0.06)" }}>
      {children}
    </div>
  );
}

function Input({ label, ...props }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div>
      <label className="block text-xs font-medium mb-1" style={{ color: "#475569" }}>{label}</label>
      <input
        className="w-full px-3 py-2 rounded-lg text-sm outline-none"
        style={{ background: "#0f2040", border: "1px solid rgba(255,255,255,0.12)", color: "#e2e8f0" }}
        {...props}
      />
    </div>
  );
}

export default function UserManager() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newIsAdmin, setNewIsAdmin] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState("");

  const [changingPw, setChangingPw] = useState<string | null>(null);
  const [newPw, setNewPw] = useState("");
  const [savingPw, setSavingPw] = useState(false);

  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const res = await fetch("/api/users");
    const d = await res.json();
    if (res.ok) setUsers(d.users ?? []);
    else setError(d.error ?? "Failed to load users");
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setAddError("");
    if (newPassword.length < 8) { setAddError("Password must be at least 8 characters"); return; }
    setAdding(true);
    const res = await fetch("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: newEmail, password: newPassword, is_admin: newIsAdmin }),
    });
    const d = await res.json();
    if (!res.ok) { setAddError(d.error ?? "Failed to create user"); setAdding(false); return; }
    setNewEmail(""); setNewPassword(""); setNewIsAdmin(false);
    setAdding(false);
    load();
  }

  async function handleDelete(id: string) {
    setDeletingId(id);
    await fetch("/api/users", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    setDeletingId(null);
    load();
  }

  async function handleChangePassword(id: string) {
    if (newPw.length < 8) return;
    setSavingPw(true);
    await fetch("/api/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, password: newPw }),
    });
    setSavingPw(false);
    setChangingPw(null);
    setNewPw("");
  }

  async function handleToggleAdmin(user: User) {
    await fetch("/api/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: user.id, is_admin: !user.is_admin }),
    });
    load();
  }

  return (
    <div className="space-y-8 max-w-2xl">
      <div>
        <h2 className="text-xl font-semibold" style={{ color: "#e2e8f0" }}>User Management</h2>
        <p className="text-sm mt-0.5" style={{ color: "#475569" }}>
          Add and manage dashboard users
        </p>
      </div>

      {/* Add User */}
      <div className="rounded-xl px-6 py-6 space-y-4"
        style={{ background: "#0a1628", border: "1px solid rgba(255,255,255,0.06)" }}>
        <h3 className="text-sm font-semibold" style={{ color: "#94a3b8" }}>Add New User</h3>
        <form onSubmit={handleAdd} className="space-y-3">
          <Input label="Email" type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} required placeholder="user@company.com" />
          <Input label="Password" type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} required placeholder="Min 8 characters" />
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={newIsAdmin} onChange={e => setNewIsAdmin(e.target.checked)}
              className="rounded" />
            <span className="text-sm" style={{ color: "#94a3b8" }}>Admin access</span>
          </label>
          {addError && (
            <p className="text-xs px-3 py-2 rounded-lg" style={{ background: "rgba(239,68,68,0.1)", color: "#f87171", border: "1px solid rgba(239,68,68,0.2)" }}>
              {addError}
            </p>
          )}
          <button type="submit" disabled={adding}
            className="px-4 py-2 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50"
            style={{ background: "#f59e0b", color: "#fff" }}>
            {adding ? "Adding..." : "Add User"}
          </button>
        </form>
      </div>

      {/* User List */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold" style={{ color: "#94a3b8" }}>
          {loading ? "Loading..." : `${users.length} user${users.length !== 1 ? "s" : ""}`}
        </h3>
        {error && <p className="text-sm" style={{ color: "#f87171" }}>{error}</p>}
        {users.map(u => (
          <div key={u.id} className="space-y-2">
            <Row>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate" style={{ color: "#e2e8f0" }}>{u.email}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-xs" style={{ color: "#334155" }}>
                    {new Date(u.created_at).toLocaleDateString()}
                  </span>
                  {u.is_admin && (
                    <span className="text-xs px-1.5 py-0.5 rounded font-medium"
                      style={{ background: "rgba(245,158,11,0.15)", color: "#f59e0b" }}>
                      Admin
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={() => handleToggleAdmin(u)}
                  className="text-xs px-3 py-1.5 rounded-lg font-medium transition-colors"
                  style={{ background: "rgba(255,255,255,0.05)", color: "#64748b" }}>
                  {u.is_admin ? "Remove Admin" : "Make Admin"}
                </button>
                <button
                  onClick={() => { setChangingPw(changingPw === u.id ? null : u.id); setNewPw(""); }}
                  className="text-xs px-3 py-1.5 rounded-lg font-medium transition-colors"
                  style={{ background: "rgba(59,130,246,0.12)", color: "#60a5fa" }}>
                  Change Password
                </button>
                <button
                  onClick={() => handleDelete(u.id)}
                  disabled={deletingId === u.id}
                  className="text-xs px-3 py-1.5 rounded-lg font-medium transition-colors disabled:opacity-50"
                  style={{ background: "rgba(239,68,68,0.1)", color: "#f87171" }}>
                  {deletingId === u.id ? "..." : "Remove"}
                </button>
              </div>
            </Row>
            {changingPw === u.id && (
              <div className="rounded-xl px-5 py-4 flex items-end gap-3"
                style={{ background: "#0a1628", border: "1px solid rgba(59,130,246,0.2)" }}>
                <div className="flex-1">
                  <Input label="New Password" type="password" value={newPw} onChange={e => setNewPw(e.target.value)} placeholder="Min 8 characters" />
                </div>
                <button
                  onClick={() => handleChangePassword(u.id)}
                  disabled={savingPw || newPw.length < 8}
                  className="px-4 py-2 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50 flex-shrink-0"
                  style={{ background: "#3b82f6", color: "#fff" }}>
                  {savingPw ? "Saving..." : "Save"}
                </button>
                <button
                  onClick={() => { setChangingPw(null); setNewPw(""); }}
                  className="px-3 py-2 rounded-lg text-sm font-medium flex-shrink-0"
                  style={{ color: "#475569" }}>
                  Cancel
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
