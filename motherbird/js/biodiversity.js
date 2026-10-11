import { state } from './state.js';
import { db } from './storage.js';
import { BIODIVERSITY_BY_CITY } from './biodiversity-registry.js';

const recordsPromises = new Map();
const preferencesPromises = new Map();
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const key = (region, record) => `${region}::${record}`;
const groups = [
  ['seasonal', 'Seasonal notices', 'What the source records say about the selected month.', () => true],
  ['plants', 'Plants', 'Leaves, flowers, fruits, and other rooted life.', (r) => r.kingdom === 'Plantae'],
  ['animals', 'Animals', 'Birds, mammals, insects, and other moving life.', (r) => r.kingdom === 'Animalia'],
  ['other', 'Fungi & other life', 'Fungi and records outside the main groupings.', (r) => !['Plantae', 'Animalia'].includes(r.kingdom)]
];

export const NOVA_BIODIVERSITY_REGIONS = new Set(['alexandria', 'arlington', 'fairfax', 'falls-church', 'loudoun', 'vienna']);
export const PUBLISHED_BIODIVERSITY_REGIONS = new Set([...BIODIVERSITY_BY_CITY].filter(([, region]) => region.releaseState !== 'gated').map(([cityId]) => cityId));
export function biodiversityRegion(regionId = state.activeCity) { return BIODIVERSITY_BY_CITY.get(String(regionId || '')); }
export function isBiodiversitySupported(regionId = state.activeCity) { const region = biodiversityRegion(regionId); return Boolean(region && region.releaseState !== 'gated'); }
export function biodiversityDataUrl(regionId = state.activeCity) { return `./${biodiversityRegion(regionId)?.sidecarPath || `regions/${regionId}/biodiversity/records.json`}`; }
export async function loadBiodiversity(regionId = state.activeCity) {
  if (!isBiodiversitySupported(regionId)) throw new Error('No biodiversity release is available for this area.');
  if (!recordsPromises.has(regionId)) recordsPromises.set(regionId, fetch(biodiversityDataUrl(regionId)).then((r) => { if (!r.ok) throw new Error('No biodiversity sidecar for this region'); return r.json(); }));
  return recordsPromises.get(regionId);
}
async function preferences(regionId) {
  if (!preferencesPromises.has(regionId)) preferencesPromises.set(regionId, db.all('biodiversity_preferences').then((rows) => new Map(rows.filter((r) => r.regionId === regionId).map((r) => [r.recordId, r]))));
  return preferencesPromises.get(regionId);
}
async function savePreference(regionId, recordId, patch) {
  const map = await preferences(regionId);
  const next = { id: key(regionId, recordId), regionId, recordId, ...(map.get(recordId) || {}), ...patch, updatedAt: new Date().toISOString() };
  map.set(recordId, next); await db.put('biodiversity_preferences', next); return next;
}
function filtered(data, prefs, filters) {
  const query = filters.query.toLowerCase();
  return data.records.filter((r) => filters.showHidden || !prefs.get(r.recordId)?.hidden)
    .filter((r) => state.layerFilters?.public?.[biodiversityCategoryFor(r)] !== false)
    .filter((r) => filters.month === 'all' || r.month === Number(filters.month))
    .filter((r) => filters.group === 'all' || r.kingdom === filters.group)
    .filter((r) => !query || `${r.commonName || ''} ${r.scientificName} ${r.kingdom || ''}`.toLowerCase().includes(query))
    .sort((a, b) => filters.sort === 'name' ? (a.commonName || a.scientificName).localeCompare(b.commonName || b.scientificName) : filters.sort === 'month' ? a.month - b.month || b.observationCount - a.observationCount : b.observationCount - a.observationCount || a.scientificName.localeCompare(b.scientificName));
}
export function biodiversityCategoryFor(record) {
  const value = String(record?.class || '').toLowerCase();
  if (value === 'aves') return 'biodiversity:birds';
  if (value === 'mammalia') return 'biodiversity:mammals';
  if (value === 'insecta' || value === 'arachnida' || value === 'malacostraca') return 'biodiversity:insects';
  if (value === 'testudines' || value === 'reptilia' || value === 'amphibia') return 'biodiversity:reptiles';
  if (String(record?.kingdom) === 'Plantae') return 'biodiversity:plants';
  if (String(record?.kingdom) === 'Fungi' || /lichen/i.test(String(record?.class || ''))) return 'biodiversity:fungi';
  return 'biodiversity:other';
}
function card(record, pref) {
  const title = pref?.title || record.commonName || record.scientificName;
  const image = pref?.photoDataUrl || record.representativeImage?.url;
  return `<article class="biodiversity-card ${pref?.hidden ? 'is-hidden-record' : ''}"><div class="biodiversity-card-media">${image ? `<img loading="lazy" src="${esc(image)}" alt="${esc(title)}">` : '<span class="biodiversity-card-placeholder" aria-hidden="true">🌿</span>'}</div><section><div class="biodiversity-card-heading"><div><h4>${esc(title)}</h4><em>${esc(record.scientificName)}</em></div><button class="icon-button" type="button" data-biodiversity-edit="${esc(record.recordId)}" aria-label="Edit ${esc(title)}">✎</button></div><p>${record.observationCount} historical/community record${record.observationCount === 1 ? '' : 's'} · month ${record.month}</p><small>Source: ${esc(record.source.provider)} · ${esc(record.representativeImage?.license || 'image license unavailable')}</small>${pref?.note ? `<p class="biodiversity-local-note">${esc(pref.note)}</p>` : ''}<div class="biodiversity-card-actions"><button class="text-button" type="button" data-biodiversity-edit="${esc(record.recordId)}">Edit local card</button><button class="text-button" type="button" data-biodiversity-hide="${esc(record.recordId)}">${pref?.hidden ? 'Show in Nature' : 'Hide from Nature'}</button></div></section></article>`;
}
function grouped(records, prefs) {
  if (!records.length) return '<p class="empty-state">No records match these Nature filters.</p>';
  return groups.map(([id, label, description, match]) => { const rows = records.filter(match); return rows.length ? `<section class="biodiversity-learn-group" data-biodiversity-group-section="${id}"><header><div><p class="learn-kicker">Learn · ${label}</p><h4>${label}</h4><p>${description}</p></div><span>${rows.length}</span></header><div class="biodiversity-cards">${rows.map((r) => card(r, prefs.get(r.recordId))).join('')}</div></section>` : ''; }).join('');
}
function editor(record, pref) {
  return `<dialog class="biodiversity-editor" data-biodiversity-editor="${esc(record.recordId)}"><form method="dialog"><header><div><p class="learn-kicker">Private on this device</p><h3>Edit Nature card</h3><p>${esc(record.commonName || record.scientificName)}</p></div><button class="icon-button" value="cancel" aria-label="Close editor">×</button></header><label>Local title<input name="title" value="${esc(pref?.title || '')}" placeholder="Keep source name"></label><label>Private note<textarea name="note" rows="3" placeholder="What do you want to notice?">${esc(pref?.note || '')}</textarea></label><label class="biodiversity-photo-picker">Add a local photo<input name="photo" type="file" accept="image/*"><small>Stored only in this browser until explicitly exported.</small></label>${pref?.photoDataUrl ? `<img class="biodiversity-editor-photo" src="${esc(pref.photoDataUrl)}" alt="Your local Nature photo"><label><input type="checkbox" name="removePhoto"> Remove local photo</label>` : ''}<label><input type="checkbox" name="hidden" ${pref?.hidden ? 'checked' : ''}> Hide this card from Nature</label><footer><button class="secondary-button" value="cancel">Cancel</button><button class="primary-button" value="save">Save local card</button></footer></form></dialog>`;
}
function readFile(file) { return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(reader.error); reader.readAsDataURL(file); }); }
export function buildEncounterExport({ photo = null, timestamp = new Date().toISOString(), coordinates = null, tentativeTaxon = null, notes = '' } = {}) { return { schemaVersion: 'motherbird-inaturalist-handoff-v1', createdAt: new Date().toISOString(), photo, timestamp, coordinates, tentativeTaxon, notes, handoff: { destination: 'iNaturalist', posting: 'manual', oauth: false, jwtStored: false, geoprivacy: 'choose in iNaturalist' } }; }
export function initBiodiversity() { /* Nature renders when its guide tab is opened. */ }

export async function renderBiodiversityGuide(target) {
  target.innerHTML = `<section class="biodiversity-guide"><p class="learn-kicker">Nature · local field guide</p><h3>Nature recorded here</h3><p class="biodiversity-warning">Historical/community records are not guarantees of current presence. Identification is not food-safety advice; never consume a plant or fungus based only on this app.</p><button class="secondary-button" type="button" data-biodiversity-load>Open regional Nature</button><div data-biodiversity-status aria-live="polite">Static layer loads only when opened.</div><div data-biodiversity-workspace hidden><div class="biodiversity-controls" data-biodiversity-controls></div><div class="biodiversity-summary" data-biodiversity-summary></div><div data-biodiversity-cards></div></div><details><summary>Export a personal encounter to iNaturalist</summary><form id="biodiversityExportForm"><label>Timestamp<input name="timestamp" type="datetime-local"></label><label>Tentative taxon<input name="tentativeTaxon" placeholder="Optional"></label><label>Notes<textarea name="notes" rows="2"></textarea></label><button class="secondary-button" type="submit">Download handoff</button></form></details></section>`;
  const host = target.querySelector('.biodiversity-guide'); const regionId = state.activeCity; const button = host.querySelector('[data-biodiversity-load]');
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      const [data, prefs] = await Promise.all([loadBiodiversity(regionId), preferences(regionId)]); const filters = { month: 'all', group: 'all', sort: 'count', query: '', showHidden: false }; const workspace = host.querySelector('[data-biodiversity-workspace]'); workspace.hidden = false;
      host.querySelector('[data-biodiversity-controls]').innerHTML = `<label>Month<select data-biodiversity-month><option value="all">Any month</option>${Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}">${i + 1}</option>`).join('')}</select></label><label>Group<select data-biodiversity-group><option value="all">All groups</option><option value="Plantae">Plants</option><option value="Animalia">Animals</option><option value="Fungi">Fungi</option></select></label><label>Sort<select data-biodiversity-sort><option value="count">Most recorded</option><option value="name">Name</option><option value="month">Month</option></select></label><label class="biodiversity-search">Find<input data-biodiversity-search placeholder="Species or group"></label><label class="biodiversity-toggle"><input type="checkbox" data-biodiversity-show-hidden> Show hidden</label>`;
      const update = () => { const rows = filtered(data, prefs, filters); const metadata = data.metadata || {}; host.querySelector('[data-biodiversity-summary]').innerHTML = `<strong>${rows.length} visible of ${data.records.length} regional cards</strong> · ${prefs.size} local edits <span class="coverage-badge coverage-badge--${esc(metadata.coverageClass || 'sparse')}">${esc(metadata.coverageLabel || 'Coverage not rated')}</span><br><small>${esc(metadata.freshnessLabel || `Source vintage: ${metadata.sourceVintage || 'unknown'}`)}</small>`; host.querySelector('[data-biodiversity-cards]').innerHTML = grouped(rows, prefs); host.querySelector('[data-biodiversity-status]').textContent = [metadata.sourceAccess, metadata.coverageLabel, metadata.freshnessLabel, 'local edits stay on this device'].filter(Boolean).join(' · '); };
      host.querySelector('[data-biodiversity-controls]').addEventListener('change', (event) => { const el = event.target; if (el.matches('[data-biodiversity-month]')) filters.month = el.value; if (el.matches('[data-biodiversity-group]')) filters.group = el.value; if (el.matches('[data-biodiversity-sort]')) filters.sort = el.value; if (el.matches('[data-biodiversity-show-hidden]')) filters.showHidden = el.checked; update(); });
      host.querySelector('[data-biodiversity-search]').addEventListener('input', (event) => { filters.query = event.target.value; update(); });
      host.addEventListener('click', async (event) => { const hide = event.target.closest('[data-biodiversity-hide]'); if (hide) { const id = hide.dataset.biodiversityHide; const next = await savePreference(regionId, id, { hidden: !prefs.get(id)?.hidden }); prefs.set(id, next); update(); return; } const edit = event.target.closest('[data-biodiversity-edit]'); if (!edit) return; const record = data.records.find((r) => r.recordId === edit.dataset.biodiversityEdit); if (!record) return; host.insertAdjacentHTML('beforeend', editor(record, prefs.get(record.recordId))); const dialog = host.querySelector(`[data-biodiversity-editor="${CSS.escape(record.recordId)}"]`); dialog.showModal(); dialog.querySelector('form').addEventListener('submit', async (submitEvent) => { if (submitEvent.submitter?.value !== 'save') { dialog.remove(); return; } submitEvent.preventDefault(); const form = submitEvent.currentTarget; const photo = form.photo.files?.[0] ? await readFile(form.photo.files[0]) : null; const next = await savePreference(regionId, record.recordId, { title: form.title.value.trim(), note: form.note.value.trim(), hidden: form.hidden.checked, ...(form.removePhoto?.checked ? { photoDataUrl: null } : photo ? { photoDataUrl: photo } : {}) }); prefs.set(record.recordId, next); dialog.close(); dialog.remove(); update(); }); }); update();
    } catch (error) { host.querySelector('[data-biodiversity-status]').textContent = `Nature layer unavailable: ${error.message}`; }
  });
  host.querySelector('#biodiversityExportForm').addEventListener('submit', (event) => { event.preventDefault(); const form = event.currentTarget; const blob = new Blob([JSON.stringify(buildEncounterExport({ timestamp: form.timestamp.value, tentativeTaxon: form.tentativeTaxon.value, notes: form.notes.value }), null, 2)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `inaturalist-encounter-${Date.now()}.json`; a.click(); });
}
globalThis.document?.getElementById('biodiversityLayer')?.classList.remove('hidden');
