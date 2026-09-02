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
import BrandBackground from "./BrandBackground";
import TaskBoard from "./TaskBoard";
import CampaignOverview from "./CampaignOverview";
import CreativeLeaderboard from "./CreativeLeaderboard";
import CSMDashboard from "./CSMDashboard";
import B2BTracking from "./B2BTracking";

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
  closes: number;
  total_revenue: number;
  avg_project_revenue: number;
  cost_per_close: number;
  close_rate: number;
  roi: number;
};

type Preset = "this_month" | "last_month" | "last_30" | "last_7" | "all_time" | "custom";

type View =
  | "dashboard"
  | "campaign_overview"
  | "creative_leaderboard"
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
  | "zip_tool"
  | "task_board"
  | "b2b_tracking";

// B2B view type alias — rendered under Tomsi Media section
type TomsiView = "b2b_tracking";

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
  { view: "campaign_overview", label: "Campaign Overview", group: "Overview" },
  { view: "creative_leaderboard", label: "Creative Leaderboard", group: "Overview" },
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
  { view: "schedule",         label: "Power Dialer Schedule", group: "Admin"    },
  { view: "zip_tool",         label: "Zip Code Tool",     group: "Tools"       },
  { view: "task_board",       label: "Task Board",        group: "Tools"       },
];

const SETTINGS_ICON = "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0z";

const NAV_ICONS: Record<View, string> = {
  dashboard:     "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6",
  campaign_overview: "M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z",
  creative_leaderboard: "M7 21h10M12 3v18M5 7l7-4 7 4M5 7v6a7 7 0 0014 0V7M5 7l7 4 7-4",
  b2b_tracking:      "M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z",
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
  task_board:       "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-6 0h.01M12 16h3m-6 0h.01",
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
    <div className="relative overflow-hidden rounded-2xl p-5 flex flex-col gap-2 group transition-all duration-200 hover:translate-y-[-1px]"
      style={{ background: "linear-gradient(135deg, #ffffff 0%, #f7f7f7 100%)", border: "1px solid rgba(0,0,0,0.07)", boxShadow: "0 1px 2px rgba(0,0,0,0.03), 0 10px 28px -12px rgba(0,0,0,0.10)" }}>
      <div className="absolute top-0 left-0 w-1 h-full rounded-l-xl" style={{ background: accent ? "#000000" : "#000000" }} />
      <span className="text-xs font-medium tracking-wide pl-3" style={{ color: "#6b6b6b" }}>{label}</span>
      <span className="text-3xl font-bold pl-3" style={{ color: "#000000" }}>{value}</span>
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
      className={`px-3 md:px-4 py-2 rounded-lg text-sm font-medium outline-none cursor-pointer transition-colors max-w-[45vw] md:max-w-none ${className}`}
      style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.162)", color: "#111111" }}
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
        <h2 className="text-xl font-semibold" style={{ color: "#111111" }}>Share Reports</h2>
        <p className="text-sm mt-0.5" style={{ color: "#767676" }}>
          Each client has a unique read-only report link — no login required
        </p>
      </div>
      <div className="space-y-3">
        {(enriched.length ? enriched : clients).map((c: ClientWithToken) => (
          <div key={c.id} className="rounded-2xl px-5 py-4 flex items-center justify-between gap-4"
            style={{ background: "#fafafa", border: "1px solid rgba(0,0,0,0.06)", boxShadow: "0 1px 2px rgba(0,0,0,0.03), 0 10px 28px -12px rgba(0,0,0,0.10)" }}>
            <div>
              <p className="text-sm font-medium" style={{ color: "#111111" }}>{c.name}</p>
              {c.share_token && (
                <p className="text-xs mt-0.5 font-mono truncate max-w-xs" style={{ color: "#949494" }}>
                  {getUrl(c.share_token)}
                </p>
              )}
            </div>
            {c.share_token && (
              <button onClick={() => handleCopy(c.share_token!)}
                className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold flex-shrink-0 transition-colors"
                style={copied === c.share_token
                  ? { background: "rgba(52,211,153,0.15)", color: "#333333" }
                  : { background: "rgba(0,0,0,0.072)", color: "#000000" }}>
                {copied === c.share_token ? "✓ Copied!" : "Copy Link"}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// Sections with no children — tapping these navigates directly.
const SECTION_IS_LEAF = new Set<string>(["payments"]);

const CLIENTS_NAV: { id: ClientsView; label: string; icon: string }[] = [
  { id: "client_roster", label: "Client Roster", icon: NAV_ICONS.admin_clients },
  { id: "csm_dashboard", label: "CSM Dashboard", icon: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" },
  { id: "share_reports", label: "Share Reports", icon: NAV_ICONS.admin_share },
];

type TopSection = "clients_dashboard" | "tomsi_media" | "clients" | "tools" | "payments" | "settings";
type ClientsView = "client_roster" | "csm_dashboard" | "share_reports";

const TOP_SECTIONS: { id: TopSection; label: string; icon: string; badge?: string }[] = [
  {
    id: "clients_dashboard", label: "Clients Dashboard",
    icon: "M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6",
  },
  {
    id: "tomsi_media", label: "TM Dashboard",
    icon: "M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z",
  },
  {
    id: "clients", label: "Clients",
    icon: "M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z",
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

const TOOLS_VIEWS: string[] = ["zip_tool", "task_board"];

const NAV_STATE_KEY = "dashboard-nav-state";
const DISMISSED_ALERTS_KEY = "dismissed-alerts";
const CLOSED_BANNERS_KEY = "closed-banner-alerts";

// Keys a stale-booking alert to its current staleness episode (anchored to the last
// booking timestamp) and day count, so dismissing "3 days" today doesn't also suppress
// "4 days" tomorrow, but a fresh episode after a new booking starts undismissed again.
function alertKey(a: Alert) {
  return `${a.client_id}:${a.last_booked_at ?? "never"}:${a.days_since_booking ?? "never"}`;
}

export default function DashboardView() {
  const [topSection, setTopSection] = useState<TopSection>("clients_dashboard");
  const [tomsiView, setTomsiView] = useState<TomsiView>("b2b_tracking");
  const [tomsiPreset, setTomsiPreset] = useState<Preset>("last_7");
  const [clientsView, setClientsView] = useState<ClientsView>("client_roster");
  // Collapsed sidebar buys ~176px, which is what wide drawer tables need to
  // fit without a horizontal scroll.
  // The menu is a rail that opens on hover and closes when the pointer leaves,
  // so the extra width never eats into the tables. Mobile keeps the drawer.
  const [navHovered, setNavHovered] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const sync = () => setIsDesktop(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  const navCollapsed = isDesktop && !navHovered;
  const [expandedSections, setExpandedSections] = useState<Set<TopSection>>(new Set(["clients_dashboard"]));
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
  const [closedBannerKeys, setClosedBannerKeys] = useState<Set<string>>(new Set());
  const presetRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  // Restore nav position on mount
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(NAV_STATE_KEY) ?? "{}");
      const savedTop = ["clients_dashboard","tomsi_media","tools","clients","settings"].includes(saved.topSection)
        ? saved.topSection as TopSection
        : null;
      if (savedTop) setTopSection(savedTop);
      // Tools views only belong to the Tools section; restoring one anywhere else
      // would render the tool inside the Clients Dashboard.
      if (saved.view && !(TOOLS_VIEWS.includes(saved.view) && savedTop !== "tools"))
        setView(saved.view as View);
      if (saved.tomsiView) setTomsiView(saved.tomsiView as TomsiView);
      if (saved.clientsView) setClientsView(saved.clientsView as ClientsView);
      if (saved.expandedSections) setExpandedSections(new Set(saved.expandedSections as TopSection[]));
    } catch {}
  }, []);

  // Persist nav position on every change
  useEffect(() => {
    try {
      localStorage.setItem(NAV_STATE_KEY, JSON.stringify({
        topSection, view, tomsiView, clientsView, expandedSections: Array.from(expandedSections),
      }));
    } catch {}
  }, [topSection, view, tomsiView, clientsView, expandedSections]);

  // Restore dismissed alerts + closed banners, then fetch current alerts on mount
  useEffect(() => {
    try {
      const raw = localStorage.getItem(DISMISSED_ALERTS_KEY);
      if (raw) setDismissedAlertKeys(new Set(JSON.parse(raw)));
    } catch {}
    try {
      const raw = localStorage.getItem(CLOSED_BANNERS_KEY);
      if (raw) setClosedBannerKeys(new Set(JSON.parse(raw)));
    } catch {}
    fetch("/api/alerts").then(r => r.json()).then(d => setAlerts(d.alerts ?? [])).catch(() => {});
  }, []);

  // Permanently dismiss — persisted to localStorage, removes from bell too
  const dismissAlert = (a: Alert) => {
    setDismissedAlertKeys(prev => {
      const next = new Set(prev);
      next.add(alertKey(a));
      try { localStorage.setItem(DISMISSED_ALERTS_KEY, JSON.stringify(Array.from(next))); } catch {}
      return next;
    });
  };

  // Close popup banner only — stays visible in notification bell. Persisted so it
  // survives a refresh; keyed on days_since_booking so tomorrow's higher count
  // reopens the banner as a new episode.
  const closeBanner = (a: Alert) => {
    setClosedBannerKeys(prev => {
      const next = new Set(prev).add(alertKey(a));
      try { localStorage.setItem(CLOSED_BANNERS_KEY, JSON.stringify(Array.from(next))); } catch {}
      return next;
    });
  };

  const visibleAlerts = alerts.filter(a => !dismissedAlertKeys.has(alertKey(a)));
  const bannerAlerts = visibleAlerts.filter(a => !closedBannerKeys.has(alertKey(a)));

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

  const fmt$   = (v: number | null | undefined) => v != null ? `$${Math.round(v).toLocaleString("en-US")}` : "—";
  const fmtPct = (v: number | null | undefined) => v != null ? `${v.toFixed(2)}%` : "—";
  const fmtDec = (v: number | null | undefined) => v != null ? v.toFixed(2) : "—";
  const fmtInt = (v: number | null | undefined) => v != null ? Math.round(v).toString() : "—";

  const { start: dateStart, end: dateEnd } =
    preset === "custom" ? { start: customStart, end: customEnd } : getDateRange(preset);

  const tomsiDateRange = tomsiPreset === "custom"
    ? { start: customStart, end: customEnd }
    : getDateRange(tomsiPreset);

  const today = new Date().toISOString().split("T")[0];
  const heatmapStart = heatmapDays > 0
    ? new Date(Date.now() - heatmapDays * 86400000).toISOString().split("T")[0]
    : undefined;
  const heatmapEnd = heatmapDays > 0 ? today : undefined;

  const isHeatmap = view.startsWith("heatmap_");
  const isRaw = ["leads", "dials", "appointments", "speed_to_lead", "ad_spend"].includes(view);
  const isAgentView = ["agent_stats", "agent_scorecards", "recordings"].includes(view);
  // "Tools" is deliberately absent: the Zip Code Tool lives under the Tools
  // top-level section, not inside the Clients Dashboard sub-nav.
  const groups = ["Overview", "Raw Data", "Heat Maps", "Agent Stats", "Admin"];

  // Section + page, e.g. ["Clients", "Client Roster"]. Drives the header crumb
  // and the browser tab so they can't drift apart.
  const crumb: [string | null, string] =
    topSection === "tomsi_media" ? ["Tomsi Media", "B2B Tracking"]
    : topSection === "payments"  ? [null, "Payments"]
    : topSection === "clients"   ? ["Clients", CLIENTS_NAV.find(c => c.id === clientsView)?.label ?? "Clients"]
    : topSection === "settings"  ? ["Settings", "Users"]
    : [NAV.find(n => n.view === view)?.group ?? null, NAV.find(n => n.view === view)?.label ?? "Dashboard"];

  const pageTitle = crumb[1];
  useEffect(() => {
    document.title = `${pageTitle} — Tomsi Media`;
  }, [pageTitle]);

  return (
    // 100dvh, not 100vh — on a phone the address bar is counted in vh, so the
    // last row of every screen sat below the fold.
    <div className="h-[100dvh] overflow-hidden flex" style={{ background: "transparent", position: "relative" }}>
      <BrandBackground />

      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/60 z-20 md:hidden backdrop-blur-sm" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Rail placeholder — keeps content clear of the menu without resizing
          when it opens on hover. */}
      <div className="hidden md:block flex-shrink-0" style={{ width: 64 }} />

      {/* Sidebar */}
      <aside
        onMouseEnter={() => setNavHovered(true)}
        onMouseLeave={() => setNavHovered(false)}
        className={`
        fixed top-0 left-0 h-full z-30 flex flex-col
        transition-transform duration-300
        ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}
        md:translate-x-0 md:z-40
      `} style={{ width: navCollapsed ? 64 : 240, overflowX: "hidden", transition: "width 320ms cubic-bezier(0.22, 1, 0.36, 1), box-shadow 320ms ease", boxShadow: navCollapsed ? "0 0 0 rgba(0,0,0,0)" : "0 0 40px -8px rgba(0,0,0,0.18)", background: "rgba(255,255,255,0.82)", backdropFilter: "saturate(180%) blur(20px)", WebkitBackdropFilter: "saturate(180%) blur(20px)", borderRight: "1px solid rgba(0,0,0,0.07)" }}>

        {/* Logo */}
        <div className="flex justify-center items-center overflow-hidden px-2" style={{ borderBottom: "1px solid rgba(0,0,0,0.081)", paddingTop: 4, paddingBottom: 4 }}>
          <img
            src="/tomsi-logo-black.png"
            alt="Tomsi Media"
            style={{ width: navCollapsed ? 40 : 132, height: "auto", objectFit: "contain", transition: "width 320ms cubic-bezier(0.22, 1, 0.36, 1)" }}
          />
        </div>

        {/* Nav */}
        <nav className={`flex-1 overflow-y-auto py-4 ${navCollapsed ? "px-2" : "px-3"}`}>

          {/* Top-level sections */}
          {TOP_SECTIONS.map(sec => {
            const isActive = topSection === sec.id;
            return (
              <div key={sec.id} className="mb-1">
                {/* Section header button */}
                <button
                  onClick={() => {
                    // Sections with children only expand or collapse — jumping
                    // somewhere on a single tap is disorienting. Navigation
                    // happens when a child is picked. Leaf sections still go
                    // straight there, since there is nothing to expand.
                    if (SECTION_IS_LEAF.has(sec.id)) {
                      setTopSection(sec.id);
                      setSidebarOpen(false);
                      return;
                    }
                    setExpandedSections(prev => {
                      const next = new Set(prev);
                      if (next.has(sec.id)) next.delete(sec.id);
                      else next.add(sec.id);
                      return next;
                    });
                  }}
                  title={navCollapsed ? sec.label : undefined}
                  className="w-full text-left py-2.5 rounded-lg flex items-center gap-3 overflow-hidden whitespace-nowrap"
                  style={{
                    paddingLeft: navCollapsed ? 22 : 12,
                    paddingRight: navCollapsed ? 22 : 12,
                    transition: `padding 320ms cubic-bezier(0.22, 1, 0.36, 1), background 150ms ease, color 150ms ease`,
                    ...(isActive
                      ? { background: "rgba(0,0,0,0.06)", color: "#000000", borderLeft: "2px solid #000000" }
                      : { color: "#6b6b6b", borderLeft: "2px solid transparent" }),
                  }}
                  onMouseEnter={e => { if (!isActive) (e.currentTarget as HTMLElement).style.color = "#4a4a4a"; }}
                  onMouseLeave={e => { if (!isActive) (e.currentTarget as HTMLElement).style.color = "#6b6b6b"; }}
                >
                  <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d={sec.icon} />
                  </svg>
                  <span className="text-sm font-semibold flex-1"
                    style={{ opacity: navCollapsed ? 0 : 1, transition: `opacity 200ms ease 80ms` }}>{sec.label}</span>
                  {sec.badge && (
                    <span style={{ fontSize: 9, padding: "2px 5px", borderRadius: 4, background: "rgba(0,0,0,0.081)", color: "#949494", fontWeight: 600, letterSpacing: "0.04em" }}>
                      SOON
                    </span>
                  )}
                  <svg
                    className="w-3 h-3 flex-shrink-0"
                    style={{ transform: expandedSections.has(sec.id) ? "rotate(90deg)" : "rotate(0deg)", opacity: navCollapsed ? 0 : 0.5, transition: `transform 200ms ease, opacity 200ms ease 80ms` }}
                    fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                  </svg>
                </button>

                {/* Sub-nav for Clients Dashboard */}
                {!navCollapsed && sec.id === "clients_dashboard" && expandedSections.has("clients_dashboard") && (
                  <div className="mt-1 mb-2" style={{ borderLeft: "1px solid rgba(0,0,0,0.081)", marginLeft: 20, paddingLeft: 8 }}>
                    {groups.map(group => (
                      <div key={group} className="mb-3">
                        <p className="text-[9px] font-bold uppercase tracking-widest px-2 mb-1" style={{ color: "#c2c2c2" }}>
                          {group}
                        </p>
                        {NAV.filter(n => n.group === group).map(item => {
                          const active = topSection === "clients_dashboard" && view === item.view;
                          return (
                            <button
                              key={item.view}
                              onClick={() => { setTopSection("clients_dashboard"); setView(item.view); setSidebarOpen(false); }}
                              className="w-full text-left px-2 py-1.5 rounded-md text-xs font-medium flex items-center gap-2 transition-all duration-150 mb-0.5"
                              style={active
                                ? { background: "rgba(0,0,0,0.06)", color: "#000000" }
                                : { color: "#767676" }}
                              onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.color = "#4a4a4a"; }}
                              onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.color = "#767676"; }}
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

                {/* Sub-nav for Clients */}
                {!navCollapsed && sec.id === "clients" && expandedSections.has("clients") && (
                  <div className="mt-1 mb-2" style={{ borderLeft: "1px solid rgba(0,0,0,0.081)", marginLeft: 20, paddingLeft: 8 }}>
                    {CLIENTS_NAV.map(item => {
                      const active = topSection === "clients" && clientsView === item.id;
                      return (
                        <button
                          key={item.id}
                          onClick={() => { setTopSection("clients"); setClientsView(item.id); setSidebarOpen(false); }}
                          className="w-full text-left px-2 py-1.5 rounded-md text-xs font-medium flex items-center gap-2 transition-all duration-150 mb-0.5"
                          style={active
                            ? { background: "rgba(0,0,0,0.06)", color: "#000000" }
                            : { color: "#767676" }}
                          onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.color = "#4a4a4a"; }}
                          onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.color = "#767676"; }}
                        >
                          <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
                          </svg>
                          {item.label}
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Sub-nav for Tools */}
                {!navCollapsed && sec.id === "tools" && expandedSections.has("tools") && (
                  <div className="mt-1 mb-2" style={{ borderLeft: "1px solid rgba(0,0,0,0.081)", marginLeft: 20, paddingLeft: 8 }}>
                    {NAV.filter(n => n.group === "Tools").map(item => {
                      const active = topSection === "tools" && view === item.view;
                      return (
                        <button
                          key={item.view}
                          onClick={() => { setTopSection("tools"); setView(item.view); setSidebarOpen(false); }}
                          className="w-full text-left px-2 py-1.5 rounded-md text-xs font-medium flex items-center gap-2 transition-all duration-150 mb-0.5"
                          style={active
                            ? { background: "rgba(0,0,0,0.06)", color: "#000000" }
                            : { color: "#767676" }}
                          onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.color = "#4a4a4a"; }}
                          onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.color = "#767676"; }}
                        >
                          <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d={NAV_ICONS[item.view]} />
                          </svg>
                          {item.label}
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Sub-nav for Tomsi Media Dashboard */}
                {!navCollapsed && sec.id === "tomsi_media" && expandedSections.has("tomsi_media") && (
                  <div className="mt-1 mb-2" style={{ borderLeft: "1px solid rgba(0,0,0,0.081)", marginLeft: 20, paddingLeft: 8 }}>
                    {([
                      { id: "b2b_tracking" as TomsiView, label: "B2B Tracking", icon: "M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" },
                    ] as const).map(item => {
                      const active = topSection === "tomsi_media" && tomsiView === item.id;
                      return (
                        <button
                          key={item.id}
                          onClick={() => { setTopSection("tomsi_media"); setTomsiView(item.id); setSidebarOpen(false); }}
                          className="w-full text-left px-2 py-1.5 rounded-md text-xs font-medium flex items-center gap-2 transition-all duration-150 mb-0.5"
                          style={active
                            ? { background: "rgba(0,0,0,0.06)", color: "#000000" }
                            : { color: "#767676" }}
                          onMouseEnter={e => { if (!active) (e.currentTarget as HTMLElement).style.color = "#4a4a4a"; }}
                          onMouseLeave={e => { if (!active) (e.currentTarget as HTMLElement).style.color = "#767676"; }}
                        >
                          <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
                          </svg>
                          {item.label}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {/* Settings */}
        <div className={navCollapsed ? "px-2 py-4" : "px-3 py-4"} style={{ borderTop: "1px solid rgba(0,0,0,0.081)" }}>
          <button
            onClick={() => {
              setExpandedSections(prev => {
                const next = new Set(prev);
                if (next.has("settings")) next.delete("settings");
                else next.add("settings");
                return next;
              });
              setSidebarOpen(false);
            }}
            title={navCollapsed ? "Settings" : undefined}
            className="w-full text-left py-2.5 rounded-lg text-sm font-medium flex items-center gap-3 overflow-hidden whitespace-nowrap"
            style={{
              paddingLeft: navCollapsed ? 22 : 12,
              paddingRight: navCollapsed ? 22 : 12,
              transition: `padding 320ms cubic-bezier(0.22, 1, 0.36, 1), color 150ms ease`,
              ...(topSection === "settings"
                ? { background: "rgba(0,0,0,0.048)", color: "#000000" }
                : { color: "#949494" }),
            }}
            onMouseEnter={e => { if (topSection !== "settings") (e.currentTarget as HTMLElement).style.color = "#6b6b6b"; }}
            onMouseLeave={e => { if (topSection !== "settings") (e.currentTarget as HTMLElement).style.color = "#949494"; }}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d={SETTINGS_ICON} />
            </svg>
            <span style={{ opacity: navCollapsed ? 0 : 1, transition: "opacity 200ms ease 80ms" }}>Settings</span>
          </button>

          {!navCollapsed && expandedSections.has("settings") && (
            <div className="mt-1" style={{ borderLeft: "1px solid rgba(0,0,0,0.081)", marginLeft: 20, paddingLeft: 8 }}>
              <button
                onClick={() => { setTopSection("settings"); setView("admin_users"); setSidebarOpen(false); }}
                className="w-full text-left px-2 py-1.5 rounded-md text-xs font-medium flex items-center gap-2 transition-all duration-150 mb-0.5"
                style={topSection === "settings" && view === "admin_users"
                  ? { background: "rgba(0,0,0,0.06)", color: "#000000" }
                  : { color: "#767676" }}
                onMouseEnter={e => { if (!(topSection === "settings" && view === "admin_users")) (e.currentTarget as HTMLElement).style.color = "#4a4a4a"; }}
                onMouseLeave={e => { if (!(topSection === "settings" && view === "admin_users")) (e.currentTarget as HTMLElement).style.color = "#767676"; }}
              >
                <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d={NAV_ICONS.admin_users} />
                </svg>
                Users
              </button>
              <button
                onClick={handleSignOut}
                className="w-full text-left px-2 py-1.5 rounded-md text-xs font-medium flex items-center gap-2 transition-all duration-150"
                style={{ color: "#767676" }}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.color = "#4a4a4a"}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.color = "#767676"}
              >
                <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={1.75} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
                Sign Out
              </button>
            </div>
          )}
        </div>

      </aside>

      {/* Main */}
      <div className="flex-1 min-w-0 flex flex-col" style={{ position: "relative", zIndex: 1 }}>

        {/* Header */}
        <header className="flex items-center gap-2 md:gap-3 px-4 py-3 md:px-6 md:py-4 flex-wrap"
          style={{ position: "relative", zIndex: 30, background: "rgba(255,255,255,0.72)", backdropFilter: "saturate(180%) blur(20px)", WebkitBackdropFilter: "saturate(180%) blur(20px)", borderBottom: "1px solid rgba(0,0,0,0.07)" }}>

          <button className="md:hidden -ml-1 p-1.5 flex-shrink-0" aria-label="Open menu" onClick={() => setSidebarOpen(true)}
            style={{ color: "#767676" }}>
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>


          {/* The parent crumb is dropped on a phone — it costs half the bar and
              the menu already says where you are. */}
          <h1 className="text-sm md:text-base font-semibold mr-auto min-w-0 truncate" style={{ color: "#111111" }}>
            {crumb[0] && <span className="hidden md:inline" style={{ color: "#949494" }}>{crumb[0]} / </span>}
            {crumb[1]}
          </h1>

          {/* Tomsi Media date range selector */}
          {topSection === "tomsi_media" && (
            <div className="relative" ref={presetRef}>
              <button
                onClick={() => setShowPresetMenu(v => !v)}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors flex-shrink-0 min-w-[9rem]"
                style={{ background: "#000000", color: "#fff" }}
              >
                <span className="flex-1 text-left">{PRESET_LABELS[tomsiPreset]}</span>
                <svg className="w-3.5 h-3.5 opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {showPresetMenu && (
                <div className="absolute top-full right-0 mt-1.5 rounded-2xl overflow-hidden z-20 w-48"
                  style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.08)", boxShadow: "0 12px 32px -8px rgba(0,0,0,0.18)" }}>
                  {(Object.keys(PRESET_LABELS) as Preset[]).map(p => (
                    <button key={p} onClick={() => { setTomsiPreset(p); setShowPresetMenu(false); }}
                      className="block w-full text-left px-4 py-2.5 text-sm transition-colors"
                      style={tomsiPreset === p
                        ? { background: "rgba(0,0,0,0.09)", color: "#000000", fontWeight: 600 }
                        : { color: "#4a4a4a" }}
                      onMouseEnter={e => { if (tomsiPreset !== p) (e.currentTarget as HTMLElement).style.background = "rgba(0,0,0,0.068)"; }}
                      onMouseLeave={e => { if (tomsiPreset !== p) (e.currentTarget as HTMLElement).style.background = ""; }}
                    >
                      {PRESET_LABELS[p]}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {topSection === "tomsi_media" && tomsiPreset === "custom" && (
            <>
              <input type="date" value={customStart} onChange={e => setCustomStart(e.target.value)}
                className="px-3 py-2 rounded-lg text-sm outline-none"
                style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.162)", color: "#111111" }} />
              <span className="text-sm" style={{ color: "#949494" }}>to</span>
              <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)}
                className="px-3 py-2 rounded-lg text-sm outline-none"
                style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.162)", color: "#111111" }} />
            </>
          )}

          {/* Dashboard, raw data, and agent/recording views filters */}
          {topSection !== "tomsi_media" && (view === "dashboard" || isRaw || isAgentView || view === "goals" || view === "recordings") && !view.startsWith("admin_") && (
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
                  className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors flex-shrink-0 min-w-[9rem]"
                  style={{ background: "#000000", color: "#fff" }}
                >
                  <span className="flex-1 text-left">{PRESET_LABELS[preset]}</span>
                  <svg className="w-3.5 h-3.5 opacity-70" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {showPresetMenu && (
                  <div className="absolute top-full right-0 mt-1.5 rounded-2xl overflow-hidden z-20 w-48"
                    style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.08)", boxShadow: "0 12px 32px -8px rgba(0,0,0,0.18)" }}>
                    {(Object.keys(PRESET_LABELS) as Preset[]).map(p => (
                      <button key={p} onClick={() => { setPreset(p); setShowPresetMenu(false); }}
                        className="block w-full text-left px-4 py-2.5 text-sm transition-colors"
                        style={preset === p
                          ? { background: "rgba(0,0,0,0.09)", color: "#000000", fontWeight: 600 }
                          : { color: "#4a4a4a" }}
                        onMouseEnter={e => { if (preset !== p) (e.currentTarget as HTMLElement).style.background = "rgba(0,0,0,0.068)"; }}
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
                    style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.162)", color: "#111111" }} />
                  <span className="text-sm" style={{ color: "#949494" }}>to</span>
                  <input type="date" value={customEnd} onChange={e => setCustomEnd(e.target.value)}
                    className="px-3 py-2 rounded-lg text-sm outline-none"
                    style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.162)", color: "#111111" }} />
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
        <main className={`flex-1 overflow-auto ${view === "zip_tool" && topSection === "tools" ? "p-0 flex flex-col" : "p-4 sm:p-6 md:p-8"}`} style={{ background: "transparent" }}>

          {/* ── Tomsi Media Dashboard ── */}
          {topSection === "tomsi_media" && (
            <>
              {tomsiView === "b2b_tracking" && (
                <B2BTracking startDate={tomsiDateRange.start} endDate={tomsiDateRange.end} />
              )}
            </>
          )}

          {topSection === "clients" && clientsView === "client_roster" && <ClientRoster />}
          {topSection === "clients" && clientsView === "csm_dashboard" && <CSMDashboard />}
          {topSection === "clients" && clientsView === "share_reports" && <ShareReports clients={clients} />}

          {topSection === "settings" && <UserManager />}

          {topSection === "payments" && (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 20, padding: 40 }}>
              <div style={{ width: 64, height: 64, borderRadius: "50%", background: "rgba(0,0,0,0.048)", border: "1px solid rgba(0,0,0,0.09)", display: "flex", alignItems: "center", justifyContent: "center" }}>
                <svg style={{ width: 28, height: 28, color: "#949494" }} fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                </svg>
              </div>
              <div style={{ textAlign: "center" }}>
                <p style={{ fontSize: 18, fontWeight: 700, color: "#111111", marginBottom: 6 }}>Payment Tracking</p>
                <p style={{ fontSize: 13, color: "#949494", maxWidth: 320, lineHeight: 1.6 }}>
                  A payment tracking platform is being built here. You'll be able to track invoices, payments, and revenue across all clients.
                </p>
              </div>
              <div style={{ padding: "6px 14px", borderRadius: 20, background: "rgba(0,0,0,0.048)", border: "1px solid rgba(0,0,0,0.09)", fontSize: 11, fontWeight: 700, color: "#6b6b6b", letterSpacing: "0.06em" }}>
                COMING SOON
              </div>
            </div>
          )}

          {(topSection === "clients_dashboard" || topSection === "tools") && (<>

          {/* Stale-booking alerts belong to the dashboard, not the Tools views */}
          {topSection === "clients_dashboard" && <AlertBanner alerts={bannerAlerts} onDismiss={closeBanner} />}

          {/* ── Dashboard KPIs ── */}
          {view === "dashboard" && (
            metricsLoading ? (
              <div className="flex items-center justify-center py-24">
                <div className="flex items-center gap-3" style={{ color: "#949494" }}>
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
                  <h2 className="text-xs font-bold uppercase tracking-widest mb-4" style={{ color: "#949494" }}>KPIs</h2>
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
                  {metrics.closes > 0 && (
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mt-3">
                      <KpiCard label="Closed Jobs" value={fmtInt(metrics.closes)} accent />
                      <KpiCard label="Close Rate" value={fmtPct(metrics.close_rate)} />
                      <KpiCard label="Avg Project Revenue" value={fmt$(metrics.avg_project_revenue)} accent />
                      <KpiCard label="Cost per Closed Job" value={fmt$(metrics.cost_per_close)} />
                      <KpiCard label="Return Investment" value={`${fmtDec(metrics.roi)}x`} accent />
                    </div>
                  )}
                </section>

                <div style={{ borderTop: "1px solid rgba(0,0,0,0.081)" }} />

                <section>
                  <h2 className="text-xs font-bold uppercase tracking-widest mb-4" style={{ color: "#949494" }}>Calling Stats</h2>
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                    <KpiCard label="Speed To Lead (Min)" value={fmtDec(metrics.speed_to_lead_min)} />
                    <KpiCard label="Outbound Dials" value={fmtInt(metrics.outbound_dials)} />
                    <KpiCard label="Dials Per Lead" value={fmtDec(metrics.dials_per_lead)} />
                    <KpiCard label="Pickups (40s+)" value={fmtInt(metrics.pickups)} />
                    <KpiCard label="Pick Up Rate" value={fmtPct(metrics.pickup_pct)} accent />
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
                    <KpiCard label="Conversations (2m+)" value={fmtInt(metrics.conversations)} />
                    <KpiCard label="Conversation Rate" value={fmtPct(metrics.conversation_pct)} />
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

          {/* ── Campaign Overview (all clients) ── */}
          {view === "campaign_overview" && (
            <CampaignOverview startDate={dateStart} endDate={dateEnd} />
          )}

          {view === "creative_leaderboard" && (
            <CreativeLeaderboard startDate={dateStart} endDate={dateEnd} />
          )}
          {/* ── Admin ── */}
          {view === "admin_agents"  && <AgentAdmin />}
          {view === "admin_clients" && <ClientRoster />}
          {view === "schedule"      && <SetterSchedule clients={clients} />}
          {view === "zip_tool" && topSection === "tools" && <ZipTool />}
          {view === "task_board" && topSection === "tools" && <TaskBoard />}

          </>)}

        </main>
      </div>
    </div>
  );
}
