import { NextResponse } from 'next/server';
import { getAuthContext, isAuthError } from '@/lib/api-auth';
import { parseIcs } from '@/lib/ics';

// The feed URL is a secret that grants read access to the whole calendar, so it
// is only ever read server-side and never sent back to the browser.
const SAFE_COLS = 'id, label, created_at, last_error, last_synced';

function normaliseUrl(raw: string): string | null {
  let url = raw.trim();
  if (!url) return null;
  if (url.startsWith('webcal://')) url = 'https://' + url.slice('webcal://'.length);
  let parsed: URL;
  try { parsed = new URL(url); } catch { return null; }
  if (parsed.protocol !== 'https:') return null;
  return parsed.toString();
}

export async function GET(req: Request) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;

  const { searchParams } = new URL(req.url);
  const start = searchParams.get('start');
  const end = searchParams.get('end');
  const from = start ? new Date(`${start}T00:00:00`) : new Date();
  const to = end ? new Date(`${end}T23:59:59`) : new Date(from.getTime() + 86400000);

  const { data: feeds, error } = await ctx.service
    .from('calendar_feeds')
    .select('id, label, url')
    .eq('user_id', ctx.userId)
    .order('created_at', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!feeds?.length) return NextResponse.json({ feeds: [], events: [] });

  const results = await Promise.all(feeds.map(async f => {
    try {
      const res = await fetch(f.url, {
        cache: 'no-store',
        headers: { 'User-Agent': 'TomsiDashboard/1.0' },
        signal: AbortSignal.timeout(15000),
      });
      if (!res.ok) throw new Error(`Calendar returned ${res.status}`);
      const body = await res.text();
      if (!body.includes('BEGIN:VCALENDAR')) throw new Error('That link did not return a calendar');
      return { feed: f, events: parseIcs(body, from, to, f.label ?? null), error: null as string | null };
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Could not reach the calendar';
      return { feed: f, events: [], error: message };
    }
  }));

  // Record health per feed without blocking the response on it.
  await Promise.all(results.map(r => ctx.service
    .from('calendar_feeds')
    .update({ last_error: r.error, last_synced: new Date().toISOString() })
    .eq('id', r.feed.id)
    .eq('user_id', ctx.userId)));

  return NextResponse.json({
    feeds: results.map(r => ({ id: r.feed.id, label: r.feed.label, error: r.error })),
    events: results.flatMap(r => r.events).sort((a, b) => a.start.localeCompare(b.start)),
  });
}

export async function POST(req: Request) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;

  const body = await req.json();
  const url = normaliseUrl(String(body.url ?? ''));
  if (!url) return NextResponse.json({ error: 'That does not look like a calendar link. It should start with https:// and end in .ics' }, { status: 400 });

  // Prove the link works before storing it, so a typo fails here and not later.
  try {
    const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
    if (!res.ok) return NextResponse.json({ error: `The calendar link came back with an error (${res.status}). Check you copied the secret address in iCal format.` }, { status: 400 });
    const text = await res.text();
    if (!text.includes('BEGIN:VCALENDAR')) {
      return NextResponse.json({ error: 'That link opened, but it is not a calendar feed. Use the "Secret address in iCal format" link.' }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: 'Could not reach that link. Check it and try again.' }, { status: 400 });
  }

  const { data, error } = await ctx.service
    .from('calendar_feeds')
    .insert({ user_id: ctx.userId, url, label: body.label?.trim() || null })
    .select(SAFE_COLS)
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ feed: data });
}

export async function DELETE(req: Request) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;

  const { searchParams } = new URL(req.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  const { error } = await ctx.service
    .from('calendar_feeds')
    .delete()
    .eq('id', id)
    .eq('user_id', ctx.userId);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}
