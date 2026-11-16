import { NextResponse } from 'next/server';
import { getAuthContext, isAuthError } from '@/lib/api-auth';
import { createCalendarEvent } from '@/lib/google-docs-bridge';

// Books a follow-up call on Google Calendar from the Task Board's Calls panel.
// The dashboard holds no Google credentials: the Apps Script bridge
// (scripts/google-docs-bridge.gs) creates the event as its owner.

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
  const result = await createCalendarEvent({
    // Same shape as the booking tool's titles, so the person's name is picked
    // out the same way on the non-negotiables strip.
    title: `${name} | Follow-up call`,
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

  return NextResponse.json({ ok: true, id: result.id ?? null, start: start.toISOString(), end: end.toISOString() });
}
