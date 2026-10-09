import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSavedRoute } from '../js/saved-routes.js';
import { normalizeWorkspace, normalizeWorkspaceLink } from '../js/workspace.js';

test('legacy saved routes migrate to one editable default section without losing route data', () => {
  const route = normalizeSavedRoute({
    id: 'legacy-route', title: 'River loop', coordinates: [[38.9, -77.1], [38.91, -77.11]],
    stops: [{ id: 'p1', name: 'Market', lat: 38.9, lng: -77.1 }], distanceMeters: 1200,
    durationSeconds: 900, reasoning: 'quiet streets', routeOptions: [{ id: 'alt', title: 'Parkier', coordinates: [[38.9, -77.1], [38.91, -77.11]] }]
  });
  assert.equal(route.sections.length, 1);
  assert.equal(route.sections[0].title, 'Main route');
  assert.deepEqual(route.sections[0].coordinates, route.coordinates);
  assert.deepEqual(route.sections[0].stops, route.stops);
  assert.equal(route.reasoning, 'quiet streets');
  assert.equal(route.routeOptions[0].title, 'Parkier');
});

test('new sections preserve progress and section-local geometry', () => {
  const route = normalizeSavedRoute({ coordinates: [[1, 2], [2, 3]], sections: [{ id: 's1', title: 'Quiet approach', status: 'completed', distanceMeters: 450, durationSeconds: 330, coordinates: [[1, 2], [1.5, 2.5]] }] });
  assert.equal(route.sections[0].status, 'completed');
  assert.equal(route.sections[0].distanceMeters, 450);
  assert.deepEqual(route.sections[0].coordinates, [[1, 2], [1.5, 2.5]]);
});

test('workspace membership is link-shaped and keeps records in their source stores', () => {
  const workspace = normalizeWorkspace({ id: 'workspace:test', name: 'Field notes' });
  const link = normalizeWorkspaceLink({ workspaceId: workspace.id, recordType: 'observation', recordId: 'obs-1' });
  assert.equal(workspace.name, 'Field notes');
  assert.equal(link.id, 'workspace:test:observation:obs-1');
  assert.equal(link.recordId, 'obs-1');
});
