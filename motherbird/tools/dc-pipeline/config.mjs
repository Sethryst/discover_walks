export const DC_BOUNDS = { west: -77.12, south: 38.79, east: -76.9, north: 39.0 };
export const SNAPSHOT_DATE = '2026-08-08T00:00:00.000Z';

const arcgis = (path) => `https://maps2.dcgis.dc.gov/dcgis/rest/services/${path}`;
const query = (service) => `${service}/query?where=1%3D1&outFields=*&returnGeometry=true&outSR=4326&f=geojson`;

export const DC_SOURCES = [
  {
    id: 'dc_dpr_parks', title: 'Parks and Recreation Areas', cacheFile: 'data/open-data/dc/parks.geojson', category: 'park', tags: ['park'],
    serviceUrl: arcgis('DCGIS_DATA/Recreation_WebMercator/MapServer/9'), minRecords: 200, nameFields: ['NAME'], descriptionFields: ['ADDRESS', 'WEB_URL']
  },
  {
    id: 'dc_heritage_trail_signs', title: 'Heritage Trail Signs and Plaques', cacheFile: 'data/open-data/dc/trails.geojson', category: 'trail', tags: ['trail', 'history'],
    serviceUrl: arcgis('DCGIS_DATA/Cultural_and_Society_WebMercator/MapServer/7'), minRecords: 100, nameFields: ['NAME', 'SIGN_NAME'], descriptionFields: ['URL', 'NEIGHBORHOOD'],
    // This official layer has no human-readable trail/plaque title. NAME is a
    // numeric asset code, so preserve that identifier in an honest label.
    nameForFeature: (properties) => `DC Heritage Trail sign ${properties.SIGN_NUMBER || properties.NAME || 'record'}`
  },
  {
    id: 'dc_museums', title: 'Museums', cacheFile: 'data/open-data/dc/museums.geojson', category: 'history', tags: ['history'],
    serviceUrl: arcgis('DCGIS_DATA/Cultural_and_Society_WebMercator/MapServer/54'), minRecords: 100,
    nameFields: ['DCGIS.PLACE_NAMES_PT.NAME', 'NAME'], descriptionFields: ['DCGIS.ADDRESSES_PT.ADDRESS', 'ADDRESS']
  },
  {
    id: 'dc_public_art', title: 'Public Art snapshot', cacheFile: 'data/open-data/dc/public_art.geojson', category: 'public_art', tags: ['public_art'],
    cacheOnly: true, portalUrl: 'https://opendata.dc.gov/', minRecords: 250,
    nameFields: ['DCGIS.PLACE_NAMES_PT.NAME', 'NAME'], descriptionFields: ['DCGIS.ADDRESSES_PT.ADDRESS', 'ARTIST', 'YEAR_INSTALLED']
  },
  {
    id: 'dc_boundary_stones', title: 'Washington DC Historic Boundary Stones', cacheFile: 'data/open-data/dc/boundary_stones.geojson', category: 'history', tags: ['history'],
    serviceUrl: arcgis('DCGIS_DATA/Property_and_Land_WebMercator/FeatureServer/42'), minRecords: 35,
    nameFields: ['NAME', 'STONE_NUM'], descriptionFields: ['NARRATIVE', 'LOCATION_DESCRIPTION', 'CONDITION']
  },
  {
    id: 'dc_wifi', title: 'Wireless Hotspots from DC Government', cacheFile: 'data/open-data/dc/wifi.geojson', category: 'wifi', tags: ['wifi'],
    serviceUrl: arcgis('DCGIS_DATA/Utility_and_Communication_WebMercator/MapServer/14'), minRecords: 300,
    nameFields: ['NAME'], descriptionFields: ['ADDRESS', 'TYPE', 'SITE_TYPE']
  }
].map((source) => ({ ...source, queryUrl: source.serviceUrl ? query(source.serviceUrl) : null }));

export const NEIGHBORHOOD_SOURCE = {
  id: 'dc_neighborhood_clusters', title: 'Neighborhood Clusters', cacheFile: 'data/open-data/dc/neighborhood_clusters.geojson',
  serviceUrl: arcgis('DCGIS_DATA/Administrative_Other_Boundaries_WebMercator/MapServer/17'), minRecords: 40
};
NEIGHBORHOOD_SOURCE.queryUrl = query(NEIGHBORHOOD_SOURCE.serviceUrl);

