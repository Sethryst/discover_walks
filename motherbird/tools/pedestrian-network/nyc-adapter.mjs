import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export async function fetchNycSupplement(dataset, zipPath, { ogr2ogr = process.env.OGR2OGR_PATH || 'ogr2ogr' } = {}) {
  if (!zipPath) throw new Error(`${dataset.id}: --input-zip is required`);
  const resolvedZip = path.resolve(zipPath);
  const stat = await fsp.stat(resolvedZip);
  if (!stat.isFile()) throw new Error(`${dataset.id}: ZIP input is not a file`);
  const member = dataset.archive_member || 'NYC_pednetwork_estimates_counts_2018-2019.geojson';
  const temporaryDirectory = await fsp.mkdtemp(path.join(os.tmpdir(), 'motherbird-nyc-pednetwork-'));
  const reprojectedPath = path.join(temporaryDirectory, 'nyc-pednetwork-epsg4326.geojson');
  const vsiPath = `/vsizip/${resolvedZip.replaceAll('\\', '/')}/${member}`;
  try {
    await runProcess(ogr2ogr, [
      '-f', 'GeoJSON',
      reprojectedPath,
      vsiPath,
      '-s_srs', dataset.source_crs || 'EPSG:6538',
      '-t_srs', 'EPSG:4326',
      '-lco', 'RFC7946=YES',
      '-lco', 'COORDINATE_PRECISION=9'
    ]);
    const featureCollection = JSON.parse(await fsp.readFile(reprojectedPath, 'utf8'));
    if (featureCollection?.type !== 'FeatureCollection' || !Array.isArray(featureCollection.features)) {
      throw new Error(`${dataset.id}: reprojected archive member is not a FeatureCollection`);
    }
    return {
      featureCollection,
      acquisition: {
        method: 'publisher_supplement_zip_gdal_reprojection',
        archive_path: resolvedZip,
        archive_member: member,
        archive_sha256: await hashFile(resolvedZip),
        archive_bytes: stat.size,
        source_crs: dataset.source_crs || 'EPSG:6538',
        service_crs: 4326,
        source_last_edit: dataset.source_last_edit || null,
        original_format: 'GeoJSON in ZIP'
      }
    };
  } finally {
    const resolvedTemporary = path.resolve(temporaryDirectory);
    if (resolvedTemporary.startsWith(path.resolve(os.tmpdir()) + path.sep)) {
      await fsp.rm(resolvedTemporary, { recursive: true, force: true });
    }
  }
}

function runProcess(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk) => { if (stderr.length < 20_000) stderr += chunk; });
    child.on('error', (error) => reject(new Error(`Unable to run ${command}: ${error.message}`)));
    child.on('close', (code) => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}: ${stderr.trim()}`)));
  });
}

function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}
