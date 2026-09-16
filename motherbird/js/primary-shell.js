import { openBackpack, openJournal, openSheet, closeSheets } from './ui.js';
import { state } from './state.js';
import { CITIES } from './constants.js';
import { initRadialMenu, isActionStarred, toggleStarAction } from './radial-menu.js';
import { generateTimeBasedPlan } from './planner.js';

const actions = {
  walk: [
    { id: 'sketch-walk', label: 'Sketch a nearby walk', icon: '🗺️', run: () => void generateTimeBasedPlan() },
    { id: 'field-guide', label: 'Follow a saved walk', icon: '🎒', run: () => void openBackpack() },
    { id: 'draw', label: 'Draw a route', icon: '✏️', run: () => document.querySelector('[data-map-destination="draw"]')?.click() }
  ],
  library: [
    { id: 'journal', label: 'Journal', icon: '▦', run: () => void openJournal() },
    { id: 'observe', label: 'Observations', icon: '📷', run: () => { openSheet('journalSheet'); document.getElementById('observeButton')?.click(); } },
    { id: 'saved-places', label: 'Saved walks & places', icon: '📍', run: () => document.querySelector('[data-map-destination="maps"]')?.click() },
    { id: 'field-guide', label: 'Field Guide', icon: '🎒', run: () => void openBackpack() },
    { id: 'cypher', label: 'Nearby audio', icon: '◉', run: () => openSheet('geoCypherSheet') }
  ],
  me: [
    { id: 'messenger', label: 'Messenger Bird', icon: '🐦', run: () => openSheet('messengerInboxSheet') },
    { id: 'companion', label: 'Companion', icon: '🐾', run: () => document.getElementById('companionButton')?.click() },
    { id: 'alerts', label: 'Walking alerts', icon: '🔔', run: () => document.getElementById('locateChevron')?.click() },
    { id: 'offline-maps', label: 'Offline & maps', icon: '💾', run: () => openSheet('backpackSheet') },
    { id: 'privacy', label: 'Data & privacy', icon: '🔒', run: () => { openSheet('backpackSheet'); document.querySelector('[data-guide-tab="online"]')?.click(); } },
    { id: 'help', label: 'App Help & Guide', icon: '❓', run: () => openSheet('helpSheet') }
  ]
};

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
    if (tab === 'explore') {
      panel.classList.add('hidden');
      if (!initial) window.dispatchEvent(new CustomEvent('map-workspace-open-requested', { detail: { destination: wasActive ? '' : 'explore' } }));
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
    for (const item of actions[tab] || []) {
      const row = document.createElement('div');
      row.className = 'shell-action-row';

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'shell-action-btn';
      button.textContent = item.label;
      button.addEventListener('click', () => { panel.classList.add('hidden'); item.run(); });

      const starBtn = document.createElement('button');
      starBtn.type = 'button';
      starBtn.dataset.actionId = item.id;
      const starred = isActionStarred(item.id);
      starBtn.className = `star-action-btn ${starred ? 'starred' : ''}`;
      starBtn.setAttribute('aria-label', `${starred ? 'Unstar' : 'Star'} ${item.label}`);
      starBtn.textContent = starred ? '⭐' : '☆';
      starBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        void toggleStarAction({ id: item.id, label: item.label, icon: item.icon, action: item.run });
      });

      row.append(button, starBtn);
      list.append(row);
    }
    panel.classList.remove('hidden');
  };
  document.querySelectorAll('[data-primary-tab]').forEach((button) => button.addEventListener('click', () => select(button.dataset.primaryTab)));
  window.addEventListener('radial-starred-changed', () => {
    document.querySelectorAll('.star-action-btn[data-action-id]').forEach((starBtn) => {
      const starred = isActionStarred(starBtn.dataset.actionId);
      starBtn.classList.toggle('starred', starred);
      starBtn.setAttribute('aria-label', `${starred ? 'Unstar' : 'Star'} ${starBtn.parentElement?.querySelector('.shell-action-btn')?.textContent || 'action'}`);
      starBtn.textContent = starred ? '⭐' : '☆';
    });
  });
  window.addEventListener('radial-action-triggered', ({ detail }) => {
    const item = Object.values(actions).flat().find((action) => action.id === detail?.id);
    if (item?.run) item.run();
  });
  document.getElementById('closePrimaryPanel')?.addEventListener('click', () => panel.classList.add('hidden'));
  select('explore', { initial: true });
  const region = document.body.dataset.regionName || CITIES[state.activeCity]?.name || 'Fairfax County';
  document.getElementById('mapSearchInput')?.setAttribute('placeholder', `Search ${region}`);
}
