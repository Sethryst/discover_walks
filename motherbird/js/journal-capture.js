import { state } from './state.js';
import { el } from './utils.js';
import { toast } from './ui.js';
import db from './storage.js';
import { ensureCurrentJournalNote, renderArchive } from './archive.js';
import { renderNearbyPlaces } from './journal-pane.js';

let recorder = null;
let stream = null;
let speech = null;
let starting = false;
let captureEpoch = 0;
const status = (text) => { if (el('journalMicStatus')) el('journalMicStatus').textContent = text; };

export function checkJournalNearby() { return renderNearbyPlaces(); }
export function stopJournalCapture() {
  captureEpoch += 1;
  speech?.stop();
  if (recorder?.state === 'recording') recorder.stop();
}

export function transcribeJournal() {
  if (speech) { speech.stop(); return; }
  const Recognition = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
  if (!Recognition) { status('Transcription is unavailable in this browser. You can still type or record.'); return; }
  speech = new Recognition();
  speech.continuous = true;
  speech.interimResults = false;
  speech.onresult = (event) => {
    const text = Array.from(event.results).slice(event.resultIndex).filter((result) => result.isFinal).map((result) => result[0].transcript).join(' ');
    const page = el('journalNote');
    page.value = [page.value, text].filter(Boolean).join(' ');
    page.dispatchEvent(new Event('input', { bubbles: true }));
  };
  speech.onend = () => { speech = null; el('journalTranscribeButton')?.setAttribute('aria-pressed', 'false'); status('Transcription stopped. Text only; no voice file.'); };
  speech.onerror = (event) => status(`Transcription unavailable: ${event.error}. Your text is still here.`);
  speech.start();
  el('journalTranscribeButton')?.setAttribute('aria-pressed', 'true');
  status('Transcribing into this page using browser speech recognition. Tap again to stop. No file is saved.');
}

export function supportedVoiceType(Recorder = globalThis.MediaRecorder) {
  return ['audio/mp4', 'audio/mpeg'].find((type) => Recorder?.isTypeSupported?.(type)) || null;
}

export async function toggleJournalRecording() {
  if (starting) return;
  if (recorder?.state === 'recording') { recorder.stop(); return; }
  const mimeType = supportedVoiceType();
  if (!mimeType || !navigator.mediaDevices?.getUserMedia) { status('This browser cannot record MP4 or MPEG audio. Transcribe or type instead.'); return; }
  starting = true;
  const epoch = ++captureEpoch;
  try {
    const note = await ensureCurrentJournalNote();
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    if (epoch !== captureEpoch) { stream.getTracks().forEach((track) => track.stop()); stream = null; return; }
    const chunks = [];
    const started = Date.now();
    const record = new MediaRecorder(stream, { mimeType });
    recorder = record;
    record.ondataavailable = (event) => { if (event.data?.size) chunks.push(event.data); };
    record.onerror = () => { status('Recording failed; the current note is safe.'); stream?.getTracks().forEach((track) => track.stop()); recorder = null; el('journalRecordButton').textContent = 'Record'; el('journalRecordButton').setAttribute('aria-pressed', 'false'); };
    record.onstop = async () => {
      stream?.getTracks().forEach((track) => track.stop());
      stream = null; recorder = null;
      el('journalRecordButton').textContent = 'Record';
      el('journalRecordButton').setAttribute('aria-pressed', 'false');
      const audio = new Blob(chunks, { type: record.mimeType || mimeType });
      if (!audio.size) { status('No audio was captured.'); return; }
      try {
        const id = crypto.randomUUID();
        await db.put('voice_notes', { id, momentId: note.id, walkId: note.walkId, city: note.city, createdAt: new Date().toISOString(), durationMs: Date.now() - started, mimeType: audio.type, audio, private: true });
        const current = await db.get('moments', note.id);
        await db.put('moments', { ...current, voiceIds: [...(current?.voiceIds || []), id] });
        status('Voice file saved on this device and attached to this page.');
        await renderArchive();
      } catch (error) { status('Voice file could not be saved. Check device storage.'); console.warn(error); }
    };
    record.start(1000);
    el('journalRecordButton').textContent = 'Stop';
    el('journalRecordButton').setAttribute('aria-pressed', 'true');
    status('Recording a private voice file. Tap Stop when finished.');
  } catch (error) {
    stream?.getTracks().forEach((track) => track.stop()); stream = null; recorder = null;
    status(error.name === 'NotAllowedError' ? 'Microphone permission was not granted.' : 'Recording could not start.');
  } finally { starting = false; }
}

export async function migrateLegacyJournalAudio() {
  // Move existing blobs, do not duplicate or upload them. Old MIME types stay intact.
  for (const item of await db.all('journal_audio')) {
    if (!await db.get('voice_notes', item.id)) await db.put('voice_notes', { ...item, momentId: item.momentId || null });
    await db.remove('journal_audio', item.id);
  }
}

export const toggleJournalMicrophone = toggleJournalRecording;
