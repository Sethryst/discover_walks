import { state } from './state.js';
import { escapeHtml } from './utils.js';
import db from './storage.js';

export const LEARN_GROUPS = [
  { id: 'history', label: 'History', color: '#7a2d1d', art: 'band', children: [
    { id: 'history', label: 'History sites' },
    { id: 'topo', label: 'Historic topo maps' },
    { id: 'battlefields', label: 'Historic battlefields' }
  ]},
  { id: 'nature', label: 'Nature', color: '#2d7259', art: 'ridge', children: [
    { id: 'watersheds', label: 'Watersheds' },
    { id: 'names', label: 'Named landscape' },
    { id: 'protected', label: 'Protected land' },
    { id: 'wildlife', label: 'Wildlife recorded here' }
  ]}
];

function childById(id) {
  for (const group of LEARN_GROUPS) {
    const child = group.children.find((item) => item.id === id);
    if (child) return { ...child, color: group.color, group: group.id };
  }
  return null;
}

export function starredLearnIds() {
  return [...new Set(state.settings?.favoriteLearn || [])].filter((id) => childById(id));
}

export function isLearnStarred(id) {
  return starredLearnIds().includes(id);
}

export async function toggleLearnStar(id) {
  if (!childById(id)) return starredLearnIds();
  const next = new Set(starredLearnIds());
  if (next.has(id)) next.delete(id);
  else next.add(id);
  state.settings = { ...(state.settings || {}), favoriteLearn: [...next] };
  await db.put('settings', state.settings);
  return [...next];
}

function starButton(id) {
  const on = isLearnStarred(id);
  return `<button type="button" class="learn-star ${on ? 'on' : ''}" data-learn-star="${escapeHtml(id)}" aria-pressed="${on}" aria-label="${on ? 'Remove star' : 'Star this view'}">★</button>`;
}

function groupArt(group) {
  return `<span class="learn-art learn-art-${escapeHtml(group.art)}" aria-hidden="true"></span>`;
}

export function learnLibraryHtml() {
  const starred = starredLearnIds().map((id) => childById(id)).filter(Boolean);
  const starredHtml = starred.length
    ? `<div class="learn-starred">${starred.map((item) => `<div class="learn-row" style="--learn-color:${escapeHtml(item.color)}"><button type="button" class="guide-card learn-entry" data-learn-open="${escapeHtml(item.id)}"><h3>${escapeHtml(item.label)}</h3></button>${starButton(item.id)}</div>`).join('')}</div>`
    : `<p class="learn-progress">Star a view. It stays on this first page.</p>`;
  const groups = LEARN_GROUPS.map((group) => `<button type="button" class="guide-card learn-group" data-learn-group="${escapeHtml(group.id)}" style="--learn-color:${escapeHtml(group.color)}">${groupArt(group)}<h3>${escapeHtml(group.label)}</h3></button>`).join('');
  return `<section class="learn-history learn-library"><h3 class="learn-kicker">Starred</h3>${starredHtml}<h3 class="learn-kicker">Folders</h3><div class="learn-groups">${groups}</div></section>`;
}

function groupIdFromTitle(title) {
  return ({ History: 'history', Nature: 'nature' })[title] || null;
}

function bindLearnLibrary() {
  if (bindLearnLibrary.bound) return;
  bindLearnLibrary.bound = true;
  document.addEventListener('click', (event) => {
    const library = event.target.closest('[data-learn-library]');
    if (library) {
      const list = document.getElementById('fieldGuideList');
      if (list) list.innerHTML = learnLibraryHtml();
      return;
    }
    const group = event.target.closest('[data-learn-group]');
    if (group) {
      const list = document.getElementById('fieldGuideList');
      if (list) list.innerHTML = learnGroupHtml(group.dataset.learnGroup);
      return;
    }
    const star = event.target.closest('[data-learn-star]');
    if (star) {
      event.preventDefault();
      event.stopPropagation();
      const list = document.getElementById('fieldGuideList');
      void toggleLearnStar(star.dataset.learnStar).then(() => {
        if (!list) return;
        const groupId = list.querySelector('[data-learn-library]') ? groupIdFromTitle(list.querySelector('.learn-kicker')?.textContent) : null;
        list.innerHTML = groupId ? learnGroupHtml(groupId) : learnLibraryHtml();
      });
    }
  });
}

bindLearnLibrary();

export function learnGroupHtml(groupId) {
  const group = LEARN_GROUPS.find((item) => item.id === groupId);
  if (!group) return learnLibraryHtml();
  const rows = group.children.map((item) => `<div class="learn-row" style="--learn-color:${escapeHtml(group.color)}"><button type="button" class="guide-card learn-entry" data-learn-open="${escapeHtml(item.id)}"><h3>${escapeHtml(item.label)}</h3></button>${starButton(item.id)}</div>`).join('');
  return `<section class="learn-history learn-library"><button type="button" class="secondary-button" data-learn-library="1">Back</button><h3 class="learn-kicker">${escapeHtml(group.label)}</h3>${rows}</section>`;
}
