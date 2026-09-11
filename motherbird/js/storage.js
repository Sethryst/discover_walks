export const db = (() => {
  let database;
  const DATABASE_NAME = 'walk-wildlife-journal';
  const DATABASE_VERSION = 14;
  const LEGACY_STORES = [
    'walks', 'observations', 'moments', 'profile', 'settings', 'points_of_interest',
    'poi_metadata', 'regions', 'region_pois', 'region_buckets', 'field_editions',
    'civic_witnesses', 'neighborhood_discoveries', 'walk_drafts', 'walk_events',
    'personal_places', 'personal_place_categories', 'layer_settings', 'voice_notes',
    'journal_audio', 'county_additions', 'notification_state', 'spatial_local_operations',
    'geo_cyphers', 'geo_cypher_keys', 'geo_cypher_events'
  ];
  const migrations = Object.freeze([
    { version: 1, risk: 'additive', description: 'Create the local-first journal stores.', apply: (target) => LEGACY_STORES.forEach((name) => { if (!target.objectStoreNames.contains(name)) target.createObjectStore(name, { keyPath: 'id' }); }) },
    { version: 13, risk: 'additive', description: 'Separate Geo Cypher manifests from on-demand audio.', apply: (target) => ['geo_cypher_manifests', 'geo_cypher_audio'].forEach((name) => { if (!target.objectStoreNames.contains(name)) target.createObjectStore(name, { keyPath: 'id' }); }) },
    // Version 13 introduced explicit migrations after earlier releases had
    // added stores without bumping the database version. Existing databases
    // could therefore report a current version while still missing stores,
    // causing app boot to stop before event handlers were registered.
    { version: 14, risk: 'additive', description: 'Repair missing local stores from earlier installations.', apply: (target) => [...LEGACY_STORES, 'geo_cypher_manifests', 'geo_cypher_audio'].forEach((name) => { if (!target.objectStoreNames.contains(name)) target.createObjectStore(name, { keyPath: 'id' }); }) }
  ]);

  async function installedVersion() {
    if (indexedDB.databases) return Number((await indexedDB.databases()).find((entry) => entry.name === DATABASE_NAME)?.version || 0);
    return new Promise((resolve, reject) => {
      let created = false;
      const request = indexedDB.open(DATABASE_NAME);
      request.onupgradeneeded = () => { created = true; migrations[0].apply(request.result); };
      request.onsuccess = () => { const version = created ? 0 : request.result.version; request.result.close(); resolve(version); };
      request.onerror = () => reject(request.error);
    });
  }

  function pendingMigrations(fromVersion) { return migrations.filter(({ version }) => version > fromVersion && version <= DATABASE_VERSION); }
  function migrationPlan(fromVersion = 0) { return pendingMigrations(fromVersion).map(({ version, risk, description }) => ({ version, risk, description })); }

  async function backupValue(value) {
    if (value instanceof Blob) {
      const bytes = new Uint8Array(await value.arrayBuffer());
      let binary = '';
      for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
      return { $type: 'Blob', mimeType: value.type, base64: btoa(binary) };
    }
    if (globalThis.CryptoKey && value instanceof CryptoKey) return { $type: 'CryptoKey', extractable: value.extractable, algorithm: value.algorithm, usages: value.usages, note: 'Non-exportable private key material remains protected on this device.' };
    if (Array.isArray(value)) return Promise.all(value.map(backupValue));
    if (value && typeof value === 'object') return Object.fromEntries(await Promise.all(Object.entries(value).map(async ([key, item]) => [key, await backupValue(item)])));
    return value;
  }

  async function createPreMigrationBackup(details) {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME);
      request.onerror = () => reject(request.error);
      request.onsuccess = async () => {
        const source = request.result;
        try {
          const names = [...source.objectStoreNames];
          const transaction = source.transaction(names, 'readonly');
          const records = await Promise.all(names.map((name) => new Promise((done, fail) => {
            const read = transaction.objectStore(name).getAll();
            read.onsuccess = () => done([name, read.result]);
            read.onerror = () => fail(read.error);
          })));
          const stores = Object.fromEntries(await Promise.all(records.map(async ([name, values]) => [name, await backupValue(values)])));
          source.close();
          resolve(new Blob([JSON.stringify({ format: 'walk-wildlife-indexeddb-backup', version: 1, exportedAt: new Date().toISOString(), migration: details, stores })], { type: 'application/json' }));
        } catch (error) { source.close(); reject(error); }
      };
    });
  }

  async function open({ beforeRiskyMigration } = {}) {
    const fromVersion = await installedVersion();
    const risky = pendingMigrations(fromVersion).filter(({ risk }) => risk === 'risky');
    if (risky.length && beforeRiskyMigration) await beforeRiskyMigration({ fromVersion, toVersion: DATABASE_VERSION, migrations: risky.map(({ version, description }) => ({ version, description })) });
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      request.onupgradeneeded = (event) => {
        database = request.result;
        for (const migration of pendingMigrations(event.oldVersion)) migration.apply(database, request.transaction);
        // Civic participation logging (voted, attended_meeting, volunteered)
        // writes only to this browser's IndexedDB. These records never sync to
        // Supabase, including in anonymized form; never enter exports,
        // analytics, or cohort data; and are never visible to organizers.
        // Curated place metadata stays separate from automatically inferred
        // pause/return candidates already stored in `personal_places`.
        // Raw microphone blobs are deliberately isolated from journal transfer,
        // cloud backup, public markers, and county additions.
        // Durable local operation outbox for a future, explicitly enabled county sync.
        // It is never read by the existing aggregate-profile sync.
        // Geo Cypher keeps audio and cryptographic identity local in this
        // prototype. A future public transport can publish signed manifests
        // without coupling raw media to the journal or profile backup paths.
      };
      request.onsuccess = () => { database = request.result; resolve(); };
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Close other Walk & Wildlife tabs so the local data upgrade can finish.'));
    });
  }
  function store(name, mode = 'readonly') { return database.transaction(name, mode).objectStore(name); }
  function put(name, item) { return new Promise((resolve, reject) => {const r = store(name, 'readwrite').put(item); r.onsuccess = () => resolve(item); r.onerror = () => reject(r.error); }); }
  function get(name, id) { return new Promise((resolve, reject) => {const r = store(name).get(id); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); }); }
  function all(name) { return new Promise((resolve, reject) => {const r = store(name).getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); }); }
  function remove(name, id) { return new Promise((resolve, reject) => {const r = store(name, 'readwrite').delete(id); r.onsuccess = () => resolve(); r.onerror = () => reject(r.error); }); }
  function clearAll() {
    return Promise.all(['walks', 'observations', 'moments', 'profile', 'settings', 'poi_metadata', 'neighborhood_discoveries', 'walk_drafts', 'walk_events', 'personal_places', 'personal_place_categories', 'layer_settings', 'voice_notes', 'journal_audio', 'county_additions', 'notification_state', 'spatial_local_operations', 'geo_cyphers', 'geo_cypher_keys', 'geo_cypher_events', 'geo_cypher_manifests', 'geo_cypher_audio'].map((name) => new Promise((resolve, reject) => {
    const r = store(name, 'readwrite').clear(); r.onsuccess = resolve; r.onerror = () => reject(r.error);
    })));
  }
  function putMany(recordsByStore, removals = {}) {
    const names = [...new Set([...Object.keys(recordsByStore), ...Object.keys(removals)])];
    if (!names.length) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(names, 'readwrite');
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(transaction.error || new Error('Import was not saved.'));
      transaction.onerror = () => reject(transaction.error);
      try {
        for (const name of names) {
          for (const id of removals[name] || []) transaction.objectStore(name).delete(id);
          for (const record of recordsByStore[name] || []) transaction.objectStore(name).put(record);
        }
      }
      catch (error) { transaction.abort(); reject(error); }
    });
  }
  return { open, put, putMany, get, all, remove, clearAll, migrationPlan, createPreMigrationBackup, version: DATABASE_VERSION };
})();
export default db;
