import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const id = 'meadowlark-gardens';
const edition = path.join(root, 'field-editions', id);
const config = JSON.parse(await readFile(path.join(edition, 'field-edition.json')));
const boundary = JSON.parse(await readFile(path.join(edition, 'boundary.geojson')));
const places = JSON.parse(await readFile(path.join(edition, 'places.json')));
const routes = JSON.parse(await readFile(path.join(edition, 'routes.json')));
assert.equal(config.id, id);
assert.deepEqual(config.zoomLevels, { min: 12, max: 18 });
assert.equal(boundary.geometry.type, 'Polygon');
assert.ok(places.places.every((place) => place.id && place.name && place.coordinates && place.editorial_status === 'approved'));
assert.ok(places.places.some((place) => place.category === 'historical_place' && place.style === 'gold'));
assert.ok(routes.routes.every((route) => route.mode === 'walking' && Array.isArray(route.highlights)));
console.log('field edition contract test passed');
