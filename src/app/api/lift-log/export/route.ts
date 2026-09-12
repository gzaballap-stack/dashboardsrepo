import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { mergeExerciseNames, activeProgrammeExercises } from '@/lib/health-tracker';

// Read-only export of one person's weekly health log, addressed by their share token.
// Public by design: the token is the credential, so it can be pasted into a
// Claude project, a spreadsheet's IMPORTDATA, or anything else that just fetches
// a URL. Turning sharing off in the tool deletes the token and kills the link.
//
//   /api/lift-log/export?token=…            → CSV
//   /api/lift-log/export?token=…&format=json → JSON

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const token = searchParams.get('token');
  if (!token) return NextResponse.json({ error: 'token is required' }, { status: 400 });

  const service = createServiceClient();
  const { data: settings } = await service
    .from('lift_settings')
    .select('user_id, exercises, unit, length_unit, goal_note, diet_plan, split_plan')
    .eq('share_token', token)
    .maybeSingle();

  if (!settings) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const { data: entries } = await service
    .from('lift_entries')
    .select('week_start, weight_1, weight_2, weight_3, waist, bicep, lifts, notes')
    .eq('user_id', settings.user_id)
    .order('week_start', { ascending: true });

  const unit = settings.unit ?? 'kg';
  const lengthUnit = settings.length_unit ?? 'cm';

  // Same derivation the tool uses: the base list, the active programme, and
  // anything with history — so an export names every column the log can hold.
  const loggedNames = new Set<string>();
  for (const e of entries ?? []) {
    for (const name of Object.keys((e.lifts ?? {}) as Record<string, unknown>)) loggedNames.add(name);
  }
  const exercises = mergeExerciseNames(
    Array.isArray(settings.exercises) ? settings.exercises : [],
    activeProgrammeExercises(settings.split_plan),
    [...loggedNames],
  );

  const rows = (entries ?? []).map(e => {
    const weights = [e.weight_1, e.weight_2, e.weight_3].filter((w): w is number => typeof w === 'number');
    const avg = weights.length ? weights.reduce((a, b) => a + b, 0) / weights.length : null;
    const lifts = (e.lifts ?? {}) as Record<string, { load?: number | null; reps?: number | null }>;
    return { ...e, weight_avg: avg === null ? null : Number(avg.toFixed(2)), lifts };
  });

  if (searchParams.get('format') === 'json') {
    // JSON carries the plans too — the CSV is the weekly log only, since a diet
    // and a split don't flatten into the same table.
    return NextResponse.json({
      unit, length_unit: lengthUnit, exercises,
      goal: settings.goal_note ?? null,
      diet_plan: settings.diet_plan ?? {},
      split_plan: settings.split_plan ?? {},
      weeks: rows,
    });
  }

  const header = [
    'Week Start',
    `Weight 1 (${unit})`, `Weight 2 (${unit})`, `Weight 3 (${unit})`, `Weight Avg (${unit})`,
    `Waist (${lengthUnit})`, `Bicep (${lengthUnit})`,
    ...exercises.flatMap(x => [`${x} (${unit})`, `${x} (reps)`]),
    'Notes',
  ];

  const body = rows.map(r => [
    r.week_start,
    r.weight_1, r.weight_2, r.weight_3, r.weight_avg,
    r.waist, r.bicep,
    ...exercises.flatMap(x => [r.lifts[x]?.load ?? null, r.lifts[x]?.reps ?? null]),
    r.notes,
  ]);

  const csv = [header, ...body].map(line => line.map(csvCell).join(',')).join('\n');

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'inline; filename="health-tracker-log.csv"',
      'Cache-Control': 'no-store',
    },
  });
}
