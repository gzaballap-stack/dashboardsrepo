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
  excellent:  { label: 'Excellent',  color: '#4ade80' },
  on_target:  { label: 'On Target',  color: '#22d3ee' },
  off_target: { label: 'Off Target', color: '#f59e0b' },
  critical:   { label: 'Critical',   color: '#f87171' },
  no_data:    { label: 'No Data',    color: '#475569' },
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
