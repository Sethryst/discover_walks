#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { routeRuntimeGraph } from '../../js/runtime-router.mjs';

export async function createRouteServer({ graphs, port = 8787, host = '127.0.0.1' }) {
  const loaded = new Map();
  for (const [city, filePath] of Object.entries(graphs)) {
    loaded.set(city, JSON.parse(await fs.readFile(path.resolve(filePath), 'utf8')));
  }
  const server = http.createServer(async (request, response) => {
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return; }
    if (request.method !== 'POST' || request.url !== '/route') { json(response, 404, { error: 'POST /route is the only endpoint.' }); return; }
    try {
      const payload = JSON.parse(await readBody(request));
      const runtime = loaded.get(payload.city);
      if (!runtime || (payload.graph_version && payload.graph_version !== runtime.graph_version)) {
        json(response, 404, { ok: false, status: 'GRAPH_VERSION_UNAVAILABLE', failure: { type: 'GRAPH_VERSION_UNAVAILABLE', city: payload.city, requested_version: payload.graph_version || null } });
        return;
      }
      const result = routeRuntimeGraph(runtime, payload);
      json(response, result.ok ? 200 : failureStatus(result.status), result);
    } catch (error) {
      json(response, 400, { ok: false, status: 'INVALID_ROUTE_REQUEST', failure: { type: 'INVALID_ROUTE_REQUEST', message: error.message } });
    }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
  return server;
}

function parseArgs(args) {
  const graphs = {}; let port = 8787; let host = '127.0.0.1';
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--graph') {
      const [city, ...fileParts] = String(args[++index] || '').split('=');
      if (!city || !fileParts.length) throw new Error('--graph must be city=path/to/runtime-graph.json');
      graphs[city] = fileParts.join('=');
    } else if (args[index] === '--port') port = Number(args[++index]);
    else if (args[index] === '--host') host = args[++index];
    else throw new Error(`Unexpected argument: ${args[index]}`);
  }
  if (!Object.keys(graphs).length) throw new Error('Provide at least one --graph city=path/to/runtime-graph.json');
  return { graphs, port, host };
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = []; let bytes = 0;
    request.on('data', (chunk) => { bytes += chunk.length; if (bytes > 1_000_000) { reject(new Error('Request body is too large.')); request.destroy(); } else chunks.push(chunk); });
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

function json(response, status, payload) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(`${JSON.stringify(payload)}\n`);
}
function failureStatus(type) { return type === 'GRAPH_VERSION_UNAVAILABLE' ? 404 : type === 'NO_NEARBY_PEDESTRIAN_EDGE' ? 422 : 409; }

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2));
  createRouteServer(options).then(() => process.stdout.write(`Mother Bird route API listening on http://${options.host}:${options.port}/route\n`)).catch((error) => { process.stderr.write(`${error.stack || error.message}\n`); process.exitCode = 1; });
}
