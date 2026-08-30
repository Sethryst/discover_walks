import { state } from './state.js';
import { CITIES, DEFAULT_SETTINGS } from './constants.js';
import { dayKey, normalizeProfile, el, escapeHtml } from './utils.js';
import db from './storage.js';
import { createMigratedProfile } from './loader.js';
import { refreshCityMap } from './city.js';
import { closeSheets, toast } from './ui.js';
import { renderArchive } from './archive.js';
import {
  JOURNAL_TRANSFER_STORES,
  createJournalBackup,
  journalBackupToCsv,
  mergeJournalData,
  normalizeJournalBackup,
  previewJournalImport
} from './journal-transfer.js';

let pendingImport = null;

async function readLocalTransferData() {
  const entries = await Promise.all(JOURNAL_TRANSFER_STORES.map(async (store) => {
    if (store === 'profile') return [store, [await db.get('profile', 'local-user')].filter(Boolean)];
    if (store === 'settings') return [store, [await db.get('settings', 'app-settings')].filter(Boolean)];
    return [store, await db.all(store)];
  }));
  return Object.fromEntries(entries);
}

function downloadFile(contents, type, filename) {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url);
}

export async function exportJournal(format = 'json') {
  const backup = createJournalBackup(await readLocalTransferData());
  if (format === 'csv') downloadFile(journalBackupToCsv(backup), 'text/csv;charset=utf-8', `walk-wildlife-journal-${dayKey()}.csv`);
  else downloadFile(JSON.stringify(backup, null, 2), 'application/json', `walk-wildlife-journal-${dayKey()}.json`);
  toast(format === 'csv' ? 'Readable journal CSV downloaded.' : 'Complete journal backup downloaded.');
}

function conflictLabel(conflict) {
  return conflict.local.title || conflict.local.name || conflict.local.species || conflict.incoming.title || conflict.incoming.name || conflict.incoming.species || conflict.id;
}

function renderImportPreview(fileName, preview) {
  const panel = el('journalImportPreview');
  panel.classList.remove('hidden');
  const collectionRows = Object.entries(preview.stores).filter(([, counts]) => counts.incoming).map(([store, counts]) => `<li><strong>${escapeHtml(store.replaceAll('_', ' '))}</strong><span>${counts.additions} new · ${counts.identical} already here · ${counts.conflicts} to review</span></li>`).join('');
  const conflictRows = preview.conflicts.slice(0, 30).map((conflict) => `<label data-import-conflict="${escapeHtml(conflict.key)}"><span>${escapeHtml(conflictLabel(conflict))}<small>${escapeHtml(conflict.store.replaceAll('_', ' '))}</small></span><select><option value="local">Keep this device’s copy</option><option value="incoming">Use imported copy</option></select></label>`).join('');
  panel.innerHTML = `<div class="import-preview-heading"><span>IMPORT PREVIEW</span><strong>${escapeHtml(fileName)}</strong><p>Nothing has changed yet. Merge adds new records and keeps this device’s version wherever the same ID differs.</p></div><ul>${collectionRows}</ul>${preview.conflictCount ? `<details class="import-conflicts" open><summary>Review ${preview.conflictCount} conflict${preview.conflictCount === 1 ? '' : 's'}</summary>${conflictRows}${preview.conflictCount > 30 ? `<p>${preview.conflictCount - 30} more conflicts will keep this device’s copy.</p>` : ''}</details>` : '<p class="import-no-conflicts">No conflicts need review.</p>'}<div class="backup-actions"><button class="primary-button" id="mergeJournalImportButton" type="button">Merge into this journal</button><button class="text-button" id="cancelJournalImportButton" type="button">Cancel</button></div><details class="replace-import"><summary>Advanced: replace this device</summary><p>Replace clears local journal records before restoring this file. Export a backup first if you may want to undo it.</p><label><input id="confirmReplaceJournal" type="checkbox" /> I understand current local journal data will be removed.</label><button class="danger-button" id="replaceJournalImportButton" type="button" disabled>Replace local journal</button></details>`;
  el('mergeJournalImportButton').addEventListener('click', () => void applyPendingImport('merge'));
  el('cancelJournalImportButton').addEventListener('click', clearImportPreview);
  el('confirmReplaceJournal').addEventListener('change', (event) => { el('replaceJournalImportButton').disabled = !event.target.checked; });
  el('replaceJournalImportButton').addEventListener('click', () => void applyPendingImport('replace'));
}

function clearImportPreview() {
  pendingImport = null;
  const panel = el('journalImportPreview');
  panel.classList.add('hidden'); panel.replaceChildren();
}

function selectedConflictResolutions() {
  return Object.fromEntries([...document.querySelectorAll('[data-import-conflict]')].map((row) => [row.dataset.importConflict, row.querySelector('select').value]));
}

async function writeTransferData(data, { replace = false } = {}) {
  if (replace) await db.clearAll();
  for (const store of JOURNAL_TRANSFER_STORES) {
    for (const item of data[store] || []) await db.put(store, item);
  }
  state.profile = normalizeProfile(data.profile?.[0] || await createMigratedProfile());
  state.settings = { ...DEFAULT_SETTINGS, ...(data.settings?.[0] || {}) };
  if (!CITIES[state.settings.activeCity]) state.settings.activeCity = 'fairfax';
  state.activeCity = state.settings.activeCity;
  state.walks = data.walks || [];
  state.observations = data.observations || [];
  state.moments = data.moments || [];
  state.personalPlaces = data.personal_places || [];
  state.personalPlaceCategories = data.personal_place_categories || [];
  await Promise.all([db.put('profile', state.profile), db.put('settings', state.settings)]);
  await refreshCityMap(true);
  await renderArchive();
  window.dispatchEvent(new CustomEvent('personal-places-changed'));
}

async function applyPendingImport(mode) {
  if (!pendingImport) return;
  if (mode === 'replace' && !confirm('Replace this device’s current journal with the previewed backup? This removes the current local copy.')) return;
  const local = await readLocalTransferData();
  const result = mode === 'replace'
    ? { data: pendingImport.backup.data, applied: { added: Object.values(pendingImport.backup.data).reduce((total, items) => total + items.length, 0) } }
    : mergeJournalData(local, pendingImport.backup.data, selectedConflictResolutions());
  await writeTransferData(result.data, { replace: mode === 'replace' });
  clearImportPreview(); closeSheets();
  toast(mode === 'replace' ? 'Journal replaced from the reviewed backup.' : `Journal merged · ${result.applied.added} new record${result.applied.added === 1 ? '' : 's'} added.`);
}

export async function importJournal(event) {
  const file = event.target.files[0]; event.target.value = ''; if (!file) return;
  try {
    const backup = normalizeJournalBackup(JSON.parse(await file.text()));
    const local = await readLocalTransferData();
    const preview = previewJournalImport(local, backup.data);
    pendingImport = { backup, preview, fileName: file.name };
    renderImportPreview(file.name, preview);
  } catch (error) { toast(error.message || 'That backup could not be previewed.'); }
}

export function initBackupControls() {
  const panel = document.createElement('div'); panel.className = 'backup-controls';
  panel.innerHTML = '<p class="sheet-kicker">YOUR BACKUP</p><p>Export a complete private backup or a readable CSV. Import starts with a preview; Merge preserves this device by default.</p><div class="backup-actions"><button class="secondary-button" id="exportDataButton" type="button">Export JSON</button><button class="secondary-button" id="exportCsvButton" type="button">Export CSV</button><label class="secondary-button import-label">Preview import<input id="importDataInput" type="file" accept="application/json,.json" /></label></div><section class="journal-import-preview hidden" id="journalImportPreview" aria-live="polite"></section>';
  el('clearDataButton').before(panel);
  el('exportDataButton').addEventListener('click', () => void exportJournal('json'));
  el('exportCsvButton').addEventListener('click', () => void exportJournal('csv'));
  el('importDataInput').addEventListener('change', importJournal);
}
