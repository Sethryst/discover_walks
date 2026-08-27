import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_REGISTRY_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../data/pedestrian-network-registry.json'
);

export async function loadRegistry(registryPath = DEFAULT_REGISTRY_PATH) {
  const parsed = JSON.parse(await fs.readFile(registryPath, 'utf8'));
  if (parsed?.scope !== 'walking_route_geometry_only' || !Array.isArray(parsed.datasets)) {
    throw new Error(`Invalid pedestrian registry: ${registryPath}`);
  }
  return parsed;
}

export function findDataset(registry, datasetId) {
  const dataset = registry.datasets.find(({ id }) => id === datasetId);
  if (!dataset) throw new Error(`Unknown pedestrian dataset: ${datasetId}`);
  return dataset;
}

export { DEFAULT_REGISTRY_PATH };
