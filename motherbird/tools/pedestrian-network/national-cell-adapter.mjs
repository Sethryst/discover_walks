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

const national = JSON.parse(await fs.readFile(args.input, 'utf8'));
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
const graph = contractDegreeTwoGraph(buildPedestrianGraph({ type: 'FeatureCollection', features }, dataset, { snapToleranceMeters: 0 }));
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
