import { openBackpack, openJournal, openSheet, closeSheets } from './ui.js';
import { state } from './state.js';
import { CITIES } from './constants.js';
import { initRadialMenu, isActionStarred, toggleStarAction } from './radial-menu.js';
import { generateTimeBasedPlan } from './planner.js';

const actions = {
  walk: [
    { id: 'walk-field-guide', label: 'Follow a saved walk', icon: './icons/book-open.svg', run: () => void openBackpack() },
    { id: 'walk-draw', label: 'Draw a route', icon: './icons/pencil.svg', run: () => window.dispatchEvent(new CustomEvent('map-workspace-open-requested', { detail: { destination: 'draw', forceOpen: true } })) }
  ],
  library: [
    { id: 'library-field-guide', label: 'Field Guide', icon: './icons/book-open.svg', run: () => void openBackpack() },
    { id: 'journal', label: 'Journal', icon: './icons/grid.svg', run: () => void openJournal() },
    { id: 'observe', label: 'Observations & audio notes', icon: './icons/camera.svg', run: () => { openSheet('journalSheet'); document.getElementById('observeButton')?.click(); } },
    { id: 'saved-places', label: 'Saved walks & places', icon: './icons/map-pin.svg', run: () => window.dispatchEvent(new CustomEvent('map-workspace-open-requested', { detail: { destination: 'maps', forceOpen: true } })) },
  ],
  me: [
    { id: 'me-companion', label: 'Companion', icon: './icons/heart.svg', run: () => window.dispatchEvent(new CustomEvent('companion-menu-requested')) },
    { id: 'me-draw', label: 'Draw & annotations', icon: './icons/pencil.svg', run: () => window.dispatchEvent(new CustomEvent('map-workspace-open-requested', { detail: { destination: 'draw', forceOpen: true } })) },
    { id: 'me-radio', label: 'Radio', icon: './icons/music.svg', run: () => window.dispatchEvent(new CustomEvent('radio-open-requested')) },
    { id: 'me-online', label: 'Online', icon: './icons/globe.svg', run: () => { openSheet('backpackSheet'); document.querySelector('[data-guide-tab="online"]')?.click(); } },
    { id: 'me-advanced', label: 'Advanced', advanced: true, children: [
      { id: 'offline-maps', label: 'Offline & maps', icon: './icons/map.svg', run: () => openSheet('backpackSheet') },
      { id: 'privacy', label: 'Data & privacy', icon: './icons/info.svg', run: () => { openSheet('backpackSheet'); document.querySelector('[data-guide-tab="online"]')?.click(); } },
      { id: 'help', label: 'App Help & Guide', icon: './icons/info.svg', run: () => openSheet('helpSheet') }
    ] }
  ]
};

function allActions() {
  return Object.values(actions).flatMap((items) => items.flatMap((item) => item.advanced ? item.children : item));
}

export function initPrimaryShell() {
  initRadialMenu();
  const panel = document.getElementById('primaryPanel');
  const title = document.getElementById('primaryPanelTitle');
  const list = document.getElementById('primaryPanelActions');
  const select = (tab, { initial = false } = {}) => {
    const wasActive = document.body.dataset.primaryTab === tab;
    document.body.dataset.primaryTab = tab;
    document.querySelectorAll('[data-primary-tab]').forEach((button) => {
      const active = button.dataset.primaryTab === tab;
      button.classList.toggle('active', active);
      active ? button.setAttribute('aria-current', 'page') : button.removeAttribute('aria-current');
    });
    closeSheets();
    document.body.classList.toggle('shell-explore', tab === 'explore');
    document.body.classList.toggle('shell-library', tab === 'library');
    document.body.classList.toggle('shell-me', tab === 'me');
    document.body.classList.toggle('shell-walk', tab === 'walk');
    window.dispatchEvent(new CustomEvent('primary-tab-changed', { detail: { tab } }));
    if (tab === 'explore') {
      panel.classList.add('hidden');
      if (initial) {
        // Boot is deliberately map-only. Explore is a destination the user
        // opens, not a panel that should appear on first load.
        window.dispatchEvent(new CustomEvent('map-workspace-open-requested', { detail: { destination: '' } }));
        return;
      }
      const mapWorkspace = document.getElementById('mapWorkspacePanel');
      const exploreOpen = !initial && mapWorkspace?.dataset.destination === 'explore' && !mapWorkspace.classList.contains('hidden');
      window.dispatchEvent(new CustomEvent('map-workspace-open-requested', {
        detail: { destination: exploreOpen ? '' : 'explore', forceOpen: !exploreOpen }
      }));
      return;
    }
    // The map workspace belongs to Explore. Close it before showing a shell
    // pane so the two panels cannot become a conjoined white block.
    window.dispatchEvent(new CustomEvent('map-workspace-open-requested', { detail: { destination: '' } }));
    if (wasActive && !panel.classList.contains('hidden')) {
      panel.classList.add('hidden');
      return;
    }
    title.textContent = tab[0].toUpperCase() + tab.slice(1);
    list.replaceChildren();
    const renderAction = (item) => {
      const row = document.createElement('div');
      row.className = 'shell-action-row';

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'shell-action-btn';
      button.dataset.actionId = item.id;
      button.innerHTML = `<img src="${item.icon}" alt="" aria-hidden="true"><span>${item.label}</span>`;
      button.addEventListener('click', () => { panel.classList.add('hidden'); item.run(); });

      const starBtn = document.createElement('button');
      starBtn.type = 'button';
      starBtn.dataset.actionId = item.id;
      const starred = isActionStarred(item.id);
      starBtn.className = `star-action-btn ${starred ? 'starred' : ''}`;
      starBtn.setAttribute('aria-label', `${starred ? 'Unstar' : 'Star'} ${item.label}`);
      starBtn.innerHTML = starred ? '<span class="star-action-icon" aria-hidden="true">★</span>' : '<span class="star-action-icon" aria-hidden="true">☆</span>';
      starBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        void toggleStarAction({ id: item.id, label: item.label, icon: item.icon, action: item.run });
      });

      row.append(button, starBtn);
      return row;
    };
    for (const item of actions[tab] || []) {
      if (item.advanced) {
        const details = document.createElement('details');
        details.className = 'shell-advanced-actions';
        details.innerHTML = `<summary>${item.label}</summary>`;
        item.children.forEach((child) => details.append(renderAction(child)));
        list.append(details);
      } else list.append(renderAction(item));
    }
    panel.classList.remove('hidden');
  };
  document.querySelectorAll('[data-primary-tab]').forEach((button) => button.addEventListener('click', () => select(button.dataset.primaryTab)));
  window.addEventListener('radial-starred-changed', () => {
    document.querySelectorAll('.star-action-btn[data-action-id]').forEach((starBtn) => {
      const starred = isActionStarred(starBtn.dataset.actionId);
      starBtn.classList.toggle('starred', starred);
      starBtn.setAttribute('aria-label', `${starred ? 'Unstar' : 'Star'} ${starBtn.parentElement?.querySelector('.shell-action-btn')?.textContent || 'action'}`);
      starBtn.innerHTML = starred ? '<span class="star-action-icon" aria-hidden="true">★</span>' : '<span class="star-action-icon" aria-hidden="true">☆</span>';
    });
  });
  window.addEventListener('radial-action-triggered', ({ detail }) => {
    const item = allActions().find((action) => action.id === detail?.id);
    if (item?.run) item.run();
  });
  document.getElementById('closePrimaryPanel')?.addEventListener('click', () => panel.classList.add('hidden'));
  window.addEventListener('primary-panel-close-requested', () => panel.classList.add('hidden'));
  select('explore', { initial: true });
  const region = document.body.dataset.regionName || CITIES[state.activeCity]?.name || 'Fairfax County';
  document.getElementById('mapSearchInput')?.setAttribute('placeholder', `Search ${region}`);
}
