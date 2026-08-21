import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const migration = await readFile(path.resolve(import.meta.dirname, '..', 'supabase-migration-spatial-sync.sql'), 'utf8');

test('county sync migration isolates canonical records from append-only local intent', () => {
  assert.match(migration, /create extension if not exists postgis/i);
  assert.match(migration, /county_poi_versions/);
  assert.match(migration, /county_pois[\s\S]*geom extensions\.geometry\(Point, 4326\)/);
  assert.match(migration, /spatial_local_operations[\s\S]*operation_kind[\s\S]*local-close/);
  assert.match(migration, /enable row level security/);
  assert.match(migration, /append only/i);
  assert.doesNotMatch(migration, /on public\.spatial_local_operations for delete/i);
  assert.doesNotMatch(migration, /on public\.county_pois for (insert|update|delete)/i);
});
