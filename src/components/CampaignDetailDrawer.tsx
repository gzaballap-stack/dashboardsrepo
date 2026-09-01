"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { KPI_TARGETS, kpiVerdict, overallVerdict, callHealth, VERDICT_STYLE, type KpiKey } from "@/lib/kpi-targets";

// ─── Shared types (re-declared here to keep the drawer self-contained) ────────
export interface B2BDrawerData {
  ad_spend: number; leads: number; intros_booked: number; intros_shown: number;
  sales_calls_booked: number; sales_calls_shown: number; closes: number;
  cash_collected: number; impressions: number; reach: number; link_clicks: number;
  ctr: number | null; cpc: number | null; cpm: number | null;
  intro_show_rate: number; cost_per_lead: number; cost_per_close: number;
  campaigns: Array<{
    campaign_id: string; campaign_name: string | null;
    spend: number; impressions: number; reach: number; link_clicks: number;
    ctr: number | null; cpc: number | null; cpm: number | null;
  }>;
}

export interface ClientDrawerData {
  client_id: string; client_name: string; rank: string; status: string;
  bottleneck: string; action: string; spend: number; leads: number; cpl: number;
  cvr: number; appts: number; cp_appt: number; l2a_pct: number;
  shows: number; no_shows: number; show_rate: number; closes: number;
  close_rate: number; ctr: number; cpc: number;
  campaigns: Array<{
    campaign_id: string; campaign_name: string; platform: string;
    status: string | null; spend: number; impressions: number; reach: number;
    link_clicks: number; ctr: number; cpc: number; excluded?: boolean;
  }>;
}

export type DrawerEntity =
  | { kind: "b2b"; name: string; id: string; data: B2BDrawerData; startDate: string; endDate: string; }
  | { kind: "client"; client: ClientDrawerData; startDate: string; endDate: string; };

// ─── Helpers ─────────────────────────────────────────────────────────────────
const fmt$ = (n: number) => n > 0 ? `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "—";
const fmtDec = (n: number | null, pre = "$") => n != null && n > 0 ? `${pre}${n.toFixed(2)}` : "—";
const fmtPct = (n: number, digits = 1) => `${n.toFixed(digits)}%`;
const fmtN = (n: number) => n.toLocaleString();
const dash = () => <span style={{ color: "#949494" }}>—</span>;

const STATUS_STYLE: Record<string, { label: string; color: string; bg: string }> = {
  excellent:    { label: "Excellent",    color: "#000000", bg: "rgba(0,0,0,0.072)"  },
  on_target:    { label: "On Target",    color: "#38bdf8", bg: "rgba(56,189,248,0.12)"  },
  above_target: { label: "Above Target", color: "#000000", bg: "rgba(0,0,0,0.072)"  },
  critical:     { label: "Critical",     color: "#c0392b", bg: "rgba(192,57,43,0.12)" },
  hold:         { label: "Hold",         color: "#a78bfa", bg: "rgba(167,139,250,0.12)" },
  no_data:      { label: "No Data",      color: "#6b6b6b", bg: "rgba(100,116,139,0.12)" },
};

const BOTTLENECK_COLOR: Record<string, string> = {
  Healthy: "#000000", Creative: "#6b6b6b", Targeting: "#000000",
  Funnel: "#4a4a4a", "Post-Funnel": "#a78bfa", Hold: "#4a4a4a", "No Data": "#6b6b6b",
};

const PLATFORM_LABEL: Record<string, string> = { meta: "Meta", google: "Google", local_services: "LSA" };

function relativeTime(d: Date): string {
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

// ─── Sub-components ───────────────────────────────────────────────────────────
function MetricRow({ label, value, status }: { label: string; value: string; status?: string }) {
  const st = status ? STATUS_STYLE[status] : null;
  return (
    <div className="flex items-center justify-between py-1.5" style={{ borderBottom: "1px solid rgba(0,0,0,0.054)" }}>
      <span className="text-xs" style={{ color: "#6b6b6b" }}>{label}</span>
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold" style={{ color: "#111111" }}>{value}</span>
        {st && (
          <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold" style={{ color: st.color, background: st.bg }}>
            {st.label}
          </span>
        )}
      </div>
    </div>
  );
}

function SectionCard({ title, children, badge }: { title: string; children: React.ReactNode; badge?: React.ReactNode }) {
  return (
    <div className="rounded-2xl p-4 flex flex-col" style={{ background: "#fafafa", border: "1px solid rgba(0,0,0,0.07)", boxShadow: "0 1px 2px rgba(0,0,0,0.03), 0 10px 28px -12px rgba(0,0,0,0.10)" }}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-[10px] font-bold uppercase tracking-widest" style={{ color: "#767676" }}>{title}</span>
        {badge}
      </div>
      <div className="flex-1 flex flex-col gap-0">{children}</div>
    </div>
  );
}

// ─── Funnel bar ───────────────────────────────────────────────────────────────
function FunnelStage({ label, count, pct, color }: { label: string; count: number; pct: number; color: string }) {
  return (
    <div className="flex items-center gap-3 mb-3">
      <div className="w-28 text-right flex-shrink-0">
        <span className="text-xs font-medium" style={{ color: "#4a4a4a" }}>{label}</span>
      </div>
      <div className="flex-1 relative h-9 rounded-lg overflow-hidden" style={{ background: "rgba(0,0,0,0.05)" }}>
        <div className="h-full rounded-lg" style={{ width: `${Math.max(pct, 2)}%`, background: color, transition: "width 300ms ease" }} />
      </div>
      <div className="w-16 text-right flex-shrink-0">
        <span className="text-sm font-bold" style={{ color: "#111111" }}>{fmtN(count)}</span>
      </div>
      <div className="w-14 text-right flex-shrink-0">
        <span className="text-xs" style={{ color: "#6b6b6b" }}>{pct.toFixed(1)}%</span>
      </div>
    </div>
  );
}

// ─── Comparison cell ──────────────────────────────────────────────────────────
function CompCell({ label, value, baseline, isBaseline, loading }: {
  label: string; value: number | null; baseline: number | null;
  isBaseline: boolean; loading: boolean;
}) {
  if (loading) return <div className="py-2 text-xs text-center" style={{ color: "#949494" }}>…</div>;
  const numVal = value ?? 0;
  const numBase = baseline ?? 0;
  const delta = numBase > 0 ? ((numVal - numBase) / numBase) * 100 : 0;
  const up = delta > 2;
  const dn = delta < -2;
  return (
    <div className="py-2 px-3" style={{ borderBottom: "1px solid rgba(0,0,0,0.054)" }}>
      <div className="text-xs mb-0.5" style={{ color: "#767676" }}>{label}</div>
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold" style={{ color: "#111111" }}>
          {label.toLowerCase().includes("$") || label.toLowerCase().includes("cpl") || label.toLowerCase().includes("spend")
            ? fmt$(numVal) : label.toLowerCase().includes("%") || label.toLowerCase().includes("rate")
            ? fmtPct(numVal) : fmtN(numVal)}
        </span>
        {!isBaseline && numBase > 0 && (
          <span className="text-[10px] font-semibold" style={{ color: up ? "#000000" : dn ? "#c0392b" : "#6b6b6b" }}>
            {up ? "▲" : dn ? "▼" : "≈"} {Math.abs(delta).toFixed(1)}%
          </span>
        )}
        {isBaseline && <span className="text-[10px] uppercase font-bold px-1 rounded" style={{ color: "#4a4a4a", background: "rgba(0,0,0,0.06)" }}>Baseline</span>}
      </div>
    </div>
  );
}

// ─── Chat message bubble ──────────────────────────────────────────────────────
function ChatBubble({ msg }: { msg: { role: string; content: string } }) {
  const isUser = msg.role === "user";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} mb-3`}>
      <div className="max-w-[80%] rounded-2xl px-4 py-2.5 text-sm" style={{
        background: isUser ? "rgba(0,0,0,0.15)" : "#ffffff",
        border: `1px solid ${isUser ? "rgba(0,0,0,0.24)" : "rgba(0,0,0,0.095)"}`,
        color: "#111111",
        whiteSpace: "pre-wrap",
      }}>
        {msg.content}
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────
export default function CampaignDetailDrawer({ entity, onClose, onExclusionsChange }: { entity: DrawerEntity; onClose: () => void; onExclusionsChange?: () => void }) {
  type Tab = "calls" | "campaigns" | "adsets" | "ads" | "recordings" | "funnel" | "comparison" | "ai";
  const TABS: { id: Tab; label: string }[] = [
    { id: "calls",      label: "Calls"      },
    { id: "campaigns",  label: "Campaigns"  },
    { id: "adsets",     label: "Ad Sets"    },
    { id: "ads",        label: "Ads"        },
    { id: "recordings", label: "Recordings" },
    { id: "funnel",     label: "Funnel"     },
    { id: "comparison", label: "Comparison" },
    { id: "ai",         label: "AI"         },
  ];

  // Shared metric shape for the Ad Sets / Ads tables. B2B sources supply only the
  // basic fields, so the extras are optional and render as "—" when absent.
  type AdFunnel = {
    leads: number; appts: number; shows: number; no_shows: number;
    closes: number; revenue: number;
  };
  type AdMetrics = {
    spend: number; impressions: number; reach: number; link_clicks: number;
    ctr: number; cpc: number; cpm: number;
    budget?: number | null; frequency?: number; unique_clicks?: number;
    unique_ctr?: number; leads?: number; cvr?: number; cost_per_result?: number;
    // Real CRM funnel attributed to this entity — distinct from `leads`, which
    // is Meta's own reported result count.
    funnel?: AdFunnel;
    cost_per_lead?: number; cost_per_appt?: number; cost_per_close?: number;
    roas?: number;
  };
  type AdSetRow = AdMetrics & {
    adset_id: string; adset_name: string | null; campaign_id: string; campaign_name: string | null;
    platform?: string;
  };
  type AdRow = AdMetrics & {
    ad_id: string; ad_name: string | null; adset_id: string; adset_name: string | null;
    campaign_id: string; campaign_name: string | null; platform?: string;
  };

  type RecordingRow = {
    id: string; occurred_at: string;
    lead_name: string | null; lead_phone: string | null; agent_name: string | null;
    duration_seconds: number | null; is_pickup: boolean | null; is_conversation: boolean | null;
    call_status: string | null; recording_url: string;
  };

  const [tab, setTab]           = useState<Tab>("campaigns");
  const [lastUpdated]           = useState(new Date());
  const [, forceTick]           = useState(0);
  const [compData, setCompData] = useState<Array<{ label: string; start: string; end: string; data: Record<string, number>; loading: boolean }>>([]);
  const [messages, setMessages] = useState<Array<{ role: string; content: string }>>([]);
  const [input, setInput]       = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError]   = useState("");
  const chatEndRef = useRef<HTMLDivElement>(null);

  const [adSetData, setAdSetData]     = useState<AdSetRow[] | null>(null);
  const [adSetLoading, setAdSetLoading] = useState(false);
  const [adData, setAdData]           = useState<AdRow[] | null>(null);
  const [adLoading, setAdLoading]     = useState(false);
  // Local optimistic view of which campaigns are tracked, keyed by campaign_id.
  // Absent = fall back to the server's `excluded` flag on the campaign row.
  const [trackOverrides, setTrackOverrides] = useState<Record<string, boolean>>({});
  const [savingCampaign, setSavingCampaign] = useState<string | null>(null);
  type CallKpis = {
    outbound_dials: number; pickups: number; pickup_pct: number;
    conversations: number; conversation_pct: number;
    speed_to_lead_min: number; dials_per_lead: number;
    avg_duration_sec: number; answer_rate: number; conversation_rate: number;
  };
  type AgentCallRow = {
    agent_name: string; dials: number; pickups: number; pickup_rate: number;
    conversations: number; conversation_rate: number; appointments: number; shows: number;
  };
  const [callKpis, setCallKpis]       = useState<CallKpis | null>(null);
  const [agentCalls, setAgentCalls]   = useState<AgentCallRow[] | null>(null);
  const [callLoading, setCallLoading] = useState(false);
  const [recData, setRecData]         = useState<RecordingRow[] | null>(null);
  const [recLoading, setRecLoading]   = useState(false);

  // Keep "last updated" clock ticking
  useEffect(() => {
    const id = setInterval(() => forceTick(t => t + 1), 15000);
    return () => clearInterval(id);
  }, []);

  // ── Derived values ──────────────────────────────────────────────────
  const isBb = entity.kind === "b2b";
  const name = isBb ? entity.name : (entity as { kind: "client"; client: ClientDrawerData; startDate: string; endDate: string }).client.client_name;
  const statusKey = isBb
    ? (() => {
        const d = entity.data;
        if (!d.leads && !d.ad_spend) return "no_data";
        const r = d.leads > 0 ? d.intros_booked / d.leads : 0;
        if (r >= 0.15) return "excellent";
        if (r >= 0.08) return "on_target";
        if (r >= 0.04) return "above_target";
        return "critical";
      })()
    : (entity as { kind: "client"; client: ClientDrawerData; startDate: string; endDate: string }).client.status;
  const st = STATUS_STYLE[statusKey] ?? STATUS_STYLE.no_data;

  // ── Comparison data ─────────────────────────────────────────────────
  const iso = (d: Date) => d.toISOString().split("T")[0];
  const daysAgo = (n: number) => {
    const d = new Date(); d.setDate(d.getDate() - n); return iso(d);
  };

  const fetchComparison = useCallback(async () => {
    const periods = [
      { label: "Last 3 Days",     start: daysAgo(3),  end: iso(new Date()) },
      { label: "Last 7 Days",     start: daysAgo(7),  end: iso(new Date()) },
      { label: "Previous 7 Days", start: daysAgo(14), end: daysAgo(7)      },
    ];
    setCompData(periods.map(p => ({ ...p, data: {}, loading: true })));

    await Promise.all(periods.map(async (p, i) => {
      try {
        let data: Record<string, number> = {};
        if (entity.kind === "b2b") {
          const r = await fetch(`/api/b2b-metrics?start_date=${p.start}&end_date=${p.end}`).then(r => r.json());
          data = {
            "Spend": r.ad_spend ?? 0,
            "Leads": r.leads ?? 0,
            "CPL ($)": r.cost_per_lead ?? 0,
            "Intros Booked": r.intros_booked ?? 0,
            "Intro Show Rate (%)": (r.intro_show_rate ?? 0) * 100,
            "Demos": r.sales_calls_shown ?? 0,
            "Closes": r.closes ?? 0,
            "Cash ($)": r.cash_collected ?? 0,
          };
        } else {
          const ent = entity as { kind: "client"; client: ClientDrawerData; startDate: string; endDate: string };
          const r = await fetch(`/api/campaign-overview?start_date=${p.start}&end_date=${p.end}`).then(r => r.json());
          const c = (r.clients ?? []).find((x: ClientDrawerData) => x.client_id === ent.client.client_id);
          if (c) {
            data = {
              "Spend": c.spend,
              "Leads": c.leads,
              "CPL ($)": c.cpl,
              "Appts": c.appts,
              "Show Rate (%)": c.show_rate,
              "Closes": c.closes,
              "CTR (%)": c.ctr,
              "CPC ($)": c.cpc,
            };
          }
        }
        setCompData(prev => prev.map((cp, j) => j === i ? { ...cp, data, loading: false } : cp));
      } catch {
        setCompData(prev => prev.map((cp, j) => j === i ? { ...cp, loading: false } : cp));
      }
    }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entity]);

  useEffect(() => {
    if (tab === "comparison") fetchComparison();
  }, [tab, fetchComparison]);

  // ── Ad Set fetch ────────────────────────────────────────────────────
  const fetchAdSets = useCallback(async () => {
    if (adSetData !== null) return; // already loaded
    setAdSetLoading(true);
    try {
      const start = entity.startDate;
      const end   = entity.endDate;
      if (entity.kind === "b2b") {
        const r = await fetch(`/api/b2b-adsets?campaign_id=${encodeURIComponent(entity.id)}&start_date=${start}&end_date=${end}`).then(r => r.json());
        setAdSetData(r.adsets ?? []);
      } else {
        const c = (entity as { kind: "client"; client: ClientDrawerData; startDate: string; endDate: string }).client;
        const r = await fetch(`/api/client-ad-breakdown?client_id=${c.client_id}&level=adset&start_date=${start}&end_date=${end}`).then(r => r.json());
        setAdSetData((r.rows ?? []) as AdSetRow[]);
      }
    } catch { setAdSetData([]); }
    finally  { setAdSetLoading(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entity]);

  useEffect(() => { if (tab === "adsets") fetchAdSets(); }, [tab, fetchAdSets]);

  // ── Ad fetch ────────────────────────────────────────────────────────
  const fetchAds = useCallback(async () => {
    if (adData !== null) return;
    setAdLoading(true);
    try {
      const start = entity.startDate;
      const end   = entity.endDate;
      if (entity.kind === "b2b") {
        const r = await fetch(`/api/b2b-ads?campaign_id=${encodeURIComponent(entity.id)}&start_date=${start}&end_date=${end}`).then(r => r.json());
        setAdData(r.ads ?? []);
      } else {
        const c = (entity as { kind: "client"; client: ClientDrawerData; startDate: string; endDate: string }).client;
        const r = await fetch(`/api/client-ad-breakdown?client_id=${c.client_id}&level=ad&start_date=${start}&end_date=${end}`).then(r => r.json());
        setAdData((r.rows ?? []) as AdRow[]);
      }
    } catch { setAdData([]); }
    finally  { setAdLoading(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entity]);

  useEffect(() => { if (tab === "ads") fetchAds(); }, [tab, fetchAds]);

  // ── Call performance fetch ──────────────────────────────────────────
  // Dials are recorded against a client, not a campaign, so this is the client's
  // call performance for the drawer's date range.
  const fetchCalls = useCallback(async () => {
    if (callKpis !== null || entity.kind === "b2b") return;
    setCallLoading(true);
    try {
      const c = (entity as { kind: "client"; client: ClientDrawerData; startDate: string; endDate: string }).client;
      const range = `start_date=${entity.startDate}&end_date=${entity.endDate}`;
      const [m, a] = await Promise.all([
        fetch(`/api/metrics?client_id=${c.client_id}&${range}`).then(r => r.json()).catch(() => null),
        fetch(`/api/agent-stats?clientId=${c.client_id}&startDate=${entity.startDate}&endDate=${entity.endDate}`)
          .then(r => r.json()).catch(() => null),
      ]);
      setCallKpis(m ?? null);
      setAgentCalls((a?.agents ?? []) as AgentCallRow[]);
    } catch { setCallKpis(null); setAgentCalls([]); }
    finally  { setCallLoading(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entity]);

  useEffect(() => { fetchCalls(); }, [fetchCalls]);

  // ── Campaign tracking toggle ────────────────────────────────────────
  // Untracking a campaign removes its spend from every rollup that reads
  // ad_spend (dashboard KPIs, client reports), not just this table.
  const toggleTracked = async (campaignId: string, nextTracked: boolean) => {
    if (entity.kind === "b2b") return;
    const c = (entity as { kind: "client"; client: ClientDrawerData; startDate: string; endDate: string }).client;
    setSavingCampaign(campaignId);
    setTrackOverrides(prev => ({ ...prev, [campaignId]: nextTracked }));
    try {
      if (nextTracked) {
        await fetch(`/api/campaign-exclusions?client_id=${c.client_id}&campaign_id=${encodeURIComponent(campaignId)}`, { method: "DELETE" });
      } else {
        await fetch("/api/campaign-exclusions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ client_id: c.client_id, campaign_id: campaignId }),
        });
      }
      onExclusionsChange?.();
    } catch {
      // Put the switch back if the write did not land.
      setTrackOverrides(prev => ({ ...prev, [campaignId]: !nextTracked }));
    } finally {
      setSavingCampaign(null);
    }
  };

  // ── Recording fetch ─────────────────────────────────────────────────
  // Recordings hang off dial events, which are keyed to a client rather than an
  // ad campaign, so this is client-scoped even inside a campaign drawer.
  const fetchRecordings = useCallback(async () => {
    if (recData !== null || entity.kind === "b2b") return;
    setRecLoading(true);
    try {
      const c = (entity as { kind: "client"; client: ClientDrawerData; startDate: string; endDate: string }).client;
      const params = new URLSearchParams({ clientId: c.client_id, outcome: "all" });
      if (entity.startDate) params.set("startDate", entity.startDate);
      if (entity.endDate)   params.set("endDate", entity.endDate);
      const r = await fetch(`/api/recordings?${params}`).then(r => r.json());
      setRecData((r.rows ?? []) as RecordingRow[]);
    } catch { setRecData([]); }
    finally  { setRecLoading(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entity]);

  useEffect(() => { if (tab === "recordings") fetchRecordings(); }, [tab, fetchRecordings]);

  // ── AI context builder ──────────────────────────────────────────────
  const buildContext = () => {
    if (entity.kind === "b2b") {
      const d = entity.data;
      return [
        `Campaign: ${entity.name} | ID: ${entity.id}`,
        `Date Range: ${entity.startDate} → ${entity.endDate}`,
        `Ad Spend: $${d.ad_spend.toFixed(0)} | Leads: ${d.leads} | CPL: $${d.cost_per_lead.toFixed(2)}`,
        `Intros Booked: ${d.intros_booked} | Intros Shown: ${d.intros_shown} | Show Rate: ${(d.intro_show_rate * 100).toFixed(1)}%`,
        `Demos Booked: ${d.sales_calls_booked} | Demos Shown: ${d.sales_calls_shown}`,
        `Demo Show Rate: ${d.sales_calls_booked > 0 ? ((d.sales_calls_shown / d.sales_calls_booked) * 100).toFixed(1) : 0}%`,
        `Closes: ${d.closes} | Cash Collected: $${d.cash_collected.toFixed(0)}`,
        `Close Rate: ${d.sales_calls_shown > 0 ? ((d.closes / d.sales_calls_shown) * 100).toFixed(1) : 0}%`,
        `Cost per Intro: $${d.intros_booked > 0 ? (d.ad_spend / d.intros_booked).toFixed(0) : "N/A"}`,
        `Cost per Demo: $${d.sales_calls_shown > 0 ? (d.ad_spend / d.sales_calls_shown).toFixed(0) : "N/A"}`,
        `Cost per Acquisition: $${d.closes > 0 ? (d.ad_spend / d.closes).toFixed(0) : "N/A"}`,
        `CTR: ${d.ctr != null ? d.ctr.toFixed(2) + "%" : "N/A"} | CPC: ${d.cpc != null ? "$" + d.cpc.toFixed(2) : "N/A"} | CPM: ${d.cpm != null ? "$" + d.cpm.toFixed(2) : "N/A"}`,
        `Impressions: ${d.impressions.toLocaleString()} | Reach: ${d.reach.toLocaleString()} | Link Clicks: ${d.link_clicks.toLocaleString()}`,
      ].join("\n");
    } else {
      const c = (entity as { kind: "client"; client: ClientDrawerData; startDate: string; endDate: string }).client;
      return [
        `Client: ${c.client_name}`,
        `Date Range: ${entity.startDate} → ${entity.endDate}`,
        `Ad Spend: $${c.spend.toFixed(0)} | Leads: ${c.leads} | CPL: $${c.cpl.toFixed(2)}`,
        `CTR: ${c.ctr.toFixed(2)}% | CPC: $${c.cpc.toFixed(2)} | CVR: ${c.cvr.toFixed(1)}%`,
        `Appointments: ${c.appts} | CP Appt: $${c.cp_appt.toFixed(0)} | L2A: ${c.l2a_pct.toFixed(1)}%`,
        `Shows: ${c.shows} | No Shows: ${c.no_shows} | Show Rate: ${c.show_rate.toFixed(1)}%`,
        `Closes: ${c.closes} | Close Rate: ${c.close_rate.toFixed(1)}%`,
        `Status: ${c.status} | Bottleneck: ${c.bottleneck}`,
        `Action: ${c.action}`,
        `Campaigns: ${c.campaigns.length} total (${c.campaigns.filter(x => !x.excluded).length} included)`,
      ].join("\n");
    }
  };

  // ── AI send ─────────────────────────────────────────────────────────
  const sendMessage = async () => {
    if (!input.trim() || aiLoading) return;
    const userMsg = { role: "user", content: input.trim() };
    const newMsgs = [...messages, userMsg];
    setMessages(newMsgs);
    setInput("");
    setAiLoading(true);
    setAiError("");
    try {
      const r = await fetch("/api/ai-campaign-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ context: buildContext(), messages: newMsgs }),
      });
      const d = await r.json();
      if (d.error) { setAiError(d.error); }
      else setMessages([...newMsgs, { role: "assistant", content: d.reply }]);
    } catch {
      setAiError("Connection failed. Please try again.");
    } finally { setAiLoading(false); }
  };

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  // ── Funnel data ─────────────────────────────────────────────────────
  const funnelStages = isBb
    ? (() => {
        const d = entity.data;
        const top = Math.max(d.leads, d.impressions > 0 ? 1 : 0, d.intros_booked, 1);
        return [
          { label: "Impressions",    count: d.impressions,        color: "#000000", pct: 100 },
          { label: "Link Clicks",    count: d.link_clicks,        color: "#4a4a4a", pct: d.impressions > 0 ? (d.link_clicks / d.impressions) * 100 : 0 },
          { label: "Leads",          count: d.leads,              color: "#6b6b6b", pct: d.link_clicks > 0 ? (d.leads / d.link_clicks) * 100 : 0 },
          { label: "Intros Booked",  count: d.intros_booked,      color: "#000000", pct: d.leads > 0 ? (d.intros_booked / d.leads) * 100 : 0 },
          { label: "Intros Shown",   count: d.intros_shown,       color: "#a3e635", pct: d.intros_booked > 0 ? (d.intros_shown / d.intros_booked) * 100 : 0 },
          { label: "Demos Booked",   count: d.sales_calls_booked, color: "#333333", pct: d.intros_shown > 0 ? (d.sales_calls_booked / d.intros_shown) * 100 : 0 },
          { label: "Demos Shown",    count: d.sales_calls_shown,  color: "#4a4a4a", pct: d.sales_calls_booked > 0 ? (d.sales_calls_shown / d.sales_calls_booked) * 100 : 0 },
          { label: "Closes",         count: d.closes,             color: "#6b6b6b", pct: d.sales_calls_shown > 0 ? (d.closes / d.sales_calls_shown) * 100 : 0 },
        ];
        void top;
      })()
    : (() => {
        const c = (entity as { kind: "client"; client: ClientDrawerData; startDate: string; endDate: string }).client;
        return [
          { label: "Leads",      count: c.leads,  color: "#000000", pct: 100 },
          { label: "Appts",      count: c.appts,  color: "#6b6b6b", pct: c.leads > 0 ? (c.appts / c.leads) * 100 : 0 },
          { label: "Shows",      count: c.shows,  color: "#000000", pct: c.appts > 0 ? (c.shows / c.appts) * 100 : 0 },
          { label: "Closes",     count: c.closes, color: "#6b6b6b", pct: c.shows > 0 ? (c.closes / c.shows) * 100 : 0 },
        ];
      })();

  // ── Overview sections ──────────────────────────────────────────────
  const renderLeadGen = () => {
    if (isBb) {
      const d = entity.data;
      const cpi = d.intros_booked > 0 ? d.ad_spend / d.intros_booked : 0;
      return (
        <SectionCard title="Lead Generation" badge={<span className="px-2 py-0.5 rounded-full text-[10px] font-semibold" style={{ color: st.color, background: st.bg }}>{d.ad_spend > 0 ? "ACTIVE" : "NO DATA"}</span>}>
          <MetricRow label="Ad Spend" value={d.ad_spend > 0 ? fmt$(d.ad_spend) : "—"} />
          <MetricRow label="Leads" value={fmtN(d.leads)} />
          <MetricRow label="CPL" value={d.cost_per_lead > 0 ? fmtDec(d.cost_per_lead) : "—"} />
          <MetricRow label="CTR" value={d.ctr != null ? fmtPct(d.ctr) : "—"} />
          <MetricRow label="CPC" value={d.cpc != null ? fmtDec(d.cpc) : "—"} />
          <MetricRow label="CPM" value={d.cpm != null ? fmtDec(d.cpm) : "—"} />
          <MetricRow label="Cost per Intro" value={cpi > 0 ? fmt$(cpi) : "—"} />
        </SectionCard>
      );
    } else {
      const c = (entity as { kind: "client"; client: ClientDrawerData; startDate: string; endDate: string }).client;
      return (
        <SectionCard title="Lead Generation" badge={<span className="px-2 py-0.5 rounded-full text-[10px] font-semibold" style={{ color: st.color, background: st.bg }}>{c.leads > 0 ? "ACTIVE" : "NO DATA"}</span>}>
          <MetricRow label="Spend" value={fmt$(c.spend)} />
          <MetricRow label="Leads" value={fmtN(c.leads)} />
          <MetricRow label="CPL" value={c.cpl > 0 ? fmtDec(c.cpl) : "—"} />
          <MetricRow label="CTR" value={fmtPct(c.ctr)} />
          <MetricRow label="CPC" value={c.cpc > 0 ? fmtDec(c.cpc) : "—"} />
          <MetricRow label="CVR" value={c.cvr > 0 ? fmtPct(c.cvr) : "—"} />
        </SectionCard>
      );
    }
  };

  const HealthPill = ({ v }: { v: keyof typeof VERDICT_STYLE }) => (
    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold"
      style={{ color: VERDICT_STYLE[v].color, background: `${VERDICT_STYLE[v].color}1f` }}>
      {VERDICT_STYLE[v].label}
    </span>
  );

  const renderCallPerf = () => {
    if (isBb) return (
      <SectionCard title="Call Performance">
        <div className="flex-1 flex items-center justify-center py-8 text-xs text-center" style={{ color: "#949494" }}>
          Tracked per client, not on B2B campaigns
        </div>
      </SectionCard>
    );
    const k = callKpis;
    const dials = k?.outbound_dials ?? 0;
    const health = callHealth(k?.answer_rate ?? 0, k?.conversation_rate ?? 0, dials);
    const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`;
    return (
      <SectionCard title="Call Performance" badge={<HealthPill v={health} />}>
        <MetricRow label="Total Dials"       value={dials > 0 ? fmtN(dials) : "—"} />
        <MetricRow label="Pickups (45s+)"    value={k && k.pickups > 0 ? fmtN(k.pickups) : "—"} />
        <MetricRow label="Answer Rate"       value={k && k.answer_rate > 0 ? fmtPct(k.answer_rate) : "—"} />
        <MetricRow label="Conversation Rate" value={k && k.conversation_rate > 0 ? fmtPct(k.conversation_rate) : "—"} />
        <MetricRow label="Avg Duration"      value={k && k.avg_duration_sec > 0 ? mmss(k.avg_duration_sec) : "—"} />
        <MetricRow label="Speed to Lead"     value={k && k.speed_to_lead_min > 0 ? `${k.speed_to_lead_min.toFixed(1)}m` : "—"} />
      </SectionCard>
    );
  };

  const renderAppts = () => {
    if (isBb) {
      const d = entity.data;
      const demoShowRate = d.sales_calls_booked > 0 ? (d.sales_calls_shown / d.sales_calls_booked) * 100 : 0;
      const closeRate = d.sales_calls_shown > 0 ? (d.closes / d.sales_calls_shown) * 100 : 0;
      const cpDemo = d.sales_calls_shown > 0 ? d.ad_spend / d.sales_calls_shown : 0;
      return (
        <SectionCard title="Intros & Demos">
          <MetricRow label="Intros Booked" value={fmtN(d.intros_booked)} />
          <MetricRow label="Intros Shown" value={fmtN(d.intros_shown)} />
          <MetricRow label="Intro Show Rate" value={d.intros_booked > 0 ? fmtPct(d.intro_show_rate * 100) : "—"} />
          <MetricRow label="Demos Booked" value={fmtN(d.sales_calls_booked)} />
          <MetricRow label="Demos Shown" value={fmtN(d.sales_calls_shown)} />
          <MetricRow label="Demo Show Rate" value={demoShowRate > 0 ? fmtPct(demoShowRate) : "—"} />
          <MetricRow label="CP Demo" value={cpDemo > 0 ? fmt$(cpDemo) : "—"} />
          <MetricRow label="Close Rate" value={closeRate > 0 ? fmtPct(closeRate) : "—"} />
        </SectionCard>
      );
    } else {
      const c = (entity as { kind: "client"; client: ClientDrawerData; startDate: string; endDate: string }).client;
      return (
        <SectionCard title="Appointments" badge={<HealthPill v={kpiVerdict("cp_appt", c.cp_appt)} />}>
          <MetricRow label="Booked" value={fmtN(c.appts)} />
          <MetricRow label="Shown" value={fmtN(c.shows)} />
          <MetricRow label="No Show" value={fmtN(c.no_shows)} />
          {/* Cancellations aren't ingested — appointment-status only accepts
              show/no_show — so this stays blank rather than showing a false 0. */}
          <MetricRow label="Cancelled" value="—" />
          <MetricRow label="Show Rate" value={c.appts > 0 ? fmtPct(c.show_rate) : "—"} />
          <MetricRow label="Close Rate" value={c.close_rate > 0 ? fmtPct(c.close_rate) : "—"} />
          <MetricRow label="CP Appt" value={c.cp_appt > 0 ? fmtDec(c.cp_appt) : "—"} />
        </SectionCard>
      );
    }
  };

  const renderSummary = () => {
    const bottleneck = isBb
      ? (() => {
          const d = entity.data;
          if (!d.leads) return "No Data";
          const cbr = d.leads > 0 ? d.intros_booked / d.leads : 0;
          const showRate = d.intros_booked > 0 ? d.intros_shown / d.intros_booked : 0;
          const closeRate = d.sales_calls_shown > 0 ? d.closes / d.sales_calls_shown : 0;
          if (d.leads === 0) return "Targeting";
          if (cbr < 0.05) return "Funnel";
          if (showRate < 0.5) return "Post-Funnel";
          if (closeRate < 0.2) return "Post-Funnel";
          return "Healthy";
        })()
      : (entity as { kind: "client"; client: ClientDrawerData; startDate: string; endDate: string }).client.bottleneck;

    const action = isBb
      ? (() => {
          if (bottleneck === "Funnel") return "Low booking rate — improve follow-up sequence";
          if (bottleneck === "Post-Funnel") return "Low show/close rate — review reminders & sales";
          if (bottleneck === "Targeting") return "No leads — review audience & creative";
          if (bottleneck === "Healthy") return "All stages performing well";
          return "No events yet";
        })()
      : (entity as { kind: "client"; client: ClientDrawerData; startDate: string; endDate: string }).client.action;

    const bnColor = BOTTLENECK_COLOR[bottleneck] ?? "#6b6b6b";

    const resultRows = isBb
      ? (() => {
          const d = entity.data;
          return [
            { label: "Closes",               value: fmtN(d.closes)                                                        },
            { label: "Cash Collected",        value: d.cash_collected > 0 ? fmt$(d.cash_collected) : "—"                  },
            { label: "Cost per Acquisition",  value: d.closes > 0 ? fmt$(d.ad_spend / d.closes) : "—"                     },
          ];
        })()
      : [];

    // Client summary scores each KPI against its absolute target (lib/kpi-targets)
    // rather than against the portfolio average, so it answers "is this good
    // enough" rather than "who is worst".
    const kpiRows: { key: KpiKey; value: number; display: string }[] = isBb ? [] : (() => {
      const c = (entity as { kind: "client"; client: ClientDrawerData; startDate: string; endDate: string }).client;
      return [
        { key: "cpl"     as KpiKey, value: c.cpl,     display: c.cpl > 0 ? fmtDec(c.cpl) : "—" },
        { key: "cp_appt" as KpiKey, value: c.cp_appt, display: c.cp_appt > 0 ? fmtDec(c.cp_appt) : "—" },
        { key: "l2a_pct" as KpiKey, value: c.l2a_pct, display: c.l2a_pct > 0 ? fmtPct(c.l2a_pct) : "—" },
        { key: "ctr"     as KpiKey, value: c.ctr,     display: c.ctr > 0 ? fmtPct(c.ctr) : "—" },
        { key: "cvr"     as KpiKey, value: c.cvr,     display: c.cvr > 0 ? fmtPct(c.cvr) : "—" },
        { key: "cpc"     as KpiKey, value: c.cpc,     display: c.cpc > 0 ? fmtDec(c.cpc) : "—" },
      ];
    })();

    const overall = isBb ? null : overallVerdict(
      Object.fromEntries(kpiRows.map(r => [r.key, r.value])) as Partial<Record<KpiKey, number>>
    );

    return (
      <SectionCard title="Overall Summary"
        badge={overall
          ? <HealthPill v={overall} />
          : <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold" style={{ color: st.color, background: st.bg }}>{st.label}</span>}>
        {resultRows.map(r => <MetricRow key={r.label} label={r.label} value={r.value} />)}
        {kpiRows.map(r => {
          const v = kpiVerdict(r.key, r.value);
          const t = KPI_TARGETS[r.key];
          return (
            <div key={r.key} className="flex items-center justify-between py-[3px] text-xs">
              <span style={{ color: "#6b6b6b" }}>{t.label}</span>
              <span className="flex items-center gap-1.5">
                <span style={{ color: "#111111" }}>{r.display}</span>
                <span title={`Target ${t.lowerIsBetter ? "≤" : "≥"} ${t.target}`}
                  style={{ width: 6, height: 6, borderRadius: "50%", background: VERDICT_STYLE[v].color, display: "inline-block" }} />
              </span>
            </div>
          );
        })}
        <div className="mt-2 pt-2" style={{ borderTop: "1px solid rgba(0,0,0,0.081)" }}>
          <div className="flex items-center gap-2 mb-1.5">
            <span className="text-[10px] uppercase font-bold" style={{ color: "#767676" }}>Bottleneck</span>
            <span className="px-2 py-0.5 rounded text-[10px] font-semibold" style={{ color: bnColor, background: `${bnColor}22` }}>{bottleneck}</span>
          </div>
          <p className="text-xs" style={{ color: "#767676" }}>{action}</p>
        </div>
      </SectionCard>
    );
  };

  // ── Tab content renderers ──────────────────────────────────────────
  const renderCalls = () => {
    if (isBb) return renderPlaceholder("Not Tracked Here", "Call performance is tracked per client, not on B2B campaigns.");
    if (callLoading) return <div className="py-10 text-center text-sm" style={{ color: "#949494" }}>Loading call performance…</div>;
    if (!callKpis || !callKpis.outbound_dials) return renderPlaceholder(
      "No Call Data",
      "No dials recorded for this client in this date range."
    );

    const tiles = [
      { label: "Dials",          value: fmtN(callKpis.outbound_dials) },
      { label: "Pickups",        value: fmtN(callKpis.pickups),       sub: `${callKpis.pickup_pct.toFixed(1)}% of dials` },
      { label: "Conversations",  value: fmtN(callKpis.conversations), sub: `${callKpis.conversation_pct.toFixed(1)}% of pickups` },
      { label: "Speed to Lead",  value: callKpis.speed_to_lead_min > 0 ? `${callKpis.speed_to_lead_min.toFixed(1)}m` : "—" },
      { label: "Dials / Lead",   value: callKpis.dials_per_lead > 0 ? callKpis.dials_per_lead.toFixed(1) : "—" },
    ];

    return (
      <div className="space-y-4">
        <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}>
          {tiles.map(t => (
            <div key={t.label} className="rounded-2xl px-3 py-2.5"
              style={{ background: "#fafafa", border: "1px solid rgba(0,0,0,0.07)", boxShadow: "0 1px 2px rgba(0,0,0,0.03), 0 10px 28px -12px rgba(0,0,0,0.10)" }}>
              <div className="text-[10px] font-bold uppercase tracking-wider" style={{ color: "#767676" }}>{t.label}</div>
              <div className="text-lg font-bold mt-0.5" style={{ color: "#111111" }}>{t.value}</div>
              {t.sub && <div className="text-[10px] mt-0.5" style={{ color: "#767676" }}>{t.sub}</div>}
            </div>
          ))}
        </div>

        {agentCalls && agentCalls.length > 0 && (
          <div className="rounded-2xl overflow-x-auto" style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.07)", boxShadow: "0 1px 2px rgba(0,0,0,0.03), 0 10px 28px -12px rgba(0,0,0,0.10)" }}>
            <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
              <thead style={{ background: "#fafafa", borderBottom: "1px solid rgba(0,0,0,0.095)" }}>
                <tr>
                  <th className="text-left px-3 py-2 text-[10px] font-bold uppercase tracking-wider" style={{ color: "#767676" }}>Agent</th>
                  {["Dials", "Pickups", "Pickup %", "Convos", "Convo %", "Appts", "Shows"].map(h => (
                    <th key={h} className={COL_HEADER} style={{ color: "#767676" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {agentCalls.map((a, i) => (
                  <tr key={a.agent_name || i} style={{ borderTop: "1px solid rgba(0,0,0,0.054)" }}>
                    <td className="px-3 py-2.5 text-xs font-medium" style={{ color: "#111111" }}>{a.agent_name || "Unattributed"}</td>
                    <td className={COL_CELL} style={{ color: "#4a4a4a" }}>{fmtN(a.dials)}</td>
                    <td className={COL_CELL} style={{ color: "#4a4a4a" }}>{fmtN(a.pickups)}</td>
                    <td className={COL_CELL} style={{ color: "#4a4a4a" }}>{a.pickup_rate}%</td>
                    <td className={COL_CELL} style={{ color: "#4a4a4a" }}>{fmtN(a.conversations)}</td>
                    <td className={COL_CELL} style={{ color: "#4a4a4a" }}>{a.conversation_rate}%</td>
                    <td className={COL_CELL} style={{ color: "#111111" }}>{fmtN(a.appointments)}</td>
                    <td className={COL_CELL} style={{ color: "#4a4a4a" }}>{fmtN(a.shows)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  };

  const renderCampaigns = () => {
    const camps = isBb
      ? entity.data.campaigns
      : (entity as { kind: "client"; client: ClientDrawerData; startDate: string; endDate: string }).client.campaigns;

    if (!camps.length) return (
      <div className="text-center py-16 text-sm" style={{ color: "#949494" }}>No campaign data for this period</div>
    );

    return (
      <div>
        {!isBb && (
          <p className="text-xs mb-2" style={{ color: "#767676" }}>
            Untick a campaign to stop tracking it. Its spend is removed from this client&apos;s
            dashboard KPIs and shared report — useful when an ad account carries campaigns
            for more than one company.
          </p>
        )}
      <div className="rounded-2xl overflow-x-auto" style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.07)", boxShadow: "0 1px 2px rgba(0,0,0,0.03), 0 10px 28px -12px rgba(0,0,0,0.10)" }}>
        <table className="w-full text-sm" style={{ minWidth: 1260 }}>
          <thead>
            <tr style={{ background: "#fafafa", color: "#6b6b6b" }}>
              {!isBb && <th className="text-center font-medium px-3 py-3">Tracked</th>}
              <th className="text-left font-medium px-4 py-3">Campaign</th>
              {!isBb && <th className="text-left font-medium px-3 py-3">Platform</th>}
              {!isBb && <th className="text-left font-medium px-3 py-3">Status</th>}
              {METRIC_COLS.map(c => (
                <th key={c} className={COL_HEADER} style={{ color: "#6b6b6b" }}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {camps.map((c, i) => {
              const ctr = "ctr" in c ? c.ctr : null;
              const cpc = "cpc" in c ? c.cpc : null;
              const cpm = "cpm" in c && typeof (c as { cpm?: number | null }).cpm !== "undefined" ? (c as { cpm?: number | null }).cpm : null;
              const campName = "campaign_name" in c && c.campaign_name ? c.campaign_name : ("name" in c ? (c as { name: string }).name : c.campaign_id);
              const platform = "platform" in c ? (c as { platform: string }).platform : null;
              const campStatus = "status" in c ? (c as { status: string | null }).status : null;
              const tracked = isBb
                ? true
                : trackOverrides[c.campaign_id] ?? !(c as { excluded?: boolean }).excluded;
              return (
                <tr key={i} style={{ borderTop: "1px solid rgba(0,0,0,0.054)", opacity: tracked ? 1 : 0.45 }}>
                  {!isBb && (
                    <td className="px-3 py-3 text-center">
                      <input
                        type="checkbox"
                        checked={tracked}
                        disabled={savingCampaign === c.campaign_id}
                        onChange={e => toggleTracked(c.campaign_id, e.target.checked)}
                        style={{ accentColor: "#000000", width: 15, height: 15, cursor: "pointer" }}
                        title={tracked ? "Tracked — counted in all metrics" : "Not tracked — excluded from all metrics"}
                      />
                    </td>
                  )}
                  <td className="px-4 py-3 font-medium" style={{ color: "#111111", maxWidth: 240 }}>
                    <span className="truncate block">{campName}</span>
                  </td>
                  {!isBb && platform && (
                    <td className="px-3 py-3">
                      <span className="text-xs px-1.5 py-0.5 rounded" style={{ background: "rgba(0,0,0,0.09)", color: "#4a4a4a" }}>
                        {PLATFORM_LABEL[platform] ?? platform}
                      </span>
                    </td>
                  )}
                  {!isBb && <td className="px-3 py-3 text-xs" style={{ color: "#6b6b6b" }}>{campStatus ?? "—"}</td>}
                  {renderMetricCells({
                    ...(c as unknown as AdMetrics),
                    ctr: ctr ?? 0, cpc: cpc ?? 0, cpm: cpm ?? 0,
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      </div>
    );
  };

  const renderPlaceholder = (title: string, msg: string) => (
    <div className="rounded-2xl p-8 text-center" style={{ background: "#fafafa", border: "1px solid rgba(0,0,0,0.07)", boxShadow: "0 1px 2px rgba(0,0,0,0.03), 0 10px 28px -12px rgba(0,0,0,0.10)" }}>
      <p className="text-sm font-medium mb-1" style={{ color: "#767676" }}>{title}</p>
      <p className="text-xs" style={{ color: "#949494" }}>{msg}</p>
    </div>
  );

  const renderFunnel = () => {
    const topCount = funnelStages[0]?.count ?? 1;
    // A single ramp, darkest at the top of the funnel — the old per-stage
    // colours were an unordered mix of greys with a stray lime.
    const shade = (i: number, n: number) => {
      const from = 17, to = 176;                     // #111111 -> #b0b0b0
      const v = Math.round(from + ((to - from) * i) / Math.max(n - 1, 1));
      return `rgb(${v}, ${v}, ${v})`;
    };
    const stages = funnelStages.map((s, i) => ({
      ...s,
      color: shade(i, funnelStages.length),
      widthPct: topCount > 0 ? Math.max((s.count / topCount) * 100, s.count > 0 ? 4 : 0) : 0,
    }));
    return (
      <div className="rounded-2xl p-6" style={{ background: "#fafafa", border: "1px solid rgba(0,0,0,0.07)", boxShadow: "0 1px 2px rgba(0,0,0,0.03), 0 10px 28px -12px rgba(0,0,0,0.10)" }}>
        <h3 className="text-xs font-bold uppercase tracking-widest mb-6" style={{ color: "#767676" }}>Conversion Funnel</h3>
        <div className="space-y-1">
          {stages.map((s, i) => (
            <div key={i}>
              <FunnelStage label={s.label} count={s.count} pct={s.widthPct} color={s.color} />
              {i < stages.length - 1 && stages[i + 1].count > 0 && (
                <div className="flex items-center gap-3 mb-2 ml-28 pl-3">
                  <div className="h-4 border-l" style={{ borderColor: "rgba(0,0,0,0.081)" }} />
                  <span className="text-[10px]" style={{ color: "#949494" }}>
                    {s.count > 0 ? `${((stages[i + 1].count / s.count) * 100).toFixed(1)}% conversion` : "—"}
                  </span>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderComparison = () => {
    if (!compData.length) return (
      <div className="flex items-center justify-center py-10 text-sm" style={{ color: "#949494" }}>Loading comparison data…</div>
    );
    const baseline = compData[1];
    const rowKeys = compData[0]?.data ? Object.keys(compData[0].data) : [];
    return (
      <div className="rounded-2xl overflow-hidden" style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.07)", boxShadow: "0 1px 2px rgba(0,0,0,0.03), 0 10px 28px -12px rgba(0,0,0,0.10)" }}>
        <div className="grid" style={{ gridTemplateColumns: "repeat(3, 1fr)" }}>
          {compData.map((period, pi) => (
            <div key={pi} style={{ borderRight: pi < 2 ? "1px solid rgba(0,0,0,0.095)" : "none" }}>
              <div className="px-4 py-3" style={{ background: pi === 1 ? "rgba(0,0,0,0.048)" : "#fafafa", borderBottom: "1px solid rgba(0,0,0,0.095)" }}>
                <div className="text-xs font-bold" style={{ color: pi === 1 ? "#4a4a4a" : "#4a4a4a" }}>{period.label}</div>
                <div className="text-[10px]" style={{ color: "#949494" }}>{period.start} → {period.end}</div>
              </div>
              {rowKeys.map(key => (
                <CompCell key={key} label={key} value={period.data[key] ?? null}
                  baseline={baseline.data[key] ?? null} isBaseline={pi === 1} loading={period.loading} />
              ))}
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderAI = () => (
    <div className="flex flex-col h-full" style={{ minHeight: 400 }}>
      <div className="flex-1 overflow-y-auto p-4 space-y-1" style={{ minHeight: 300 }}>
        {messages.length === 0 && (
          <div className="text-center py-10">
            <div className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3" style={{ background: "rgba(0,0,0,0.09)", border: "1px solid rgba(0,0,0,0.18)" }}>
              <svg className="w-6 h-6" fill="none" stroke="#4a4a4a" strokeWidth={1.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
              </svg>
            </div>
            <p className="text-sm font-medium mb-1" style={{ color: "#6b6b6b" }}>Ask about {name}</p>
            <p className="text-xs" style={{ color: "#949494" }}>The AI has full context about this {isBb ? "campaign" : "client"}'s metrics.</p>
            <div className="mt-4 flex flex-wrap gap-2 justify-center">
              {["What's the main bottleneck?", "How can we improve CVR?", "What should we optimize first?"].map(s => (
                <button key={s} onClick={() => setInput(s)}
                  className="px-3 py-1.5 rounded-lg text-xs"
                  style={{ background: "rgba(0,0,0,0.072)", border: "1px solid rgba(0,0,0,0.15)", color: "#93c5fd" }}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => <ChatBubble key={i} msg={m} />)}
        {aiLoading && (
          <div className="flex justify-start">
            <div className="px-4 py-2.5 rounded-2xl" style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.07)", boxShadow: "0 1px 2px rgba(0,0,0,0.03), 0 10px 28px -12px rgba(0,0,0,0.10)" }}>
              <div className="flex gap-1">
                {[0, 1, 2].map(i => (
                  <div key={i} className="w-1.5 h-1.5 rounded-full animate-bounce" style={{ background: "#767676", animationDelay: `${i * 0.15}s` }} />
                ))}
              </div>
            </div>
          </div>
        )}
        {aiError && <div className="text-xs rounded-lg px-3 py-2 mt-2" style={{ background: "rgba(192,57,43,0.08)", border: "1px solid rgba(192,57,43,0.2)", color: "#d98b82" }}>{aiError}</div>}
        <div ref={chatEndRef} />
      </div>
      <div className="p-4 flex gap-2" style={{ borderTop: "1px solid rgba(0,0,0,0.095)" }}>
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), sendMessage())}
          placeholder={`Ask about ${name}…`}
          className="flex-1 px-3 py-2 rounded-lg text-sm outline-none"
          style={{ background: "#fafafa", border: "1px solid rgba(0,0,0,0.162)", color: "#111111" }}
        />
        <button onClick={sendMessage} disabled={aiLoading || !input.trim()}
          className="px-4 py-2 rounded-lg text-sm font-semibold transition-opacity"
          style={{ background: "rgba(0,0,0,0.12)", border: "1px solid rgba(0,0,0,0.21)", color: "#93c5fd", opacity: aiLoading || !input.trim() ? 0.5 : 1 }}>
          Send
        </button>
      </div>
    </div>
  );

  const COL_HEADER = "text-[9px] font-bold uppercase text-right px-1.5 py-2 whitespace-nowrap";
  const COL_CELL   = "text-right px-1.5 py-2.5 text-[11px] whitespace-nowrap tabular-nums";

  // ── Shared metric table for Ad Sets / Ads ───────────────────────────
  // Column set requested for Meta reporting: budget, spend, impressions, reach,
  // frequency, CPM, unique link clicks, unique CTR, CPC, results (leads), CVR
  // (leads / unique link clicks) and cost per result.
  // Two groups: the attributed CRM funnel first (what the ad actually produced),
  // then Meta's own delivery metrics. "Meta Results" is Meta's reported result
  // count and is intentionally kept separate from the CRM "Leads" column — they
  // measure different things and rarely agree.
  const METRIC_COLS = [
    "Budget", "Spend",
    "Leads", "Appts", "Shows", "Closes", "CPL", "CPA", "ROAS",
    "Impr.", "Reach", "Freq.", "CPM",
    "U.Clicks", "U.CTR", "CPC", "Results", "CVR", "C/Res.",
  ];

  const renderMetricCells = (m: AdMetrics) => {
    const freq = m.frequency ?? (m.reach > 0 ? m.impressions / m.reach : 0);
    const uClicks = m.unique_clicks;
    const uCtr = m.unique_ctr ?? (m.reach > 0 && uClicks ? (uClicks / m.reach) * 100 : undefined);
    const leads = m.leads;
    const cvr = m.cvr ?? (uClicks && leads !== undefined && uClicks > 0 ? (leads / uClicks) * 100 : undefined);
    const cpr = m.cost_per_result ?? (leads ? m.spend / leads : undefined);
    // Routes that predate the funnel join simply omit it; treat that as zeroes
    // rather than blowing up the row.
    const f = m.funnel ?? { leads: 0, appts: 0, shows: 0, no_shows: 0, closes: 0, revenue: 0 };
    const cpl  = m.cost_per_lead ?? (f.leads > 0 ? m.spend / f.leads : 0);
    const cpa  = m.cost_per_appt ?? (f.appts > 0 ? m.spend / f.appts : 0);
    const roas = m.roas ?? (m.spend > 0 ? f.revenue / m.spend : 0);
    const dash = <span style={{ color: "#949494" }}>—</span>;
    return (
      <>
        <td className={COL_CELL} style={{ color: "#4a4a4a" }}>{m.budget ? fmt$(m.budget) : dash}</td>
        <td className={COL_CELL} style={{ color: "#111111" }}>{fmt$(m.spend)}</td>

        <td className={COL_CELL} style={{ color: f.leads  ? "#111111" : "#949494" }}>{f.leads  ? fmtN(f.leads)  : dash}</td>
        <td className={COL_CELL} style={{ color: f.appts  ? "#111111" : "#949494" }}>{f.appts  ? fmtN(f.appts)  : dash}</td>
        <td className={COL_CELL} style={{ color: f.shows  ? "#111111" : "#949494" }}>{f.shows  ? fmtN(f.shows)  : dash}</td>
        <td className={COL_CELL} style={{ color: f.closes ? "#000000" : "#949494" }}>{f.closes ? fmtN(f.closes) : dash}</td>
        <td className={COL_CELL} style={{ color: "#4a4a4a" }}>{cpl  ? fmtDec(cpl)  : dash}</td>
        <td className={COL_CELL} style={{ color: "#4a4a4a" }}>{cpa  ? fmtDec(cpa)  : dash}</td>
        <td className={COL_CELL} style={{ color: roas ? "#000000" : "#949494" }}>{roas ? `${roas.toFixed(2)}x` : dash}</td>

        <td className={COL_CELL} style={{ color: "#4a4a4a" }}>{m.impressions > 0 ? fmtN(m.impressions) : dash}</td>
        <td className={COL_CELL} style={{ color: "#4a4a4a" }}>{m.reach > 0 ? fmtN(m.reach) : dash}</td>
        <td className={COL_CELL} style={{ color: "#4a4a4a" }}>{freq > 0 ? freq.toFixed(2) : dash}</td>
        <td className={COL_CELL} style={{ color: "#4a4a4a" }}>{m.cpm > 0 ? fmtDec(m.cpm) : dash}</td>
        <td className={COL_CELL} style={{ color: "#4a4a4a" }}>{uClicks ? fmtN(uClicks) : dash}</td>
        <td className={COL_CELL} style={{ color: "#4a4a4a" }}>{uCtr ? fmtPct(uCtr) : dash}</td>
        <td className={COL_CELL} style={{ color: "#4a4a4a" }}>{m.cpc > 0 ? fmtDec(m.cpc) : dash}</td>
        <td className={COL_CELL} style={{ color: "#111111" }}>{leads ? fmtN(leads) : dash}</td>
        <td className={COL_CELL} style={{ color: "#4a4a4a" }}>{cvr ? fmtPct(cvr) : dash}</td>
        <td className={COL_CELL} style={{ color: "#4a4a4a" }}>{cpr ? fmtDec(cpr) : dash}</td>
      </>
    );
  };

  const renderMetricTable = (
    label: string,
    rows: (AdSetRow | AdRow)[],
    nameOf: (r: AdSetRow | AdRow) => string,
    subOf: (r: AdSetRow | AdRow) => string | null,
    keyOf: (r: AdSetRow | AdRow, i: number) => string,
  ) => (
    <div className="rounded-2xl overflow-x-auto" style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.07)", boxShadow: "0 1px 2px rgba(0,0,0,0.03), 0 10px 28px -12px rgba(0,0,0,0.10)" }}>
      <table className="w-full text-sm" style={{ borderCollapse: "collapse", minWidth: 1180 }}>
        <thead style={{ background: "#fafafa", borderBottom: "1px solid rgba(0,0,0,0.095)" }}>
          <tr>
            <th className="text-left px-3 py-2 text-[10px] font-bold uppercase tracking-wider" style={{ color: "#767676" }}>{label}</th>
            {METRIC_COLS.map(c => (
              <th key={c} className={COL_HEADER} style={{ color: "#767676" }}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={keyOf(r, i)} style={{ borderTop: "1px solid rgba(0,0,0,0.054)" }}>
              <td className="px-3 py-2.5" style={{ maxWidth: 240 }}>
                <div className="text-xs font-medium truncate" style={{ color: "#111111" }}>{nameOf(r)}</div>
                {subOf(r) && <div className="text-[10px] mt-0.5 truncate" style={{ color: "#767676" }}>{subOf(r)}</div>}
              </td>
              {renderMetricCells(r)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  const renderAdSets = () => {
    if (adSetLoading) return <div className="py-10 text-center text-sm" style={{ color: "#949494" }}>Loading ad sets…</div>;
    if (!adSetData || adSetData.length === 0) return renderPlaceholder(
      "No Ad Set Data",
      isBb
        ? "Run the updated Make scenario to populate ad set data. It fetches adset-level insights from Meta daily."
        : "No ad set data found for this date range. Make sure your client Make scenario sends adset-level data."
    );
    return renderMetricTable(
      "Ad Set",
      adSetData,
      r => (r as AdSetRow).adset_name ?? (r as AdSetRow).adset_id,
      r => r.campaign_name ?? null,
      (r, i) => (r as AdSetRow).adset_id || String(i),
    );
  };

  const renderAds = () => {
    if (adLoading) return <div className="py-10 text-center text-sm" style={{ color: "#949494" }}>Loading ads…</div>;
    if (!adData || adData.length === 0) return renderPlaceholder(
      "No Ad Data",
      isBb
        ? "Run the updated Make scenario to populate ad-level data."
        : "No ad data found for this date range. Make sure your client Make scenario sends ad-level data."
    );
    return renderMetricTable(
      "Ad",
      adData,
      r => (r as AdRow).ad_name ?? (r as AdRow).ad_id,
      r => (r as AdRow).adset_name ?? r.campaign_name ?? null,
      (r, i) => (r as AdRow).ad_id || String(i),
    );
  };

  const renderRecordings = () => {
    if (isBb) return renderPlaceholder(
      "Not Tracked Here",
      "B2B call recordings are attributed to a CSM and live on the CSM dashboard, not the campaign drawer."
    );
    if (recLoading) return <div className="py-10 text-center text-sm" style={{ color: "#949494" }}>Loading recordings…</div>;
    if (!recData || recData.length === 0) return renderPlaceholder(
      "No Recordings",
      "No call recordings for this client in this date range. Recordings appear once the GHL dial workflow passes a recording URL through to the webhook."
    );

    const mmss = (sec: number | null) => {
      if (!sec && sec !== 0) return "—";
      return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
    };
    const outcomeOf = (r: RecordingRow) =>
      r.is_conversation ? { label: "Conversation", color: "#000000" }
      : r.is_pickup     ? { label: "Pickup",       color: "#eab308" }
      :                   { label: "No Answer",    color: "#767676" };

    return (
      <div className="rounded-2xl overflow-x-auto" style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.07)", boxShadow: "0 1px 2px rgba(0,0,0,0.03), 0 10px 28px -12px rgba(0,0,0,0.10)" }}>
        <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
          <thead style={{ background: "#fafafa", borderBottom: "1px solid rgba(0,0,0,0.095)" }}>
            <tr>
              <th className="text-left px-3 py-2 text-[10px] font-bold uppercase tracking-wider" style={{ color: "#767676" }}>Lead</th>
              <th className="text-left px-3 py-2 text-[10px] font-bold uppercase tracking-wider" style={{ color: "#767676" }}>Agent</th>
              <th className={COL_HEADER} style={{ color: "#767676" }}>Duration</th>
              <th className="text-left px-3 py-2 text-[10px] font-bold uppercase tracking-wider" style={{ color: "#767676" }}>Outcome</th>
              <th className="text-left px-3 py-2 text-[10px] font-bold uppercase tracking-wider" style={{ color: "#767676" }}>Recording</th>
            </tr>
          </thead>
          <tbody>
            {recData.map((r, i) => {
              const o = outcomeOf(r);
              return (
                <tr key={r.id || i} style={{ borderTop: "1px solid rgba(0,0,0,0.054)" }}>
                  <td className="px-3 py-2.5">
                    <div className="text-xs font-medium" style={{ color: "#111111" }}>{r.lead_name ?? r.lead_phone ?? "Unknown"}</div>
                    <div className="text-[10px] mt-0.5" style={{ color: "#767676" }}>
                      {new Date(r.occurred_at).toLocaleString()}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-xs" style={{ color: "#4a4a4a" }}>{r.agent_name ?? "—"}</td>
                  <td className={COL_CELL} style={{ color: "#4a4a4a" }}>{mmss(r.duration_seconds)}</td>
                  <td className="px-3 py-2.5">
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                      style={{ color: o.color, background: `${o.color}1a`, border: `1px solid ${o.color}33` }}>
                      {o.label}
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <audio controls preload="none" src={r.recording_url} style={{ height: 32, maxWidth: 260 }} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  const tabContent: Record<Tab, React.ReactNode> = {
    calls:      renderCalls(),
    campaigns:  renderCampaigns(),
    adsets:     renderAdSets(),
    ads:        renderAds(),
    recordings: renderRecordings(),
    funnel:     renderFunnel(),
    comparison: renderComparison(),
    ai:         renderAI(),
  };

  // Inline expansion panel — no overlay, renders directly in page flow inside a table <td>
  return (
    <div style={{ background: "#ffffff", borderTop: "2px solid #000000" }}>
      {/* ── Identity + Status bar ── */}
      <div className="px-5 py-2.5 flex items-center justify-between flex-wrap gap-2" style={{ borderBottom: "1px solid rgba(0,0,0,0.081)", background: "#fafafa" }}>
        <div className="flex items-center gap-3">
          <button onClick={onClose} className="p-1 rounded" style={{ color: "#767676" }}
            onMouseEnter={e => (e.currentTarget.style.color = "#4a4a4a")}
            onMouseLeave={e => (e.currentTarget.style.color = "#767676")}>
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
          <span className="font-bold text-sm" style={{ color: "#000000" }}>{name}</span>
          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase"
            style={{ color: st.color, background: st.bg, border: `1px solid ${st.color}44` }}>
            {st.label}
          </span>
          <div className="flex items-center gap-1.5 ml-2">
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: "#000000", boxShadow: "0 0 5px #000000" }} />
            <span className="text-[11px] font-semibold" style={{ color: "#000000" }}>Live</span>
          </div>
          <span className="text-[11px]" style={{ color: "#949494" }}>
            Updated <span style={{ color: "#6b6b6b" }}>{relativeTime(lastUpdated)}</span>
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[11px] px-2 py-1 rounded font-medium" style={{ background: "#ffffff", border: "1px solid rgba(0,0,0,0.108)", color: "#6b6b6b" }}>
            {entity.startDate} → {entity.endDate}
          </span>
          <button
            onClick={() => { if (tab === "comparison") fetchComparison(); }}
            className="flex items-center gap-1 px-2.5 py-1 rounded text-[11px] font-semibold"
            style={{ background: "rgba(0,0,0,0.072)", border: "1px solid rgba(0,0,0,0.15)", color: "#4a4a4a" }}>
            <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Refresh Data
          </button>
          <button className="p-1 rounded" style={{ background: "#ffffff", color: "#949494", border: "1px solid rgba(0,0,0,0.06)", boxShadow: "0 1px 2px rgba(0,0,0,0.03), 0 10px 28px -12px rgba(0,0,0,0.10)" }}>
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
            </svg>
          </button>
        </div>
      </div>

      {/* ── 4-quadrant overview ── */}
      <div className="px-5 py-4 grid grid-cols-2 lg:grid-cols-4 gap-3" style={{ borderBottom: "1px solid rgba(0,0,0,0.081)" }}>
        {renderLeadGen()}
        {renderCallPerf()}
        {renderAppts()}
        {renderSummary()}
      </div>

      {/* ── Tab bar ── */}
      <div className="flex items-center gap-0 px-5 overflow-x-auto" style={{ borderBottom: "1px solid rgba(0,0,0,0.095)", background: "#ffffff" }}>
        {TABS.filter(t => !(isBb && t.id === "recordings")).map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className="px-4 py-2.5 text-xs font-semibold whitespace-nowrap transition-colors"
            style={{
              color: tab === t.id ? "#000000" : "#767676",
              borderBottom: tab === t.id ? "2px solid #000000" : "2px solid transparent",
              background: "transparent",
            }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Tab content (max-height so it doesn't push page too far) ── */}
      <div className="p-5 overflow-y-auto" style={{ maxHeight: 480 }}>
        {tab === "ai" ? renderAI() : tabContent[tab]}
      </div>
    </div>
  );
}
