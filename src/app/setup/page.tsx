"use client";

import { useState, useEffect } from "react";
import { createBrowserSupabaseClient } from "@/lib/supabase-browser";
import { useRouter } from "next/navigation";

export default function SetupPage() {
  const [checking, setChecking] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  useEffect(() => {
    fetch("/api/setup")
      .then(r => r.json())
      .then(d => {
        if (!d.needsSetup) router.replace("/login");
        else setChecking(false);
      });
  }, [router]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) { setError("Passwords don't match"); return; }
    if (password.length < 8) { setError("Password must be at least 8 characters"); return; }

    setLoading(true);
    setError("");

    const res = await fetch("/api/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });

    const d = await res.json();
    if (!res.ok) { setError(d.error); setLoading(false); return; }

    // Sign in immediately
    const supabase = createBrowserSupabaseClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) { setError(signInError.message); setLoading(false); return; }

    router.push("/dashboard");
    router.refresh();
  }

  if (checking) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: "#1a3d6b" }}>
        <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ backgroundColor: "#1a3d6b" }}>
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-block border-4 border-white px-10 py-3 mb-4">
            <h1 className="text-2xl font-black tracking-widest text-white uppercase">
              Dashboard Setup
            </h1>
          </div>
          <p className="text-white/50 text-sm">Create your admin account to get started</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 bg-white/5 border border-white/10 rounded-xl px-8 py-8">
          <div>
            <label className="block text-white/70 text-sm mb-1.5 font-medium">Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              className="w-full bg-white/10 border border-white/20 rounded px-4 py-2.5 text-white placeholder-white/30 focus:outline-none focus:border-amber-500 transition-colors"
              placeholder="you@company.com"
            />
          </div>

          <div>
            <label className="block text-white/70 text-sm mb-1.5 font-medium">Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              className="w-full bg-white/10 border border-white/20 rounded px-4 py-2.5 text-white placeholder-white/30 focus:outline-none focus:border-amber-500 transition-colors"
              placeholder="Min 8 characters"
            />
          </div>

          <div>
            <label className="block text-white/70 text-sm mb-1.5 font-medium">Confirm Password</label>
            <input
              type="password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              required
              className="w-full bg-white/10 border border-white/20 rounded px-4 py-2.5 text-white placeholder-white/30 focus:outline-none focus:border-amber-500 transition-colors"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-amber-500 hover:bg-amber-400 disabled:opacity-50 text-white font-semibold py-2.5 rounded transition-colors mt-2"
          >
            {loading ? "Creating account..." : "Create Admin Account"}
          </button>
        </form>

        <p className="text-center text-white/30 text-xs mt-6">
          This page is only available before the first account is created.
        </p>
      </div>
    </div>
  );
}
