export const JOURNAL_TRANSFER_STORES = Object.freeze([
  'walks', 'observations', 'moments', 'personal_places', 'personal_place_categories',
  'poi_metadata', 'walk_events', 'voice_notes', 'layer_settings', 'profile', 'settings'
]);

function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  return value;
}
function same(first, second) { return JSON.stringify(stable(first)) === JSON.stringify(stable(second)); }
function itemId(item, index) { return String(item?.id || `missing-id-${index}`); }

export function normalizeJournalBackup(raw) {
  const version = Number(raw?.version);
  if (!raw || raw.format !== 'walk-wildlife-journal' || ![1, 2].includes(version)) throw new Error('Choose a Discover Walks journal backup file.');
  const source = version === 1 ? {
    walks: raw.walks, observations: raw.observations, moments: raw.moments,
    profile: raw.profile ? [raw.profile] : [], settings: raw.settings ? [raw.settings] : []
  } : raw.data;
  if (!source || !Array.isArray(source.walks) || !Array.isArray(source.observations) || !Array.isArray(source.moments)) throw new Error('This backup is missing its journal collections.');
  return {
    format: 'walk-wildlife-journal', version: 2, exportedAt: raw.exportedAt || null,
    data: Object.fromEntries(JOURNAL_TRANSFER_STORES.map((store) => [store, Array.isArray(source[store]) ? clone(source[store]) : []]))
  };
}

export function createJournalBackup(data, exportedAt = new Date().toISOString()) {
  return normalizeJournalBackup({ format: 'walk-wildlife-journal', version: 2, exportedAt, data });
}

export function previewJournalImport(localData, incomingData) {
  const stores = {};
  const conflicts = [];
  let additions = 0; let identical = 0;
  for (const store of JOURNAL_TRANSFER_STORES) {
    const local = Array.isArray(localData?.[store]) ? localData[store] : [];
    const incoming = Array.isArray(incomingData?.[store]) ? incomingData[store] : [];
    const localById = new Map(local.map((item, index) => [itemId(item, index), item]));
    let storeAdditions = 0; let storeIdentical = 0; let storeConflicts = 0;
    incoming.forEach((item, index) => {
      const id = itemId(item, index); const existing = localById.get(id);
      if (!existing) { storeAdditions += 1; additions += 1; return; }
      if (same(existing, item)) { storeIdentical += 1; identical += 1; return; }
      storeConflicts += 1;
      conflicts.push({ key: `${store}:${id}`, store, id, local: clone(existing), incoming: clone(item), resolution: 'local' });
    });
    stores[store] = { local: local.length, incoming: incoming.length, additions: storeAdditions, identical: storeIdentical, conflicts: storeConflicts };
  }
  return { stores, additions, identical, conflicts, conflictCount: conflicts.length };
}

export function mergeJournalData(localData, incomingData, resolutions = {}) {
  const data = {};
  const applied = { added: 0, keptLocal: 0, usedIncoming: 0, identical: 0 };
  for (const store of JOURNAL_TRANSFER_STORES) {
    const local = clone(Array.isArray(localData?.[store]) ? localData[store] : []);
    const incoming = Array.isArray(incomingData?.[store]) ? incomingData[store] : [];
    const indexById = new Map(local.map((item, index) => [itemId(item, index), index]));
    for (let index = 0; index < incoming.length; index += 1) {
      const item = clone(incoming[index]); const id = itemId(item, index); const existingIndex = indexById.get(id);
      if (existingIndex == null) { indexById.set(id, local.length); local.push(item); applied.added += 1; continue; }
      if (same(local[existingIndex], item)) { applied.identical += 1; continue; }
      if (resolutions[`${store}:${id}`] === 'incoming') { local[existingIndex] = item; applied.usedIncoming += 1; }
      else applied.keptLocal += 1;
    }
    data[store] = local;
  }
  return { data, applied };
}

function csvCell(value) {
  const text = value == null ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function journalBackupToCsv(backup) {
  const normalized = normalizeJournalBackup(backup);
  const rows = [['type', 'id', 'date', 'title', 'note', 'city', 'latitude', 'longitude', 'walk_id', 'distance_meters']];
  for (const store of ['walks', 'observations', 'moments', 'personal_places', 'poi_metadata']) {
    for (const item of normalized.data[store]) {
      const location = item.location || item.startLocation || {};
      rows.push([
        store, item.id, item.createdAt || item.startedAt || item.added || item.lastVisitDate || '',
        item.title || item.species || item.name || '', item.note || item.notes || item.lastNote || '', item.city || '',
        location.lat, location.lng, item.walkId || '', item.distanceMeters
      ]);
    }
  }
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n');
}
