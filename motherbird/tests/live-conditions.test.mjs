import assert from 'node:assert/strict';
import test from 'node:test';
import { liveConditionsText } from '../js/weather.js';

test('live conditions summarize weather, daylight, and the official forecast without user coordinates', () => {
  const result = liveConditionsText({ current: { temperature_2m: 26.4, apparent_temperature: 28.2, uv_index: 7.1, precipitation: 0.4 } }, { results: { sunset: '2026-08-20T23:00:00+00:00' } }, { shortForecast: 'Partly Cloudy' });
  assert.match(result, /26°C/); assert.match(result, /feels 28°C/); assert.match(result, /UV 7/); assert.match(result, /0.4 mm rain now/); assert.match(result, /sunset/); assert.match(result, /Partly Cloudy/);
});
