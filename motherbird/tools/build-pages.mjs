import { access, cp, mkdir, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildKpiIndex } from './build-kpi-index.mjs';

const toolDirectory = dirname(fileURLToPath(import.meta.url));
const sourceDirectory = resolve(toolDirectory, '..');
const outputDirectory = resolve(sourceDirectory, 'dist');

// This is a static, browser-native application. Copy only the runtime files
// and directories needed by index.html, its module graph, and its data loaders.
const publishEntries = [
  'app.js',
  'assets',
  'civic-releases',
  'css',
  'data',
  'field-editions',
  'icon.svg',
  'icons',
  'index.html',
  'js',
  'legal.css',
  'manifest.webmanifest',
  'privacy.html',
  'regions',
  'service-worker.js',
  'styles.css',
  'supabase-config.js',
  'terms.html',
  'vendor'
];

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });

for (const entry of publishEntries) {
  const source = resolve(sourceDirectory, entry);
  await access(source, constants.R_OK);
  await cp(source, resolve(outputDirectory, entry), { recursive: true });
}

await access(resolve(outputDirectory, 'index.html'), constants.R_OK);
await writeFile(resolve(outputDirectory, '.nojekyll'), '');
await buildKpiIndex(resolve(outputDirectory, 'kpi'));

console.log(`Built GitHub Pages site: ${outputDirectory}`);
