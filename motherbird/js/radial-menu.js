import { state } from './state.js';
import { el } from './utils.js';
import { startWalk, stopWalk, pauseWalk, resumeWalk } from './walk.js';
import db from './storage.js';

const DEFAULT_STARRED = [
  { id: 'journal', label: 'Journal', icon: '▦' },
  { id: 'walk-field-guide', label: 'Field Guide', icon: '🎒' }
];

export function getStarredActions() {
  return Array.isArray(state.settings?.starredRadialActions)
    ? state.settings.starredRadialActions
    : DEFAULT_STARRED;
}

export function isActionStarred(id) {
  const starred = getStarredActions();
  return starred.some((item) => item.id === id);
}

export async function toggleStarAction(item) {
  let list = [...getStarredActions()];
  const index = list.findIndex((x) => x.id === item.id);
  if (index >= 0) {
    list.splice(index, 1);
  } else {
    list.push(item);
  }
  const persistedList = list.map(({ action, ...savedItem }) => savedItem);
  const nextSettings = { ...state.settings, starredRadialActions: persistedList };
  state.settings = { ...nextSettings, starredRadialActions: list };
  renderRadialWheel();
  window.dispatchEvent(new CustomEvent('radial-starred-changed', { detail: { id: item.id, starred: index < 0 } }));
  try {
    await db.put('settings', nextSettings);
  } catch (error) {
    state.settings = { ...state.settings, starredRadialActions: index >= 0 ? [...list, item] : list.filter((entry) => entry.id !== item.id) };
    renderRadialWheel();
    window.dispatchEvent(new CustomEvent('radial-starred-changed', { detail: { id: item.id, starred: index >= 0 } }));
    throw error;
  }
}

export function updateRadialWalkButton() {
  const btn = el('radialWalkButton');
  const label = el('radialWalkLabel');
  const pauseBtn = el('radialPauseButton');
  if (!btn || !label) return;

  const walk = state.activeWalk;
  if (!walk) {
    label.textContent = 'Start walk';
    btn.classList.remove('active-walk', 'paused');
    if (pauseBtn) pauseBtn.classList.add('hidden');
  } else if (walk.paused) {
    label.textContent = 'Resume walk';
    btn.classList.add('active-walk', 'paused');
    if (pauseBtn) {
      pauseBtn.classList.remove('hidden');
      pauseBtn.textContent = 'End walk';
    }
  } else {
    label.textContent = 'Pause walk';
    btn.classList.add('active-walk');
    btn.classList.remove('paused');
    if (pauseBtn) {
      pauseBtn.classList.remove('hidden');
      pauseBtn.textContent = 'End walk';
    }
  }
}

export function renderRadialWheel() {
  const wheel = el('radialWheelMenu');
  if (!wheel) return;
  const starred = getStarredActions();
  wheel.replaceChildren();

  if (!starred.length) {
    const empty = document.createElement('div');
    empty.className = 'radial-empty';
    empty.textContent = 'Star tools in Explore/Walk/Library/Me to place shortcuts here.';
    wheel.append(empty);
    return;
  }

  starred.forEach((item) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'radial-item-btn';
    btn.innerHTML = `<span class="radial-item-icon">${item.icon || '⭐'}</span><span class="radial-item-label">${item.label}</span>`;
    btn.addEventListener('click', () => {
      toggleRadialMenu(false);
      if (item.action) {
        item.action();
      } else {
        window.dispatchEvent(new CustomEvent('radial-action-triggered', { detail: item }));
      }
    });
    wheel.append(btn);
  });
}

export function toggleRadialMenu(force) {
  const menu = el('radialWheelMenu');
  const chevron = el('radialChevron');
  if (!menu) return;
  const open = force !== undefined ? force : menu.classList.contains('hidden');
  menu.classList.toggle('hidden', !open);
  if (chevron) chevron.setAttribute('aria-expanded', String(open));
}

export function initRadialMenu() {
  const btn = el('radialWalkButton');
  const pauseBtn = el('radialPauseButton');
  const chevron = el('radialChevron');

  btn?.addEventListener('click', async () => {
    const walk = state.activeWalk;
    if (!walk) {
      await startWalk({ routeMode: 'tracking' });
    } else if (walk.paused) {
      resumeWalk();
    } else {
      pauseWalk();
    }
    updateRadialWalkButton();
  });

  pauseBtn?.addEventListener('click', () => {
    if (state.activeWalk) {
      void stopWalk();
    }
    updateRadialWalkButton();
  });

  chevron?.addEventListener('click', () => toggleRadialMenu());

  window.addEventListener('walk-display-updated', () => updateRadialWalkButton());
  window.addEventListener('radial-starred-changed', () => renderRadialWheel());

  updateRadialWalkButton();
  renderRadialWheel();
}
