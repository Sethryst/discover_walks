import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
test('Virginia favorites tree has stable IDs and every town resolves to a locality', async () => {
  const tree = JSON.parse(await readFile(path.join(root, 'data/favorites_tree.v1.json'), 'utf8'));
  assert.equal(tree.schema, 'gremlin.favorites_tree.v1');
  assert.equal(tree.state.id, 'us-va');
  const localityIds = new Set(tree.localities.map((item) => item.id));
  assert.ok(tree.localities.some((item) => item.name === 'Fairfax'));
  assert.ok(tree.towns.length > 0);
  assert.equal(new Set([...tree.localities, ...tree.towns].map((item) => item.id)).size, tree.localities.length + tree.towns.length);
  assert.ok(tree.towns.every((item) => item.parent_id && localityIds.has(item.parent_id)));
});
