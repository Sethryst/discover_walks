// Story audio is editorial and on-demand. Geo Cypher deliberately has no
// imports or shared storage here.
const visitAudio = new Map();

const LOCAL_APPROVAL_AUDIO = new Map([
  ['east-potomac-changing-park-chapter-1', './assets/story-audio/east-potomac-chapter-1.mp3'],
  ['east-potomac-changing-park-chapter-2', './assets/story-audio/east-potomac-chapter-2.mp3'],
  ['east-potomac-changing-park-chapter-3', './assets/story-audio/east-potomac-chapter-3.mp3'],
  ['east-potomac-changing-park-chapter-4', './assets/story-audio/east-potomac-chapter-4.mp3'],
  ['kennedy-center-human-chain-chapter-1', './assets/story-audio/kennedy-center-chapter-1.mp3'],
  ['kennedy-center-human-chain-chapter-2', './assets/story-audio/kennedy-center-chapter-2.mp3'],
  ['kennedy-center-human-chain-chapter-3', './assets/story-audio/kennedy-center-chapter-3.mp3'],
  ['kennedy-center-human-chain-chapter-4', './assets/story-audio/kennedy-center-chapter-4.mp3']
]);

export function audioRightsReady(chapter) {
  return chapter?.audioStatus === 'ready' && Boolean(chapter.audioAssetId)
    && chapter.audioRights?.reviewStatus === 'approved'
    && Boolean(chapter.audioRights?.license && chapter.audioRights?.attribution);
}

export async function loadStoryChapterAudio(chapter, { fetchImpl = globalThis.fetch } = {}) {
  if (!audioRightsReady(chapter)) throw new Error('Story audio is not rights-approved.');
  if (visitAudio.has(chapter.audioAssetId)) return visitAudio.get(chapter.audioAssetId);
  // Local editorial approval builds may point at a packaged narrator file.
  // Production packages omit audioSrc and use the signed-url endpoint below.
  if (LOCAL_APPROVAL_AUDIO.has(chapter.audioAssetId)) return LOCAL_APPROVAL_AUDIO.get(chapter.audioAssetId);
  if (chapter.audioRights?.sourceUrl?.startsWith('https://commons.wikimedia.org/')) return chapter.audioRights.sourceUrl;
  const response = await fetchImpl(`/api/story-audio/${encodeURIComponent(chapter.audioAssetId)}`, { credentials: 'same-origin' });
  if (!response.ok) throw new Error(`Story audio unavailable (${response.status}).`);
  const payload = await response.json();
  if (!payload.url || (!payload.expiresAt && !payload.expiresIn)) throw new Error('Story audio URL is not short-lived.');
  return payload.url;
}

export function saveStoryAudioForVisit(chapter, url) {
  if (!audioRightsReady(chapter) || !url) return false;
  visitAudio.set(chapter.audioAssetId, { url, bytes: Number(chapter.audioRights?.bytes) || null });
  return true;
}

export function savedStoryAudio(chapter) { return visitAudio.get(chapter?.audioAssetId) || null; }
export function removeSavedStoryAudio(chapter) { visitAudio.delete(chapter?.audioAssetId); }
export function clearSavedStoryAudio() { visitAudio.clear(); }
