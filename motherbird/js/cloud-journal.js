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
