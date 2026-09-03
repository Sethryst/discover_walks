import { normalizeJournalBackup } from './journal-transfer.js';

const MAGIC = new TextEncoder().encode('WAWJCB01');
const SALT_BYTES = 16;
const IV_BYTES = 12;
const PBKDF2_ITERATIONS = 210000;

function bytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  throw new Error('Cloud backup payload is not binary data.');
}

function sameBytes(first, second) {
  return first.length === second.length && first.every((value, index) => value === second[index]);
}

async function deriveKey(passphrase, salt, cryptoImpl) {
  if (!cryptoImpl?.subtle || !cryptoImpl?.getRandomValues) throw new Error('Cloud backup encryption requires Web Crypto.');
  if (typeof passphrase !== 'string' || passphrase.length < 8) throw new Error('Use a cloud backup passphrase with at least 8 characters.');
  const material = await cryptoImpl.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return cryptoImpl.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: PBKDF2_ITERATIONS },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

export async function encryptJournalBackup(backup, passphrase, cryptoImpl = globalThis.crypto) {
  if (!cryptoImpl?.subtle || !cryptoImpl?.getRandomValues) throw new Error('Cloud backup encryption requires Web Crypto.');
  const plaintext = new TextEncoder().encode(JSON.stringify(normalizeJournalBackup(backup)));
  const salt = cryptoImpl.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = cryptoImpl.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(passphrase, salt, cryptoImpl);
  const ciphertext = new Uint8Array(await cryptoImpl.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext));
  const payload = new Uint8Array(MAGIC.length + salt.length + iv.length + ciphertext.length);
  payload.set(MAGIC);
  payload.set(salt, MAGIC.length);
  payload.set(iv, MAGIC.length + salt.length);
  payload.set(ciphertext, MAGIC.length + salt.length + iv.length);
  return payload;
}

export async function decryptJournalBackup(payload, passphrase, cryptoImpl = globalThis.crypto) {
  const packed = bytes(payload);
  const headerLength = MAGIC.length + SALT_BYTES + IV_BYTES;
  if (packed.length <= headerLength || !sameBytes(packed.slice(0, MAGIC.length), MAGIC)) throw new Error('This cloud backup uses an unsupported encrypted payload.');
  const salt = packed.slice(MAGIC.length, MAGIC.length + SALT_BYTES);
  const iv = packed.slice(MAGIC.length + SALT_BYTES, headerLength);
  const key = await deriveKey(passphrase, salt, cryptoImpl);
  try {
    const plaintext = await cryptoImpl.subtle.decrypt({ name: 'AES-GCM', iv }, key, packed.slice(headerLength));
    return normalizeJournalBackup(JSON.parse(new TextDecoder().decode(plaintext)));
  } catch (_) {
    throw new Error('Could not decrypt the cloud backup. Check the backup passphrase.');
  }
}

export function journalPayloadToBytea(payload) {
  return `\\x${[...bytes(payload)].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}

export function journalPayloadFromBytea(payload) {
  if (typeof payload !== 'string' || !/^\\x[0-9a-f]*$/i.test(payload) || payload.length % 2 !== 0) throw new Error('Cloud backup payload is not valid PostgreSQL bytea.');
  const hex = payload.slice(2);
  return Uint8Array.from({ length: hex.length / 2 }, (_, index) => Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16));
}

export function activeFieldEditionSubscription(rows, now = new Date()) {
  return (rows || []).some((row) => row.subscription_tier === 'field_edition'
    && (!row.started_at || new Date(row.started_at) <= now)
    && (!row.ends_at || new Date(row.ends_at) > now));
}

export const CLOUD_JOURNAL_SCHEMA_VERSION = 'walk-wildlife-journal/2+a256gcm/1';

export function base64url(value) {
  const array = new Uint8Array(value); let binary = '';
  for (let i = 0; i < array.length; i += 8192) binary += String.fromCharCode(...array.subarray(i, i + 8192));
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}
export function unbase64url(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid sealed bytes.');
  return Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), (char) => char.charCodeAt(0));
}
export async function importSealKey(raw, cryptoImpl = globalThis.crypto) {
  return cryptoImpl.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}
export async function sealJson(value, key, context, cryptoImpl = globalThis.crypto) {
  const iv = cryptoImpl.getRandomValues(new Uint8Array(12));
  const encrypted = await cryptoImpl.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(context) }, key, new TextEncoder().encode(JSON.stringify(value)));
  return { algorithm: 'A256GCM', context, iv: base64url(iv), ciphertext: base64url(encrypted) };
}
export async function openSealedJson(envelope, key, context, cryptoImpl = globalThis.crypto) {
  if (envelope?.algorithm !== 'A256GCM' || envelope.context !== context) throw new Error('Wrong sealed payload context.');
  const plaintext = await cryptoImpl.subtle.decrypt({ name: 'AES-GCM', iv: unbase64url(envelope.iv), additionalData: new TextEncoder().encode(context) }, key, unbase64url(envelope.ciphertext));
  return JSON.parse(new TextDecoder().decode(plaintext));
}

async function prfWrappingKey(output, salt) {
  const material = await crypto.subtle.importKey('raw', output, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt, info: new TextEncoder().encode('walk-wildlife/passkey-wrap/v1') }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function unlockPasskeyWrap(wrap) {
  if (!navigator.credentials?.get) throw new Error('Passkey key wrapping is unavailable. Your data stays on this device.');
  const salt = unbase64url(wrap.salt);
  const credential = await navigator.credentials.get({ publicKey: {
    challenge: crypto.getRandomValues(new Uint8Array(32)), rpId: location.hostname,
    allowCredentials: [{ type: 'public-key', id: unbase64url(wrap.credentialId) }],
    userVerification: 'required', extensions: { prf: { eval: { first: salt } } }
  } });
  const output = credential?.getClientExtensionResults()?.prf?.results?.first;
  if (!output) throw new Error('This passkey cannot unwrap encrypted data here (PRF unavailable). Nothing was uploaded.');
  const key = await prfWrappingKey(output, salt);
  const raw = await openSealedJson(wrap.sealedKey, key, `key:${wrap.ownerId}`);
  return importSealKey(unbase64url(raw.key));
}

export async function createPasskeyWrap(ownerId) {
  if (!navigator.credentials?.create) throw new Error('Passkey key wrapping is unavailable.');
  const salt = crypto.getRandomValues(new Uint8Array(32));
  const credential = await navigator.credentials.create({ publicKey: {
    challenge: crypto.getRandomValues(new Uint8Array(32)),
    rp: { name: 'Walk & Wildlife encrypted journal', id: location.hostname },
    user: { id: crypto.getRandomValues(new Uint8Array(32)), name: ownerId, displayName: 'Private journal key' },
    pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    attestation: 'none', extensions: { prf: { eval: { first: salt } } }
  } });
  if (!credential?.getClientExtensionResults()?.prf?.enabled && !credential?.getClientExtensionResults()?.prf?.results?.first) throw new Error('This passkey does not support PRF key wrapping. Nothing was uploaded.');
  const wrap = { ownerId, credentialId: base64url(credential.rawId), salt: base64url(salt), version: 1 };
  let output = credential.getClientExtensionResults()?.prf?.results?.first;
  if (!output) {
    const assertion = await navigator.credentials.get({ publicKey: { challenge: crypto.getRandomValues(new Uint8Array(32)), rpId: location.hostname, allowCredentials: [{ type: 'public-key', id: credential.rawId }], userVerification: 'required', extensions: { prf: { eval: { first: salt } } } } });
    output = assertion?.getClientExtensionResults()?.prf?.results?.first;
  }
  if (!output) throw new Error('Passkey PRF is unavailable. Nothing was uploaded.');
  const raw = crypto.getRandomValues(new Uint8Array(32));
  wrap.sealedKey = await sealJson({ key: base64url(raw) }, await prfWrappingKey(output, salt), `key:${ownerId}`);
  return { key: await importSealKey(raw), wrap };
}
