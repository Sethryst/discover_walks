import { CITIES } from './constants.js';
import { state } from './state.js';
import { el, escapeHtml } from './utils.js';
import { setCompanionEnvironment } from './companion.js';

export function liveConditionsText(weather, sun, nwsPeriod = null) {
  const current = weather?.current || {};
  const parts = [];
  if (nwsPeriod?.shortForecast) parts.push(nwsPeriod.shortForecast);
  if (Number.isFinite(current.temperature_2m)) parts.push(`${Math.round((current.temperature_2m * 9) / 5 + 32)}°F`);
  if (!parts.length && Number.isFinite(current.apparent_temperature)) parts.push(`Feels ${Math.round((current.apparent_temperature * 9) / 5 + 32)}°F`);
  return parts.join(' · ') || 'Live conditions unavailable';
}

function weatherIcon(text = '') {
  const value = String(text).toLowerCase();
  if (/snow|blizzard|ice/.test(value)) return './icons/cloud-snow.svg';
  if (/rain|shower|drizzle/.test(value)) return './icons/cloud-drizzle.svg';
  if (/wind|breezy/.test(value)) return './icons/wind.svg';
  if (/sunny|clear/.test(value)) return './icons/sunrise.svg';
  return './icons/cloud.svg';
}

function weatherBriefHtml(text) {
  return `<img class="weather-brief-icon" src="${weatherIcon(text)}" alt="" aria-hidden="true"><span>${escapeHtml(text)}</span>`;
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
    const rain = nwsObservation ? observationIsWet(nwsObservation) : Number(weather?.current?.precipitation) > 0 || /rain|shower|storm/i.test(forecastText);
    setCompanionEnvironment({ rain, sunny: /sunny|clear/i.test(`${forecastText} ${nwsObservation?.textDescription || ''}`) });
    const summary = liveConditionsText(weather, sun, nwsPeriod);
    target.innerHTML = weatherBriefHtml(summary);
  } catch {
    target.innerHTML = weatherBriefHtml('Weather unavailable');
  }
}

export async function renderWeatherBrief() {
  const target = el('weatherBrief');
  if (!target) return;
  const file = CITIES[state.activeCity]?.weatherFile;
  target.classList.add('hidden');
  if (!file) { await refreshLiveConditions(); return; }
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
    target.innerHTML = weatherBriefHtml(text);
    target.classList.remove('hidden');
  } catch { target.innerHTML = weatherBriefHtml('Weather unavailable'); target.classList.remove('hidden'); }
}
