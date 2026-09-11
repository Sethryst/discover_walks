import db from './storage.js';
import { state } from './state.js';
import { distanceMeters } from './geo.js';
import { el, escapeHtml, formatDistance } from './utils.js';
import { openSheet } from './ui.js';

const SCHEMA_VERSION = 1;
const MAX_DURATION_MS = 120000;
const DEFAULT_RADIUS_METERS = 50;
const encoder = new TextEncoder();
let recorder = null;
let stream = null;
let stopTimer = null;
let responseTo = null;
let audioUrl = null;

const bytesToBase64 = (bytes) => {
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
};
const base64ToBytes = (value) => Uint8Array.from(atob(value), (character) => character.charCodeAt(0));

export function canonicalLineagePayload(pin) {
  return JSON.stringify({
    schemaVersion: pin.schemaVersion,
    id: pin.id,
    createdAt: pin.createdAt,
    lat: pin.lat,
    lng: pin.lng,
    radiusMeters: pin.radiusMeters,
    durationMs: pin.durationMs,
    mimeType: pin.mimeType,
    contentHash: pin.contentHash,
    creatorKeyId: pin.creatorKeyId,
    lineage: pin.lineage
  });
}

async function sha256(value) {
  const bytes = value instanceof Blob ? new Uint8Array(await value.arrayBuffer()) : encoder.encode(value);
  return bytesToBase64(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
}

export async function publicKeyId(publicKeyJwk) {
  return (await sha256(JSON.stringify(publicKeyJwk))).slice(0, 22);
}

async function deviceSigningIdentity() {
  const saved = await db.get('geo_cypher_keys', 'device-signing-key');
  if (saved?.privateKey && saved?.publicKey) return saved;
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
  const publicKeyJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const identity = {
    id: 'device-signing-key',
    algorithm: 'ECDSA-P256-SHA256',
    keyId: await publicKeyId(publicKeyJwk),
    publicKeyJwk,
    publicKey: pair.publicKey,
    privateKey: pair.privateKey,
    createdAt: new Date().toISOString()
  };
  await db.put('geo_cypher_keys', identity);
  return identity;
}

export async function signGeoCypher(pin, identity) {
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, identity.privateKey, encoder.encode(canonicalLineagePayload(pin)));
  return { ...pin, signatureAlgorithm: identity.algorithm, publicKeyJwk: identity.publicKeyJwk, signature: bytesToBase64(new Uint8Array(signature)) };
}

export async function verifyGeoCypher(pin) {
  if (!pin?.signature || !pin?.publicKeyJwk || pin.signatureAlgorithm !== 'ECDSA-P256-SHA256') return false;
  try {
    const hashMatches = pin.audio instanceof Blob && await sha256(pin.audio) === pin.contentHash;
    if (!hashMatches) return false;
    if (await publicKeyId(pin.publicKeyJwk) !== pin.creatorKeyId) return false;
    const publicKey = await crypto.subtle.importKey('jwk', pin.publicKeyJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    return crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey, base64ToBytes(pin.signature), encoder.encode(canonicalLineagePayload(pin)));
  } catch { return false; }
}

function supportedAudioType(Recorder = globalThis.MediaRecorder) {
  return ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'].find((type) => Recorder?.isTypeSupported?.(type)) || '';
}

function pinLocation() {
  const fix = state.lastPosition || state.currentPosition;
  if (Number.isFinite(fix?.lat) && Number.isFinite(fix?.lng)) return { lat: fix.lat, lng: fix.lng, source: 'gps' };
  const center = state.map?.getCenter?.();
  if (Number.isFinite(center?.lat) && Number.isFinite(center?.lng)) return { lat: center.lat, lng: center.lng, source: 'map-center' };
  return null;
}

async function recordEvent(pinId, type) {
  await db.put('geo_cypher_events', { id: crypto.randomUUID(), pinId, type, createdAt: new Date().toISOString() });
}

async function saveRecording(audio, durationMs, parent) {
  const identity = await deviceSigningIdentity();
  const id = crypto.randomUUID();
  const location = pinLocation();
  if (!location) throw new Error('A map location is required.');
  const rootId = parent?.lineage?.rootId || parent?.id || id;
  const unsigned = {
    schemaVersion: SCHEMA_VERSION,
    id,
    createdAt: new Date().toISOString(),
    lat: Number(location.lat.toFixed(6)),
    lng: Number(location.lng.toFixed(6)),
    locationSource: location.source,
    radiusMeters: Number(state.settings?.defaultGeofenceRadiusMeters) || DEFAULT_RADIUS_METERS,
    durationMs: Math.min(durationMs, MAX_DURATION_MS),
    mimeType: audio.type || 'audio/webm',
    audio,
    contentHash: await sha256(audio),
    creatorKeyId: identity.keyId,
    lineage: { rootId, parentId: parent?.id || null, generation: parent ? Number(parent.lineage?.generation || 0) + 1 : 0 }
  };
  const signed = await signGeoCypher(unsigned, identity);
  await db.put('geo_cyphers', signed);
  state.geoCyphers = [signed, ...state.geoCyphers.filter((pin) => pin.id !== signed.id)];
  await recordEvent(signed.id, 'created');
  return signed;
}

function setStatus(message) { if (el('geoCypherStatus')) el('geoCypherStatus').textContent = message; }

async function toggleRecording() {
  if (recorder?.state === 'recording') { recorder.stop(); return; }
  if (!navigator.mediaDevices?.getUserMedia || !globalThis.MediaRecorder) { setStatus('Audio recording is unavailable in this browser.'); return; }
  const mimeType = supportedAudioType();
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const chunks = [];
    const startedAt = Date.now();
    recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    recorder.ondataavailable = (event) => { if (event.data?.size) chunks.push(event.data); };
    recorder.onerror = () => finishCaptureUi('Recording failed. No pin was saved.');
    recorder.onstop = async () => {
      const durationMs = Date.now() - startedAt;
      const audio = new Blob(chunks, { type: recorder?.mimeType || mimeType || 'audio/webm' });
      finishCaptureUi('Signing audio lineage…');
      if (!audio.size) { setStatus('No audio was captured.'); return; }
      try {
        const saved = await saveRecording(audio, durationMs, responseTo);
        responseTo = null;
        el('geoCypherCancelResponse')?.classList.add('hidden');
        setStatus(saved.lineage.parentId ? 'Signed response saved. Recording began without an attribution delay.' : 'Signed audio pin saved at this location.');
        await renderGeoCyphers();
      } catch (error) { console.warn(error); setStatus('Audio could not be signed or saved on this device.'); }
    };
    recorder.start(1000);
    stopTimer = setTimeout(() => recorder?.state === 'recording' && recorder.stop(), MAX_DURATION_MS);
    el('geoCypherRecordButton').textContent = 'Stop recording';
    el('geoCypherRecordButton').setAttribute('aria-pressed', 'true');
    setStatus(responseTo ? 'Recording a response now. It will link to the source signature.' : 'Recording now. Maximum length is two minutes.');
  } catch (error) {
    finishCaptureUi(error?.name === 'NotAllowedError' ? 'Microphone permission was not granted.' : 'Recording could not start.');
  }
}

function finishCaptureUi(message) {
  clearTimeout(stopTimer); stopTimer = null;
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
  recorder = null;
  if (el('geoCypherRecordButton')) {
    el('geoCypherRecordButton').textContent = responseTo ? 'Record response' : 'Drop audio here';
    el('geoCypherRecordButton').setAttribute('aria-pressed', 'false');
  }
  if (message) setStatus(message);
}

function referencePoint() {
  return state.lastPosition || state.currentPosition || state.map?.getCenter?.() || null;
}

export async function renderGeoCyphers() {
  const list = el('geoCypherList');
  if (!list) return;
  const point = referencePoint();
  const rows = await Promise.all(state.geoCyphers.map(async (pin) => ({ pin, verified: await verifyGeoCypher(pin), distance: point ? distanceMeters(point, pin) : Infinity })));
  rows.sort((a, b) => a.distance - b.distance || Date.parse(b.pin.createdAt) - Date.parse(a.pin.createdAt));
  list.innerHTML = rows.length ? rows.map(({ pin, verified, distance }) => {
    const triggered = state.geoCypherPrompted.has(pin.id) || distance <= pin.radiusMeters;
    const distanceLabel = Number.isFinite(distance) ? (distance < 1000 ? `${Math.round(distance)} m` : `${formatDistance(distance)} mi`) : 'location unavailable';
    const generation = Number(pin.lineage?.generation || 0);
    return `<article class="geo-cypher-card ${triggered ? 'is-triggered' : ''}" data-geo-cypher-id="${escapeHtml(pin.id)}"><button class="geo-cypher-play" type="button" aria-label="Play audio" ${triggered ? '' : 'disabled'}>▶</button><div class="geo-cypher-meta"><strong>${triggered ? 'Audio encountered' : 'Audio nearby'}</strong><small>${escapeHtml(distanceLabel)} · ${Math.ceil(pin.durationMs / 1000)} sec</small><small class="geo-cypher-lineage">${verified ? '✓ signed lineage' : 'signature unavailable'}${generation ? ` · response ${generation}` : ''}</small></div><button class="secondary-button geo-cypher-respond" type="button" ${triggered ? '' : 'disabled'}>Respond</button></article>`;
  }).join('') : '<p class="geo-cypher-empty">No audio pins on this device yet.</p>';
}

async function playPin(pin) {
  if (audioUrl) URL.revokeObjectURL(audioUrl);
  audioUrl = URL.createObjectURL(pin.audio);
  const audio = new Audio(audioUrl);
  await recordEvent(pin.id, 'started');
  audio.addEventListener('ended', () => void recordEvent(pin.id, 'completed'), { once: true });
  try { await audio.play(); setStatus('Playing encountered audio.'); }
  catch { setStatus('Playback was blocked. Tap play again.'); }
}

function beginResponse(pin) {
  responseTo = pin;
  el('geoCypherCancelResponse')?.classList.remove('hidden');
  el('geoCypherRecordButton').textContent = 'Record response';
  setStatus('Ready. Recording starts immediately and the saved pin will reference the source signature.');
}

export async function openGeoCypher() {
  openSheet('geoCypherSheet');
  await renderGeoCyphers();
}

export async function checkGeoCypherGeofences(point) {
  for (const pin of state.geoCyphers) {
    if (state.geoCypherPrompted.has(pin.id) || distanceMeters(point, pin) > pin.radiusMeters) continue;
    state.geoCypherPrompted.add(pin.id);
    await recordEvent(pin.id, 'encountered');
    globalThis.window?.dispatchEvent(new CustomEvent('geo-cypher-encountered', { detail: { id: pin.id } }));
  }
  if (state.modalOpen === 'geoCypherSheet') await renderGeoCyphers();
}

export async function initGeoCypher() {
  state.geoCyphers = await db.all('geo_cyphers');
  el('geoCypherRecordButton')?.addEventListener('click', () => void toggleRecording());
  el('geoCypherCancelResponse')?.addEventListener('click', () => {
    responseTo = null;
    el('geoCypherCancelResponse').classList.add('hidden');
    el('geoCypherRecordButton').textContent = 'Drop audio here';
    setStatus('Response cancelled.');
  });
  el('geoCypherList')?.addEventListener('click', (event) => {
    const card = event.target.closest('[data-geo-cypher-id]');
    const pin = state.geoCyphers.find((candidate) => candidate.id === card?.dataset.geoCypherId);
    if (!pin) return;
    if (event.target.closest('.geo-cypher-play')) void playPin(pin);
    if (event.target.closest('.geo-cypher-respond')) beginResponse(pin);
  });
  globalThis.window?.addEventListener('walk-position-received', (event) => void checkGeoCypherGeofences(event.detail));
  globalThis.window?.addEventListener('geo-cypher-encountered', () => setStatus('You entered an audio pin. Open Audio to listen.'));
}

export const GEO_CYPHER_MAX_DURATION_MS = MAX_DURATION_MS;
