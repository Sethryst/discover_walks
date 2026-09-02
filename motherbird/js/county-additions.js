import { state } from './state.js';
import { CITIES } from './constants.js';
import { migratePoi, renderCityPois } from './poi.js';
import { el } from './utils.js';
import { toast } from './ui.js';
import db from './storage.js';

export const COUNTY_ADDITION_FORMAT = 'walk-wildlife-county-addition-v1';
const FORBIDDEN_KEYS = new Set(['walks', 'walk', 'journal', 'moments', 'observations', 'observation', 'photo', 'photos', 'audio', 'voice_notes', 'gpstrace', 'gps_trace', 'track', 'tracks']);

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
}

function transferableBody(payload) {
  const { checksum: _checksum, installedAt: _installedAt, ...body } = payload;
  return stable(body);
}

async function sha256(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(transferableBody(value)));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return `sha256:${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

function assertNoPrivateKeys(value, path = 'addition') {
  if (Array.isArray(value)) return value.forEach((item, index) => assertNoPrivateKeys(item, `${path}[${index}]`));
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key.toLocaleLowerCase())) throw new Error(`County additions cannot contain private ${key} data.`);
    assertNoPrivateKeys(child, `${path}.${key}`);
  }
}

function validSource(source) {
  return source && String(source.name || '').trim() && /^https:\/\//i.test(source.officialUrl || source.url || '') && String(source.license || '').trim();
}

function normalizePoint(point) {
  const lat = Number(point.lat ?? point.latitude);
  const lng = Number(point.lng ?? point.longitude);
  if (!point.id || !String(point.name || '').trim() || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || !validSource(point.source)) {
    throw new Error('Every county point needs an id, public name, valid coordinates, official source URL, and license.');
  }
  return { id: String(point.id), name: String(point.name).trim(), lat, lng, category: String(point.category || 'community'), tags: [...new Set((point.tags || []).map(String))], source: { name: String(point.source.name), officialUrl: String(point.source.officialUrl || point.source.url), license: String(point.source.license) } };
}

function normalizeLine(line) {
  const geometry = line.geometry || {};
  if (!line.id || !String(line.name || '').trim() || !['LineString', 'MultiLineString'].includes(geometry.type) || !Array.isArray(geometry.coordinates) || !validSource(line.source)) {
    throw new Error('Every county line needs an id, public name, LineString geometry, official source URL, and license.');
  }
  return { id: String(line.id), name: String(line.name).trim(), category: String(line.category || 'trail'), geometry: { type: geometry.type, coordinates: geometry.coordinates }, source: { name: String(line.source.name), officialUrl: String(line.source.officialUrl || line.source.url), license: String(line.source.license) } };
}

export async function normalizeCountyAddition(input, { verifyChecksum = true } = {}) {
  const payload = typeof input === 'string' ? JSON.parse(input) : structuredClone(input);
  assertNoPrivateKeys(payload);
  if (payload?.export_format !== COUNTY_ADDITION_FORMAT || !payload.id || !payload.region_id || !payload.name || !validSource(payload.authority)) throw new Error('Choose a valid county addition file with authority and license details.');
  const normalized = {
    export_format: COUNTY_ADDITION_FORMAT,
    version: 1,
    id: String(payload.id), region_id: String(payload.region_id), name: String(payload.name),
    created: payload.created || new Date().toISOString(),
    authority: { name: String(payload.authority.name), officialUrl: String(payload.authority.officialUrl || payload.authority.url), license: String(payload.authority.license) },
    additions: { points: (payload.additions?.points || []).map(normalizePoint), lines: (payload.additions?.lines || []).map(normalizeLine) }
  };
  if (!normalized.additions.points.length && !normalized.additions.lines.length) throw new Error('The county addition is empty.');
  const expected = await sha256(normalized);
  if (verifyChecksum && payload.checksum !== expected) throw new Error('County addition checksum does not match its public contents.');
  return { ...normalized, checksum: expected };
}

function activeRuntimeRegionId() {
  const pathMatch = String(CITIES[state.activeCity]?.dataFile || '').match(/\.\/regions\/([^/]+)\//)?.[1];
  return state.regionAutomation?.activeRegionId || pathMatch || state.activeCity;
}

function lineCoordinates(line) {
  return line.geometry.type === 'LineString' ? [line.geometry.coordinates] : line.geometry.coordinates;
}

export async function activateCountyAdditions(cityId = state.activeCity) {
  const regionId = activeRuntimeRegionId();
  const installed = await db.all('county_additions');
  const active = installed.filter((addition) => addition.region_id === regionId || addition.region_id === cityId);
  const cleanPois = (state.cityPois[cityId] || []).filter((poi) => !poi.countyAdditionId);
  const points = active.flatMap((addition) => addition.additions.points.map((point) => migratePoi({ ...point, id: `addition:${addition.id}:${point.id}`, countyAdditionId: addition.id, sourceType: 'county-addition' }, cityId)));
  state.cityPois[cityId] = [...cleanPois, ...points];
  const cleanLines = (state.trailSegments[cityId] || []).filter((line) => !line.countyAdditionId);
  const lines = active.flatMap((addition) => addition.additions.lines.map((line) => ({ id: `addition:${addition.id}:${line.id}`, name: line.name, coordinates: lineCoordinates(line), source: [line.source], countyAdditionId: addition.id })));
  state.trailSegments[cityId] = [...cleanLines, ...lines];
  renderCityPois();
  return active;
}

export async function installCountyAddition(input) {
  if (!state.regionAutomation?.activeRegionId) throw new Error('Install and select the matching official region pack first.');
  const addition = await normalizeCountyAddition(input);
  if (![state.activeCity, activeRuntimeRegionId()].includes(addition.region_id)) throw new Error(`This addition is for ${addition.region_id}, not the selected installed pack.`);
  await db.put('county_additions', { ...addition, installedAt: new Date().toISOString() });
  await activateCountyAdditions();
  window.dispatchEvent(new CustomEvent('city-layer-data-changed'));
  return addition;
}

async function shareAddition(addition) {
  const normalized = await normalizeCountyAddition(addition, { verifyChecksum: false });
  const file = new File([JSON.stringify(normalized, null, 2)], `${normalized.id}.walkfilter`, { type: 'application/json' });
  if (navigator.share && navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ title: normalized.name, files: [file] }); return; }
    catch (error) { if (error?.name === 'AbortError') return; }
  }
  const url = URL.createObjectURL(file);
  const link = document.createElement('a'); link.href = url; link.download = file.name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function initCountyAdditions() {
  await activateCountyAdditions();
  el('countyAdditionImportInput')?.addEventListener('change', async (event) => {
    const file = event.target.files?.[0];
    try { if (file) { const addition = await installCountyAddition(await file.text()); toast(`${addition.name} installed locally.`); } }
    catch (error) { toast(error.message || 'That county addition could not be installed.'); }
    event.target.value = '';
  });
  el('exportCountyAdditionButton')?.addEventListener('click', async () => {
    const additions = (await db.all('county_additions')).filter((item) => [state.activeCity, activeRuntimeRegionId()].includes(item.region_id));
    if (!additions.length) { toast('No county addition is installed for this pack.'); return; }
    await shareAddition(additions.sort((a, b) => String(b.installedAt).localeCompare(String(a.installedAt)))[0]);
  });
}

