import { CITIES, GEOFENCE_CATEGORIES } from './constants.js';
import { state } from './state.js';
import { el } from './utils.js';
import { distanceMeters } from './geo.js';
import { switchCity } from './city.js';

const defaultHeadlines = [
  ['History', ''], ['A gentle walk', ''], ['Nature to notice', ''], ['Your next landmark', '']
];

let headlineIndex = 0;

function labelFor(tag) {
  return (GEOFENCE_CATEGORIES.find(([id]) => id === tag)?.[1] || tag.replaceAll('_', ' ')).replace(/^[^\p{L}\p{N}]+\s*/u, '').toLowerCase();
}

export function renderDiscoveryHeadline() {
  const preferences = state.settings.favoriteCategories || [];
  const dataCategories = [...new Set((state.cityPois[state.activeCity] || []).flatMap((poi) => poi.tags || [poi.category]).filter(Boolean))]
    .filter((tag) => !tag.startsWith('history_')).slice(0, 5);
  const categories = preferences.length ? preferences : dataCategories;
  const choices = categories.length
    ? categories.map((tag) => [labelFor(tag), ''])
    : defaultHeadlines;
  const [headline, detail] = choices[headlineIndex % choices.length];
  el('discoveryHeadline').textContent = headline;
  el('discoveryHeadlineDetail').textContent = detail;
  el('discoveryHeadlineDetail').classList.toggle('hidden', !detail);
  headlineIndex += 1;
}

export function startDiscoveryHeadline() {
  renderDiscoveryHeadline();
  window.setInterval(renderDiscoveryHeadline, 4200);
}

export async function chooseClosestCityIfPermitted() {
  const closest = await nearestCityFromCurrentLocation();
  if (closest && closest.id !== state.activeCity) await switchCity(closest.id, true);
}

export function nearestCityFor(point) {
  return Object.entries(CITIES).reduce((best, [id, config]) => {
    const distance = distanceMeters(point, config.center);
    return !best || distance < best.distance ? { id, distance, point } : best;
  }, null);
}

// This intentionally requests location during first launch. If declined or
// unavailable, the saved/default city remains usable without any delay.
export async function nearestCityFromCurrentLocation() {
  if (!navigator.geolocation) return null;
  return new Promise((resolve) => navigator.geolocation.getCurrentPosition(
    (position) => resolve(nearestCityFor({ lat: position.coords.latitude, lng: position.coords.longitude })),
    () => resolve(null),
    { enableHighAccuracy: false, maximumAge: 300000, timeout: 5000 }
  ));
}
