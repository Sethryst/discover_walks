import { state } from './state.js';
import { distanceMeters } from './geo.js';
import { displayPoiName, isVisiblePoi } from './poi.js';
import { el } from './utils.js';
import { toast } from './ui.js';
import db from './storage.js';

let recorder = null;
let recorderStream = null;
let chunks = [];
let startedAt = 0;

function nearbyStatus(message) {
  if (el('journalNearbyStatus')) el('journalNearbyStatus').textContent = message;
}

export function checkJournalNearby() {
  const fix = state.currentPosition;
  if (!fix) {
    nearbyStatus('No current fix yet. Use Locate, then check Nearby again.');
    return null;
  }
  const radius = Number(state.settings?.defaultGeofenceRadiusMeters || 50);
  const nearest = (state.cityPois[state.activeCity] || [])
    .filter((poi) => isVisiblePoi(poi) && Number.isFinite(poi.lat) && Number.isFinite(poi.lng))
    .map((poi) => ({ poi, distance: distanceMeters(fix, poi) }))
    .filter(({ distance }) => distance <= radius)
    .sort((left, right) => left.distance - right.distance)[0] || null;
  nearbyStatus(nearest
    ? `${displayPoiName(nearest.poi)} is ${Math.round(nearest.distance)} m away, inside your ${radius} m alert radius.`
    : `No installed-pack place is inside your ${radius} m alert radius.`);
  return nearest;
}

function setMicState(recording, message) {
  const button = el('journalMicButton');
  button?.setAttribute('aria-pressed', String(recording));
  button?.classList.toggle('recording', recording);
  if (button) button.lastChild.textContent = recording ? ' Stop' : ' Microphone';
  if (el('journalMicStatus')) el('journalMicStatus').textContent = message;
}

async function stopRecording() {
  if (!recorder || recorder.state === 'inactive') return;
  recorder.stop();
}

async function startRecording() {
  if (!globalThis.MediaRecorder || !navigator.mediaDevices?.getUserMedia) {
    toast('Audio recording is not supported in this browser.');
    return;
  }
  try {
    recorderStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    chunks = [];
    startedAt = Date.now();
    recorder = new MediaRecorder(recorderStream);
    recorder.addEventListener('dataavailable', (event) => { if (event.data?.size) chunks.push(event.data); });
    recorder.addEventListener('stop', async () => {
      const createdAt = new Date().toISOString();
      const mimeType = recorder.mimeType || chunks[0]?.type || 'audio/webm';
      const audio = new Blob(chunks, { type: mimeType });
      recorderStream?.getTracks().forEach((track) => track.stop());
      recorderStream = null;
      recorder = null;
      chunks = [];
      if (!audio.size) { setMicState(false, 'No audio was captured.'); return; }
      await db.put('journal_audio', {
        id: `audio-${createdAt}-${Math.random().toString(36).slice(2, 9)}`,
        createdAt,
        city: state.activeCity,
        walkId: state.activeWalk?.id || null,
        location: state.currentPosition ? { lat: state.currentPosition.lat, lng: state.currentPosition.lng, accuracy: state.currentPosition.accuracy } : null,
        durationMs: Math.max(0, Date.now() - startedAt),
        mimeType,
        audio,
        private: true,
        uploadEligible: false
      });
      setMicState(false, 'Audio saved only on this device.');
      toast('Private audio saved on this device.');
    }, { once: true });
    recorder.start(1000);
    setMicState(true, 'Recording on this device. Tap again to stop.');
  } catch (error) {
    recorderStream?.getTracks().forEach((track) => track.stop());
    recorderStream = null;
    recorder = null;
    setMicState(false, error?.name === 'NotAllowedError' ? 'Microphone permission was not granted.' : 'Audio recording could not start.');
  }
}

export function toggleJournalMicrophone() {
  return recorder?.state === 'recording' ? stopRecording() : startRecording();
}

export async function shareJournalNotes() {
  const [moments, observations] = await Promise.all([db.all('moments'), db.all('observations')]);
  const payload = {
    format: 'walk-wildlife-shared-notes-v1',
    exportedAt: new Date().toISOString(),
    note: 'Explicitly shared journal text. Audio, photos, GPS traces, and exact locations are excluded.',
    moments: moments.filter((item) => item.type === 'journal').map(({ id, title, note, createdAt, city }) => ({ id, title, note, createdAt, city })),
    observations: observations.map(({ id, title, species, note, createdAt, city }) => ({ id, title: title || species, note, createdAt, city }))
  };
  if (!payload.moments.length && !payload.observations.length) { toast('There are no notes to share yet.'); return; }
  const file = new File([JSON.stringify(payload, null, 2)], 'walk-wildlife-notes.json', { type: 'application/json' });
  if (navigator.share && navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ title: 'Walk & Wildlife notes', files: [file] }); return; }
    catch (error) { if (error?.name === 'AbortError') return; }
  }
  const url = URL.createObjectURL(file);
  const link = document.createElement('a'); link.href = url; link.download = file.name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Notes exported without audio, photos, traces, or exact locations.');
}

