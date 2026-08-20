import { CITIES } from './constants.js';
import { state } from './state.js';
import { el, escapeHtml } from './utils.js';

export async function renderWeatherBrief() {
  const target = el('weatherBrief');
  const file = CITIES[state.activeCity]?.weatherFile;
  target.classList.add('hidden');
  if (!file) return;
  try {
    const response = await fetch(file);
    const weather = response.ok ? await response.json() : null;
    if (!weather || Date.now() >= Date.parse(weather.freshnessExpiresAt || '')) return;
    const period = weather.forecast?.[0];
    const alert = weather.activeAlerts?.[0];
    const text = alert?.headline || alert?.event || (period ? `${period.name}: ${period.shortForecast}${period.temperature != null ? ` · ${period.temperature}°${period.temperatureUnit || ''}` : ''}` : 'Forecast available');
    target.innerHTML = `${escapeHtml(text)} <a href="${escapeHtml(weather.source?.url || 'https://www.weather.gov')}" target="_blank" rel="noreferrer">NWS ↗</a>`;
    target.classList.remove('hidden');
  } catch { /* Local weather package is optional. */ }
}
