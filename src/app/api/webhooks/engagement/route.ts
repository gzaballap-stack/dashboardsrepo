import { NextResponse } from 'next/server';
import { POST as b2bWebhook } from '@/app/api/webhooks/b2b/route';

// Page-visit and video-watch tracking from the Tomsi Media funnel pages
// (replaces the public Make hook "CCM - Funnel Engagement → Supabase").
// Public by necessity — the snippet runs in visitors' browsers — so it accepts
// only the engagement event types and nothing else, and adds the admin secret
// server-side before handing the event to the B2B webhook.

const ALLOWED = ['funnel_visit', 'vsl_watch', 'precall_watch', 'visit_landing', 'visit_calendar', 'visit_thankyou'];

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

async function readBody(req: Request): Promise<Record<string, unknown>> {
  const text = await req.text();
  try { return JSON.parse(text); } catch { /* not JSON */ }
  return Object.fromEntries(new URLSearchParams(text));
}

export async function POST(req: Request) {
  const p = await readBody(req).catch(() => ({} as Record<string, unknown>));
  const cd = (p.customData ?? {}) as Record<string, unknown>;
  const pick = (k: string) => (p[k] ?? cd[k] ?? '') as string;

  const event_type = String(pick('event_type'));
  if (!ALLOWED.includes(event_type)) {
    return NextResponse.json({ error: 'event_type not allowed' }, { status: 400, headers: CORS });
  }

  const body = {
    event_type,
    ghl_contact_id: String(pick('ghl_contact_id')) || null,
    progress_pct: pick('progress_pct') === '' ? null : pick('progress_pct'),
    external_id: String(pick('external_id')) || null,
    occurred_at: String(pick('occurred_at')) || new Date().toISOString(),
  };
  const res = await b2bWebhook(new Request(new URL('/api/webhooks/b2b', req.url), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.ADMIN_WEBHOOK_SECRET ?? ''}` },
    body: JSON.stringify(body),
  }));
  return NextResponse.json({ success: res.ok }, { status: res.ok ? 200 : res.status, headers: CORS });
}
