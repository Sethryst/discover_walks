import { openJournal, openSheet, closeSheets } from './ui.js';
import { state } from './state.js';
import { CITIES } from './constants.js';
import { initRadialMenu, isActionStarred, toggleStarAction } from './radial-menu.js?v=20261103-radial-start-walk-1';
import { generateTimeBasedPlan } from './planner.js';
import { openObservation } from './observation.js?v=20261103-observation-icons-2';
import { openWorkspaceTool } from './workspace.js';

const actions = {
  walk: [
    { id: 'journal-observation', label: 'Add observation', icon: './icons/eye.svg', run: () => openObservation() },
  ],
  library: [
    { id: 'workspace-build-route', label: 'Build route', icon: './icons/route.svg', run: () => openWorkspaceTool('builder') },
    { id: 'workspace-journal', label: 'Open journal', icon: './icons/book.svg', run: () => openJournal() },
  ],
  me: [
    { id: 'me-companion', label: 'Companion and Maps', icon: './icons/heart.svg', run: () => window.dispatchEvent(new CustomEvent('companion-menu-requested')) },
    { id: 'me-online', label: 'Online', icon: './icons/globe.svg', run: () => { openSheet('backpackSheet'); window.dispatchEvent(new CustomEvent('utility-tab-requested', { detail: { tab: 'online' } })); } },
    { id: 'me-advanced', label: 'Advanced', advanced: true, children: [
      { id: 'me-export', label: 'Export data', icon: './icons/download.svg', run: () => { openSheet('backpackSheet'); window.dispatchEvent(new CustomEvent('utility-tab-requested', { detail: { tab: 'export' } })); } },
      { id: 'privacy', label: 'Data & privacy', icon: './icons/info.svg', run: () => { openSheet('backpackSheet'); window.dispatchEvent(new CustomEvent('utility-tab-requested', { detail: { tab: 'online' } })); } },
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
        // Keep the default shell closed while Explore data and map icons load;
        // the Explore workspace remains available from the primary tab.
        return;
      }
      const mapWorkspace = document.getElementById('mapWorkspacePanel');
      const exploreOpen = !initial && mapWorkspace?.dataset.destination === 'explore' && !mapWorkspace.classList.contains('hidden');
      window.dispatchEvent(new CustomEvent('map-workspace-open-requested', {
        detail: { destination: exploreOpen ? '' : 'explore', forceOpen: !exploreOpen }
      }));
      return;
    }
    if (tab === 'library') {
      panel.classList.add('hidden');
      state.settings.myPlacesSection = 'workspace';
      window.dispatchEvent(new CustomEvent('map-workspace-open-requested', {
        detail: { destination: 'maps', forceOpen: true }
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
      starBtn.setAttribute('aria-pressed', String(starred));
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
      starBtn.setAttribute('aria-pressed', String(starred));
      starBtn.setAttribute('aria-label', `${starred ? 'Unstar' : 'Star'} ${starBtn.parentElement?.querySelector('.shell-action-btn')?.textContent || 'action'}`);
      starBtn.innerHTML = starred ? '<span class="star-action-icon" aria-hidden="true">★</span>' : '<span class="star-action-icon" aria-hidden="true">☆</span>';
    });
  });
  window.addEventListener('radial-action-triggered', ({ detail }) => {
    const item = allActions().find((action) => action.id === detail?.id);
    if (item?.run) item.run();
  });
  document.getElementById('closePrimaryPanel')?.addEventListener('click', () => panel.classList.add('hidden'));
  const profileButton = document.getElementById('profileAvatarButton');
  const profileMenu = document.getElementById('profileMenu');
  const closeProfileMenu = () => { profileMenu?.classList.add('hidden'); profileButton?.setAttribute('aria-expanded', 'false'); };
  const openProfileSection = () => {
    select('me');
    const opening = profileMenu?.classList.contains('hidden');
    profileMenu?.classList.toggle('hidden', !opening);
    profileButton?.setAttribute('aria-expanded', String(opening));
    if (opening) panel.classList.remove('hidden');
  };
  if (profileButton) profileButton.onclick = openProfileSection;
  profileMenu?.addEventListener('click', (event) => {
    const action = event.target.closest('[data-profile-action]')?.dataset.profileAction;
    if (!action) return;
    closeProfileMenu();
    if (action === 'companion' || action === 'map') window.dispatchEvent(new CustomEvent('companion-menu-requested'));
    if (action === 'online') { openSheet('backpackSheet'); window.dispatchEvent(new CustomEvent('utility-tab-requested', { detail: { tab: 'online' } })); }
  });
  document.addEventListener('click', (event) => { if (!event.target.closest('.profile-control')) closeProfileMenu(); });
  document.getElementById('quickRadioButton')?.addEventListener('click', () => window.dispatchEvent(new CustomEvent('radio-open-requested')));
  document.getElementById('quickDrawButton')?.addEventListener('click', () => window.dispatchEvent(new CustomEvent('map-workspace-open-requested', { detail: { destination: 'draw', forceOpen: true } })));
  window.addEventListener('primary-panel-close-requested', () => panel.classList.add('hidden'));
  select('explore', { initial: true });
  const region = document.body.dataset.regionName || CITIES[state.activeCity]?.name || 'Fairfax County';
  document.getElementById('mapSearchInput')?.setAttribute('placeholder', 'Search');
  const regionalNavigation = document.getElementById('regionalNavigation')?.closest('.regional-navigation');
  if (regionalNavigation && window.matchMedia('(max-width: 720px)').matches) {
    regionalNavigation.style.position = 'static';
    regionalNavigation.style.left = 'auto';
    regionalNavigation.style.top = 'auto';
  }
  const syncRegionToWeather = () => {
    const weather = document.querySelector('.top-cluster>.weather-brief, .top-cluster>#weatherBrief');
    const regionControl = document.querySelector('.top-cluster>.regional-navigation');
    if (!weather || !regionControl) return;
    const width = weather.getBoundingClientRect().width;
    if (width > 0) regionControl.style.width = `${Math.round(width)}px`;
  };
  requestAnimationFrame(syncRegionToWeather);
  window.addEventListener('resize', syncRegionToWeather, { passive: true });
}
const topCluster = document.querySelector('.top-cluster');
if (topCluster) {
  const profile = topCluster.querySelector('.profile-control');
  const search = topCluster.querySelector('.map-search');
  const region = topCluster.querySelector('.regional-navigation');
  const locate = topCluster.querySelector('.locate-stack');
  const radio = topCluster.querySelector('#quickRadioButton');
  const draw = topCluster.querySelector('#quickDrawButton');
  [profile, search, locate, radio, draw, region].filter(Boolean).forEach((control) => topCluster.appendChild(control));
}
