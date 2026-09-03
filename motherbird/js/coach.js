import db from './storage.js';
import { state } from './state.js';
import { el } from './utils.js';

export const COACH_STEPS = [
  { target: 'locateButton', text: 'Tap Locate to center the map on you.' },
  { target: 'homeCityButton', text: 'Tap the region name to change the pack.' },
  { target: 'walkButton', text: 'Tap Start walk to record your route.' },
  { target: 'mapSearchInput', text: 'Type a place name to find it.' },
  { target: 'settingsButton', text: 'Tap Field Guide to open stories.' },
  { target: 'journalButton', text: 'Tap Journal to write what you notice.' },
  { target: 'mapPencilButton', text: 'Tap Draw to sketch on the map.' },
  { target: 'savePlaceMapButton', text: 'Tap Places + to drop a pin.' },
  { target: 'mapLights', text: 'Tap a colored light to filter places.' },
];

const HINT_FLAG = 'mapToolsHintSeenV3';
let stepIndex = 0;
let timer = null;

function clearHighlight() {
  document.querySelectorAll('.coach-target').forEach((node) => node.classList.remove('coach-target'));
}

function placeHint(hint, target) {
  hint.style.top = '';
  hint.style.bottom = '';
  hint.style.left = '';
  hint.style.right = '';
  if (!target) return;
  const box = target.getBoundingClientRect();
  const spaceBelow = window.innerHeight - box.bottom;
  if (spaceBelow > 96) {
    hint.style.top = `${Math.round(box.bottom + 8)}px`;
    hint.style.left = `${Math.round(Math.max(12, Math.min(box.left, window.innerWidth - 220)))}px`;
  } else {
    hint.style.top = `${Math.round(Math.max(12, box.top - 88))}px`;
    hint.style.left = `${Math.round(Math.max(12, Math.min(box.left, window.innerWidth - 220)))}px`;
  }
}

function ensureMarkup(hint) {
  if (el('mapIntroText') && el('mapIntroNext') && el('mapIntroSkip')) return;
  hint.innerHTML = '<p id="mapIntroText"></p><div class="coach-actions"><button type="button" id="mapIntroNext">Next</button><button type="button" id="mapIntroSkip" class="text-button">Skip</button></div>';
}

function showStep() {
  const hint = el('mapIntroHint');
  if (!hint) return;
  ensureMarkup(hint);
  const text = el('mapIntroText');
  const next = el('mapIntroNext');
  if (!text) return;
  const step = COACH_STEPS[stepIndex];
  if (!step) {
    finishCoach();
    return;
  }
  clearHighlight();
  text.textContent = step.text;
  const target = el(step.target);
  target?.classList.add('coach-target');
  placeHint(hint, target);
  hint.classList.remove('hidden', 'dissolving');
  if (next) next.textContent = stepIndex === COACH_STEPS.length - 1 ? 'Done' : 'Next';
}

function nextStep() {
  stepIndex += 1;
  if (stepIndex >= COACH_STEPS.length) finishCoach();
  else showStep();
}

export async function finishCoach() {
  clearTimeout(timer);
  timer = null;
  clearHighlight();
  const hint = el('mapIntroHint');
  hint?.classList.add('dissolving');
  window.setTimeout(() => hint?.classList.add('hidden'), 400);
  state.settings[HINT_FLAG] = true;
  await db.put('settings', state.settings);
}

export function startCoachMarks() {
  if (state.settings[HINT_FLAG]) return;
  stepIndex = 0;
  showStep();
  el('mapIntroNext')?.addEventListener('click', (event) => {
    event.preventDefault();
    clearTimeout(timer);
    nextStep();
  });
  el('mapIntroSkip')?.addEventListener('click', (event) => {
    event.preventDefault();
    void finishCoach();
  });
  const tick = () => {
    timer = window.setTimeout(() => {
      nextStep();
      if (stepIndex < COACH_STEPS.length) tick();
    }, 4000);
  };
  tick();
}
