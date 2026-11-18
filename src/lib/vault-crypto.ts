// Card vault — the part that runs in the browser. This is what makes the vault
// password real: cards are locked and unlocked HERE, so the server only ever
// holds scrambled data and never sees the vault password or a readable card.
//
//   Setting the password   makes a lock-and-key pair. The lock (public key)
//                          goes to the server for anyone to lock cards with.
//                          The key (private key) is itself locked with the
//                          vault password before it leaves this browser.
//   Saving a card          locks it with the public key. No password needed —
//                          a VA can save, and still cannot read it back.
//   Showing a card         fetches the locked card and the locked key, and the
//                          vault password typed here opens the key, which opens
//                          the card. A wrong password simply fails to open it.
//
// Forget the vault password and nothing can open the key again — by design.
// Browser-only (WebCrypto); never import this from server code.

import type { CardInput } from './card-format';

/** What the server stores for the vault itself. All base64. */
export type KeyMaterial = { wrapped_private: string; salt: string; iv: string; iterations: number };
export type VaultSetup = KeyMaterial & { public_key: string };
/** One locked card. */
export type Envelope = { wk: string; iv: string; ct: string };

export const WRONG_PASSWORD = 'That vault password is not right';
const ITERATIONS = 600_000;   // how hard each password guess is made
const MIN_LENGTH = 12;

const b64 = (buf: ArrayBuffer | Uint8Array) => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
};
const bytes = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const utf8 = (s: string) => new TextEncoder().encode(s);
const RSA = { name: 'RSA-OAEP', hash: 'SHA-256' } as const;

/** What is wrong with a new vault password, in words. Null = fine. */
export function passwordProblem(password: string, again: string): string | null {
  if (password.length < MIN_LENGTH) return `Use at least ${MIN_LENGTH} characters — a short sentence works well`;
  if (new Set(password).size < 5) return 'That is too easy to guess';
  if (password !== again) return 'The two passwords do not match';
  return null;
}

async function passwordKey(password: string, salt: Uint8Array, iterations: number, usage: KeyUsage[]): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', utf8(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations }, base, { name: 'AES-GCM', length: 256 }, false, usage);
}

async function wrapPrivate(privateKey: CryptoKey, password: string): Promise<KeyMaterial> {
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await passwordKey(password, salt, ITERATIONS, ['wrapKey']);
  const wrapped = await crypto.subtle.wrapKey('pkcs8', privateKey, key, { name: 'AES-GCM', iv });
  return { wrapped_private: b64(wrapped), salt: b64(salt), iv: b64(iv), iterations: ITERATIONS };
}

async function unwrapPrivate(m: KeyMaterial, password: string, extractable: boolean): Promise<CryptoKey> {
  try {
    const key = await passwordKey(password, bytes(m.salt), m.iterations, ['unwrapKey']);
    return await crypto.subtle.unwrapKey('pkcs8', bytes(m.wrapped_private) as BufferSource, key, { name: 'AES-GCM', iv: bytes(m.iv) as BufferSource }, RSA, extractable, ['decrypt']);
  } catch {
    throw new Error(WRONG_PASSWORD);
  }
}

/** First-time setup: a new lock-and-key pair, the key locked with the vault password. */
export async function createVault(password: string): Promise<VaultSetup> {
  const pair = await crypto.subtle.generateKey({ ...RSA, modulusLength: 3072, publicExponent: new Uint8Array([1, 0, 1]) }, true, ['encrypt', 'decrypt']);
  const publicKey = await crypto.subtle.exportKey('spki', pair.publicKey);
  return { public_key: b64(publicKey), ...(await wrapPrivate(pair.privateKey, password)) };
}

/** Lock a card for a client. Needs only the public key. */
export async function lockCard(publicKeyB64: string, card: CardInput, clientId: string): Promise<Envelope> {
  const publicKey = await crypto.subtle.importKey('spki', bytes(publicKeyB64) as BufferSource, RSA, false, ['encrypt']);
  const cardKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  // Tied to the client: a locked card moved onto another client will not open.
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: utf8(clientId) }, cardKey, utf8(JSON.stringify(card)));
  const wk = await crypto.subtle.encrypt(RSA, publicKey, await crypto.subtle.exportKey('raw', cardKey));
  return { wk: b64(wk), iv: b64(iv), ct: b64(ct) };
}

async function decryptCard(privateKey: CryptoKey, envelope: Envelope, clientId: string): Promise<CardInput> {
  try {
    const raw = await crypto.subtle.decrypt(RSA, privateKey, bytes(envelope.wk) as BufferSource);
    const cardKey = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['decrypt']);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(envelope.iv) as BufferSource, additionalData: utf8(clientId) }, cardKey, bytes(envelope.ct) as BufferSource);
    return JSON.parse(new TextDecoder().decode(plain)) as CardInput;
  } catch {
    throw new Error('This card could not be opened — it was saved for a different vault or has been altered');
  }
}

/** Open a card with the vault password. Throws WRONG_PASSWORD if it is not right. */
export async function openCard(material: KeyMaterial, password: string, envelope: Envelope, clientId: string): Promise<CardInput> {
  return decryptCard(await unwrapPrivate(material, password, false), envelope, clientId);
}

/** Change the vault password: the same key, locked again with the new password. */
export async function changePassword(material: KeyMaterial, oldPassword: string, newPassword: string): Promise<KeyMaterial> {
  return wrapPrivate(await unwrapPrivate(material, oldPassword, true), newPassword);
}

/* ── Fingerprint / face unlock ─────────────────────────────────────────────
 * A second way to open the vault's private key, per admin and per device,
 * instead of typing the vault password each time. It does not replace the
 * password and does not weaken the vault:
 *
 *   Turning it on   takes the vault password once. The device makes a passkey
 *                   (Touch ID / Face ID / Windows Hello), and a second copy of
 *                   the private key is locked with a secret only that passkey
 *                   can produce (the WebAuthn "prf" extension). That secret
 *                   never leaves the device and is never sent to the server.
 *   Showing a card  the sensor is touched, the passkey hands this page the
 *                   secret, the secret opens the key, the key opens the card.
 *
 * The server stores the passkey-locked copy exactly as it stores the
 * password-locked one — it can open neither. A leak of the database and the
 * server is still not enough; it now takes the vault password OR the device.
 * The passkey is used as a key here, not as a sign-in: nothing is verified on
 * the server, because nothing the server could be tricked into matters.
 */

export type PasskeyWrap = { wrapped_private: string; iv: string };
export type Touch = { credential_id: string; output: BufferSource };
export const FINGERPRINT_FAILED = 'Fingerprint unlock did not go through';
export const NO_FINGERPRINT = 'This browser or device cannot do fingerprint unlock for the vault — the vault password still works';

const TOUCH_LABEL = 'tomsi-card-vault/fingerprint/v1';
const touchSalt = () => crypto.subtle.digest('SHA-256', utf8(TOUCH_LABEL));
type PrfResults = { prf?: { enabled?: boolean; results?: { first?: BufferSource } } };
const prfOf = (cred: PublicKeyCredential) => (cred.getClientExtensionResults() as PrfResults).prf;
const prfInput = async () => ({ prf: { eval: { first: await touchSalt() } } }) as AuthenticationExtensionsClientInputs;

/** Does this device have a fingerprint / face sensor the browser can use? */
export async function fingerprintAvailable(): Promise<boolean> {
  try {
    return typeof PublicKeyCredential !== 'undefined' && !!navigator.credentials
      && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch { return false; }
}

async function touchKey(output: BufferSource, usage: KeyUsage[]): Promise<CryptoKey> {
  const base = await crypto.subtle.importKey('raw', output, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: utf8(TOUCH_LABEL) }, base, { name: 'AES-GCM', length: 256 }, false, usage);
}

/** Turning it on, step 1: prove the vault password. The opened key stays in this page's memory. */
export function unlockVaultKey(material: KeyMaterial, password: string): Promise<CryptoKey> {
  return unwrapPrivate(material, password, true);
}

/** Step 2: make this device's passkey. `output` is null when the device wants a second touch to hand over its secret. */
export async function createPasskey(user: { id: string; name: string }, existing: string[]): Promise<{ credential_id: string; output: BufferSource | null }> {
  let cred: PublicKeyCredential | null;
  try {
    cred = await navigator.credentials.create({ publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { name: 'Tomsi Dashboard — Card Vault' },
      user: { id: utf8(user.id), name: `${user.name} (card vault)`, displayName: `${user.name} (card vault)` },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required', residentKey: 'preferred' },
      excludeCredentials: existing.map(id => ({ type: 'public-key' as const, id: bytes(id) as BufferSource })),
      timeout: 60_000,
      extensions: await prfInput(),
    } }) as PublicKeyCredential | null;
  } catch (e) {
    if (e instanceof DOMException && e.name === 'InvalidStateError') throw new Error('This device is already set up for fingerprint unlock');
    throw new Error(FINGERPRINT_FAILED);
  }
  if (!cred) throw new Error(FINGERPRINT_FAILED);
  const prf = prfOf(cred);
  if (!prf?.enabled && !prf?.results?.first) throw new Error(NO_FINGERPRINT);
  return { credential_id: b64(cred.rawId), output: prf.results?.first ?? null };
}

/** Touch the sensor: the secret only one of these passkeys can produce. */
export async function touchPasskey(ids: string[]): Promise<Touch> {
  let cred: PublicKeyCredential | null;
  try {
    cred = await navigator.credentials.get({ publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      allowCredentials: ids.map(id => ({ type: 'public-key' as const, id: bytes(id) as BufferSource })),
      userVerification: 'required',
      timeout: 60_000,
      extensions: await prfInput(),
    } }) as PublicKeyCredential | null;
  } catch {
    throw new Error(FINGERPRINT_FAILED);
  }
  const output = cred ? prfOf(cred)?.results?.first : null;
  if (!cred || !output) throw new Error(NO_FINGERPRINT);
  return { credential_id: b64(cred.rawId), output };
}

/** Step 3: a copy of the private key, locked with the passkey's secret. */
export async function wrapForPasskey(privateKey: CryptoKey, output: BufferSource): Promise<PasskeyWrap> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const wrapped = await crypto.subtle.wrapKey('pkcs8', privateKey, await touchKey(output, ['wrapKey']), { name: 'AES-GCM', iv });
  return { wrapped_private: b64(wrapped), iv: b64(iv) };
}

/** Open a card with the secret from a touch, instead of the vault password. */
export async function openCardWithPasskey(wrap: PasskeyWrap, output: BufferSource, envelope: Envelope, clientId: string): Promise<CardInput> {
  let privateKey: CryptoKey;
  try {
    privateKey = await crypto.subtle.unwrapKey('pkcs8', bytes(wrap.wrapped_private) as BufferSource, await touchKey(output, ['unwrapKey']), { name: 'AES-GCM', iv: bytes(wrap.iv) as BufferSource }, RSA, false, ['decrypt']);
  } catch {
    throw new Error('Fingerprint unlock is out of date on this device — use the vault password, then turn it on again');
  }
  return decryptCard(privateKey, envelope, clientId);
}
