import { NextResponse } from 'next/server';
import { getAuthContext, isAuthError } from '@/lib/api-auth';

// POST { context: string, messages: [{role, content}] }
// Returns { reply: string }
// Requires ANTHROPIC_API_KEY in Railway env vars.

export async function POST(req: Request) {
  const ctx = await getAuthContext();
  if (isAuthError(ctx)) return ctx;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json({
      error: 'AI chat requires an Anthropic API key. Add ANTHROPIC_API_KEY to your Railway environment variables.',
    }, { status: 503 });
  }

  const body = await req.json().catch(() => null);
  if (!body?.messages || !Array.isArray(body.messages)) {
    return NextResponse.json({ error: 'Provide { context, messages }' }, { status: 400 });
  }

  const systemPrompt = [
    'You are a performance marketing analyst assistant embedded in a call center reporting dashboard.',
    'You have been given the following real data about a specific campaign or client:',
    '',
    body.context ?? '',
    '',
    'Answer questions about this data concisely and actionably. Focus on:',
    '- What the numbers mean (good/bad relative to typical benchmarks)',
    '- Root causes of issues (creative, audience, funnel, post-funnel)',
    '- Specific next steps the media buyer or team should take',
    'Keep responses under 200 words unless a deeper breakdown is explicitly requested.',
    'Format numbers consistently with the dashboard ($, %, counts).',
  ].join('\n');

  const messages = (body.messages as Array<{ role: string; content: string }>)
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

  const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 600,
      system: systemPrompt,
      messages,
    }),
  });

  if (!anthropicRes.ok) {
    const err = await anthropicRes.json().catch(() => ({}));
    return NextResponse.json({ error: (err as { error?: { message?: string } }).error?.message ?? 'Anthropic API error' }, { status: 502 });
  }

  const result = await anthropicRes.json() as {
    content: Array<{ type: string; text: string }>;
  };
  const reply = result.content?.find(c => c.type === 'text')?.text ?? 'No response generated.';

  return NextResponse.json({ reply });
}
