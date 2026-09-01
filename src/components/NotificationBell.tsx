"use client";

import { useEffect, useRef, useState } from "react";
import type { Alert } from "./AlertBanner";

export default function NotificationBell({ alerts, onDismiss }: {
  alerts: Alert[];
  onDismiss: (a: Alert) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div className="relative flex-shrink-0" ref={ref}>
      <button
        onClick={() => setOpen(v => !v)}
        className="relative flex items-center justify-center w-8 h-8 rounded-full transition-colors"
        style={{
          background: open ? "rgba(0,0,0,0.096)" : "rgba(0,0,0,0.068)",
          border: `1px solid ${open ? "rgba(0,0,0,0.21)" : "rgba(0,0,0,0.108)"}`,
          color: open ? "#000000" : "#4a4a4a",
        }}
        aria-label="Notifications"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.4-1.4A2 2 0 0118 14.2V11a6 6 0 10-12 0v3.2c0 .5-.2 1-.6 1.4L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
        </svg>
        {alerts.length > 0 && (
          <span
            className="absolute rounded-full"
            style={{ top: -1, right: -1, width: 9, height: 9, background: "#c0392b", border: "1.5px solid #ffffff" }}
          />
        )}
      </button>

      {open && (
        <div className="absolute top-full right-0 mt-2 rounded-xl overflow-hidden z-[1100]"
          style={{ width: 320, background: "#ffffff", border: "1px solid rgba(0,0,0,0.135)", boxShadow: "0 20px 40px rgba(0,0,0,0.5)" }}>
          <div className="px-4 py-3" style={{ borderBottom: "1px solid rgba(0,0,0,0.095)" }}>
            <span className="text-sm font-semibold" style={{ color: "#111111" }}>Notifications</span>
          </div>
          {alerts.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm" style={{ color: "#949494" }}>
              You&apos;re all caught up.
            </div>
          ) : (
            <div className="max-h-80 overflow-y-auto">
              {alerts.map(a => (
                <div key={a.client_id} className="flex items-start gap-2 px-4 py-3"
                  style={{ borderBottom: "1px solid rgba(0,0,0,0.068)" }}>
                  <svg className="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" stroke="#c0392b" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                  </svg>
                  <p className="text-sm flex-1" style={{ color: "#333333" }}>
                    <span className="font-semibold">{a.client_name}</span>
                    {" "}hasn&apos;t had a booked appointment in{" "}
                    <span className="font-semibold">
                      {a.days_since_booking === null ? "an unknown number of" : a.days_since_booking} days
                    </span>
                  </p>
                  <button onClick={() => onDismiss(a)}
                    className="text-xs px-2 py-1 rounded flex-shrink-0"
                    style={{ color: "#c0392b", background: "rgba(192,57,43,0.12)" }}>
                    Dismiss
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
