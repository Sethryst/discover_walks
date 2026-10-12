import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const manifest = JSON.parse(await readFile(new URL('../data/regional-capabilities.json', import.meta.url), 'utf8'));

test('regional capabilities manifest covers every selectable region', () => {
  assert.equal(manifest.schemaVersion, 2);
  assert.equal(manifest.manifestType, 'regional-capabilities');
  assert.equal(Object.keys(manifest.regions).length, 79);
  assert.equal(manifest.publication.discoveryPolicy, 'Discover → Review → Approve → Publish');
});

test('capability entries expose delivery, freshness, provenance, validation, coverage, and dependencies', () => {
  const fairfax = manifest.regions['fairfax-county-va'];
  assert.ok(fairfax);
  for (const capability of Object.values(fairfax.capabilities)) {
    for (const key of ['delivery', 'offline', 'freshness', 'provenance', 'licenseUrls', 'validation', 'coverage', 'dependencies']) assert.ok(key in capability, key);
  }
  assert.equal(fairfax.capabilities.places.status, 'furnished');
  assert.equal(fairfax.capabilities.places.offline, true);
  assert.equal(fairfax.capabilities.weather.delivery, 'live');
  assert.equal(fairfax.capabilities.weather.offline, false);
  assert.ok(fairfax.capabilities.places.provenance.length > 0);
});

test('capabilities never promote an unavailable artifact into a furnished capability', () => {
  const unavailable = Object.values(manifest.regions).flatMap((region) => Object.values(region.capabilities)).filter((capability) => capability.status === 'unavailable');
  assert.ok(unavailable.length > 0);
  assert.ok(unavailable.every((capability) => capability.offline === false));
});
