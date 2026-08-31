import { state } from './state.js';
import { el, escapeHtml } from './utils.js';
import { poiTags } from './poi.js';

let activeGuideGroup = '';
let activeGuideSubject = '';

// Educational subjects are separate from POIs. A future reviewed Gremlin guide
// package can extend this contract with regional and seasonal subjects.
export const FIELD_GUIDE_SUBJECTS = [
  { id: 'red-tailed-hawk', group: 'Birds', name: 'Red-tailed Hawk', cue: 'Broad wings, a pale chest, and a rusty-red adult tail. Often watches roadsides and open parks from a high perch.', relatedTags: ['park', 'nature', 'wildlife'], sourceName: 'Cornell Lab of Ornithology', sourceUrl: 'https://www.allaboutbirds.org/guide/Red-tailed_Hawk/overview' },
  { id: 'great-blue-heron', group: 'Birds', name: 'Great Blue Heron', cue: 'A very large gray-blue wading bird with long legs and a folded S-shaped neck in flight.', relatedTags: ['water', 'water_access', 'park'], sourceName: 'Cornell Lab of Ornithology', sourceUrl: 'https://www.allaboutbirds.org/guide/Great_Blue_Heron/overview' },
  { id: 'northern-cardinal', group: 'Birds', name: 'Northern Cardinal', cue: 'Listen for clear whistled phrases. Both sexes have a crest; males are bright red and females warm brown.', relatedTags: ['community_garden', 'park', 'nature'], sourceName: 'Cornell Lab of Ornithology', sourceUrl: 'https://www.allaboutbirds.org/guide/Northern_Cardinal/overview' },
  { id: 'urban-tree-canopy', group: 'Trees & Ecology', name: 'Reading the tree canopy', cue: 'Notice where connected crowns cool pavement, shelter birds, and change how a block feels in sun and wind.', relatedTags: ['park', 'trail', 'nature'], sourceName: 'US Forest Service', sourceUrl: 'https://www.fs.usda.gov/managing-land/urban-forests' },
  { id: 'stream-valley', group: 'Ecology', name: 'Stream-valley habitat', cue: 'Look for floodplain trees, damp-soil plants, exposed roots, and wildlife corridors following the water.', relatedTags: ['water', 'water_access', 'trail'], sourceName: 'National Park Service', sourceUrl: 'https://www.nps.gov/subjects/rivers/index.htm' },
  { id: 'historic-landscape', group: 'History', name: 'Reading a historic landscape', cue: 'Street alignment, stonework, old trees, boundaries, and building orientation can preserve history beyond a marker.', relatedTags: ['history', 'history_marker', 'history_landmark'], sourceName: 'National Park Service', sourceUrl: 'https://www.nps.gov/subjects/culturallandscapes/index.htm' },
  { id: 'public-art-context', group: 'Art', name: 'Looking closely at public art', cue: 'Walk around it. Notice material, scale, sightlines, weathering, and how the work changes the surrounding place.', relatedTags: ['public_art', 'art'], sourceName: 'Smithsonian American Art Museum', sourceUrl: 'https://americanart.si.edu/art/conservation/outdoor-sculpture' }
];

function relevance(subject) {
  const localPois = (state.cityPois[state.activeCity] || []).filter((poi) => {
    if (!state.map) return true;
    try { return state.map.getBounds().contains([poi.lat, poi.lng]); } catch { return true; }
  });
  const localTags = new Set(localPois.flatMap(poiTags));
  const interests = new Set(state.settings?.favoriteCategories || []);
  return subject.relatedTags.reduce((score, tag) => score + (localTags.has(tag) ? 2 : 0) + (interests.has(tag) ? 3 : 0), 0);
}

function seasonNote(date = new Date()) {
  const month = date.getMonth();
  if (month <= 1) return 'Winter field note: look for structure—evergreen cover, bark, water, and the birds that remain.';
  if (month <= 4) return 'Spring field note: listen for returning birds and notice new growth along water and paths.';
  if (month <= 7) return 'Summer field note: shade, water, and the edges between planted and wild spaces tell a fuller story.';
  if (month <= 10) return 'Autumn field note: watch for changing canopy, seed heads, and movement along sheltered corridors.';
  return 'Early winter field note: take a slower look at the forms that stay visible after leaves fall.';
}

export function renderFieldGuide() {
  const target = el('fieldGuideList');
  if (!target) return;
  const allSubjects = FIELD_GUIDE_SUBJECTS.map((subject) => ({ ...subject, relevance: relevance(subject) })).filter((subject) => subject.relevance > 0).sort((a, b) => b.relevance - a.relevance || a.name.localeCompare(b.name));
  const subjects = allSubjects.filter((subject) => (!activeGuideGroup || subject.group === activeGuideGroup) && (!activeGuideSubject || subject.id === activeGuideSubject));
  const filterTarget = el('fieldGuideFilters');
  const groups = [...new Set(allSubjects.map((subject) => subject.group))];
  if (filterTarget) filterTarget.innerHTML = groups.map((group) => `<button type="button" class="poi-chip ${activeGuideGroup === group ? 'active' : ''}" aria-pressed="${activeGuideGroup === group}" data-guide-group="${escapeHtml(group)}">${escapeHtml(group)}</button>`).join('');
  el('fieldGuideCount').textContent = subjects.length ? 'Things to notice in this view' : 'Field Guide';
  el('fieldGuideSeason').textContent = seasonNote();
  const available = subjects.length ? `<p class="guide-availability"><strong>In this guide:</strong> ${[...new Set(subjects.map((subject) => subject.group))].map(escapeHtml).join(' · ')}<span>Ordered for this region${state.settings?.favoriteCategories?.length ? ' and what you chose to notice' : ''}.</span></p>` : '';
  target.innerHTML = subjects.length ? available + subjects.map((subject) => `<article class="guide-card"><span class="guide-group">${escapeHtml(subject.group)}</span><h3>${escapeHtml(subject.name)}</h3><p>${escapeHtml(subject.cue)}</p><a href="${escapeHtml(subject.sourceUrl)}" target="_blank" rel="noreferrer">Learn with ${escapeHtml(subject.sourceName)} ↗</a></article>`).join('') : '';
}

export function initFieldGuideFilters() {
  el('fieldGuideFilters')?.addEventListener('click', (event) => { const button = event.target.closest('[data-guide-group]'); if (!button) return; activeGuideSubject = ''; activeGuideGroup = activeGuideGroup === button.dataset.guideGroup ? '' : button.dataset.guideGroup; renderFieldGuide(); });
  window.addEventListener('field-guide-entry-requested', ({ detail }) => {
    const tags = new Set(poiTags(detail?.poi || {}));
    const subject = FIELD_GUIDE_SUBJECTS.find((item) => item.relatedTags.some((tag) => tags.has(tag)));
    activeGuideSubject = subject?.id || '';
    activeGuideGroup = '';
    window.dispatchEvent(new CustomEvent('backpack-open-requested'));
  });
  window.addEventListener('map-viewport-changed', () => { if (state.modalOpen === 'backpackSheet') renderFieldGuide(); });
}
