export const db = (() => {
  let database;
  function open() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('walk-wildlife-journal', 9);
      request.onupgradeneeded = () => {
        database = request.result;
        if (!database.objectStoreNames.contains('walks')) database.createObjectStore('walks', { keyPath: 'id' });
        if (!database.objectStoreNames.contains('observations')) database.createObjectStore('observations', { keyPath: 'id' });
        if (!database.objectStoreNames.contains('moments')) database.createObjectStore('moments', { keyPath: 'id' });
        if (!database.objectStoreNames.contains('profile')) database.createObjectStore('profile', { keyPath: 'id' });
        if (!database.objectStoreNames.contains('settings')) database.createObjectStore('settings', { keyPath: 'id' });
        if (!database.objectStoreNames.contains('points_of_interest')) database.createObjectStore('points_of_interest', { keyPath: 'id' });
        if (!database.objectStoreNames.contains('poi_metadata')) database.createObjectStore('poi_metadata', { keyPath: 'id' });
        if (!database.objectStoreNames.contains('regions')) database.createObjectStore('regions', { keyPath: 'id' });
        if (!database.objectStoreNames.contains('region_pois')) database.createObjectStore('region_pois', { keyPath: 'id' });
        if (!database.objectStoreNames.contains('region_buckets')) database.createObjectStore('region_buckets', { keyPath: 'id' });
        if (!database.objectStoreNames.contains('field_editions')) database.createObjectStore('field_editions', { keyPath: 'id' });
        // Civic participation logging (voted, attended_meeting, volunteered)
        // writes only to this browser's IndexedDB. These records never sync to
        // Supabase, including in anonymized form; never enter exports,
        // analytics, or cohort data; and are never visible to organizers.
        if (!database.objectStoreNames.contains('civic_witnesses')) database.createObjectStore('civic_witnesses', { keyPath: 'id' });
        if (!database.objectStoreNames.contains('neighborhood_discoveries')) database.createObjectStore('neighborhood_discoveries', { keyPath: 'id' });
        if (!database.objectStoreNames.contains('walk_drafts')) database.createObjectStore('walk_drafts', { keyPath: 'id' });
        if (!database.objectStoreNames.contains('walk_events')) database.createObjectStore('walk_events', { keyPath: 'id' });
        if (!database.objectStoreNames.contains('personal_places')) database.createObjectStore('personal_places', { keyPath: 'id' });
        // Curated place metadata stays separate from automatically inferred
        // pause/return candidates already stored in `personal_places`.
        if (!database.objectStoreNames.contains('personal_place_categories')) database.createObjectStore('personal_place_categories', { keyPath: 'id' });
        if (!database.objectStoreNames.contains('layer_settings')) database.createObjectStore('layer_settings', { keyPath: 'id' });
        if (!database.objectStoreNames.contains('voice_notes')) database.createObjectStore('voice_notes', { keyPath: 'id' });
        if (!database.objectStoreNames.contains('notification_state')) database.createObjectStore('notification_state', { keyPath: 'id' });
        // Durable local operation outbox for a future, explicitly enabled county sync.
        // It is never read by the existing aggregate-profile sync.
        if (!database.objectStoreNames.contains('spatial_local_operations')) database.createObjectStore('spatial_local_operations', { keyPath: 'id' });
      };
      request.onsuccess = () => { database = request.result; resolve(); };
      request.onerror = () => reject(request.error);
    });
  }
  function store(name, mode = 'readonly') { return database.transaction(name, mode).objectStore(name); }
  function put(name, item) { return new Promise((resolve, reject) => {const r = store(name, 'readwrite').put(item); r.onsuccess = () => resolve(item); r.onerror = () => reject(r.error); }); }
  function get(name, id) { return new Promise((resolve, reject) => {const r = store(name).get(id); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); }); }
  function all(name) { return new Promise((resolve, reject) => {const r = store(name).getAll(); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); }); }
  function remove(name, id) { return new Promise((resolve, reject) => {const r = store(name, 'readwrite').delete(id); r.onsuccess = () => resolve(); r.onerror = () => reject(r.error); }); }
  function clearAll() {
    return Promise.all(['walks', 'observations', 'moments', 'profile', 'settings', 'poi_metadata', 'neighborhood_discoveries', 'walk_drafts', 'walk_events', 'personal_places', 'personal_place_categories', 'layer_settings', 'voice_notes', 'notification_state', 'spatial_local_operations'].map((name) => new Promise((resolve, reject) => {
    const r = store(name, 'readwrite').clear(); r.onsuccess = resolve; r.onerror = () => reject(r.error);
    })));
  }
  return { open, put, get, all, remove, clearAll };
})();
export default db;
