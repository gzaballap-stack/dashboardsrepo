// Funnels editor, "Ask AI": Claude changes a funnel draft from a plain request.
//
// Claude is given the draft as it stands and returns the whole draft changed,
// through a tool call so the answer is always structured. What comes back is
// cleaned exactly like a hand edit (normalizeContent).
import { normalizeContent, REVENUE_OPTIONS, SECTION_INFO, type FunnelContent, type SectionType } from '@/lib/funnel-content';

const MODELS = ['claude-sonnet-5-5', 'claude-haiku-4-5-20251001'];   // the second is the fallback this app already uses

const sectionGuide = (Object.keys(SECTION_INFO) as SectionType[]).map(t => {
  const i = SECTION_INFO[t];
  const fields = i.fields.map(f => `${String(f.key)} (${f.kind === 'lines' ? 'list of strings' : f.kind === 'videos' ? 'list of {id, title, headline}' : f.kind === 'layout' ? '"grid" or "stack"' : 'string'})`).join(', ');
  return `- "${t}" (${i.label}; pages: ${i.pages.join(', ')})${fields ? `: ${fields}` : ': no fields'}`;
}).join('\n');

const SYSTEM = `You edit the content of a lead-generation funnel for Tomsi Media, an agency that books exclusive, in-person appointments with qualified homeowners for kitchen and bathroom remodelers, paid per appointment that actually sits. The funnel's visitors are owners of remodeling companies arriving from Meta ads.

The funnel is a JSON object:
- "landing": the landing page, an ordered list of sections.
- "form": the wording of the multi-step form on the landing page (heading, sub, q1 a Yes/No question, q2 the revenue question, q2Sub, q3 company name, q3Sub, q4 contact details, q4Sub, q5 the calendar heading, q5Sub, rejected the message for people who do not qualify) and "disqualify", the revenue answers that end the form.
- "booked": the page shown after a call is booked, an ordered list of sections.

Each section is {"id", "type", ...fields}. The section types and their fields:
${sectionGuide}

Rules:
- Return the COMPLETE funnel object, changed as asked. Leave everything the request does not touch exactly as it is, word for word.
- Keep the "id" of existing sections. Give a new section a new short id.
- The landing page has exactly one "form" section. Never remove it.
- Words wrapped in *asterisks* are shown highlighted. Use at most one or two highlights per text, on the words that carry the promise.
- The revenue answers are fixed: ${REVENUE_OPTIONS.join(', ')}. "disqualify" may only contain some of these, never all.
- Videos: only use YouTube ids that are already in the funnel or that the user gives you. Never invent one.
- Never invent facts, numbers, client names, results or guarantees that are not already in the funnel or in the request.
- Write the way the existing copy does: plain, direct, specific, no hype, no exclamation marks, no emoji unless already used.
- If the request is unclear or cannot be done with these sections, change nothing and say so in "reply".

Always answer by calling the update_funnel tool, exactly once. Never answer in plain text.

"reply" is one or two short plain sentences for a non-technical person saying what you changed. Never mention JSON, fields, ids or section type names.`;

const TOOL = {
  name: 'update_funnel',
  description: 'Return the complete funnel content after the requested change, with a short note on what changed.',
  input_schema: {
    type: 'object',
    properties: {
      reply: { type: 'string', description: 'One or two short plain sentences on what changed.' },
      content: {
        type: 'object',
        properties: { landing: { type: 'array', items: { type: 'object' } }, form: { type: 'object' }, booked: { type: 'array', items: { type: 'object' } } },
        required: ['landing', 'form', 'booked'],
      },
    },
    required: ['reply', 'content'],
  },
};

export type AiEdit = { ok: true; content: FunnelContent; reply: string } | { ok: false; error: string };

export async function editFunnelWithAi(apiKey: string, body: { content: unknown; message: string; history?: unknown; page?: unknown }): Promise<AiEdit> {
  const message = body.message;
  const current = normalizeContent(body.content);
  const history = (Array.isArray(body.history) ? body.history : [])
    .filter((m): m is { role: string; text: string } => !!m && typeof m === 'object' && typeof (m as { text?: unknown }).text === 'string')
    .slice(-6)
    .map(m => `${m.role === 'user' ? 'They asked' : 'You answered'}: ${m.text.slice(0, 600)}`);

  const user = [
    history.length ? `Earlier in this conversation:\n${history.join('\n')}\n` : '',
    `The funnel as it stands now:\n${JSON.stringify(current)}`,
    `\nThey are looking at the ${body.page === 'booked' ? 'booked page' : 'landing page'}.`,
    `\nRequest: ${message}`,
  ].join('\n');

  let lastError = 'The AI did not answer.';
  for (const model of MODELS) {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model, max_tokens: 8000, system: SYSTEM, tools: [TOOL], tool_choice: { type: 'auto' },
        messages: [{ role: 'user', content: user }],
      }),
      signal: AbortSignal.timeout(90_000),
    }).catch(e => ({ ok: false, status: 0, json: async () => ({ error: { message: (e as Error).message } }) }) as unknown as Response);

    if (!res.ok) {
      const err = await res.json().catch(() => ({})) as { error?: { message?: string; type?: string } };
      lastError = err.error?.message ?? `The AI answered with an error (${res.status}).`;
      // An unknown model name: try the next one. Anything else is a real failure.
      if (res.status === 404 || /model/i.test(err.error?.message ?? '')) continue;
      break;
    }
    const out = await res.json() as { content?: { type: string; name?: string; input?: { reply?: unknown; content?: unknown } }[]; stop_reason?: string };
    const call = out.content?.find(c => c.type === 'tool_use' && c.name === TOOL.name);
    if (out.stop_reason === 'max_tokens') { lastError = 'The answer came back incomplete. Try a smaller change.'; break; }
    if (!call?.input?.content) {
      // It answered in words instead of changing anything: pass the words on, draft untouched.
      const said = (out.content ?? []).map(c => (c as { text?: string }).text ?? '').join(' ').trim();
      return { ok: true, content: current, reply: said.slice(0, 600) || 'Nothing was changed. Try saying it another way.' };
    }
    const next = normalizeContent(call.input.content);
    const reply = typeof call.input.reply === 'string' ? call.input.reply.trim().slice(0, 600) : '';
    if (JSON.stringify(next) === JSON.stringify(current)) {
      // Nothing changed: its own words say why (a missing video link, an unclear request).
      return { ok: true, content: current, reply: reply || 'Nothing was changed. Try saying exactly what should be different.' };
    }
    return {
      ok: true,
      content: next,
      reply: reply || 'Done.',
    };
  }
  return { ok: false, error: lastError };
}
