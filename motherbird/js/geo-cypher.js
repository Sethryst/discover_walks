import db from './storage.js';
import { state } from './state.js';
import { distanceMeters } from './geo.js';
import { el, escapeHtml, formatDistance } from './utils.js';
import { openSheet } from './ui.js';

const SCHEMA_VERSION = 1, MAX_DURATION_MS = 120000, DEFAULT_RADIUS_METERS = 50;
const encoder = new TextEncoder();
let recorder, stream, stopTimer, responseTo, activeAudio, audioUrl;
let activity = new Map();

const bytesToBase64 = bytes => { let value = ''; bytes.forEach(byte => { value += String.fromCharCode(byte); }); return btoa(value); };
const base64ToBytes = value => Uint8Array.from(atob(value), character => character.charCodeAt(0));

export function canonicalLineagePayload(pin) {
  return JSON.stringify({ schemaVersion: pin.schemaVersion, id: pin.id, createdAt: pin.createdAt, lat: pin.lat, lng: pin.lng, radiusMeters: pin.radiusMeters, durationMs: pin.durationMs, mimeType: pin.mimeType, contentHash: pin.contentHash, creatorKeyId: pin.creatorKeyId, lineage: pin.lineage });
}
async function sha256(value) {
  const bytes = value instanceof Blob ? new Uint8Array(await value.arrayBuffer()) : encoder.encode(value);
  return bytesToBase64(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
}
export async function publicKeyId(jwk) { return (await sha256(JSON.stringify(jwk))).slice(0, 22); }

async function deviceSigningIdentity() {
  const saved = await db.get('geo_cypher_keys', 'device-signing-key');
  if (saved?.privateKey && saved?.publicKey) return saved;
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
  const publicKeyJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const identity = { id: 'device-signing-key', algorithm: 'ECDSA-P256-SHA256', keyId: await publicKeyId(publicKeyJwk), publicKeyJwk, publicKey: pair.publicKey, privateKey: pair.privateKey, createdAt: new Date().toISOString() };
  await db.put('geo_cypher_keys', identity);
  return identity;
}
export async function signGeoCypher(pin, identity) {
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, identity.privateKey, encoder.encode(canonicalLineagePayload(pin)));
  return { ...pin, signatureAlgorithm: identity.algorithm, publicKeyJwk: identity.publicKeyJwk, signature: bytesToBase64(new Uint8Array(signature)) };
}
export async function verifyGeoCypherManifest(pin) {
  if (!pin?.signature || !pin?.publicKeyJwk || pin.signatureAlgorithm !== 'ECDSA-P256-SHA256') return false;
  try {
    if (await publicKeyId(pin.publicKeyJwk) !== pin.creatorKeyId) return false;
    if (!pin.lineage?.rootId || (Number(pin.lineage.generation) === 0 && (pin.lineage.parentId || pin.lineage.rootId !== pin.id))) return false;
    const key = await crypto.subtle.importKey('jwk', pin.publicKeyJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    return crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, base64ToBytes(pin.signature), encoder.encode(canonicalLineagePayload(pin)));
  } catch { return false; }
}
export async function verifyGeoCypher(pin, audio = pin?.audio) { return audio instanceof Blob && await verifyGeoCypherManifest(pin) && await sha256(audio) === pin.contentHash; }

export function encounterState({ verified, inRange, prompted, events = [] }) {
  if (!verified) return 'unavailable';
  if (events.includes('responded')) return 'responded';
  if (events.includes('dismissed')) return 'dismissed';
  if (events.includes('started')) return events.includes('completed') ? 'ready' : 'playing';
  if (inRange && prompted) return 'entered';
  return inRange ? 'ready' : 'nearby';
}
function supportedAudioType(Recorder = globalThis.MediaRecorder) { return ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'].find(type => Recorder?.isTypeSupported?.(type)) || ''; }
function pinLocation() {
  const fix = state.lastPosition || state.currentPosition;
  if (Number.isFinite(fix?.lat) && Number.isFinite(fix?.lng)) return { lat: fix.lat, lng: fix.lng, source: 'gps' };
  const center = state.map?.getCenter?.();
  return Number.isFinite(center?.lat) && Number.isFinite(center?.lng) ? { lat: center.lat, lng: center.lng, source: 'map-center' } : null;
}
async function recordEvent(pinId, type) {
  await db.put('geo_cypher_events', { id: crypto.randomUUID(), pinId, type, createdAt: new Date().toISOString() });
  activity.set(pinId, [...(activity.get(pinId) || []), type]);
}
async function saveRecording(audio, durationMs, parent) {
  const identity = await deviceSigningIdentity(), id = crypto.randomUUID(), location = pinLocation();
  if (!location) throw new Error('A map location is required.');
  const unsigned = { schemaVersion: SCHEMA_VERSION, id, createdAt: new Date().toISOString(), lat: Number(location.lat.toFixed(6)), lng: Number(location.lng.toFixed(6)), locationSource: location.source, radiusMeters: Number(state.settings?.defaultGeofenceRadiusMeters) || DEFAULT_RADIUS_METERS, durationMs: Math.min(durationMs, MAX_DURATION_MS), mimeType: audio.type || 'audio/webm', contentHash: await sha256(audio), creatorKeyId: identity.keyId, lineage: { rootId: parent?.lineage?.rootId || parent?.id || id, parentId: parent?.id || null, generation: parent ? Number(parent.lineage?.generation || 0) + 1 : 0 } };
  const signed = await signGeoCypher(unsigned, identity);
  await db.putMany({ geo_cypher_manifests: [signed], geo_cypher_audio: [{ id, audio }] });
  state.geoCyphers = [signed, ...state.geoCyphers];
  await recordEvent(id, 'created');
  if (parent) await recordEvent(parent.id, 'responded');
  return signed;
}
const setStatus = message => { if (el('geoCypherStatus')) el('geoCypherStatus').textContent = message; };
function finishCaptureUi(message) {
  clearTimeout(stopTimer); stopTimer = null; stream?.getTracks().forEach(track => track.stop()); stream = null; recorder = null;
  if (el('geoCypherRecordButton')) { el('geoCypherRecordButton').textContent = responseTo ? 'Record response' : 'Drop audio here'; el('geoCypherRecordButton').setAttribute('aria-pressed', 'false'); }
  if (message) setStatus(message);
}
async function startRecording(parent = responseTo) {
  if (!navigator.mediaDevices?.getUserMedia || !globalThis.MediaRecorder) { setStatus('Recording is unavailable here. You can still listen or dismiss an encounter.'); return; }
  const location = pinLocation();
  if (!location) { setStatus('Choose Locate on your phone, or center the desktop map where you want to leave audio.'); return; }
  setStatus(`Microphone access is needed only to record ${parent ? 'this response' : 'this audio'}.`);
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const chunks = [], mimeType = supportedAudioType(), startedAt = Date.now();
    recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    recorder.ondataavailable = event => { if (event.data?.size) chunks.push(event.data); };
    recorder.onerror = () => finishCaptureUi('Recording stopped unexpectedly. Nothing was saved.');
    recorder.onstop = async () => {
      const audio = new Blob(chunks, { type: recorder?.mimeType || mimeType || 'audio/webm' });
      finishCaptureUi('Securing audio…');
      if (!audio.size) { setStatus('No audio was captured. Nothing was saved.'); return; }
      try {
        const saved = await saveRecording(audio, Date.now() - startedAt, parent); responseTo = null; el('geoCypherCancelResponse')?.classList.add('hidden');
        setStatus(saved.lineage.parentId ? 'Response saved and linked to the audio you heard.' : `Audio saved at ${location.source === 'gps' ? 'your position' : 'the map center'}.`); await renderGeoCyphers();
      } catch (error) { console.error('Geo Cypher save failed', error); setStatus(error?.name === 'QuotaExceededError' ? 'This device is out of audio space. Remove an older pin and try again.' : 'Audio could not be secured or saved. Nothing was published.'); }
    };
    recorder.start(1000); stopTimer = setTimeout(() => recorder?.state === 'recording' && recorder.stop(), MAX_DURATION_MS);
    el('geoCypherRecordButton').textContent = 'Stop recording'; el('geoCypherRecordButton').setAttribute('aria-pressed', 'true');
    setStatus(parent ? 'Recording your response now. It will stay linked to the source.' : 'Recording now at this location. Tap stop when you’re done (two-minute maximum).');
  } catch (error) { finishCaptureUi(error?.name === 'NotAllowedError' ? 'Microphone access was not granted. Nothing was recorded; you can try again anytime.' : 'The microphone could not start. Nothing was saved.'); }
}
async function toggleRecording() { if (recorder?.state === 'recording') recorder.stop(); else await startRecording(); }
function stopPlayback() { activeAudio?.pause(); activeAudio = null; if (audioUrl) URL.revokeObjectURL(audioUrl); audioUrl = null; }
const referencePoint = () => state.lastPosition || state.currentPosition || state.map?.getCenter?.() || null;

export async function renderGeoCyphers() {
  const list = el('geoCypherList'); if (!list) return;
  const point = referencePoint();
  const rows = await Promise.all(state.geoCyphers.map(async pin => ({ pin, verified: await verifyGeoCypherManifest(pin), distance: point ? distanceMeters(point, pin) : Infinity })));
  rows.sort((a, b) => a.distance - b.distance || Date.parse(b.pin.createdAt) - Date.parse(a.pin.createdAt));
  const visible = rows.filter(({ pin }) => !activity.get(pin.id)?.includes('removed'));
  list.innerHTML = visible.length ? visible.map(({ pin, verified, distance }) => {
    const inRange = distance <= pin.radiusMeters, events = activity.get(pin.id) || [], status = encounterState({ verified, inRange, prompted: state.geoCypherPrompted.has(pin.id), events }), ready = verified && inRange && status !== 'dismissed';
    const distanceLabel = Number.isFinite(distance) ? (distance < 1000 ? `${Math.round(distance)} m` : `${formatDistance(distance)} mi`) : 'location unavailable';
    const generation = Number(pin.lineage?.generation || 0), labels = { nearby: 'Nearby — walk into range', entered: 'Entered — ready to hear', ready: 'Ready to hear', playing: 'Playing', dismissed: 'Dismissed', responded: 'Responded', unavailable: 'Unavailable' };
    const provenance = verified ? `Anonymous · ${generation ? `reply ${generation} in this thread` : 'original audio'} · origin verified` : 'Integrity check failed — playback disabled';
    return `<article class="geo-cypher-card ${inRange ? 'is-triggered' : ''} ${verified ? '' : 'is-unavailable'}" data-geo-cypher-id="${escapeHtml(pin.id)}"><button class="geo-cypher-play" type="button" aria-label="Play audio from Anonymous" ${ready ? '' : 'disabled'}>▶</button><div class="geo-cypher-meta"><strong>${labels[status]}</strong><small>${escapeHtml(distanceLabel)} · ${Math.ceil(pin.durationMs / 1000)} sec</small><small class="geo-cypher-lineage">${escapeHtml(provenance)}</small></div><div class="geo-cypher-card-actions">${ready ? '<button class="primary-button geo-cypher-respond" type="button">Respond now</button>' : ''}${verified && status !== 'dismissed' ? '<button class="secondary-button geo-cypher-dismiss" type="button">Dismiss</button>' : ''}<button class="secondary-button geo-cypher-remove" type="button">Remove</button></div>${verified ? '<p class="geo-cypher-more">A signature confirms this audio and its reply path have not changed. It does not endorse what was said.</p>' : ''}</article>`;
  }).join('') : '<p class="geo-cypher-empty">No audio here yet. Drop the first one when you’re ready.</p>';
}
async function playPin(pin) {
  stopPlayback(); const media = await db.get('geo_cypher_audio', pin.id);
  if (!media?.audio) { setStatus('This audio is no longer available on this device.'); return; }
  if (!await verifyGeoCypher(pin, media.audio)) { setStatus('This audio did not pass its integrity check, so it will not play. You can remove it.'); await renderGeoCyphers(); return; }
  audioUrl = URL.createObjectURL(media.audio); activeAudio = new Audio(audioUrl);
  activeAudio.addEventListener('ended', async () => { await recordEvent(pin.id, 'completed'); stopPlayback(); setStatus('Finished. Respond now, replay, or keep walking.'); await renderGeoCyphers(); }, { once: true });
  activeAudio.addEventListener('error', () => { stopPlayback(); setStatus('This browser could not play the audio. The pin is still saved.'); }, { once: true });
  try { await activeAudio.play(); await recordEvent(pin.id, 'started'); setStatus('Playing audio from Anonymous.'); await renderGeoCyphers(); } catch { stopPlayback(); setStatus('Playback could not start. Check silent mode or volume, then try again.'); }
}
async function removePin(pin) { stopPlayback(); await db.putMany({}, { geo_cypher_manifests: [pin.id], geo_cypher_audio: [pin.id], geo_cyphers: [pin.id] }); await recordEvent(pin.id, 'removed'); state.geoCyphers = state.geoCyphers.filter(item => item.id !== pin.id); setStatus('Audio removed from this device.'); await renderGeoCyphers(); }
export async function openGeoCypher() { openSheet('geoCypherSheet'); await renderGeoCyphers(); }
export async function checkGeoCypherGeofences(point) {
  for (const pin of state.geoCyphers) {
    if (state.geoCypherPrompted.has(pin.id) || activity.get(pin.id)?.some(type => type === 'dismissed' || type === 'removed') || distanceMeters(point, pin) > pin.radiusMeters) continue;
    state.geoCypherPrompted.add(pin.id); await recordEvent(pin.id, 'encountered'); globalThis.window?.dispatchEvent(new CustomEvent('geo-cypher-encountered', { detail: { id: pin.id } }));
  }
  if (state.modalOpen === 'geoCypherSheet') await renderGeoCyphers();
}
async function migrateLegacyPins() {
  for (const pin of await db.all('geo_cyphers')) {
    if (!pin?.audio || await db.get('geo_cypher_manifests', pin.id)) continue;
    const { audio, ...manifest } = pin; await db.putMany({ geo_cypher_manifests: [manifest], geo_cypher_audio: [{ id: pin.id, audio }] });
  }
}
export async function initGeoCypher() {
  await migrateLegacyPins(); state.geoCyphers = await db.all('geo_cypher_manifests'); activity = new Map();
  for (const event of await db.all('geo_cypher_events')) activity.set(event.pinId, [...(activity.get(event.pinId) || []), event.type]);
  for (const [pinId, events] of activity) if (events.includes('encountered') && !events.includes('dismissed')) state.geoCypherPrompted.add(pinId);
  el('geoCypherRecordButton')?.addEventListener('click', () => void toggleRecording());
  el('geoCypherCancelResponse')?.addEventListener('click', () => { responseTo = null; el('geoCypherCancelResponse').classList.add('hidden'); el('geoCypherRecordButton').textContent = 'Drop audio here'; setStatus('Response cancelled.'); });
  el('geoCypherList')?.addEventListener('click', event => {
    const pin = state.geoCyphers.find(item => item.id === event.target.closest('[data-geo-cypher-id]')?.dataset.geoCypherId); if (!pin) return;
    if (event.target.closest('.geo-cypher-play')) void playPin(pin);
    if (event.target.closest('.geo-cypher-respond')) { responseTo = pin; el('geoCypherCancelResponse')?.classList.remove('hidden'); el('geoCypherRecordButton').textContent = 'Record response'; void startRecording(pin); }
    if (event.target.closest('.geo-cypher-dismiss')) void recordEvent(pin.id, 'dismissed').then(() => { setStatus('Dismissed. This encounter will stay quiet.'); return renderGeoCyphers(); });
    if (event.target.closest('.geo-cypher-remove')) void removePin(pin);
  });
  globalThis.window?.addEventListener('walk-position-received', event => void checkGeoCypherGeofences(event.detail));
  globalThis.window?.addEventListener('geo-cypher-encountered', () => setStatus('You entered an audio circle. Open Audio when you’re ready to listen.'));
  globalThis.window?.addEventListener('pagehide', stopPlayback);
}
export const GEO_CYPHER_MAX_DURATION_MS = MAX_DURATION_MS;
