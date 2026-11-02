import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const css = fs.readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
const shellCss = fs.readFileSync(new URL('../shell.css', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('workspace keeps one responsive three-column navigation contract', () => {
  assert.doesNotMatch(html, /map-workspace-header-tabs|map-workspace-header-tab/);
  assert.doesNotMatch(css, /map-workspace-header-tabs|map-workspace-header-tab/);
  assert.match(css, /\.workspace-tool-pills\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)/s);
  assert.match(shellCss, /\.workspace-tool-pills button\s*\{[^}]*pointer-events:\s*auto/s);
});
