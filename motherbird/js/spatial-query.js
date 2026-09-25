// Spatial Queries turn map gestures into typed, reusable questions.
// This module is deliberately local-first: query records are portable and do
// not require a server or a new backend contract.
import db from './storage.js';
import { uid } from './utils.js';

export const SPATIAL_QUERY_TYPES = Object.freeze({
  Circle: 'area-exploration',
  Line: 'route-test',
  Polygon: 'territory-investigation',
  Rectangle: 'territory-investigation',
  Freehand: 'territory-investigation',
  Marker: 'place-inspection'
});

export function queryTypeForShape(shape) {
  return SPATIAL_QUERY_TYPES[shape] || 'place-inspection';
}

export function createSpatialQuery({ shape, geometry, regionId = null, title = '' } = {}) {
  if (!shape || !geometry) throw new Error('A spatial query needs a shape and geometry.');
  return {
    id: uid('spatial-query'),
    schemaVersion: 1,
    shape,
    queryType: queryTypeForShape(shape),
    geometry,
    regionId,
    title: String(title || '').trim().slice(0, 120),
    createdAt: new Date().toISOString(),
    status: 'draft',
    resultIds: [],
    discoverCategoryId: null
  };
}

export async function saveSpatialQuery(query) {
  const record = { ...query, resultIds: [...new Set(query.resultIds || [])] };
  await db.put('spatial_queries', record);
  return record;
}

export async function listSpatialQueries() {
  return db.all('spatial_queries');
}

export function queryPrompt(query) {
  const prompts = {
    'area-exploration': 'What is worth discovering in this area?',
    'route-test': 'Can this intended path become a walkable route?',
    'territory-investigation': 'What belongs to this defined territory?',
    'place-inspection': 'What is this place connected to?'
  };
  return prompts[query?.queryType] || prompts['place-inspection'];
}
