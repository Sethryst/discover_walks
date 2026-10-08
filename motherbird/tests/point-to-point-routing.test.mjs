import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { WalkingCellRegistry } from '../js/walking-cell-registry.js';
import { findCellPath } from '../js/routing.js';
import { splitDisconnectedRoute } from '../js/routes.js';

const routing = await readFile(new URL('../js/routing.js', import.meta.url), 'utf8');
const planner = await readFile(new URL('../js/planner.js', import.meta.url), 'utf8');
const events = await readFile(new URL('../js/events.js', import.meta.url), 'utf8');
const routeLabels = await import('../js/route-place-labels.js');

test('routing exposes specific cross-cell and boundary failure classes', () => {
  assert.match(routing, /CROSS_CELL_UNAVAILABLE/);
  assert.match(routing, /BOUNDARY_STITCH_FAILED/);
  assert.match(routing, /destinationCell\?\.routingNeighbors/);
  assert.match(routing, /NO_CELL_FOR_COORDINATE/);
  assert.match(routing, /maxVisitedNodes: 300000/);
  assert.match(routing, /requestRouteWithRetry/);
  assert.match(routing, /routeFailureMessage/);
  assert.match(routing, /ROUTING_GRAPH_UNAVAILABLE/);
  assert.match(routing, /after a retry/);
  assert.doesNotMatch(planner, /Route unavailable \(\$\{routed\.status\}/);
  assert.doesNotMatch(events, /Route unavailable \(\$\{plan\.graphStatus\}/);
});

test('selected route points render street labels while retaining coordinates', () => {
  assert.equal(routeLabels.coordinateLabel({ lat: 38.9, lng: -77.04, label: 'Main Street' }), 'Main Street');
  assert.equal(routeLabels.coordinateLabel({ lat: 38.9, lng: -77.04 }), '38.90000, -77.04000');
  assert.match(events, /renderRoutePointControls\(\)/);
  assert.match(events, /resolveRoutePlaceLabel/);
  assert.match(events, /target\.label = label/);
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
  assert.match(events, /We could not find a walkable route there/);
  assert.doesNotMatch(events, /Route unavailable \(\$\{plan\.graphStatus\}/);
});

test('point-to-point planning is destination-bounded instead of capped at the default sketch time', () => {
  assert.match(planner, /const availableMinutes = routeMode === 'point-to-point' \? Infinity : minutes/);
  assert.match(planner, /context: \{ availableMinutes, destination:/);
  assert.match(planner, /routeMode === 'point-to-point' \? 'A route to your destination'/);
});

test('disconnected route geometry exposes an explicit coverage gap', () => {
  const result = splitDisconnectedRoute([[38.9, -77.04], [38.9004, -77.0404], [38.905, -77.045], [38.9054, -77.0454]]);
  assert.equal(result.paths.length, 2);
  assert.equal(result.gaps.length, 1);
  assert.deepEqual(result.gaps[0].from, [38.9004, -77.0404]);
  assert.deepEqual(result.gaps[0].to, [38.905, -77.045]);
  assert.match(planner, /Map coverage gap · this segment is not verified/);
  assert.match(events, /dashed amber segment is not verified/);
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

test('registry can lock an out-of-bounds point to the nearest routable cell', () => {
  const registry = new WalkingCellRegistry({ format: 'motherbird-walking-cell-registry-v1', release: 'test', cells: [
    { id: 'near', bounds: [0, 0, 1, 1], artifacts: { map: { url: './map.pmtiles' }, graph: { url: './graph.json' } } },
    { id: 'far', bounds: [10, 10, 11, 11], artifacts: { map: { url: './map.pmtiles' }, graph: { url: './graph.json' } } }
  ] });
  assert.equal(registry.findNearest(1.01, 0.5).cell.id, 'near');
});
