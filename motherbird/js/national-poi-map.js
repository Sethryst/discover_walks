export const NATIONAL_POI_CATEGORIES = Object.freeze([
  { id: 'nature', label: 'Nature', color: '#2d7259', icon: 'tree' },
  { id: 'trail', label: 'Trails', color: '#745b32', icon: 'walk' },
  { id: 'waterfront', label: 'Water', color: '#2b7890', icon: 'anchor' },
  { id: 'rest', label: 'Rest & comfort', color: '#7d5da7', icon: 'bench' },
  { id: 'recreation', label: 'Recreation', color: '#c65d0e', icon: 'activity' },
  { id: 'civic', label: 'Civic places', color: '#38598a', icon: 'building' },
  { id: 'transit', label: 'Transit', color: '#7b536f', icon: 'navigation' },
  { id: 'crossing', label: 'Crossings', color: '#976f20', icon: 'target' },
  { id: 'walkway', label: 'Walkways', color: '#70695d', icon: 'route' },
  { id: 'barrier', label: 'Barriers', color: '#8b3a4a', icon: 'alert-circle' },
  { id: 'historic', label: 'Historic', color: '#79512f', icon: 'book-open' },
  { id: 'scenic', label: 'Scenic', color: '#39756b', icon: 'eye' },
  { id: 'food', label: 'Food & drink', color: '#b6532c', icon: 'utensils' }
]);

export const NATIONAL_POI_QUERY_LAYERS = Object.freeze([
  'national-poi-icon',
  'national-poi-point',
  'national-poi-line',
  'national-poi-area'
]);

const QUALITY_LABELS = Object.freeze({
  wheelchair: 'Wheelchair',
  surface: 'Surface',
  smoothness: 'Smoothness',
  access: 'Access',
  foot: 'Walking access',
  lit: 'Lighting',
  covered: 'Covered',
  indoor: 'Indoor',
  tactile_paving: 'Tactile paving',
  kerb: 'Kerb',
  fee: 'Fee',
  opening_hours: 'Hours',
  toilets: 'Toilets',
  drinking_water: 'Drinking water',
  outdoor_seating: 'Outdoor seating',
  trail_visibility: 'Trail visibility',
  sac_scale: 'Trail difficulty'
});

const categoryById = new Map(NATIONAL_POI_CATEGORIES.map((category) => [category.id, category]));

export function nationalPoiCategory(categoryId) {
  return categoryById.get(categoryId) || { id: 'other', label: 'Walking place', color: '#57645f', icon: 'map-pin' };
}

export function nationalPoiIconUrl(category) {
  return new URL(`../icons/${category.icon}.svg`, import.meta.url).href;
}

function matchExpression(valueKey, fallback) {
  return ['match', ['get', 'category'], ...NATIONAL_POI_CATEGORIES.flatMap((category) => [category.id, category[valueKey]]), fallback];
}

function visibleCategoryFilter(enabledCategoryIds) {
  return ['in', ['get', 'category'], ['literal', enabledCategoryIds]];
}

function filtered(geometryFilter, enabledCategoryIds) {
  return ['all', geometryFilter, visibleCategoryFilter(enabledCategoryIds)];
}

export function nationalPoiLayerFilters(enabledCategoryIds = NATIONAL_POI_CATEGORIES.map(({ id }) => id)) {
  const filters = {
    'national-poi-area': filtered(['==', ['geometry-type'], 'Polygon'], enabledCategoryIds),
    'national-poi-line': filtered(['==', ['geometry-type'], 'LineString'], enabledCategoryIds),
    'national-poi-point': filtered(['==', ['geometry-type'], 'Point'], enabledCategoryIds),
    'national-poi-icon': filtered(['==', ['geometry-type'], 'Point'], enabledCategoryIds),
    'national-poi-place-label': filtered(['all', ['has', 'name'], ['in', ['geometry-type'], ['literal', ['Point', 'Polygon']]]], enabledCategoryIds),
    'national-poi-line-label': filtered(['all', ['has', 'name'], ['==', ['geometry-type'], 'LineString']], enabledCategoryIds),
    'national-poi-wash': filtered(['==', ['geometry-type'], 'Point'], enabledCategoryIds)
  };
  return filters;
}

export function nationalPoiStyle(sourceUrl, enabledCategoryIds = NATIONAL_POI_CATEGORIES.map(({ id }) => id), walkNetworkSourceUrl = null) {
  const categoryColor = matchExpression('color', '#57645f');
  const filters = nationalPoiLayerFilters(enabledCategoryIds);
  return {
    version: 8,
    sources: {
      osmBasemap: {
        type: 'raster',
        tiles: [
          'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png',
          'https://b.tile.openstreetmap.org/{z}/{x}/{y}.png',
          'https://c.tile.openstreetmap.org/{z}/{x}/{y}.png'
        ],
        tileSize: 256,
        maxzoom: 19,
        attribution: '© OpenStreetMap contributors'
      },
      nationalPoi: { type: 'vector', url: sourceUrl },
      ...(walkNetworkSourceUrl ? { walkNetwork: { type: 'vector', url: walkNetworkSourceUrl } } : {})
    },
    layers: [
      { id: 'osm-basemap', type: 'raster', source: 'osmBasemap', paint: { 'raster-fade-duration': 0 } },
      ...(walkNetworkSourceUrl && enabledCategoryIds.some((id) => ['trail', 'walkway', 'crossing', 'barrier'].includes(id)) ? [
        { id: 'national-walk-network', type: 'line', source: 'walkNetwork', 'source-layer': 'walk_network', minzoom: 9, paint: { 'line-color': '#176b56', 'line-width': ['interpolate', ['linear'], ['zoom'], 9, 0.45, 14, 1.15, 18, 2.8], 'line-opacity': 0.72 } }
      ] : []),
      {
        id: 'national-poi-wash', type: 'heatmap', source: 'nationalPoi', 'source-layer': 'poi', minzoom: 8, maxzoom: 13,
        filter: filters['national-poi-wash'],
        paint: {
          'heatmap-weight': 1,
          'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 8, 0.5, 12, 0.85],
          'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 8, 24, 12, 38],
          'heatmap-opacity': ['interpolate', ['linear'], ['zoom'], 8, 0.55, 11, 0.42, 12, 0.22, 12.99, 0],
          'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'], 0, 'rgba(0,0,0,0)', 0.08, 'rgba(232,237,211,0.22)', 0.25, 'rgba(163,192,151,0.38)', 0.55, 'rgba(91,145,111,0.58)', 1, 'rgba(43,101,81,0.76)']
        }
      },
      { id: 'national-poi-area', type: 'fill', source: 'nationalPoi', 'source-layer': 'poi', minzoom: 12, filter: filters['national-poi-area'], paint: { 'fill-color': categoryColor, 'fill-opacity': 0.16, 'fill-outline-color': categoryColor } },
      { id: 'national-poi-line', type: 'line', source: 'nationalPoi', 'source-layer': 'poi', minzoom: 12, filter: filters['national-poi-line'], paint: { 'line-color': categoryColor, 'line-width': ['interpolate', ['linear'], ['zoom'], 12, 1, 16, 3], 'line-opacity': 0.76 } },
      { id: 'national-poi-point', type: 'circle', source: 'nationalPoi', 'source-layer': 'poi', minzoom: 14, filter: filters['national-poi-point'], paint: { 'circle-color': categoryColor, 'circle-radius': ['interpolate', ['linear'], ['zoom'], 14, 6, 17, 9], 'circle-stroke-color': '#fffaf0', 'circle-stroke-width': 1.5, 'circle-opacity': 0.9 } }
    ]
  };
}

export function nationalPoiSymbolLayers(enabledCategoryIds = NATIONAL_POI_CATEGORIES.map(({ id }) => id)) {
  const iconExpression = ['match', ['get', 'category'], ...NATIONAL_POI_CATEGORIES.flatMap((category) => [category.id, `national-poi-${category.id}`]), 'national-poi-map-pin'];
  const filters = nationalPoiLayerFilters(enabledCategoryIds);
  return [
    {
      id: 'national-poi-icon', type: 'symbol', source: 'nationalPoi', 'source-layer': 'poi', minzoom: 12,
      filter: filters['national-poi-icon'],
      layout: {
        'icon-image': iconExpression,
        'icon-size': ['interpolate', ['linear'], ['zoom'], 12, 0.78, 16, 1.05],
        'icon-allow-overlap': false,
        'icon-ignore-placement': false,
        'icon-padding': 2
      }
    },
    {
      id: 'national-poi-place-label', type: 'symbol', source: 'nationalPoi', 'source-layer': 'poi', minzoom: 13,
      filter: filters['national-poi-place-label'],
      layout: {
        'text-field': ['get', 'name'],
        'text-font': ['Open Sans Regular'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 13, 10, 16, 12],
        'text-variable-anchor': ['top', 'bottom', 'left', 'right'],
        'text-radial-offset': 0.9,
        'text-optional': true,
        'text-padding': 3
      },
      paint: { 'text-color': '#173c35', 'text-halo-color': '#fffaf0', 'text-halo-width': 2, 'text-halo-blur': 0.3 }
    },
    {
      id: 'national-poi-line-label', type: 'symbol', source: 'nationalPoi', 'source-layer': 'poi', minzoom: 13,
      filter: filters['national-poi-line-label'],
      layout: {
        'symbol-placement': 'line',
        'symbol-spacing': 420,
        'text-field': ['get', 'name'],
        'text-font': ['Open Sans Regular'],
        'text-size': 10,
        'text-optional': true,
        'text-padding': 4
      },
      paint: { 'text-color': '#173c35', 'text-halo-color': '#fffaf0', 'text-halo-width': 2, 'text-halo-blur': 0.3 }
    }
  ];
}

async function loadSvgImage(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Map icon request failed with HTTP ${response.status}.`);
  const markup = (await response.text())
    .replaceAll('currentColor', '#fffaf0')
    .replace(/stroke="blue"/gi, 'stroke="#fffaf0"');
  const objectUrl = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml' }));
  try {
    return await new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`Map icon could not be decoded: ${url}`));
      image.src = objectUrl;
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function markerImage(icon, color) {
  const size = 48;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  context.fillStyle = color;
  context.strokeStyle = '#fffaf0';
  context.lineWidth = 3;
  context.beginPath();
  context.arc(size / 2, size / 2, 20, 0, Math.PI * 2);
  context.fill();
  context.stroke();
  context.drawImage(icon, 12, 12, 24, 24);
  return context.getImageData(0, 0, size, size);
}

export async function registerNationalPoiIcons(map) {
  const categories = [...NATIONAL_POI_CATEGORIES, { id: 'map-pin', icon: 'map-pin', color: '#57645f' }];
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      map.hasImage('national-poi-registry-check');
      break;
    } catch (error) {
      if (attempt === 99) throw error;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  await Promise.all(categories.map(async (category) => {
    const id = `national-poi-${category.id}`;
    if (map.hasImage(id)) return;
    const icon = await loadSvgImage(nationalPoiIconUrl(category));
    if (!map.hasImage(id)) map.addImage(id, markerImage(icon, category.color), { pixelRatio: 2 });
  }));
}

function readable(value) {
  return String(value).replaceAll('_', ' ').replaceAll(';', ' · ');
}

export function nationalPoiFeatureDetails(properties = {}) {
  let tags = {};
  try { tags = typeof properties.osm_tags === 'string' ? JSON.parse(properties.osm_tags) : (properties.osm_tags || {}); }
  catch { tags = {}; }
  const category = nationalPoiCategory(properties.category);
  const qualities = Object.entries(QUALITY_LABELS)
    .filter(([key]) => tags[key] !== undefined && tags[key] !== '')
    .map(([key, label]) => ({ label, value: readable(tags[key]) }))
    .slice(0, 8);
  return {
    name: properties.name || readable(properties.subcategory || category.label),
    category: category.label,
    categoryId: category.id,
    color: category.color,
    icon: category.icon,
    subcategory: properties.subcategory ? readable(properties.subcategory) : '',
    qualities,
    osmId: properties.osm_id ? `${properties.osm_type || 'element'}/${properties.osm_id}` : '',
    source: properties.source || 'OpenStreetMap'
  };
}
