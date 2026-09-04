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

const HINT_FLAG = 'mapToolsHintSeenV4';
const GAP = 16;
const MARGIN = 12;
let stepIndex = 0;
let timer = null;
let bound = false;

function clearHighlight() {
  document.querySelectorAll('.coach-target').forEach((node) => node.classList.remove('coach-target'));
}

export function pickCoachPlacement(target, card, viewport, gap = GAP, margin = MARGIN) {
  const vw = viewport.width;
  const vh = viewport.height;
  const tw = target.width;
  const th = target.height;
  const tLeft = target.left;
  const tTop = target.top;
  const tRight = tLeft + tw;
  const tBottom = tTop + th;
  const cx = tLeft + tw / 2;
  const cy = tTop + th / 2;
  const cw = card.width;
  const ch = card.height;
  const candidates = {
    below: { arrow: 'up', top: tBottom + gap, left: cx - cw * 0.35, space: vh - margin - (tBottom + gap + ch) },
    above: { arrow: 'down', top: tTop - gap - ch, left: cx - cw * 0.35, space: tTop - gap - ch - margin },
    left: { arrow: 'right', top: cy - ch / 2, left: tLeft - gap - cw, space: tLeft - gap - cw - margin },
    right: { arrow: 'left', top: cy - ch / 2, left: tRight + gap, space: vw - margin - (tRight + gap + cw) },
  };
  let preferred = 'below';
  if (tBottom > vh * 0.72) preferred = 'above';
  else if (tLeft > vw * 0.58) preferred = 'left';
  else if (tTop < vh * 0.28) preferred = 'below';
  else if (tLeft > vw * 0.5) preferred = 'left';
  const order = [preferred, 'below', 'above', 'left', 'right'];
  const seen = new Set();
  let chosen = candidates[preferred];
  for (const key of order) {
    if (seen.has(key)) continue;
    seen.add(key);
    if (candidates[key].space >= 0) {
      chosen = candidates[key];
      break;
    }
  }
  if (chosen.space < 0) {
    chosen = Object.values(candidates).reduce((best, item) => (item.space > best.space ? item : best));
  }
  const left = Math.round(Math.max(margin, Math.min(chosen.left, vw - cw - margin)));
  const top = Math.round(Math.max(margin, Math.min(chosen.top, vh - ch - margin)));
  let arrowOffset;
  if (chosen.arrow === 'up' || chosen.arrow === 'down') {
    arrowOffset = Math.max(16, Math.min(cw - 28, cx - left - 10));
  } else {
    arrowOffset = Math.max(12, Math.min(ch - 28, cy - top - 10));
  }
  return { top, left, arrow: chosen.arrow, arrowOffset: Math.round(arrowOffset) };
}

function placeSpotlight(spotlight, target) {
  if (!spotlight) return;
  if (!target) {
    spotlight.classList.add('hidden');
    return;
  }
  const box = target.getBoundingClientRect();
  const pad = 6;
  spotlight.classList.remove('hidden');
  spotlight.style.top = `${Math.round(box.top - pad)}px`;
  spotlight.style.left = `${Math.round(box.left - pad)}px`;
  spotlight.style.width = `${Math.round(box.width + pad * 2)}px`;
  spotlight.style.height = `${Math.round(box.height + pad * 2)}px`;
}

function placeHint(hint, spotlight, target) {
  hint.style.top = '';
  hint.style.bottom = '';
  hint.style.left = '';
  hint.style.right = '';
  placeSpotlight(spotlight, target);
  if (!target) return;
  const box = target.getBoundingClientRect();
  const card = { width: hint.offsetWidth || 260, height: hint.offsetHeight || 96 };
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  const place = pickCoachPlacement(box, card, viewport);
  hint.style.top = `${place.top}px`;
  hint.style.left = `${place.left}px`;
  hint.dataset.arrow = place.arrow;
  hint.style.setProperty('--arrow-offset', `${place.arrowOffset}px`);
}

function ensureMarkup(hint) {
  if (el('mapIntroText') && el('mapIntroNext') && el('mapIntroSkip')) return;
  hint.innerHTML = '<p id="mapIntroText"></p><div class="coach-actions"><button type="button" id="mapIntroNext">Next</button><button type="button" id="mapIntroSkip" class="text-button">Skip</button></div>';
}

function mountOverlay() {
  let hint = el('mapIntroHint');
  if (!hint) {
    hint = document.createElement('aside');
    hint.id = 'mapIntroHint';
    hint.className = 'map-intro-hint hidden';
    hint.setAttribute('aria-live', 'polite');
  }
  if (hint.parentElement !== document.body) document.body.appendChild(hint);
  ensureMarkup(hint);
  let spotlight = el('coachSpotlight');
  if (!spotlight) {
    spotlight = document.createElement('div');
    spotlight.id = 'coachSpotlight';
    spotlight.className = 'coach-spotlight hidden';
    spotlight.setAttribute('aria-hidden', 'true');
  }
  if (spotlight.parentElement !== document.body) document.body.appendChild(spotlight);
  return { hint, spotlight };
}

function currentTarget() {
  const step = COACH_STEPS[stepIndex];
  return step ? el(step.target) : null;
}

function relayout() {
  const hint = el('mapIntroHint');
  if (!hint || hint.classList.contains('hidden')) return;
  placeHint(hint, el('coachSpotlight'), currentTarget());
}

function showStep() {
  const { hint, spotlight } = mountOverlay();
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
  hint.classList.remove('hidden', 'dissolving');
  placeHint(hint, spotlight, target);
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
  const spotlight = el('coachSpotlight');
  hint?.classList.add('dissolving');
  spotlight?.classList.add('hidden');
  window.setTimeout(() => hint?.classList.add('hidden'), 400);
  state.settings[HINT_FLAG] = true;
  await db.put('settings', state.settings);
}

export function startCoachMarks() {
  if (state.settings[HINT_FLAG]) return;
  stepIndex = 0;
  showStep();
  if (!bound) {
    bound = true;
    el('mapIntroNext')?.addEventListener('click', (event) => {
      event.preventDefault();
      clearTimeout(timer);
      nextStep();
    });
    el('mapIntroSkip')?.addEventListener('click', (event) => {
      event.preventDefault();
      void finishCoach();
    });
    window.addEventListener('resize', relayout);
    globalThis.visualViewport?.addEventListener('resize', relayout);
    globalThis.visualViewport?.addEventListener('scroll', relayout);
  }
  const tick = () => {
    timer = window.setTimeout(() => {
      nextStep();
      if (stepIndex < COACH_STEPS.length) tick();
    }, 4000);
  };
  tick();
}
