/**
 * Review-only Appalachian Corridor Lab producer.
 * It never publishes to the walker UI: it refreshes a bounded, source-backed
 * candidate package that an editor must explicitly promote later.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const labId = 'appalachian-corridor-lab';
const sourceUrl = 'https://services1.arcgis.com/fBc8EJBxQRMcHlei/arcgis/rest/services/ANST_Centerline/FeatureServer/0/query';
const facilitiesUrl = 'https://services1.arcgis.com/fBc8EJBxQRMcHlei/arcgis/rest/services/ANST_Facilities/FeatureServer';
// A deliberately small Loudoun / Bears Den envelope. It is a laboratory
// boundary, not a claim that this is the political extent of the A.T.
export const LAB_BOUNDS = { west: -78.075, south: 39.055, east: -77.905, north: 39.195 };
export const MAX_DEFAULT_SECTIONS = 18;
export const TARGET_SECTION_METERS = 1200;
export const MAX_CONTEXT_ITEMS_PER_SOURCE = 18;
export const MAX_UNVERIFIED_SUPPORT_MILES = 5;
// A wider support envelope allows the lab to demonstrate arrival amenities
// without pretending every result is on the trail itself.
export const CONTEXT_BOUNDS = { west: -78.22, south: 38.95, east: -77.80, north: 39.30 };
const osmSourceUrl = 'https://www.openstreetmap.org/copyright';
const eventsUrl = 'https://appalachiantrail.org/events/';
const volunteerUrl = 'https://appalachiantrail.org/experience/hike-the-trail/at-basics/faqs/';

const radians = Math.PI / 180;
function distanceMeters([lng1, lat1], [lng2, lat2]) {
  const dLat = (lat2 - lat1) * radians;
  const dLng = (lng2 - lng1) * radians;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * radians) * Math.cos(lat2 * radians) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.sqrt(a));
}
function lineLength(coordinates) { return coordinates.slice(1).reduce((sum, point, index) => sum + distanceMeters(coordinates[index], point), 0); }
function splitLine(coordinates, count) {
  if (count <= 1) return [coordinates];
  const target = lineLength(coordinates) / count;
  const sections = []; let section = [coordinates[0]], carried = 0, nextCut = target;
  for (let index = 1; index < coordinates.length; index += 1) {
    let start = coordinates[index - 1], end = coordinates[index], remaining = distanceMeters(start, end);
    while (sections.length < count - 1 && carried + remaining >= nextCut) {
      const ratio = (nextCut - carried) / remaining;
      const cut = [start[0] + (end[0] - start[0]) * ratio, start[1] + (end[1] - start[1]) * ratio];
      section.push(cut); sections.push(section); section = [cut]; start = cut; remaining = distanceMeters(start, end); carried = nextCut; nextCut += target;
    }
    section.push(end); carried += remaining;
  }
  sections.push(section); return sections;
}
function envelope(bounds = LAB_BOUNDS) { return JSON.stringify({ xmin: bounds.west, ymin: bounds.south, xmax: bounds.east, ymax: bounds.north, spatialReference: { wkid: 4326 } }); }
function queryRequest(url, layer = null, bounds = LAB_BOUNDS) {
  const endpoint = layer == null ? url : `${url}/${layer}/query`;
  const request = new URL(endpoint);
  request.search = new URLSearchParams({ where: '1=1', geometry: envelope(bounds), geometryType: 'esriGeometryEnvelope', inSR: '4326', spatialRel: 'esriSpatialRelIntersects', outFields: '*', returnGeometry: 'true', outSR: '4326', f: 'geojson' });
  return request;
}
async function query(url, layer = null, bounds = LAB_BOUNDS) {
  const request = queryRequest(url, layer, bounds);
  const response = await fetch(request, { headers: { Accept: 'application/geo+json, application/json' } });
  if (!response.ok) throw new Error(`Appalachian source returned ${response.status} for ${endpoint}`);
  const payload = await response.json();
  if (!Array.isArray(payload.features)) throw new Error(`Appalachian source returned no GeoJSON features for ${endpoint}`);
  return payload;
}
async function queryOsm(bounds = LAB_BOUNDS) {
  const overpass = new URL('https://overpass-api.de/api/interpreter');
  const box = `${bounds.south},${bounds.west},${bounds.north},${bounds.east}`;
  const body = `[out:json][timeout:25];(node["place"~"neighbourhood|village|hamlet|town"](${box});node["tourism"~"viewpoint|camp_site|picnic_site"](${box});node["amenity"~"parking|drinking_water|toilets"](${box}););out body;`;
  const response = await fetch(overpass, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ data: body }) });
  if (!response.ok) throw new Error(`OpenStreetMap intake returned ${response.status}`);
  const payload = await response.json();
  if (!Array.isArray(payload.elements)) throw new Error('OpenStreetMap intake returned no elements');
  return payload;
}
function wait(milliseconds) { return new Promise((resolve) => setTimeout(resolve, milliseconds)); }
async function queryOsmFallback(bounds = CONTEXT_BOUNDS) {
  const viewbox = `${bounds.west},${bounds.north},${bounds.east},${bounds.south}`;
  const intents = ['trailhead', 'park', 'cafe', 'neighbourhood'];
  const results = [];
  for (const intent of intents) {
    if (results.length) await wait(1100); // Respect Nominatim's public-service rate guidance.
    const request = new URL('https://nominatim.openstreetmap.org/search');
    request.search = new URLSearchParams({ format: 'jsonv2', bounded: '1', viewbox, q: intent, limit: '8' });
    const response = await fetch(request, { headers: { Accept: 'application/json', 'User-Agent': 'MotherBirdLab/1.0 (review-only regional intake)' } });
    if (!response.ok) throw new Error(`OpenStreetMap fallback returned ${response.status}`);
    const payload = await response.json();
    results.push(...payload.map((item) => ({ type: item.osm_type, id: item.osm_id, lat: Number(item.lat), lon: Number(item.lon), tags: { name: item.name || item.display_name.split(',')[0], place: intent === 'neighbourhood' ? 'locality candidate' : undefined, intake: intent, display_name: item.display_name, class: item.class, type: item.type } })));
  }
  return { elements: results, provider: 'Nominatim' };
}
function lines(features) {
  return features.flatMap((feature) => feature.geometry?.type === 'LineString' ? [feature.geometry.coordinates] : feature.geometry?.type === 'MultiLineString' ? feature.geometry.coordinates : [])
    .filter((coordinates) => coordinates.length >= 2 && coordinates.every(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat)));
}
function pointFeatures(features) {
  return (features || []).filter((feature) => feature.geometry?.type === 'Point'
    && feature.geometry.coordinates.every(Number.isFinite));
}
function cleanName(properties, fallback) {
  return properties?.Name || properties?.FMSS_Name || properties?.Feat_Name || fallback;
}
function officialDiscoveries({ parking, vistas, shelters, campsites }) {
  const groups = [
    ['entry', 'Official A.T. parking candidate', parking],
    ['view', 'Official A.T. vista candidate', vistas],
    ['shelter', 'Official A.T. shelter candidate', shelters],
    ['camp', 'Official A.T. campsite candidate', campsites]
  ];
  return groups.flatMap(([kind, fallback, collection]) => pointFeatures(collection?.features).map((feature, index) => ({
    id: `official-${kind}-${feature.properties?.OBJECTID || index + 1}`,
    kind,
    name: cleanName(feature.properties, fallback),
    coordinates: feature.geometry.coordinates,
    publishingState: 'candidate',
    reviewRequired: true,
    source: { name: 'NPS / Appalachian Trail Conservancy facilities', url: facilitiesUrl }
  }))).slice(0, MAX_CONTEXT_ITEMS_PER_SOURCE);
}
function osmDiscoveries(osm) {
  const labCenter = centerOf(LAB_BOUNDS);
  return (osm?.elements || []).filter((element) => Number.isFinite(element.lat) && Number.isFinite(element.lon)).map((element) => {
    const tags = element.tags || {};
    const kind = tags.place ? 'locality' : tags.intake || tags.tourism || tags.amenity || 'place';
    const coordinates = [element.lon, element.lat];
    const supportDistanceMiles = candidateDistanceMiles({ coordinates }, labCenter);
    return {
      id: `osm-${element.type}-${element.id}`,
      kind,
      name: tags.name || `OSM ${kind} candidate`,
      coordinates,
      supportDistanceMiles,
      tags: Object.fromEntries(Object.entries(tags).filter(([key]) => ['place', 'tourism', 'amenity', 'access', 'intake', 'class', 'type', 'display_name'].includes(key))),
      publishingState: 'candidate',
      reviewRequired: true,
      source: { name: osm.provider === 'Nominatim' ? 'OpenStreetMap contributors via Nominatim' : 'OpenStreetMap contributors', url: `https://www.openstreetmap.org/${element.type}/${element.id}` }
    };
  }).filter((item) => item.supportDistanceMiles <= MAX_UNVERIFIED_SUPPORT_MILES).slice(0, MAX_CONTEXT_ITEMS_PER_SOURCE);
}
function entryAreas(discoveries) {
  return discoveries.filter((item) => item.kind === 'entry').slice(0, 8).map((item) => ({
    id: `entry-area-${item.id}`,
    name: item.name,
    coordinates: item.coordinates,
    publishingState: 'candidate',
    reviewRequired: true,
    source: item.source,
    note: 'Official parking record: verify public access, trail connection, and on-the-ground conditions before publishing.'
  }));
}
function parkingAttribute(properties = {}) {
  const values = [properties.Type, properties.Status, properties.Description, properties.Name, properties.FMSS_Name].filter(Boolean).join(' ');
  return /parking|trailhead|access/i.test(values) ? values : null;
}
function entryFinder({ routeParking, supportParking, retrievedAt }) {
  const routeEvidence = { scope: 'routeBounds', query: queryRequest(facilitiesUrl, 2, LAB_BOUNDS).toString(), resultCount: routeParking.features?.length || 0 };
  const supportEvidence = { scope: 'supportBounds', query: queryRequest(facilitiesUrl, 2, CONTEXT_BOUNDS).toString(), resultCount: supportParking.features?.length || 0 };
  const accepted = pointFeatures([...routeParking.features || [], ...supportParking.features || []]).map((feature, index) => {
    const officialAttribute = parkingAttribute(feature.properties);
    const scope = (routeParking.features || []).includes(feature) ? 'routeBounds' : 'supportBounds';
    return officialAttribute ? { id: `official-entry-${feature.properties?.OBJECTID || index + 1}`, name: cleanName(feature.properties, 'Official A.T. parking candidate'), coordinates: feature.geometry.coordinates, officialAttribute, sourceUrl: facilitiesUrl, retrievedAt, confidence: 'official-attribute-validated', scope, reviewStage: 'corridor-review', accessNotes: null, connectionConfidence: 'unreviewed', publishingState: 'candidate', reviewRequired: true, source: { name: 'NPS / Appalachian Trail Conservancy facilities', url: facilitiesUrl } } : null;
  }).filter(Boolean);
  return { state: accepted.length ? 'corridor-review' : 'needs-more-evidence', candidateCount: accepted.length, verifiedEntryCount: 0, candidates: accepted, evidence: { routeParking: routeEvidence, supportParking: supportEvidence, secondaryOfficialProbe: { name: 'Bears Den / Snickers Gap parking layer probe', layer: 2, resultCount: supportEvidence.resultCount, status: supportEvidence.resultCount ? 'records returned' : 'empty' } }, rule: 'official parking records with a parking / trailhead / access attribute only; route endpoints are never promoted as trailheads by inference' };
}
function corridorConnectionPackages(entries, routes) {
  const vertices = routes.flatMap((route) => route.coordinates || []);
  return entries.map((entry) => {
    const nearestVertex = vertices.map((point) => distanceMeters(entry.coordinates, point)).sort((a, b) => a - b)[0] ?? null;
    const nearestRoute = routes.map((route) => ({ id: route.id, meters: Math.min(...(route.coordinates || []).map((point) => distanceMeters(entry.coordinates, point))) })).sort((a, b) => a.meters - b.meters)[0] || null;
    return { candidateId: entry.id, distanceToCenterlineMeters: nearestVertex && Math.round(nearestVertex), distanceToNearestRouteWindowCandidateMeters: nearestRoute && Math.round(nearestRoute.meters), nearestRouteWindowCandidateId: nearestRoute?.id || null, officialAttribute: entry.officialAttribute, accessNotes: null, connectionConfidence: 'unreviewed', requiredEvidence: ['public access confirmation', 'closure check', 'safe trail connection distance and method'] };
  });
}
function centerOf(bounds) { return [(bounds.west + bounds.east) / 2, (bounds.south + bounds.north) / 2]; }
function candidateDistanceMiles(item, origin) { return Number((distanceMeters(item.coordinates, origin) / 1609.344).toFixed(1)); }
function clusterCandidates(items, origin) {
  const groups = new Map();
  for (const item of items) {
    const key = item.kind;
    const group = groups.get(key) || { id: `cluster-${key}`, kind: key, candidateIds: [], count: 0, nearestMiles: Infinity };
    group.candidateIds.push(item.id); group.count += 1;
    group.nearestMiles = Math.min(group.nearestMiles, candidateDistanceMiles(item, origin));
    groups.set(key, group);
  }
  return [...groups.values()].map((group) => ({ ...group, nearestMiles: Number(group.nearestMiles.toFixed(1)), publishingState: 'candidate', reviewRequired: true }));
}
function reconcileCandidates(official, osm) {
  const matches = [];
  const checks = [];
  for (const community of osm) {
    const officialMatch = official.find((record) => distanceMeters(record.coordinates, community.coordinates) <= 200);
    if (officialMatch) matches.push({ officialId: officialMatch.id, osmId: community.id, resolution: 'hold for editor: nearby records may describe different access conditions' });
  }
  for (const record of official) {
    const nearest = osm.map((item) => ({ item, distanceMeters: Math.round(distanceMeters(record.coordinates, item.coordinates)) })).sort((a, b) => a.distanceMeters - b.distanceMeters)[0];
    const words = new Set(record.name.toLowerCase().split(/\W+/).filter(Boolean));
    const otherWords = new Set(nearest?.item.name.toLowerCase().split(/\W+/).filter(Boolean));
    const nameSimilarity = nearest ? Number(([...words].filter((word) => otherWords.has(word)).length / Math.max(words.size, otherWords.size, 1)).toFixed(2)) : 0;
    const tagOverlap = nearest ? [...Object.values(nearest.item.tags || {})].some((value) => String(record.name).toLowerCase().includes(String(value).toLowerCase())) : false;
    checks.push({ officialId: record.id, nearestOsmId: nearest?.item.id || null, distanceMeters: nearest?.distanceMeters ?? null, nameSimilarity, tagOverlap, thresholdMeters: 200, result: nearest && nearest.distanceMeters <= 200 && (nameSimilarity >= .3 || tagOverlap) ? 'hold-match' : 'no-match', reason: !nearest ? 'no OSM candidate in current intake' : nearest.distanceMeters > 200 ? 'too far' : 'name/tag mismatch' });
  }
  return { officialAuthoritative: true, nearbyCrossSourceMatches: matches, officialChecks: checks, reconciliationScore: official.length ? Number((matches.length / official.length).toFixed(2)) : 0, unmatchedOfficial: official.length - new Set(matches.map((match) => match.officialId)).size, unmatchedOsm: osm.length - new Set(matches.map((match) => match.osmId)).size };
}
function buildPromotionQueue({ official, osm, entries, sourceErrors }) {
  const candidates = [...entries, ...official, ...osm];
  return candidates.map((item) => ({
    candidateId: item.id,
    name: item.name,
    sourceFamily: item.source?.name?.startsWith('NPS') ? 'official' : 'osm',
    state: 'hold',
    blockers: [
      ...(() => { const relevantErrors = sourceErrors.filter((error) => item.source?.name?.includes('OpenStreetMap') ? /OpenStreetMap/i.test(error.source) : !/OpenStreetMap/i.test(error.source)); return relevantErrors.length ? [{ gate: '1. source health', status: 'blocked', code: 'primary-source-unhealthy', evidence: relevantErrors }] : [{ gate: '1. source health', status: 'pass', evidence: 'HTTP/schema checks completed for this source family' }]; })(),
      { gate: '2. geometry validity', status: Array.isArray(item.coordinates) ? 'pass' : 'blocked', evidence: 'coordinates required' },
      ...(item.source?.name?.startsWith('NPS') ? [{ gate: '3. official attribute', status: item.officialAttribute ? 'pass' : 'blocked', evidence: item.officialAttribute || 'facility type does not validate public entry/access' }] : []),
      { gate: '4. access evidence', status: item.kind === 'entry' ? 'blocked' : 'blocked', evidence: 'public access and on-the-ground suitability review required' },
      { gate: '5. corridor relevance', status: item.supportDistanceMiles == null || item.supportDistanceMiles <= MAX_UNVERIFIED_SUPPORT_MILES ? 'pass' : 'blocked', evidence: item.supportDistanceMiles == null ? 'official facility within route envelope' : `${item.supportDistanceMiles} mi to lab center` },
      { gate: '6. editor sign-off', status: 'blocked', evidence: 'always manual' }
    ]
  }));
}
export function buildAutomationPipeline({ official, osm, routeParking = { features: [] }, supportParking = { features: [] }, sourceErrors = [], retrievedAt = new Date().toISOString(), centerlineHash = null }) {
  const origin = centerOf(LAB_BOUNDS);
  const entries = entryFinder({ routeParking, supportParking, retrievedAt });
  return {
    regionFinder: {
      state: 'complete',
      routeBounds: LAB_BOUNDS,
      supportBounds: CONTEXT_BOUNDS,
      centerPoint: { coordinates: origin, usedFor: 'all candidate distance calculations until a verified entry exists' },
      retrievedAt,
      centerlineHash,
      source: 'configured Appalachian Trail centerline envelope',
      note: 'This finds a review region; it does not assert an administrative neighborhood boundary.'
    },
    entryFinder: {
      ...entries
    },
    nearbyDiscovery: {
      state: osm.length ? 'review-ready' : 'degraded',
      searchFamilies: ['trailhead', 'park', 'cafe', 'neighbourhood'],
      clusters: clusterCandidates(osm, origin),
      note: `Candidates beyond ${MAX_UNVERIFIED_SUPPORT_MILES} miles from the lab center are withheld until a verified entry point exists; displayed distance is to the lab center.`
    },
    sourceReconciliation: { state: 'review-ready', ...reconcileCandidates(official, osm) },
    promotionQueue: buildPromotionQueue({ official, osm, entries: entries.candidates, sourceErrors })
  };
}
export function buildContextCandidate({ parking, supportParking = { features: [] }, vistas, shelters, campsites, osm, sourceErrors = [], retrievedAt = new Date().toISOString(), centerlineHash = null, routeWindowCount = 0, routeSections = [] }) {
  const official = officialDiscoveries({ parking, vistas, shelters, campsites });
  const osmItems = osmDiscoveries(osm);
  const pipeline = buildAutomationPipeline({ official, osm: osmItems, routeParking: parking, supportParking, sourceErrors, retrievedAt, centerlineHash });
  return {
    schemaVersion: 1,
    regionId: labId,
    status: 'lab-review-only',
    retrievedAt,
    entryAreas: pipeline.entryFinder.candidates,
    discoveries: { official, osm: osmItems },
    automation: { ...pipeline, corridorConnections: corridorConnectionPackages(pipeline.entryFinder.candidates, routeSections), walkableWindows: [] },
    eventSources: [{ title: 'Current Appalachian Trail events', url: eventsUrl, publishingState: 'source-only', reviewRequired: true, note: 'No event is promoted without a current date, location, and expiry.' }],
    volunteerSources: [{ title: 'Appalachian Trail Conservancy volunteer opportunities', url: volunteerUrl, publishingState: 'source-only', reviewRequired: true, note: 'No volunteer opportunity is promoted without a current organizer, date, and location.' }],
    sourceErrors,
    counts: { candidateRouteWindows: routeWindowCount, walkableWindows: 0, verifiedEntries: pipeline.entryFinder.verifiedEntryCount, corridorReviewEntries: pipeline.entryFinder.candidateCount, officialLeads: official.length, osmLeads: osmItems.length, crossSourceMatches: pipeline.sourceReconciliation.nearbyCrossSourceMatches.length },
    graduationProgress: [
      { item: 'official geometry reviewed', state: routeWindowCount ? 'evidence-present' : 'blocked' },
      { item: 'public access evidence reviewed', state: pipeline.entryFinder.verifiedEntryCount ? 'evidence-present' : 'blocked' },
      { item: 'freshness SLA satisfied', state: sourceErrors.length ? 'blocked' : 'evidence-present-not-reviewed' },
      { item: 'editor sign-off', state: 'blocked' }
    ],
    graduationChecklist: ['official geometry reviewed', 'OSM candidate verified against current access', 'event or volunteer details verified before display', 'editor sign-off']
  };
}
export function buildCandidate({ centerline, parking, vistas, previousHash = null, retrievedAt = new Date().toISOString() }) {
  const sourceLines = lines(centerline.features || []);
  const sourceHash = createHash('sha256').update(JSON.stringify(sourceLines)).digest('hex');
  const routeSections = sourceLines.flatMap((coordinates, lineIndex) => {
    const count = Math.min(MAX_DEFAULT_SECTIONS, Math.max(1, Math.ceil(lineLength(coordinates) / TARGET_SECTION_METERS)));
    return splitLine(coordinates, count).map((section, index) => {
      const meters = lineLength(section);
      return { id: `${labId}-line-${lineIndex + 1}-section-${index + 1}`, name: `A.T. lab window ${index + 1} of ${count}`, collection: 'Appalachian Trail · Bears Den lab', publishingState: 'candidate', reviewRequired: true, distanceMiles: Number((meters / 1609.344).toFixed(2)), estimatedDurationMinutes: Math.max(10, Math.round(meters / 70)), coordinates: section, source: { name: 'NPS / Appalachian Trail Conservancy centerline', url: sourceUrl }, accessEvidence: { parkingCount: parking.features?.length || 0, vistaCount: vistas.features?.length || 0, status: 'review required' } };
    });
  });
  if (routeSections.length > MAX_DEFAULT_SECTIONS) throw new Error(`Candidate exceeds the ${MAX_DEFAULT_SECTIONS}-section review cap`);
  return { schemaVersion: 1, regionId: labId, status: 'lab-review-only', retrievedAt, source: { centerline: sourceUrl, facilities: facilitiesUrl, sourceHash, changed: previousHash != null && previousHash !== sourceHash, bounds: LAB_BOUNDS }, graduationChecklist: ['official geometry reviewed', 'public access evidence reviewed', 'freshness SLA satisfied', 'editor sign-off'], routes: routeSections };
}
async function readJson(file, fallback = null) { try { return JSON.parse(await readFile(file, 'utf8')); } catch { return fallback; } }
export async function refreshAppalachianCorridorLab() {
  const candidateFile = path.join(root, 'regions', labId, 'candidate-routes.json');
  const previous = await readJson(candidateFile);
  const officialRequests = await Promise.all([query(sourceUrl), query(facilitiesUrl, 2), query(facilitiesUrl, 2, CONTEXT_BOUNDS), query(facilitiesUrl, 5), query(facilitiesUrl, 4), query(facilitiesUrl, 1)]);
  const [centerline, parking, supportParking, vistas, shelters, campsites] = officialRequests;
  let osm = { elements: [] };
  const sourceErrors = [];
  try { osm = await queryOsm(); } catch (error) {
    sourceErrors.push({ source: 'OpenStreetMap Overpass', message: error.message });
    try { osm = await queryOsmFallback(); } catch (fallbackError) { sourceErrors.push({ source: 'OpenStreetMap Nominatim fallback', message: fallbackError.message }); }
  }
  const candidate = buildCandidate({ centerline, parking, vistas, previousHash: previous?.source?.sourceHash });
  const context = buildContextCandidate({ parking, supportParking, vistas, shelters, campsites, osm, sourceErrors, centerlineHash: candidate.source.sourceHash, routeWindowCount: candidate.routes.length, routeSections: candidate.routes });
  const cacheDir = path.join(root, 'data', 'open-data', 'appalachian-corridor-lab');
  await mkdir(cacheDir, { recursive: true });
  await mkdir(path.dirname(candidateFile), { recursive: true });
  await Promise.all([
    writeFile(path.join(cacheDir, 'centerline.geojson'), JSON.stringify(centerline, null, 2)),
    writeFile(path.join(cacheDir, 'parking.geojson'), JSON.stringify(parking, null, 2)),
    writeFile(path.join(cacheDir, 'support-parking.geojson'), JSON.stringify(supportParking, null, 2)),
    writeFile(path.join(cacheDir, 'vistas.geojson'), JSON.stringify(vistas, null, 2)),
    writeFile(path.join(cacheDir, 'shelters.geojson'), JSON.stringify(shelters, null, 2)),
    writeFile(path.join(cacheDir, 'campsites.geojson'), JSON.stringify(campsites, null, 2)),
    writeFile(path.join(cacheDir, 'osm-intake.json'), JSON.stringify(osm, null, 2)),
    writeFile(candidateFile, JSON.stringify(candidate, null, 2)),
    writeFile(path.join(root, 'regions', labId, 'candidate-context.json'), JSON.stringify(context, null, 2)),
    writeFile(path.join(cacheDir, 'pois.json'), JSON.stringify({ pois: [] }, null, 2))
  ]);
  return { ...candidate, context };
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
  const candidate = await refreshAppalachianCorridorLab();
  console.log(`Appalachian Corridor Lab: ${candidate.routes.length} candidate windows; ${candidate.context.entryAreas.length} entry areas; ${candidate.context.discoveries.official.length}/${candidate.context.discoveries.osm.length} official/OSM discoveries; changed=${candidate.source.changed}.`);
}

