"use client";

import { useState } from "react";
import { createBrowserSupabaseClient } from "@/lib/supabase-browser";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");

    const supabase = createBrowserSupabaseClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setError(error.message);
      setLoading(false);
    } else {
      router.push("/dashboard");
      router.refresh();
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ backgroundColor: "#1a3d6b" }}>
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-block border-4 border-white px-10 py-3 mb-4">
            <h1 className="text-2xl font-black tracking-widest text-white uppercase">
              Call Center Data
            </h1>
          </div>
          <p className="text-white/50 text-sm">Sign in to your account</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="space-y-4 bg-white/5 border border-white/10 rounded-xl px-8 py-8"
        >
          <div>
            <label className="block text-white/70 text-sm mb-1.5 font-medium">Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoComplete="email"
              className="w-full bg-white/10 border border-white/20 rounded px-4 py-2.5 text-white placeholder-white/30 focus:outline-none focus:border-amber-500 transition-colors"
              placeholder="you@agency.com"
            />
          </div>

          <div>
            <label className="block text-white/70 text-sm mb-1.5 font-medium">Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              autoComplete="current-password"
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
            {loading ? "Signing in..." : "Sign In"}
          </button>
        </form>

        <p className="text-center text-white/30 text-xs mt-6">
          Need access? Contact your account administrator.
        </p>
      </div>
    </div>
  );
}
