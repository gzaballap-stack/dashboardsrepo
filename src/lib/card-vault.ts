// Card vault — a client's card, kept encrypted, for the owner to read back
// (adding it to the client's Facebook ad account). Server-side only.
//
// The owner decided on 2026-11-14 to keep full card details in the dashboard
// after being told it is not a certified card store (see NOTES.md, that date).
// Given that, this is built to leak as little as it can:
//
//   • Encrypted with AES-256-GCM under CARD_VAULT_KEY, which lives only in the
//     server's environment — never in the database, the repo or a backup of
//     either. A copy of the database alone shows nothing but scrambled text.
//   • Each record is tied to its client: a row copied onto another client will
//     not decrypt.
//   • Only the brand and last four digits are stored readable.
//   • Anyone with Onboarding access can save a card; reading one back takes an
//     admin who re-enters their own password, five wrong tries locks them out
//     for fifteen minutes, and every save, view, refusal and delete is logged.
//   • The full card is never part of any other response, and is never logged.
//   • No key set = the feature is off: nothing can be saved or read (V2).
//
// Tables card_vault + card_vault_log (migrations/add_onboarding.sql).

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import type { AuthContext } from './api-auth';
import { brandOf, cardProblem, tidyCard, type CardInput } from './card-format';

type Row = Record<string, unknown>;
const KEY_VERSION = 1;
const MAX_WRONG = 5;
const LOCK_MINUTES = 15;

const json = (body: Row, status = 200) =>
  NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store, max-age=0' } });
const bad = (error: string, status = 400) => json({ error }, status);
const missing = (e: { message?: string } | null | undefined) =>
  !!e && /does not exist|schema cache|Could not find the table/i.test(e.message ?? '');
const NEEDS_SETUP = 'Card storage needs a one-off database update first (node scripts/migrate-onboarding.mjs v1)';
const NOT_ON = 'Card storage is not switched on (it needs its encryption key)';

/** The 32-byte key, or null when it is unset or malformed (the feature is then off). */
function vaultKey(): Buffer | null {
  const raw = (process.env.CARD_VAULT_KEY ?? '').trim();
  if (!raw) return null;
  const key = Buffer.from(raw, 'base64');
  return key.length === 32 ? key : null;
}
export const vaultEnabled = () => vaultKey() !== null;

function seal(card: CardInput, clientId: string) {
  const key = vaultKey();
  if (!key) throw new Error(NOT_ON);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(clientId));
  const body = Buffer.concat([cipher.update(JSON.stringify(card), 'utf8'), cipher.final()]);
  return { ciphertext: body.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64') };
}

function unseal(row: { ciphertext: string; iv: string; tag: string }, clientId: string): CardInput | null {
  const key = vaultKey();
  if (!key) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(row.iv, 'base64'));
    decipher.setAAD(Buffer.from(clientId));
    decipher.setAuthTag(Buffer.from(row.tag, 'base64'));
    const plain = Buffer.concat([decipher.update(Buffer.from(row.ciphertext, 'base64')), decipher.final()]).toString('utf8');
    return JSON.parse(plain) as CardInput;
  } catch {
    return null;   // wrong key, or the row was tampered with / moved
  }
}

/** Checks the admin's own password without touching the session they are signed in with. */
async function checkPassword(email: string, password: string): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL, anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return false;
  const client = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session) return false;
  // Close only the throwaway session this check opened — never the person's own.
  await client.auth.signOut({ scope: 'local' }).catch(() => {});
  return true;
}

export type VaultDeps = { checkPassword?: (email: string, password: string) => Promise<boolean> };

async function who(ctx: AuthContext): Promise<{ email: string; name: string; admin: boolean }> {
  const [{ data: user }, { data: profile }] = await Promise.all([
    ctx.service.auth.admin.getUserById(ctx.userId).catch(() => ({ data: null })),
    ctx.service.from('profiles').select('is_admin').eq('id', ctx.userId).maybeSingle(),
  ]);
  const email = user?.user?.email ?? '';
  return { email, name: email.split('@')[0] || 'someone', admin: profile?.is_admin === true };
}

async function log(ctx: AuthContext, me: { name: string }, clientId: string, clientName: string, action: string) {
  await ctx.service.from('card_vault_log').insert({
    client_id: clientId, client_name: clientName, user_id: ctx.userId, user_name: me.name, action,
  });
}

const summary = (row: Row | null) => row ? {
  brand: row.brand ?? 'Card', last4: row.last4 ?? '', saved_by: row.saved_by_name ?? null, saved_at: row.updated_at ?? row.created_at ?? null,
} : null;

/** GET — is storage on, and (for a client) is there a card. Never the card itself. */
export async function cardVaultGet(ctx: AuthContext, clientId: string | null) {
  const enabled = vaultEnabled();
  const probe = await ctx.service.from('card_vault').select('client_id').limit(1);
  if (probe.error) return missing(probe.error) ? json({ enabled, ready: false, error: NEEDS_SETUP }) : bad(probe.error.message ?? 'Could not reach the database', 500);
  if (!clientId) return json({ enabled, ready: true });

  const me = await who(ctx);
  const { data } = await ctx.service.from('card_vault')
    .select('brand, last4, saved_by_name, created_at, updated_at').eq('client_id', clientId).maybeSingle();
  let history: Row[] = [];
  if (me.admin) {
    const { data: rows } = await ctx.service.from('card_vault_log')
      .select('user_name, action, at').eq('client_id', clientId).order('at', { ascending: false }).limit(8);
    history = (rows ?? []) as Row[];
  }
  return json({ enabled, ready: true, card: summary(data as Row | null), can_reveal: me.admin, history });
}

/**
 * POST { action: 'save',   client_id, card: { name, number, exp, cvc, zip } }
 *      { action: 'reveal', client_id, password }     admins; the only way a card is ever read back
 *      { action: 'delete', client_id }               admins
 */
export async function cardVaultPost(ctx: AuthContext, body: Row, deps: VaultDeps = {}) {
  const { service } = ctx;
  const action = body.action;
  const clientId = typeof body.client_id === 'string' ? body.client_id : '';
  if (!clientId) return bad('client_id is required');
  if (!vaultEnabled()) return bad(NOT_ON, 503);

  const { data: client } = await service.from('clients').select('id, name').eq('id', clientId).maybeSingle();
  if (!client) return bad('Client not found', 404);
  const clientName = String(client.name ?? '');
  const me = await who(ctx);

  if (action === 'save') {
    const input = (body.card ?? {}) as Partial<CardInput>;
    const card = tidyCard({ name: String(input.name ?? ''), number: String(input.number ?? ''), exp: String(input.exp ?? ''), cvc: String(input.cvc ?? ''), zip: String(input.zip ?? '') });
    const problem = cardProblem(card);
    if (problem) return bad(problem);

    const { data: before, error: readErr } = await service.from('card_vault').select('client_id').eq('client_id', clientId).maybeSingle();
    if (readErr) return missing(readErr) ? bad(NEEDS_SETUP, 503) : bad(readErr.message ?? 'Could not save the card', 500);
    const row = {
      client_id: clientId, ...seal(card, clientId), key_version: KEY_VERSION,
      brand: brandOf(card.number), last4: card.number.slice(-4),
      saved_by: ctx.userId, saved_by_name: me.name, updated_at: new Date().toISOString(),
    };
    const { error } = await service.from('card_vault').upsert(row, { onConflict: 'client_id' });
    if (error) return bad(error.message ?? 'Could not save the card', 500);
    await log(ctx, me, clientId, clientName, before ? 'replaced' : 'saved');
    return json({ card: summary({ ...row, saved_by_name: me.name }) });
  }

  if (action !== 'reveal' && action !== 'delete') return bad('Unknown action');
  if (!me.admin) {
    await log(ctx, me, clientId, clientName, 'denied');
    return bad('Only an admin can do that', 403);
  }

  if (action === 'delete') {
    const { error } = await service.from('card_vault').delete().eq('client_id', clientId);
    if (error) return bad(error.message ?? 'Could not delete the card', 500);
    await log(ctx, me, clientId, clientName, 'deleted');
    return json({ ok: true });
  }

  // reveal
  const since = new Date(Date.now() - LOCK_MINUTES * 60_000).toISOString();
  const { data: wrong } = await service.from('card_vault_log').select('id')
    .eq('user_id', ctx.userId).eq('action', 'denied').gte('at', since);
  if ((wrong ?? []).length >= MAX_WRONG) return bad(`Too many wrong passwords. Try again in ${LOCK_MINUTES} minutes.`, 429);

  const password = typeof body.password === 'string' ? body.password : '';
  const ok = !!password && !!me.email && await (deps.checkPassword ?? checkPassword)(me.email, password);
  if (!ok) {
    await log(ctx, me, clientId, clientName, 'denied');
    return bad('That password is not right', 401);
  }

  const { data: row } = await service.from('card_vault').select('ciphertext, iv, tag').eq('client_id', clientId).maybeSingle();
  if (!row) return bad('No card saved for this client', 404);
  const card = unseal(row as { ciphertext: string; iv: string; tag: string }, clientId);
  if (!card) return bad('This card could not be read — the encryption key has changed since it was saved, or the record was altered', 500);
  await log(ctx, me, clientId, clientName, 'revealed');
  return json({ card });
}
