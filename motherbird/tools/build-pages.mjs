import { access, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildKpiIndex } from './build-kpi-index.mjs';
import { exportFederalRegionRuntime } from './export-federal-region-runtime.mjs';

const toolDirectory = dirname(fileURLToPath(import.meta.url));
const sourceDirectory = resolve(toolDirectory, '..');
const outputDirectory = resolve(process.env.MOTHERBIRD_BUILD_DIR || resolve(sourceDirectory, 'dist'));

try {
  await exportFederalRegionRuntime();
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  console.warn('Federal region artifacts are not present; building the shell without the optional overlay package.');
}

// This is a static, browser-native application. Copy only the runtime files
// and directories needed by index.html, its module graph, and its data loaders.
const publishEntries = [
  'appalachian-lab',
  'app.js',
  'assets',
  'civic-releases',
  'css',
  'data',
  'field-editions',
  'federal-regions',
  'icon.svg',
  'icons',
  'index.html',
  'js',
  'legal.css',
  'manifest.webmanifest',
  'privacy.html',
  'radio.css',
  'regions',
  'service-worker.js',
  'shell.css',
  'splash-fix.css',
  'styles.css',
  'supabase-config.js',
  'terms.html',
  'watch.css',
  'watch.html',
  'watch.webmanifest',
  'vendor'
];

await rm(outputDirectory, { recursive: true, force: true });
await mkdir(outputDirectory, { recursive: true });

for (const entry of publishEntries) {
  const source = resolve(sourceDirectory, entry);
  try { await access(source, constants.R_OK); }
  catch (error) { if (entry === 'federal-regions' && error.code === 'ENOENT') continue; throw error; }
  await cp(source, resolve(outputDirectory, entry), { recursive: true });
}

// Make every Pages build detectable by the service-worker update check. The
// source worker keeps a readable fallback version for local development, while
// deployed builds use the Git commit (or a timestamp outside CI) as the shell
// cache identity. No manual cache-version bump is needed for app changes.
const buildVersion = (process.env.GITHUB_SHA || new Date().toISOString())
  .replace(/[^a-zA-Z0-9]/g, '')
  .slice(0, 24);
const serviceWorkerPath = resolve(outputDirectory, 'service-worker.js');
const serviceWorker = await readFile(serviceWorkerPath, 'utf8');
await writeFile(
  serviceWorkerPath,
  serviceWorker.replace(/const APP_CACHE = 'walk-wildlife-shell-[^']+';/, `const APP_CACHE = 'walk-wildlife-shell-${buildVersion}';`)
);

await access(resolve(outputDirectory, 'index.html'), constants.R_OK);
await writeFile(resolve(outputDirectory, '.nojekyll'), '');
await buildKpiIndex(resolve(outputDirectory, 'kpi'));

console.log(`Built GitHub Pages site: ${outputDirectory}`);
