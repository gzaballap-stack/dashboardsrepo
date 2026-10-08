// Revenue-goal math for the sales-call "Custom Area Breakdown" doc.
//
// Three numbers come off the GHL contact (average job, current revenue, revenue
// goal); everything else is derived here so nobody does it on a calculator
// mid-call. Every output is a flat string, one per {{tag}} in the Google Docs
// template, so Make maps them straight across.

export const GOAL_TAGS = [
  'average_job', 'current_revenue', 'revenue_goal', 'revenue_gap',
  'jobs_needed', 'appointments_needed', 'close_rate',
] as const;
export type GoalTag = typeof GOAL_TAGS[number];

export const DEFAULT_CLOSE_RATE = 0.3;

// "$1,250,000", "1.2m", "500k", "35%", "0.35" → number (or null when blank/junk)
export function parseAmount(raw: unknown): number | null {
  if (raw == null) return null;
  const s = String(raw).trim().toLowerCase().replace(/[$,\s]/g, '');
  if (!s) return null;
  const m = s.match(/^(-?\d+(?:\.\d+)?)(k|m|%)?$/);
  if (!m) return null;
  let n = parseFloat(m[1]);
  if (m[2] === 'k') n *= 1_000;
  if (m[2] === 'm') n *= 1_000_000;
  if (m[2] === '%') n /= 100;
  return Number.isFinite(n) ? n : null;
}

// Close rate may arrive as 30, "30%", or 0.3 — anything above 1 is a percentage.
export function parseRate(raw: unknown): number | null {
  const n = parseAmount(raw);
  if (n == null || n <= 0) return null;
  return n > 1 ? n / 100 : n;
}

export const money = (n: number) =>
  `$${Math.round(n).toLocaleString('en-US')}`;

export type GoalInputs = {
  average_job?: unknown;
  current_revenue?: unknown;
  revenue_goal?: unknown;
  close_rate?: unknown;
};

export type GoalResult = {
  complete: boolean;
  missing: string[];
  numbers: {
    average_job: number | null;
    current_revenue: number | null;
    revenue_goal: number | null;
    revenue_gap: number | null;
    jobs_needed: number | null;
    appointments_needed: number | null;
    close_rate: number;
  };
  // What goes into the doc. When an input is missing, its tag is handed back
  // untouched ("{{jobs_needed}}") so the placeholder survives the first merge
  // and a later "replace text" pass can still find it.
  doc: Record<GoalTag, string>;
};

export function computeGoals(input: GoalInputs): GoalResult {
  const average_job     = parseAmount(input.average_job);
  const current_revenue = parseAmount(input.current_revenue);
  const revenue_goal    = parseAmount(input.revenue_goal);
  const close_rate      = parseRate(input.close_rate) ?? DEFAULT_CLOSE_RATE;

  const missing: string[] = [];
  if (average_job == null || average_job <= 0) missing.push('average_job');
  if (current_revenue == null)                 missing.push('current_revenue');
  if (revenue_goal == null)                    missing.push('revenue_goal');
  const complete = missing.length === 0;

  const revenue_gap = complete ? Math.max(revenue_goal! - current_revenue!, 0) : null;
  const jobs_needed = complete ? Math.ceil(revenue_gap! / average_job!) : null;
  const appointments_needed = complete ? Math.ceil(jobs_needed! / close_rate) : null;

  const tag = (t: GoalTag) => `{{${t}}}`;
  const doc: Record<GoalTag, string> = {
    average_job:         average_job     != null ? money(average_job)     : tag('average_job'),
    current_revenue:     current_revenue != null ? money(current_revenue) : tag('current_revenue'),
    revenue_goal:        revenue_goal    != null ? money(revenue_goal)    : tag('revenue_goal'),
    revenue_gap:         revenue_gap     != null ? money(revenue_gap)     : tag('revenue_gap'),
    jobs_needed:         jobs_needed     != null ? String(jobs_needed)    : tag('jobs_needed'),
    appointments_needed: appointments_needed != null ? String(appointments_needed) : tag('appointments_needed'),
    close_rate:          `${Math.round(close_rate * 100)}%`,
  };

  return {
    complete, missing,
    numbers: { average_job, current_revenue, revenue_goal, revenue_gap, jobs_needed, appointments_needed, close_rate },
    doc,
  };
}

// Google Docs URL or bare id → id. Make stores the doc link on the contact; this
// saves it having to carve the id out with a formula.
export function parseDocId(raw: unknown): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const m = s.match(/\/d\/([a-zA-Z0-9_-]{20,})/);
  if (m) return m[1];
  return /^[a-zA-Z0-9_-]{20,}$/.test(s) ? s : null;
}
