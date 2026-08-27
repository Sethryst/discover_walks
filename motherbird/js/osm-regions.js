const UNAVAILABLE = 'No validated offline OSM package is published for this region yet.';

const REGION_ALIASES = {
  arlington: 'arlington-va', 'falls-church': 'falls-church-va', norfolk: 'norfolk', newyork: 'nyc',
  philadelphia: 'philadelphia', richmond: 'richmond', anchorage: 'anchorage', tempe: 'tempe',
  'los-angeles': 'los-angeles', baltimore: 'baltimore', detroit: 'detroit', 'corpus-christi': 'corpus-christi',
  'fort-worth': 'fort-worth', seattle: 'seattle', columbus: 'columbus', pittsburgh: 'pittsburgh',
  keystone: 'keystone-colorado', pgcounty: 'prince-georges-county-md', fairfax: 'fairfax-county-va',
  alexandria: 'alexandria-va', loudoun: 'loudoun-county-va', dc: 'washington-dc', sedona: 'sedona-arizona',
  boise: 'boise-meridian-idaho'
};
const BUILT = new Set([
  'alexandria-va', 'arlington-va', 'baltimore', 'boise-meridian-idaho', 'boston', 'boulder', 'chicago', 'columbus',
  'corpus-christi', 'denver', 'detroit', 'fairfax-county-va', 'falls-church-va', 'fort-worth', 'keystone-colorado',
  'los-angeles', 'loudoun-county-va', 'new-orleans', 'norfolk', 'nyc', 'philadelphia', 'pittsburgh', 'portland',
  'portland-maine', 'prince-georges-county-md', 'richmond', 'san-francisco', 'santa-fe', 'seattle', 'sedona-arizona',
  'tempe', 'washington-dc', 'wolf-trap-va'
]);

export function runtimeOsmConfig(cityId, city = {}) {
  const regionId = REGION_ALIASES[cityId] || cityId;
  const enabled = BUILT.has(regionId);
  return {
    status: enabled ? 'enabled' : 'unavailable', enabled, regionId,
    sourceId: `osm-${regionId}`,
    endpoint: 'https://overpass-api.de/api/interpreter',
    categories: ['park', 'trail', 'water', 'history', 'public_art', 'library', 'community', 'garden', 'coffee', 'rest'],
    refreshPolicy: 'monthly', maxRecords: 2000,
    ...(enabled ? { packageFile: `./regions/${regionId}/osm/pois.json` } : { unavailableReason: UNAVAILABLE }),
    legacyPoiFiles: [city.supplementalPoiFile, ...(city.supplementalPoiFiles || [])].filter((file) => /\/osm\//.test(file || ''))
  };
}

export function normalizeRegionDataConfig(cityId, city = {}) {
  const osm = city.osm || runtimeOsmConfig(cityId, city);
  const supplementalPoiFiles = [city.supplementalPoiFile, ...(city.supplementalPoiFiles || [])]
    .filter(Boolean)
    .filter((file) => !/\/osm\//.test(file));
  return { ...city, osm, supplementalPoiFiles };
}
