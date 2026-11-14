// Card vault — a client's card, kept for the owner to read back (adding it to
// the client's Facebook ad account). Server side. See NOTES.md 2026-11-14.
//
// The owner decided to keep full card details in the dashboard after being told
// it is not a certified card store. Given that, it is built so that no leak of
// our own systems is enough to read a card:
//
//   1. THE VAULT PASSWORD (lib/vault-crypto.ts, in the browser). Cards are
//      locked in the browser with a public key before they are sent here, and
//      can only be opened with a private key that is itself locked with a
//      password the owner chose and that is stored nowhere. This server never
//      sees that password, the private key, or a readable card — not when a
//      card is saved, not when it is shown.
//   2. THE SERVER KEY (CARD_VAULT_KEY, Railway V1 only). Everything is locked a
//      second time here before it reaches the database, so a copy of the
//      database alone is not even something to guess passwords against.
//
//   Database leak            → doubly-locked text. Nothing.
//   Railway leak (+database) → the inner locked cards and the locked private
//                              key. Still needs the vault password.
//   Vault password forgotten → nobody can open the cards again. By design.
//
// Around that: anyone with Onboarding access can save a card; only an admin can
// fetch one to open, at most 20 an hour; every save, opening, refusal and
// delete is logged; only the brand and last four digits are stored readable.
// No server key, or no vault password set yet = nothing can be saved.
//
// Tables card_vault, card_vault_keys, card_vault_log (migrations/add_onboarding.sql).

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import type { AuthContext } from './api-auth';

type Row = Record<string, unknown>;
type Sealed = { ciphertext: string; iv: string; tag: string };
type KeyMaterial = { wrapped_private: string; salt: string; iv: string; iterations: number };
type Envelope = { wk: string; iv: string; ct: string };

const FORMAT = 2;                 // 1 was server-key only (never held a card)
const OPENS_PER_HOUR = 20;
const BRANDS = ['Visa', 'Mastercard', 'Amex', 'Discover', 'Card'];

const json = (body: Row, status = 200) =>
  NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store, max-age=0' } });
const bad = (error: string, status = 400) => json({ error }, status);
const missing = (e: { message?: string } | null | undefined) =>
  !!e && /does not exist|schema cache|Could not find the table/i.test(e.message ?? '');
const NEEDS_SETUP = 'Card storage needs a one-off database update first';
const NOT_ON = 'Card storage is not switched on (it needs its server key)';
const NO_PASSWORD = 'The vault password has not been set yet — an admin sets it from any onboarding card';

/** The 32-byte server key, or null when unset or malformed (the feature is then off). */
function serverKey(): Buffer | null {
  const raw = (process.env.CARD_VAULT_KEY ?? '').trim();
  if (!raw) return null;
  const key = Buffer.from(raw, 'base64');
  return key.length === 32 ? key : null;
}
export const vaultEnabled = () => serverKey() !== null;

/** The second lock. `bind` ties the result to what it belongs to (a client id). */
function seal(value: unknown, bind: string): Sealed {
  const key = serverKey();
  if (!key) throw new Error(NOT_ON);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(bind));
  const body = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  return { ciphertext: body.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64') };
}

function unseal<T>(row: Sealed, bind: string): T | null {
  const key = serverKey();
  if (!key) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(row.iv, 'base64'));
    decipher.setAAD(Buffer.from(bind));
    decipher.setAuthTag(Buffer.from(row.tag, 'base64'));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(row.ciphertext, 'base64')), decipher.final()]).toString('utf8')) as T;
  } catch {
    return null;   // wrong server key, or the row was altered / moved
  }
}

const isB64 = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= max && /^[A-Za-z0-9+/=]+$/.test(v);

function readMaterial(body: Row): KeyMaterial | null {
  const iterations = Number(body.iterations);
  if (!isB64(body.wrapped_private, 8000) || !isB64(body.salt, 80) || !isB64(body.iv, 40)) return null;
  if (!Number.isInteger(iterations) || iterations < 100_000 || iterations > 5_000_000) return null;
  return { wrapped_private: body.wrapped_private, salt: body.salt, iv: body.iv, iterations };
}

function readEnvelope(v: unknown): Envelope | null {
  const e = (v ?? {}) as Row;
  return isB64(e.wk, 1200) && isB64(e.iv, 40) && isB64(e.ct, 4000) ? { wk: e.wk, iv: e.iv, ct: e.ct } : null;
}

async function who(ctx: AuthContext): Promise<{ name: string; admin: boolean }> {
  const [{ data: user }, { data: profile }] = await Promise.all([
    ctx.service.auth.admin.getUserById(ctx.userId).catch(() => ({ data: null })),
    ctx.service.from('profiles').select('is_admin').eq('id', ctx.userId).maybeSingle(),
  ]);
  return { name: (user?.user?.email ?? '').split('@')[0] || 'someone', admin: profile?.is_admin === true };
}

async function log(ctx: AuthContext, me: { name: string }, clientId: string | null, clientName: string, action: string) {
  await ctx.service.from('card_vault_log').insert({
    client_id: clientId, client_name: clientName, user_id: ctx.userId, user_name: me.name, action,
  });
}

async function readVault(ctx: AuthContext): Promise<{ row: (Row & Sealed) | null; error?: { message?: string } | null }> {
  const { data, error } = await ctx.service.from('card_vault_keys').select('public_key, ciphertext, iv, tag').eq('id', 1).maybeSingle();
  return { row: (data as (Row & Sealed) | null) ?? null, error };
}

const summary = (row: Row | null) => row ? {
  brand: row.brand ?? 'Card', last4: row.last4 ?? '', saved_by: row.saved_by_name ?? null, saved_at: row.updated_at ?? row.created_at ?? null,
} : null;

/** GET — is storage on, is the vault password set, and (for a client) is there a card. Never a card. */
export async function cardVaultGet(ctx: AuthContext, clientId: string | null) {
  const enabled = vaultEnabled();
  const vault = await readVault(ctx);
  if (vault.error) return missing(vault.error) ? json({ enabled, ready: false, error: NEEDS_SETUP }) : bad(vault.error.message ?? 'Could not reach the database', 500);
  const me = await who(ctx);
  const base = { enabled, ready: true, setup: !!vault.row, public_key: vault.row?.public_key ?? null, can_reveal: me.admin };
  if (!clientId) return json(base);

  const { data } = await ctx.service.from('card_vault')
    .select('brand, last4, saved_by_name, created_at, updated_at').eq('client_id', clientId).maybeSingle();
  let history: Row[] = [];
  if (me.admin) {
    const { data: rows } = await ctx.service.from('card_vault_log')
      .select('user_name, action, at').eq('client_id', clientId).order('at', { ascending: false }).limit(8);
    history = (rows ?? []) as Row[];
  }
  return json({ ...base, card: summary(data as Row | null), history });
}

/**
 * POST { action: 'setup',  public_key, wrapped_private, salt, iv, iterations }   admins, once
 *      { action: 'key' }                                                         admins — the locked private key
 *      { action: 'rewrap', wrapped_private, salt, iv, iterations }               admins — vault password changed
 *      { action: 'save',   client_id, envelope: { wk, iv, ct }, brand, last4 }   a card locked in the browser
 *      { action: 'open',   client_id }                                           admins — the locked card + locked key
 *      { action: 'delete', client_id }                                           admins
 * Nothing here can open a card: that takes the vault password, in the browser.
 */
export async function cardVaultPost(ctx: AuthContext, body: Row) {
  const { service } = ctx;
  const action = body.action;
  if (!vaultEnabled()) return bad(NOT_ON, 503);

  const vault = await readVault(ctx);
  if (vault.error) return missing(vault.error) ? bad(NEEDS_SETUP, 503) : bad(vault.error.message ?? 'Could not reach the database', 500);
  const me = await who(ctx);
  const adminOnly = action !== 'save';
  const clientId = typeof body.client_id === 'string' ? body.client_id : '';

  if (adminOnly && !me.admin) {
    await log(ctx, me, clientId || null, '', 'denied');
    return bad('Only an admin can do that', 403);
  }

  /* ── the vault itself ── */
  if (action === 'setup') {
    if (vault.row) return bad('The vault password is already set. Use "Change vault password".', 409);
    const material = readMaterial(body);
    if (!material || !isB64(body.public_key, 3000)) return bad('That did not look like a vault setup');
    const { error } = await service.from('card_vault_keys').insert({
      id: 1, public_key: body.public_key, ...seal(material, 'vault-key'), created_by: ctx.userId, created_by_name: me.name,
    });
    if (error) return bad(error.message ?? 'Could not set the vault password', 500);
    await log(ctx, me, null, 'Vault', 'vault_set');
    return json({ ok: true, public_key: body.public_key });
  }

  if (!vault.row) return bad(NO_PASSWORD, 409);
  const material = unseal<KeyMaterial>(vault.row, 'vault-key');
  if (action === 'key' || action === 'rewrap' || action === 'open') {
    if (!material) return bad('The vault could not be read — the server key has changed since it was set up', 500);
  }

  if (action === 'key') return json({ key: material });

  if (action === 'rewrap') {
    // Same lock, same cards: only the wrapping of the private key changes.
    const next = readMaterial(body);
    if (!next) return bad('That did not look like a vault password change');
    const { error } = await service.from('card_vault_keys').update({ ...seal(next, 'vault-key'), updated_at: new Date().toISOString() }).eq('id', 1);
    if (error) return bad(error.message ?? 'Could not change the vault password', 500);
    await log(ctx, me, null, 'Vault', 'password_changed');
    return json({ ok: true });
  }

  /* ── one client's card ── */
  if (!clientId) return bad('client_id is required');
  const { data: client } = await service.from('clients').select('id, name').eq('id', clientId).maybeSingle();
  if (!client) return bad('Client not found', 404);
  const clientName = String(client.name ?? '');

  if (action === 'save') {
    const envelope = readEnvelope(body.envelope);
    const brand = BRANDS.includes(String(body.brand)) ? String(body.brand) : 'Card';
    const last4 = typeof body.last4 === 'string' && /^\d{4}$/.test(body.last4) ? body.last4 : '';
    if (!envelope || !last4) return bad('That did not look like a locked card');

    const { data: before } = await service.from('card_vault').select('client_id').eq('client_id', clientId).maybeSingle();
    const row = {
      client_id: clientId, ...seal(envelope, clientId), key_version: FORMAT, brand, last4,
      saved_by: ctx.userId, saved_by_name: me.name, updated_at: new Date().toISOString(),
    };
    const { error } = await service.from('card_vault').upsert(row, { onConflict: 'client_id' });
    if (error) return bad(error.message ?? 'Could not save the card', 500);
    await log(ctx, me, clientId, clientName, before ? 'replaced' : 'saved');
    return json({ card: summary(row) });
  }

  if (action === 'delete') {
    const { error } = await service.from('card_vault').delete().eq('client_id', clientId);
    if (error) return bad(error.message ?? 'Could not delete the card', 500);
    await log(ctx, me, clientId, clientName, 'deleted');
    return json({ ok: true });
  }

  if (action === 'open') {
    const since = new Date(Date.now() - 3_600_000).toISOString();
    const { data: recent } = await service.from('card_vault_log').select('id')
      .eq('user_id', ctx.userId).eq('action', 'revealed').gte('at', since);
    if ((recent ?? []).length >= OPENS_PER_HOUR) return bad('Too many cards opened in the last hour. Try again later.', 429);

    const { data: row } = await service.from('card_vault').select('ciphertext, iv, tag, key_version').eq('client_id', clientId).maybeSingle();
    if (!row) return bad('No card saved for this client', 404);
    const envelope = unseal<Envelope>(row as Sealed, clientId);
    if (!envelope || !envelope.wk) return bad('This card could not be read — the server key has changed since it was saved, or the record was altered', 500);
    await log(ctx, me, clientId, clientName, 'revealed');
    return json({ envelope, key: material });
  }

  return bad('Unknown action');
}
