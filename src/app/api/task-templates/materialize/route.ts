import { NextResponse } from 'next/server';
import { getAuthContext, isAuthError } from '@/lib/api-auth';

const TASK_COLS = 'id, title, notes, bucket, priority, position, done, due_date, delegate_to, created_at, completed_at, task_date, scope, from_list, origin, prev_dates, parked, template_id, template_date';

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Monday of the week containing `iso`. */
const mondayOf = (iso: string) => {
  const dow = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return addDays(iso, -((dow + 6) % 7));
};

/**
 * Makes sure every Non-Negotiable has its copies for one week.
 *
 * Idempotent: each copy is keyed on (template, slot date) by a unique index, so
 * calling this again — or from two tabs at once — creates nothing twice, and a
 * copy that was moved or skipped is never regenerated.
 *
 * Only the current week and later are generated. Past weeks are history; a
 * template never back-fills days before it was created.
 */
export async function POST(req: Request) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;

  const body = await req.json();
  const today = typeof body.today === 'string' ? body.today : new Date().toISOString().slice(0, 10);
  const week = mondayOf(typeof body.week_start === 'string' ? body.week_start : today);
  const weekEnd = addDays(week, 6);

  if (week < mondayOf(today)) return NextResponse.json({ tasks: [] });

  const { data: templates, error } = await ctx.service
    .from('task_templates')
    .select('id, title, bucket, priority, days, position, created_at')
    .eq('user_id', ctx.userId)
    .eq('active', true)
    .order('position', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!templates?.length) return NextResponse.json({ tasks: [] });

  const rows: Record<string, unknown>[] = [];
  templates.forEach((t, i) => {
    const born = String(t.created_at).slice(0, 10);
    const days: number[] = t.days ?? [];
    const base = {
      user_id: ctx.userId,
      title: t.title,
      bucket: t.bucket,
      priority: t.priority,
      // Ahead of everything else in the lane, in the template's own order.
      position: -1_000_000 + i,
      template_id: t.id,
    };

    if (days.length === 0) {
      if (weekEnd >= born) rows.push({ ...base, scope: 'week', task_date: week, template_date: week });
      return;
    }
    for (const d of days) {
      const slot = addDays(week, d - 1);
      if (slot >= born) rows.push({ ...base, scope: 'day', task_date: slot, template_date: slot });
    }
  });

  if (rows.length) {
    const { error: upsertError } = await ctx.service
      .from('tasks')
      .upsert(rows, { onConflict: 'template_id,template_date', ignoreDuplicates: true });
    if (upsertError) return NextResponse.json({ error: upsertError.message }, { status: 500 });
  }

  const { data: tasks, error: readError } = await ctx.service
    .from('tasks')
    .select(TASK_COLS)
    .eq('user_id', ctx.userId)
    .in('template_id', templates.map(t => t.id))
    .gte('template_date', week)
    .lte('template_date', weekEnd);

  if (readError) return NextResponse.json({ error: readError.message }, { status: 500 });
  return NextResponse.json({ tasks });
}
