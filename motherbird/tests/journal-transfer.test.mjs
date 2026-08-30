import assert from 'node:assert/strict';
import test from 'node:test';
import { createJournalBackup, journalBackupToCsv, mergeJournalData, normalizeJournalBackup, previewJournalImport } from '../js/journal-transfer.js';

const local = {
  walks: [{ id: 'walk-1', title: 'Local title' }], observations: [], moments: [{ id: 'moment-1', note: 'same' }],
  personal_places: [{ id: 'place-1', notes: 'keep local' }], personal_place_categories: [], poi_metadata: [], walk_events: [], voice_notes: [], layer_settings: [],
  profile: [{ id: 'local-user', totalPoints: 5 }], settings: [{ id: 'app-settings', activeCity: 'fairfax' }]
};
const incoming = {
  ...local,
  walks: [{ id: 'walk-1', title: 'Imported title' }, { id: 'walk-2', title: 'New walk' }],
  observations: [{ id: 'observation-1', species: 'Heron', note: 'At the pond', location: { lat: 1, lng: 2 } }]
};

test('import preview identifies additions, identical records, and conflicts without mutating local data', () => {
  const preview = previewJournalImport(local, incoming);
  assert.equal(preview.additions, 2);
  assert.ok(preview.identical >= 1);
  assert.equal(preview.conflictCount, 1);
  assert.equal(local.walks[0].title, 'Local title');
});

test('merge preserves local conflicts by default and supports explicit imported choices', () => {
  const defaultMerge = mergeJournalData(local, incoming);
  assert.equal(defaultMerge.data.walks.find((item) => item.id === 'walk-1').title, 'Local title');
  assert.ok(defaultMerge.data.walks.some((item) => item.id === 'walk-2'));
  const reviewed = mergeJournalData(local, incoming, { 'walks:walk-1': 'incoming' });
  assert.equal(reviewed.data.walks.find((item) => item.id === 'walk-1').title, 'Imported title');
});

test('v2 backup includes all collections and produces a readable CSV without photo blobs', () => {
  const backup = createJournalBackup(incoming, '2026-08-30T12:00:00Z');
  assert.equal(normalizeJournalBackup(backup).data.personal_places.length, 1);
  const csv = journalBackupToCsv(backup);
  assert.match(csv, /observation-1/);
  assert.match(csv, /Heron/);
  assert.doesNotMatch(csv, /data:image/);
});
