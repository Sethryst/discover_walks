import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const css = fs.readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('workspace header keeps visible tabs and 44px action targets', () => {
  assert.match(html, /class="map-workspace-header-tabs"/);
  assert.match(css, /\.map-workspace-header-tabs\s*\{[^}]*display:\s*flex\s*!important;[^}]*flex:\s*1 1 0%\s*!important/s);
  assert.match(css, /\.map-workspace-header-tab\s*\{[^}]*display:\s*grid\s*!important;[^}]*visibility:\s*visible\s*!important/s);
  assert.match(css, /\.map-workspace-panel\[data-destination="explore"\] \.map-workspace-header-tabs\s*\{[^}]*display:\s*none\s*!important/s);
  assert.match(css, /\.map-workspace-panel\[data-destination="maps"\] \.map-workspace-header-tabs\s*\{[^}]*grid-template-columns:\s*repeat\(3,\s*minmax\(0,\s*1fr\)\)/s);
  assert.match(css, /\.map-workspace-panel > header > \.map-workspace-header-actions button\s*\{[^}]*height:\s*44px\s*!important/s);
});
