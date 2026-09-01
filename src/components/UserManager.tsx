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
      style={{ background: "#fafafa", border: "1px solid rgba(0,0,0,0.081)" }}>
      {children}
    </div>
  );
}

function Input({ label, ...props }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div>
      <label className="block text-xs font-medium mb-1" style={{ color: "#767676" }}>{label}</label>
      <input
        className="w-full px-3 py-2 rounded-lg text-sm outline-none"
        style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.162)", color: "#111111" }}
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
        <h2 className="text-xl font-semibold" style={{ color: "#111111" }}>User Management</h2>
        <p className="text-sm mt-0.5" style={{ color: "#767676" }}>
          Add and manage dashboard users
        </p>
      </div>

      {/* Add User */}
      <div className="rounded-xl px-6 py-6 space-y-4"
        style={{ background: "#fafafa", border: "1px solid rgba(0,0,0,0.081)" }}>
        <h3 className="text-sm font-semibold" style={{ color: "#4a4a4a" }}>Add New User</h3>
        <form onSubmit={handleAdd} className="space-y-3">
          <Input label="Email" type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)} required placeholder="user@company.com" />
          <Input label="Password" type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)} required placeholder="Min 8 characters" />
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={newIsAdmin} onChange={e => setNewIsAdmin(e.target.checked)}
              className="rounded" />
            <span className="text-sm" style={{ color: "#4a4a4a" }}>Admin access</span>
          </label>
          {addError && (
            <p className="text-xs px-3 py-2 rounded-lg" style={{ background: "rgba(192,57,43,0.1)", color: "#c0392b", border: "1px solid rgba(192,57,43,0.2)" }}>
              {addError}
            </p>
          )}
          <button type="submit" disabled={adding}
            className="px-4 py-2 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50"
            style={{ background: "#000000", color: "#fff" }}>
            {adding ? "Adding..." : "Add User"}
          </button>
        </form>
      </div>

      {/* User List */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold" style={{ color: "#4a4a4a" }}>
          {loading ? "Loading..." : `${users.length} user${users.length !== 1 ? "s" : ""}`}
        </h3>
        {error && <p className="text-sm" style={{ color: "#c0392b" }}>{error}</p>}
        {users.map(u => (
          <div key={u.id} className="space-y-2">
            <Row>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate" style={{ color: "#111111" }}>{u.email}</p>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-xs" style={{ color: "#949494" }}>
                    {new Date(u.created_at).toLocaleDateString()}
                  </span>
                  {u.is_admin && (
                    <span className="text-xs px-1.5 py-0.5 rounded font-medium"
                      style={{ background: "rgba(0,0,0,0.09)", color: "#000000" }}>
                      Admin
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={() => handleToggleAdmin(u)}
                  className="text-xs px-3 py-1.5 rounded-lg font-medium transition-colors"
                  style={{ background: "rgba(0,0,0,0.068)", color: "#6b6b6b" }}>
                  {u.is_admin ? "Remove Admin" : "Make Admin"}
                </button>
                <button
                  onClick={() => { setChangingPw(changingPw === u.id ? null : u.id); setNewPw(""); }}
                  className="text-xs px-3 py-1.5 rounded-lg font-medium transition-colors"
                  style={{ background: "rgba(0,0,0,0.072)", color: "#4a4a4a" }}>
                  Change Password
                </button>
                <button
                  onClick={() => handleDelete(u.id)}
                  disabled={deletingId === u.id}
                  className="text-xs px-3 py-1.5 rounded-lg font-medium transition-colors disabled:opacity-50"
                  style={{ background: "rgba(192,57,43,0.1)", color: "#c0392b" }}>
                  {deletingId === u.id ? "..." : "Remove"}
                </button>
              </div>
            </Row>
            {changingPw === u.id && (
              <div className="rounded-xl px-5 py-4 flex items-end gap-3"
                style={{ background: "#fafafa", border: "1px solid rgba(0,0,0,0.12)" }}>
                <div className="flex-1">
                  <Input label="New Password" type="password" value={newPw} onChange={e => setNewPw(e.target.value)} placeholder="Min 8 characters" />
                </div>
                <button
                  onClick={() => handleChangePassword(u.id)}
                  disabled={savingPw || newPw.length < 8}
                  className="px-4 py-2 rounded-lg text-sm font-semibold transition-colors disabled:opacity-50 flex-shrink-0"
                  style={{ background: "#000000", color: "#fff" }}>
                  {savingPw ? "Saving..." : "Save"}
                </button>
                <button
                  onClick={() => { setChangingPw(null); setNewPw(""); }}
                  className="px-3 py-2 rounded-lg text-sm font-medium flex-shrink-0"
                  style={{ color: "#767676" }}>
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
