import { NextResponse } from 'next/server';
import { getAuthContext, isAuthError } from '@/lib/api-auth';

const BUCKETS = ['A', 'B', 'C', 'D', 'E'] as const;
const COLS = 'id, title, notes, bucket, priority, position, done, due_date, delegate_to, created_at, completed_at, task_date, scope';
const SCOPES = ['day', 'week', 'backlog'] as const;

export async function GET() {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;

  const { data, error } = await ctx.service
    .from('tasks')
    .select(COLS)
    .eq('user_id', ctx.userId)
    .order('position', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ tasks: data });
}

export async function POST(req: Request) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;

  const body = await req.json();
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!title) return NextResponse.json({ error: 'title is required' }, { status: 400 });

  const bucket = BUCKETS.includes(body.bucket) ? body.bucket : 'A';
  const priority = [1, 2, 3].includes(body.priority) ? body.priority : 1;

  const { data, error } = await ctx.service
    .from('tasks')
    .insert({
      user_id: ctx.userId,
      title,
      notes: body.notes ?? null,
      bucket,
      priority,
      position: typeof body.position === 'number' ? body.position : Date.now(),
      due_date: body.due_date ?? null,
      delegate_to: body.delegate_to ?? null,
      task_date: body.scope === 'backlog' ? null : (body.task_date ?? new Date().toISOString().slice(0, 10)),
      scope: SCOPES.includes(body.scope) ? body.scope : 'day',
    })
    .select(COLS)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ task: data });
}

export async function PATCH(req: Request) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;

  const body = await req.json();
  if (!body.id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  const patch: Record<string, unknown> = {};
  if (typeof body.title === 'string' && body.title.trim()) patch.title = body.title.trim();
  if ('notes' in body) patch.notes = body.notes || null;
  if (BUCKETS.includes(body.bucket)) patch.bucket = body.bucket;
  if ([1, 2, 3].includes(body.priority)) patch.priority = body.priority;
  if (typeof body.position === 'number') patch.position = body.position;
  if ('due_date' in body) patch.due_date = body.due_date || null;
  if ('delegate_to' in body) patch.delegate_to = body.delegate_to || null;
  if ('task_date' in body) patch.task_date = body.task_date || null;
  if (SCOPES.includes(body.scope)) patch.scope = body.scope;
  if (typeof body.done === 'boolean') {
    patch.done = body.done;
    patch.completed_at = body.done ? new Date().toISOString() : null;
  }

  if (!Object.keys(patch).length) return NextResponse.json({ error: 'nothing to update' }, { status: 400 });

  const { data, error } = await ctx.service
    .from('tasks')
    .update(patch)
    .eq('id', body.id)
    .eq('user_id', ctx.userId)
    .select(COLS)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ task: data });
}

export async function DELETE(req: Request) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;

  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  const clear = searchParams.get('clear_completed');

  let q = ctx.service.from('tasks').delete().eq('user_id', ctx.userId);
  if (clear === 'true') q = q.eq('done', true);
  else if (id) q = q.eq('id', id);
  else return NextResponse.json({ error: 'id is required' }, { status: 400 });

  const { error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
