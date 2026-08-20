import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const regionId = process.argv[2] || 'washington-dc';
const producerRoot = path.resolve(process.cwd(), process.argv[3] || '../releases');
const bundle = path.join(producerRoot, regionId);
const manifest = JSON.parse(await readFile(path.join(bundle, 'producer-manifest.json'), 'utf8'));
const layer = manifest.geography?.find((item) => item.role === 'neighborhood_boundaries');
if (!layer) throw new Error(`${regionId} producer manifest has no neighborhood_boundaries layer.`);
const sourcePath = path.join(bundle, ...layer.filename.split('/')); const payload = await readFile(sourcePath);
const actual = `sha256:${createHash('sha256').update(payload).digest('hex')}`;
if (manifest.checksums?.[layer.filename] !== actual) throw new Error(`Producer checksum mismatch for ${layer.filename}.`);
const destination = path.resolve(process.cwd(), 'regions', regionId, 'geography'); await mkdir(destination, { recursive: true });
await copyFile(sourcePath, path.join(destination, 'neighborhoods.geojson'));
await writeFile(path.join(destination, 'source.json'), `${JSON.stringify({ schemaVersion: 1, regionId, installedFrom: path.relative(process.cwd(), bundle), layer, checksum: actual, generatedAt: manifest.generatedAt, producer: manifest.producer }, null, 2)}\n`, 'utf8');
console.log(`Synced ${layer.featureCount} neighborhoods from ${path.relative(process.cwd(), bundle)} (${actual}).`);
