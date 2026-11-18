import { NextResponse } from 'next/server';
import { getAuthContext, isAuthError } from '@/lib/api-auth';
import { listEventColors } from '@/lib/google-docs-bridge';

// Google Calendar's colour for each event in a range, for the Task Board's
// calendar pop-up. The private iCal feed has no colours, so they come through
// the Apps Script bridge. Until that script has the action, `available` is false
// and the pop-up falls back to Google's default blue.

// Google's event colour ids → the colours its web calendar shows.
const EVENT_COLORS: Record<string, string> = {
  '1': '#7986CB',  // Lavender
  '2': '#33B679',  // Sage
  '3': '#8E24AA',  // Grape
  '4': '#E67C73',  // Flamingo
  '5': '#F6BF26',  // Banana
  '6': '#F4511E',  // Tangerine
  '7': '#039BE5',  // Peacock
  '8': '#616161',  // Graphite
  '9': '#3F51B5',  // Blueberry
  '10': '#0B8043', // Basil
  '11': '#D50000', // Tomato
};

export async function GET(req: Request) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;

  const { searchParams } = new URL(req.url);
  const start = searchParams.get('start');
  const end = searchParams.get('end');
  if (!start || !end) return NextResponse.json({ error: 'start and end are required' }, { status: 400 });

  const r = await listEventColors(start, end);
  if (!r.ok) return NextResponse.json({ available: false, colors: {}, calendar_color: null });

  // Keyed by event id + start, so each occurrence of a repeating event keeps its own colour.
  const colors: Record<string, string> = {};
  for (const e of r.events) {
    const hex = EVENT_COLORS[e.color];
    if (hex) colors[`${e.id}|${new Date(e.start).toISOString()}`] = hex;
  }
  return NextResponse.json({ available: true, colors, calendar_color: r.calendar_color });
}
