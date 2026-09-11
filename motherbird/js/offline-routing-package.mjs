const PACKAGE_FORMAT = 'motherbird-offline-walk-package-v1';
const RUNTIME_FORMAT = 'motherbird-runtime-graph-v1';

export function resolveOfflineRoutingPackage(manifest, manifestUrl) {
  if (manifest?.format !== PACKAGE_FORMAT || !manifest.package_version || !manifest.source_version) throw new Error('Unsupported offline walk package manifest.');
  const network = manifest.artifacts?.walk_network;
  const runtime = manifest.artifacts?.routing_runtime;
  if (network?.format !== 'pmtiles' || !network.path) throw new Error('Offline walk package is missing its walk-network PMTiles artifact.');
  if (runtime?.format !== RUNTIME_FORMAT || !runtime.path) throw new Error('Offline walk package is missing its routing runtime artifact.');
  if (network.source_version !== manifest.source_version || runtime.source_version !== manifest.source_version) throw new Error('Offline walk artifacts were not derived from the manifest source version.');
  return { manifest, networkUrl: new URL(network.path, manifestUrl), runtimeUrl: new URL(runtime.path, manifestUrl) };
}

export async function loadOfflineRoutingPackage(manifestUrl, { fetchImpl = fetch } = {}) {
  const manifestResponse = await fetchImpl(manifestUrl);
  if (!manifestResponse.ok) throw new Error(`Offline walk manifest returned HTTP ${manifestResponse.status}.`);
  const resolved = resolveOfflineRoutingPackage(await manifestResponse.json(), manifestUrl);
  const runtimeResponse = await fetchImpl(resolved.runtimeUrl);
  if (!runtimeResponse.ok) throw new Error(`Routing runtime returned HTTP ${runtimeResponse.status}.`);
  const runtime = await runtimeResponse.json();
  if (runtime.schema_version !== 1 || runtime.graph_version !== resolved.manifest.graph_version) throw new Error('Routing runtime version does not match the offline walk package manifest.');
  return { ...resolved, runtime };
}

export const OFFLINE_WALK_PACKAGE_FORMAT = PACKAGE_FORMAT;
