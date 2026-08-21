import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const date = '2026-08-20';
const version = 'v20260820';
const outDir = path.join(root, 'research', 'appalachian-corridor-lab', date);
const centerlineService = 'https://services1.arcgis.com/fBc8EJBxQRMcHlei/arcgis/rest/services/ANST_Centerline/FeatureServer/0';
const facilitiesService = 'https://services1.arcgis.com/fBc8EJBxQRMcHlei/arcgis/rest/services/ANST_Facilities/FeatureServer';
const routeBounds = { west: -78.075, south: 39.055, east: -77.905, north: 39.195 };
const supportBounds = { west: -78.22, south: 38.95, east: -77.80, north: 39.30 };

function envelope(bounds) { return JSON.stringify({ xmin: bounds.west, ymin: bounds.south, xmax: bounds.east, ymax: bounds.north, spatialReference: { wkid: 4326 } }); }
function queryUrl(endpoint, bounds, extra = {}) {
  const url = new URL(`${endpoint}/query`);
  url.search = new URLSearchParams({ where: '1=1', geometry: envelope(bounds), geometryType: 'esriGeometryEnvelope', inSR: '4326', spatialRel: 'esriSpatialRelIntersects', outFields: '*', returnGeometry: 'true', outSR: '4326', f: 'geojson', ...extra });
  return url;
}
async function json(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.json();
}
async function probe(name, url, options = {}) {
  const started = Date.now();
  try { const response = await fetch(url, options); return { name, url: String(url), status: response.status, healthy: response.ok, latencyMs: Date.now() - started }; }
  catch (error) { return { name, url: String(url), status: null, healthy: false, latencyMs: Date.now() - started, error: error.message }; }
}
function lineParts(geojson) { return (geojson.features || []).flatMap((feature) => feature.geometry?.type === 'LineString' ? [feature.geometry.coordinates] : feature.geometry?.type === 'MultiLineString' ? feature.geometry.coordinates : []); }
const radians = Math.PI / 180;
function localXY([lng, lat], origin) { return [(lng - origin[0]) * 111320 * Math.cos(origin[1] * radians), (lat - origin[1]) * 110540]; }
function pointSegmentMeters(point, start, end) {
  const [px, py] = localXY(point, point), [ax, ay] = localXY(start, point), [bx, by] = localXY(end, point);
  const dx = bx - ax, dy = by - ay, denominator = dx * dx + dy * dy;
  const t = denominator ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / denominator)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
function distanceToNetwork(point, lines) {
  return Math.min(...lines.flatMap((line) => line.slice(1).map((end, index) => pointSegmentMeters(point, line[index], end))));
}
function point(feature) { return feature.geometry?.type === 'Point' ? feature.geometry.coordinates : null; }
function nameOf(feature) { return feature.properties?.Name || feature.properties?.FMSS_Name || `Parking ${feature.properties?.OBJECTID}`; }
function rankParking(feature, lines) {
  const name = nameOf(feature);
  const priority = /Bears Den/i.test(name) ? 1 : /Snickers Gap/i.test(name) ? 2 : /Ashby Gap/i.test(name) ? 3 : /G\. R\. Thompson/i.test(name) ? 4 : 9;
  return { priority, distanceToCenterlineMeters: Math.round(distanceToNetwork(point(feature), lines)) };
}
function featureCollection(features, metadata) { return { type: 'FeatureCollection', metadata, features }; }
function hashGeometry(geojson) { return createHash('sha256').update(JSON.stringify((geojson.features || []).map((feature) => feature.geometry))).digest('hex'); }

await mkdir(outDir, { recursive: true });
const retrievedAt = new Date().toISOString();
const [metadata, routeCenterline, supportCenterline, parkingAllCount, parking, vistas, shelters, campsites, sideTrails] = await Promise.all([
  json(`${centerlineService}?f=pjson`),
  json(queryUrl(centerlineService, routeBounds)),
  json(queryUrl(centerlineService, supportBounds)),
  json(`${facilitiesService}/2/query?where=1%3D1&returnCountOnly=true&f=json`),
  json(queryUrl(`${facilitiesService}/2`, supportBounds)),
  json(queryUrl(`${facilitiesService}/5`, supportBounds)),
  json(queryUrl(`${facilitiesService}/4`, supportBounds)),
  json(queryUrl(`${facilitiesService}/1`, supportBounds)),
  json(queryUrl(`${facilitiesService}/6`, supportBounds))
]);
const supportLines = lineParts(supportCenterline);
const geometryHash = hashGeometry(supportCenterline);
const centerlineArtifact = featureCollection(supportCenterline.features, {
  schemaVersion: 1, status: 'research-grade', retrievedAt, serviceUrl: centerlineService, layerId: 0,
  sourceCoordinateSystem: metadata.extent?.spatialReference, outputCoordinateSystem: 'EPSG:4326', geometryHash,
  routeBounds, supportBounds, routeFeatureCount: routeCenterline.features?.length || 0, supportFeatureCount: supportCenterline.features?.length || 0,
  vertexCount: supportLines.reduce((sum, line) => sum + line.length, 0), fields: metadata.fields,
  knownRelocations: { status: 'not established by inspected structured source', blocker: 'check current ATC/NPS relocation and closure notices before editor sign-off' }
});

const rankedParking = (parking.features || []).filter(point).map((feature) => ({ feature, ...rankParking(feature, supportLines) })).sort((a, b) => a.priority - b.priority || a.distanceToCenterlineMeters - b.distanceToCenterlineMeters);
const inventory = {
  schemaVersion: 1, status: 'research-grade', retrievedAt, source: { serviceUrl: facilitiesService, layerId: 2, noFilterCount: parkingAllCount.count, clippedQuery: queryUrl(`${facilitiesService}/2`, supportBounds).toString() },
  bounds: supportBounds, count: rankedParking.length,
  records: rankedParking.map(({ feature, priority, distanceToCenterlineMeters }, index) => ({ rank: index + 1, priorityBand: priority, objectId: feature.properties.OBJECTID, officialNames: [...new Set([feature.properties.Name, feature.properties.FMSS_Name, feature.properties.Feat_Name].filter(Boolean))], coordinates: point(feature), distanceToCenterlineMeters, rawAttributes: feature.properties }))
};

const accessSources = {
  'Bears Den': ['https://www.nps.gov/appa/planyourvisit/maps.htm'],
  'Snickers Gap': ['https://www.clarkecounty.gov/home/showpublisheddocument/13003/638670145120270000', 'https://www.nps.gov/appa/planyourvisit/maps.htm'],
  'Ashby Gap': ['https://fhfl15gisweb.flhd.fhwa.dot.gov/Nps/Reports/Rip/Cycle6/APPA_C6_RipReport.pdf', 'https://www.nps.gov/appa/planyourvisit/maps.htm'],
  'G. R. Thompson': ['https://www.nps.gov/appa/planyourvisit/maps.htm']
};
const topAccess = rankedParking.filter(({ feature }) => /Bears Den|Snickers Gap|Ashby Gap|G\. R\. Thompson/i.test(nameOf(feature))).slice(0, 6).map(({ feature, distanceToCenterlineMeters }) => {
  const name = nameOf(feature); const key = Object.keys(accessSources).find((candidate) => name.includes(candidate));
  const snickers = /Snickers Gap/i.test(name), ashby = /Ashby Gap/i.test(name);
  return { candidateId: `official-entry-${feature.properties.OBJECTID}`, name, coordinates: point(feature), evidenceGrade: 'research-grade', editorSigned: false,
    publicAccess: snickers ? 'public parking described by Clarke County technical memorandum; current status still requires review' : 'unknown-current',
    closureStatus: 'not verified current', surface: ashby ? 'gravel reported by FHWA/NPS road inventory; verify current' : null, capacity: null,
    trailConnection: snickers ? { method: 'road shoulder / road crossing described by official county memorandum', distanceMeters: distanceToCenterlineMeters, signedGuidance: 'additional pedestrian warning signs reported; current condition unverified' } : { method: 'not established', distanceMeters: distanceToCenterlineMeters, signedGuidance: null },
    sources: accessSources[key] || ['https://www.nps.gov/appa/planyourvisit/maps.htm'], retrievedAt,
    blockers: ['current public access confirmation', 'current closure check', 'connection method field verification', 'editor sign-off'] };
});
const accessEvidence = { schemaVersion: 1, status: 'research-grade', retrievedAt, records: topAccess };

const endpointFeatures = rankedParking.filter((record) => record.distanceToCenterlineMeters <= 300).map(({ feature, distanceToCenterlineMeters }) => ({ type: 'Feature', geometry: feature.geometry, properties: { id: `endpoint-parking-${feature.properties.OBJECTID}`, name: nameOf(feature), kind: 'official-parking', distanceToCenterlineMeters, rationale: 'official parking within 300 m of authoritative support-envelope centerline', durationTargetMinutes: [15, 40], publishingState: 'candidate', reviewRequired: true } }));
for (const [kind, collection] of [['vista', vistas], ['shelter', shelters], ['campsite', campsites]]) {
  for (const feature of collection.features || []) if (point(feature)) { const distance = Math.round(distanceToNetwork(point(feature), supportLines)); if (distance <= 200) endpointFeatures.push({ type: 'Feature', geometry: feature.geometry, properties: { id: `endpoint-${kind}-${feature.properties.OBJECTID}`, name: nameOf(feature), kind, distanceToCenterlineMeters: distance, rationale: `official ${kind} within 200 m of centerline`, durationTargetMinutes: [15, 40], publishingState: 'candidate', reviewRequired: true } }); }
}
const endpoints = featureCollection(endpointFeatures, { schemaVersion: 1, status: 'research-grade', retrievedAt, rule: 'Natural endpoints only; no walkable window is emitted until an entry is editor-verified.', sideTrailFeatureCount: sideTrails.features?.length || 0 });

const healthUrls = [
  ['NPS/ATC centerline ArcGIS', `${centerlineService}?f=pjson`, {}],
  ['NPS/ATC parking ArcGIS', `${facilitiesService}/2?f=pjson`, {}],
  ['OpenStreetMap Overpass primary', 'https://overpass-api.de/api/interpreter?data=%5Bout%3Ajson%5D%3Bnode%5Bamenity%3Dparking%5D%2839.05%2C-78.08%2C39.20%2C-77.90%29%3Bout%201%3B', { headers: { Accept: 'application/json' } }],
  ['OpenStreetMap Nominatim fallback', 'https://nominatim.openstreetmap.org/search?format=jsonv2&q=Bears%20Den%20Virginia&limit=1', { headers: { Accept: 'application/json', 'User-Agent': 'MotherBirdResearch/1.0' } }],
  ['ATC events', 'https://appalachiantrail.org/events/', {}],
  ['ATC volunteer', 'https://appalachiantrail.org/home/volunteer', {}]
];
const health = await Promise.all(healthUrls.map(([name, url, options]) => probe(name, url, options)));
const healthMatrix = { schemaVersion: 1, status: 'research-grade', retrievedAt, policy: 'Primary official source must be healthy or carry an explicit time-limited editor waiver. OSM is secondary; fallback success never clears a primary error.', sources: health.map((source) => ({ ...source, freshnessSlaHours: source.name.includes('ArcGIS') ? 168 : 24, waiverRequiredWhenUnhealthy: true })) };

const poiPolicy = `# Appalachian Corridor Lab POI family policy · ${date}\n\nStatus: research-grade; review-only.\n\n## Allowed\n\n- Official parking and signed trailheads.\n- Official vistas, shelters, and campsites inside the research envelope.\n- Official water sources only when a maintained authoritative layer exists.\n- Café or store candidates only after an entry is editor-verified, within 1 mile of that entry, and on a documented logical approach.\n\n## Excluded\n\n- Generic neighbourhoods and distant towns.\n- OSM-only parking as entry evidence.\n- Businesses measured only to the lab center.\n- Any point with unknown geometry, provenance, or current access.\n`;
const feasibility = `# Event and volunteer extraction feasibility · ${date}\n\n## Result\n\nParser not ready — keep source-only.\n\nThe ATC events page exposes titles, date text, locations, categories, and detail links, but expiry and corridor relevance are not a stable structured contract. The volunteer landing page delegates changing opportunities to a separate engagement platform. Neither inspected surface provides a sufficiently stable four-field contract (date, location, organizer, expiry) for unattended promotion.\n\n- Events source: https://appalachiantrail.org/events/\n- Volunteer source: https://appalachiantrail.org/home/volunteer\n- Policy: missing any required field blocks that item for the run.\n`;
const readme = `# Appalachian Corridor Lab upstream research · ${date}\n\n## Technical summary\n\nThe current lab route envelope is misaligned with its named Bears Den / Snickers Gap focus. Its eastern edge is ${routeBounds.east}, while the official Bears Den and Snickers Gap parking records are near longitude -77.854. The previously cached route-envelope centerline covers a different southern/western slice; distances of 6–13 km from those parking records to that slice must not be used for route binding.\n\nThis package pulls the authoritative centerline over the full support envelope, preserves the official parking attributes, and creates research-grade access and endpoint evidence. Nothing here is editor-signed or promotable.\n\n## Key findings\n\n- The route-envelope parking query remains empty; the support envelope returns ${inventory.count} official parking records.\n- The support-envelope centerline contains ${centerlineArtifact.metadata.supportFeatureCount} features and ${centerlineArtifact.metadata.vertexCount} vertices, hashed as ${geometryHash}.\n- ${endpointFeatures.length} official endpoint candidates fall within the configured 200–300 m geometric thresholds. Geometry proximity does not establish access.\n- Event and volunteer parsing remains source-only.\n- Source health is recorded in the matrix; primary failures require an explicit, expiring waiver.\n\n## Scope and method\n\nArcGIS source geometries were requested in EPSG:4326 and clipped server-side to the explicit support envelope. Parking was ranked by named lab relevance and then geometric proximity. Connection distances use point-to-line-segment distance in a local equirectangular projection, suitable for screening at this geographic scale but not a routing engine.\n\n## Limitations and robustness\n\nThe centerline source does not itself establish recent relocations or closures. Parking attributes do not prove current public access. Snickers Gap connection notes are supported by an official county memorandum but require current field/editor review. Other access fields remain unknown rather than inferred.\n\n## Required next steps\n\n1. Review the corrected support-envelope centerline and redefine the tight route envelope around the intended focus.\n2. Editor-review Bears Den and Snickers Gap access, closure, and connector evidence.\n3. Bind candidate windows only after at least one entry is verified.\n4. Keep OSM services and event/volunteer records behind their existing health and completeness gates.\n\n## Further questions\n\n- Is Bears Den / Snickers Gap the intended first micro-region, or should the existing Morgan Mill slice remain a separate lab?\n- Which authority owns the final current-access decision for each parking record?\n- Is an official current closures feed available for this corridor?\n`;

await Promise.all([
  writeFile(path.join(outDir, `centerline-segment-${version}.geojson`), JSON.stringify(centerlineArtifact, null, 2)),
  writeFile(path.join(outDir, `official-parking-inventory-${version}.json`), JSON.stringify(inventory, null, 2)),
  writeFile(path.join(outDir, `access-evidence-seed-${version}.json`), JSON.stringify(accessEvidence, null, 2)),
  writeFile(path.join(outDir, `candidate-window-endpoints-${version}.geojson`), JSON.stringify(endpoints, null, 2)),
  writeFile(path.join(outDir, `poi-family-policy-${version}.md`), poiPolicy),
  writeFile(path.join(outDir, `source-health-matrix-${version}.json`), JSON.stringify(healthMatrix, null, 2)),
  writeFile(path.join(outDir, `event-volunteer-feasibility-${version}.md`), feasibility),
  writeFile(path.join(outDir, 'README.md'), readme)
]);
console.log(JSON.stringify({ outDir, parkingRecords: inventory.count, endpoints: endpointFeatures.length, centerlineFeatures: centerlineArtifact.metadata.supportFeatureCount, centerlineVertices: centerlineArtifact.metadata.vertexCount, health: health.map(({ name, status }) => ({ name, status })) }, null, 2));
