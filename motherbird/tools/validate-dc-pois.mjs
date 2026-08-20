#!/usr/bin/env node
import { readFile, stat } from 'node:fs/promises';
import { validatePois } from './dc-pipeline/core.mjs';
const file = new URL('../data/dc-poi.json', import.meta.url);
const json = JSON.parse(await readFile(file, 'utf8')); const pois = json.pointsOfInterest;
if (!Array.isArray(pois)) throw new Error('data/dc-poi.json must contain pointsOfInterest');
const { invalid } = validatePois(pois);
if (invalid.length) { console.error(JSON.stringify(invalid.slice(0, 30), null, 2)); throw new Error(`${invalid.length} invalid DC POIs`); }
const size = (await stat(file)).size;
if (size >= 10 * 1024 * 1024) throw new Error(`DC POI seed is too large: ${size} bytes`);
console.log(`✓ data/dc-poi.json is valid`); console.log(`✓ ${pois.length} POIs; ${(size / 1024 / 1024).toFixed(2)} MiB`); console.log('✓ All records have coordinates, provenance, confidence, and neighborhood assignment');

