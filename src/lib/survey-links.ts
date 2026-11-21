// Client survey links (NOTES.md 2026-11-20). Server side.
//
// Page one of the New Client Survey — service, price per appointment, prepaid
// appointments, cash collected — is filled in by us, signed in, and saved in
// survey_links with a long random token. The client gets /survey/<token> and
// fills in everything else without signing in. On submit, page one is taken
// from the link, never from what the browser sends, so a client cannot change
// their own price or prepaid count. Then the survey does what it always did
// (client-survey-server.ts → submitSurvey), as the person who made the link:
// their Client Billing access decides whether the prepaid credits are issued.
//
// A link is used once, and expires after 30 days. Right after submitting, the
// client's page may save one card to the card vault for that client — locked in
// their browser, exactly like any other card (lib/card-vault.ts); it can only
// ever add a card, never read, replace or delete one.

import { randomBytes } from 'node:crypto';
import type { AuthContext } from './api-auth';
import { cardVaultPost, vaultEnabled } from './card-vault';
import { SETUP_FIELDS, cleanAnswers, serviceOf, setupAnswers, setupProblem, type Answers } from './client-survey';
import { submitSurvey, whoIs, type Outcome } from './client-survey-server';
import { tablesMissing } from './onboarding-server';

type Service = AuthContext['service'];
type Row = Record<string, unknown>;
type Link = {
  id: string; token: string; setup: Answers; created_by: string; created_by_name: string | null;
  client_id: string | null; submitted_at: string | null; card_saved_at: string | null; expires_at: string;
};

const fail = (error: string, status = 400): Outcome => ({ status, json: { error } });
const NEEDS_SETUP = 'Survey links need a one-off database update first (node scripts/migrate-onboarding.mjs v1)';
const now = () => new Date().toISOString();
/** How long after submitting the client's page may still add their card. */
const CARD_WINDOW_MS = 2 * 60 * 60 * 1000;
const TOKEN = /^[A-Za-z0-9_-]{24,64}$/;

/* ── signed in: making and listing links ── */

/** Page one → a link for the client. */
export async function createLink(ctx: AuthContext, body: Row): Promise<Outcome> {
  const setup = setupAnswers(cleanAnswers(body.answers));
  const problem = setupProblem(setup);
  if (problem) return fail(problem);
  const token = randomBytes(24).toString('base64url');
  const { data, error } = await ctx.service.from('survey_links')
    .insert({ token, setup, created_by: ctx.userId, created_by_name: await whoIs(ctx) })
    .select('id, token, setup, created_by_name, created_at, expires_at').single();
  if (error) return tablesMissing(error) ? fail(NEEDS_SETUP, 503) : fail(error.message ?? 'Could not make the link', 500);
  return { status: 200, json: { link: data } };
}

/** Links sent out that the client has not filled in yet. */
export async function waitingLinks(service: Service): Promise<Outcome> {
  const { data, error } = await service.from('survey_links')
    .select('id, token, setup, created_by_name, created_at, expires_at')
    .is('submitted_at', null).gt('expires_at', now()).order('created_at', { ascending: false });
  if (error) return tablesMissing(error) ? { status: 200, json: { ready: false, links: [] } } : fail(error.message ?? 'Could not read the links', 500);
  return { status: 200, json: { ready: true, links: data ?? [] } };
}

export async function deleteLink(service: Service, id: unknown): Promise<Outcome> {
  if (typeof id !== 'string' || !id) return fail('id is required');
  const { error } = await service.from('survey_links').delete().eq('id', id).is('submitted_at', null);
  if (error) return fail(error.message ?? 'Could not delete the link', 500);
  return { status: 200, json: { ok: true } };
}

/** What the last link for this client did, in words — shown on their submitted survey. */
export async function linkNotes(service: Service, clientId: string): Promise<{ done: string[]; warnings: string[] } | null> {
  const { data } = await service.from('survey_links').select('result').eq('client_id', clientId)
    .not('submitted_at', 'is', null).order('submitted_at', { ascending: false }).limit(1);
  const r = ((data ?? [])[0] as { result?: Row | null } | undefined)?.result;
  if (!r) return null;
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
  return { done: list(r.done), warnings: list(r.warnings) };
}

/* ── public: the client's page ── */

async function readLink(service: Service, token: unknown): Promise<Link | null> {
  if (typeof token !== 'string' || !TOKEN.test(token)) return null;
  const { data } = await service.from('survey_links')
    .select('id, token, setup, created_by, created_by_name, client_id, submitted_at, card_saved_at, expires_at')
    .eq('token', token).maybeSingle();
  return (data as Link | null) ?? null;
}
const expired = (l: Link) => new Date(l.expires_at).getTime() < Date.now();
const NOT_VALID = 'This link is not valid. Ask us for a new one.';

/** What the client's page needs: is the link still open, which service (it changes a question), and the card lock. */
export async function linkStatus(service: Service, token: unknown): Promise<Outcome> {
  const link = await readLink(service, token);
  if (!link) return fail(NOT_VALID, 404);
  if (link.submitted_at) return { status: 200, json: { submitted: true } };
  if (expired(link)) return fail('This link has expired. Ask us for a new one.', 410);
  let publicKey: string | null = null;
  if (vaultEnabled()) {
    const { data } = await service.from('card_vault_keys').select('public_key').eq('id', 1).maybeSingle();
    publicKey = (data as { public_key?: string | null } | null)?.public_key ?? null;
  }
  return { status: 200, json: { submitted: false, service: serviceOf(link.setup), card: { on: !!publicKey, public_key: publicKey } } };
}

/** The client sends the survey. Page one comes from the link. */
export async function submitFromLink(service: Service, token: unknown, answers: unknown): Promise<Outcome> {
  const link = await readLink(service, token);
  if (!link) return fail(NOT_VALID, 404);
  if (link.submitted_at) return fail('This survey has already been sent.', 409);
  if (expired(link)) return fail('This link has expired. Ask us for a new one.', 410);

  // Claimed first, so the same link cannot set a client up twice at once.
  const { data: claimed } = await service.from('survey_links')
    .update({ submitted_at: now() }).eq('id', link.id).is('submitted_at', null).select('id');
  if (!claimed?.length) return fail('This survey has already been sent.', 409);

  const fromClient = cleanAnswers(answers);
  for (const f of SETUP_FIELDS) delete fromClient[f.key];
  const merged = cleanAnswers({ ...fromClient, ...link.setup });

  let result: Outcome;
  try {
    result = await submitSurvey({ service, userId: link.created_by }, { answers: merged });
  } catch {
    result = fail('Something went wrong', 500);
  }
  if (result.status !== 200) {
    await service.from('survey_links').update({ submitted_at: null }).eq('id', link.id);
    return fail(String(result.json.error ?? 'Could not send the survey'), result.status);
  }
  const j = result.json as Row;
  const clientId = String((j.client as Row | undefined)?.id ?? '');
  await service.from('survey_links').update({
    client_id: clientId || null,
    result: { done: j.done ?? [], warnings: j.warnings ?? [], stripe: j.stripe ?? null, client: j.client ?? null, ghl: j.ghl ?? null },
  }).eq('id', link.id);
  // The client is told only what their own page needs: who the card is for.
  return { status: 200, json: { ok: true, client_id: clientId } };
}

/** Right after submitting: one card, locked in the client's browser, added to the vault for that client. */
export async function cardFromLink(service: Service, token: unknown, body: Row): Promise<Outcome> {
  const link = await readLink(service, token);
  if (!link || !link.submitted_at || !link.client_id) return fail(NOT_VALID, 404);
  if (link.card_saved_at) return fail('A card has already been saved from this link.', 409);
  if (Date.now() - new Date(link.submitted_at).getTime() > CARD_WINDOW_MS) return fail('This link can no longer add a card. Ask us for help.', 410);

  const { data: claimed } = await service.from('survey_links')
    .update({ card_saved_at: now() }).eq('id', link.id).is('card_saved_at', null).select('id');
  if (!claimed?.length) return fail('A card has already been saved from this link.', 409);

  // Always a new slot: a link can add a card, never replace one.
  const res = await cardVaultPost({ service, userId: link.created_by }, {
    action: 'save', client_id: link.client_id, envelope: body.envelope, brand: body.brand, last4: body.last4, slot: 'new',
  });
  const out = await res.json().catch(() => ({})) as Row;
  if (!res.ok) {
    await service.from('survey_links').update({ card_saved_at: null }).eq('id', link.id);
    return fail(String(out.error ?? 'The card could not be saved'), res.status);
  }
  return { status: 200, json: { ok: true } };
}
