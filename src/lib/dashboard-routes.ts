// URL ↔ nav-state mapping for the dashboard.
//
// The dashboard is one client-rendered page, so before this every view sat on
// `/dashboard` and the address bar never moved. `app/dashboard/[[...slug]]`
// now accepts `/dashboard/<section>/<view>`, which gives every menu item its
// own shareable URL and — because the title is resolved here, on the server —
// its own browser-tab name.
//
// Next streams metadata after the initial UI, so a `<title>` set from the
// client during hydration gets overwritten by the late flush. Resolving the
// title from the URL is what actually stops the tab reverting.

export type DashSection =
  | "clients_dashboard" | "tomsi_media" | "clients" | "tools" | "payments" | "settings";

export type DashRoute = {
  section: DashSection;
  /** NAV view id, for the sections that have a sub-nav of views. */
  view?: string;
  /** CLIENTS_NAV id. */
  clientsView?: string;
};

export const SECTION_SLUGS: Record<DashSection, string> = {
  clients_dashboard: "clients-dashboard",
  tomsi_media:       "tm-dashboard",
  clients:           "clients",
  tools:             "tools",
  payments:          "payments",
  settings:          "settings",
};

const SECTION_TITLES: Record<DashSection, string> = {
  clients_dashboard: "Clients Dashboard",
  tomsi_media:       "B2B Tracking",
  clients:           "Clients",
  tools:             "Tools",
  payments:          "Payments",
  settings:          "Users",
};

// view id → { slug, label }. Labels match the sidebar so the tab reads the same
// as the page you're looking at.
export const VIEW_ROUTES: Record<string, { slug: string; label: string; section: DashSection }> = {
  dashboard:            { slug: "dashboard",             label: "Dashboard",             section: "clients_dashboard" },
  campaign_overview:    { slug: "campaign-overview",     label: "Campaign Overview",     section: "clients_dashboard" },
  creative_leaderboard: { slug: "creative-leaderboard",  label: "Creative Leaderboard",  section: "clients_dashboard" },
  goals:                { slug: "goal-tracker",          label: "Goal Tracker",          section: "clients_dashboard" },
  leads:                { slug: "new-leads",             label: "New Leads",             section: "clients_dashboard" },
  dials:                { slug: "all-dials",             label: "All Dials",             section: "clients_dashboard" },
  appointments:         { slug: "appointments",          label: "Appointments",          section: "clients_dashboard" },
  speed_to_lead:        { slug: "speed-to-lead",         label: "Speed to Lead",         section: "clients_dashboard" },
  ad_spend:             { slug: "ad-spend",              label: "Ad Spend",              section: "clients_dashboard" },
  heatmap_show:         { slug: "show-rate",             label: "Show Rate",             section: "clients_dashboard" },
  heatmap_pickup:       { slug: "pick-up-rate",          label: "Pick Up Rate",          section: "clients_dashboard" },
  heatmap_leads:        { slug: "heatmap-new-leads",     label: "New Leads",             section: "clients_dashboard" },
  agent_stats:          { slug: "agent-stats",           label: "Agent Stats",           section: "clients_dashboard" },
  agent_scorecards:     { slug: "scorecards",            label: "Scorecards",            section: "clients_dashboard" },
  recordings:           { slug: "call-recordings",       label: "Call Recordings",       section: "clients_dashboard" },
  admin_agents:         { slug: "agent-roster",          label: "Agent Roster",          section: "clients_dashboard" },
  schedule:             { slug: "power-dialer-schedule", label: "Power Dialer Schedule", section: "clients_dashboard" },
  zip_tool:             { slug: "zip-score-engine",      label: "Zip Score Engine",      section: "tools" },
  task_board:           { slug: "task-board",            label: "Task Board",            section: "tools" },
  lift_tracker:         { slug: "health-tracker",        label: "Health Tracker",        section: "tools" },
};

export const CLIENTS_VIEW_ROUTES: Record<string, { slug: string; label: string }> = {
  client_roster: { slug: "client-roster", label: "Client Roster" },
  csm_dashboard: { slug: "csm-dashboard", label: "CSM Dashboard" },
  share_reports: { slug: "share-reports", label: "Share Reports" },
};

/** `/dashboard/<section>/<view>` for a nav position. */
export function pathForRoute(r: DashRoute): string {
  const section = SECTION_SLUGS[r.section] ?? SECTION_SLUGS.clients_dashboard;
  if (r.section === "clients" && r.clientsView && CLIENTS_VIEW_ROUTES[r.clientsView]) {
    return `/dashboard/${section}/${CLIENTS_VIEW_ROUTES[r.clientsView].slug}`;
  }
  if ((r.section === "clients_dashboard" || r.section === "tools") && r.view && VIEW_ROUTES[r.view]) {
    return `/dashboard/${section}/${VIEW_ROUTES[r.view].slug}`;
  }
  return `/dashboard/${section}`;
}

/** Inverse of pathForRoute. Unknown slugs fall back to the default landing view. */
export function routeForSlug(slug: string[] | undefined): DashRoute | null {
  if (!slug?.length) return null;
  const [sectionSlug, viewSlug] = slug;

  const section = (Object.keys(SECTION_SLUGS) as DashSection[])
    .find(s => SECTION_SLUGS[s] === sectionSlug);
  if (!section) return null;

  if (section === "clients") {
    const cv = Object.keys(CLIENTS_VIEW_ROUTES).find(k => CLIENTS_VIEW_ROUTES[k].slug === viewSlug);
    return { section, clientsView: cv ?? "client_roster" };
  }
  if (section === "clients_dashboard" || section === "tools") {
    const v = Object.keys(VIEW_ROUTES).find(k => VIEW_ROUTES[k].slug === viewSlug && VIEW_ROUTES[k].section === section);
    if (v) return { section, view: v };
    return { section, view: section === "tools" ? "zip_tool" : "dashboard" };
  }
  return { section };
}

/** Browser-tab name for a URL. */
export function titleForSlug(slug: string[] | undefined): string {
  const r = routeForSlug(slug);
  if (!r) return "Dashboard";
  if (r.section === "clients" && r.clientsView) return CLIENTS_VIEW_ROUTES[r.clientsView]?.label ?? "Clients";
  if (r.view && VIEW_ROUTES[r.view]) return VIEW_ROUTES[r.view].label;
  return SECTION_TITLES[r.section];
}
