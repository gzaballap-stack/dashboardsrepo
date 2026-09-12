// Which exercises the weekly log asks about.
//
// The list is derived, never stored as a copy. It is the union of three things:
//
//   1. the base list in `lift_settings.exercises`, which the user curates by hand
//   2. every exercise in whichever split programme is marked active
//   3. any name that already has numbers logged against it
//
// Deriving rather than copying is what keeps (1) and (2) from drifting. Making a
// programme active can never duplicate something already tracked, renaming an
// exercise in a programme leaves no orphan behind, and (3) means a lift you have
// history for keeps its chart even after it drops out of your programme.

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
