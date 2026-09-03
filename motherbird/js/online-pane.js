import { state } from './state.js';
import db from './storage.js';
import { el } from './utils.js';
import { toast } from './ui.js';
import { setupOnline, signInWithPasskey } from './online.js';
import { createPasskeyWrap, unlockPasskeyWrap, sealJson, openSealedJson, journalPayloadToBytea, journalPayloadFromBytea } from './cloud-journal.js';
import { SEAL_DEFAULTS, SEALED_STORES, buildSelectedBackup, mergeSubset } from './sealed-data.js';
import { openOfflinePreview, closeOfflinePreview, saveOfflineView, validateViewConditions } from './offline-view.js';
import { normalizeCountyAddition } from './county-additions.js';
import { renderArchive } from './archive.js';
import { renderPersonalPlacesPanel, renderPersonalPlacesOnMap, normalizePersonalCategory, normalizePersonalPlace } from './personal-places.js';

export const SEALED_SCHEMA = 'walk-wildlife-personal-seal/1';
let unlocked = null;
let timer = null;
let busy = false;
export async function readSealData() {
  return Object.fromEntries(await Promise.all(SEALED_STORES.map(async (store) => [store, await db.all(store)])));
}
export async function importJournalSubset(payload, mode = 'add') {
  // Validate all imports before making the first persistent change.
  if (payload.viewConditions) validateViewConditions(payload.viewConditions);
  for (const addition of payload.data?.county_additions || []) await normalizeCountyAddition(addition);
  const local = await readSealData();
  const merged = mergeSubset(local, payload, mode);
  merged.personal_place_categories = merged.personal_place_categories.map((row) => normalizePersonalCategory(row, row.updatedAt || row.created));
  merged.personal_places = merged.personal_places.map((row) => row.state === 'candidate' ? row : normalizePersonalPlace(row, row.updatedAt || row.added));
  for (const row of merged.observations) if (!Number.isFinite(row.location?.lat) || Math.abs(row.location.lat) > 90 || !Number.isFinite(row.location?.lng) || Math.abs(row.location.lng) > 180) throw new Error('An imported observation has invalid coordinates. No changes were saved.');
  merged.county_additions = await Promise.all(merged.county_additions.map((row) => normalizeCountyAddition(row, { verifyChecksum: mode !== 'join' })));
  const kept = new Set(merged.county_additions.map((row) => row.id));
  await db.putMany(merged, { county_additions: local.county_additions.filter((row) => !kept.has(row.id)).map((row) => row.id) });
  state.walks = merged.walks; state.observations = merged.observations; state.moments = merged.moments;
  state.personalPlaces = merged.personal_places; state.personalPlaceCategories = merged.personal_place_categories;
  if (payload.viewConditions) { state.settings.viewConditions = validateViewConditions(payload.viewConditions); await db.put('settings', state.settings); }
  const filters = await db.get('layer_settings', 'current-filters');
  if (filters) { state.layerFilters = { public: { ...filters.public }, personal: { ...filters.personal } }; state.layerLights = { ...state.layerLights, ...filters.lights }; }
  renderPersonalPlacesPanel(); renderPersonalPlacesOnMap(); await renderArchive();
  window.dispatchEvent(new CustomEvent('layer-state-dirty'));
  window.dispatchEvent(new CustomEvent('local-drawings-changed'));
  const { refreshCityMap } = await import('./city.js'); await refreshCityMap(false);
  return merged;
}
export async function requireOnlineSession() {
  if (navigator.onLine === false) throw new Error('You are offline. Your data stays on this device.');
  await setupOnline();
  if (!state.online.client) throw new Error('Online service is not configured.');
  if (!state.online.session && !await signInWithPasskey()) throw new Error('Sign in with a passkey to continue.');
  return state.online.session.user.id;
}
async function latestSeal() {
  const { data, error } = await state.online.client.from('journal_backups').select('payload,created_at').eq('user_id', state.online.session.user.id).eq('schema_version', SEALED_SCHEMA).order('created_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error(`Sealed storage unavailable: ${error.message}. Apply the sealed-online migration if needed.`);
  return data ? { ...data, envelope: JSON.parse(new TextDecoder().decode(journalPayloadFromBytea(data.payload))) } : null;
}
export async function ensureSealSession({ restore = false, mode = 'add' } = {}) {
  const ownerId = await requireOnlineSession();
  if (unlocked?.ownerId === ownerId && !restore) return unlocked;
  const remote = await latestSeal();
  const local = await db.get('settings', `passkey-wrap:${ownerId}`);
  const wrap = remote?.envelope?.wrap || local?.wrap;
  if (wrap && wrap.ownerId !== ownerId) throw new Error('This sealed key belongs to a different account.');
  const session = wrap ? { key: await unlockPasskeyWrap(wrap), wrap } : await createPasskeyWrap(ownerId);
  unlocked = { ...session, ownerId };
  await db.put('settings', { id: `passkey-wrap:${ownerId}`, wrap: session.wrap });
  if (remote) {
    const payload = await openSealedJson(remote.envelope.sealed, session.key, `personal:${ownerId}`);
    await importJournalSubset(payload, mode);
    state.settings.sealedCopyAt = remote.created_at;
  }
  return unlocked;
}
export async function openPersonalSeal(envelope = null) {
  if (!envelope) { await ensureSealSession({ restore: true, mode: el('joinModeSelect')?.value || 'add' }); renderOnlinePane(); return; }
  const ownerId = await requireOnlineSession();
  if (envelope.format !== 'walk-wildlife-personal-seal-v1' || envelope.wrap?.ownerId !== ownerId) throw new Error('Open this sealed file with its owner’s passkey account.');
  const key = await unlockPasskeyWrap(envelope.wrap);
  await importJournalSubset(await openSealedJson(envelope.sealed, key, `personal:${ownerId}`), el('joinModeSelect')?.value || 'add');
}
export async function savePersonalSeal({ interactive = false } = {}) {
  if (busy) return;
  busy = true;
  try {
    const session = interactive ? await ensureSealSession() : unlocked;
    if (!session || !state.online.session || session.ownerId !== state.online.session.user.id || navigator.onLine === false) return;
    // Merge remote additions before sealing; CAS prevents a second browser's
    // ten-minute save from silently replacing this browser's newer copy.
    let createdAt = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const remote = await latestSeal();
      let local = await readSealData();
      if (remote) {
        if (remote.envelope.wrap?.credentialId !== session.wrap.credentialId) throw new Error('The saved key changed. Use OPEN to unlock the latest sealed copy.');
        local = mergeSubset(local, await openSealedJson(remote.envelope.sealed, session.key, `personal:${session.ownerId}`), 'add');
      }
      const subset = await buildSelectedBackup(local, state.settings.sealClasses || SEAL_DEFAULTS, state.settings.viewConditions);
      const envelope = { format: 'walk-wildlife-personal-seal-v1', wrap: session.wrap, sealed: await sealJson(subset, session.key, `personal:${session.ownerId}`) };
      const packed = new TextEncoder().encode(JSON.stringify(envelope));
      if (packed.byteLength > 32 * 1024 * 1024) throw new Error('Sealed copy exceeds 32 MB. Turn Voice off or keep large files on this device.');
      const { data, error } = await state.online.client.rpc('save_personal_seal', { sealed_payload: journalPayloadToBytea(packed), expected_created_at: remote?.created_at || null });
      if (error?.code === '40001') continue;
      if (error) throw error;
      createdAt = data; break;
    }
    if (!createdAt) throw new Error('Another browser is saving. Your local data is safe; try Seal now again.');
    state.settings.sealedCopyAt = createdAt;
    state.settings.sealEnabled = true;
    await db.put('settings', state.settings);
    renderOnlinePane();
    if (!timer) timer = setInterval(() => void savePersonalSeal().catch(reportOnlineError), 10 * 60 * 1000);
  } finally { busy = false; }
}
export function renderOnlinePane() {
  if (el('sealedCopyStatus')) el('sealedCopyStatus').textContent = state.settings.sealedCopyAt ? `Sealed copy: ${new Date(state.settings.sealedCopyAt).toLocaleString()}` : 'Sealed copy: not saved';
  if (el('goOnlineButton')) el('goOnlineButton').textContent = unlocked ? 'Seal now' : 'Go online';
}
export function reportOnlineError(error) {
  const message = error?.message || 'Online action could not finish. Local data is safe.';
  if (el('openPayloadStatus')) el('openPayloadStatus').textContent = message;
  toast(message);
}
export async function initOnlinePane() {
  state.settings.sealClasses = { ...SEAL_DEFAULTS, ...state.settings.sealClasses };
  document.querySelectorAll('[data-seal-class]').forEach((input) => {
    input.checked = state.settings.sealClasses[input.dataset.sealClass] === true;
    input.closest('label').classList.toggle('lit', input.checked);
    input.addEventListener('change', async () => {
      state.settings.sealClasses[input.dataset.sealClass] = input.checked;
      input.closest('label').classList.toggle('lit', input.checked);
      await db.put('settings', state.settings);
      if (input.dataset.sealClass === 'offline') input.checked ? openOfflinePreview() : closeOfflinePreview();
      if (unlocked) void savePersonalSeal().catch(reportOnlineError);
    });
  });
  el('offlineMenuButton')?.addEventListener('click', () => {
    const opening = el('offlineClassList').classList.contains('hidden');
    el('offlineClassList').classList.toggle('hidden', !opening); el('offlineMenuButton').setAttribute('aria-expanded', String(opening));
  });
  el('saveOfflineViewButton')?.addEventListener('click', () => void saveOfflineView().catch(reportOnlineError));
  el('goOnlineButton')?.addEventListener('click', () => void savePersonalSeal({ interactive: true }).catch(reportOnlineError));
  window.addEventListener('online-panel-render-requested', renderOnlinePane);
  window.addEventListener('online-profile-changed', () => { if (unlocked && unlocked.ownerId !== state.online.session?.user.id) { unlocked = null; clearInterval(timer); timer = null; } renderOnlinePane(); });
  const { initOpenControls } = await import('./open-payload.js'); initOpenControls();
  const { initFriendWalk } = await import('./friend-walk.js'); initFriendWalk();
  renderOnlinePane();
}
