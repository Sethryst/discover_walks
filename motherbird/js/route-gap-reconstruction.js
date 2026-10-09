import { distanceMeters } from './geo.js';

export const GAP_RECONSTRUCTION_MIN_MS = 2 * 60 * 1000;

export function gapBetween(previous, current, minimumMs = GAP_RECONSTRUCTION_MIN_MS) {
  if (!previous || !current) return false;
  const previousMs = new Date(previous.capturedAt || previous.capturedAtMs || 0).getTime();
  const currentMs = new Date(current.capturedAt || current.capturedAtMs || 0).getTime();
  return Number.isFinite(previousMs) && Number.isFinite(currentMs) && currentMs - previousMs >= minimumMs;
}

export function reconstructedPoints(coordinates, from, to) {
  if (!Array.isArray(coordinates) || coordinates.length < 2 || !from || !to) return [];
  const startMs = new Date(from.capturedAt || from.capturedAtMs || Date.now()).getTime();
  const endMs = new Date(to.capturedAt || to.capturedAtMs || Date.now()).getTime();
  const span = Math.max(0, endMs - startMs);
  return coordinates.slice(1, -1).map(([lat, lng], index, points) => ({
    lat, lng, accuracy: null, inferred: true, source: 'route-graph',
    capturedAt: new Date(startMs + span * ((index + 1) / (points.length + 1))).toISOString()
  }));
}

export function reconstructedDistance(coordinates) {
  return (coordinates || []).slice(1).reduce((total, coordinate, index) => total + distanceMeters(
    { lat: coordinates[index][0], lng: coordinates[index][1] },
    { lat: coordinate[0], lng: coordinate[1] }
  ), 0);
}
