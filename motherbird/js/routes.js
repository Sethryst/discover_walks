import { state } from './state.js';
import { escapeHtml } from './utils.js';

// Route geometry is rendered only after it is packaged from an authoritative
// GIS source. The prior hand-generalized lines remain listed for research, but
// are deliberately blocked from map rendering and time-based planning.
export const CURATED_ROUTES = [
  {
    id: 'nyc-manhattan-waterfront', city: 'newyork', title: 'Manhattan Waterfront Greenway',
    distanceMiles: 11.8, durationMinutes: 235, difficulty: 'Moderate',
    description: 'A long Hudson-side city walk from Battery Park through the west-side waterfront to Inwood.',
    sourceName: 'NYC DOT Greenways', sourceUrl: 'https://www.nyc.gov/html/dot/html/bicyclists/greenways.shtml',
    geometryStatus: 'needs_official_geometry', coordinates: []
  },
  {
    id: 'nyc-jamaica-bay', city: 'newyork', title: 'Jamaica Bay Greenway Explorer',
    distanceMiles: 13.6, durationMinutes: 275, difficulty: 'Challenging',
    description: 'A long waterfront discovery route linking Jamaica Bay parkland, Canarsie Pier, and shoreline paths.',
    sourceName: 'NYC DOT Greenways', sourceUrl: 'https://www.nyc.gov/html/dot/html/bicyclists/greenways.shtml',
    geometryStatus: 'needs_official_geometry', coordinates: []
  },
  {
    id: 'dc-anacostia-riverwalk-south-capitol-section', city: 'dc', title: 'Anacostia Riverwalk: South Capitol section',
    distanceMiles: 0.6, durationMinutes: 12, difficulty: 'Easy', category: 'waterfront',
    description: 'A verified short section of the Anacostia Riverwalk Trail; suitable as a building block, not a claimed full-trail route.',
    sourceName: 'DDOT Bike Trails (DC) GIS', sourceUrl: 'https://services.arcgis.com/neT9SoYxizqTHZPH/ArcGIS/rest/services/MBT_Map_Draft_WFL1/FeatureServer/15',
    geometryStatus: 'validated', geometryProvenance: { type: 'official-gis', featureName: 'Anacostia Riverwalk Trail', retrievedAt: '2026-08-04' },
    coordinates: [[38.872796,-76.998926],[38.872876,-76.999603],[38.872954,-77.000479],[38.873207,-77.000620],[38.873213,-77.001241],[38.873049,-77.001451],[38.873047,-77.002214],[38.873045,-77.002329],[38.872778,-77.002402],[38.872728,-77.002631],[38.872543,-77.003514],[38.872530,-77.003592],[38.872083,-77.004660],[38.871542,-77.005992],[38.871191,-77.006015],[38.870837,-77.006521],[38.870521,-77.006779],[38.870180,-77.007043]],
    sections: [{ id: 'south-capitol', name: 'South Capitol to Navy Yard', durationMinutes: 12, completionReward: 10 }]
  }
];

export function validateRoute(route) {
  if (route.isJourney) {
    const valid = route.coordinates?.length >= 2;
    return { valid, reason: valid ? null : 'This journey does not include verified route geometry yet.' };
  }
  const points = route.coordinates || [];
  const validCoordinates = points.length >= 2 && points.every(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180);
  const valid = route.geometryStatus === 'validated' && route.geometryProvenance?.type === 'official-gis' && Boolean(route.sourceUrl) && validCoordinates;
  return { valid, reason: valid ? null : 'Official GIS geometry has not been packaged yet.' };
}

export function routesForCity(cityId = state.activeCity) {
  const journeys = (state.cityPois[cityId] || [])
    .filter(poi => poi.category === 'journey')
    .map(journey => {
      const chapters = journey.chapters || [];
      const distanceMiles = chapters.reduce((sum, ch) => sum + (ch.distance_miles || 0), 0);
      const durationMinutes = chapters.reduce((sum, ch) => sum + (ch.estimated_duration_minutes || 0), 0);
      const coordinates = chapters
        .flatMap((chapter) => chapter.geometry?.coordinates || [])
        .map(([lng, lat]) => [lat, lng])
        .filter(([lat, lng]) => Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180);
      return {
        id: journey.id,
        city: cityId,
        title: journey.name,
        distanceMiles: distanceMiles,
        durationMinutes: durationMinutes,
        difficulty: distanceMiles > 5 ? 'Challenging' : (distanceMiles > 2 ? 'Moderate' : 'Easy'),
        description: journey.description,
        isJourney: true,
        coordinates,
        chapters
      };
    });

  const staticRoutes = CURATED_ROUTES.filter((route) => route.city === cityId && validateRoute(route).valid);
  return [...journeys, ...staticRoutes];
}

export function routeById(routeId) {
  return routesForCity(state.activeCity).find((route) => route.id === routeId) || null;
}

export function renderCuratedRoutes() {
  const container = document.getElementById('curatedRoutesList');
  if (!container) return;
  const routes = routesForCity(state.activeCity);

  if (!routes.length) {
    container.innerHTML = '<div class="empty-state">Curated walks are being added for this city. Explore local places on the map in the meantime.</div>';
    return;
  }

  container.innerHTML = routes.map((route) => {
    if (route.isJourney) {
      const chaptersHtml = route.chapters.map((ch, i) => `
        <details class="journey-chapter" style="margin-top:0.5rem; background:rgba(0,0,0,0.03); padding:0.5rem; border-radius:4px;">
          <summary style="cursor:pointer; font-weight:600;">Chapter ${i+1}: ${escapeHtml(ch.name)} <span style="font-weight:normal; opacity:0.8; font-size:0.9em; float:right;">${(ch.distance_miles||0).toFixed(1)} mi · ${(ch.estimated_duration_minutes||0)} min</span></summary>
          <div style="margin-top:0.5rem; font-size:0.9em;">
            <p style="margin:0 0 0.5rem 0;">${escapeHtml(ch.description || '')}</p>
            ${ch.stops?.length ? `<p style="margin:0; font-style:italic;">Stops: ${ch.stops.map(s => escapeHtml(s.name)).join(', ')}</p>` : ''}
          </div>
        </details>
      `).join('');

      return `
        <article class="route-card journey-card">
          <div class="route-preview route-preview-${route.city}">⟿</div>
          <div style="flex:1;">
            <strong>${escapeHtml(route.title)}</strong>
            <p>${route.distanceMiles.toFixed(1)} mi · about ${Math.round(route.durationMinutes / 60)} hr ${Math.round(route.durationMinutes) % 60 ? `${Math.round(route.durationMinutes) % 60} min` : ''}</p>
            <span class="difficulty ${route.difficulty.toLowerCase()}">${escapeHtml(route.difficulty)}</span>
            <small class="route-audit-note">Modular Journey</small>
            <p style="margin-top:0.5rem;">${escapeHtml(route.description || '')}</p>
            <div class="journey-chapters-container" style="margin-top:1rem;">
              ${chaptersHtml}
            </div>
          </div>
          ${validateRoute(route).valid ? `<button class="primary-button" type="button" data-curated-route="${route.id}">View route</button>` : '<small class="route-audit-note">Map preview pending verified route data</small>'}
        </article>
      `;
    } else {
      return `<article class="route-card"><div class="route-preview route-preview-${route.city}">↝</div><div><strong>${escapeHtml(route.title)}</strong><p>${route.distanceMiles} mi · about ${Math.round(route.durationMinutes / 60)} hr ${route.durationMinutes % 60 ? `${route.durationMinutes % 60} min` : ''}</p><span class="difficulty ${route.difficulty.toLowerCase()}">${escapeHtml(route.difficulty)}</span><small class="route-audit-note">Curated walk · official geometry</small></div><button class="primary-button" type="button" data-curated-route="${route.id}">View route</button></article>`;
    }
  }).join('');
}

export function showCuratedRoute(routeId) {
  const route = routeById(routeId);
  if (!route || !validateRoute(route).valid || !state.map) return null;

  state.curatedRouteLine?.remove();
  state.curatedRouteLine = L.polyline(route.coordinates, { color: '#1b8b7e', weight: 6, opacity: .9, dashArray: '10 7' }).addTo(state.map);
  state.map.fitBounds(state.curatedRouteLine.getBounds(), { padding: [28, 28], maxZoom: 14 });
  return route;
}
