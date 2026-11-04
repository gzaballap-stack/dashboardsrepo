import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';

// SMS reply intent — replaces the VA who read every reply to a B2C blast and
// tagged the contact. One Claude call per inbound text, then a tag in GHL.
// GHL workflows keyed on those tags send the follow-up (see NOTES.md 2026-11-04).

export const SMS_INTENTS = [
  'interested',      // wants the free estimate / yes / asks how to book / gives a time
  'question',        // asks something before deciding (who is this, cost, areas, what's included)
  'later',           // not right now, maybe in a few months, call back later
  'not_interested',  // no, not needed, already done, renting
  'wrong_number',    // wrong person, doesn't own the property, moved, no such person
  'stop',            // opt out, remove me, stop texting, hostile
  'unclear',         // can't tell: emoji only, unrelated, gibberish
  'needs_review',    // the classifier failed — a human should read it
] as const;
export type SmsIntent = (typeof SMS_INTENTS)[number];

/** The GHL tag each intent puts on the contact. */
export const SMS_INTENT_TAGS: Record<SmsIntent, string> = {
  interested: 'sms-interested',
  question: 'sms-question',
  later: 'sms-later',
  not_interested: 'sms-not-interested',
  wrong_number: 'sms-wrong-number',
  stop: 'sms-stop',
  unclear: 'sms-unclear',
  needs_review: 'sms-needs-review',
};
export const SMS_REVIEW_TAG = SMS_INTENT_TAGS.needs_review;
const ALL_INTENT_TAGS = Object.values(SMS_INTENT_TAGS);

const Classification = z.object({
  intent: z.enum(['interested', 'question', 'later', 'not_interested', 'wrong_number', 'stop', 'unclear']),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
  suggested_reply: z.string(),
});

export type SmsClassification = z.infer<typeof Classification>;

const SYSTEM = `You classify text-message replies for a home-remodelling lead-generation service.

Context: a kitchen and bathroom remodelling contractor texted homeowners (sourced from property records) something like: "Hey, we're looking for people in the area to do a free kitchen and bathroom estimate. Would you be interested?" You are reading the homeowner's reply.

Pick exactly one intent:
- interested: wants the estimate, says yes, asks how to book, gives availability, asks to be called.
- question: asks something before deciding (who is this, how did you get my number, what does it cost, what areas, what's included). Not a yes yet.
- later: not now but maybe in the future — "not right now", "maybe next year", "text me in the spring".
- not_interested: a clear no — not needed, already done, renting, no thanks. Not hostile, not opting out.
- wrong_number: wrong person, doesn't own the property, moved, "who?" with a different name.
- stop: opt out or hostile — stop, remove me, unsubscribe, don't text me, profanity aimed at us.
- unclear: can't tell — emoji only, unrelated, gibberish, blank, or an auto-reply.

Rules:
- "Yes" / "sure" / "ok" / "interested" / "how much" with intent to proceed → interested.
- A single "?" or "who is this" → question.
- Treat "STOP" / "stop" alone as stop, always.
- confidence is 0 to 1: how sure you are of the intent.
- suggested_reply: one short, friendly SMS (under 300 characters) a setter could send next. For interested: ask for the best day/time and confirm the address is theirs. For question: answer briefly and re-offer the free estimate. For later: say you'll check back and thank them. For not_interested / wrong_number / stop: a one-line polite close (for stop, just confirm removal). For unclear: a short clarifying question. Never promise prices.`;

export function anthropicClient(): Anthropic | null {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  return new Anthropic({ apiKey, maxRetries: 2, timeout: 30_000 });
}

/**
 * Classify one inbound reply. Throws on API failure so the caller can file the
 * row as needs_review rather than guessing.
 */
export async function classifySmsReply(
  client: Anthropic,
  message: string,
  opts: { outboundMessage?: string | null; clientName?: string | null } = {},
): Promise<SmsClassification> {
  const lines: string[] = [];
  if (opts.clientName) lines.push(`Contractor: ${opts.clientName}`);
  if (opts.outboundMessage) lines.push(`Our outbound text: ${JSON.stringify(opts.outboundMessage)}`);
  lines.push(`Homeowner's reply: ${JSON.stringify(message)}`);

  const response = await client.messages.parse({
    model: 'claude-opus-5-5',
    max_tokens: 1024,
    output_config: { effort: 'low', format: zodOutputFormat(Classification) },
    system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: lines.join('\n') }],
  });

  if (response.stop_reason === 'refusal' || !response.parsed_output) {
    throw new Error(`classifier returned no result (stop_reason=${response.stop_reason})`);
  }
  return response.parsed_output;
}

// ─── GHL tags ────────────────────────────────────────────────────────────────

const GHL_BASE = 'https://services.leadconnectorhq.com';
const GHL_VERSION = '2021-07-28';

/** The Private Integration token for the SMS sub-account (falls back to the client key). */
export function smsGhlKey(): string | null {
  return process.env.GHL_API_KEY_SMS || process.env.GHL_API_KEY || null;
}

async function ghlTags(method: 'POST' | 'DELETE', key: string, contactId: string, tags: string[]) {
  const res = await fetch(`${GHL_BASE}/contacts/${encodeURIComponent(contactId)}/tags`, {
    method,
    headers: { Authorization: `Bearer ${key}`, Version: GHL_VERSION, 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ tags }),
  });
  if (!res.ok) throw new Error(`GHL ${method} tags ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

/**
 * Put the intent tag on the contact and take the other intent tags off, so the
 * contact always carries exactly one current SMS intent. Low confidence adds
 * the review tag on top so a human double-checks it.
 */
export async function tagGhlContact(
  key: string,
  contactId: string,
  intent: SmsIntent,
  opts: { needsReview?: boolean } = {},
): Promise<{ added: string[]; removed: string[] }> {
  const added = [SMS_INTENT_TAGS[intent]];
  if (opts.needsReview && intent !== 'needs_review') added.push(SMS_REVIEW_TAG);
  const removed = ALL_INTENT_TAGS.filter(t => !added.includes(t));
  // Remove first, then add: GHL dedupes tags, and a failed DELETE should not
  // leave the contact with no intent tag at all.
  try { await ghlTags('DELETE', key, contactId, removed); } catch (e) { console.warn('[sms-intent] tag removal failed', (e as Error).message); }
  await ghlTags('POST', key, contactId, added);
  return { added, removed };
}
