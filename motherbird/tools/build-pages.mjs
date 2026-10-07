import { access, cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
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
  'pilot-routing-test.html',
  'radio.css',
  'regions',
  'research',
  'research-lab.html',
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

// This is an obsolete 1.2 GB routing release. The app uses the current
// 2026-10-04 manifests and remote/runtime routing paths; shipping the old
// archive makes the GitHub Pages artifact take so long to upload that newer
// deployments remain stuck behind it.
await rm(resolve(outputDirectory, 'data', 'national-routing', 'osm-us-2026-09-07'), { recursive: true, force: true });

// Make every Pages build detectable by the service-worker update check. The
// source worker keeps a readable fallback version for local development, while
// deployed builds use the Git commit (or a timestamp outside CI) as the shell
// cache identity. No manual cache-version bump is needed for app changes.
const buildVersion = (process.env.GITHUB_SHA || new Date().toISOString())
  .replace(/[^a-zA-Z0-9]/g, '')
  .slice(0, 24);
const serviceWorkerPath = resolve(outputDirectory, 'service-worker.js');
const serviceWorker = await readFile(serviceWorkerPath, 'utf8');
const versionedFiles = [];
async function collectFiles(directory) {
  for (const entry of await (await import('node:fs/promises')).readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) await collectFiles(path);
    else if (/\.(?:html|js|css|webmanifest)$/.test(entry.name)) versionedFiles.push(path);
  }
}
await collectFiles(outputDirectory);
for (const path of versionedFiles) {
  const source = await readFile(path, 'utf8');
  await writeFile(path, source.replace(/([?&]v=)[^&"']+/g, `$1${buildVersion}`));
}
await writeFile(
  serviceWorkerPath,
  serviceWorker.replace(/const APP_CACHE = 'walk-wildlife-shell-[^']+';/, `const APP_CACHE = 'walk-wildlife-shell-${buildVersion}';`)
);

const precacheBudgetBytes = Number(process.env.MOTHERBIRD_PRECACHE_BUDGET_BYTES || 20 * 1024 * 1024);
const installAssets = installShellForBudget(serviceWorker);
const precacheBytes = (await Promise.all(installAssets.map(async (asset) => {
  try { return (await stat(resolve(outputDirectory, asset))).size; } catch { return 0; }
}))).reduce((sum, bytes) => sum + bytes, 0);
if (precacheBytes > precacheBudgetBytes) throw new Error(`Install-time precache is ${precacheBytes} bytes, above ${precacheBudgetBytes}-byte budget.`);
console.log(`Install-time precache: ${precacheBytes} bytes / ${precacheBudgetBytes}`);

await access(resolve(outputDirectory, 'index.html'), constants.R_OK);
await writeFile(resolve(outputDirectory, '.nojekyll'), '');
await buildKpiIndex(resolve(outputDirectory, 'kpi'));

console.log(`Built GitHub Pages site: ${outputDirectory}`);

function installShellForBudget(workerSource) {
  const match = workerSource.match(/const shell = \[(.*?)\];/s);
  if (!match) return [];
  return [...match[1].matchAll(/'([^']+)'/g)].map(([, asset]) => asset)
    .filter((asset) => !asset.startsWith('./regions/') && !/(^|\/)(?:[^/]*-)?poi(?:s)?\.json$|(^|\/)records\.json$|(^|\/)cells\.json$|neighborhoods\.geojson$|runtime-graph\.json$|(?:fox|cloud|compass|splash)/i.test(asset));
}
