import { openSheet, closeSheets } from './ui.js';
import { state } from './state.js';
import { CITIES } from './constants.js';

const actions = {
  walk: [['Start a free walk', () => document.getElementById('walkButton')?.click()], ['Sketch a nearby walk', () => document.getElementById('startChevron')?.click()], ['Follow a saved walk', () => openSheet('backpackSheet')], ['Draw a route', () => document.querySelector('[data-map-destination="draw"]')?.click()]],
  library: [['Journal', () => openSheet('journalSheet')], ['Observations', () => { openSheet('journalSheet'); document.getElementById('observeButton')?.click(); }], ['Saved walks & places', () => document.querySelector('[data-map-destination="maps"]')?.click()], ['Field Guide', () => openSheet('backpackSheet')], ['Nearby audio', () => openSheet('geoCypherSheet')]],
  me: [['Messenger Bird', () => openSheet('messengerInboxSheet')], ['Companion', () => document.getElementById('companionButton')?.click()], ['Walking alerts', () => document.getElementById('locateChevron')?.click()], ['Offline & maps', () => openSheet('backpackSheet')], ['Data & privacy', () => { openSheet('backpackSheet'); document.querySelector('[data-guide-tab="online"]')?.click(); }], ['Sharing', () => { openSheet('backpackSheet'); document.querySelector('[data-guide-tab="online"]')?.click(); }]],
};

export function initPrimaryShell() {
  const panel = document.getElementById('primaryPanel');
  const title = document.getElementById('primaryPanelTitle');
  const list = document.getElementById('primaryPanelActions');
  const select = (tab) => {
    document.body.dataset.primaryTab = tab;
    document.querySelectorAll('[data-primary-tab]').forEach((button) => {
      const active = button.dataset.primaryTab === tab;
      button.classList.toggle('active', active);
      active ? button.setAttribute('aria-current', 'page') : button.removeAttribute('aria-current');
    });
    closeSheets();
    document.body.classList.toggle('shell-library', tab === 'library');
    document.body.classList.toggle('shell-me', tab === 'me');
    document.body.classList.toggle('shell-walk', tab === 'walk');
    if (tab === 'explore') { panel.classList.add('hidden'); return; }
    title.textContent = tab[0].toUpperCase() + tab.slice(1);
    list.replaceChildren();
    for (const [label, run] of actions[tab] || []) {
      const button = document.createElement('button');
      button.type = 'button'; button.textContent = label;
      button.addEventListener('click', () => { panel.classList.add('hidden'); run(); });
      list.append(button);
    }
    panel.classList.remove('hidden');
  };
  document.querySelectorAll('[data-primary-tab]').forEach((button) => button.addEventListener('click', () => select(button.dataset.primaryTab)));
  document.getElementById('closePrimaryPanel')?.addEventListener('click', () => panel.classList.add('hidden'));
  select('explore');
  const region = document.body.dataset.regionName || CITIES[state.activeCity]?.name || 'Fairfax County';
  document.getElementById('mapSearchInput')?.setAttribute('placeholder', `Search ${region}`);
}
