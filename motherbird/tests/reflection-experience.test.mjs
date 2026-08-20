import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { buildReflectionMoment, promptForWalk, wordCount } from '../js/reflection.js';

const root = path.resolve(import.meta.dirname, '..');

test('reflection saves a titled, prompted, local journal entry distinct from an observation', () => {
  const moment = buildReflectionMoment({ id: 'moment-1', city: 'vienna', heading: 'Under the sycamores', mood: 'Restored', note: 'I slowed down beside the creek.', prompt: promptForWalk('walk-1'), walkId: 'walk-1', createdAt: '2026-08-20T12:00:00Z' });
  assert.equal(moment.type, 'journal');
  assert.equal(moment.title, 'Under the sycamores');
  assert.equal(moment.walkId, 'walk-1');
  assert.equal(moment.prompt, promptForWalk('walk-1'));
  assert.ok(moment.prompt.length > 20);
  assert.equal(wordCount(moment.note), 6);
  assert.equal('location' in moment, false, 'a reflection must not silently become a pinned observation');
});

test('journal UI is writing-first while observation remains field capture', async () => {
  const [html, css] = await Promise.all([readFile(path.join(root, 'index.html'), 'utf8'), readFile(path.join(root, 'styles.css'), 'utf8')]);
  assert.match(html, /id="journalHeading"/);
  assert.match(html, /id="journalPromptChoices"/);
  assert.match(html, /class="lined-journal"/);
  assert.match(css, /repeating-linear-gradient/);
  assert.match(html, /id="observationLocation"/);
  assert.match(html, /id="photoInput"/);
});
