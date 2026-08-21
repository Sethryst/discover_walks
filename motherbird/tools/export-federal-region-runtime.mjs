#!/usr/bin/env node
import { access, cp, mkdir, readFile, rename, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Publishes only browser runtime shards; canonical exact-join geometry stays offline. */
export async function exportFederalRegionRuntime({
  sourceRoot = path.join(projectRoot, 'federal-core', 'artifacts', 'nationwide-regions'),
  outputRoot = path.join(projectRoot, 'federal-regions')
} = {}) {
  await access(path.join(sourceRoot, 'manifest.json'), constants.R_OK);
  const stagingRoot = `${outputRoot}.staging`;
  const previousRoot = `${outputRoot}.previous`;
  assertSafe(outputRoot); assertSafe(stagingRoot); assertSafe(previousRoot);
  const sourceManifest = await readFile(path.join(sourceRoot, 'manifest.json'));
  try {
    const publishedManifest = await readFile(path.join(outputRoot, 'manifest.json'));
    if (sourceManifest.equals(publishedManifest)) {
      await Promise.all([rm(stagingRoot, { recursive: true, force: true }), rm(previousRoot, { recursive: true, force: true })]);
      return outputRoot;
    }
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  await rm(stagingRoot, { recursive: true, force: true });
  await mkdir(stagingRoot, { recursive: true });
  await Promise.all([
    cp(path.join(sourceRoot, 'manifest.json'), path.join(stagingRoot, 'manifest.json')),
    cp(path.join(sourceRoot, 'base'), path.join(stagingRoot, 'base'), { recursive: true }),
    cp(path.join(sourceRoot, 'congress'), path.join(stagingRoot, 'congress'), { recursive: true })
  ]);
  await rm(previousRoot, { recursive: true, force: true });
  let movedPublished = false;
  try { await rename(outputRoot, previousRoot); movedPublished = true; }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  try { await rename(stagingRoot, outputRoot); }
  catch (error) {
    if (movedPublished) await rename(previousRoot, outputRoot);
    throw error;
  }
  if (movedPublished) await rm(previousRoot, { recursive: true, force: true });
  return outputRoot;
}

function assertSafe(filename) {
  const resolved = path.resolve(filename);
  if (resolved === path.parse(resolved).root || resolved === projectRoot || path.basename(resolved).length < 4) throw new Error(`Unsafe runtime export path: ${resolved}`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) console.log(`Federal runtime exported to ${await exportFederalRegionRuntime()}.`);
