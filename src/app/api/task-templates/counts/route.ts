import { NextResponse } from 'next/server';
import { getAuthContext, isAuthError } from '@/lib/api-auth';

// Live call lists for the Non-Negotiables, read from the Tomsi Media (B2B)
// funnel. Each contact is placed by the latest thing that happened to them:
//
//   lead               → leads      (never booked)
//   intro_booked  <48h → triage     (a triage call is booked and coming up)
//   intro_booked  ≥48h → no_shows   (booked, never marked shown)
//   sales_call_booked ≥48h → no_shows
//   sales_call_shown   → no_closes  (showed, never closed)
//
// The payloads carry no appointment time, only when the event arrived, so the
// 48-hour line between "upcoming" and "no-show" is an approximation.

type Source = 'leads' | 'triage' | 'no_shows' | 'no_closes';
type Person = { name: string; phone: string | null; since: string };

const RANK: Record<string, number> = {
  lead: 0, intro_booked: 1, intro_shown: 2, sales_call_booked: 3, sales_call_shown: 4, close: 5,
};

const HOUR = 3600_000;

export async function GET() {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;

  const since = new Date(Date.now() - 60 * 24 * HOUR).toISOString();
  const { data, error } = await ctx.service
    .from('b2b_events')
    .select('event_type, occurred_at, ghl_contact_id, lead_name, lead_phone, lead_email')
    .in('event_type', Object.keys(RANK))
    .gte('occurred_at', since)
    .order('occurred_at', { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Latest event per contact; on a tie the further-along stage wins.
  type Row = NonNullable<typeof data>[number];
  const latest = new Map<string, Row>();
  const nameOf = new Map<string, { name: string | null; phone: string | null }>();
  for (const e of data ?? []) {
    const key = e.ghl_contact_id || e.lead_phone || e.lead_email || (e.lead_name ?? '').trim().toLowerCase();
    if (!key) continue;
    const known = nameOf.get(key) ?? { name: null, phone: null };
    nameOf.set(key, { name: e.lead_name || known.name, phone: e.lead_phone || known.phone });
    const cur = latest.get(key);
    const newer = !cur
      || e.occurred_at > cur.occurred_at
      || (e.occurred_at === cur.occurred_at && RANK[e.event_type] > RANK[cur.event_type]);
    if (newer) latest.set(key, e);
  }

  const out: Record<Source, Person[]> = { leads: [], triage: [], no_shows: [], no_closes: [] };
  const now = Date.now();
  for (const [key, e] of latest) {
    const age = now - new Date(e.occurred_at).getTime();
    let bucket: Source | null = null;
    if (e.event_type === 'lead') bucket = age <= 30 * 24 * HOUR ? 'leads' : null;
    else if (e.event_type === 'intro_booked') bucket = age < 48 * HOUR ? 'triage' : 'no_shows';
    else if (e.event_type === 'sales_call_booked') bucket = age >= 48 * HOUR ? 'no_shows' : null;
    else if (e.event_type === 'sales_call_shown') bucket = 'no_closes';
    if (!bucket) continue;

    const who = nameOf.get(key)!;
    out[bucket].push({ name: who.name || who.phone || 'Unknown', phone: who.phone, since: e.occurred_at });
  }

  for (const k of Object.keys(out) as Source[]) out[k].sort((a, b) => b.since.localeCompare(a.since));

  return NextResponse.json({
    counts: Object.fromEntries(
      (Object.keys(out) as Source[]).map(k => [k, { count: out[k].length, people: out[k].slice(0, 50) }]),
    ),
  });
}
