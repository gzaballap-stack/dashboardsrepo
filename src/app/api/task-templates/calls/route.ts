import { NextResponse } from 'next/server';
import { getAuthContext, isAuthError } from '@/lib/api-auth';
import { parseIcs, type CalEvent } from '@/lib/ics';

// Sales calls from the connected calendar, turned into non-negotiable task rows
// for one week so they can be ticked off alongside the weekly ones.
//
// A sales call is a timed event with someone else on it (an attendee who isn't
// the organiser) or a meeting link. Solo blocks — Gym, ISA Dials, SLEEP — have
// neither, so they never qualify.

const TASK_COLS = 'id, title, notes, bucket, priority, position, done, due_date, delegate_to, created_at, completed_at, task_date, scope, from_list, origin, prev_dates, parked, template_id, template_date, external_key, starts_at';

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

const titleCase = (s: string) => (s === s.toLowerCase() ? s.replace(/\b\w/g, c => c.toUpperCase()) : s);

/** The other person on the call — not the organiser. */
function othersOn(e: CalEvent): string[] {
  const me = (e.organizer ?? '').toLowerCase();
  return e.attendees.filter(a => a && a.toLowerCase() !== me);
}

/**
 * Just the person's name. Booking tools title events like
 * "Derick Garner | Custom Area Breakdown Tomsi Media"; the part matching an
 * attendee wins, then the first part, then the attendee's own name.
 */
function nameFor(e: CalEvent): string {
  const others = othersOn(e).filter(a => !a.includes('@'));
  const parts = e.title.split(/\s+[|–—-]\s+|\s*\|\s*/).map(p => p.trim()).filter(Boolean);
  const matched = parts.find(p => others.some(o => o.toLowerCase() === p.toLowerCase()));
  if (matched) return titleCase(matched);
  if (parts.length > 1) return titleCase(parts[0]);
  if (others.length) return titleCase(others[0]);
  return e.title;
}

export async function POST(req: Request) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;

  const body = await req.json();
  const week: string = body.week_start;
  const today: string = typeof body.today === 'string' ? body.today : new Date().toISOString().slice(0, 10);
  // Minutes behind UTC for each day of the week, from the browser (getTimezoneOffset),
  // so each call lands on the user's own calendar day rather than the server's.
  const offsets: Record<string, number> = body.offsets ?? {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(week ?? '')) return NextResponse.json({ error: 'week_start is required' }, { status: 400 });

  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i));
  const midnight = (d: string) => new Date(`${d}T00:00:00Z`).getTime() + (offsets[d] ?? 0) * 60000;
  const from = new Date(midnight(days[0]));
  const to = new Date(midnight(addDays(week, 7)) - 1);

  const { data: feeds } = await ctx.service
    .from('calendar_feeds').select('url, label').eq('user_id', ctx.userId);
  if (!feeds?.length) return NextResponse.json({ tasks: [] });

  const events: CalEvent[] = [];
  await Promise.all(feeds.map(async f => {
    try {
      const res = await fetch(f.url, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
      const text = await res.text();
      if (text.includes('BEGIN:VCALENDAR')) events.push(...parseIcs(text, from, to, f.label ?? null));
    } catch { /* a dead feed just contributes nothing this time */ }
  }));

  const localDay = (startISO: string) => {
    const ms = new Date(startISO).getTime();
    return days.find(d => ms >= midnight(d) && ms < midnight(addDays(d, 1))) ?? null;
  };

  const rows = events
    .filter(e => !e.allDay && (othersOn(e).length > 0 || !!e.meetUrl))
    .map(e => ({ e, day: localDay(e.start) }))
    .filter((x): x is { e: CalEvent; day: string } => !!x.day)
    .map(({ e, day }) => ({
      user_id: ctx.userId,
      title: nameFor(e),
      bucket: 'A',
      priority: 1,
      position: new Date(e.start).getTime(),
      scope: 'day',
      task_date: day,
      origin: 'calendar',
      external_key: `cal:${ctx.userId}:${e.uid}:${e.start}`,
      starts_at: e.start,
    }));

  if (rows.length) {
    const { error } = await ctx.service
      .from('tasks')
      .upsert(rows, { onConflict: 'external_key', ignoreDuplicates: true });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // A call cancelled or moved in the calendar leaves this week's list too —
  // but only from today on, and never once it has been ticked.
  const live = new Set(rows.map(r => r.external_key));
  const { data: existing } = await ctx.service
    .from('tasks').select('id, external_key, task_date, done')
    .eq('user_id', ctx.userId).eq('origin', 'calendar')
    .gte('task_date', days[0]).lte('task_date', days[6]);
  const gone = (existing ?? [])
    .filter(t => !t.done && t.task_date >= today && t.external_key && !live.has(t.external_key))
    .map(t => t.id);
  if (gone.length) await ctx.service.from('tasks').delete().in('id', gone).eq('user_id', ctx.userId);

  const { data: tasks, error: readError } = await ctx.service
    .from('tasks').select(TASK_COLS)
    .eq('user_id', ctx.userId).eq('origin', 'calendar')
    .gte('task_date', days[0]).lte('task_date', days[6]);
  if (readError) return NextResponse.json({ error: readError.message }, { status: 500 });

  return NextResponse.json({ tasks });
}
