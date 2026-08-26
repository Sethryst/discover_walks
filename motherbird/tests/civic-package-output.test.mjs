import assert from 'node:assert/strict';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { CITIES } from '../js/constants.js';

const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('each selectable city that advertises civic content has a packaged, versioned local civic bundle', async () => {
  const civicCities = Object.entries(CITIES).filter(([, city]) => city.civicFile);
  assert.ok(civicCities.length > 0, 'at least one selector city should advertise civic content');
  for (const [cityId, city] of civicCities) {
    const relativePath = city.civicFile.replace(/^\.\//, '');
    const civicPath = path.join(appRoot, relativePath);
    await access(civicPath);
    const bundle = JSON.parse(await readFile(civicPath, 'utf8'));
    assert.equal(bundle.schemaVersion, 1, `${cityId} civic bundle schema`);
    assert.ok(bundle.regionId, `${cityId} civic bundle region ID`);
    assert.ok(bundle.generatedAt, `${cityId} civic bundle timestamp`);
    assert.ok(bundle.artifacts && typeof bundle.artifacts === 'object', `${cityId} civic artifacts`);
  }
});
