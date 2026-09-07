import { NextResponse } from 'next/server';
import { getAuthContext, isAuthError } from '@/lib/api-auth';

const COLS = 'user_id, exercises, unit, length_unit, goal_note, share_token, updated_at';

const DEFAULT_EXERCISES = [
  'Incline DB Press', 'Lat Pulldown Row', 'Bicep Curl', 'Tricep Extension', 'Shoulder Press',
];

function cleanExercises(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of v) {
    if (typeof raw !== 'string') continue;
    const name = raw.trim().slice(0, 60);
    if (!name || seen.has(name.toLowerCase())) continue;
    seen.add(name.toLowerCase());
    out.push(name);
    if (out.length >= 20) break;
  }
  return out;
}

export async function GET() {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;

  const { data } = await ctx.service.from('lift_settings').select(COLS).eq('user_id', ctx.userId).maybeSingle();
  if (data) return NextResponse.json({ settings: data });

  // First visit — lay down the defaults so the tool has something to render.
  const { data: created, error } = await ctx.service
    .from('lift_settings')
    .upsert({ user_id: ctx.userId }, { onConflict: 'user_id' })
    .select(COLS)
    .single();

  if (error) {
    return NextResponse.json({
      settings: { user_id: ctx.userId, exercises: DEFAULT_EXERCISES, unit: 'kg', length_unit: 'cm', goal_note: null, share_token: null },
    });
  }
  return NextResponse.json({ settings: created });
}

export async function PATCH(req: Request) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;

  const body = await req.json();
  const patch: Record<string, unknown> = { user_id: ctx.userId, updated_at: new Date().toISOString() };

  const exercises = cleanExercises(body.exercises);
  if (exercises && exercises.length) patch.exercises = exercises;
  if (body.unit === 'kg' || body.unit === 'lb') patch.unit = body.unit;
  if (body.length_unit === 'cm' || body.length_unit === 'in') patch.length_unit = body.length_unit;
  if ('goal_note' in body) patch.goal_note = typeof body.goal_note === 'string' && body.goal_note.trim() ? body.goal_note.trim() : null;

  // Sharing is a link the user turns on and off; rotating means turning it off
  // and on again, which invalidates whatever was handed out before.
  if (body.share === true) patch.share_token = crypto.randomUUID().replace(/-/g, '');
  if (body.share === false) patch.share_token = null;

  const { data, error } = await ctx.service
    .from('lift_settings')
    .upsert(patch, { onConflict: 'user_id' })
    .select(COLS)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ settings: data });
}
