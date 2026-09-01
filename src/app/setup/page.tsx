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
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: "#ffffff" }}>
        <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ backgroundColor: "#ffffff" }}>
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-block border-2 border-black px-10 py-3 mb-4">
            <h1 className="text-2xl font-black tracking-widest text-black uppercase">
              Dashboard Setup
            </h1>
          </div>
          <p className="text-black/45 text-sm">Create your admin account to get started</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 bg-white border border-black/10 rounded-xl px-8 py-8">
          <div>
            <label className="block text-black/60 text-sm mb-1.5 font-medium">Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              className="w-full bg-white border border-black/15 rounded px-4 py-2.5 text-black placeholder-black/25 focus:outline-none focus:border-black transition-colors"
              placeholder="you@company.com"
            />
          </div>

          <div>
            <label className="block text-black/60 text-sm mb-1.5 font-medium">Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              className="w-full bg-white border border-black/15 rounded px-4 py-2.5 text-black placeholder-black/25 focus:outline-none focus:border-black transition-colors"
              placeholder="Min 8 characters"
            />
          </div>

          <div>
            <label className="block text-black/60 text-sm mb-1.5 font-medium">Confirm Password</label>
            <input
              type="password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              required
              className="w-full bg-white border border-black/15 rounded px-4 py-2.5 text-black placeholder-black/25 focus:outline-none focus:border-black transition-colors"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <p className="text-[#c0392b] text-sm bg-[#c0392b]/8 border border-[#c0392b]/25 rounded px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-black hover:bg-neutral-800 disabled:opacity-40 text-white font-semibold py-2.5 rounded transition-colors mt-2"
          >
            {loading ? "Creating account..." : "Create Admin Account"}
          </button>
        </form>

        <p className="text-center text-black/35 text-xs mt-6">
          This page is only available before the first account is created.
        </p>
      </div>
    </div>
  );
}
