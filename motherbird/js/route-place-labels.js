const labelCache = new Map();
const pending = new Map();

export function coordinateLabel(point) {
  if (!point || !Number.isFinite(Number(point.lat)) || !Number.isFinite(Number(point.lng))) return 'Not selected';
  if (point.label) return point.label;
  return `${Number(point.lat).toFixed(5)}, ${Number(point.lng).toFixed(5)}`;
}

export async function resolveRoutePlaceLabel(point) {
  if (!point || !Number.isFinite(Number(point.lat)) || !Number.isFinite(Number(point.lng))) return null;
  const key = `${Number(point.lat).toFixed(5)},${Number(point.lng).toFixed(5)}`;
  if (labelCache.has(key)) return labelCache.get(key);
  if (pending.has(key)) return pending.get(key);
  const promise = (async () => {
    try {
      const params = new URLSearchParams({ lat: point.lat, lon: point.lng, format: 'jsonv2', zoom: '18', addressdetails: '1' });
      const response = await fetch(`https://nominatim.openstreetmap.org/reverse?${params}`, { credentials: 'omit', referrerPolicy: 'no-referrer', headers: { Accept: 'application/json' } });
      if (!response.ok) return null;
      const address = (await response.json())?.address || {};
      const label = address.road || address.pedestrian || address.footway || address.path || address.cycleway || address.neighbourhood || address.suburb || null;
      if (label) labelCache.set(key, label);
      return label;
    } catch (_) { return null; }
    finally { pending.delete(key); }
  })();
  pending.set(key, promise);
  return promise;
}
