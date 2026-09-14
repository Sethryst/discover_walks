import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBirdnote } from '../js/messenger-bird.js';

const valid = { format: 'walk-wildlife-birdnote-v1', to: 'Mira', message: 'Meet by the old bridge.', route: { title: 'Creek path', coordinates: [[-77.1, 38.9], [-77.09, 38.91]] }, attachments: [{ privateJournal: 'must not pass through' }] };

test('birdnote accepts a deliberately selected route and strips unapproved attachments', () => {
  const normalized = normalizeBirdnote(valid);
  assert.deepEqual(normalized.route.coordinates, valid.route.coordinates);
  assert.deepEqual(normalized.attachments, []);
  assert.equal(normalized.message, valid.message);
});

test('birdnote rejects absent routes and invalid coordinates', () => {
  assert.throws(() => normalizeBirdnote({ ...valid, route: { title: 'No line', coordinates: [] } }), /valid route/);
  assert.throws(() => normalizeBirdnote({ ...valid, route: { title: 'Bad line', coordinates: [[-77, 91], [-76, 90]] } }), /invalid coordinates/);
});
