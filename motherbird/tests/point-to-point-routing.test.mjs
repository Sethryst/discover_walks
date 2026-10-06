import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { WalkingCellRegistry } from '../js/walking-cell-registry.js';
import { findCellPath } from '../js/routing.js';

const routing = await readFile(new URL('../js/routing.js', import.meta.url), 'utf8');
const planner = await readFile(new URL('../js/planner.js', import.meta.url), 'utf8');
const events = await readFile(new URL('../js/events.js', import.meta.url), 'utf8');

test('routing exposes specific cross-cell and boundary failure classes', () => {
  assert.match(routing, /CROSS_CELL_UNAVAILABLE/);
  assert.match(routing, /BOUNDARY_STITCH_FAILED/);
  assert.match(routing, /destinationCell\?\.routingNeighbors/);
  assert.match(routing, /NO_CELL_FOR_COORDINATE/);
  assert.match(routing, /maxVisitedNodes: 300000/);
  assert.match(routing, /requestRouteWithRetry/);
});

test('registry returns all overlapping candidates for adaptive routing', () => {
  const registry = new WalkingCellRegistry({ format: 'motherbird-walking-cell-registry-v1', release: 'test', cells: [
    { id: 'fine', bounds: [0, 0, 1, 1], artifacts: { map: { url: './map.pmtiles' }, graph: { url: './graph.json' } } },
    { id: 'coarse', bounds: [-1, -1, 2, 2], artifacts: { map: { url: './map.pmtiles' }, graph: { url: './graph.json' } } }
  ] });
  assert.deepEqual(registry.findAll(.5, .5).map((cell) => cell.id), ['fine', 'coarse']);
});

test('planner preserves endpoints and ignores stale concurrent generations', () => {
  assert.doesNotMatch(planner, /state\.plannerEnd = null/);
  assert.match(planner, /requestGeneration = \+\+generation/);
  assert.match(planner, /requestGeneration !== generation/);
  assert.match(events, /Route unavailable \(\$\{plan\.graphStatus\}/);
});

test('cell registry metadata supports explicit neighboring-cell decisions', () => {
  const registry = new WalkingCellRegistry({ format: 'motherbird-walking-cell-registry-v1', release: 'test', cells: [
    { id: 'west', bounds: [-2, 0, 0, 2], routingNeighbors: ['east'], artifacts: { map: { url: './map.pmtiles' }, graph: { url: './graph.json' } } },
    { id: 'east', bounds: [0, 0, 2, 2], routingNeighbors: ['west'], artifacts: { map: { url: './map.pmtiles' }, graph: { url: './graph.json' } } }
  ] }, 'https://example.test/cells.json');
  assert.equal(registry.find(1, -1).routingNeighbors[0], 'east');
  assert.equal(registry.find(1, 1).routingNeighbors[0], 'west');
});

test('cell graph finds multi-hop paths and rejects disconnected cells', () => {
  const cells = [
    { id: 'a', bounds: [0, 0, 1, 1], routingNeighbors: ['b'] },
    { id: 'b', bounds: [1, 0, 2, 1], routingNeighbors: ['a', 'c'] },
    { id: 'c', bounds: [2, 0, 3, 1], routingNeighbors: ['b'] },
    { id: 'z', bounds: [10, 0, 11, 1], routingNeighbors: [] }
  ];
  assert.deepEqual(findCellPath({ cells }, 'a', 'c').map((cell) => cell.id), ['a', 'b', 'c']);
  assert.equal(findCellPath({ cells }, 'a', 'z'), null);
});

test('adaptive overlapping cells can form a candidate bridge without metadata', () => {
  const cells = [
    { id: 'coarse', bounds: { west: 0, south: 0, east: 2, north: 2 }, routingNeighbors: [] },
    { id: 'fine', bounds: { west: 1, south: 0, east: 3, north: 2 }, routingNeighbors: [] }
  ];
  assert.deepEqual(findCellPath({ cells }, 'coarse', 'fine').map((cell) => cell.id), ['coarse', 'fine']);
});
