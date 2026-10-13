// Which exercises the weekly log asks about.
//
// The list is derived, never stored as a copy. It comes from two places:
//
//   1. every exercise in whichever split programme is marked active
//   2. any name that already has numbers logged against it
//
// Which of the two applies depends on what's being drawn. A week you are filling
// in asks for (1), plus whatever that week already holds — the programme you're
// on, not a standing list. The Progress charts use both, so a lift keeps its
// history after it drops out of your programme.
//
// `lift_settings.exercises` was a third source, a list kept by hand. It is no
// longer read: it meant lifts you had stopped training reappeared on every new
// week. The column is left alone rather than dropped, so nothing logged under
// those names is lost.

// Reading a number a person typed.
//
// `Number("81,5")` is NaN, and a phone set to Spanish puts a comma on the
// decimal key — so a measurement typed on a phone parsed to nothing and was
// stored as null, silently. A comma is a decimal point here.
//
// The three outcomes are kept apart on purpose: blank means "not measured this
// week" and must still clear the field, while unparseable means the save should
// stop and say so rather than quietly discarding what was typed.
export type ParsedNumber =
  | { ok: true; value: number | null }
  | { ok: false };

export function parseDecimal(raw: unknown): ParsedNumber {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? { ok: true, value: raw } : { ok: false };
  }
  if (typeof raw !== 'string') return { ok: false };

  const text = raw.trim();
  if (!text) return { ok: true, value: null };

  const n = Number(text.replace(',', '.'));
  return Number.isFinite(n) ? { ok: true, value: n } : { ok: false };
}

type RawExercise = { name?: unknown };
type RawDay = { rest?: unknown; exercises?: unknown };
type RawProgramme = { id?: unknown; days?: unknown };
type RawSplit = { activeId?: unknown; programmes?: unknown };

// Case- and whitespace-insensitive, first spelling wins. "Lat Pulldown Row" and
// "lat pulldown row" are the same lift; two genuinely different names that merely
// look similar ("Incline DB Press" vs "Incline Dumbell") are not, and both survive.
export function mergeExerciseNames(...groups: (readonly string[] | null | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const group of groups) {
    for (const raw of group ?? []) {
      if (typeof raw !== 'string') continue;
      const name = raw.trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(name);
    }
  }
  return out;
}

// Exercise names from the active programme, in the order they are trained.
// Rest days contribute nothing.
export function activeProgrammeExercises(splitPlan: unknown): string[] {
  const doc = (splitPlan ?? {}) as RawSplit;
  const programmes = Array.isArray(doc.programmes) ? (doc.programmes as RawProgramme[]) : [];
  if (!programmes.length) return [];

  const active = programmes.find(p => p?.id === doc.activeId) ?? null;
  if (!active) return [];

  const days = Array.isArray(active.days) ? (active.days as RawDay[]) : [];
  const names: string[] = [];
  for (const day of days) {
    if (day?.rest === true) continue;
    const exercises = Array.isArray(day?.exercises) ? (day.exercises as RawExercise[]) : [];
    for (const ex of exercises) {
      if (typeof ex?.name === 'string' && ex.name.trim()) names.push(ex.name.trim());
    }
  }
  return names;
}

/* ── Whoop, folded into weeks ─────────────────────────────────────────────── */

// The subset of a Whoop day the tracker reads. Mirrors `whoop_days`.
export type WhoopDay = {
  day: string;
  recovery_score: number | null;
  hrv_ms: number | null;
  resting_hr: number | null;
  spo2?: number | null;
  skin_temp_c?: number | null;
  sleep_hours: number | null;
  nap_hours?: number | null;
  sleep_performance?: number | null;
  sleep_efficiency?: number | null;
  sleep_consistency?: number | null;
  respiratory_rate?: number | null;
  sleep_stages?: { light: number | null; deep: number | null; rem: number | null; awake: number | null } | null;
  strain: number | null;
  kilojoules?: number | null;
  avg_hr?: number | null;
  max_hr?: number | null;
  workouts?: { sport: string; strain: number | null; minutes: number | null; start: string; avg_hr: number | null; max_hr: number | null }[];
  scored?: boolean;
};

export type WhoopWeek = {
  week_start: string;
  days: number;
  recovery: number | null;
  hrv: number | null;
  resting_hr: number | null;
  sleep_hours: number | null;
  sleep_performance: number | null;
  strain: number | null;          // average per day
  strain_total: number | null;    // the week's sum, since strain accumulates
  workouts: number;
};

// Monday of the week a YYYY-MM-DD falls in, as YYYY-MM-DD. Done on the date
// parts alone so it can never slip a day across a timezone.
export function weekStartOf(day: string): string {
  const [y, m, d] = day.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const shift = (dt.getUTCDay() + 6) % 7;
  dt.setUTCDate(dt.getUTCDate() - shift);
  return dt.toISOString().slice(0, 10);
}

const mean = (xs: (number | null | undefined)[]) => {
  const v = xs.filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
  return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null;
};

// Weekly averages, keyed by the week's Monday. A day lands on the week of the
// morning it belongs to, so Sunday night's sleep counts for Monday's week —
// the same rule the Whoop app uses.
export function whoopWeeks(days: WhoopDay[]): Map<string, WhoopWeek> {
  const groups = new Map<string, WhoopDay[]>();
  for (const d of days) {
    const k = weekStartOf(d.day);
    groups.set(k, [...(groups.get(k) ?? []), d]);
  }
  const out = new Map<string, WhoopWeek>();
  for (const [week_start, ds] of groups) {
    const strains = ds.map(d => d.strain).filter((x): x is number => typeof x === 'number');
    out.set(week_start, {
      week_start,
      days: ds.length,
      recovery: mean(ds.map(d => d.recovery_score)),
      hrv: mean(ds.map(d => d.hrv_ms)),
      resting_hr: mean(ds.map(d => d.resting_hr)),
      sleep_hours: mean(ds.map(d => d.sleep_hours)),
      sleep_performance: mean(ds.map(d => d.sleep_performance)),
      strain: mean(strains),
      strain_total: strains.length ? Math.round(strains.reduce((a, b) => a + b, 0) * 10) / 10 : null,
      workouts: ds.reduce((n, d) => n + (d.workouts?.length ?? 0), 0),
    });
  }
  return out;
}
