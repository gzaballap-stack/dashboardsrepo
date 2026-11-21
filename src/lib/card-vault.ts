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
//   Vault password forgotten → the RECOVERY CODE (2026-11-20): a long random
//                              code made in the browser when the password is
//                              set and shown once. A second copy of the private
//                              key, locked with it, is kept here under the
//                              server key. It sets a new password; it is never
//                              sent to this server. Both lost → nobody can open
//                              the cards again. By design: there is no email
//                              reset, because a server that could reset the
//                              password could open the cards.
//
// Around that: anyone with Onboarding access can save a card; only an admin can
// fetch one to open, at most 20 an hour; every save, opening, refusal and
// delete is logged; only the brand and last four digits are stored readable.
// No server key, or no vault password set yet = nothing can be saved.
//
// FINGERPRINT UNLOCK (2026-11-18): an admin who knows the vault password can
// let their own device open the vault with Touch ID / Face ID. The device keeps
// a secret; a second copy of the private key, locked with that secret, is kept
// here (card_vault_passkeys) under the server key like everything else. This
// server can open that copy no more than it can open the password one. Changing
// the vault password turns fingerprint unlock off for everyone.
//
// MORE THAN ONE CARD (2026-11-20): a client can have up to MAX_CARDS, each in
// its own numbered slot (card_vault.slot). Every card is locked exactly the
// same way; nothing about the locks changed.
//
// PAST CLIENTS (2026-11-20): someone who is not on the Client Roster — only
// their survey is kept (past_client_surveys) — can have cards too, by the
// owner's choice. Their cards sit in card_vault_past, keyed by the survey's id
// instead of a client's. Same two locks, same rules, same log; the roster
// clients' table is not touched.
//
// Tables card_vault, card_vault_past, card_vault_keys, card_vault_passkeys,
// card_vault_log (migrations/add_onboarding.sql).

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { NextResponse } from 'next/server';
import type { AuthContext } from './api-auth';

type Row = Record<string, unknown>;
type Sealed = { ciphertext: string; iv: string; tag: string };
type KeyMaterial = { wrapped_private: string; salt: string; iv: string; iterations: number };
type Envelope = { wk: string; iv: string; ct: string };
type PasskeyWrap = { wrapped_private: string; iv: string };
type KeyCopy = PasskeyWrap;

const FORMAT = 2;                 // 1 was server-key only (never held a card)
const OPENS_PER_HOUR = 20;
const PASSKEYS_PER_USER = 10;
const MAX_CARDS = 5;              // per client (card_vault.slot is checked 1–5 in the database too)
const BRANDS = ['Visa', 'Mastercard', 'Amex', 'Discover', 'Card'];

const json = (body: Row, status = 200) =>
  NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store, max-age=0' } });
const bad = (error: string, status = 400) => json({ error }, status);
const missing = (e: { message?: string } | null | undefined) =>
  !!e && /does not exist|schema cache|Could not find the table/i.test(e.message ?? '');
const NEEDS_SETUP = 'Card storage needs a one-off database update first';
const NOT_ON = 'Card storage is not switched on (it needs its server key)';
const NO_PASSWORD = 'The vault password has not been set yet — an admin sets it from any client in Submitted Surveys';

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

/**
 * Whose card it is: a roster client, or a past client (their saved survey).
 * `key` is what the card is locked to — the browser ties its lock to the same
 * text, so a card can never be read back under anyone else's name.
 */
type Owner = { kind: 'client' | 'past'; id: string; name: string; table: 'card_vault' | 'card_vault_past'; col: 'client_id' | 'past_id'; key: string };
const clientOwner = (id: string, name = ''): Owner => ({ kind: 'client', id, name, table: 'card_vault', col: 'client_id', key: id });
const pastOwner = (id: string, name = ''): Owner => ({ kind: 'past', id, name, table: 'card_vault_past', col: 'past_id', key: `past:${id}` });

/** What a stored card is tied to. Slot 1 keeps the tie it had before clients could have several. */
const cardBind = (owner: Owner, slot: number) => (slot === 1 ? owner.key : `${owner.key}:${slot}`);
const readSlot = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= MAX_CARDS ? v : null);

const isB64 = (v: unknown, max: number): v is string => typeof v === 'string' && v.length > 0 && v.length <= max && /^[A-Za-z0-9+/=]+$/.test(v);

function readMaterial(body: Row): KeyMaterial | null {
  const iterations = Number(body.iterations);
  if (!isB64(body.wrapped_private, 8000) || !isB64(body.salt, 80) || !isB64(body.iv, 40)) return null;
  if (!Number.isInteger(iterations) || iterations < 100_000 || iterations > 5_000_000) return null;
  return { wrapped_private: body.wrapped_private, salt: body.salt, iv: body.iv, iterations };
}

function readCopy(v: unknown): KeyCopy | null {
  const c = (v ?? {}) as Row;
  return isB64(c.wrapped_private, 8000) && isB64(c.iv, 40) ? { wrapped_private: c.wrapped_private, iv: c.iv } : null;
}
const RECOVERY_BIND = 'vault-recovery';
const recoveryColumns = (copy: KeyCopy) => {
  const sealed = seal(copy, RECOVERY_BIND);
  return { recovery_ciphertext: sealed.ciphertext, recovery_iv: sealed.iv, recovery_tag: sealed.tag, recovery_at: new Date().toISOString() };
};

/** The recovery copy of the key. `ready: false` = the columns are not there yet. */
async function readRecovery(ctx: AuthContext): Promise<{ ready: boolean; copy: KeyCopy | null }> {
  const { data, error } = await ctx.service.from('card_vault_keys').select('recovery_ciphertext, recovery_iv, recovery_tag').eq('id', 1).maybeSingle();
  if (error) return { ready: false, copy: null };
  const row = data as Row | null;
  if (!row?.recovery_ciphertext) return { ready: true, copy: null };
  return { ready: true, copy: unseal<KeyCopy>({ ciphertext: String(row.recovery_ciphertext), iv: String(row.recovery_iv), tag: String(row.recovery_tag) }, RECOVERY_BIND) };
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
/** The same log, for a card that belongs to a roster client or a past client. */
async function logFor(ctx: AuthContext, me: { name: string }, owner: Owner, action: string) {
  if (owner.kind === 'client') return log(ctx, me, owner.id, owner.name, action);
  await ctx.service.from('card_vault_log').insert({
    past_id: owner.id, client_name: owner.name, user_id: ctx.userId, user_name: me.name, action,
  });
}

async function readVault(ctx: AuthContext): Promise<{ row: (Row & Sealed) | null; error?: { message?: string } | null }> {
  const { data, error } = await ctx.service.from('card_vault_keys').select('public_key, ciphertext, iv, tag').eq('id', 1).maybeSingle();
  return { row: (data as (Row & Sealed) | null) ?? null, error };
}

/** What ties a fingerprint copy of the key to one admin and one device. */
const passkeyBind = (userId: string, credentialId: string) => `passkey:${userId}:${credentialId}`;

/** This admin's devices with fingerprint unlock on. `ready: false` = the table is not there yet. */
async function myPasskeys(ctx: AuthContext): Promise<{ ready: boolean; credentials: Row[] }> {
  const { data, error } = await ctx.service.from('card_vault_passkeys').select('credential_id, rp_id').eq('user_id', ctx.userId);
  return error ? { ready: false, credentials: [] } : { ready: true, credentials: (data ?? []) as Row[] };
}

const summary = (row: Row | null) => row ? {
  slot: Number(row.slot ?? 1), brand: row.brand ?? 'Card', last4: row.last4 ?? '', saved_by: row.saved_by_name ?? null, saved_at: row.updated_at ?? row.created_at ?? null,
} : null;

/** A client's cards, in slot order — what is readable of them. On a database without slots yet, the one card. */
async function readCards(ctx: AuthContext, owner: Owner): Promise<Row[]> {
  const cols = 'brand, last4, saved_by_name, created_at, updated_at';
  const { data, error } = await ctx.service.from(owner.table).select(`slot, ${cols}`).eq(owner.col, owner.id).order('slot');
  if (!error) return (data ?? []) as Row[];
  if (owner.kind === 'past') return [];   // a database without the past clients' table yet
  const { data: old } = await ctx.service.from('card_vault').select(cols).eq('client_id', owner.id);
  return (old ?? []) as Row[];
}

/** GET — is storage on, is the vault password set, and (for a client) is there a card. Never a card. */
export async function cardVaultGet(ctx: AuthContext, clientId: string | null, pastId: string | null = null) {
  const enabled = vaultEnabled();
  const vault = await readVault(ctx);
  if (vault.error) return missing(vault.error) ? json({ enabled, ready: false, error: NEEDS_SETUP }) : bad(vault.error.message ?? 'Could not reach the database', 500);
  const me = await who(ctx);
  // Only an admin has any use for these: who they are (to name the passkey) and
  // which of their devices can open the vault by fingerprint.
  // …and whether a recovery code exists (null = that part of the database is not there yet).
  const recovery = me.admin && enabled && vault.row ? await readRecovery(ctx) : null;
  const mine = me.admin && enabled && vault.row
    ? { me: { id: ctx.userId, name: me.name }, fingerprint: await myPasskeys(ctx), recovery: recovery?.ready ? !!recovery.copy : null } : {};
  const base = { enabled, ready: true, setup: !!vault.row, public_key: vault.row?.public_key ?? null, can_reveal: me.admin, ...mine };
  if (!clientId && !pastId) return json(base);

  const owner = pastId ? pastOwner(pastId) : clientOwner(clientId as string);
  const cards = (await readCards(ctx, owner)).map(summary);
  let history: Row[] = [];
  if (me.admin) {
    const { data: rows } = await ctx.service.from('card_vault_log')
      .select('user_name, action, at').eq(owner.col, owner.id).order('at', { ascending: false }).limit(12);
    history = (rows ?? []) as Row[];
  }
  return json({ ...base, cards, max_cards: MAX_CARDS, card: cards[0] ?? null, history });
}

/**
 * POST { action: 'setup',  public_key, wrapped_private, salt, iv, iterations }   admins, once
 *      { action: 'key' }                                                         admins — the locked private key
 *      { action: 'rewrap', wrapped_private, salt, iv, iterations, via? }         admins — vault password changed (via: 'recovery' = reset with the recovery code)
 *      { action: 'recovery_set', recovery: { wrapped_private, iv } }             admins — a new recovery code (the old one stops working)
 *      { action: 'recovery_key' }                                                admins — the recovery copy of the key, still locked
 *      { action: 'save',   client_id, envelope: { wk, iv, ct }, brand, last4, slot? }   a card locked in the browser
 *                          slot: a number = replace that card · 'new' = one more card · left out = the first card
 *      { action: 'open',   client_id, slot? }                                    admins — the locked card + locked key
 *      { action: 'open',   client_id, slot?, credential_id }                     admins — the locked card + their fingerprint copy of the key
 *      { action: 'passkey_add', credential_id, rp_id, wrapped_private, iv }      admins — fingerprint unlock on for this device
 *      { action: 'passkey_remove' }                                              admins — fingerprint unlock off (their own devices)
 *      { action: 'delete', client_id, slot? }                                    admins
 * A slot left out is the first card (1).
 * Every card action takes `past_id` in place of `client_id` for a past client
 * (the id of their saved survey) — same rules.
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
  const pastId = typeof body.past_id === 'string' ? body.past_id : '';

  if (adminOnly && !me.admin) {
    if (pastId && !clientId) await logFor(ctx, me, pastOwner(pastId), 'denied');
    else await log(ctx, me, clientId || null, '', 'denied');
    return bad('Only an admin can do that', 403);
  }

  /* ── the vault itself ── */
  if (action === 'setup') {
    if (vault.row) return bad('The vault password is already set. Use "Change vault password".', 409);
    const material = readMaterial(body);
    const recovery = body.recovery === undefined ? null : readCopy(body.recovery);
    if (!material || !isB64(body.public_key, 3000) || (body.recovery !== undefined && !recovery)) return bad('That did not look like a vault setup');
    const { error } = await service.from('card_vault_keys').insert({
      id: 1, public_key: body.public_key, ...seal(material, 'vault-key'), created_by: ctx.userId, created_by_name: me.name,
      ...(recovery ? recoveryColumns(recovery) : {}),
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
    // A new password should shut out whoever only had the old way in: every
    // fingerprint copy goes, and is made again with the new password.
    await service.from('card_vault_passkeys').delete().not('id', 'is', null);
    await log(ctx, me, null, 'Vault', body.via === 'recovery' ? 'password_reset' : 'password_changed');
    return json({ ok: true });
  }

  if (action === 'recovery_set') {
    const copy = readCopy(body.recovery);
    if (!copy) return bad('That did not look like a recovery code setup');
    const { error } = await service.from('card_vault_keys').update(recoveryColumns(copy)).eq('id', 1);
    if (error) return bad(missing(error) || /column/i.test(error.message ?? '') ? NEEDS_SETUP : (error.message ?? 'Could not save the recovery code'), 500);
    await log(ctx, me, null, 'Vault', 'recovery_set');
    return json({ ok: true });
  }

  if (action === 'recovery_key') {
    const recovery = await readRecovery(ctx);
    if (!recovery.copy) return bad('No recovery code has been made for this vault', 404);
    return json({ recovery: recovery.copy });
  }

  if (action === 'passkey_add') {
    const rpId = typeof body.rp_id === 'string' && /^[a-z0-9.-]{1,255}$/i.test(body.rp_id) ? body.rp_id.toLowerCase() : '';
    if (!isB64(body.credential_id, 1400) || !isB64(body.wrapped_private, 8000) || !isB64(body.iv, 40) || !rpId) return bad('That did not look like a fingerprint setup');
    const mine = await myPasskeys(ctx);
    if (!mine.ready) return bad(NEEDS_SETUP, 503);
    if (mine.credentials.length >= PASSKEYS_PER_USER) return bad('Too many devices. Turn fingerprint unlock off, then on again.', 409);
    const wrap: PasskeyWrap = { wrapped_private: body.wrapped_private, iv: body.iv };
    const { error } = await service.from('card_vault_passkeys').insert({
      user_id: ctx.userId, user_name: me.name, credential_id: body.credential_id, rp_id: rpId, ...seal(wrap, passkeyBind(ctx.userId, body.credential_id)),
    });
    if (error) return bad(error.message ?? 'Could not turn fingerprint unlock on', 500);
    await log(ctx, me, null, 'Vault', 'fingerprint_added');
    return json({ ok: true });
  }

  if (action === 'passkey_remove') {
    const { error } = await service.from('card_vault_passkeys').delete().eq('user_id', ctx.userId);
    if (error) return bad(error.message ?? 'Could not turn fingerprint unlock off', 500);
    await log(ctx, me, null, 'Vault', 'fingerprint_removed');
    return json({ ok: true });
  }

  /* ── one client's card (a roster client, or a past client) ── */
  if (!clientId && !pastId) return bad('client_id is required');
  if (clientId && pastId) return bad('A card belongs to one client');
  let owner: Owner;
  if (pastId) {
    const { data: past } = await service.from('past_client_surveys').select('id, name').eq('id', pastId).maybeSingle();
    // The id has to be exactly the one on file: it is part of what the card is locked to.
    if (!past || String(past.id) !== pastId) return bad('Past client not found', 404);
    owner = pastOwner(pastId, String(past.name ?? ''));
  } else {
    const { data: client } = await service.from('clients').select('id, name').eq('id', clientId).maybeSingle();
    if (!client) return bad('Client not found', 404);
    owner = clientOwner(clientId, String(client.name ?? ''));
  }

  if (action === 'save') {
    const envelope = readEnvelope(body.envelope);
    const brand = BRANDS.includes(String(body.brand)) ? String(body.brand) : 'Card';
    const last4 = typeof body.last4 === 'string' && /^\d{4}$/.test(body.last4) ? body.last4 : '';
    if (!envelope || !last4) return bad('That did not look like a locked card');

    const { data: held, error: readErr } = await service.from(owner.table).select('slot').eq(owner.col, owner.id);
    if (readErr) return bad(missing(readErr) || /column/i.test(readErr.message ?? '') ? NEEDS_SETUP : (readErr.message ?? 'Could not save the card'), 503);
    const used = ((held ?? []) as Row[]).map(r => Number(r.slot));
    let slot: number | null;
    if (body.slot === 'new') {
      slot = Array.from({ length: MAX_CARDS }, (_, i) => i + 1).find(n => !used.includes(n)) ?? null;
      if (!slot) return bad(`A client can have up to ${MAX_CARDS} cards. Delete one first.`, 409);
    } else if (body.slot === undefined) slot = 1;
    else {
      slot = readSlot(body.slot);
      if (!slot || !used.includes(slot)) return bad('That card is no longer there', 404);
    }
    const replacing = used.includes(slot);
    const row = {
      [owner.col]: owner.id, slot, ...seal(envelope, cardBind(owner, slot)), key_version: FORMAT, brand, last4,
      saved_by: ctx.userId, saved_by_name: me.name, updated_at: new Date().toISOString(),
    };
    const { error } = replacing
      ? await service.from(owner.table).update(row).eq(owner.col, owner.id).eq('slot', slot)
      : await service.from(owner.table).insert(row);
    if (error) return bad(error.message ?? 'Could not save the card', 500);
    await logFor(ctx, me, owner, replacing ? 'replaced' : 'saved');
    return json({ card: summary(row) });
  }

  const slot = body.slot === undefined ? 1 : readSlot(body.slot);
  if (!slot) return bad('That card is no longer there', 404);

  if (action === 'delete') {
    const { error } = await service.from(owner.table).delete().eq(owner.col, owner.id).eq('slot', slot);
    if (error) return bad(error.message ?? 'Could not delete the card', 500);
    await logFor(ctx, me, owner, 'deleted');
    return json({ ok: true });
  }

  if (action === 'open') {
    const since = new Date(Date.now() - 3_600_000).toISOString();
    const { data: recent } = await service.from('card_vault_log').select('id')
      .eq('user_id', ctx.userId).eq('action', 'revealed').gte('at', since);
    if ((recent ?? []).length >= OPENS_PER_HOUR) return bad('Too many cards opened in the last hour. Try again later.', 429);

    const { data: row } = await service.from(owner.table).select('ciphertext, iv, tag, key_version').eq(owner.col, owner.id).eq('slot', slot).maybeSingle();
    if (!row) return bad('No card saved for this client', 404);
    const envelope = unseal<Envelope>(row as Sealed, cardBind(owner, slot));
    if (!envelope || !envelope.wk) return bad('This card could not be read — the server key has changed since it was saved, or the record was altered', 500);

    // By fingerprint: hand back this admin's own copy of the key for the device
    // that was just touched — never the password copy, never anyone else's.
    if (body.credential_id !== undefined) {
      const credentialId = isB64(body.credential_id, 1400) ? body.credential_id : '';
      const { data: mine } = credentialId ? await service.from('card_vault_passkeys').select('ciphertext, iv, tag')
        .eq('user_id', ctx.userId).eq('credential_id', credentialId).maybeSingle() : { data: null };
      const passkey = mine ? unseal<PasskeyWrap>(mine as Sealed, passkeyBind(ctx.userId, credentialId)) : null;
      if (!passkey) return bad('Fingerprint unlock is not set up for this device — use the vault password', 404);
      await service.from('card_vault_passkeys').update({ last_used_at: new Date().toISOString() }).eq('user_id', ctx.userId).eq('credential_id', credentialId);
      await logFor(ctx, me, owner, 'revealed');
      return json({ envelope, passkey });
    }

    await logFor(ctx, me, owner, 'revealed');
    return json({ envelope, key: material });
  }

  return bad('Unknown action');
}
