import { state } from './state.js';
import { CITIES } from './constants.js';
import { el } from './utils.js';
import { openSheet, toast } from './ui.js';
import { normalizeWalkPlan, paintWalkPlan, renderFieldGuide } from './field-guide.js';
import { parseFilterImport, flattenImportedFilters } from './layer-system.js';
import { normalizeCountyAddition, installCountyAddition, COUNTY_ADDITION_FORMAT } from './county-additions.js';
import { importJournalSubset, openPersonalSeal, reportOnlineError } from './online-pane.js';
import { unbase64url } from './cloud-journal.js';
import { regionApi } from './region-ui.js';
import { switchCity } from './city.js';

export function parseOpenPayload(input) {
  let value = input;
  if (typeof value === 'string') {
    value = value.trim().replace(/^\uFEFF/, '');
    if (value.length > 48 * 1024 * 1024) throw new Error('This file is too large to open safely.');
    if (/^(my sealed copy|sealed)$/i.test(value)) return { kind: 'seal', payload: null };
    if (value.startsWith('walk:')) value = new TextDecoder().decode(unbase64url(value.slice(5)));
    else if (/^learn\s+/i.test(value)) { const [, pack_id, place_id] = value.split(/\s+/); value = { pack_id, place_id }; }
    else if (/^area\s+/i.test(value)) { const [, pack_id, checksum] = value.split(/\s+/); value = { pack_id, checksum }; }
    if (typeof value === 'string') { try { value = JSON.parse(value); } catch { throw new Error('Use a walk phrase, area/learn pointer, invite, or supported JSON file.'); } }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Unsupported OPEN payload.');
  if (value.format === 'walk-wildlife-friend-invite-v1') return { kind: 'friend', payload: value };
  if (value.format === 'walk-wildlife-personal-seal-v1') return { kind: 'seal', payload: value };
  if (value.format === 'walk-wildlife-plan-v1') return { kind: 'plan', payload: normalizeWalkPlan(value) };
  if (['walk-wildlife-filters-v1', 'walk-wildlife-personal-places-v1'].includes(value.export_format)) return { kind: 'filters', payload: parseFilterImport(value) };
  if (value.additions && (value.additions.pois || value.additions.edges || value.export_format === COUNTY_ADDITION_FORMAT)) return { kind: 'addition', payload: value };
  if (value.pack_id && (value.learn_id || value.place_id)) return { kind: 'learn', payload: value };
  if (value.pack_id && typeof value.checksum === 'string') return { kind: 'area', payload: value };
  if (value.format === 'walk-wildlife-subset-v1' && value.journalPagesIncluded === true) return { kind: 'journal', payload: value };
  throw new Error('Unsupported format, or journal pages were not explicitly included.');
}
export function catalogueCityForPack(packId) {
  if (!/^[a-z0-9-]+$/i.test(packId || '')) return null;
  return Object.entries(CITIES).find(([id, pack]) => id === packId || pack.packId === packId || JSON.stringify(pack).includes(`./regions/${packId}/`))?.[0] || null;
}
let pending = null;
async function selectInstalledPack(packId, checksum) {
  const city = catalogueCityForPack(packId);
  if (!city) throw new Error('This area is not in the existing region catalogue.');
  const installed = await regionApi.discoverRegions();
  const candidates = [packId, ...JSON.stringify(CITIES[city]).matchAll(/\.\/regions\/([^/]+)\//g)].map((x) => typeof x === 'string' ? x : x[1]);
  const regionId = candidates.find((id) => installed.some((entry) => entry.id === id));
  if (!regionId) {
    el('openPayloadStatus').textContent = 'You are visiting this area. Install it first.';
    el('installOpenAreaButton').classList.remove('hidden');
    return false;
  }
  const region = await regionApi.loadRegion(regionId);
  if (checksum && !Object.values(region.metadata?.checksums || {}).includes(checksum)) throw new Error('Installed pack checksum does not match this pointer.');
  if (state.activeCity !== city) await switchCity(city);
  return true;
}
async function normalizeSidecar(payload) {
  if (payload.export_format === COUNTY_ADDITION_FORMAT) return normalizeCountyAddition(payload);
  const authority = payload.authority || { name: payload.source?.name || payload.name, officialUrl: payload.source?.officialUrl || payload.source?.url, license: payload.license };
  const source = (record) => ({ ...authority, ...(record.source || {}), license: record.source?.license || payload.license || authority.license });
  const body = { export_format: COUNTY_ADDITION_FORMAT, version: 1, id: payload.id, region_id: payload.pack_id, name: payload.name, created: payload.created, authority,
    additions: { points: (payload.additions.pois || []).map((record) => ({ ...record, source: source(record) })), lines: (payload.additions.edges || []).map((record) => ({ ...record, source: source(record) })) } };
  // Reject private fields in the original too, before normalizing away unknown keys.
  const forbidden = /"(?:gps_trace|gpstrace|tracks|track|observations|observation|photos|photo|audio|walks|journal)"\s*:/i;
  if (forbidden.test(JSON.stringify(payload))) throw new Error('County additions cannot contain GPS traces or journal media.');
  return normalizeCountyAddition(body, { verifyChecksum: false });
}
export async function openPayload(input, mode = el('joinModeSelect')?.value || 'add') {
  const parsed = parseOpenPayload(input); const value = parsed.payload;
  const packId = value?.pack_id || value?.region_id;
  if (packId && !await selectInstalledPack(packId, parsed.kind === 'area' ? value.checksum : null)) { pending = { input, mode, packId }; return; }
  el('installOpenAreaButton')?.classList.add('hidden');
  if (parsed.kind === 'plan') paintWalkPlan({ ...value, pack_id: state.activeCity });
  if (parsed.kind === 'filters') {
    const filters = flattenImportedFilters(value.filters);
    Object.assign(state.layerFilters.public, filters.public); Object.assign(state.layerFilters.personal, filters.personal);
    if (value.lights) Object.assign(state.layerLights, value.lights);
    else { state.layerLights.news = filters.public.event !== false; state.layerLights.recreation = true; state.layerLights.cuisine = true; state.layerLights.personal = true; }
    if (value.personal_places_data?.length) {
      const { upsertImportedPersonalData } = await import('./personal-places.js');
      await upsertImportedPersonalData(value.personal_place_categories || [], value.personal_places_data, mode === 'join' ? 'merge' : 'skip');
    }
    window.dispatchEvent(new CustomEvent('layer-state-dirty'));
  }
  if (parsed.kind === 'addition') await installCountyAddition(await normalizeSidecar(value), { mode });
  if (parsed.kind === 'journal') await importJournalSubset(value, mode);
  if (parsed.kind === 'seal') await openPersonalSeal(value);
  if (parsed.kind === 'friend') { const { joinFriendWalk } = await import('./friend-walk.js'); await joinFriendWalk(value); }
  if (parsed.kind === 'learn') {
    openSheet('backpackSheet'); await renderFieldGuide('learn');
    const targetId = value.place_id || state.fieldGuideData?.learn?.find((card) => card.id === value.learn_id)?.placeId;
    const row = [...document.querySelectorAll('[data-learn-place]')].find((node) => node.dataset.learnPlace === String(targetId));
    if (!row) throw new Error('That Learn point has no public source in this pack.');
    row.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  if (el('openPayloadStatus')) el('openPayloadStatus').textContent = 'Opened. Unchecked/private device data was not replaced.';
}
let scannerStream = null, scanTimer = null, scanEpoch = 0;
export function stopQrScan() {
  scanEpoch += 1;
  clearTimeout(scanTimer); scannerStream?.getTracks().forEach((track) => track.stop()); scannerStream = null;
  if (el('qrScanVideo')) el('qrScanVideo').srcObject = null;
  el('qrScanPanel')?.classList.add('hidden');
}
async function scanQr() {
  if (!globalThis.BarcodeDetector) { el('openPhraseInput').focus(); toast('QR scanning is unavailable. Paste the phrase instead.'); return; }
  stopQrScan();
  const epoch = scanEpoch;
  const detector = new BarcodeDetector({ formats: ['qr_code'] });
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
  if (epoch !== scanEpoch) { stream.getTracks().forEach((track) => track.stop()); return; }
  scannerStream = stream;
  const video = el('qrScanVideo'); video.srcObject = scannerStream;
  el('qrScanPanel').classList.remove('hidden'); await video.play();
  const scan = async () => {
    if (!scannerStream) return;
    try { const codes = await detector.detect(video); if (codes[0]?.rawValue) { const text = codes[0].rawValue; stopQrScan(); await openPayload(text); return; } }
    catch (error) { stopQrScan(); reportOnlineError(error); return; }
    scanTimer = setTimeout(scan, 300);
  };
  void scan();
}
export function initOpenControls() {
  el('openPhraseForm')?.addEventListener('submit', (event) => { event.preventDefault(); void openPayload(el('openPhraseInput').value).catch(reportOnlineError); });
  el('openFileInput')?.addEventListener('change', async (event) => { const file = event.target.files?.[0]; event.target.value = ''; if (!file) return; try { await openPayload(await file.text()); } catch (error) { reportOnlineError(error); } });
  el('openQrButton')?.addEventListener('click', () => void scanQr().catch((error) => { stopQrScan(); reportOnlineError(error); }));
  el('stopQrButton')?.addEventListener('click', stopQrScan);
  window.addEventListener('map-overlay-changed', ({ detail }) => { if (!detail.open || detail.id !== 'backpackSheet') stopQrScan(); });
  window.addEventListener('guide-tab-changed', ({ detail }) => { if (detail.tab !== 'online') stopQrScan(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopQrScan(); });
  el('installOpenAreaButton')?.addEventListener('click', async () => {
    if (!pending) return;
    try {
      if (navigator.onLine === false) throw new Error('Install requires a connection. The current pack stays open.');
      const request = pending;
      const city = catalogueCityForPack(request.packId);
      const regionId = JSON.stringify(CITIES[city]).match(/\.\/regions\/([^/]+)\//)?.[1] || CITIES[city]?.packId || request.packId;
      const region = await regionApi.installRegion(regionId);
      if (!region) throw new Error('This catalogue area has no installable tiles yet.');
      pending = null; await openPayload(request.input, request.mode);
    } catch (error) { reportOnlineError(error); }
  });
}
