import db from './storage.js';
import { state } from './state.js';
import { el } from './utils.js';

export const COACH_STEPS = [
  { target: 'locateButton', text: 'Tap the compass to center on you.' },
  { target: 'homeCityButton', text: 'Tap the region name to change packs.' },
  { target: 'walkButton', text: 'Tap Start walk to record your route.' },
  { target: 'mapSearchInput', text: 'Search a place, trail, or wildlife name.' },
  { target: 'settingsButton', text: 'Tap the backpack to open stories.' },
  { target: 'journalButton', text: 'Tap the grid to write notes.' },
  { target: 'mapPencilButton', text: 'Tap the pencil to sketch the map.' },
  { target: 'savePlaceMapButton', text: 'Tap the plus to drop a pin.' },
  { target: 'mapLights', text: 'Tap a colored light to filter places.' },
];

const HINT_FLAG = 'mapToolsHintSeenV7';
const GAP = 10;
const MARGIN = 10;
const STEP_MS = 8000;
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
    left = cx - cw / 2;
  } else {
    arrow = 'up';
    top = Math.min(targetBottom + gap, voidBox.bottom - ch);
    left = cx - cw / 2;
  }
  left = clamp(left, voidBox.left, voidBox.right - cw);
  top = clamp(top, voidBox.top, voidBox.bottom - ch);
  left = clamp(left, margin, vw - cw - margin);
  top = clamp(top, margin, vh - ch - margin);
  const maxOffset = arrow === 'up' || arrow === 'down' ? Math.max(16, cw - 18) : Math.max(16, ch - 18);
  const raw = arrow === 'up' || arrow === 'down' ? cx - left - 5 : cy - top - 5;
  const arrowOffset = clamp(raw, 10, maxOffset);
  return { top, left, arrow, arrowOffset };
}

export function pickCoachPointer(card, target) {
  const tx = target.left + target.width / 2;
  const ty = target.top + target.height / 2;
  const right = card.left + card.width;
  const bottom = card.top + card.height;
  const inset = 8;
  let x1;
  let y1;
  if (ty < card.top) {
    x1 = clamp(tx, card.left + inset, right - inset);
    y1 = card.top;
  } else if (ty > bottom) {
    x1 = clamp(tx, card.left + inset, right - inset);
    y1 = bottom;
  } else if (tx >= right) {
    x1 = right;
    y1 = clamp(ty, card.top + inset, bottom - inset);
  } else if (tx <= card.left) {
    x1 = card.left;
    y1 = clamp(ty, card.top + inset, bottom - inset);
  } else {
    x1 = card.left + card.width / 2;
    y1 = card.top + card.height / 2;
  }
  const dx = tx - x1;
  const dy = ty - y1;
  const len = Math.hypot(dx, dy) || 1;
  const endPad = Math.min(target.width, target.height) / 2 + 5;
  const x2 = tx - (dx / len) * endPad;
  const y2 = ty - (dy / len) * endPad;
  return {
    x1,
    y1,
    x2,
    y2,
    length: Math.hypot(x2 - x1, y2 - y1),
    angle: Math.atan2(y2 - y1, x2 - x1),
  };
}

function placeSpotlight(spotlight, target) {
  if (!spotlight) return;
  if (!target) {
    spotlight.classList.add('hidden');
    return;
  }
  const box = target.getBoundingClientRect();
  const pad = 3;
  spotlight.classList.remove('hidden');
  spotlight.classList.toggle('coach-round', Math.min(box.width, box.height) <= 48);
  spotlight.style.top = `${Math.round(box.top - pad)}px`;
  spotlight.style.left = `${Math.round(box.left - pad)}px`;
  spotlight.style.width = `${Math.round(box.width + pad * 2)}px`;
  spotlight.style.height = `${Math.round(box.height + pad * 2)}px`;
}

function placePointer(pointer, cardBox, targetBox) {
  if (!pointer) return;
  if (!cardBox || !targetBox) {
    pointer.classList.add('hidden');
    return;
  }
  const line = pickCoachPointer(cardBox, targetBox);
  if (line.length < 8) {
    pointer.classList.add('hidden');
    return;
  }
  pointer.classList.remove('hidden');
  pointer.style.left = `${Math.round(line.x1)}px`;
  pointer.style.top = `${Math.round(line.y1)}px`;
  pointer.style.width = `${Math.round(line.length)}px`;
  pointer.style.transform = `rotate(${line.angle}rad)`;
}

function placeHint(hint, spotlight, pointer, target) {
  hint.style.top = '';
  hint.style.bottom = '';
  hint.style.left = '';
  hint.style.right = '';
  placeSpotlight(spotlight, target);
  if (!target) {
    pointer?.classList.add('hidden');
    return;
  }
  const box = target.getBoundingClientRect();
  const card = { width: hint.offsetWidth || 168, height: hint.offsetHeight || 78 };
  const viewport = { width: window.innerWidth, height: window.innerHeight };
  const place = pickCoachPlacement(box, card, viewport, readChromeBands(document, viewport));
  hint.style.top = `${place.top}px`;
  hint.style.left = `${place.left}px`;
  hint.dataset.arrow = place.arrow;
  hint.style.setProperty('--arrow-offset', `${place.arrowOffset}px`);
  const cardBox = {
    left: place.left,
    top: place.top,
    width: hint.offsetWidth || card.width,
    height: hint.offsetHeight || card.height,
  };
  placePointer(pointer, cardBox, box);
}

function ensureMarkup(hint) {
  if (el('mapIntroText') && el('mapIntroNext') && el('mapIntroSkip')) return;
  hint.innerHTML = '<p id="mapIntroText"></p><div class="coach-actions"><button type="button" id="mapIntroNext">Next</button><button type="button" id="mapIntroSkip" class="text-button">Skip</button></div>';
}

function mountNode(id, className) {
  let node = el(id);
  if (!node) {
    node = document.createElement('div');
    node.id = id;
    node.className = className;
    node.setAttribute('aria-hidden', 'true');
  }
  if (node.parentElement !== document.body) document.body.appendChild(node);
  return node;
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
  const spotlight = mountNode('coachSpotlight', 'coach-spotlight hidden');
  const pointer = mountNode('coachPointer', 'coach-pointer hidden');
  return { hint, spotlight, pointer };
}

function currentTarget() {
  const step = COACH_STEPS[stepIndex];
  return step ? resolveCoachTarget(step.target) : null;
}

function relayout() {
  const hint = el('mapIntroHint');
  if (!hint || hint.classList.contains('hidden')) return;
  placeHint(hint, el('coachSpotlight'), el('coachPointer'), currentTarget());
}

function armTimer() {
  clearTimeout(timer);
  timer = window.setTimeout(() => nextStep(), STEP_MS);
}

function showStep() {
  const { hint, spotlight, pointer } = mountOverlay();
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
  window.requestAnimationFrame(() => placeHint(hint, spotlight, pointer, target));
  armTimer();
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
  const pointer = el('coachPointer');
  hint?.classList.add('dissolving');
  spotlight?.classList.add('hidden');
  pointer?.classList.add('hidden');
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
}
