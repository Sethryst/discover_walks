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

async function loadNwsObservation(lat, lng) {
  try {
    const headers = { Accept: 'application/geo+json', 'User-Agent': 'Gremlin Lab walking app (weather contact)' };
    const pointResponse = await fetch(`https://api.weather.gov/points/${encodeURIComponent(lat)},${encodeURIComponent(lng)}`, { headers });
    const point = pointResponse.ok ? await pointResponse.json() : null;
    const stationsUrl = point?.properties?.observationStations;
    if (!stationsUrl) return null;
    const stationsResponse = await fetch(stationsUrl, { headers });
    const stations = stationsResponse.ok ? await stationsResponse.json() : null;
    const stationUrl = stations?.features?.[0]?.id;
    if (!stationUrl) return null;
    const observationResponse = await fetch(`${stationUrl}/observations/latest`, { headers });
    return observationResponse.ok ? (await observationResponse.json())?.properties || null : null;
  } catch { return null; }
}

function observationIsWet(observation) {
  const precipitation = observation?.precipitationLastHour?.value;
  const presentWeather = (observation?.presentWeather || []).map((item) => `${item?.weather || ''} ${item?.intensity || ''}`).join(' ');
  return (Number.isFinite(precipitation) && precipitation > 0) || /rain|shower|drizzle|thunderstorm/i.test(`${observation?.textDescription || ''} ${presentWeather}`);
}

export async function refreshLiveConditions() {
  const target = el('weatherBrief'); const city = CITIES[state.activeCity];
  if (!target || !city) return;
  target.textContent = 'Refreshing conditions for this region…'; target.classList.remove('hidden');
  const { lat, lng } = city.center;
  try {
    const weatherUrl = `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(lat)}&longitude=${encodeURIComponent(lng)}&current=temperature_2m,apparent_temperature,uv_index,precipitation&timezone=auto`;
    const sunUrl = `https://api.sunrise-sunset.org/json?lat=${encodeURIComponent(lat)}&lng=${encodeURIComponent(lng)}&formatted=0`;
    const [weatherResponse, sunResponse, nwsPeriod, nwsObservation] = await Promise.all([fetch(weatherUrl), fetch(sunUrl), loadNwsPeriod(lat, lng), loadNwsObservation(lat, lng)]);
    const weather = weatherResponse.ok ? await weatherResponse.json() : null;
    const sun = sunResponse.ok ? await sunResponse.json() : null;
    const forecastText = String(nwsPeriod?.shortForecast || '');
    const observationText = nwsObservation?.textDescription ? ` · NWS: ${nwsObservation.textDescription}` : '';
    const rain = nwsObservation ? observationIsWet(nwsObservation) : Number(weather?.current?.precipitation) > 0 || /rain|shower|storm/i.test(forecastText);
    setCompanionEnvironment({ rain, sunny: /sunny|clear/i.test(`${forecastText} ${nwsObservation?.textDescription || ''}`) });
    target.innerHTML = `${escapeHtml(liveConditionsText(weather, sun, nwsPeriod) + observationText)} <small>Uses ${escapeHtml(city.name)}’s map center; NWS station observations may lag by up to about 20 minutes.</small> <button class="text-button" id="refreshConditionsButton" type="button">Refresh</button>`;
    el('refreshConditionsButton')?.addEventListener('click', () => void refreshLiveConditions());
  } catch {
    target.innerHTML = `Live conditions could not load. <button class="text-button" id="refreshConditionsButton" type="button">Try again</button>`;
    el('refreshConditionsButton')?.addEventListener('click', () => void refreshLiveConditions());
  }
}

export async function renderWeatherBrief() {
  const target = el('weatherBrief');
  if (!target) return;
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
    const observation = await loadNwsObservation(Number(CITIES[state.activeCity].center.lat), Number(CITIES[state.activeCity].center.lng));
    const forecastText = `${alert?.event || ''} ${period?.shortForecast || ''}`;
    setCompanionEnvironment({ rain: observation ? observationIsWet(observation) : /rain|shower|storm/i.test(forecastText), sunny: /sunny|clear/i.test(`${forecastText} ${observation?.textDescription || ''}`) });
    const observationText = observation?.textDescription ? ` · Current: ${observation.textDescription}` : '';
    target.innerHTML = `${escapeHtml(text + observationText)} <a href="${escapeHtml(weather.source?.url || 'https://www.weather.gov')}" target="_blank" rel="noreferrer">NWS ↗</a> <button class="text-button" id="refreshConditionsButton" type="button">Live conditions</button>`;
    target.classList.remove('hidden');
    el('refreshConditionsButton')?.addEventListener('click', () => void refreshLiveConditions());
  } catch { target.innerHTML = 'Live conditions are available for this region. <button class="text-button" id="refreshConditionsButton" type="button">Refresh conditions</button>'; target.classList.remove('hidden'); el('refreshConditionsButton')?.addEventListener('click', () => void refreshLiveConditions()); }
}
