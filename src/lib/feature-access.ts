// Per-user feature access.
//
// The source of truth is `profiles.allowed_views`. It is mirrored into the
// Supabase auth user's `app_metadata` on every write so the middleware can gate
// requests straight off the session, with no extra database round-trip on the
// hot path.
//
// `null`/absent means "no restriction". Every account that predates this
// feature is therefore unaffected — access is only ever narrowed by an admin
// explicitly ticking boxes in Settings > Users.

export type FeatureId =
  | "dashboard" | "campaign_overview" | "creative_leaderboard" | "goals"
  | "leads" | "dials" | "appointments" | "speed_to_lead" | "ad_spend"
  | "heatmap_show" | "heatmap_pickup" | "heatmap_leads"
  | "agent_stats" | "agent_scorecards" | "recordings"
  | "admin_agents" | "schedule"
  | "b2b_tracking"
  | "client_roster" | "csm_dashboard" | "share_reports"
  | "zip_tool" | "task_board" | "lift_tracker"
  | "admin_users";

export type FeatureGroup =
  | "Clients Dashboard" | "TM Dashboard" | "Clients" | "Tools" | "Settings";

export const FEATURES: { id: FeatureId; label: string; group: FeatureGroup }[] = [
  { id: "dashboard",            label: "Dashboard",             group: "Clients Dashboard" },
  { id: "campaign_overview",    label: "Campaign Overview",     group: "Clients Dashboard" },
  { id: "creative_leaderboard", label: "Creative Leaderboard",  group: "Clients Dashboard" },
  { id: "goals",                label: "Goal Tracker",          group: "Clients Dashboard" },
  { id: "leads",                label: "New Leads",             group: "Clients Dashboard" },
  { id: "dials",                label: "All Dials",             group: "Clients Dashboard" },
  { id: "appointments",         label: "Appointments",          group: "Clients Dashboard" },
  { id: "speed_to_lead",        label: "Speed to Lead",         group: "Clients Dashboard" },
  { id: "ad_spend",             label: "Ad Spend",              group: "Clients Dashboard" },
  { id: "heatmap_show",         label: "Heat Map — Show Rate",  group: "Clients Dashboard" },
  { id: "heatmap_pickup",       label: "Heat Map — Pick Up",    group: "Clients Dashboard" },
  { id: "heatmap_leads",        label: "Heat Map — New Leads",  group: "Clients Dashboard" },
  { id: "agent_stats",          label: "Agent Stats",           group: "Clients Dashboard" },
  { id: "agent_scorecards",     label: "Scorecards",            group: "Clients Dashboard" },
  { id: "recordings",           label: "Call Recordings",       group: "Clients Dashboard" },
  { id: "admin_agents",         label: "Agent Roster",          group: "Clients Dashboard" },
  { id: "schedule",             label: "Power Dialer Schedule", group: "Clients Dashboard" },
  { id: "b2b_tracking",         label: "B2B Tracking",          group: "TM Dashboard"      },
  { id: "client_roster",        label: "Client Roster",         group: "Clients"           },
  { id: "csm_dashboard",        label: "CSM Dashboard",         group: "Clients"           },
  { id: "share_reports",        label: "Share Reports",         group: "Clients"           },
  { id: "zip_tool",             label: "Zip Score Engine",      group: "Tools"             },
  { id: "task_board",           label: "Task Board",            group: "Tools"             },
  { id: "lift_tracker",         label: "Lifting Tracker",       group: "Tools"             },
  { id: "admin_users",          label: "User Management",       group: "Settings"          },
];

export const FEATURE_GROUPS: FeatureGroup[] =
  ["Clients Dashboard", "TM Dashboard", "Clients", "Tools", "Settings"];

export const ALL_FEATURE_IDS: FeatureId[] = FEATURES.map(f => f.id);

// A sensible starting grant for a brand-new non-admin: their own personal
// tools, nothing client-facing. The admin widens it from there.
export const DEFAULT_NEW_USER_VIEWS: FeatureId[] = ["task_board", "lift_tracker"];

export function sanitizeViews(input: unknown): FeatureId[] | null {
  if (!Array.isArray(input)) return null;
  const set = new Set(ALL_FEATURE_IDS as string[]);
  return input.filter((v): v is FeatureId => typeof v === "string" && set.has(v));
}

// API path prefix → the features that can reach it. A request is allowed if the
// user holds any one of them. Paths with no entry are ungated (shared shell
// data: client list, alerts, auth).
const API_GATES: { prefix: string; features: FeatureId[] }[] = [
  { prefix: "/api/lift-log",           features: ["lift_tracker"] },
  { prefix: "/api/tasks",              features: ["task_board"] },
  { prefix: "/api/zip-",               features: ["zip_tool"] },
  { prefix: "/api/metrics",            features: ["dashboard"] },
  { prefix: "/api/campaign-overview",  features: ["campaign_overview"] },
  { prefix: "/api/campaign-exclusions",features: ["campaign_overview"] },
  { prefix: "/api/client-ad-breakdown",features: ["campaign_overview"] },
  { prefix: "/api/creative-leaderboard", features: ["creative_leaderboard"] },
  { prefix: "/api/goals",              features: ["goals"] },
  { prefix: "/api/raw",                features: ["leads", "dials", "appointments", "speed_to_lead", "ad_spend"] },
  { prefix: "/api/heatmap",            features: ["heatmap_show", "heatmap_pickup", "heatmap_leads"] },
  { prefix: "/api/agent-stats",        features: ["agent_stats", "agent_scorecards"] },
  { prefix: "/api/recordings",         features: ["recordings"] },
  { prefix: "/api/agents",             features: ["admin_agents", "schedule"] },
  { prefix: "/api/pd-schedule",        features: ["schedule"] },
  { prefix: "/api/setter-availability",features: ["schedule"] },
  { prefix: "/api/watch-schedule",     features: ["schedule"] },
  { prefix: "/api/client-windows",     features: ["schedule"] },
  { prefix: "/api/csm-dashboard",      features: ["csm_dashboard"] },
  { prefix: "/api/client-csm-status",  features: ["csm_dashboard"] },
  { prefix: "/api/client-touchpoints", features: ["csm_dashboard"] },
  { prefix: "/api/csm-recordings",     features: ["csm_dashboard"] },
  { prefix: "/api/client-sessions",    features: ["zip_tool"] },
  { prefix: "/api/b2b-metrics",        features: ["b2b_tracking"] },
  { prefix: "/api/b2b-ads",            features: ["b2b_tracking"] },
  { prefix: "/api/b2b-adsets",         features: ["b2b_tracking"] },
];

// `allowed` of null/undefined means unrestricted.
export function canReachPath(pathname: string, allowed: string[] | null | undefined): boolean {
  if (!allowed) return true;
  const gate = API_GATES.find(g => pathname.startsWith(g.prefix));
  if (!gate) return true;
  return gate.features.some(f => allowed.includes(f));
}

export function hasFeature(feature: FeatureId, allowed: string[] | null | undefined): boolean {
  if (!allowed) return true;
  return allowed.includes(feature);
}
