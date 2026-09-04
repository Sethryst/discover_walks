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

const HINT_FLAG = 'mapToolsHintSeenV6';
const GAP = 12;
const MARGIN = 12;
let stepIndex = 0;
let timer = null;
let bound = false;

function clearHighlight() {
  document.querySelectorAll('.coach-target').forEach((node) => node.classList.remove('coach-target'));
}

export function resolveCoachTarget(id, doc = document) {
  const node = doc.getElementById(id);
  if (!node) return null;
  if (id === 'mapSearchInput') return node.closest('.map-search') || node;
  return node;
}

export function readChromeBands(doc = document, viewport = { width: 390, height: 844 }) {
  const top = doc.querySelector('.top-cluster')?.getBoundingClientRect();
  const mid = doc.querySelector('.middle-tools')?.getBoundingClientRect();
  const lights = doc.querySelector('.map-lights')?.getBoundingClientRect();
  return {
    belowTop: top ? Math.round(top.bottom + 8) : 72,
    leftOfRight: mid ? Math.round(mid.left - 8) : viewport.width - 56,
    aboveBottom: lights ? Math.round(lights.top - 8) : viewport.height - 64,
  };
}

function clamp(value, min, max) {
  return Math.round(Math.max(min, Math.min(value, max)));
}

export function pickCoachPlacement(target, card, viewport, chrome = {}, gap = GAP, margin = MARGIN) {
  const vw = viewport.width;
  const vh = viewport.height;
  const cw = card.width;
  const ch = card.height;
  const targetBottom = target.bottom ?? target.top + target.height;
  const cx = target.left + target.width / 2;
  const cy = target.top + target.height / 2;
  const voidBox = {
    left: margin,
    top: chrome.belowTop ?? 72,
    right: chrome.leftOfRight ?? vw - 56,
    bottom: chrome.aboveBottom ?? vh - 64,
  };
  if (voidBox.right - voidBox.left < cw) voidBox.right = Math.min(vw - margin, voidBox.left + cw);
  if (voidBox.bottom - voidBox.top < ch) voidBox.bottom = Math.min(vh - margin, voidBox.top + ch);
  const inTop = targetBottom <= voidBox.top + 28;
  const inRight = target.left >= voidBox.right - 6;
  const inBottom = target.top >= voidBox.bottom - 10;
  let arrow;
  let top;
  let left;
  if (inBottom) {
    arrow = 'down';
    top = voidBox.bottom - ch;
    left = cx - cw / 2;
  } else if (inRight) {
    arrow = 'right';
    top = cy - ch / 2;
    left = voidBox.right - cw;
  } else if (inTop) {
    arrow = 'up';
    top = voidBox.top;
    left = cx - cw * 0.35;
  } else {
    arrow = 'up';
    top = Math.min(targetBottom + gap, voidBox.bottom - ch);
    left = cx - cw / 2;
  }
  left = clamp(left, voidBox.left, voidBox.right - cw);
  top = clamp(top, voidBox.top, voidBox.bottom - ch);
  left = clamp(left, margin, vw - cw - margin);
  top = clamp(top, margin, vh - ch - margin);
  const maxOffset = arrow === 'up' || arrow === 'down' ? Math.max(16, cw - 20) : Math.max(16, ch - 20);
  const raw = arrow === 'up' || arrow === 'down' ? cx - left - 6 : cy - top - 6;
  const arrowOffset = clamp(raw, 12, maxOffset);
  return { top, left, arrow, arrowOffset };
}

function placeSpotlight(spotlight, target) {
  if (!spotlight) return;
  if (!target) {
    spotlight.classList.add('hidden');
    return;
  }
  const box = target.getBoundingClientRect();
  const pad = 4;
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
  const card = { width: hint.offsetWidth || 196, height: hint.offsetHeight || 86 };
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  const place = pickCoachPlacement(box, card, viewport, readChromeBands(document, viewport));
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
  return step ? resolveCoachTarget(step.target) : null;
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
  const target = resolveCoachTarget(step.target);
  hint.classList.remove('hidden', 'dissolving');
  if (next) next.textContent = stepIndex === COACH_STEPS.length - 1 ? 'Done' : 'Next';
  window.requestAnimationFrame(() => placeHint(hint, spotlight, target));
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
