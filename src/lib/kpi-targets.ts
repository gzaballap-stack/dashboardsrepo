// Absolute KPI targets, set by the business rather than derived from the
// dataset. campaign-overview's `diagnose` compares clients against portfolio
// averages, which answers "who is worst"; these answer "is this good enough".
export const KPI_TARGETS = {
  cpl:      { target: 65,  lowerIsBetter: true,  label: 'Cost per Lead' },
  cp_appt:  { target: 200, lowerIsBetter: true,  label: 'Cost per Appt' },
  l2a_pct:  { target: 40,  lowerIsBetter: false, label: 'Lead → Appt' },
  ctr:      { target: 1,   lowerIsBetter: false, label: 'CTR' },
  cpc:      { target: 2,   lowerIsBetter: true,  label: 'CPC' },
  // Not specified by the business; 10% of clicks converting to a lead is a
  // reasonable floor for these funnels. Adjust here if it proves wrong.
  cvr:      { target: 10,  lowerIsBetter: false, label: 'CVR' },
} as const;

export type KpiKey = keyof typeof KPI_TARGETS;
export type KpiVerdict = 'excellent' | 'on_target' | 'off_target' | 'critical' | 'no_data';

export const VERDICT_STYLE: Record<KpiVerdict, { label: string; color: string }> = {
  excellent:  { label: 'Excellent',  color: '#000000' },
  on_target:  { label: 'On Target',  color: '#6b6b6b' },
  off_target: { label: 'Off Target', color: '#000000' },
  critical:   { label: 'Critical',   color: '#c0392b' },
  no_data:    { label: 'No Data',    color: '#767676' },
};

// Ratio of actual to target, normalised so >1 is always better.
export function kpiRatio(key: KpiKey, value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value) || value <= 0) return null;
  const { target, lowerIsBetter } = KPI_TARGETS[key];
  return lowerIsBetter ? target / value : value / target;
}

export function kpiVerdict(key: KpiKey, value: number | null | undefined): KpiVerdict {
  const r = kpiRatio(key, value);
  if (r == null) return 'no_data';
  if (r >= 1.25) return 'excellent';
  if (r >= 1)    return 'on_target';
  if (r >= 0.75) return 'off_target';
  return 'critical';
}

// One verdict for the whole account: any critical dominates, otherwise the
// weakest of what's measurable.
export function overallVerdict(values: Partial<Record<KpiKey, number | null>>): KpiVerdict {
  const verdicts = (Object.keys(KPI_TARGETS) as KpiKey[])
    .map(k => kpiVerdict(k, values[k]))
    .filter(v => v !== 'no_data');
  if (!verdicts.length) return 'no_data';
  if (verdicts.includes('critical'))   return 'critical';
  if (verdicts.includes('off_target')) return 'off_target';
  if (verdicts.every(v => v === 'excellent')) return 'excellent';
  return 'on_target';
}

// Call health from answer rate and conversation rate, which is what actually
// tells you whether the calling operation is working.
export function callHealth(answerRate: number, conversationRate: number, dials: number): KpiVerdict {
  if (!dials) return 'no_data';
  if (answerRate >= 35 && conversationRate >= 12) return 'excellent';
  if (answerRate >= 25 && conversationRate >= 8)  return 'on_target';
  if (answerRate >= 15)                            return 'off_target';
  return 'critical';
}

// ── B2B (Tomsi Media's own funnel) ───────────────────────────────────────────
// Separate targets, set by the owner on 2026-09-30. Nothing above this line is
// touched by the B2B views and nothing below is read by the client views.
export const B2B_KPI_TARGETS = {
  cpl:                { target: 70,  lowerIsBetter: true,  label: 'Cost per Lead',     unit: '$' },
  cp_demo:            { target: 90,  lowerIsBetter: true,  label: 'Cost per Demo',     unit: '$' },
  ctr:                { target: 1,   lowerIsBetter: false, label: 'CTR',               unit: '%' },
  cpc:                { target: 2.5, lowerIsBetter: true,  label: 'CPC',               unit: '$' },
  landing_to_booking: { target: 5,   lowerIsBetter: false, label: 'Landing → Booking', unit: '%' },
} as const;

export type B2bKpiKey = keyof typeof B2B_KPI_TARGETS;
// `hold` = not enough leads yet to judge.
export type B2bState = KpiVerdict | 'hold';

export const B2B_STATE_STYLE: Record<B2bState, { label: string; color: string; bg: string }> = {
  excellent:  { label: 'Excellent',  color: '#15803d', bg: 'rgba(21,128,61,0.10)'  },
  on_target:  { label: 'On Target',  color: '#0369a1', bg: 'rgba(3,105,161,0.10)'  },
  off_target: { label: 'Off Target', color: '#b45309', bg: 'rgba(180,83,9,0.10)'   },
  critical:   { label: 'Critical',   color: '#b91c1c', bg: 'rgba(185,28,28,0.10)'  },
  hold:       { label: 'Hold',       color: '#6d28d9', bg: 'rgba(109,40,217,0.10)' },
  no_data:    { label: 'No Data',    color: '#6b6b6b', bg: 'rgba(0,0,0,0.06)'      },
};

// Below this many leads a cost-per figure is noise, not a verdict.
export const B2B_MIN_LEADS = 5;

export function b2bKpiRatio(key: B2bKpiKey, value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value) || value <= 0) return null;
  const { target, lowerIsBetter } = B2B_KPI_TARGETS[key];
  return lowerIsBetter ? target / value : value / target;
}

export function b2bKpiVerdict(key: B2bKpiKey, value: number | null | undefined): KpiVerdict {
  const r = b2bKpiRatio(key, value);
  if (r == null) return 'no_data';
  if (r >= 1.25) return 'excellent';
  if (r >= 1)    return 'on_target';
  if (r >= 0.75) return 'off_target';
  return 'critical';
}

export function b2bTargetText(key: B2bKpiKey): string {
  const t = B2B_KPI_TARGETS[key];
  const n = t.unit === '$' ? `$${t.target}` : `${t.target}%`;
  return `${t.lowerIsBetter ? '≤' : '≥'} ${n}`;
}

// One state for a whole account / campaign / ad set / ad. Any critical KPI
// dominates, then any off-target one; Excellent needs every measurable KPI to
// be excellent.
export function b2bState(
  values: Partial<Record<B2bKpiKey, number | null>>,
  ctx: { leads: number; spend: number },
): B2bState {
  if (!ctx.spend && !ctx.leads) return 'no_data';
  if (ctx.leads < B2B_MIN_LEADS) {
    // Too few leads to judge — unless it has already spent twice the lead
    // target and its cost per lead so far sits in the critical band. An ad that
    // burned $187 for zero leads is not "still gathering signal".
    const cplSoFar = ctx.spend / Math.max(ctx.leads, 1);
    const burned = ctx.spend >= 2 * B2B_KPI_TARGETS.cpl.target && cplSoFar > B2B_KPI_TARGETS.cpl.target / 0.75;
    return burned ? 'critical' : 'hold';
  }
  const verdicts = (Object.keys(B2B_KPI_TARGETS) as B2bKpiKey[])
    .map(k => b2bKpiVerdict(k, values[k]))
    .filter(v => v !== 'no_data');
  if (!verdicts.length) return 'no_data';
  if (verdicts.includes('critical'))   return 'critical';
  if (verdicts.includes('off_target')) return 'off_target';
  if (verdicts.every(v => v === 'excellent')) return 'excellent';
  return 'on_target';
}

// The KPI furthest from its target, for the "what to fix first" line.
export function b2bWorstKpi(values: Partial<Record<B2bKpiKey, number | null>>): { key: B2bKpiKey; ratio: number } | null {
  let worst: { key: B2bKpiKey; ratio: number } | null = null;
  for (const k of Object.keys(B2B_KPI_TARGETS) as B2bKpiKey[]) {
    const r = b2bKpiRatio(k, values[k]);
    if (r == null) continue;
    if (!worst || r < worst.ratio) worst = { key: k, ratio: r };
  }
  return worst;
}
