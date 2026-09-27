#!/usr/bin/env node
import fs from 'node:fs/promises';
import { buildPedestrianGraph, contractDegreeTwoGraph } from './graph-builder.mjs';
import { buildRuntimeGraph } from './runtime-package.mjs';

const args = Object.fromEntries(process.argv.slice(2).reduce((pairs, value, index, all) => {
  if (value.startsWith('--')) pairs.push([value.slice(2), all[index + 1]]);
  return pairs;
}, []));
if (!args.input || !args.output || !args['dataset-id'] || !args['source-release']) {
  throw new Error('Usage: national-cell-adapter.mjs --input FILE --output FILE --dataset-id ID --source-release RELEASE [--built-at ISO]');
}

const national = await readNationalSourceGraph(args.input);
if (national.format !== 'motherbird-national-walking-source-v1') throw new Error('Unsupported national graph input');
const features = national.edges.map((edge) => ({
  type: 'Feature',
  id: edge.source,
  properties: {
    ...edge.sourceTags,
    osm_identity: edge.source,
    _mb_edge_id: `${args['dataset-id']}:${edge.source}:${edge.lineIndex}:${edge.segmentIndex}`,
    _mb_source_dataset_id: args['dataset-id'],
    _mb_derived_from_raw_feature_ids: [edge.source],
    _mb_policy_warning: edge.flags & 1 ? 'One-way walking semantics are retained as provenance but not enforced by the browser runtime.' : undefined
  },
  geometry: { type: 'LineString', coordinates: edge.geometry }
}));
const dataset = {
  id: args['dataset-id'], jurisdiction: national.cell_id,
  source_id_fields: ['osm_identity'], classification_fields: ['crossing', 'footway', 'highway'],
  classification_map: {
    steps: 'footpath', footway: 'footpath', path: 'footpath', sidewalk: 'sidewalk',
    crossing: 'crossing', trail: 'trail', track: 'trail', pedestrian: 'pedestrian_plaza', corridor: 'indoor_pathway'
  },
  access_fields: ['foot', 'access'], default_access: 'unknown',
  edge_attribute_fields: ['name', 'ref', 'highway', 'footway', 'crossing', 'foot', 'access', 'oneway', 'oneway:foot', '@version', '_mb_source_dataset_id', '_mb_derived_from_raw_feature_ids', '_mb_policy_warning']
};
const rawGraph = buildPedestrianGraph({ type: 'FeatureCollection', features }, dataset, { snapToleranceMeters: 0 });
// The historical contraction implementation rebuilds the complete incident
// map and performs linear edge searches for every contraction. That is safe
// for city-sized graphs but becomes quadratic on national cells. Keep the
// graph topology intact for large cells; runtime-package.mjs already emits
// fixed-width binaries and the browser worker can load these predictably.
const graph = rawGraph.edges.length > 100_000 ? rawGraph : contractDegreeTwoGraph(rawGraph);
const runtime = buildRuntimeGraph(graph, dataset, { builtAt: args['built-at'], sourceVersion: args['source-release'] });
runtime.format = 'motherbird-runtime-graph-v1';
runtime.cell_id = national.cell_id;
runtime.release = national.release;
runtime.source_metadata = {
  release: national.release, source_objects: national.source_objects,
  duplicate_objects_removed: national.duplicate_objects_removed,
  oneway_semantics: 'preserved_in_edge_audit_source_attributes_not_enforced_by_runtime_router'
};
const temporary = `${args.output}.part`;
await fs.writeFile(temporary, `${JSON.stringify(runtime)}\n`);
await fs.rename(temporary, args.output);

// Read only the top-level edge objects instead of materializing the entire
// national-source JSON as one JavaScript string. Node has a hard string-length
// ceiling that large cells exceed even when sufficient heap is available.
async function readNationalSourceGraph(file) {
  const stream = (await import('node:fs')).createReadStream(file, { encoding: 'utf8', highWaterMark: 1024 * 1024 });
  let prefix = ''; let search = ''; let markerFound = false; let depth = 0; let object = ''; let inString = false; let escaped = false; const edges = [];
  for await (const chunk of stream) {
    if (!markerFound) {
      prefix += chunk.slice(0, Math.max(0, 2 * 1024 * 1024 - prefix.length));
      search = search.length < 2 * 1024 * 1024 ? search + chunk : (search + chunk).slice(-4096);
      const marker = search.indexOf('"edges"');
      if (marker < 0) continue;
      const start = search.indexOf('[', marker); if (start < 0) continue;
      markerFound = true;
      processChunk(search.slice(start + 1));
    } else processChunk(chunk);
  }
  const head = prefix.slice(0, Math.min(prefix.length, 2 * 1024 * 1024));
  const value = (key) => { const match = head.match(new RegExp('"' + key + '"\\s*:\\s*"([^"]*)"')); return match?.[1]; };
  const number = (key) => Number((head.match(new RegExp('"' + key + '"\\s*:\\s*(\\d+)')) || [])[1] || 0);
  return { format: 'motherbird-national-walking-source-v1', release: args['source-release'], cell_id: args['dataset-id'].split(':').at(-1), source_objects: number('source_objects'), duplicate_objects_removed: number('duplicate_objects_removed'), edges };

  function processChunk(text) {
    for (const ch of text) {
      if (inString) { object += ch; if (escaped) escaped = false; else if (ch === '\\') escaped = true; else if (ch === '"') inString = false; continue; }
      if (ch === '"') { inString = true; if (depth) object += ch; continue; }
      if (depth === 0) { if (ch === '{') { depth = 1; object = '{'; } else if (ch === ']') return; continue; }
      object += ch;
      if (ch === '{') depth += 1;
      else if (ch === '}') { depth -= 1; if (depth === 0) { edges.push(JSON.parse(object)); object = ''; } }
    }
  }
}
