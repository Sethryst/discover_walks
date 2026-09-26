import { state } from './state.js';
import { escapeHtml } from './utils.js';
import { openSheet } from './ui.js';
import { DC_STORIES } from '../data/dc-stories.js';
import { loadStoryChapterAudio, saveStoryAudioForVisit, savedStoryAudio, removeSavedStoryAudio } from './story-audio.js';
import { distanceMeters } from './geo.js';

let storyLayer;
let activeStory;
let activeChapter = 0;
let autoplayStory = false;
let locationLockedStory = false;

function storiesForCity() { return DC_STORIES.filter((story) => !state.activeCity || story.city === state.activeCity || story.scope === 'national'); }

function beaconIcon(story) {
  return L.divIcon({ className: 'story-beacon-wrap', iconSize: [52, 52], iconAnchor: [26, 26], html: `<span class="story-beacon story-beacon--${escapeHtml(story.status)}"><i></i><b>◉</b></span>` });
}

function drawStories() {
  if (!state.map) return;
  storyLayer?.remove();
  state.storyRouteLine?.remove();
  state.storyRouteLine = null;
  storyLayer = L.layerGroup().addTo(state.map);
  storiesForCity().forEach((story) => {
    const field = L.polygon(story.footprint, { className: 'story-field', color: '#e16b3c', weight: 2, opacity: .55, fillColor: '#e9a66e', fillOpacity: .11, dashArray: '4 9', interactive: true });
    field.on('click', () => openStory(story.id));
    field.addTo(storyLayer);
    const marker = L.marker(story.center, { icon: beaconIcon(story), title: story.mapLabel, riseOnHover: true });
    marker.bindTooltip(`<strong>${escapeHtml(story.mapLabel)}</strong><br>${escapeHtml(story.headline)}`, { direction: 'top', className: 'story-beacon-tooltip' });
    marker.on('click', () => openStory(story.id));
    marker.addTo(storyLayer);
  });
}

function chapterHtml(chapter, index) {
  return `<button type="button" class="story-chapter ${index === activeChapter ? 'active' : ''}" data-story-chapter="${index}"><span>${index + 1}</span><span><strong>${escapeHtml(chapter.title)}</strong><small>${chapter.minutes} min · ${escapeHtml(chapter.look)}</small></span></button>`;
}

function renderPlayer() {
  if (!activeStory) return;
  const chapter = activeStory.chapters[activeChapter];
  document.getElementById('storyStatus').textContent = `${activeStory.status.toUpperCase()} · ${activeStory.freshnessLabel}`;
  document.getElementById('storyTitle').textContent = activeStory.headline;
  document.getElementById('storyHook').textContent = activeStory.hook;
  document.getElementById('storyChapterList').innerHTML = activeStory.chapters.map(chapterHtml).join('');
  document.getElementById('storyNowTitle').textContent = chapter.title;
  document.getElementById('storyLookPrompt').textContent = locationLockedStory
    ? `At the chapter location to hear this piece · ${chapter.look}`
    : chapter.look;
  document.getElementById('storyTranscript').textContent = chapter.narration;
  const save = document.getElementById('storySaveAudio');
  if (save) { save.disabled = !chapter.audioAssetId; save.textContent = savedStoryAudio(chapter) ? 'Remove saved audio' : `Save audio for this visit${chapter.audioRights?.bytes ? ` · ${Math.ceil(chapter.audioRights.bytes / 1024)} KB` : ''}`; }
  document.getElementById('storyProgress').textContent = `Chapter ${activeChapter + 1} of ${activeStory.chapters.length}`;
  document.getElementById('storyPrevious').disabled = activeChapter === 0;
  document.getElementById('storyNext').disabled = activeChapter === activeStory.chapters.length - 1;
  document.getElementById('storyNext').textContent = activeChapter === activeStory.chapters.length - 1 ? 'End of story' : 'Next chapter';
  const rights = chapter.audioRights;
  const clipState = chapter.sourceClips?.length ? `${chapter.sourceClips.length} archival clip candidate${chapter.sourceClips.length === 1 ? '' : 's'} · rights review ${chapter.sourceClips[0].rightsReviewStatus}` : 'No archival clip selected';
  document.getElementById('storySources').innerHTML = `${activeStory.sources.map((source) => `<a href="${escapeHtml(source.url)}" target="_blank" rel="noreferrer">${escapeHtml(source.name)} ↗</a>`).join('')}<p class="story-audio-rights"><strong>Audio:</strong> ${escapeHtml(rights?.reviewStatus === 'approved' ? 'approved' : 'not published')} · ${escapeHtml(clipState)}<br><small>Transcript remains available; browser speech is the fallback until an editor-approved chapter render is published.</small></p>`;
  document.getElementById('storyOpenQuestions').innerHTML = activeStory.unresolved.map((item) => `<li>${escapeHtml(item)}</li>`).join('');
}

async function playChapter(button) {
  const chapter = activeStory?.chapters[activeChapter];
  if (!chapter) return;
  const existingPlayer = document.getElementById('storyAudioElement');
  if (existingPlayer && !existingPlayer.paused) {
    existingPlayer.pause();
    button.textContent = '▶'; button.setAttribute('aria-label', 'Resume chapter');
    return;
  }
  if (existingPlayer?.src && existingPlayer.dataset.chapter === String(activeChapter)) {
    await existingPlayer.play();
    button.textContent = 'Ⅱ'; button.setAttribute('aria-label', 'Pause chapter');
    return;
  }
  try {
    const saved = savedStoryAudio(chapter);
    const url = saved?.url || await loadStoryChapterAudio(chapter);
    let player = document.getElementById('storyAudioElement');
    if (!player) { player = document.createElement('audio'); player.id = 'storyAudioElement'; player.controls = true; player.hidden = true; document.getElementById('storyPlay').after(player); }
    player.src = url; player.dataset.chapter = String(activeChapter); await player.play(); button.textContent = 'Ⅱ'; button.setAttribute('aria-label', 'Pause chapter');
    player.onended = () => {
      button.textContent = '▶'; button.setAttribute('aria-label', 'Play chapter');
      if (autoplayStory && !locationLockedStory && activeStory && activeChapter < activeStory.chapters.length - 1) {
        activeChapter += 1;
        renderPlayer();
        void playChapter(document.getElementById('storyPlay'));
      }
    };
  } catch {
    // Rights review, network, or object storage failure must never strand the
    // story: fall back to the visible transcript through browser speech.
    button.dataset.audioUnavailable = 'true';
    speakChapter(button, chapter);
  }
}

function speakChapter(button, chapter) {
  if (!('speechSynthesis' in globalThis)) {
    button.disabled = true;
    button.setAttribute('aria-label', 'Audio preview is unavailable in this browser');
    return;
  }
  const speaking = speechSynthesis.speaking;
  if (speaking) { speechSynthesis.pause(); button.textContent = '▶'; button.setAttribute('aria-label', 'Resume chapter'); return; }
  if (speechSynthesis.paused) { speechSynthesis.resume(); button.textContent = 'Ⅱ'; button.setAttribute('aria-label', 'Pause chapter'); return; }
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(chapter.narration);
  utterance.rate = .96;
  utterance.onend = () => { button.textContent = '▶'; button.setAttribute('aria-label', 'Play chapter'); };
  speechSynthesis.speak(utterance);
  button.textContent = 'Ⅱ'; button.setAttribute('aria-label', 'Pause chapter');
}

export function openStory(storyId) {
  activeStory = storiesForCity().find((story) => story.id === storyId);
  if (!activeStory) return;
  activeChapter = 0;
  autoplayStory = activeStory.id === 'east-potomac-changing-park';
  locationLockedStory = autoplayStory && Boolean(state.currentPosition || state.lastPosition);
  state.storyRouteLine?.remove();
  if (state.map && globalThis.L) {
    state.storyRouteLine = L.layerGroup([
      L.polyline(activeStory.route, { color: '#fffaf0', weight: 10, opacity: .9, lineCap: 'round', lineJoin: 'round' }),
      L.polyline(activeStory.route, { color: '#e16b3c', weight: 5, opacity: .98, dashArray: '12 8', lineCap: 'round', lineJoin: 'round' })
    ]).addTo(state.map);
    state.map.fitBounds(L.latLngBounds(activeStory.footprint), { padding: [45, 45], maxZoom: 16 });
  }
  renderPlayer();
  openSheet('storySheet');
  if (autoplayStory && !locationLockedStory) void playChapter(document.getElementById('storyPlay'));
}

export function initStories() {
  drawStories();
  document.querySelectorAll('[data-story-open]').forEach((button) => button.addEventListener('click', () => openStory(button.dataset.storyOpen)));
  document.getElementById('storyChapterList')?.addEventListener('click', (event) => {
    const button = event.target.closest('[data-story-chapter]');
    if (!button) return;
    activeChapter = Number(button.dataset.storyChapter);
    renderPlayer();
  });
  document.getElementById('storyPrevious')?.addEventListener('click', () => { if (activeChapter > 0) { activeChapter -= 1; renderPlayer(); } });
  document.getElementById('storyNext')?.addEventListener('click', () => { if (activeChapter < activeStory.chapters.length - 1) { activeChapter += 1; renderPlayer(); } });
  document.getElementById('storyPlay')?.addEventListener('click', (event) => {
    if (activeStory?.chapters[activeChapter]?.audioAssetId) { playChapter(event.currentTarget); return; }
    speakChapter(event.currentTarget, activeStory.chapters[activeChapter]);
  });
  document.getElementById('storySaveAudio')?.addEventListener('click', async (event) => {
    const chapter = activeStory?.chapters[activeChapter]; if (!chapter) return;
    if (savedStoryAudio(chapter)) { removeSavedStoryAudio(chapter); renderPlayer(); return; }
    try { const url = await loadStoryChapterAudio(chapter); saveStoryAudioForVisit(chapter, url); renderPlayer(); } catch { event.currentTarget.textContent = 'Unavailable until rights review'; }
  });
  window.addEventListener('walk-position-received', (event) => {
    if (!activeStory || activeStory.id !== 'east-potomac-changing-park' || !locationLockedStory) return;
    const point = event.detail || state.currentPosition;
    const chapter = activeStory.chapters[activeChapter];
    if (point && chapter.position && distanceMeters(point, { lat: chapter.position[0], lng: chapter.position[1] }) <= 50) {
      locationLockedStory = false;
      renderPlayer();
      void playChapter(document.getElementById('storyPlay'));
    }
  });
  window.addEventListener('city-layer-data-changed', drawStories);
}
