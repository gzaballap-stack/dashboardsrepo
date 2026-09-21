import { NextResponse } from 'next/server';
import { getAuthContext, isAuthError } from '@/lib/api-auth';

// Weekly Non-Negotiables: templates the Task Board turns into real tasks each
// week. See POST /api/task-templates/materialize for the generation itself.

const BUCKETS = ['A', 'B', 'C', 'D', 'E'];
const SOURCES = ['leads', 'triage', 'no_shows', 'no_closes'];
const COLS = 'id, title, bucket, priority, days, count_source, position, active, created_at';

function cleanDays(v: unknown): number[] {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.map(Number).filter(n => Number.isInteger(n) && n >= 1 && n <= 7))].sort();
}

/** Monday-based weekday (1-7) of a YYYY-MM-DD date. */
function weekday(dateISO: string): number {
  const d = new Date(`${dateISO}T00:00:00Z`).getUTCDay();
  return d === 0 ? 7 : d;
}

export async function GET() {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;

  const { data, error } = await ctx.service
    .from('task_templates')
    .select(COLS)
    .eq('user_id', ctx.userId)
    .eq('active', true)
    .order('position', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ templates: data });
}

export async function POST(req: Request) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;

  const body = await req.json();
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!title) return NextResponse.json({ error: 'title is required' }, { status: 400 });

  const { data, error } = await ctx.service
    .from('task_templates')
    .insert({
      user_id: ctx.userId,
      title,
      bucket: BUCKETS.includes(body.bucket) ? body.bucket : 'A',
      priority: [1, 2, 3].includes(body.priority) ? body.priority : 1,
      days: cleanDays(body.days),
      count_source: SOURCES.includes(body.count_source) ? body.count_source : null,
      position: typeof body.position === 'number' ? body.position : Date.now(),
    })
    .select(COLS)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ template: data });
}

/**
 * Edits apply forward only: copies already done, or dated before `today`, are
 * history and stay exactly as they were.
 */
export async function PATCH(req: Request) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;

  const body = await req.json();
  if (!body.id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
  const today = typeof body.today === 'string' ? body.today : new Date().toISOString().slice(0, 10);

  const patch: Record<string, unknown> = {};
  if (typeof body.title === 'string' && body.title.trim()) patch.title = body.title.trim();
  if (BUCKETS.includes(body.bucket)) patch.bucket = body.bucket;
  if ([1, 2, 3].includes(body.priority)) patch.priority = body.priority;
  if ('days' in body) patch.days = cleanDays(body.days);
  if ('count_source' in body) patch.count_source = SOURCES.includes(body.count_source) ? body.count_source : null;
  if (!Object.keys(patch).length) return NextResponse.json({ error: 'nothing to update' }, { status: 400 });

  const { data: before } = await ctx.service
    .from('task_templates').select('days').eq('id', body.id).eq('user_id', ctx.userId).single();

  const { data, error } = await ctx.service
    .from('task_templates')
    .update(patch)
    .eq('id', body.id)
    .eq('user_id', ctx.userId)
    .select(COLS)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Carry wording and letter onto the copies still ahead.
  const carry: Record<string, unknown> = {};
  if (patch.title) carry.title = patch.title;
  if (patch.bucket) carry.bucket = patch.bucket;
  if (patch.priority) carry.priority = patch.priority;
  if (Object.keys(carry).length) {
    await ctx.service.from('tasks').update(carry)
      .eq('user_id', ctx.userId).eq('template_id', body.id)
      .eq('done', false).gte('template_date', today);
  }

  // If the days changed, open future copies on days no longer chosen are
  // removed; the board generates the new days on its next load.
  if ('days' in patch && before) {
    const nextDays = patch.days as number[];
    const { data: ahead } = await ctx.service.from('tasks')
      .select('id, template_date, scope')
      .eq('user_id', ctx.userId).eq('template_id', body.id)
      .eq('done', false).gte('template_date', today);
    const stale = (ahead ?? []).filter(t => {
      if (!t.template_date) return false;
      if (nextDays.length === 0) return t.scope !== 'week';          // now "any day": drop day copies
      if (t.scope === 'week') return true;                            // was "any day": drop the week copy
      return !nextDays.includes(weekday(t.template_date));
    }).map(t => t.id);
    if (stale.length) await ctx.service.from('tasks').delete().in('id', stale).eq('user_id', ctx.userId);
  }

  return NextResponse.json({ template: data });
}

/** Retires a template. Its open future copies go; everything past stays as history. */
export async function DELETE(req: Request) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;

  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  const today = searchParams.get('today') ?? new Date().toISOString().slice(0, 10);
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  await ctx.service.from('tasks').delete()
    .eq('user_id', ctx.userId).eq('template_id', id)
    .eq('done', false).gte('template_date', today);

  const { error } = await ctx.service
    .from('task_templates')
    .update({ active: false })
    .eq('id', id)
    .eq('user_id', ctx.userId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
