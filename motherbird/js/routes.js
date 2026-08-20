import { state } from './state.js';
import { escapeHtml } from './utils.js';
import { DC_OFFICIAL_TRAILS } from '../data/dc-official-trails.js';

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
  ...DC_OFFICIAL_TRAILS
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
      const distanceMiles = chapters.reduce((sum, ch) => sum + (ch.distanceMiles ?? ch.distance_miles ?? 0), 0);
      const durationMinutes = chapters.reduce((sum, ch) => sum + (ch.estimatedDurationMinutes ?? ch.estimated_duration_minutes ?? 0), 0);
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
        access: journey.access,
        sources: journey.sources || [],
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
      const chaptersHtml = route.chapters.map((ch, i) => {
        const chapterMiles = ch.distanceMiles ?? ch.distance_miles ?? 0;
        const chapterMinutes = ch.estimatedDurationMinutes ?? ch.estimated_duration_minutes ?? 0;
        return `
        <details class="journey-chapter" style="margin-top:0.5rem; background:rgba(0,0,0,0.03); padding:0.5rem; border-radius:4px;">
          <summary style="cursor:pointer; font-weight:600;">Section ${i+1}: ${escapeHtml(ch.name)} <span style="font-weight:normal; opacity:0.8; font-size:0.9em; float:right;">${chapterMiles < 0.1 ? '&lt;0.1' : Number(chapterMiles).toFixed(1)} mi · ${chapterMinutes < 1 ? '&lt;1' : chapterMinutes} min</span></summary>
          <div style="margin-top:0.5rem; font-size:0.9em;">
            <p style="margin:0 0 0.5rem 0;">${escapeHtml(ch.description || '')}</p>
            ${ch.stops?.length ? `<p style="margin:0; font-style:italic;">Stops: ${ch.stops.map(s => escapeHtml(s.name)).join(', ')}</p>` : ''}
          </div>
        </details>
      `; }).join('');
      const accessHtml = route.access ? `<div class="route-access"><strong>Getting there</strong><p>${escapeHtml([route.access.startLabel, route.access.destinationLabel].filter(Boolean).join(' → '))}</p>${route.access.note ? `<small>${escapeHtml(route.access.note)}</small>` : ''}</div>` : '';
      const source = route.sources?.find((item) => /^https:\/\//.test(item.url || ''));

      return `
        <article class="route-card journey-card">
          <div class="route-preview route-preview-${route.city}">⟿</div>
          <div style="flex:1;">
            <strong>${escapeHtml(route.title)}</strong>
            <p>${route.distanceMiles.toFixed(1)} mi · about ${Math.round(route.durationMinutes / 60)} hr ${Math.round(route.durationMinutes) % 60 ? `${Math.round(route.durationMinutes) % 60} min` : ''}</p>
            <span class="difficulty ${route.difficulty.toLowerCase()}">${escapeHtml(route.difficulty)}</span>
            <small class="route-audit-note">Modular Journey</small>
            <p style="margin-top:0.5rem;">${escapeHtml(route.description || '')}</p>
            ${accessHtml}
            ${source ? `<a class="text-button" href="${escapeHtml(source.url)}" target="_blank" rel="noreferrer">${escapeHtml(source.name)} ↗</a>` : ''}
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
