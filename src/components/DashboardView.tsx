"use client";

import { useEffect, useRef, useState } from "react";
import { createBrowserSupabaseClient } from "@/lib/supabase-browser";
import { useRouter } from "next/navigation";
import RawDataTable from "./RawDataTable";
import HeatMap from "./HeatMap";
import AgentStats from "./AgentStats";
import AgentAdmin from "./AgentAdmin";
import RecordingBrowser from "./RecordingBrowser";
import GoalTracker from "./GoalTracker";
import AgentScorecards from "./AgentScorecards";
import AlertBanner, { type Alert } from "./AlertBanner";
import NotificationBell from "./NotificationBell";
import SetterSchedule from "./SetterSchedule";
import ClientRoster from "./ClientRoster";
import UserManager from "./UserManager";
import ZipTool from "./ZipTool";

type Client = { id: string; name: string; is_live?: boolean };

type Metrics = {
  new_leads: number;
  booked_appointments: number;
  appt_booking_rate: number;
  appts_to_take_place: number;
  shows: number;
  no_shows: number;
  show_pct: number;
  ad_spend: number;
  cpl: number;
  cp_appt: number;
  cps: number;
  outbound_dials: number;
  dials_per_lead: number;
  pickups: number;
  pickup_pct: number;
  conversations: number;
  conversation_pct: number;
  callbacks: number;
  cb_pct: number;
  speed_to_lead_min: number;
};

type Preset = "this_month" | "last_month" | "last_30" | "last_7" | "all_time" | "custom";

type View =
  | "dashboard"
  | "leads"
  | "dials"
  | "appointments"
  | "speed_to_lead"
  | "ad_spend"
  | "heatmap_show"
  | "heatmap_pickup"
  | "heatmap_leads"
  | "agent_stats"
  | "agent_scorecards"
  | "recordings"
  | "goals"
  | "admin_agents"
  | "admin_clients"
  | "admin_share"
  | "admin_users"
  | "schedule"
  | "zip_tool";

const PRESET_LABELS: Record<Preset, string> = {
  this_month: "This Month",
  last_month: "Last Month",
  last_30: "Last 30 Days",
  last_7: "Last 7 Days",
  all_time: "All Time",
  custom: "Custom Range",
};

const NAV: { view: View; label: string; group?: string }[] = [
  { view: "dashboard",      label: "Dashboard",     group: "Overview"  },
  { view: "leads",          label: "New Leads",      group: "Raw Data"  },
  { view: "dials",          label: "All Dials",      group: "Raw Data"  },
  { view: "appointments",   label: "Appointments",   group: "Raw Data"  },
  { view: "speed_to_lead",  label: "Speed to Lead",  group: "Raw Data"  },
  { view: "ad_spend",       label: "Ad Spend",       group: "Raw Data"  },
  { view: "heatmap_show",   label: "Show Rate",      group: "Heat Maps"   },
  { view: "heatmap_pickup", label: "Pick Up Rate",   group: "Heat Maps"   },
  { view: "heatmap_leads",  label: "New Leads",      group: "Heat Maps"   },
  { view: "agent_stats",      label: "Agent Stats",      group: "Agent Stats" },
  { view: "agent_scorecards", label: "Scorecards",        group: "Agent Stats" },
  { view: "recordings",       label: "Call Recordings",   group: "Agent Stats" },
  { view: "goals",            label: "Goal Tracker",      group: "Overview"    },
  { view: "admin_agents",     label: "Agent Roster",      group: "Admin"       },
  { view: "admin_clients",    label: "Client Roster",     group: "Admin"       },
  { view: "schedule",         label: "Power Dialer Schedule", group: "Admin"    },
  { view: "admin_share",      label: "Share Reports",     group: "Admin"       },
  { view: "admin_users",      label: "Users",             group: "Admin"       },
  { view: "zip_tool",         label: "Zip Code Tool",     group: "Tools"       },
];

const NAV_ICONS: Record<View, string> = {
  dashboard:     "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6",
  leads:         "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z",
  dials:         "M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z",
  appointments:  "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z",
  speed_to_lead: "M13 10V3L4 14h7v7l9-11h-7z",
  ad_spend:      "M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z",
  heatmap_show:  "M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z",
  heatmap_pickup:"M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z",
  heatmap_leads: "M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z",
  agent_stats:   "M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z",
  admin_agents:     "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z",
  admin_clients:    "M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4",
  admin_share:      "M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z",
  admin_users:      "M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z",
  schedule:         "M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z",
  agent_scorecards: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4",
  recordings:       "M15.536 8.464a5 5 0 010 7.072M12 18.364a9 9 0 010-12.728M8.464 15.536a5 5 0 010-7.072",
  goals:            "M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z",
  zip_tool:         "M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z M15 11a3 3 0 11-6 0 3 3 0 016 0z",
};

function getDateRange(p: Preset): { start: string; end: string } {
  const now = new Date();
  const today = now.toISOString().split("T")[0];
  if (p === "this_month") return {
    start: new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0], end: today,
  };
  if (p === "last_month") return {
    start: new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().split("T")[0],
    end: new Date(now.getFullYear(), now.getMonth(), 0).toISOString().split("T")[0],
  };
  if (p === "last_30") return { start: new Date(now.getTime() - 30 * 86400000).toISOString().split("T")[0], end: today };
  if (p === "last_7")  return { start: new Date(now.getTime() - 7 * 86400000).toISOString().split("T")[0], end: today };
  return { start: "", end: "" };
}

function KpiCard({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="relative overflow-hidden rounded-xl p-5 flex flex-col gap-2 group transition-all duration-200 hover:translate-y-[-1px]"
      style={{ background: "linear-gradient(135deg, #0f2040 0%, #0c1a30 100%)", border: "1px solid rgba(255,255,255,0.07)" }}>
      <div className="absolute top-0 left-0 w-1 h-full rounded-l-xl" style={{ background: accent ? "#f59e0b" : "#1d4ed8" }} />
      <span className="text-xs font-medium tracking-wide pl-3" style={{ color: "#64748b" }}>{label}</span>
      <span className="text-3xl font-bold pl-3" style={{ color: "#f1f5f9" }}>{value}</span>
    </div>
  );
}

function Select({ value, onChange, children, className = "" }: {
  value: string | number;
  onChange: (v: string) => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className={`px-4 py-2 rounded-lg text-sm font-medium outline-none cursor-pointer transition-colors ${className}`}
      style={{ background: "#0f2040", border: "1px solid rgba(255,255,255,0.12)", color: "#e2e8f0" }}
    >
      {children}
    </select>
  );
}

type ClientWithToken = Client & { share_token?: string };

function ShareReports({ clients }: { clients: Client[] }) {
  const [enriched, setEnriched] = useState<ClientWithToken[]>([]);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/clients")
      .then(r => r.json())
      .then(d => setEnriched(d.clients ?? []));
  }, []);

  function getUrl(token: string) {
    return `${window.location.origin}/report/${token}`;
  }

  function handleCopy(token: string) {
    navigator.clipboard.writeText(getUrl(token));
    setCopied(token);
    setTimeout(() => setCopied(null), 2000);
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="text-xl font-semibold" style={{ color: "#e2e8f0" }}>Share Reports</h2>
        <p className="text-sm mt-0.5" style={{ color: "#475569" }}>
          Each client has a unique read-only report link — no login required
        </p>
      </div>
      <div className="space-y-3">
        {(enriched.length ? enriched : clients).map((c: ClientWithToken) => (
          <div key={c.id} className="rounded-xl px-5 py-4 flex items-center justify-between gap-4"
            style={{ background: "#0a1628", border: "1px solid rgba(255,255,255,0.06)" }}>
            <div>
              <p className="text-sm font-medium" style={{ color: "#e2e8f0" }}>{c.name}</p>
              {c.share_token && (
                <p className="text-xs mt-0.5 font-mono truncate max-w-xs" style={{ color: "#334155" }}>
                  {getUrl(c.share_token)}
                </p>
              )}
            </div>
            {c.share_token && (
              <button onClick={() => handleCopy(c.share_token!)}
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold flex-shrink-0 transition-colors"
                style={copied === c.share_token
                  ? { background: "rgba(52,211,153,0.15)", color: "#34d399" }
                  : { background: "rgba(245,158,11,0.12)", color: "#f59e0b" }}>
                {copied === c.share_token ? "✓ Copied!" : "Copy Link"}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

type TopSection = "dashboard" | "clients" | "tools" | "payments";

const TOP_SECTIONS: { id: TopSection; label: string; icon: string; badge?: string }[] = [
  {
    id: "dashboard", label: "Dashboard",
    icon: "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6",
  },
  {
    id: "clients", label: "Clients",
    icon: "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z",
    badge: "Coming Soon",
  },
  {
    id: "tools", label: "Tools",
    icon: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z",
  },
  {
    id: "payments", label: "Payments",
    icon: "M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z",
    badge: "Coming Soon",
  },
];

const NAV_STATE_KEY = "dashboard-nav-state";
const DISMISSED_ALERTS_KEY = "dismissed-alerts";

// Keys a stale-booking alert to its current staleness episode (anchored to the last
// booking timestamp) and day count, so dismissing "3 days" today doesn't also suppress
// "4 days" tomorrow, but a fresh episode after a new booking starts undismissed again.
function alertKey(a: Alert) {
  return `${a.client_id}:${a.last_booked_at ?? "never"}:${a.days_since_booking ?? "never"}`;
}

export default function DashboardView() {
  const [topSection, setTopSection] = useState<TopSection>("dashboard");
  const [expandedSections, setExpandedSections] = useState<Set<TopSection>>(new Set(["dashboard"]));
  const [view, setView] = useState<View>("dashboard");
  const [clients, setClients] = useState<Client[]>([]);
  const [selectedClientId, setSelectedClientId] = useState("");
  const [preset, setPreset] = useState<Preset>("this_month");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [metricsLoading, setMetricsLoading] = useState(false);
  const [showPresetMenu, setShowPresetMenu] = useState(false);
  const [heatmapDays, setHeatmapDays] = useState(0);
  const [heatmapClientId, setHeatmapClientId] = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [dismissedAlertKeys, setDismissedAlertKeys] = useState<Set<string>>(new Set());
  const presetRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  // Restore nav position on mount
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(NAV_STATE_KEY) ?? "{}");
      if (saved.topSection) setTopSection(saved.topSection as TopSection);
      if (saved.view) setView(saved.view as View);
      if (saved.expandedSections) setExpandedSections(new Set(saved.expandedSections as TopSection[]));
    } catch {}
  }, []);

  // Persist nav position on every change
  useEffect(() => {
    try {
      localStorage.setItem(NAV_STATE_KEY, JSON.stringify({
        topSection, view, expandedSections: Array.from(expandedSections),
      }));
    } catch {}
  }, [topSection, view, expandedSections]);

  // Restore dismissed alerts + fetch current alerts on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DISMISSED_ALERTS_KEY);
      if (raw) setDismissedAlertKeys(new Set(JSON.parse(raw)));
    } catch {}
    fetch("/api/alerts").then(r => r.json()).then(d => setAlerts(d.alerts ?? [])).catch(() => {});
  }, []);

  // Dismissing writes to localStorage synchronously with the state update (not via a
  // separate effect) so a dismiss immediately followed by a refresh can't lose the write.
  const dismissAlert = (a: Alert) => {
    setDismissedAlertKeys(prev => {
      const next = new Set(prev);
      next.add(alertKey(a));
      try { localStorage.setItem(DISMISSED_ALERTS_KEY, JSON.stringify(Array.from(next))); } catch {}
      return next;
    });
  };

  const visibleAlerts = alerts.filter(a => !dismissedAlertKeys.has(alertKey(a)));

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (presetRef.current && !presetRef.current.contains(e.target as Node)) setShowPresetMenu(false);
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    fetch("/api/clients").then(r => r.json()).then(d => setClients(d.clients ?? []));
  }, []);

  useEffect(() => {
    if (view !== "dashboard") return;
    const { start, end } = preset === "custom" ? { start: customStart, end: customEnd } : getDateRange(preset);
    setMetricsLoading(true);
    const params = new URLSearchParams();
    if (selectedClientId === "__live__") params.set("live_only", "true");
    else if (selectedClientId) params.set("client_id", selectedClientId);
    if (start) params.set("start_date", start);
    if (end) params.set("end_date", end);
    fetch(`/api/metrics?${params}`)
      .then(r => r.json())
      .then(d => { setMetrics(d); setMetricsLoading(false); })
      .catch(() => setMetricsLoading(false));
  }, [view, selectedClientId, preset, customStart, customEnd]);

  async function handleSignOut() {
    const supabase = createBrowserSupabaseClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  const fmt$   = (v: number) => `$${Math.round(v).toLocaleString("en-US")}`;
  const fmtPct = (v: number) => `${v.toFixed(2)}%`;
  const fmtDec = (v: number) => v.toFixed(2);
  const fmtInt = (v: number) => Math.round(v).toString();

  const { start: dateStart, end: dateEnd } =
    preset === "custom" ? { start: customStart, end: customEnd } : getDateRange(preset);

  const today = new Date().toISOString().split("T")[0];
  const heatmapStart = heatmapDays > 0
    ? new Date(Date.now() - heatmapDays * 86400000).toISOString().split("T")[0]
    : undefined;
  const heatmapEnd = heatmapDays > 0 ? today : undefined;

  const isHeatmap = view.startsWith("heatmap_");
  const isRaw = ["leads", "dials", "appointments", "speed_to_lead", "ad_spend"].includes(view);
  const isAgentView = ["agent_stats", "agent_scorecards", "recordings"].includes(view);
  const groups = ["Overview", "Raw Data", "Heat Maps", "Agent Stats", "Admin", "Tools"];

  return (
    <div className="h-screen overflow-hidden flex" style={{ background: "#080f1e" }}>

      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/60 z-20 md:hidden backdrop-blur-sm" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <aside className={`
        fixed top-0 left-0 h-full w-60 z-30 flex flex-col
        transition-transform duration-300
        ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}
        md:translate-x-0 md:static md:z-auto
      `} style={{ background: "#050c18", borderRight: "1px solid rgba(255,255,255,0.06)" }}>

        {/* Logo */}
        <div className="flex items-center px-4 py-3.5" style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}>
          <img
            src="/Tomsi Media logo (White) copy.png"
            alt="Tomsi Media"
            style={{ width: 84, height: "auto", objectFit: "contain", opacity: 0.92 }}
          />
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto py-4 px-3">

          {/* Top-level sections */}
          {TOP_SECTIONS.map(sec => {
            const isActive = topSection === sec.id;
            return (
              <div key={sec.id} className="mb-1">
                {/* Section header button */}
                <button
                  onClick={() => {
                    setTopSection(sec.id);
                    if (sec.id === "dashboard") setView("dashboard");
                    if (sec.id === "tools") setView("zip_tool");
                    setExpandedSections(prev => {
                      const next = new Set(prev);
                      if (next.has(sec.id)) next.delete(sec.id);
                      else next.add(sec.id);
                      return next;
                    });
                    setSidebarOpen(false);
                  }}
                  className="w-full text-left px-3 py-2.5 rounded-lg flex items-center gap-3 transition-all duration-150"
                  style={isActive
                    ? { background: "rgba(245,158,11,0.1)", color: "#f59e0b", borderLeft: "2px solid #f59e0b" }
                    : { color: "#64748b", borderLeft: "2px solid transparent" }}
                  onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLElement).style.color = "#94a3b8"; }}
                  onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLElement).style.color = "#64748b"; }}
                >
                  <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d={sec.icon} />
                  </svg>
                  <span className="text-sm font-semibold flex-1">{sec.label}</span>
                  {sec.badge && (
                    <span style={{ fontSize: 9, padding: "2px 5px", borderRadius: 4, background: "rgba(255,255,255,0.06)", color: "#334155", fontWeight: 600, letterSpacing: "0.04em" }}>
                      SOON
                    </span>
                  )}
                  <svg
                    className="w-3 h-3 flex-shrink-0 transition-transform duration-200"
                    style={{ transform: expandedSections.has(sec.id) ? "rotate(90deg)" : "rotate(0deg)", opacity: 0.5 }}
                    fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </button>

                {/* Sub-nav for Dashboard */}
                {isActive && sec.id === "dashboard" && expandedSections.has("dashboard") && (
                  <div className="mt-1 mb-2" style={{ borderLeft: "1px solid rgba(255,255,255,0.06)", marginLeft: 20, paddingLeft: 8 }}>
                    {groups.filter(g => g !== "Tools").map(group => (
                      <div key={group} className="mb-3">
                        <p className="text-[9px] font-bold uppercase tracking-widest px-2 mb-1" style={{ color: "#1e3a5f" }}>
                          {group}
                        </p>
                        {NAV.filter(n => n.group === group).map(item => {
                          const active = view === item.view;
                          return (
                            <button
                              key={item.view}
                              onClick={() => { setView(item.view); setSidebarOpen(false); }}
                              className="w-full text-left px-2 py-1.5 rounded-md text-xs font-medium flex items-center gap-2 transition-all duration-150 mb-0.5"
                              style={active
                                ? { background: "rgba(245,158,11,0.1)", color: "#f59e0b" }
                                : { color: "#475569" }}
                              onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.color = "#94a3b8"; }}
                              onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.color = "#475569"; }}
                            >
                              <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" d={NAV_ICONS[item.view]} />
                              </svg>
                              {item.label}
                            </button>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                )}

                {/* Sub-nav for Tools */}
                {isActive && sec.id === "tools" && expandedSections.has("tools") && (
                  <div className="mt-1 mb-2" style={{ borderLeft: "1px solid rgba(255,255,255,0.06)", marginLeft: 20, paddingLeft: 8 }}>
                    <button
                      onClick={() => { setView("zip_tool"); setSidebarOpen(false); }}
                      className="w-full text-left px-2 py-1.5 rounded-md text-xs font-medium flex items-center gap-2 transition-all duration-150"
                      style={view === "zip_tool"
                        ? { background: "rgba(245,158,11,0.1)", color: "#f59e0b" }
                        : { color: "#475569" }}
                      onMouseEnter={e => { if (view !== "zip_tool") (e.currentTarget as HTMLElement).style.color = "#94a3b8"; }}
                      onMouseLeave={e => { if (view !== "zip_tool") (e.currentTarget as HTMLElement).style.color = "#475569"; }}
                    >
                      <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                      Zip Code Tool
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {/* Sign out */}
        <div className="px-3 py-4" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
          <button
            onClick={handleSignOut}
            className="w-full text-left px-3 py-2.5 rounded-lg text-sm font-medium flex items-center gap-3 transition-colors"
            style={{ color: "#334155" }}
            onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = "#64748b"}
            onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = "#334155"}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
            </svg>
            Sign Out
          </button>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 min-w-0 flex flex-col">

        {/* Header */}
        <header className="flex items-center gap-3 px-6 py-4 flex-wrap"
          style={{ background: "#050c18", borderBottom: "1px solid rgba(255,255,255,0.06)" }}>

          <button className="md:hidden mr-1" onClick={() => setSidebarOpen(true)}
            style={{ color: "#475569" }}>
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>

          <h1 className="text-base font-semibold mr-auto" style={{ color: "#e2e8f0" }}>
            {NAV.find(n => n.view === view)?.group
              ? <span style={{ color: "#334155" }}>{NAV.find(n => n.view === view)?.group} / </span>
              : null}
            {NAV.find(n => n.view === view)?.label ?? "Dashboard"}
          </h1>

          {/* Dashboard, raw data, and agent/recording views filters */}
          {(view === "dashboard" || isRaw || isAgentView || view === "goals" || view === "recordings") && !view.startsWith("admin_") && (
            <>
              {view === "dashboard" && (
                <Select value={selectedClientId} onChange={v => setSelectedClientId(v)}>
                  <option value="">All Clients</option>
                  <option value="__live__">Live Clients</option>
                  {clients.map(c => <option key={c.id} value={c.id}>{c.name}{c.is_live === false ? " (offline)" : ""}</option>)}
                </Select>
              )}

              <div className="relative" ref={presetRef}>
                <button
                  onClick={() => setShowPresetMenu(v => !v)}
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                  style={{ background: "#f59e0b", color: "#fff", minWidth: "9rem" }}
                >
                  <span className="flex-1 text-left">{PRESET_LABELS[preset]}</span>
                  <svg className="w-3.5 h-3.5 opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {showPresetMenu && (
                  <div className="absolute top-full right-0 mt-1.5 rounded-xl overflow-hidden z-20 w-48"
                    style={{ background: "#0f2040", border: "1px solid rgba(255,255,255,0.10)", boxShadow: "0 20px 40px rgba(0,0,0,0.5)" }}>
                    {(Object.keys(PRESET_LABELS) as Preset[]).map(p => (
                      <button key={p} onClick={() => { setPreset(p); setShowPresetMenu(false); }}
                        className="block w-full text-left px-4 py-2.5 text-sm transition-colors"
                        style={preset === p
                          ? { background: "rgba(245,158,11,0.15)", color: "#f59e0b", fontWeight: 600 }
                          : { color: "#94a3b8" }}
                        onMouseEnter={e => { if (preset !== p) (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.05)"; }}
                        onMouseLeave={e => { if (preset !== p) (e.currentTarget as HTMLElement).style.background = ""; }}
                      >
                        {PRESET_LABELS[p]}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {preset === "custom" && (
                <>
                  <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)}
                    className="px-3 py-2 rounded-lg text-sm outline-none"
                    style={{ background: "#0f2040", border: "1px solid rgba(255,255,255,0.12)", color: "#e2e8f0" }} />
                  <span className="text-sm" style={{ color: "#334155" }}>to</span>
                  <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)}
                    className="px-3 py-2 rounded-lg text-sm outline-none"
                    style={{ background: "#0f2040", border: "1px solid rgba(255,255,255,0.12)", color: "#e2e8f0" }} />
                </>
              )}
            </>
          )}

          {/* Heat map controls */}
          {isHeatmap && (
            <>
              <Select value={heatmapClientId} onChange={v => setHeatmapClientId(v)}>
                <option value="">All Clients</option>
                <option value="__live__">Live Clients</option>
                {clients.map(c => <option key={c.id} value={c.id}>{c.name}{c.is_live === false ? " (offline)" : ""}</option>)}
              </Select>
              <Select value={heatmapDays} onChange={v => setHeatmapDays(Number(v))}>
                <option value={0}>All Time</option>
                <option value={7}>Last 7 days</option>
                <option value={14}>Last 14 days</option>
                <option value={30}>Last 30 days</option>
                <option value={60}>Last 60 days</option>
                <option value={90}>Last 90 days</option>
              </Select>
            </>
          )}

          <NotificationBell alerts={visibleAlerts} onDismiss={dismissAlert} />
        </header>

        {/* Content */}
        <main className={`flex-1 overflow-auto ${view === "zip_tool" ? "p-0 flex flex-col" : "p-6 md:p-8"}`} style={{ background: "#080f1e" }}>

          {topSection === "clients" && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 20, padding: 40 }}>
              <div style={{ width: 64, height: 64, borderRadius: "50%", background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.15)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <svg style={{ width: 28, height: 28, color: "#334155" }} fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </div>
              <div style={{ textAlign: "center" }}>
                <p style={{ fontSize: 18, fontWeight: 700, color: "#e2e8f0", marginBottom: 6 }}>Client Management</p>
                <p style={{ fontSize: 13, color: "#334155", maxWidth: 320, lineHeight: 1.6 }}>
                  A CSM tool is being built here. You'll be able to manage client accounts, track health scores, and monitor key milestones.
                </p>
              </div>
              <div style={{ padding: "6px 14px", borderRadius: 20, background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.15)", fontSize: 11, fontWeight: 700, color: "#64748b", letterSpacing: "0.06em" }}>
                COMING SOON
              </div>
            </div>
          )}

          {topSection === "payments" && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 20, padding: 40 }}>
              <div style={{ width: 64, height: 64, borderRadius: "50%", background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.15)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <svg style={{ width: 28, height: 28, color: "#334155" }} fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                </svg>
              </div>
              <div style={{ textAlign: "center" }}>
                <p style={{ fontSize: 18, fontWeight: 700, color: "#e2e8f0", marginBottom: 6 }}>Payment Tracking</p>
                <p style={{ fontSize: 13, color: "#334155", maxWidth: 320, lineHeight: 1.6 }}>
                  A payment tracking platform is being built here. You'll be able to track invoices, payments, and revenue across all clients.
                </p>
              </div>
              <div style={{ padding: "6px 14px", borderRadius: 20, background: "rgba(245,158,11,0.08)", border: "1px solid rgba(245,158,11,0.15)", fontSize: 11, fontWeight: 700, color: "#64748b", letterSpacing: "0.06em" }}>
                COMING SOON
              </div>
            </div>
          )}

          {(topSection === "dashboard" || topSection === "tools") && (<>

          <AlertBanner alerts={visibleAlerts} onDismiss={dismissAlert} />

          {/* ── Dashboard KPIs ── */}
          {view === "dashboard" && (
            metricsLoading ? (
              <div className="flex items-center justify-center py-24">
                <div className="flex items-center gap-3" style={{ color: "#334155" }}>
                  <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
                  </svg>
                  <span className="text-sm font-medium">Loading metrics…</span>
                </div>
              </div>
            ) : metrics ? (
              <div className="space-y-8 max-w-7xl">
                <section>
                  <h2 className="text-xs font-bold uppercase tracking-widest mb-4" style={{ color: "#334155" }}>KPIs</h2>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                    <KpiCard label="New Leads" value={fmtInt(metrics.new_leads)} />
                    <KpiCard label="Booked Appointments" value={fmtInt(metrics.booked_appointments)} />
                    <KpiCard label="Appt Booking Rate" value={fmtPct(metrics.appt_booking_rate)} />
                    <KpiCard label="Appts To Take Place" value={fmtInt(metrics.appts_to_take_place)} />
                    <KpiCard label="Shows" value={fmtInt(metrics.shows)} accent />
                    <KpiCard label="No Shows" value={fmtInt(metrics.no_shows)} />
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mt-3">
                    <KpiCard label="Ad Spend" value={fmt$(metrics.ad_spend)} />
                    <KpiCard label="CPL" value={fmt$(metrics.cpl)} />
                    <KpiCard label="CP Appointment" value={fmt$(metrics.cp_appt)} />
                    <KpiCard label="CPS" value={fmt$(metrics.cps)} />
                    <KpiCard label="Show Rate" value={fmtPct(metrics.show_pct)} accent />
                  </div>
                </section>

                <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }} />

                <section>
                  <h2 className="text-xs font-bold uppercase tracking-widest mb-4" style={{ color: "#334155" }}>Calling Stats</h2>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <KpiCard label="Speed To Lead (Min)" value={fmtDec(metrics.speed_to_lead_min)} />
                    <KpiCard label="Outbound Dials" value={fmtInt(metrics.outbound_dials)} />
                    <KpiCard label="Dials Per Lead" value={fmtDec(metrics.dials_per_lead)} />
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
                    <KpiCard label="Pickups (40s+)" value={fmtInt(metrics.pickups)} />
                    <KpiCard label="Pick Up Rate" value={fmtPct(metrics.pickup_pct)} accent />
                    <KpiCard label="Conversations (2m+)" value={fmtInt(metrics.conversations)} />
                    <KpiCard label="Conversation Rate" value={fmtPct(metrics.conversation_pct)} />
                  </div>
                  <div className="grid grid-cols-2 gap-3 mt-3 max-w-sm">
                    <KpiCard label="Callback Requests" value={fmtInt(metrics.callbacks)} />
                    <KpiCard label="Callback Rate" value={fmtPct(metrics.cb_pct)} />
                  </div>
                </section>
              </div>
            ) : null
          )}

          {/* ── Raw Data Tables ── */}
          {isRaw && (
            <RawDataTable
              type={view as "leads" | "dials" | "appointments" | "speed_to_lead" | "ad_spend"}
              clients={clients}
              preset={preset}
              startDate={dateStart}
              endDate={dateEnd}
            />
          )}

          {/* ── Heat Maps ── */}
          {view === "heatmap_show"   && <HeatMap type="show_rate"    startDate={heatmapStart} endDate={heatmapEnd} clientId={heatmapClientId !== "__live__" ? heatmapClientId || undefined : undefined} liveOnly={heatmapClientId === "__live__"} />}
          {view === "heatmap_pickup" && <HeatMap type="pickup_rate"  startDate={heatmapStart} endDate={heatmapEnd} clientId={heatmapClientId !== "__live__" ? heatmapClientId || undefined : undefined} liveOnly={heatmapClientId === "__live__"} />}
          {view === "heatmap_leads"  && <HeatMap type="new_leads"    startDate={heatmapStart} endDate={heatmapEnd} clientId={heatmapClientId !== "__live__" ? heatmapClientId || undefined : undefined} liveOnly={heatmapClientId === "__live__"} />}

          {/* ── Agent Stats ── */}
          {view === "agent_stats" && (
            <AgentStats
              clients={clients}
              preset={preset}
              startDate={dateStart}
              endDate={dateEnd}
            />
          )}

          {/* ── Agent Scorecards ── */}
          {view === "agent_scorecards" && (
            <AgentScorecards clients={clients} startDate={dateStart} endDate={dateEnd} />
          )}

          {/* ── Call Recordings ── */}
          {view === "recordings" && (
            <RecordingBrowser clients={clients} startDate={dateStart} endDate={dateEnd} />
          )}

          {/* ── Goal Tracker ── */}
          {view === "goals" && (
            <GoalTracker clients={clients} startDate={dateStart} endDate={dateEnd} />
          )}

          {/* ── Admin ── */}
          {view === "admin_agents"  && <AgentAdmin />}
          {view === "admin_clients" && <ClientRoster />}
          {view === "schedule"      && <SetterSchedule clients={clients} />}
          {view === "admin_share"   && <ShareReports clients={clients} />}
          {view === "admin_users"   && <UserManager />}
          {view === "zip_tool"      && <ZipTool />}

          </>)}

        </main>
      </div>
    </div>
  );
}
