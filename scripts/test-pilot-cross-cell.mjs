#!/usr/bin/env node
/** Exercise the staged two-leg boundary handoff with real pilot graphs. */
import fs from 'node:fs/promises';
import { routeRuntimeGraph } from '../motherbird/js/runtime-router.mjs';

const root = process.argv[2] || '.tmp-cache/pilot-build';
const leftId = 'z10-291-391';
const rightId = 'z10-292-391';
const transfer = [-77.34375, 38.921282];
const leftOrigin = [-77.35, 38.921];
const rightDestination = [-77.34, 38.921];

async function graph(id) {
  return JSON.parse(await fs.readFile(`${root}/cells/${id}/runtime-graph.json`, 'utf8'));
}

const left = await graph(leftId);
const right = await graph(rightId);
const first = routeRuntimeGraph(left, { origin: leftOrigin, destination: transfer, profile: 'ordinary_walking_beta' }, { maxSnapMeters: 250 });
const second = routeRuntimeGraph(right, { origin: transfer, destination: rightDestination, profile: 'ordinary_walking_beta' }, { maxSnapMeters: 250 });
const failure = routeRuntimeGraph(right, { origin: [-77, 38], destination: rightDestination, profile: 'ordinary_walking_beta' }, { maxSnapMeters: 20 });
const policy = routeRuntimeGraph(right, { origin: transfer, destination: rightDestination, profile: 'unsupported_profile' });

const report = {
  release: left.source_version,
  cells: [left.cell_id, right.cell_id],
  transfer,
  firstLeg: { status: first.status, distance_m: first.distance_m, snaps: first.snaps },
  secondLeg: { status: second.status, distance_m: second.distance_m, snaps: second.snaps },
  typedFailures: { overSnapDistance: failure.status, accessPolicy: policy.status },
  passed: first.status === 'ROUTE_FOUND' && second.status === 'ROUTE_FOUND'
    && failure.status === 'NO_NEARBY_PEDESTRIAN_EDGE' && policy.status === 'ACCESS_POLICY_BLOCKED'
};
console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
