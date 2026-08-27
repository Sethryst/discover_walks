import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { routeRuntimeGraph } from '../js/runtime-router.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const suites = {
  newyork: '../data/pedestrian-runtime/nyc_pedestrian_network_estimates/runtime/runtime-graph.json',
  philadelphia: '../data/pedestrian-runtime/dvrpc_pedestrian_network_philadelphia_camden/runtime/runtime-graph.json'
};

for (const [city, graphRelativePath] of Object.entries(suites)) {
  test(`${city} route-truth cases match the installed runtime graph`, async (context) => {
    const graph = JSON.parse(await fs.readFile(path.resolve(root, graphRelativePath), 'utf8'));
    const caseDirectory = path.resolve(root, 'routes', city);
    const caseFiles = (await fs.readdir(caseDirectory)).filter((name) => name.endsWith('.json')).sort();
    assert.ok(caseFiles.length >= 7);
    for (const caseFile of caseFiles) await context.test(caseFile, async () => {
      const definition = JSON.parse(await fs.readFile(path.join(caseDirectory, caseFile), 'utf8'));
      assert.ok(['pending', 'pass', 'fail'].includes(definition.human_verdict));
      assert.ok(Array.isArray(definition.expected_corridor_ids));
      assert.ok(Array.isArray(definition.expected_crossing_ids));
      assert.ok(Array.isArray(definition.forbidden_edge_ids));
      const result = routeRuntimeGraph(graph, definition, { maxSnapMeters: definition.max_snap_m || 150 });
      const actual = result.ok ? 'route_found' : result.status;
      assert.equal(actual, definition.expected_result);
      if (result.ok) {
        assert.ok(result.geometry.coordinates.length >= 2);
        assert.ok(result.edge_ids.every((edgeId) => !definition.forbidden_edge_ids.includes(edgeId)));
        assert.ok(definition.expected_corridor_ids.every((edgeId) => result.edge_ids.includes(edgeId)));
        assert.ok(definition.expected_crossing_ids.every((edgeId) => result.crossing_edge_ids.includes(edgeId)));
        assert.equal(result.policy_version, graph.policy_version);
        if (city === 'philadelphia' && /arterial_crossing|cross_jurisdiction/.test(caseFile)) assert.ok(result.crossing_edge_ids.length > 0);
      }
    });
  });
}
