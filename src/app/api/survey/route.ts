import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';
import { cardFromLink, linkStatus, submitFromLink } from '@/lib/survey-links';

// The client's survey link — public on purpose (no sign-in): the token in the
// link is the only key, and it opens one survey, once. What it can and cannot
// do is in lib/survey-links.ts.
//
//   GET  ?token=                                       is the link open, and which service
//   POST { action: 'submit', token, answers }          the client's answers (page one comes from the link)
//   POST { action: 'card', token, envelope, brand, last4 }   one card, locked in the browser, right after submitting

export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store, max-age=0' };

export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get('token');
  const out = await linkStatus(createServiceClient(), token);
  return NextResponse.json(out.json, { status: out.status, headers });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const service = createServiceClient();
  const out = body.action === 'submit' ? await submitFromLink(service, body.token, body.answers)
    : body.action === 'card' ? await cardFromLink(service, body.token, body)
    : { status: 400, json: { error: 'Unknown action' } };
  return NextResponse.json(out.json, { status: out.status, headers });
}
