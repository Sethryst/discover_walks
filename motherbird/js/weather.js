import { CITIES } from './constants.js';
import { state } from './state.js';
import { el, escapeHtml } from './utils.js';
import { setCompanionEnvironment } from './companion.js';

export function liveConditionsText(weather, sun, nwsPeriod = null) {
  const current = weather?.current || {};
  const parts = [];
  if (Number.isFinite(current.temperature_2m)) parts.push(`${Math.round(current.temperature_2m)}°C`);
  if (Number.isFinite(current.apparent_temperature)) parts.push(`feels ${Math.round(current.apparent_temperature)}°C`);
  if (Number.isFinite(current.uv_index)) parts.push(`UV ${Math.round(current.uv_index)}`);
  if (Number.isFinite(current.precipitation) && current.precipitation > 0) parts.push(`${current.precipitation.toFixed(1)} mm rain now`);
  if (nwsPeriod?.shortForecast) parts.push(nwsPeriod.shortForecast);
  if (sun?.results?.sunset) parts.push(`sunset ${new Date(sun.results.sunset).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`);
  return parts.join(' · ') || 'Live conditions unavailable';
}

async function loadNwsPeriod(lat, lng) {
  try {
    const pointResponse = await fetch(`https://api.weather.gov/points/${encodeURIComponent(lat)},${encodeURIComponent(lng)}`);
    const point = pointResponse.ok ? await pointResponse.json() : null;
    const forecastUrl = point?.properties?.forecast;
    if (!forecastUrl) return null;
    const forecastResponse = await fetch(forecastUrl);
    const forecast = forecastResponse.ok ? await forecastResponse.json() : null;
    return forecast?.properties?.periods?.[0] || null;
  } catch { return null; }
}

export async function refreshLiveConditions() {
  const target = el('weatherBrief'); const city = CITIES[state.activeCity];
  if (!target || !city) return;
  target.textContent = 'Refreshing conditions for this region…'; target.classList.remove('hidden');
  const { lat, lng } = city.center;
  try {
    const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lng)}&current=temperature_2m,apparent_temperature,uv_index,precipitation&timezone=auto`;
    const sunUrl = `https://api.sunrise-sunset.org/json?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}&formatted=0`;
    const [weatherResponse, sunResponse, nwsPeriod] = await Promise.all([fetch(weatherUrl), fetch(sunUrl), loadNwsPeriod(lat, lng)]);
    const weather = weatherResponse.ok ? await weatherResponse.json() : null;
    const sun = sunResponse.ok ? await sunResponse.json() : null;
    const forecastText = String(nwsPeriod?.shortForecast || '');
    setCompanionEnvironment({ rain: Number(weather?.current?.precipitation) > 0 || /rain|shower|storm/i.test(forecastText), sunny: /sunny|clear/i.test(forecastText) });
    target.innerHTML = `${escapeHtml(liveConditionsText(weather, sun, nwsPeriod))} <small>Uses ${escapeHtml(city.name)}’s map center; your location is not sent.</small> <button class="text-button" id="refreshConditionsButton" type="button">Refresh</button>`;
    el('refreshConditionsButton')?.addEventListener('click', () => void refreshLiveConditions());
  } catch {
    target.innerHTML = `Live conditions could not load. <button class="text-button" id="refreshConditionsButton" type="button">Try again</button>`;
    el('refreshConditionsButton')?.addEventListener('click', () => void refreshLiveConditions());
  }
}

export async function renderWeatherBrief() {
  const target = el('weatherBrief');
  const file = CITIES[state.activeCity]?.weatherFile;
  target.classList.add('hidden');
  if (!file) { target.innerHTML = 'Live conditions are available for this region. <button class="text-button" id="refreshConditionsButton" type="button">Refresh conditions</button>'; target.classList.remove('hidden'); el('refreshConditionsButton')?.addEventListener('click', () => void refreshLiveConditions()); return; }
  try {
    const response = await fetch(file);
    const weather = response.ok ? await response.json() : null;
    if (!weather || Date.now() >= Date.parse(weather.freshnessExpiresAt || '')) return;
    const period = weather.forecast?.[0];
    const alert = weather.activeAlerts?.[0];
    const text = alert?.headline || alert?.event || (period ? `${period.name}: ${period.shortForecast}${period.temperature != null ? ` · ${period.temperature}°${period.temperatureUnit || ''}` : ''}` : 'Forecast available');
    setCompanionEnvironment({ rain: /rain|shower|storm/i.test(`${alert?.event || ''} ${period?.shortForecast || ''}`), sunny: /sunny|clear/i.test(period?.shortForecast || '') });
    target.innerHTML = `${escapeHtml(text)} <a href="${escapeHtml(weather.source?.url || 'https://www.weather.gov')}" target="_blank" rel="noreferrer">NWS ↗</a> <button class="text-button" id="refreshConditionsButton" type="button">Live conditions</button>`;
    target.classList.remove('hidden');
    el('refreshConditionsButton')?.addEventListener('click', () => void refreshLiveConditions());
  } catch { target.innerHTML = 'Live conditions are available for this region. <button class="text-button" id="refreshConditionsButton" type="button">Refresh conditions</button>'; target.classList.remove('hidden'); el('refreshConditionsButton')?.addEventListener('click', () => void refreshLiveConditions()); }
}
