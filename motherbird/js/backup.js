import { state } from './state.js';
import { CITIES, DEFAULT_SETTINGS, DEFAULT_CITY_ID } from './constants.js';
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
import {
  CLOUD_JOURNAL_SCHEMA_VERSION,
  decryptJournalBackup,
  encryptJournalBackup,
  journalPayloadFromBytea,
  journalPayloadToBytea
} from './cloud-journal.js';

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
  if (!CITIES[state.settings.activeCity]?.dataFile) state.settings.activeCity = DEFAULT_CITY_ID;
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
    await stageJournalImport(backup, file.name);
  } catch (error) { toast(error.message || 'That backup could not be previewed.'); }
}

async function stageJournalImport(backup, fileName) {
  const local = await readLocalTransferData();
  const preview = previewJournalImport(local, backup.data);
  pendingImport = { backup, preview, fileName };
  renderImportPreview(fileName, preview);
}

function cloudBackupReady() {
  return Boolean(state.online.client && state.online.session && state.online.fieldEditionVerified && state.settings?.entitlements?.cloudJournalBackup);
}

function cloudPassphrase() {
  const value = el('cloudBackupPassphrase')?.value || '';
  if (value.length < 8) throw new Error('Enter your cloud backup passphrase (at least 8 characters).');
  return value;
}

function setCloudBackupBusy(busy) {
  for (const id of ['saveCloudBackupButton', 'restoreCloudBackupButton']) {
    const button = el(id); if (button) button.disabled = busy || !cloudBackupReady();
  }
}

export function renderCloudBackupControls() {
  const status = el('cloudBackupStatus'); if (!status) return;
  const ready = cloudBackupReady();
  status.textContent = ready
    ? (state.online.cloudBackupCreatedAt ? `Field Edition active · backup saved ${new Date(state.online.cloudBackupCreatedAt).toLocaleString()}` : 'Field Edition active · ready for an encrypted backup')
    : 'Sign in with an active Field Edition subscription to use encrypted cloud backup.';
  setCloudBackupBusy(false);
}

export async function saveCloudJournalBackup() {
  if (!cloudBackupReady()) throw new Error('Cloud backup requires a signed-in Field Edition subscription.');
  const passphrase = cloudPassphrase();
  setCloudBackupBusy(true);
  try {
    const backup = createJournalBackup(await readLocalTransferData());
    const payload = await encryptJournalBackup(backup, passphrase);
    const client = state.online.client; const userId = state.online.session.user.id;
    const { error: deleteError } = await client.from('journal_backups').delete().eq('user_id', userId);
    if (deleteError) throw deleteError;
    const { data, error } = await client.from('journal_backups').insert({
      user_id: userId,
      schema_version: CLOUD_JOURNAL_SCHEMA_VERSION,
      byte_size: payload.byteLength,
      payload: journalPayloadToBytea(payload)
    }).select('created_at').single();
    if (error) throw error;
    state.online.cloudBackupCreatedAt = data?.created_at || new Date().toISOString();
    renderCloudBackupControls();
    toast('Encrypted Field Edition backup saved.');
  } finally { setCloudBackupBusy(false); }
}

export async function restoreCloudJournalBackup() {
  if (!cloudBackupReady()) throw new Error('Cloud backup requires a signed-in Field Edition subscription.');
  const passphrase = cloudPassphrase();
  setCloudBackupBusy(true);
  try {
    const userId = state.online.session.user.id;
    const { data, error } = await state.online.client.from('journal_backups')
      .select('created_at,schema_version,byte_size,payload')
      .eq('user_id', userId).order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('No cloud journal backup is available yet.');
    if (data.schema_version !== CLOUD_JOURNAL_SCHEMA_VERSION) throw new Error('This cloud backup uses an unsupported schema version.');
    const packed = journalPayloadFromBytea(data.payload);
    if (Number(data.byte_size) !== packed.byteLength) throw new Error('Cloud backup size verification failed.');
    const backup = await decryptJournalBackup(packed, passphrase);
    state.online.cloudBackupCreatedAt = data.created_at;
    await stageJournalImport(backup, `Encrypted cloud backup · ${new Date(data.created_at).toLocaleString()}`);
    renderCloudBackupControls();
    toast('Cloud backup decrypted. Review it before merging.');
  } finally { setCloudBackupBusy(false); }
}

export function initBackupControls() {
  const panel = document.createElement('div'); panel.className = 'backup-controls';
  panel.innerHTML = '<p class="sheet-kicker">YOUR BACKUP</p><p>Export a complete private backup or a readable CSV. Import starts with a preview; Merge preserves this device by default.</p><div class="backup-actions"><button class="secondary-button" id="exportDataButton" type="button">Export JSON</button><button class="secondary-button" id="exportCsvButton" type="button">Export CSV</button><label class="secondary-button import-label">Preview import<input id="importDataInput" type="file" accept="application/json,.json" /></label></div><section class="cloud-backup-controls" aria-labelledby="cloudBackupTitle"><strong id="cloudBackupTitle">Field Edition cloud backup</strong><p id="cloudBackupStatus">Checking Field Edition access…</p><label>Backup passphrase <input id="cloudBackupPassphrase" type="password" autocomplete="off" minlength="8" placeholder="Not sent to the server" /></label><small>One encrypted snapshot is stored. The server cannot read it, and the passphrase cannot be recovered.</small><div class="backup-actions"><button class="secondary-button" id="saveCloudBackupButton" type="button">Replace cloud backup</button><button class="secondary-button" id="restoreCloudBackupButton" type="button">Preview cloud restore</button></div></section><section class="journal-import-preview hidden" id="journalImportPreview" aria-live="polite"></section>';
  el('clearDataButton').before(panel);
  el('exportDataButton').textContent = 'Export journal (JSON)';
  el('exportCsvButton').textContent = 'Export journal (CSV)';
  el('importDataInput').closest('.import-label').childNodes[0].textContent = 'Import journal';
  el('cloudBackupTitle').textContent = 'Encrypted backup';
  el('saveCloudBackupButton').textContent = 'Replace encrypted backup';
  el('restoreCloudBackupButton').textContent = 'Preview encrypted restore';
  el('exportDataButton').addEventListener('click', () => void exportJournal('json'));
  el('exportCsvButton').addEventListener('click', () => void exportJournal('csv'));
  el('importDataInput').addEventListener('change', importJournal);
  el('saveCloudBackupButton').addEventListener('click', () => void saveCloudJournalBackup().catch((error) => toast(error.message || 'Could not save the cloud backup.')));
  el('restoreCloudBackupButton').addEventListener('click', () => void restoreCloudJournalBackup().catch((error) => toast(error.message || 'Could not restore the cloud backup.')));
  window.addEventListener('cloud-journal-entitlement-changed', renderCloudBackupControls);
  renderCloudBackupControls();
}
