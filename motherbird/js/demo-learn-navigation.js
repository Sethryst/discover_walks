import { state } from './state.js';
import db from './storage.js';
import { getStarredActions, isActionStarred, toggleStarAction } from './radial-menu.js';

const ACTIONS = {
  nearby: { id: 'learn-nearby', label: 'Nearby', icon: '⌖' },
  shop: { id: 'learn-shop', label: 'Shop', icon: '♢' },
  nature: { id: 'learn-nature', label: 'Nature', icon: '✿' },
  history: { id: 'learn-history', label: 'History', icon: '▣' }
};

function button(label, tab, active = false) {
  const item = ACTIONS[tab];
  const starred = isActionStarred(item.id);
  return `<div class="demo-learn-bubble"><button type="button" class="demo-learn-tab ${active ? 'active' : ''}" data-demo-learn-tab="${tab}" aria-pressed="${active}"><span aria-hidden="true">${item.icon}</span>${label}</button><button type="button" class="demo-learn-star ${starred ? 'on' : ''}" data-demo-learn-star="${tab}" aria-label="${starred ? 'Remove' : 'Add'} ${label} to quick menu" aria-pressed="${starred}">${starred ? '★' : '☆'}</button></div>`;
}

function findPanel(root, tab) {
  if (tab === 'nearby') return root.querySelector('.learn-authored, .learn-nearby');
  if (tab === 'shop') return root.querySelector('.learn-experience-library');
  if (tab === 'nature') return root.querySelector('.learn-category-nature');
  return root.querySelector('.learn-category-history');
}

function setTab(root, tab) {
  const panels = {
    nearby: [root.querySelector('.learn-authored'), root.querySelector('.learn-nearby')],
    shop: [root.querySelector('.learn-experience-library')],
    nature: [root.querySelector('.learn-category-nature')],
    history: [root.querySelector('.learn-category-history')]
  };
  Object.entries(panels).forEach(([id, nodes]) => nodes.filter(Boolean).forEach((node) => node.classList.toggle('demo-learn-panel-hidden', id !== tab)));
  root.querySelectorAll('[data-demo-learn-tab]').forEach((control) => {
    const active = control.dataset.demoLearnTab === tab;
    control.classList.toggle('active', active);
    control.setAttribute('aria-pressed', String(active));
  });
  root.dataset.demoLearnTab = tab;
}

function separateProtectedLand(root) {
  const nature = root.querySelector('.learn-category-nature');
  const protectedButton = nature?.querySelector('[data-learn-open="protected"]');
  if (!nature || !protectedButton || root.querySelector('.demo-protected-land')) return;
  const protectedDetails = document.createElement('details');
  protectedDetails.className = 'learn-category demo-protected-land';
  protectedDetails.open = false;
  protectedDetails.innerHTML = '<summary class="learn-section-summary">Protected land <span>1</span></summary><div class="learn-category-options"></div>';
  protectedDetails.querySelector('.learn-category-options').append(protectedButton);
  nature.after(protectedDetails);
}

function normalizeLabels(root) {
  root.querySelector('.learn-authored > summary')?.replaceChildren(document.createTextNode('Nearby '), ...root.querySelector('.learn-authored > summary').querySelectorAll('span'));
  root.querySelectorAll('.learn-entry h3').forEach((heading) => {
    const text = heading.textContent.trim();
    if (text === 'History sites') heading.textContent = 'Sites';
    if (text === 'Historic topo maps') heading.textContent = 'Topographic Maps';
    if (text === 'Historic battlefields') heading.textContent = 'Battlefields';
  });
}

function decorate(root) {
  if (root.dataset.demoLearnNavigation === '1') return;
  root.dataset.demoLearnNavigation = '1';
  normalizeLabels(root);
  separateProtectedLand(root);
  const header = root.querySelector('.learn-workspace-header');
  const nav = document.createElement('nav');
  nav.className = 'demo-learn-bubbles';
  nav.setAttribute('aria-label', 'Learn categories');
  nav.innerHTML = button('Nearby', 'nearby', true) + button('Shop', 'shop') + button('Nature', 'nature') + button('History', 'history');
  header?.after(nav);
  const shop = root.querySelector('.learn-experience-library');
  if (shop) shop.querySelector('summary')?.setAttribute('aria-label', 'Shop experiences');
  setTab(root, 'nearby');
}

document.addEventListener('click', (event) => {
  const tab = event.target.closest('[data-demo-learn-tab]');
  if (tab) {
    const root = tab.closest('.learn-category-groups');
    if (root) setTab(root, tab.dataset.demoLearnTab);
    return;
  }
  const star = event.target.closest('[data-demo-learn-star]');
  if (star) {
    event.preventDefault();
    event.stopPropagation();
    const item = ACTIONS[star.dataset.demoLearnStar];
    void toggleStarAction(item).then(() => {
      const root = star.closest('.learn-category-groups');
      if (root) decorate(root);
      star.classList.toggle('on', isActionStarred(item.id));
      star.textContent = isActionStarred(item.id) ? '★' : '☆';
    });
  }
});

const observer = new MutationObserver(() => document.querySelectorAll('.learn-category-groups').forEach(decorate));
observer.observe(document.body, { childList: true, subtree: true });
document.querySelectorAll('.learn-category-groups').forEach(decorate);

window.addEventListener('radial-starred-changed', () => document.querySelectorAll('.learn-category-groups').forEach((root) => {
  root.querySelectorAll('[data-demo-learn-star]').forEach((star) => {
    const item = ACTIONS[star.dataset.demoLearnStar];
    const active = isActionStarred(item.id);
    star.classList.toggle('on', active); star.textContent = active ? '★' : '☆'; star.setAttribute('aria-pressed', String(active));
  });
}));

void db;
void state;
