import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';

const FILTERS = [
  'w/highway', 'w/sidewalk', 'w/footway', 'w/crossing', 'w/barrier', 'w/access', 'w/foot',
  'n/highway=crossing', 'n/barrier', 'r/highway', 'r/barrier'
];

export async function convertOsmPbf(pbfPath, boundaryPath, workDir, {
  osmiumPath = process.env.OSMIUM_PATH || 'osmium'
} = {}) {
  await validatePbf(pbfPath);
  await ensureReadable(boundaryPath, 'Region boundary');
  await fs.mkdir(workDir, { recursive: true });
  const clipped = path.join(workDir, 'clipped.osm.pbf');
  const filtered = path.join(workDir, 'walkable-and-barriers.osm.pbf');
  const exported = path.join(workDir, 'walkable-and-barriers.geojsonseq');
  try {
    await run(osmiumPath, ['extract', '--polygon', boundaryPath, '--set-bounds', '--overwrite', '-o', clipped, pbfPath]);
    await run(osmiumPath, ['tags-filter', '--overwrite', '-o', filtered, clipped, ...FILTERS]);
    await run(osmiumPath, ['export', '--overwrite', '-f', 'geojsonseq', '-o', exported, filtered]);
  } catch (error) {
    if (error.code === 'ENOENT') {
      throw new Error(`OSM PBF conversion requires osmium-tool. Install 'osmium' on PATH or set OSMIUM_PATH to its executable; the producer did not substitute another artifact.`, { cause: error });
    }
    throw error;
  }
  const features = [];
  const contents = await fs.readFile(exported, 'utf8');
  for (const [index, line] of contents.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    try { features.push(JSON.parse(line.replace(/^\x1e/, ''))); }
    catch (error) { throw new Error(`osmium export produced invalid GeoJSON sequence record ${index + 1}: ${error.message}`); }
  }
  if (!features.length) throw new Error('The clipped PBF contains no OSM objects with pedestrian, road, crossing, barrier, or access tags.');
  const info = await fileInfo(osmiumPath, clipped);
  return {
    featureCollection: { type: 'FeatureCollection', features },
    acquisition: {
      method: 'osmium_pbf_extract_tags_filter_export',
      adapter: 'motherbird-osmium-pbf-v1',
      filters: FILTERS,
      source_timestamp: info.timestamp || null,
      source_replication_sequence: info.sequence || null
    }
  };
}

export async function validatePbf(pbfPath) {
  let handle;
  try {
    handle = await fs.open(pbfPath, 'r');
    const buffer = Buffer.alloc(4);
    const { bytesRead } = await handle.read(buffer, 0, 4, 0);
    const stats = await handle.stat();
    if (bytesRead !== 4 || stats.size < 1024 || buffer[0] !== 0 || buffer[1] !== 0 || buffer[2] !== 0) {
      throw new Error(`OSM PBF input is missing or does not have a plausible BlobHeader: ${pbfPath}`);
    }
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error(`OSM PBF input is missing: ${pbfPath}`);
    throw error;
  } finally {
    await handle?.close();
  }
}

function fileInfo(osmiumPath, file) {
  return Promise.all([
    capture(osmiumPath, ['fileinfo', '-g', 'header.option.timestamp', file]).catch(() => ''),
    capture(osmiumPath, ['fileinfo', '-g', 'header.option.osmosis_replication_sequence_number', file]).catch(() => '')
  ]).then(([timestamp, sequence]) => ({ timestamp: timestamp.trim() || null, sequence: sequence.trim() || null }));
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`${command} ${args[0]} exited with ${code}: ${stderr.trim()}`)));
  });
}

function capture(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('exit', (code) => code === 0 ? resolve(stdout) : reject(new Error(`${command} fileinfo exited with ${code}: ${stderr.trim()}`)));
  });
}

async function ensureReadable(file, label) {
  try { await fs.access(file); }
  catch { throw new Error(`${label} is missing: ${file}`); }
}
