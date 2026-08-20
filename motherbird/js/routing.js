const FOOT_ROUTER = 'https://routing.openstreetmap.de/routed-foot/route/v1/driving/';

// Overpass is useful for fetching OSM features, but it does not calculate a
// path. This service runs the pedestrian OSM graph and returns road geometry.
export async function routeOnFoot(points) {
  if (!Array.isArray(points) || points.length < 2) return null;
  const coordinates = points.map((point) => `${point.lng},${point.lat}`).join(';');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  let response;
  try { response = await fetch(`${FOOT_ROUTER}${coordinates}?overview=full&geometries=geojson&steps=false`, { signal: controller.signal }); }
  catch { return null; }
  finally { clearTimeout(timeout); }
  if (!response.ok) return null;
  const payload = await response.json();
  const route = payload.routes?.[0];
  if (!route?.geometry?.coordinates?.length) return null;
  return {
    coordinates: route.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
    distanceMeters: route.distance,
    durationSeconds: route.duration
  };
}
