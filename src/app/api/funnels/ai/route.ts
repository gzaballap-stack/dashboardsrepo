import { NextResponse } from 'next/server';
import { getAuthContext, isAuthError } from '@/lib/api-auth';
import { editFunnelWithAi } from '@/lib/funnel-ai';

// Funnels editor, "Ask AI": changes a draft from a plain request.
//
//   POST { content, message, history?, page? }  →  { content, reply }
//
// The result only replaces the draft on the editor's screen: nothing is saved
// or shown to visitors here. Requires ANTHROPIC_API_KEY. See src/lib/funnel-ai.ts.

export async function POST(req: Request) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'The AI is not set up here yet (no Anthropic key).' }, { status: 503 });

  const body = await req.json().catch(() => null) as { content?: unknown; message?: unknown; history?: unknown; page?: unknown } | null;
  const message = typeof body?.message === 'string' ? body.message.trim().slice(0, 2000) : '';
  if (!message || !body?.content) return NextResponse.json({ error: 'Say what should change.' }, { status: 400 });

  const out = await editFunnelWithAi(apiKey, { content: body.content, message, history: body.history, page: body.page });
  if (!out.ok) return NextResponse.json({ error: out.error }, { status: 502 });
  return NextResponse.json({ content: out.content, reply: out.reply });
}
