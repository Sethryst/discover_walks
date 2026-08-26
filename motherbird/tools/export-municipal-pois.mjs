#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, '..', '..');
const openDataRoot = join(repositoryRoot, 'OpenData');
const outputRoot = join(repositoryRoot, 'motherbird', 'data');
const registryPath = join(openDataRoot, 'datasets.csv');

const SAFE_CATEGORIES = new Set([
  'community_garden', 'history', 'library', 'park', 'public_art',
  'recreation_center', 'restrooms', 'trail', 'water_access'
]);

export const MUNICIPAL_REGIONS = {
  anchorage: {
    state: 'Alaska', city: 'Anchorage', bbox: [60.73302, -150.43597, 61.48395, -148.46243],
    boundary: { name: 'Municipality of Anchorage Boundary', url: 'https://services2.arcgis.com/Ce3DhLRthdwbHlfF/ArcGIS/rest/services/MOA_Boundary/FeatureServer/0' },
    rules: [
      rule(/^chugachstatepark_/, 'park', ['NAME'], ['OBJECTID']),
      rule(/^nordictrails_/, 'trail', ['Grooming_Segment', 'Grooming_System'], ['OBJECTID']),
      rule(/^park_facilities_/, 'park', ['Facility_Name', 'Name', 'Facility_Type'], ['OBJECTID']),
      rule(/^park_land_/, 'park', ['Name'], ['OBJECTID']),
      rule(/^park_trailposts_/, 'trail', ['MarkerLocation', 'EmergencyLocatorID'], ['OBJECTID']),
      rule(/^parksrec_trails_/, 'trail', ['Trail_Name', 'Trail_System'], ['OBJECTID'])
    ]
  },
  tempe: {
    state: 'Arizona', city: 'Tempe', bbox: [33.32005, -111.97848, 33.46532, -111.8774],
    boundary: { name: 'City of Tempe Boundary', url: 'https://services.arcgis.com/lQySeXwbBg53XWDi/ArcGIS/rest/services/City_Boundary/FeatureServer/0' },
    rules: [
      rule(/^park_boundaries_and_amenities_/, 'park', ['ParkName'], ['OBJECTID_1']),
      rule(/^tempe_public_art_open_data_/, 'public_art', ['Artwork_Title', 'Artwork_Location'], ['OBJECTID', 'GlobalID'])
    ]
  },
  'los-angeles': {
    state: 'California', city: 'Los Angeles', bbox: [33.70366, -118.66819, 34.33731, -118.15537],
    boundary: { name: 'Los Angeles City Boundary', url: 'https://services1.arcgis.com/tzwalEyxl2rpamKs/arcgis/rest/services/Los_Angeles_City_Boundary/FeatureServer/0' },
    rules: [
      rule(/^cultural_centers_/, 'public_art', ['center_name'], []),
      rule(/^department_of_recreation_and_parks_/, 'park', ['location_name'], []),
      rule(/^lighthouse_/, 'history', ['name', 'location'], []),
      rule(/^museums_/, 'history', ['name'], []),
      rule(/^parks_/, 'park', ['name'], []),
      rule(/^publicarts_/, 'public_art', ['title', 'location'], []),
      rule(/^restroom_/, 'restrooms', ['facility'], [])
    ]
  },
  baltimore: {
    state: 'Maryland', city: 'Baltimore', bbox: [39.19721, -76.71152, 39.37221, -76.52946],
    boundary: { name: 'Baltimore City Boundary', url: 'https://services5.arcgis.com/U5lRs16ODaohcqOy/ArcGIS/rest/services/City_Boundary/FeatureServer/0' },
    rules: [
      rule(/^multiuse_trails_/, 'trail', ['trailName', 'trailCat'], ['OBJECTID']),
      rule(/^parks_/, 'park', ['parkName', 'altPrkName'], ['OBJECTID', 'GlobalID']),
      rule(/^public_pools_/, 'recreation_center', ['poolName', 'poolAltName', 'TYPE'], ['OBJECTID', 'GlobalID']),
      rule(/^recreation_center_/, 'recreation_center', ['NAME', 'schoolName'], ['OBJECTID', 'GlobalID']),
      rule(/^specialty_facilities_/, 'recreation_center', ['NAME', 'Type'], ['OBJECTID', 'GlobalID'])
    ]
  },
  detroit: {
    state: 'Michigan', city: 'Detroit', bbox: [42.25496, -83.28773, 42.45037, -82.91034],
    boundary: { name: 'City of Detroit Boundary', url: 'https://services2.arcgis.com/qvkbeam7Wirps6zC/ArcGIS/rest/services/City_of_Detroit_Boundary/FeatureServer/0' },
    rules: [
      rule(/^city_of_detroit_greenways_/, 'trail', ['greenway_name', 'greenway_alt_name'], ['greenway_object_id', 'ObjectId']),
      rule(/^city_parks_/, 'park', ['park_name'], ['park_id', 'ObjectId']),
      rule(/^detroit_national_register_/, 'history', ['resource_name', 'other_names'], ['object_id', 'ObjectId']),
      rule(/^joe_louis_greenway_route_segments_/, 'trail', ['ROUTE_SEGMENT_NAME'], ['OBJECTID', 'OBJECT_ID'])
    ]
  },
  richmond: {
    state: 'Virginia', city: 'Richmond', bbox: [37.42, -77.58, 37.64, -77.35],
    boundary: { name: 'City of Richmond Boundary', url: 'https://services1.arcgis.com/k3vhq11XkBNeeOfM/ArcGIS/rest/services/City_Boundary/FeatureServer/0' },
    rules: [rule(/^trails_bybt-f6be$/, 'trail', ['name', 'alternaten'], ['trailid'])]
  },
  'corpus-christi': {
    state: 'Texas', city: 'Corpus Christi', bbox: [27.46605, -97.75644, 27.93104, -96.96704],
    boundary: { name: 'Corpus Christi City Limits', url: 'https://services.arcgis.com/0J4ZNc4NaTguvRy0/ArcGIS/rest/services/OpenData/FeatureServer/36' },
    rules: [rule(/^parks_corpus_christi_opendata_44$/, 'park', ['TAG', 'TYPE'], ['OBJECTID'], {
      sourceUrl: 'https://services.arcgis.com/0J4ZNc4NaTguvRy0/ArcGIS/rest/services/OpenData/FeatureServer/44'
    })]
  },
  'fort-worth': {
    state: 'Texas', city: 'Fort Worth', bbox: [32.55053, -97.60034, 33.04916, -97.03383],
    boundary: { name: 'Fort Worth Full Purpose City Limits', url: 'https://mapit.fortworthtexas.gov/ags/rest/services/Basemaps/Basemap/MapServer/112', where: "DESIGNATIO = 'Full Purpose'" },
    rules: [
      rule(/^cfw_community_centers_/, 'recreation_center', ['NAME'], ['OBJECTID']),
      rule(/^cfw_libraries_/, 'library', ['NAME'], ['OBJECTID']),
      rule(/^cfw_parks_/, 'park', ['PARK_NAME', 'PARK_ALIAS'], ['OBJECTID'])
    ]
  },
  seattle: {
    state: 'Washington', city: 'Seattle', bbox: [47.4922, -122.43921, 47.73596, -122.23124],
    boundary: { name: 'Seattle Area Polygon', url: 'https://services.arcgis.com/ZOyb2t4B0UYuYNYH/ArcGIS/rest/services/Seattle_Area_Polygon/FeatureServer/0' },
    rules: [rule(/^seattle_parks_and_recreation_park_addresses_/, 'park', ['name'], ['locid', 'pmaid'])]
  },
  columbus: {
    state: 'Ohio', city: 'Columbus', bbox: [39.80775, -83.21164, 40.15796, -82.77056],
    boundary: { name: 'Columbus Corporate Boundary', url: 'https://maps.columbus.gov/arcgis/rest/services/CityServices/KeyLayers/MapServer/2' },
    rules: [
      rule(/^nature_preserve_trails_/, 'trail', ['TRAIL', 'NAT_PRES'], ['OBJECTID', 'GLOBALID']),
      rule(/^park_facilities_/, 'park', ['FAC_TYPE', 'SUB_TYPE', 'PARK_NAME'], ['OBJECTID']),
      rule(/^park_property_boundaries_/, 'park', ['NAME'], ['OBJECTID'])
    ]
  },
  pittsburgh: {
    state: 'Pennsylvania', city: 'Pittsburgh', bbox: [40.36, -80.10, 40.50, -79.87],
    boundary: { name: 'City of Pittsburgh Boundary', url: 'https://services1.arcgis.com/YZCmUqbcsUpOKfj7/arcgis/rest/services/City_Boundary/FeatureServer/0' },
    rules: [
      rule(/^greenways_/, 'trail', ['name', 'label'], ['OBJECTID_1', 'GlobalID']),
      rule(/^parks_open_space_plan_/, 'park', ['Park_Name', 'UpdatePkNm', 'AlterntNam'], ['OBJECTID_1', 'OBJECTID']),
      rule(/^trails_/, 'trail', ['trail_name', 'altname', 'park', 'greenway'], ['OBJECTID', 'globalid'])
    ]
  },
  boise: {
    state: 'Idaho', city: 'Boise', artifactName: 'boise-meridian-idaho', bbox: [43.48, -116.40, 43.70, -116.10],
    boundary: {
      name: 'Ada County City Limits — Boise',
      url: 'https://services1.arcgis.com/WHM6qC35aMtyAAlN/arcgis/rest/services/CityLimitsAndImpactAreas/FeatureServer/1',
      where: "CITY = 'Boise'"
    },
    rules: [
      rule(/^parks_and_rec_managed_properties_/, 'park', ['Site_Name'], ['ParkID', 'OBJECTID']),
      rule(/^parks_recreation_public_and_administrative_facilities_/, 'recreation_center', ['FacilityName'], ['FacilityID', 'OBJECTID'], {
        categoryMap: { field: 'FacilType', values: { Trailhead: 'trail' } }
      }),
      rule(/^trails_/, 'trail', ['TrailName', 'Name', 'SystemName'], ['TrailID', 'OBJECTID']),
      rule(/^boise_pathways_master_plan_/, 'trail', ['Name'], ['OBJECTID'])
    ]
  },
  sedona: {
    state: 'Arizona', city: 'Sedona', artifactName: 'sedona-arizona', bbox: [34.80, -111.86, 34.93, -111.70],
    boundary: {
      name: 'U.S. Census Bureau Sedona incorporated place boundary',
      url: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Places_CouSub_ConCity_SubMCD/MapServer/4',
      where: "STATE = '04' AND BASENAME = 'Sedona'"
    },
    rules: [
      rule(/^city_parks_/, 'park', ['NAME', 'LABEL'], ['ID', 'OBJECTID']),
      rule(/^trailhead_/, 'trail', ['NAME', 'TRAILNAME'], ['OBJECTID', 'GlobalID']),
      rule(/^trails_pathways_/, 'trail', ['NAME', 'NAME_LABEL'], ['OBJECTID', 'GlobalID'])
    ]
  },
  keystone: {
    state: 'Colorado', city: 'Keystone', artifactName: 'keystone-colorado', bbox: [39.53, -106.10, 39.72, -105.82],
    boundary: {
      name: 'U.S. Census Bureau Keystone census-designated place boundary',
      url: 'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Places_CouSub_ConCity_SubMCD/MapServer/5',
      where: "STATE = '08' AND BASENAME = 'Keystone'"
    },
    rules: [
      rule(/^cotrex_trailheads_/, 'trail', ['name', 'alt_name'], ['feature_id', 'FID']),
      rule(/^cotrex_trails_/, 'trail', ['name', 'name_1', 'name_2'], ['feature_id', 'FID'])
    ]
  }
};

function rule(pattern, category, nameFields, idFields, options = {}) {
  if (!SAFE_CATEGORIES.has(category)) throw new Error(`Unsafe POI category: ${category}`);
  return { pattern, category, nameFields, idFields, ...options };
}

function clean(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function firstValue(properties, fields) {
  for (const field of fields) {
    const value = clean(properties[field]);
    if (value && value !== '-' && value.toLowerCase() !== 'null') return value;
  }
  return '';
}

function featureName(properties, selectedRule) {
  const values = selectedRule.nameFields.map((field) => clean(properties[field])).filter(Boolean);
  if (!values.length) return '';
  if (selectedRule.nameFields[0] === 'FAC_TYPE' && values.length > 1) {
    const [facility, subtype, park] = values;
    return clean(`${subtype && subtype !== park ? `${subtype} ` : ''}${facility}${park ? ` at ${park}` : ''}`);
  }
  return values[0];
}

function featureCategory(properties, selectedRule) {
  const mapping = selectedRule.categoryMap;
  const category = mapping?.values?.[clean(properties[mapping.field])] || selectedRule.category;
  if (!SAFE_CATEGORIES.has(category)) throw new Error(`Unsafe mapped POI category: ${category}`);
  return category;
}

function coordinatesOf(geometry) {
  const output = [];
  const visit = (value) => {
    if (!Array.isArray(value)) return;
    if (value.length >= 2 && typeof value[0] === 'number' && typeof value[1] === 'number') output.push(value);
    else value.forEach(visit);
  };
  visit(geometry?.coordinates);
  return output;
}

export function representativePoint(geometry) {
  if (!geometry || !['Point', 'MultiPoint', 'LineString', 'MultiLineString', 'Polygon', 'MultiPolygon'].includes(geometry.type)) return null;
  const coordinates = coordinatesOf(geometry);
  if (!coordinates.length || coordinates.some(([lng, lat]) => !Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lng) > 180 || Math.abs(lat) > 90 || (lng === 0 && lat === 0))) return null;
  if (geometry.type === 'Point') return { lng: coordinates[0][0], lat: coordinates[0][1] };
  let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
  for (const [lng, lat] of coordinates) {
    west = Math.min(west, lng); south = Math.min(south, lat);
    east = Math.max(east, lng); north = Math.max(north, lat);
  }
  return { lng: (west + east) / 2, lat: (south + north) / 2 };
}

function pointInBbox(point, [south, west, north, east]) {
  return point.lat >= south && point.lat <= north && point.lng >= west && point.lng <= east;
}

function parseCsv(text) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted && character === '"' && text[index + 1] === '"') { field += '"'; index += 1; }
    else if (character === '"') quoted = !quoted;
    else if (character === ',' && !quoted) { row.push(field); field = ''; }
    else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      row.push(field); field = '';
      if (row.some(Boolean)) rows.push(row);
      row = [];
    } else field += character;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const headers = rows.shift() || [];
  return rows.map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] || ''])));
}

async function provenanceRegistry() {
  const rows = parseCsv(await readFile(registryPath, 'utf8'));
  const registry = new Map();
  for (const row of rows) {
    const file = row.File?.replaceAll('\\', '/');
    if (!file) continue;
    const existing = registry.get(file);
    if (!existing || (!existing.Source_URL && row.Source_URL)) registry.set(file, row);
  }
  return registry;
}

function humanize(stem) {
  return stem.replace(/_[a-f0-9]{32}(?:_\d+)?$/i, '').replace(/_[a-z0-9]{4}-[a-z0-9]{4}$/i, '').replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function stableId(cityId, stem, feature, selectedRule) {
  const properties = feature.properties || {};
  const sourceId = firstValue(properties, selectedRule.idFields) || clean(feature.id) || JSON.stringify(feature.geometry);
  const digest = createHash('sha256').update(`${cityId}\0${stem}\0${sourceId}`).digest('hex').slice(0, 20);
  return { id: `municipal:${cityId}:${digest}`, sourceId };
}

function addressOf(properties) {
  return firstValue(properties, ['addressFull', 'ADDRESS', 'Address', 'address', 'SITEADDRESS', 'ParkAddress', 'Location_Street_Address', 'city_address', 'location_1_address', 'LOCATION_D']);
}

export async function buildMunicipalSeed(cityId, config, registry = new Map()) {
  const cityDirectory = join(openDataRoot, config.state, config.city);
  const filenames = (await readdir(cityDirectory)).filter((name) => name.toLowerCase().endsWith('.geojson')).sort();
  const pois = [];
  const sources = [];
  let rejectedFeatures = 0;

  for (const filename of filenames) {
    const stem = basename(filename, '.geojson');
    const selectedRule = config.rules.find((candidate) => candidate.pattern.test(stem));
    if (!selectedRule) continue;
    const localRelativePath = relative(openDataRoot, join(cityDirectory, filename)).replaceAll('\\', '/');
    const registryRow = registry.get(localRelativePath) || {};
    const sourceUrl = selectedRule.sourceUrl || registryRow.Source_URL || '';
    const sourceName = registryRow.Dataset_Name || humanize(stem);
    const data = JSON.parse(await readFile(join(cityDirectory, filename), 'utf8'));
    if (data.type !== 'FeatureCollection' || !Array.isArray(data.features)) throw new Error(`${localRelativePath} is not a GeoJSON FeatureCollection.`);
    let accepted = 0;
    for (const feature of data.features) {
      const point = representativePoint(feature.geometry);
      const name = featureName(feature.properties || {}, selectedRule);
      if (!point || !pointInBbox(point, config.bbox) || !name) { rejectedFeatures += 1; continue; }
      const { id, sourceId } = stableId(cityId, stem, feature, selectedRule);
      const category = featureCategory(feature.properties || {}, selectedRule);
      const poi = {
        id, name, lat: Number(point.lat.toFixed(6)), lng: Number(point.lng.toFixed(6)),
        category, tags: [category], unverified: false,
        source: sourceUrl || undefined,
        provenance: { dataset: sourceName, sourceId, url: sourceUrl || undefined, localCapture: `OpenData/${localRelativePath}` }
      };
      const address = addressOf(feature.properties || {});
      if (address) poi.address = address;
      pois.push(poi);
      accepted += 1;
    }
    sources.push({ name: sourceName, url: sourceUrl || undefined, localCapture: `OpenData/${localRelativePath}`, category: selectedRule.category, acceptedFeatures: accepted });
  }

  const byId = new Map(pois.map((poi) => [poi.id, poi]));
  const sortedPois = [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
  if (!sortedPois.length) throw new Error(`${cityId} produced no safe in-bound WGS84 POIs.`);
  return {
    metadata: {
      version: 1,
      regionId: cityId,
      attribution: 'Authoritative municipal open-data sources',
      producer: 'Gremlin Lab municipal POI exporter',
      boundarySource: config.boundary,
      sourceDatasets: sources.filter((source) => source.acceptedFeatures > 0),
      rejectedFeatures
    },
    pois: sortedPois
  };
}

async function main() {
  const args = process.argv.slice(2);
  const check = args.includes('--check');
  const requested = args.filter((argument) => argument !== '--check');
  const cityIds = requested.length ? requested : Object.keys(MUNICIPAL_REGIONS);
  const unknown = cityIds.filter((cityId) => !MUNICIPAL_REGIONS[cityId]);
  if (unknown.length) throw new Error(`Unknown municipal region(s): ${unknown.join(', ')}`);
  const registry = await provenanceRegistry();
  for (const cityId of cityIds) {
    const config = MUNICIPAL_REGIONS[cityId];
    const seed = await buildMunicipalSeed(cityId, config, registry);
    const content = `${JSON.stringify(seed)}\n`;
    const outputPath = join(outputRoot, `${config.artifactName || cityId}-poi.json`);
    if (check) {
      const committed = await readFile(outputPath, 'utf8');
      if (committed !== content) throw new Error(`${relative(repositoryRoot, outputPath)} is stale; run npm run build:municipal-seeds.`);
    } else {
      await writeFile(outputPath, content, 'utf8');
    }
    console.log(`${check ? 'verified' : 'wrote'} ${cityId}: ${seed.pois.length} POIs from ${seed.metadata.sourceDatasets.length} sources`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
