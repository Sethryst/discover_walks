import { routeRuntimeGraph } from './runtime-router.mjs';
import { loadOfflineRoutingPackage } from './offline-routing-package.mjs';

const graphs = new Map();
const CITY_GRAPH = {
  newyork: '../data/pedestrian-runtime/nyc_pedestrian_network_estimates/runtime/runtime-graph.json',
  philadelphia: '../data/pedestrian-runtime/dvrpc_pedestrian_network_philadelphia_camden/runtime/runtime-graph.json'
};

self.onmessage = async ({ data }) => {
  if (data?.type !== 'route') return;
  try {
    const runtime = await loadGraph(data.city, data.packageManifestUrl, data.cellGraphPath);
    if (data.graph_version && data.graph_version !== runtime.graph_version) throw new Error(`Requested graph ${data.graph_version} is not installed.`);
    self.postMessage({ requestId: data.requestId, result: routeRuntimeGraph(runtime, data) });
  } catch (error) {
    self.postMessage({ requestId: data.requestId, result: { ok: false, status: 'GRAPH_VERSION_UNAVAILABLE', failure: { type: 'GRAPH_VERSION_UNAVAILABLE', city: data.city, message: error.message } } });
  }
};

async function loadGraph(city, packageManifestUrl = null, cellGraphPath = null) {
  const cacheKey = cellGraphPath || packageManifestUrl || city;
  if (graphs.has(cacheKey)) return graphs.get(cacheKey);
  if (cellGraphPath) {
    const graph = await readOpfsJson(cellGraphPath);
    if (graph?.schema_version !== 1) throw new Error('Cached cell routing graph is incompatible.');
    graphs.set(cacheKey, graph);
    return graph;
  }
  if (packageManifestUrl) {
    const { runtime } = await loadOfflineRoutingPackage(new URL(packageManifestUrl, self.location.href));
    graphs.set(cacheKey, runtime);
    return runtime;
  }
  const url = CITY_GRAPH[city];
  if (!url) throw new Error(`No pedestrian runtime graph is registered for ${city}.`);
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Runtime graph returned HTTP ${response.status}.`);
  const graph = await response.json();
  graphs.set(cacheKey, graph);
  return graph;
}

async function readOpfsJson(path) {
  if (!navigator.storage?.getDirectory) throw new Error('Origin Private File System is unavailable in the routing worker.');
  const parts = String(path).split('/').filter(Boolean);
  if (!parts.length || parts.some((part) => part === '.' || part === '..')) throw new Error('Cached graph path is invalid.');
  let directory = await navigator.storage.getDirectory();
  for (const part of parts.slice(0, -1)) directory = await directory.getDirectoryHandle(part);
  const file = await (await directory.getFileHandle(parts.at(-1))).getFile();
  return JSON.parse(await file.text());
}
