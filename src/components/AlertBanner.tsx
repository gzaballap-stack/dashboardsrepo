"use client";

export type Alert = {
  client_id: string;
  client_name: string;
  last_booked_at: string | null;
  days_since_booking: number | null;
};

export default function AlertBanner({ alerts, onDismiss }: {
  alerts: Alert[];
  onDismiss: (a: Alert) => void;
}) {
  if (alerts.length === 0) return null;

  return (
    <div className="space-y-2 mb-6">
      {alerts.map(a => (
        <div key={a.client_id} className="flex items-center gap-3 px-4 py-3 rounded-xl"
          style={{ background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.2)" }}>
          <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="#f87171" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
          <p className="text-sm flex-1" style={{ color: "#fca5a5" }}>
            <span className="font-semibold">{a.client_name}</span>
            {" "}hasn't had a booked appointment in{" "}
            <span className="font-semibold">
              {a.days_since_booking === null ? "an unknown number of" : a.days_since_booking} days
            </span>
          </p>
          <button onClick={() => onDismiss(a)}
            className="flex items-center justify-center flex-shrink-0 rounded-full w-5 h-5 transition-colors"
            style={{ color: "#f87171", background: "rgba(239,68,68,0.12)" }}
            aria-label="Close">
            <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}
