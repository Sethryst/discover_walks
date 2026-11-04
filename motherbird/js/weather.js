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

function weatherIcon(text = '', night = false) {
  if (night) return './icons/moon.svg';
  const value = String(text).toLowerCase();
  if (/snow|blizzard|ice/.test(value)) return './icons/cloud-snow.svg';
  if (/rain|shower|drizzle/.test(value)) return './icons/cloud-drizzle.svg';
  if (/wind|breezy/.test(value)) return './icons/wind.svg';
  if (/sunny|clear/.test(value)) return './icons/sunrise.svg';
  return './icons/cloud.svg';
}

function weatherBriefHtml(text, _timeZone = null, night = false) {
  return `<img class="weather-brief-icon" src="${weatherIcon(text, night)}" alt="" aria-hidden="true"><span>${escapeHtml(text)}</span>`;
}

function rainTimingText(periods = [], timeZone = null) {
  const rainPeriod = periods.find((period) => /rain|shower|drizzle|storm/i.test(String(period?.shortForecast || '')));
  if (!rainPeriod) return '';
  const start = Date.parse(rainPeriod.startTime || '');
  if (!Number.isFinite(start)) return ' · Rain timing unavailable';
  try {
    const formatter = new Intl.DateTimeFormat([], { timeZone: timeZone || undefined, hour: 'numeric', minute: '2-digit' });
    const startLabel = formatter.format(new Date(start));
    const end = Date.parse(rainPeriod.endTime || '');
    const endLabel = Number.isFinite(end) ? formatter.format(new Date(end)) : null;
    if (start <= Date.now()) return endLabel && end > Date.now() ? ` · Rain possible now through ${endLabel}` : ' · Rain possible now';
    return endLabel && end > start ? ` · Rain possible ${startLabel}–${endLabel}` : ` · Rain possible from ${startLabel}`;
  } catch { return ' · Rain timing unavailable'; }
}

function nightAdjustedText(text, sun = null, period = null) {
  const now = Date.now();
  const nightBySun = sun?.sunrise && sun?.sunset && (now < Date.parse(sun.sunrise) || now >= Date.parse(sun.sunset));
  const night = period?.isDaytime === false || nightBySun;
  if (!night) return { text, night: false };
  return { text: String(text).replace(/\bsunny\b|\bclear\b/gi, 'clear tonight'), night: true };
}

async function loadNwsPeriods(lat, lng) {
  try {
    const pointResponse = await fetch(`https://api.weather.gov/points/${encodeURIComponent(lat)},${encodeURIComponent(lng)}`);
    const point = pointResponse.ok ? await pointResponse.json() : null;
    const forecastUrl = point?.properties?.forecast;
    if (!forecastUrl) return null;
    const forecastResponse = await fetch(forecastUrl);
    const forecast = forecastResponse.ok ? await forecastResponse.json() : null;
    return forecast?.properties?.periods || [];
  } catch { return []; }
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
    const [weatherResponse, sunResponse, nwsPeriods, nwsObservation] = await Promise.all([fetch(weatherUrl), fetch(sunUrl), loadNwsPeriods(lat, lng), loadNwsObservation(lat, lng)]);
    const nwsPeriod = nwsPeriods[0] || null;
    const weather = weatherResponse.ok ? await weatherResponse.json() : null;
    const sunPayload = sunResponse.ok ? await sunResponse.json() : null;
    const sun = sunPayload?.results || sunPayload;
    const forecastText = String(nwsPeriod?.shortForecast || '');
    const rain = nwsObservation ? observationIsWet(nwsObservation) : Number(weather?.current?.precipitation) > 0 || /rain|shower|storm/i.test(forecastText);
    setCompanionEnvironment({ rain, sunny: /sunny|clear/i.test(`${forecastText} ${nwsObservation?.textDescription || ''}`) });
    const adjusted = nightAdjustedText(`${liveConditionsText(weather, sun, nwsPeriod)}${rainTimingText(nwsPeriods, weather?.timezone)}`, sun, nwsPeriod);
    target.classList.toggle('is-night', adjusted.night);
    target.innerHTML = weatherBriefHtml(adjusted.text, weather?.timezone, adjusted.night);
  } catch {
    target.innerHTML = weatherBriefHtml('Weather unavailable');
  }
}

export async function renderWeatherBrief() {
  const target = el('weatherBrief');
  if (!target) return;
  const file = CITIES[state.activeCity]?.weatherFile;
  target.innerHTML = weatherBriefHtml('Weather…');
  target.classList.remove('hidden');
  if (!file) { await refreshLiveConditions(); return; }
  try {
    const response = await fetch(file);
    const weather = response.ok ? await response.json() : null;
    if (!weather || Date.now() >= Date.parse(weather.freshnessExpiresAt || '')) { await refreshLiveConditions(); return; }
    const period = weather.forecast?.[0];
    const alert = weather.activeAlerts?.[0];
    const text = alert?.headline || alert?.event || (period ? `${period.name}: ${period.shortForecast}${period.temperature != null ? ` · ${period.temperature}°${period.temperatureUnit || ''}` : ''}${rainTimingText(weather.forecast || [period], weather?.timezone)}` : 'Forecast available');
    const sunResponse = await fetch(`https://api.sunrise-sunset.org/json?lat=${encodeURIComponent(CITIES[state.activeCity].center.lat)}&lng=${encodeURIComponent(CITIES[state.activeCity].center.lng)}&formatted=0`);
    const sunPayload = sunResponse.ok ? await sunResponse.json() : null;
    const sun = sunPayload?.results || sunPayload;
    const observation = await loadNwsObservation(Number(CITIES[state.activeCity].center.lat), Number(CITIES[state.activeCity].center.lng));
    const forecastText = `${alert?.event || ''} ${period?.shortForecast || ''}`;
    setCompanionEnvironment({ rain: observation ? observationIsWet(observation) : /rain|shower|storm/i.test(forecastText), sunny: /sunny|clear/i.test(`${forecastText} ${observation?.textDescription || ''}`) });
    const adjusted = nightAdjustedText(text, sun, period);
    target.classList.toggle('is-night', adjusted.night);
    target.innerHTML = weatherBriefHtml(adjusted.text, weather?.timezone, adjusted.night);
    target.classList.remove('hidden');
  } catch { target.innerHTML = weatherBriefHtml('Weather unavailable'); target.classList.remove('hidden'); }
}
