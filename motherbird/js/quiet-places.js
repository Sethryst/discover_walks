import db from './storage.js';

const CACHE_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function cacheId(cityId, origin) {
  // A rounded cell avoids a new request for every tiny GPS change while still
  // keeping suggestions local to the part of a large city being explored.
  return `quiet-osm:${cityId}:${origin.lat.toFixed(2)}:${origin.lng.toFixed(2)}`;
}

function asQuietPlace(element) {
  const tags = element.tags || {};
  const lat = element.lat ?? element.center?.lat;
  const lng = element.lon ?? element.center?.lon;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const kind = tags.leisure === 'garden' ? 'garden' : tags.natural === 'water' || tags.waterway ? 'water' : 'green space';
  return {
    id: `osm-quiet-${element.type}-${element.id}`,
    name: tags.name || `Nearby ${kind}`,
    lat, lng,
    tags: ['quiet'],
    source: 'OpenStreetMap',
    sourceType: 'osm-quiet-fallback',
    nonWalkable: false,
    excludeFromWalks: false
  };
}

export async function quietPlacesNear(cityId, origin) {
  const id = cacheId(cityId, origin);
  const cached = await db.get('poi_metadata', id);
  if (cached?.places?.length && Date.now() - new Date(cached.fetchedAt).getTime() < CACHE_AGE_MS) return cached.places;

  // These are broad, calm destinations rather than every OSM object. They are
  // used only to give route planning somewhere meaningful to turn toward.
  const query = `[out:json][timeout:12];(nwr(around:2800,${origin.lat},${origin.lng})[leisure=park];nwr(around:2800,${origin.lat},${origin.lng})[leisure=garden];nwr(around:2800,${origin.lat},${origin.lng})[landuse=grass];nwr(around:2800,${origin.lat},${origin.lng})[natural=water];nwr(around:2800,${origin.lat},${origin.lng})[waterway=riverbank];);out center tags;`;
  try {
    const response = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: query });
    if (!response.ok) return cached?.places || [];
    const places = (await response.json()).elements.map(asQuietPlace).filter(Boolean).slice(0, 40);
    await db.put('poi_metadata', { id, places, fetchedAt: new Date().toISOString(), attribution: '© OpenStreetMap contributors' });
    return places;
  } catch {
    return cached?.places || [];
  }
}
