import db from './storage.js';
import { openSheet, closeSheets, toast } from './ui.js';

const MANIFEST_URL = './data/radio/manifest.json?v=20260923-radio-v2';
const FAVORITES_KEY = 'gremlin-radio-favorites-v1';
const STATES = Object.freeze({ paused: 'paused', buffering: 'buffering', playing: 'playing', jingle: 'jingle playing' });
const FALLBACK_MANIFEST = {
  id: 'otr-time-machine', version: 1, epoch: '1950-01-01T00:00:00Z', slotMinutes: 45,
  channels: [{ id: 'x1', name: 'X-1 Signal', description: 'Science fiction from the golden age', genre: 'Drama', color: '#d96b3b' }, { id: 'vintage', name: 'Vintage Broadcast', description: 'News, variety, and field voices', genre: 'Broadcast', color: '#4f6f61' }],
  jingles: [{ id: 'static', label: 'AM static', mediaUrl: '' }], tracks: []
};

// A station may be ambient, or featured by a POI/Room without becoming a map
// pin. Editorial packages can use any of these fields:
// { poiIds, roomIds, regionIds, kind: 'guided-walkthrough' }.
export function stationMatchesPlace(station, { poiId = null, roomId = null, regionId = null, stationIds = [] } = {}) {
  if (!station) return false;
  if (Array.isArray(stationIds) && stationIds.map(String).includes(String(station.id))) return true;
  return [station.poiIds, station.roomIds, station.regionIds].some((ids, index) => {
    const value = [poiId, roomId, regionId][index];
    return value != null && Array.isArray(ids) && ids.map(String).includes(String(value));
  });
}

export function contextualStations(manifest, context = {}) {
  return (manifest?.stations || manifest?.channels || []).filter((station) => stationMatchesPlace(station, context));
}

export function recommendedStations(manifest, { history = [], favorites = new Set() } = {}) {
  const scores = new Map();
  history.forEach((event) => {
    const key = String(event.channelId || event.trackId);
    scores.set(key, (scores.get(key) || 0) + (event.event === 'skipped' ? -2 : 1));
  });
  return (manifest?.stations || manifest?.channels || []).map((station) => ({ station, score: (favorites.has(station.id) ? 4 : 0) + (scores.get(String(station.id)) || 0) })).sort((a, b) => b.score - a.score).map(({ station }) => station);
}

export function openRadioForContext(context = {}) {
  window.dispatchEvent(new CustomEvent('radio-open-requested', { detail: { context } }));
}

const state = { manifest: FALLBACK_MANIFEST, channelId: 'x1', status: STATES.paused, queue: [], current: null, activeAudio: null, nextAudio: null, urls: new Set(), audioContext: null, favorites: new Set(JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]')), history: [], savedTrackIds: new Set() };
const el = (id) => document.getElementById(id);
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));

function setStatus(status, detail = '') { state.status = status; const label = el('radioStatus'); if (label) label.textContent = detail || status; el('radioPlayer')?.setAttribute('data-radio-state', status); }
async function persistRadioState() {
  await db.put('radio_playback_state', { id: 'current', channelId: state.channelId, favoriteIds: [...state.favorites], history: state.history.slice(-100), updatedAt: Date.now() });
}
function recordRadioEvent(track, event) { if (!track?.id) return; state.history.push({ trackId: String(track.id), event, channelId: state.channelId, at: Date.now() }); void persistRadioState(); }
function tracksForChannel() { return (state.manifest.tracks || []).filter((track) => !track.channel || track.channel === state.channelId || track.channelIds?.includes(state.channelId)); }
function chooseTrack() { const candidates = tracksForChannel(); if (!candidates.length) return null; const slot = Math.floor((Date.now() - Date.parse(state.manifest.epoch || '1950-01-01')) / ((state.manifest.slotMinutes || 45) * 60000)); return candidates[Math.abs(slot) % candidates.length]; }
function chooseRandomChannel() { const channels = state.manifest.channels || state.manifest.stations || []; if (!channels.length) return; const savedChannels = new Set((state.manifest.tracks || []).filter((track) => state.savedTrackIds.has(String(track.id))).flatMap((track) => [track.channel, ...(track.channelIds || [])].filter(Boolean)).map(String)); const weighted = channels.flatMap((channel) => [channel, ...(savedChannels.has(String(channel.id)) ? [channel, channel] : [])]); state.channelId = weighted[Math.floor(Math.random() * weighted.length)]?.id || channels[0].id; }
function render() {
  const channel = state.manifest.channels?.find((item) => item.id === state.channelId);
  if (el('radioChannelDescription')) el('radioChannelDescription').textContent = channel?.description || 'Tune the dial to select a broadcast.';
  if (el('radioNowPlaying')) el('radioNowPlaying').textContent = state.current ? `${state.current.title} · ${state.current.broadcastDate || state.current.year || 'undated'}` : 'No transmission selected';
  if (el('radioSaveButton')) el('radioSaveButton').disabled = !state.current;
  const favorite = el('radioFavoriteButton'); if (favorite) { favorite.disabled = !state.current; const isFavorite = state.current && state.favorites.has(state.current.id); favorite.textContent = isFavorite ? '♥ Favorited' : '♡ Favorite'; favorite.setAttribute('aria-pressed', String(Boolean(isFavorite))); }
}
async function loadManifest() {
  try { const response = await fetch(MANIFEST_URL, { cache: 'no-cache' }); if (!response.ok) throw new Error('manifest unavailable'); state.manifest = await response.json(); await db.put('radio_manifests', { id: state.manifest.id || 'default', ...state.manifest, fetchedAt: Date.now() }); }
  catch { const cached = (await db.all('radio_manifests'))[0]; if (cached) state.manifest = cached; }
  render();
}
async function resolveUrl(track) {
  if (track.mediaUrl) return track.mediaUrl;
  if (!track.archiveIdentifier) return '';
  const response = await fetch(`https://archive.org/metadata/${encodeURIComponent(track.archiveIdentifier)}`);
  if (!response.ok) throw new Error('Archive metadata unavailable');
  const metadata = await response.json(); const file = (metadata.files || []).find((candidate) => /\.(mp3|flac|ogg|m4a|wav)$/i.test(candidate.name) && Number(candidate.size || 0) > 10000);
  if (!file) throw new Error('No playable audio found in archive item');
  return `https://archive.org/download/${encodeURIComponent(track.archiveIdentifier)}/${file.name.split('/').map(encodeURIComponent).join('/')}`;
}
async function cachedBlob(track) { const record = await db.get('radio_saved_tracks', track.id); return record?.audio instanceof Blob ? URL.createObjectURL(record.audio) : ''; }
async function loadAudio(track) { const local = await cachedBlob(track); if (local) { state.urls.add(local); return local; } return resolveUrl(track); }
function makeAudio(url) { const audio = new Audio(); audio.preload = 'auto'; audio.crossOrigin = 'anonymous'; audio.src = url; return audio; }
function cleanupAudio(audio) { if (!audio) return; audio.pause(); audio.removeAttribute('src'); audio.load(); }
async function playTrack(track) {
  if (!track) { setStatus(STATES.paused, 'No tracks match this era yet'); return; }
  setStatus(STATES.buffering, 'Finding transmission…');
  try {
    const url = await loadAudio(track); if (!url) throw new Error('This track has no playable media URL');
    const incoming = makeAudio(url); state.nextAudio = incoming; await incoming.play();
    const outgoing = state.activeAudio; state.activeAudio = incoming; state.nextAudio = null; state.current = track; recordRadioEvent(track, 'played'); setStatus(STATES.playing, 'ON AIR'); render();
    if (outgoing) { outgoing.volume = 1; incoming.volume = 0; const start = performance.now(); const fade = (now) => { const progress = Math.min(1, (now - start) / 900); if (outgoing) outgoing.volume = 1 - progress; incoming.volume = progress; if (progress < 1) requestAnimationFrame(fade); else cleanupAudio(outgoing); }; requestAnimationFrame(fade); }
    incoming.addEventListener('ended', () => void playNext(), { once: true });
  } catch (error) { setStatus(STATES.paused, error.message || 'Transmission unavailable'); }
}
async function playJingle() {
  const clips = (state.manifest.jingles || []).filter((clip) => clip.mediaUrl || clip.archiveIdentifier);
  if (!clips.length) return;
  const clip = clips[Math.floor(Math.random() * clips.length)];
  try { const url = await loadAudio(clip); const audio = makeAudio(url); state.nextAudio = audio; setStatus(STATES.jingle, clip.label || 'Station identification…'); await audio.play(); await new Promise((resolve) => { audio.addEventListener('ended', resolve, { once: true }); audio.addEventListener('error', resolve, { once: true }); }); cleanupAudio(audio); state.nextAudio = null; } catch { state.nextAudio = null; }
}
async function playNext() { if (state.current) recordRadioEvent(state.current, 'skipped'); const next = state.queue.shift() || chooseTrack(); if (!next) return playTrack(null); state.queue.push(chooseTrack()); await playJingle(); await playTrack(next); }
function tuningClick() { try { const context = state.audioContext ||= new AudioContext(); const buffer = context.createBuffer(1, context.sampleRate * 0.5, context.sampleRate); const data = buffer.getChannelData(0); for (let i = 0; i < data.length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) * 0.12; const source = context.createBufferSource(); const gain = context.createGain(); source.buffer = buffer; gain.gain.value = 0.25; source.connect(gain).connect(context.destination); source.start(); } catch { /* AudioContext is optional decoration. */ } }
async function saveCurrent() { if (!state.current || !state.activeAudio?.src) return; const response = await fetch(state.activeAudio.src); const audio = await response.blob(); await db.put('radio_saved_tracks', { id: state.current.id, ...state.current, audio, savedAt: Date.now() }); toast('Track saved to this device.'); }
function toggleFavorite() { if (!state.current) return; if (state.favorites.has(state.current.id)) state.favorites.delete(state.current.id); else state.favorites.add(state.current.id); localStorage.setItem(FAVORITES_KEY, JSON.stringify([...state.favorites])); void persistRadioState(); render(); toast(state.favorites.has(state.current.id) ? 'Favorite kept on this device.' : 'Favorite removed.'); }
function bind() {
  el('radioPlayButton')?.addEventListener('click', () => { if (state.status === STATES.playing || state.status === STATES.buffering || state.status === STATES.jingle) { state.activeAudio?.pause(); setStatus(STATES.paused, 'Paused'); } else { void playTrack(state.current || chooseTrack()); } });
  el('radioNextButton')?.addEventListener('click', () => void playNext());
  el('radioFavoriteButton')?.addEventListener('click', toggleFavorite);
  el('radioSaveButton')?.addEventListener('click', () => void saveCurrent().catch((error) => toast(error.message || 'Could not save this track.')));
  el('radioCloseButton')?.addEventListener('click', () => { state.activeAudio?.pause(); closeSheets(); });
  window.addEventListener('radio-open-requested', ({ detail }) => {
    const matches = contextualStations(state.manifest, detail?.context || {});
    if (matches.length) {
      const station = matches[0];
      if (state.manifest.channels?.some((channel) => channel.id === station.id)) state.channelId = station.id;
      state.current = station.tracks?.[0] || state.current;
    }
    openSheet('radioSheet'); render();
  });
}
export async function initRadio() {
  const saved = await db.get('radio_playback_state', 'current');
  if (saved) { if (Array.isArray(saved.favoriteIds)) state.favorites = new Set(saved.favoriteIds); if (Array.isArray(saved.history)) state.history = saved.history.slice(-100); }
  state.savedTrackIds = new Set((await db.all('radio_saved_tracks')).map((track) => String(track.id)));
  bind(); await loadManifest(); chooseRandomChannel(); if (!state.current) { state.current = chooseTrack(); render(); }
}
