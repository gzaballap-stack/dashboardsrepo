"use client";

import DaoBackground from "@/components/DaoBackground";

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
    <div className="min-h-screen flex items-center justify-center px-4" style={{ backgroundColor: "#ffffff", position: "relative" }}>
      <DaoBackground />
      <div className="w-full max-w-md" style={{ position: "relative", zIndex: 1 }}>
        <div className="text-center mb-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/tomsi-logo-black.png"
            alt="Tomsi Media"
            className="mx-auto mb-4"
            style={{ width: 200, height: "auto", objectFit: "contain" }}
          />
          <p className="text-black/45 text-sm">Sign in to your account</p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="space-y-4 bg-white border border-black/10 rounded-xl px-8 py-8"
        >
          <div>
            <label className="block text-black/60 text-sm mb-1.5 font-medium">Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoComplete="email"
              className="w-full bg-white border border-black/15 rounded px-4 py-2.5 text-black placeholder-black/25 focus:outline-none focus:border-black transition-colors"
              placeholder="you@agency.com"
            />
          </div>

          <div>
            <label className="block text-black/60 text-sm mb-1.5 font-medium">Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              autoComplete="current-password"
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
            {loading ? "Signing in..." : "Sign In"}
          </button>
        </form>

        <p className="text-center text-black/35 text-xs mt-6">
          Need access? Contact your account administrator.
        </p>
      </div>
    </div>
  );
}
