import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  activeFieldEditionSubscription,
  decryptJournalBackup,
  encryptJournalBackup,
  journalPayloadFromBytea,
  journalPayloadToBytea
} from '../js/cloud-journal.js';
import { createJournalBackup } from '../js/journal-transfer.js';

const journal = createJournalBackup({
  walks: [{ id: 'walk-1', points: [{ lat: 38.9, lng: -77.2 }] }],
  observations: [], moments: [], personal_places: [], personal_place_categories: [],
  poi_metadata: [], walk_events: [], voice_notes: [], layer_settings: [],
  profile: [{ id: 'local-user', totalPoints: 2 }], settings: [{ id: 'app-settings', activeCity: 'fairfax' }]
}, '2026-08-30T12:00:00.000Z');

test('cloud payload encrypts the existing journal format and decrypts only on-device', async () => {
  const packed = await encryptJournalBackup(journal, 'correct horse battery staple', webcrypto);
  assert.ok(packed.byteLength > JSON.stringify(journal).length);
  assert.doesNotMatch(new TextDecoder().decode(packed), /walk-1|38\.9|fairfax/);
  assert.deepEqual(await decryptJournalBackup(packed, 'correct horse battery staple', webcrypto), journal);
  await assert.rejects(() => decryptJournalBackup(packed, 'incorrect passphrase', webcrypto), /Could not decrypt/);
});

test('encrypted bytes round-trip through PostgreSQL bytea hex text', async () => {
  const packed = await encryptJournalBackup(journal, 'another private phrase', webcrypto);
  assert.deepEqual(journalPayloadFromBytea(journalPayloadToBytea(packed)), packed);
});

test('only an unexpired field_edition subscription activates cloud continuity', () => {
  const now = new Date('2026-08-30T12:00:00.000Z');
  assert.equal(activeFieldEditionSubscription([{ subscription_tier: 'field_edition', ends_at: null }], now), true);
  assert.equal(activeFieldEditionSubscription([{ subscription_tier: 'field_edition', ends_at: '2026-08-31T00:00:00.000Z' }], now), true);
  assert.equal(activeFieldEditionSubscription([{ subscription_tier: 'field_edition', ends_at: '2026-08-29T00:00:00.000Z' }], now), false);
  assert.equal(activeFieldEditionSubscription([{ subscription_tier: 'field_edition', started_at: '2026-08-31T00:00:00.000Z', ends_at: null }], now), false);
  assert.equal(activeFieldEditionSubscription([{ subscription_tier: 'free', ends_at: null }], now), false);
});

test('client cloud path keeps the database boundary narrow', async () => {
  const [backup, online, html] = await Promise.all([
    readFile(new URL('../js/backup.js', import.meta.url), 'utf8'),
    readFile(new URL('../js/online.js', import.meta.url), 'utf8'),
    readFile(new URL('../index.html', import.meta.url), 'utf8')
  ]);
  assert.match(online, /from\('subscriptions'\)\.select\('subscription_tier,started_at,ends_at'\)/);
  assert.doesNotMatch(online, /from\('subscriptions'\)\.(?:insert|upsert|update)/);
  assert.match(backup, /from\('journal_backups'\)\.delete\(\)/);
  assert.match(backup, /from\('journal_backups'\)\.insert\(/);
  assert.doesNotMatch(backup, /from\('journal_backups'\)\.update\(/);
  assert.doesNotMatch(`${backup}\n${online}`, /from\('(walks|visits|user_locations|events|routes)'\)/);
  assert.doesNotMatch(html, /accountPhone|phoneInput|type="tel"/i);
});
