import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('browser routing has a startup handshake and never references runtime-graph.json', async () => {
  const [worker, routing, server] = await Promise.all([
    readFile(new URL('../js/offline-router-worker.js', import.meta.url), 'utf8'),
    readFile(new URL('../js/routing.js', import.meta.url), 'utf8'),
    readFile(new URL('../../scripts/serve-motherbird.py', import.meta.url), 'utf8')
  ]);
  assert.match(worker, /worker-ready/);
  assert.match(worker, /crypto\.subtle\.digest/);
  assert.doesNotMatch(worker, /runtime-graph\.json/);
  assert.match(routing, /routing-worker-ready/);
  assert.match(routing, /ROUTING_WORKER_ERROR/);
  assert.match(server, /\.mjs.*application\/javascript/);
  assert.match(server, /\.js.*application\/javascript/);
});
