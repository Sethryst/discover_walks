import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const [theme, radio, index, worker] = await Promise.all([
  read('../css/radio-theme.css'), read('../radio.css'), read('../index.html'), read('../service-worker.js')
]);
const tokens = Object.fromEntries([...theme.matchAll(/(--radio-[\w-]+):\s*(#[\da-f]{6});/g)].map((match) => [match[1], match[2]]));
function luminance(hex) {
  const rgb = hex.slice(1).match(/../g).map((value) => parseInt(value, 16) / 255).map((value) => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
  return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
}
test('radio and all tab surfaces share one offline-cached theme, loaded last', () => {
  assert.ok(index.indexOf('css/radio-theme.css?v=') > index.indexOf('splash-fix.css?v='));
  assert.match(worker, /'\.\/css\/radio-theme\.css'/);
  for (const surface of ['.primary-nav', '.primary-panel', '.map-workspace-panel', '.sheet', '.walk-sketch', '.workspace-record']) assert.ok(theme.includes(surface), surface);
  for (const token of radio.matchAll(/var\((--radio-[\w-]+)\)/g)) assert.ok(tokens[token[1]], `Missing ${token[1]}`);
  // Theme changes must not alter layout, visibility, gestures, or panel behavior.
  assert.doesNotMatch(theme, /(?:^|[;{])\s*(?:display|position|inset|width|height|transform|pointer-events|z-index)\s*:/m);
});
test('shared text/button combinations meet normal-text contrast', () => {
  for (const [foreground, background] of [['ink', 'cream'], ['muted', 'paper'], ['cream', 'action'], ['ink', 'amber'], ['button', 'console'], ['danger', 'cream']]) {
    const values = [luminance(tokens[`--radio-${foreground}`]), luminance(tokens[`--radio-${background}`])].sort((a, b) => b - a);
    const contrast = (values[0] + .05) / (values[1] + .05);
    assert.ok(contrast >= 4.5, `${foreground}/${background}: ${contrast.toFixed(2)}`);
  }
});
