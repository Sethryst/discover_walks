import { state } from './state.js';

// Keep endpoint gestures isolated from Leaflet's synthetic POI/cluster events.
// The helper has its own versioned module so a stale state.js shell response
// cannot prevent the app from starting after a deployment.
export function setPlannerSelecting(value) {
  state.plannerSelecting = value;
  const layer = state.poiLayer;
  if (!layer || !state.map) return;
  // Neighborhood/district polygons are informational overlays, but their
  // Leaflet click handlers can consume endpoint taps in Washington, DC.
  // Temporarily remove that overlay while the planner owns map gestures.
  const neighborhoods = state.neighborhoodLayer;
  if (value) neighborhoods?.remove?.();
  else if (neighborhoods && !state.map.hasLayer(neighborhoods)) neighborhoods.addTo(state.map);
  if (value) {
    if (state.map.hasLayer(layer)) state.map.removeLayer(layer);
  } else if (!state.map.hasLayer(layer)) {
    layer.addTo(state.map);
  }
}
