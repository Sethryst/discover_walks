#!/usr/bin/env node
/** Named endpoint smoke matrix for the bounded Northern Virginia/DC pilot. */
import fs from 'node:fs/promises';
import { routeRuntimeGraph } from '../motherbird/js/runtime-router.mjs';

const root = process.argv[2] || '.tmp-cache/pilot-build';
const registry = JSON.parse(await fs.readFile(`${root}/cells.json`, 'utf8'));
const endpoints = {
  dc: [-77.0369, 38.9072],
  arlington: [-77.1011, 38.8783],
  alexandria: [-77.0469, 38.8048],
  fallsChurch: [-77.1711, 38.8823],
  potomac: [-77.2086, 39.0182],
  eastPotomacPark: [-77.025, 38.87],
};
const pairs = [
  ['dc', 'arlington'], ['arlington', 'alexandria'], ['fairfax', 'fallsChurch'],
  ['potomac', 'dc'], ['eastPotomacPark', 'dc'], ['fallsChurch', 'arlington'],
];
endpoints.fairfax = [-77.3064, 38.8462];

const graphs = new Map();
async function graph(id) {
  if (!graphs.has(id)) graphs.set(id, JSON.parse(await fs.readFile(`${root}/cells/${id}/runtime-graph.json`, 'utf8')));
  return graphs.get(id);
}
function cellFor([lon, lat]) {
  return registry.cells.find((cell) => lon >= cell.bounds[0] && lon <= cell.bounds[2] && lat >= cell.bounds[1] && lat <= cell.bounds[3]);
}
function transfers(a, b) {
  const south = Math.max(a.bounds[1], b.bounds[1]); const north = Math.min(a.bounds[3], b.bounds[3]);
  const west = Math.max(a.bounds[0], b.bounds[0]); const east = Math.min(a.bounds[2], b.bounds[2]);
  const points = [];
  if (Math.abs(a.bounds[2] - b.bounds[0]) < 1e-7 || Math.abs(b.bounds[2] - a.bounds[0]) < 1e-7) {
    const lon = Math.abs(a.bounds[2] - b.bounds[0]) < 1e-7 ? a.bounds[2] : b.bounds[2];
    for (let i = 1; i <= 9; i += 1) points.push([lon, south + (north - south) * i / 10]);
  } else if (Math.abs(a.bounds[3] - b.bounds[1]) < 1e-7 || Math.abs(b.bounds[3] - a.bounds[1]) < 1e-7) {
    const lat = Math.abs(a.bounds[3] - b.bounds[1]) < 1e-7 ? a.bounds[3] : b.bounds[3];
    for (let i = 1; i <= 9; i += 1) points.push([west + (east - west) * i / 10, lat]);
  }
  return points;
}
const results = [];
for (const [from, to] of pairs) {
  const origin = endpoints[from]; const destination = endpoints[to];
  const originCell = cellFor(origin); const destinationCell = cellFor(destination);
  let result = { status: 'CELL_NOT_COVERED' };
  if (originCell && destinationCell && originCell.id === destinationCell.id) {
    result = routeRuntimeGraph(await graph(originCell.id), { origin, destination, profile: 'ordinary_walking_beta' }, { maxSnapMeters: 250 });
  } else if (originCell && destinationCell) {
    let best = null;
    for (const transfer of transfers(originCell, destinationCell)) {
      const first = routeRuntimeGraph(await graph(originCell.id), { origin, destination: transfer, profile: 'ordinary_walking_beta' }, { maxSnapMeters: 250 });
      const second = routeRuntimeGraph(await graph(destinationCell.id), { origin: transfer, destination, profile: 'ordinary_walking_beta' }, { maxSnapMeters: 250 });
      if (first.status === 'ROUTE_FOUND' && second.status === 'ROUTE_FOUND') best = { status: 'ROUTE_FOUND', distance_m: first.distance_m + second.distance_m, transfer };
    }
    result = best || { status: 'CROSS_CELL_STITCH_FAILED', originCell: originCell.id, destinationCell: destinationCell.id };
  }
  results.push({ from, to, originCell: originCell?.id || null, destinationCell: destinationCell?.id || null, status: result.status, distance_m: result.distance_m ?? null });
}
const report = { release: registry.release, results, directRoutesFound: results.filter((r) => r.status === 'ROUTE_FOUND').length, passed: results.every((r) => r.status === 'ROUTE_FOUND' || r.status === 'CROSS_CELL_REQUIRES_STITCH') };
console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
