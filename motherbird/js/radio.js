import db from './storage.js';
import { openSheet, closeSheets, toast } from './ui.js';

const MANIFEST_URL = './data/radio/manifest.json?v=20260925-radio-v7';
const SOUNDCLOUD_PLAYLISTS = Object.freeze([['Bard Songs', 'https://soundcloud.com/wellness-walks/sets/bardsongs'], ['Honky Tonk & Heartbreak', 'https://soundcloud.com/wellness-walks/sets/honkytonkandheartbreak'], ['Dylan & Dirt Roads', 'https://soundcloud.com/wellness-walks/sets/dylananddirtroads'], ['Bass House 2026', 'https://soundcloud.com/wellness-walks/sets/basshouse-2026'], ['Soul / R&B', 'https://soundcloud.com/wellness-walks/sets/soulrnb'], ['Bass House', 'https://soundcloud.com/wellness-walks/sets/basshouse'], ['World Fusion', 'https://soundcloud.com/wellness-walks/sets/worldfusion'], ['Blues Rock', 'https://soundcloud.com/wellness-walks/sets/bluesrock'], ['Funk Disco', 'https://soundcloud.com/wellness-walks/sets/funkdisco'], ['Reggae Roots', 'https://soundcloud.com/wellness-walks/sets/reggaeroots'], ['Toronto Sound', 'https://soundcloud.com/wellness-walks/sets/torontosound'], ['Bay Area Slaps', 'https://soundcloud.com/wellness-walks/sets/bayareaslaps'], ['UK Drill', 'https://soundcloud.com/wellness-walks/sets/ukdrill'], ['City Pop Nights', 'https://soundcloud.com/wellness-walks/sets/citypopnights'], ['Old World Voices', 'https://soundcloud.com/wellness-walks/sets/oldworldvoices'], ['Levant Desert', 'https://soundcloud.com/wellness-walks/sets/levantdesert'], ['Island Time', 'https://soundcloud.com/wellness-walks/sets/islandtime'], ['Folk Americana', 'https://soundcloud.com/wellness-walks/sets/folkamericana'], ['Gospel & Praise', 'https://soundcloud.com/wellness-walks/sets/gospelandpraise'], ['Long Haul', 'https://soundcloud.com/wellness-walks/sets/longhaul'], ['Rainy Day Walk', 'https://soundcloud.com/wellness-walks/sets/rainydaywalk'], ['Golden Hour', 'https://soundcloud.com/wellness-walks/sets/goldenhour'], ['Classical Focus', 'https://soundcloud.com/wellness-walks/sets/classicalfocus'], ['Metal Movement', 'https://soundcloud.com/wellness-walks/sets/metalmovement'], ['Latin Pop Fiesta', 'https://soundcloud.com/wellness-walks/sets/latinpopfiesta'], ['Country Roads', 'https://soundcloud.com/wellness-walks/sets/countryroads'], ['Punk Hardcore', 'https://soundcloud.com/wellness-walks/sets/punkhardcore'], ['K-Pop / K-Drama', 'https://soundcloud.com/wellness-walks/sets/kpopkdrama'], ['Miami Bass', 'https://soundcloud.com/wellness-walks/sets/miamibass'], ['Detroit Ghettotech', 'https://soundcloud.com/wellness-walks/sets/detroitghettotech'], ['Philly Club', 'https://soundcloud.com/wellness-walks/sets/phillyclub'], ['Study Beats', 'https://soundcloud.com/wellness-walks/sets/studybeats'], ['Sleep Sound', 'https://soundcloud.com/wellness-walks/sets/sleepsound'], ['Chill Study', 'https://soundcloud.com/wellness-walks/sets/chillstudy'], ['Ambient Focus', 'https://soundcloud.com/wellness-walks/sets/ambientfocus'], ['Focus Flow', 'https://soundcloud.com/wellness-walks/sets/focusflow'], ['Lofi Radio', 'https://soundcloud.com/wellness-walks/sets/lofiradio'], ['Deep House', 'https://soundcloud.com/wellness-walks/sets/deephouse'], ['Night Drive', 'https://soundcloud.com/wellness-walks/sets/nightdrive'], ['Global R&B', 'https://soundcloud.com/wellness-walks/sets/globalrnb'], ['Latin Trap', 'https://soundcloud.com/wellness-walks/sets/latintrap'], ['DMV Drill', 'https://soundcloud.com/wellness-walks/sets/dmvdrill']]);
const FAVORITES_KEY = 'gremlin-radio-favorites-v1';
const MINI_POSITION_KEY = 'gremlin-radio-mini-position-v1';
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

const state = { manifest: FALLBACK_MANIFEST, channelId: 'x1', status: STATES.paused, queue: [], current: null, activeAudio: null, nextAudio: null, urls: new Set(), audioContext: null, favorites: new Set(JSON.parse(localStorage.getItem(FAVORITES_KEY) || '[]')), history: [], savedTrackIds: new Set(), playbackToken: 0 };
const el = (id) => document.getElementById(id);
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[char]));
function availableStations() {
  const candidates = state.manifest.channels || state.manifest.stations || state.manifest.liveStations || state.manifest.streams || [];
  return Array.isArray(candidates) ? candidates : Object.values(candidates || {});
}

function setStatus(status, detail = '') { state.status = status; const text = detail || status; const label = el('radioStatus'); if (label) label.textContent = text; const miniStatus = el('radioMiniStatus'); if (miniStatus) miniStatus.textContent = text; el('radioPlayer')?.setAttribute('data-radio-state', status); el('radioMiniPlayer')?.classList.toggle('hidden', !state.current); updatePlayButtons(); }
function soundcloudEmbedUrl(url) { return `https://w.soundcloud.com/player/?url=${encodeURIComponent(url)}&color=%23d95f35&auto_play=false&hide_related=true&show_comments=false&show_user=true&show_reposts=false&visual=false`; }
function renderSoundcloudPlaylists() { const search = el('radioSoundcloudSearch'); const select = el('radioSoundcloudSelect'); const count = el('radioSoundcloudCount'); if (!select) return; const query = String(search?.value || '').trim().toLowerCase(); const matches = SOUNDCLOUD_PLAYLISTS.filter(([label]) => label.toLowerCase().includes(query)); const selected = select.value; select.innerHTML = matches.map(([label, url]) => `<option value="${escapeHtml(url)}">${escapeHtml(label)}</option>`).join(''); if (matches.some(([, url]) => url === selected)) select.value = selected; if (count) count.textContent = `${matches.length} of ${SOUNDCLOUD_PLAYLISTS.length} playlists`; }
function updateLivePlayer() { const enabled = el('radioLiveSources')?.checked === true; const player = el('radioLivePlayer'); const select = el('radioSoundcloudSelect'); const frame = el('radioSoundcloudFrame'); if (!player || !select || !frame) return; renderSoundcloudPlaylists(); if (enabled && !frame.src) frame.src = soundcloudEmbedUrl(select.value); player.classList.toggle('hidden', !enabled); }
function updatePlayButtons() { const playing = state.status === STATES.playing || state.status === STATES.buffering || state.status === STATES.jingle; for (const id of ['radioPlayButton', 'radioMiniPlayButton']) { const button = el(id); if (!button) continue; button.textContent = playing ? '❚❚' : '▶'; button.setAttribute('aria-label', playing ? 'Pause radio' : 'Play radio'); } }
function bindMiniPlayerDrag() { const player = el('radioMiniPlayer'); if (!player || player.dataset.dragBound) return; player.dataset.dragBound = 'true'; const clamp = () => { const x = Math.max(8, Math.min(innerWidth - player.offsetWidth - 8, player.offsetLeft)); const y = Math.max(52, Math.min(innerHeight - player.offsetHeight - 8, player.offsetTop)); player.style.left = `${x}px`; player.style.top = `${y}px`; player.style.right = 'auto'; player.style.bottom = 'auto'; player.style.transform = 'none'; }; const saved = JSON.parse(localStorage.getItem(MINI_POSITION_KEY) || 'null'); if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) { player.style.left = `${saved.x}px`; player.style.top = `${saved.y}px`; player.style.right = 'auto'; player.style.bottom = 'auto'; player.style.transform = 'none'; } let drag = null; player.addEventListener('pointerdown', (event) => { if (event.target.closest('button')) return; drag = { dx: event.clientX - player.offsetLeft, dy: event.clientY - player.offsetTop }; player.setPointerCapture(event.pointerId); player.classList.add('dragging'); }); player.addEventListener('pointermove', (event) => { if (!drag) return; const x = Math.max(8, Math.min(innerWidth - player.offsetWidth - 8, event.clientX - drag.dx)); const y = Math.max(52, Math.min(innerHeight - player.offsetHeight - 8, event.clientY - drag.dy)); player.style.left = `${x}px`; player.style.top = `${y}px`; player.style.right = 'auto'; player.style.bottom = 'auto'; player.style.transform = 'none'; }); player.addEventListener('pointerup', () => { if (!drag) return; drag = null; player.classList.remove('dragging'); clamp(); localStorage.setItem(MINI_POSITION_KEY, JSON.stringify({ x: player.offsetLeft, y: player.offsetTop })); }); window.addEventListener('resize', clamp); }
function pauseRadio() { state.playbackToken += 1; state.nextAudio?.pause(); state.nextAudio = null; state.activeAudio?.pause(); setStatus(STATES.paused, 'Paused'); updatePlayButtons(); }
async function persistRadioState() {
  await db.put('radio_playback_state', { id: 'current', channelId: state.channelId, favoriteIds: [...state.favorites], history: state.history.slice(-100), updatedAt: Date.now() });
}
function recordRadioEvent(track, event) { if (!track?.id) return; state.history.push({ trackId: String(track.id), event, channelId: state.channelId, at: Date.now() }); void persistRadioState(); }
function tracksForChannel() { const tracks = (state.manifest.tracks || []).filter((track) => !track.channel || track.channel === state.channelId || track.channelIds?.includes(state.channelId)); if (tracks.length || state.channelId !== 'jazz-club') return tracks; return [{ id: 'big-band-fallback', channel: 'jazz-club', title: 'Big Band Broadcast · public-domain set', genre: 'Big Band', archiveIdentifier: 'big-band-special', rightsStatus: 'review-required' }]; }
function sourceEnabled(track) { const live = el('radioLiveSources')?.checked !== false; const local = el('radioLocalSources')?.checked !== false; const kind = String(track?.sourceType || track?.source || track?.kind || '').toLowerCase(); if (!kind) return live || local; if (kind.includes('live') || kind.includes('broadcast')) return live; return local; }
function chooseTrack() { const candidates = tracksForChannel().filter(sourceEnabled); if (!candidates.length) return null; const slot = Math.floor((Date.now() - Date.parse(state.manifest.epoch || '1950-01-01')) / ((state.manifest.slotMinutes || 45) * 60000)); return candidates[Math.abs(slot) % candidates.length]; }
function chooseNextTrack() { const candidates = tracksForChannel().filter(sourceEnabled); if (!candidates.length) return null; const currentIndex = candidates.findIndex((track) => String(track.id) === String(state.current?.id)); return candidates[(currentIndex + 1 + candidates.length) % candidates.length]; }
function chooseRandomChannel(exclude = null) { const channels = (state.manifest.channels || state.manifest.stations || []).filter((channel) => String(channel.id) !== String(exclude)); if (!channels.length) return; const learnedTrackIds = new Set([...state.savedTrackIds, ...state.favorites].map(String)); const learnedChannels = new Set((state.manifest.tracks || []).filter((track) => learnedTrackIds.has(String(track.id))).flatMap((track) => [track.channel, ...(track.channelIds || [])].filter(Boolean)).map(String)); const weighted = channels.flatMap((channel) => [channel, ...(learnedChannels.has(String(channel.id)) ? [channel, channel] : [])]); state.channelId = weighted[Math.floor(Math.random() * weighted.length)]?.id || channels[0].id; }
function render() {
  const channel = state.manifest.channels?.find((item) => item.id === state.channelId);
  if (el('radioChannelDescription')) el('radioChannelDescription').textContent = channel?.description || 'Tune the dial to select a broadcast.';
  const title = state.current ? `${state.current.title} · ${state.current.broadcastDate || state.current.year || 'undated'}` : 'No transmission selected';
  if (el('radioNowPlaying')) el('radioNowPlaying').textContent = title;
  if (el('radioMiniTitle')) el('radioMiniTitle').textContent = title;
  const favorite = el('radioFavoriteButton'); if (favorite) { favorite.disabled = !state.current; const isFavorite = state.current && state.favorites.has(state.current.id); favorite.textContent = isFavorite ? '♥ Favorited' : '♡ Favorite'; favorite.setAttribute('aria-pressed', String(Boolean(isFavorite))); }
  const stations = availableStations();
  if (el('radioStationCount')) el('radioStationCount').textContent = `${stations.length} station${stations.length === 1 ? '' : 's'} available`;
  const picker = el('radioFavoritesSelect');
  if (picker) {
    const favorites = stations.filter((station) => state.favorites.has(station.id) || (state.manifest.tracks || []).some((track) => state.favorites.has(track.id) && (track.channel === station.id || track.channelIds?.includes(station.id))));
    picker.innerHTML = '<option value="">Choose a favorite station</option>' + favorites.map((station) => `<option value="${escapeHtml(station.id)}">${escapeHtml(station.name || station.title || station.id)}</option>`).join('');
    picker.value = stations.some((station) => station.id === state.channelId && state.favorites.has(station.id)) ? state.channelId : '';
  }
  updatePlayButtons();
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
  if (!track) { setStatus(STATES.paused, 'No broadcasts available'); return; }
  if (track.rightsStatus === 'external-player-link' && track.sourceUrl) {
    window.open(track.sourceUrl, '_blank', 'noopener,noreferrer');
    state.current = track;
    recordRadioEvent(track, 'opened');
    setStatus(STATES.paused, 'Opened official station player');
    render();
    return;
  }
  const token = ++state.playbackToken;
  setStatus(STATES.buffering, 'Finding transmission…');
  try {
    const url = await loadAudio(track); if (!url) throw new Error('This track has no playable media URL');
    if (token !== state.playbackToken) return;
    const incoming = makeAudio(url); state.nextAudio = incoming; await incoming.play();
    if (token !== state.playbackToken) { cleanupAudio(incoming); return; }
    const outgoing = state.activeAudio; state.activeAudio = incoming; state.nextAudio = null; state.current = track; recordRadioEvent(track, 'played'); setStatus(STATES.playing, 'ON AIR'); render();
    if (outgoing) { outgoing.volume = 1; incoming.volume = 0; const start = performance.now(); const fade = (now) => { const progress = Math.min(1, (now - start) / 900); if (outgoing) outgoing.volume = 1 - progress; incoming.volume = progress; if (progress < 1) requestAnimationFrame(fade); else cleanupAudio(outgoing); }; requestAnimationFrame(fade); }
    incoming.addEventListener('ended', () => void playNext(), { once: true });
  } catch (error) { if (token === state.playbackToken) setStatus(STATES.paused, error.message || 'Transmission unavailable'); }
}
async function playJingle() {
  const token = ++state.playbackToken;
  const clips = (state.manifest.jingles || []).filter((clip) => clip.mediaUrl || clip.archiveIdentifier);
  if (!clips.length) return true;
  const clip = clips[Math.floor(Math.random() * clips.length)];
  try { const url = await loadAudio(clip); if (token !== state.playbackToken) return false; const audio = makeAudio(url); state.nextAudio = audio; setStatus(STATES.jingle, clip.label || 'Station identification…'); await audio.play(); await new Promise((resolve) => { const finish = () => { cleanupAudio(audio); resolve(); }; audio.addEventListener('ended', finish, { once: true }); audio.addEventListener('error', finish, { once: true }); const watch = () => { if (token !== state.playbackToken) finish(); else if (state.nextAudio === audio) requestAnimationFrame(watch); }; watch(); }); if (state.nextAudio === audio) state.nextAudio = null; return token === state.playbackToken; } catch { if (state.nextAudio) state.nextAudio = null; return false; }
}
async function playNext() { if (state.current) recordRadioEvent(state.current, 'skipped'); state.queue = []; const next = chooseNextTrack() || chooseTrack(); if (!next) return playTrack(null); if (!(await playJingle())) return; await playTrack(next); }
function tuningClick() { try { const context = state.audioContext ||= new AudioContext(); const buffer = context.createBuffer(1, context.sampleRate * 0.5, context.sampleRate); const data = buffer.getChannelData(0); for (let i = 0; i < data.length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) * 0.12; const source = context.createBufferSource(); const gain = context.createGain(); source.buffer = buffer; gain.gain.value = 0.25; source.connect(gain).connect(context.destination); source.start(); } catch { /* AudioContext is optional decoration. */ } }
function toggleFavorite() { if (!state.current) return; if (state.favorites.has(state.current.id)) state.favorites.delete(state.current.id); else state.favorites.add(state.current.id); localStorage.setItem(FAVORITES_KEY, JSON.stringify([...state.favorites])); void persistRadioState(); render(); toast(state.favorites.has(state.current.id) ? 'Favorite kept on this device.' : 'Favorite removed.'); }
function bind() {
  bindMiniPlayerDrag();
  const togglePlayback = () => { if (state.status === STATES.playing || state.status === STATES.buffering || state.status === STATES.jingle) pauseRadio(); else void playTrack(state.current || chooseTrack()); };
  el('radioPlayButton')?.addEventListener('click', togglePlayback); el('radioMiniPlayButton')?.addEventListener('click', togglePlayback);
  el('radioNextButton')?.addEventListener('click', () => void playNext());
  el('radioMiniNextButton')?.addEventListener('click', () => void playNext());
  el('radioFavoriteButton')?.addEventListener('click', toggleFavorite);
  el('radioFavoritesSelect')?.addEventListener('change', (event) => {
    const station = availableStations().find((item) => String(item.id) === String(event.target.value));
    if (!station) return;
    state.channelId = station.id;
    state.current = chooseTrack();
    render();
  });
  el('radioLiveSources')?.addEventListener('change', () => { updateLivePlayer(); state.current = chooseTrack(); render(); });
  el('radioLocalSources')?.addEventListener('change', () => { state.current = chooseTrack(); render(); });
  el('radioSoundcloudSelect')?.addEventListener('change', (event) => { const frame = el('radioSoundcloudFrame'); if (frame) frame.src = soundcloudEmbedUrl(event.target.value); });
  el('radioSoundcloudSearch')?.addEventListener('input', () => { const previous = el('radioSoundcloudSelect')?.value; renderSoundcloudPlaylists(); const select = el('radioSoundcloudSelect'); const frame = el('radioSoundcloudFrame'); if (select && frame && select.value && select.value !== previous) frame.src = soundcloudEmbedUrl(select.value); });
  el('radioCloseButton')?.addEventListener('click', () => closeSheets());
  el('radioMiniOpenButton')?.addEventListener('click', () => openSheet('radioSheet'));
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
  bind(); updateLivePlayer(); await loadManifest(); const firstStation = (state.manifest.channels || [])[0]; state.channelId = firstStation?.id || state.channelId; if (!state.current) { state.current = chooseTrack(); render(); }
}
