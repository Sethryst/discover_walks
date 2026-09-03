import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SEAL_DEFAULTS, buildSelectedBackup, mergeSubset, joinSameId } from '../js/sealed-data.js';
import { importSealKey, sealJson, openSealedJson, base64url, unbase64url, createPasskeyWrap, unlockPasskeyWrap } from '../js/cloud-journal.js';
import { parseOpenPayload, catalogueCityForPack } from '../js/open-payload.js';
import { validateViewConditions, applyOfflineBootConditions } from '../js/offline-view.js';
import { sortFriendTickets, validFriendBody } from '../js/friend-walk.js';
import { personalCategoryEnabled, normalizePersonalCategory } from '../js/personal-places.js';
import { nearestLearnStories } from '../js/field-guide.js';
import { supportedVoiceType } from '../js/journal-capture.js';
import { state } from '../js/state.js';
import { RegionAPI } from '../js/region-api.js';
import { journalPhoto } from '../js/ui.js';

const source = (file) => readFile(new URL('../' + file, import.meta.url), 'utf8');
const note = { id: 'n1', type: 'journal', note: 'Local note', createdAt: '2026-09-02T10:00:00Z', voiceIds: ['v1'] };
const drawing = { id: 'd1', type: 'drawing', body: { coordinates: [[38, -77], [38.01, -77.01]] } };
const friend = { id: 'f1', type: 'drawing', friendSessionId: 'cohort1', body: drawing.body };
const local = { walks: [{ id: 'w1', points: [{ lat: 38, lng: -77 }] }], moments: [note, drawing, friend], observations: [{ id: 'o1', note: 'Bird' }], voice_notes: [{ id: 'v1', momentId: 'n1', audio: new Blob(['sound'], { type: 'audio/mp4' }) }], personal_places: [{ id: 'p1' }], settings: [{ id: 'secret-wrap' }], civic_witnesses: [{ id: 'never-transfer' }], regions: [{ tiles: 'never-transfer' }] };

test('sealed defaults and allowlist omit voice, tiles, keys, and civic witnesses', async () => {
  assert.deepEqual(SEAL_DEFAULTS, { walks: true, journal: true, pins: true, offline: false, voice: false });
  const backup = await buildSelectedBackup(local);
  assert.equal(backup.journalPagesIncluded, true);
  assert.equal(backup.data.moments.length, 3);
  assert.deepEqual(backup.data.voice_notes, []);
  assert.equal('voiceIds' in backup.data.moments[0], false);
  assert.equal('viewConditions' in backup, false);
  for (const key of ['settings', 'regions', 'civic_witnesses']) assert.equal(key in backup.data, false);
});

test('unchecked classes stay out, including merged cohort drawings unless Journal is checked', async () => {
  const backup = await buildSelectedBackup(local, { walks: false, journal: false, pins: true });
  assert.deepEqual(backup.data.walks, []);
  assert.deepEqual(backup.data.observations, []);
  assert.deepEqual(backup.data.moments.map(r => r.id), ['d1']);
  assert.equal(backup.data.personal_places.length, 1);
  const journal = await buildSelectedBackup(local, { walks: false, journal: true, pins: false });
  assert.deepEqual(journal.data.moments.map(r => r.id), ['n1', 'f1']);
});

test('Voice off strips nested media and references; Voice on survives an encrypted round trip', async () => {
  const nested = await buildSelectedBackup({ ...local, moments: [{ ...note, nested: { attachment: local.voice_notes[0].audio, audio: 'data:audio/mpeg;base64,c291bmQ=' } }] });
  assert.deepEqual(nested.data.moments[0].nested, {});
  const payload = await buildSelectedBackup(local, { voice: true });
  const key = await importSealKey(crypto.getRandomValues(new Uint8Array(32)));
  const sealed = await sealJson(payload, key, 'personal:owner');
  assert.equal(JSON.stringify(sealed).includes('Local note'), false);
  const opened = await openSealedJson(sealed, key, 'personal:owner');
  const imported = mergeSubset({}, opened);
  assert.equal(imported.voice_notes[0].audio.type, 'audio/mp4');
  assert.equal(await imported.voice_notes[0].audio.text(), 'sound');
  assert.equal(imported.voice_notes[0].momentId, 'n1');
});

test('AES seal is context bound, randomized, and rejects ciphertext tampering', async () => {
  const key = await importSealKey(crypto.getRandomValues(new Uint8Array(32)));
  const a = await sealJson({ note: 'secret' }, key, 'friend:one');
  const b = await sealJson({ note: 'secret' }, key, 'friend:one');
  assert.notEqual(a.iv, b.iv);
  await assert.rejects(() => openSealedJson(a, key, 'personal:one'), /context/);
  const bytes = unbase64url(a.ciphertext); bytes[0] ^= 1;
  await assert.rejects(() => openSealedJson({ ...a, ciphertext: base64url(bytes) }, key, 'friend:one'));
});

test('passkey PRF wraps a random key, stores no plaintext key, and unwraps on a second ceremony', async () => {
  const oldNav = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const oldLocation = globalThis.location;
  const prf = crypto.getRandomValues(new Uint8Array(32)).buffer;
  const credential = { rawId: new Uint8Array([1,2,3]).buffer, getClientExtensionResults: () => ({ prf: { enabled: true, results: { first: prf } } }) };
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { credentials: { create: async () => credential, get: async () => credential } } });
  globalThis.location = { hostname: 'localhost' };
  try {
    const created = await createPasskeyWrap('owner');
    assert.equal('key' in created.wrap, false);
    const sealed = await sealJson({ text: 'private' }, created.key, 'personal:owner');
    const reopened = await unlockPasskeyWrap(JSON.parse(JSON.stringify(created.wrap)));
    assert.deepEqual(await openSealedJson(sealed, reopened, 'personal:owner'), { text: 'private' });
    navigator.credentials.create = async () => ({ ...credential, getClientExtensionResults: () => ({}) });
    await assert.rejects(() => createPasskeyWrap('owner'), /PRF/);
  } finally {
    if (oldNav) Object.defineProperty(globalThis, 'navigator', oldNav); else delete globalThis.navigator;
    if (oldLocation === undefined) delete globalThis.location; else globalThis.location = oldLocation;
  }
});

test('Add new and Replace extras never overwrite private journal; Join labels both texts', async () => {
  const payload = await buildSelectedBackup({ moments: [{ ...note, note: 'Saved note', updatedAt: '2026-09-02T11:00:00Z' }] });
  for (const mode of ['add', 'replace-extras']) assert.equal(mergeSubset(local, payload, mode).moments[0].note, 'Local note');
  const joined = mergeSubset(local, payload, 'join').moments[0];
  assert.match(joined.note, /^text\n\[local 2026-09-02T10:00:00Z\]\nLocal note\n\[saved 2026-09-02T11:00:00Z\]\nSaved note$/);
  assert.deepEqual(joinSameId(joined, payload.data.moments[0]), joined);
  assert.throws(() => mergeSubset({}, { ...payload, data: { moments: [{ note: 'no id' }] } }), /stable ids/);
});

test('OPEN uses one format detector and requires the explicit journal-pages flag', () => {
  assert.equal(parseOpenPayload('learn fairfax-county-va park-one').kind, 'learn');
  assert.equal(parseOpenPayload('area fairfax-county-va sha256:abc').kind, 'area');
  assert.equal(parseOpenPayload('sealed').kind, 'seal');
  assert.equal(parseOpenPayload({ export_format: 'walk-wildlife-filters-v1', filters: {} }).kind, 'filters');
  assert.equal(parseOpenPayload({ format: 'walk-wildlife-subset-v1', journalPagesIncluded: true, data: {} }).kind, 'journal');
  assert.throws(() => parseOpenPayload({ format: 'walk-wildlife-subset-v1', data: { moments: [note] } }), /explicitly included/);
  assert.equal(catalogueCityForPack('fairfax-county-va'), 'fairfax');
  assert.equal(catalogueCityForPack('../../private'), null);
  assert.throws(() => parseOpenPayload('bad phrase'), /supported JSON/);
});

test('offline conditions validate geographic range and bad settings do not block offline boot', async () => {
  const view = { pack_id: 'fairfax-county-va', zoom: 16, layers: { lights: { recreation: true } }, range: { type: 'radius', center: { lat: 38, lng: -77 }, meters: 50 } };
  assert.deepEqual(validateViewConditions(view), view);
  assert.throws(() => validateViewConditions({ ...view, zoom: 100 }), /Invalid/);
  assert.throws(() => validateViewConditions({ ...view, range: { type: 'radius', center: { lat: 200, lng: 1 }, meters: 50 } }), /Invalid/);
  const oldNav = Object.getOwnPropertyDescriptor(globalThis, 'navigator'), oldSettings = state.settings;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: false } });
  state.settings = { viewConditions: { corrupt: true } };
  try { await assert.doesNotReject(applyOfflineBootConditions); }
  finally { state.settings = oldSettings; if (oldNav) Object.defineProperty(globalThis, 'navigator', oldNav); else delete globalThis.navigator; }
});

test('friend tickets retain concurrent same-minute writes and sort earlier above later', () => {
  const tickets = [{ id: 'b', t: '2026-09-02T10:00:30Z' }, { id: 'a', t: '2026-09-02T10:00:01Z' }, { id: 'c', t: '2026-09-02T10:00:30Z' }];
  assert.deepEqual(sortFriendTickets([...tickets, tickets[0]]).map(r => r.id), ['a','b','c']);
  assert.equal(validFriendBody('note', { text: 'hello' }), true);
  assert.equal(validFriendBody('pin', { name: 'Park', location: { lat: 190, lng: 0 } }), false);
  assert.equal(validFriendBody('draw', drawing.body), true);
  assert.equal(validFriendBody('draw', { coordinates: [[1,2]] }), false);
});

test('nested collections inherit parent visibility and reject cyclic visibility chains', () => {
  const categories = [{ id: 'food' }, { id: 'cafe', parentId: 'food' }];
  assert.equal(normalizePersonalCategory({ name: 'Cafe', parentId: 'Food' }).parentId, 'food');
  assert.equal(personalCategoryEnabled('cafe', categories, { food: false, cafe: true }), false);
  assert.equal(personalCategoryEnabled('cafe', categories, { food: true }), true);
  assert.equal(personalCategoryEnabled('a', [{ id: 'a', parentId: 'b' }, { id: 'b', parentId: 'a' }], {}), false);
});

test('Learn chooses the nearest real, sourced pin per light and remaining points nearest-first', () => {
  const previous = state.layerFilters; state.layerFilters = { public: {}, personal: {} };
  const pois = [
    { id: 'park-far', name: 'Far park', category: 'park', tags: ['park'], lat: 38.1, lng: -77 },
    { id: 'cafe', name: 'Creek Coffee', category: 'cafe', tags: ['cafe'], lat: 38.01, lng: -77 },
    { id: 'news', name: 'Official meeting', category: 'event', tags: ['event'], lat: 38.02, lng: -77, officialUrl: 'https://example.gov/meeting' },
    { id: 'park-near', name: 'Near park', category: 'park', tags: ['park'], lat: 38.001, lng: -77 }
  ];
  const cards = pois.map(p => ({ placeId: p.id, light: p.category === 'event' ? 'news' : p.category === 'cafe' ? 'cuisine' : 'recreation', officialUrl: 'https://example.gov/place' }));
  try {
    const result = nearestLearnStories(cards, pois, { lat: 38, lng: -77 });
    assert.deepEqual(result.intros.map(c => c.placeId), ['news', 'park-near', 'cafe']);
    assert.deepEqual(result.remaining.map(c => c.placeId), ['park-far']);
  } finally { state.layerFilters = previous; }
});

test('Record never relabels a WebM file as MP4', () => {
  assert.equal(supportedVoiceType({ isTypeSupported: type => type === 'audio/mp4' }), 'audio/mp4');
  assert.equal(supportedVoiceType({ isTypeSupported: type => type === 'audio/webm' }), null);
});

test('map-first chrome exposes only the requested journal tools and Online entry controls', async () => {
  const html = await source('index.html');
  assert.doesNotMatch(html, /id="onboardingSheet"|data-guide-tab="share"|id="shareJournalButton"|id="accountEmailInput"|id="backupPassphrase"/);
  for (const id of ['journalTranscribeButton','journalRecordButton','observeButton','nearbyList','journalNavDropdown','journalHistoryList','goOnlineButton','offlineMenuButton','offlineClassList','offlineModePreview','openPhraseInput','openQrButton','openFileInput','joinModeSelect','startFriendWalkButton','joinFriendWalkInput']) assert.ok(html.includes('id="' + id + '"'), id);
  assert.match(html, /data-guide-tab="online"[^>]*>Online/);
  assert.ok(html.indexOf('id="journalNote"') < html.indexOf('id="journalHistoryList"'));
  assert.doesNotMatch(await source('js/profile.js'), /void syncProfile/);
});

test('backend access is owner/member scoped with append-only tickets and no subscription gate', async () => {
  const sql = await source('supabase-migration-sealed-online.sql');
  assert.match(sql, /user_id = auth.uid\(\)/);
  assert.match(sql, /can_write_friend_walk/);
  assert.match(sql, /before insert on public.friend_walk_tickets/);
  assert.match(sql, /for update;/);
  assert.match(sql, /save_personal_seal/);
  assert.match(sql, /errcode='40001'/);
  assert.doesNotMatch(sql, /from public.subscriptions|create policy .*for update.*friend_walk_tickets/i);
});

test('offline runtime never invokes a new pack resolver, even when local installation is missing', async () => {
  const oldNav = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: false } });
  let calls = 0;
  const api = new RegionAPI({ installer: { load: async () => null }, packageResolver: async () => { calls += 1; throw new Error('must not fetch'); } });
  try {
    assert.equal(await api.loadRegion('fairfax-county-va'), null);
    await assert.rejects(() => api.installRegion('fairfax-county-va'), /connection/);
    assert.equal(calls, 0);
  } finally { if (oldNav) Object.defineProperty(globalThis, 'navigator', oldNav); else delete globalThis.navigator; }
});

test('Replace extras affects only incoming counties, and cannot delete journal or another county', () => {
  const original = { moments: [note], county_additions: [{ id: 'old-a', region_id: 'a' }, { id: 'keep-b', region_id: 'b' }] };
  const saved = { format: 'walk-wildlife-subset-v1', journalPagesIncluded: true, data: { moments: [{ ...note, note: 'different' }], county_additions: [{ id: 'new-a', region_id: 'a' }] } };
  const merged = mergeSubset(original, saved, 'replace-extras');
  assert.deepEqual(merged.county_additions.map(row => row.id), ['keep-b', 'new-a']);
  assert.equal(merged.moments[0].note, note.note);
});

test('offline conditions are copied only when selected; imported photos cannot inject markup or request remote URLs', async () => {
  const view = { pack_id: 'a', layers: {}, range: {}, zoom: 12 };
  const selected = await buildSelectedBackup({}, { offline: true }, view);
  assert.deepEqual(selected.viewConditions, view);
  assert.equal('viewConditions' in await buildSelectedBackup({}, { offline: false }, view), false);
  assert.equal(journalPhoto('https://example.com/tracker.png'), '');
  assert.equal(journalPhoto('x" onerror="alert(1)'), '');
  assert.match(journalPhoto('data:image/png;base64,aGVsbG8='), /class="journal-photo"/);
});
