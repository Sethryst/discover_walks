import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pickCoachPlacement } from '../js/coach.js';

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

test('coach overlay sits above map chrome with a box and an arrow', async () => {
  const source = await readFile(new URL('../js/coach.js', import.meta.url), 'utf8');
  const css = await readFile(new URL('../splash-fix.css', import.meta.url), 'utf8');
  assert.match(source, /mapToolsHintSeenV4/);
  assert.match(source, /document\.body\.appendChild/);
  assert.match(source, /pickCoachPlacement/);
  assert.match(source, /coachSpotlight/);
  assert.match(css, /position:\s*fixed/);
  assert.match(css, /z-index:\s*4200/);
  assert.match(css, /coach-spotlight/);
  assert.match(css, /data-arrow/);
  assert.match(css, /max-height:\s*none/);
  assert.doesNotMatch(css, /max-height:\s*135px/);
});

test('coach placement puts the card beside the tool and keeps it on screen', () => {
  const phone = { width: 390, height: 844 };
  const card = { width: 260, height: 90 };

  const locate = pickCoachPlacement({ left: 12, top: 16, width: 44, height: 40 }, card, phone);
  assert.equal(locate.arrow, 'up');
  assert.ok(locate.top >= 16 + 40);
  assert.ok(locate.left >= 12);
  assert.ok(locate.left + card.width <= phone.width - 12);

  const fieldGuide = pickCoachPlacement({ left: 330, top: 380, width: 48, height: 40 }, card, phone);
  assert.equal(fieldGuide.arrow, 'right');
  assert.ok(fieldGuide.left + card.width <= 330);
  assert.ok(fieldGuide.top >= 12);
  assert.ok(fieldGuide.top + card.height <= phone.height - 12);

  const lights = pickCoachPlacement({ left: 80, top: 780, width: 230, height: 40 }, card, phone);
  assert.equal(lights.arrow, 'down');
  assert.ok(lights.top + card.height <= 780);
  assert.ok(lights.left >= 12);
  assert.ok(lights.left + card.width <= phone.width - 12);
});
