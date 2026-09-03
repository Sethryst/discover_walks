export const SEAL_DEFAULTS = Object.freeze({ walks: true, journal: true, pins: true, offline: false, voice: false });
export const SEALED_STORES = ['walks', 'walk_events', 'moments', 'observations', 'personal_places', 'personal_place_categories', 'voice_notes', 'layer_settings', 'county_additions'];

function withoutVoice(value) {
  if (value instanceof Blob) return /^audio\//i.test(value.type) ? undefined : value;
  if (typeof value === 'string' && /^data:audio\//i.test(value)) return undefined;
  if (Array.isArray(value)) return value.map(withoutVoice).filter((item) => item !== undefined);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !['voice_notes', 'voiceIds', 'voiceNoteIds', 'audio', 'audioBlob', 'voiceBlob'].includes(key))
    .map(([key, child]) => [key, withoutVoice(child)]).filter(([, child]) => child !== undefined));
  return value;
}

export async function encodePrivateValue(value) {
  if (value instanceof Blob) {
    const bytes = new Uint8Array(await value.arrayBuffer());
    let binary = '';
    for (let index = 0; index < bytes.length; index += 8192) binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
    return { __voiceBlob: true, mimeType: value.type, base64: btoa(binary) };
  }
  if (Array.isArray(value)) return Promise.all(value.map(encodePrivateValue));
  if (value && typeof value === 'object') return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([key, child]) => [key, await encodePrivateValue(child)])));
  return value;
}
export function decodePrivateValue(value) {
  if (value?.__voiceBlob === true) {
    if (!/^audio\//.test(value.mimeType || '') || typeof value.base64 !== 'string') throw new Error('Invalid voice attachment.');
    return new Blob([Uint8Array.from(atob(value.base64), (char) => char.charCodeAt(0))], { type: value.mimeType });
  }
  if (Array.isArray(value)) return value.map(decodePrivateValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => !['__proto__', 'constructor', 'prototype'].includes(key)).map(([key, child]) => [key, decodePrivateValue(child)]));
  return value;
}
export async function buildSelectedBackup(local, selection = SEAL_DEFAULTS, viewConditions = null, now = new Date().toISOString()) {
  const selected = { ...SEAL_DEFAULTS, ...selection };
  const data = Object.fromEntries(SEALED_STORES.map((store) => [store, []]));
  if (selected.walks) { data.walks = local.walks || []; data.walk_events = local.walk_events || []; }
  if (selected.journal) { data.moments = (local.moments || []).filter((item) => item.type !== 'drawing' || item.friendSessionId); data.observations = local.observations || []; }
  if (selected.pins) {
    for (const store of ['personal_places', 'personal_place_categories', 'layer_settings', 'county_additions']) data[store] = local[store] || [];
    data.moments = [...data.moments, ...(local.moments || []).filter((item) => item.type === 'drawing' && !item.friendSessionId)];
  }
  // Friend-walk tickets enter the personal seal only AFTER a local journal merge.
  if (!selected.journal) for (const store of SEALED_STORES) data[store] = data[store].filter((item) => !item.friendSessionId);
  if (selected.voice) data.voice_notes = local.voice_notes || [];
  const transferable = selected.voice ? data : withoutVoice(data);
  // Keep an explicit empty collection, never stale attachment references.
  if (!selected.voice) transferable.voice_notes = [];
  return { format: 'walk-wildlife-subset-v1', journalPagesIncluded: selected.journal, included: selected, exportedAt: now, data: await encodePrivateValue(transferable), ...(selected.offline && viewConditions ? { viewConditions } : {}) };
}
export function joinSameId(local, saved, now = new Date().toISOString()) {
  const textKey = typeof local.note === 'string' || typeof saved.note === 'string' ? 'note' : typeof local.notes === 'string' || typeof saved.notes === 'string' ? 'notes' : null;
  if (!textKey || local[textKey] === saved[textKey] || !saved[textKey]) return local;
  const stamp = saved.updatedAt || saved.createdAt || now;
  const suffix = `[saved ${stamp}]\n${saved[textKey]}`;
  if (String(local[textKey] || '').includes(suffix)) return local;
  return { ...local, [textKey]: `text\n[local ${local.updatedAt || local.createdAt || now}]\n${local[textKey] || ''}\n${suffix}`, updatedAt: now };
}
export function mergeSubset(local, payload, mode = 'add') {
  if (payload?.format !== 'walk-wildlife-subset-v1' || !payload.data) throw new Error('Invalid journal subset.');
  const incoming = decodePrivateValue(payload.data);
  const result = {};
  for (const store of SEALED_STORES) {
    let records = incoming[store] || [];
    if (!Array.isArray(records)) throw new Error('Invalid subset collection.');
    const replacedPacks = store === 'county_additions' && mode === 'replace-extras' ? new Set(records.map((row) => row.region_id)) : new Set();
    const current = [...(local[store] || [])].filter((row) => !replacedPacks.has(row.region_id));
    const index = new Map(current.map((item, i) => [String(item.id), i]));
    if (!payload.journalPagesIncluded && store === 'observations') records = [];
    if (!payload.included?.voice && store === 'voice_notes') records = [];
    if (!payload.journalPagesIncluded && store === 'moments') records = records.filter((item) => item.type === 'drawing' && !item.friendSessionId);
    for (const record of records) {
      if (!record?.id || typeof record !== 'object') throw new Error('Imported records need stable ids.');
      const old = index.get(String(record.id));
      if (old != null && store === 'county_additions' && current[old].region_id !== record.region_id) throw new Error('An addition id cannot change packs.');
      if (old == null) { index.set(String(record.id), current.length); current.push(record); }
      else if (mode === 'join' && ['moments', 'observations', 'personal_places'].includes(store)) current[old] = joinSameId(current[old], record);
      else if (mode === 'join' && store === 'county_additions') {
        if (current[old].region_id !== record.region_id) throw new Error('An addition id cannot change packs.');
        const additions = Object.fromEntries(['points', 'lines'].map((kind) => [kind, [...new Map([...(record.additions?.[kind] || []), ...(current[old].additions?.[kind] || [])].map((item) => [item.id, item])).values()]]));
        current[old] = { ...current[old], additions };
      }
    }
    result[store] = current;
  }
  return result;
}
