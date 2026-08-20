#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { poiStats } from './dc-pipeline/core.mjs';
const json = JSON.parse(await readFile(new URL('../data/dc-poi.json', import.meta.url), 'utf8'));
const stats = poiStats(json.pointsOfInterest || []);
console.log('DC POI Dataset Statistics'); console.log('========================='); console.log(`Total POIs: ${stats.total}`);
for (const [label, values] of Object.entries({ 'By category': stats.byCategory, 'By source': stats.bySource, 'By neighborhood': stats.byNeighborhood, 'By confidence': stats.byConfidence })) {
  console.log(`\n${label}:`); Object.entries(values).forEach(([name, count]) => console.log(`  ${name}: ${count}`));
}

