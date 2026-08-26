import { state } from './state.js';
import { CITIES, DEFAULT_SETTINGS } from './constants.js';
import { dayKey, normalizeProfile, el } from './utils.js';
import db from './storage.js';
import { createMigratedProfile } from './loader.js';
import { refreshCityMap } from './city.js';
import { closeSheets, toast } from './ui.js';
import { renderArchive } from './archive.js';

export async function exportJournal() {
  const [walks, observations, moments, profile, settings] = await Promise.all([db.all('walks'), db.all('observations'), db.all('moments'), db.get('profile', 'local-user'), db.get('settings', 'app-settings')]);
  const backup = { format: 'walk-wildlife-journal', version: 1, exportedAt: new Date().toISOString(), walks, observations, moments, profile, settings };
  const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = `walk-wildlife-journal-${dayKey()}.json`; link.click(); URL.revokeObjectURL(url); toast('Journal backup downloaded.');
}
export async function importJournal(event) {
  const file = event.target.files[0]; event.target.value = ''; if (!file) return;
  try {
    const backup = JSON.parse(await file.text());
    if (backup.format !== 'walk-wildlife-journal' || backup.version !== 1 || !Array.isArray(backup.walks) || !Array.isArray(backup.observations) || !Array.isArray(backup.moments)) throw new Error('Choose a Discover Walks journal backup file.');
    if (!confirm('Replace this device\'s current journal with this backup? This cannot be undone.')) return;
    await db.clearAll();
    await Promise.all([...backup.walks.map((item) => db.put('walks', item)), ...backup.observations.map((item) => db.put('observations', item)), ...backup.moments.map((item) => db.put('moments', item))]);
    state.profile = normalizeProfile(backup.profile || await createMigratedProfile()); state.settings = { ...DEFAULT_SETTINGS, ...(backup.settings || {}) };
    if (!CITIES[state.settings.activeCity]) state.settings.activeCity = 'fairfax'; state.activeCity = state.settings.activeCity;
    await Promise.all([db.put('profile', state.profile), db.put('settings', state.settings)]); closeSheets(); await refreshCityMap(true); await renderArchive(); toast('Journal backup restored.');
  } catch (error) { toast(error.message || 'That backup could not be restored.'); }
}
export function initBackupControls() {
  const panel = document.createElement('div'); panel.className = 'backup-controls';
  panel.innerHTML = '<p class="sheet-kicker">YOUR BACKUP</p><p>Download a private copy of this device journal, or restore a backup. Restoring replaces this device\'s current journal.</p><div class="backup-actions"><button class="secondary-button" id="exportDataButton" type="button">Export journal</button><label class="secondary-button import-label">Import journal<input id="importDataInput" type="file" accept="application/json,.json" /></label></div>';
  el('clearDataButton').before(panel);
  el('exportDataButton').addEventListener('click', exportJournal);
  el('importDataInput').addEventListener('change', importJournal);
}
