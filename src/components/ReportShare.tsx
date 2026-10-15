"use client";

import { useEffect, useState } from "react";

// The read-only link for the Meta media-buying reports: create, copy, turn off.
// Lives next to the Full brief / Update buttons on the TM Dashboard. Mirrors the
// Health Tracker's share link: the token in the URL is the credential, so a
// Claude project (or anything that fetches a URL) can read the report directly.
export default function ReportShare({ onClose }: { onClose: () => void }) {
  const [token, setToken] = useState<string | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/meta-b2b-report/share").then(r => r.json()).then(d => setToken(d.token ?? null)).catch(() => setToken(null));
  }, []);

  async function set(share: boolean) {
    setBusy(true);
    try {
      const r = await fetch("/api/meta-b2b-report/share", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ share }) });
      const d = await r.json();
      if (r.ok) setToken(d.token ?? null);
    } finally { setBusy(false); }
  }

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  // One link: the full brief is regenerated on every fetch and carries the
  // week's changes, so an AI that can open a URL never needs the update.
  const links = token ? [
    // "STAMP" is for the AI to replace with the current date-time on every fetch — its
    // fetch tool caches by URL, so a new path each time guarantees a fresh copy.
    { label: "Full brief (live)", url: `${origin}/api/meta-b2b-report/STAMP?mode=full&token=${token}` },
  ] : [];

  const BTN: React.CSSProperties = { padding: "6px 10px", borderRadius: 8, fontSize: 12, fontWeight: 600, background: "rgba(0,0,0,0.06)", border: "1px solid rgba(0,0,0,0.12)", color: "#111", cursor: "pointer" };

  return (
    <div className="absolute right-0 mt-2 z-50 rounded-2xl p-4 w-[min(92vw,520px)]" style={{ background: "#fff", border: "1px solid rgba(0,0,0,0.1)", boxShadow: "0 12px 32px -12px rgba(0,0,0,0.25)" }}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "#767676" }}>Read-only link for an AI</span>
        <button onClick={onClose} className="text-xs" style={{ color: "#767676" }}>Close</button>
      </div>
      {token === undefined ? (
        <p className="text-xs" style={{ color: "#949494" }}>Loading…</p>
      ) : token ? (
        <div className="space-y-3">
          {links.map(l => (
            <div key={l.label}>
              <div className="text-[11px] font-semibold mb-1" style={{ color: "#4a4a4a" }}>{l.label}</div>
              <div className="flex items-start gap-2">
                <div className="flex-1 px-3 py-2 rounded-lg text-[11px] break-all" style={{ background: "rgba(0,0,0,0.035)", color: "#3a3a3a", fontFamily: "ui-monospace, monospace" }}>{l.url}</div>
                <button style={BTN} onClick={() => { navigator.clipboard?.writeText(l.url); setCopied(l.label); setTimeout(() => setCopied(null), 1600); }}>
                  {copied === l.label ? "Copied" : "Copy"}
                </button>
              </div>
            </div>
          ))}
          <p className="text-[11px] leading-relaxed" style={{ color: "#767676" }}>
            Anyone with the link can read the report. Put it in your Claude project&apos;s instructions
            (&quot;fetch this first&quot;); it is rebuilt with live numbers every time it is opened. Leave
            the word STAMP in: the instructions tell the AI to swap it for the current time on every
            fetch, so it never gets a cached copy.
            The Update download is only for chats that can&apos;t open links. Turning the link off kills it
            for good; turning it on again makes a new one.
          </p>
          <button disabled={busy} onClick={() => set(false)} style={{ ...BTN, background: "rgba(180,71,46,0.09)", color: "#b4472e" }}>Turn off</button>
        </div>
      ) : (
        <div className="space-y-2">
          <p className="text-xs" style={{ color: "#6b6b6b" }}>No link yet. Create one to let a Claude project (or any AI that can open a URL) read the live Full brief without signing in.</p>
          <button disabled={busy} onClick={() => set(true)} style={BTN}>Create a read-only link</button>
        </div>
      )}
    </div>
  );
}
