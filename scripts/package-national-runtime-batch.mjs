import fs from 'node:fs/promises';
import path from 'node:path';
import { writeRuntimePackage } from '../motherbird/tools/pedestrian-network/runtime-package.mjs';

const [sourceRoot, targetRoot] = process.argv.slice(2);
if (!sourceRoot || !targetRoot) throw new Error('usage: node package-national-runtime-batch.mjs SOURCE_CELLS TARGET_CELLS');
const ids = (await fs.readdir(sourceRoot, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
let packaged = 0;
for (const id of ids) {
  const source = path.join(sourceRoot, id);
  const runtime = JSON.parse(await fs.readFile(path.join(source, 'runtime-graph.json'), 'utf8'));
  const target = path.join(targetRoot, id);
  await writeRuntimePackage(target, runtime);
  packaged += 1;
  console.log(JSON.stringify({ id, bytes: (await fs.stat(path.join(target, 'runtime-graph.json'))).size }));
}
console.log(JSON.stringify({ packaged, sourceRoot, targetRoot }));
