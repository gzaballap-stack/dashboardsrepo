import { NextResponse } from 'next/server';
import { getAuthContext, isAuthError } from '@/lib/api-auth';
import { createCalendarEvent, deleteCalendarEvent } from '@/lib/google-docs-bridge';
import { CALL_KIND_PRIORITY } from '@/lib/call-kind';

// Books a follow-up call on Google Calendar from the Task Board's Calls panel.
// The dashboard holds no Google credentials: the Apps Script bridge
// (scripts/google-docs-bridge.gs) creates the event as its owner.

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const TASK_COLS = 'id, title, notes, bucket, priority, position, done, due_date, delegate_to, created_at, completed_at, task_date, scope, from_list, origin, prev_dates, parked, template_id, template_date, external_key, starts_at';

export async function POST(req: Request) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;

  const body = await req.json();
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  const start = new Date(body.start);
  const minutes = Math.min(Math.max(Number(body.minutes) || 30, 5), 240);
  const guest = typeof body.guest === 'string' ? body.guest.trim() : '';

  if (!name) return NextResponse.json({ error: 'Who is the call with?' }, { status: 400 });
  if (Number.isNaN(start.getTime())) return NextResponse.json({ error: 'Pick a date and time.' }, { status: 400 });
  if (guest && !EMAIL.test(guest)) return NextResponse.json({ error: 'That email does not look right.' }, { status: 400 });

  const end = new Date(start.getTime() + minutes * 60000);
  // With their email it's a follow-up they're invited to; without, it's a dial —
  // a reminder to ring them then. Same "Name | …" shape as the booking tool's
  // titles, so the name is picked out the same way on the non-negotiables strip.
  const kind = guest ? 'followup' : 'dial';
  const result = await createCalendarEvent({
    title: `${name} | ${kind === 'followup' ? 'Follow-up call' : 'Dial'}`,
    start: start.toISOString(),
    end: end.toISOString(),
    description: typeof body.note === 'string' ? body.note : '',
    guests: guest || undefined,
  });

  if (!result.ok) {
    const outdated = /unknown action/i.test(result.error);
    return NextResponse.json({
      error: outdated
        ? 'The Google link needs its one-time update before it can add calendar events.'
        : `Google Calendar said: ${result.error}`,
      needs_update: outdated,
    }, { status: 502 });
  }

  // Put it on that day's non-negotiables straight away, keyed exactly as the
  // calendar sync keys it (Google's event id is the feed's UID), so when the
  // feed catches up it is the same row, never a second one.
  let task = null;
  const day = typeof body.day === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.day) ? body.day : null;
  if (result.id && day) {
    const externalKey = `cal:${ctx.userId}:${result.id}:${start.toISOString()}`;
    await ctx.service.from('tasks').upsert([{
      user_id: ctx.userId,
      title: name,
      bucket: 'A',
      priority: CALL_KIND_PRIORITY[kind],
      position: start.getTime(),
      scope: 'day',
      task_date: day,
      origin: 'calendar',
      external_key: externalKey,
      starts_at: start.toISOString(),
    }], { onConflict: 'external_key', ignoreDuplicates: true });
    const { data } = await ctx.service.from('tasks').select(TASK_COLS)
      .eq('user_id', ctx.userId).eq('external_key', externalKey).maybeSingle();
    task = data;
  }

  return NextResponse.json({ ok: true, id: result.id ?? null, start: start.toISOString(), end: end.toISOString(), task });
}

/**
 * Delete a call from the Calls panel: off Google Calendar, and off the
 * non-negotiables. Repeating events are refused by the script.
 */
export async function DELETE(req: Request) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;

  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  const start = searchParams.get('start');
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  const result = await deleteCalendarEvent(id);
  if (!result.ok) {
    const why = /unknown action/i.test(result.error)
      ? 'The Google link needs its update before it can delete calls.'
      : /repeating/i.test(result.error)
      ? 'That one repeats — delete it in Google Calendar so the whole series is handled there.'
      : /not found/i.test(result.error)
      ? 'Google Calendar no longer has that event.'
      : /permission|authori/i.test(result.error)
      ? 'Google needs permission first: run "authorize" in the script once.'
      : `Google Calendar said: ${result.error}`;
    if (!/not found/i.test(result.error)) return NextResponse.json({ error: why }, { status: 502 });
  }

  // Its row on the non-negotiables goes with it.
  let removed: string | null = null;
  if (start) {
    const externalKey = `cal:${ctx.userId}:${id}:${new Date(start).toISOString()}`;
    const { data } = await ctx.service.from('tasks').delete()
      .eq('user_id', ctx.userId).eq('external_key', externalKey).select('id').maybeSingle();
    removed = data?.id ?? null;
  }

  return NextResponse.json({ ok: true, removed_task_id: removed });
}
