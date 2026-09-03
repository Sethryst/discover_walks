import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('coach marks use one short sentence per feature', async () => {
  const source = await readFile(new URL('../js/coach.js', import.meta.url), 'utf8');
  const steps = [...source.matchAll(/target: '([^']+)', text: '([^']+)'/g)];
  const targets = new Set();
  assert.ok(steps.length >= 6);
  for (const [, target, text] of steps) {
    assert.ok(text.endsWith('.'));
    assert.ok(text.split(/\s+/).length <= 14);
    assert.doesNotMatch(text, /;|,/);
    assert.equal(targets.has(target), false);
    targets.add(target);
  }
});

test('intro markup shows one coach line and next control', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const loader = await readFile(new URL('../js/loader.js', import.meta.url), 'utf8');
  assert.match(html, /id="mapIntroText"/);
  assert.match(html, /id="mapIntroNext"/);
  assert.match(html, /id="mapIntroSkip"/);
  assert.doesNotMatch(html, /Locate centers your fix/);
  assert.match(loader, /startCoachMarks/);
});
