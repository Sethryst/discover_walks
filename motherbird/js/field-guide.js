import { state } from './state.js';
import { el, escapeHtml } from './utils.js';

function viewportPois() {
  return (state.cityPois[state.activeCity] || []).filter((poi) => {
    if (!state.map) return true;
    try { return state.map.getBounds().contains([poi.lat, poi.lng]); } catch { return true; }
  });
}

function noticesForPoi(poi) {
  const source = Array.isArray(poi.notices) ? poi.notices : poi.notice ? [poi.notice] : [];
  return source.map((notice) => typeof notice === 'string' ? { text: notice } : notice).filter((notice) => notice?.text || notice?.title || notice?.body);
}

export function renderFieldGuide() {
  const target = el('fieldGuideList');
  if (!target) return;
  const notices = viewportPois().flatMap((poi) => noticesForPoi(poi).map((notice) => ({ poi, notice })));
  const visible = notices.length > 0;
  target.classList.toggle('hidden', !visible);
  el('fieldGuideCount')?.classList.toggle('hidden', !visible);
  el('fieldGuideSeason')?.classList.add('hidden');
  el('fieldGuideFilters')?.classList.add('hidden');
  target.innerHTML = notices.map(({ poi, notice }) => `<article class="guide-card" data-guide-poi="${escapeHtml(String(poi.id))}"><span class="guide-group">${escapeHtml(poi.name || 'Map notice')}</span><h3>${escapeHtml(notice.title || 'Notice')}</h3><p>${escapeHtml(notice.text || notice.body || '')}</p></article>`).join('');
}

export function initFieldGuideFilters() {
  el('fieldGuideList')?.addEventListener('click', (event) => {
    const card = event.target.closest('[data-guide-poi]');
    const poi = (state.cityPois[state.activeCity] || []).find((item) => String(item.id) === card?.dataset.guidePoi);
    if (!poi || !state.map) return;
    state.map.flyTo([poi.lat, poi.lng], Math.max(state.map.getZoom(), 16));
  });
  window.addEventListener('field-guide-entry-requested', () => window.dispatchEvent(new CustomEvent('backpack-open-requested')));
  window.addEventListener('map-viewport-changed', () => { if (state.modalOpen === 'backpackSheet') renderFieldGuide(); });
}
