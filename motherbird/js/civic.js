import { CITIES } from './constants.js';
import { state } from './state.js';
import { el, escapeHtml } from './utils.js';
import db from './storage.js';

const cache = new Map();
const voteScope = {
  newyork: 'New York City — citywide Board of Elections',
  fairfax: 'Virginia — statewide election lookup'
};
const NYC_BOROUGHS = ['Bronx', 'Brooklyn', 'Manhattan', 'Queens', 'Staten Island'];
let currentVote = null;
let eventLocation = 'All';
const official = (url) => typeof url === 'string' && /^https:\/\//i.test(url) ? url : null;
const fresh = (item) => !item?.freshnessExpiresAt || Date.now() <= Date.parse(item.freshnessExpiresAt);
const empty = (message) => `<div class="empty-state"><strong>Nothing verified yet</strong><p>${escapeHtml(message)}</p></div>`;
const link = (url, label = 'Learn more') => `<a class="text-button" href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${escapeHtml(label)} ↗</a>`;
const civicLabel = (value, fallback = 'Upcoming') => {
  const labels = { general_election: 'General election', special_election: 'Special election', ballot_information: 'What’s on the ballot', public_hearing: 'Public hearing', town_hall: 'Town hall', meeting: 'Public meeting' };
  return labels[value] || (typeof value === 'string' ? value.replace(/[_-]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()) : fallback);
};

async function load() {
  const file = CITIES[state.activeCity]?.civicFile;
  if (!file) return null;
  if (cache.has(file)) return cache.get(file);
  try {
    const response = await fetch(file);
    const payload = response.ok ? await response.json() : null;
    // Civic packages include release metadata, while the renderer consumes
    // only named civic artifacts. Accept the legacy flat shape during the
    // transition so an already cached package cannot break the app.
    const data = payload?.artifacts || payload;
    cache.set(file, data);
    return data;
  } catch { return null; }
}
function civicCard(item, label = 'Upcoming') {
  const participation = item.participation?.whatYouWillDo || item.participation?.timeCommitment ? `<p>${escapeHtml([item.participation.whatYouWillDo, item.participation.timeCommitment].filter(Boolean).join(' · '))}</p>` : '';
  return `<article class="route-card civic-card"><p class="eyebrow">${escapeHtml(item.jurisdiction || civicLabel(label))}</p><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.summary)}</p>${participation}${link(item.url)}</article>`;
}
function vote(data = {}) {
  const election = data.nextElection;
  const artifactItems = Array.isArray(data.items) ? data.items : [];
  const cards = [];
  const scope = data.jurisdiction || voteScope[state.activeCity];
  if (election?.date && election?.type && fresh(election) && official(election.url)) cards.push(`<article class="route-card civic-card"><p class="eyebrow">NEXT ELECTION</p><strong>${escapeHtml(election.type)}</strong><p>${escapeHtml(election.date)}</p>${link(election.url)}</article>`);
  if (official(data.pollingLookupUrl)) cards.push(`<article class="route-card civic-card"><strong>Where can I vote?</strong><p>Use the official lookup. Your address is not stored by this app.</p>${link(data.pollingLookupUrl, 'Find my polling place')}</article>`);
  const activeItems = artifactItems.filter((item) => fresh({ freshnessExpiresAt: item.expiresAt }) && official(item.officialUrl));
  const pastItems = artifactItems.filter((item) => !fresh({ freshnessExpiresAt: item.expiresAt }) && official(item.officialUrl));
  if (activeItems.length) cards.push(`<section class="civic-group"><h3 class="civic-group-title">Upcoming</h3><div class="civic-card-list">${activeItems.slice(0, 12).map((item) => `${civicCard({ ...item, url: item.officialUrl, lifecycle: item.type }, item.type)}<button class="text-button civic-witness" data-civic-witness="voted" data-civic-item="${escapeHtml(item.id)}">I voted — save locally</button>`).join('')}</div></section>`);
  for (const item of (data.decisions || []).filter((item) => fresh(item) && official(item.url) && item.title && item.summary).slice(0, 12)) cards.push(civicCard(item, item.lifecycle || 'UPCOMING'));
  const meetings = (data.meetings || []).filter((item) => fresh(item) && official(item.url) && item.title && item.summary);
  const boroughs = state.activeCity === 'newyork' ? NYC_BOROUGHS.filter((borough) => meetings.some((item) => item.borough === borough)) : [];
  if (meetings.length) {
    const selected = currentVote?.borough || 'All';
    if (boroughs.length) cards.push(`<div class="poi-chips" role="group" aria-label="NYC borough meetings"><button class="poi-chip ${selected === 'All' ? 'active' : ''}" data-civic-borough="All">All NYC</button>${boroughs.map((borough) => `<button class="poi-chip ${selected === borough ? 'active' : ''}" data-civic-borough="${escapeHtml(borough)}">${escapeHtml(borough)}</button>`).join('')}</div>`);
    const visible = selected === 'All' ? meetings : meetings.filter((item) => item.borough === selected);
    cards.push(...visible.slice(0, 16).map((item) => civicCard(item, item.lifecycle || 'PUBLIC INPUT')));
  }
  if (pastItems.length) cards.push(`<details class="route-card civic-card civic-past"><summary>Past (${pastItems.length})</summary><div class="civic-card-list">${pastItems.map((item) => civicCard({ ...item, url: item.officialUrl, lifecycle: 'PAST' }, 'PAST')).join('')}</div></details>`);
  const content = cards.join('');
  return content ? `${scope ? `<p class="profile-section-intro">Voting jurisdiction: ${escapeHtml(scope)}.</p>` : ''}${content}` : empty('Official election and public-meeting information will appear when included in this region.');
}
function volunteer(items = [], organizers = []) {
  if (Array.isArray(items?.items)) items = items.items;
  const registry = new Map((organizers?.items || organizers || []).filter((item) => item?.id && item.name).map((item) => [item.id, item]));
  const cards = items.filter((item) => fresh({ freshnessExpiresAt: item.expiresAt }) && official(item.officialUrl) && item.title && item.summary).slice(0, 20)
    .map((item) => {
      // The registry is authoritative for a linked organizer card; the
      // opportunity's embedded name is only a fallback when no card exists.
      const organizer = registry.get(item.organizer?.id) || item.organizer;
      const participation = item.participation || {};
      const commitment = participation.timeCommitment || item.timeCommitment;
      const expiry = Number.isFinite(Date.parse(item.expiresAt)) ? `Available through ${new Date(item.expiresAt).toLocaleDateString()}` : '';
      return `<article class="route-card civic-card civic-volunteer-card"><p class="eyebrow">${escapeHtml(item.type || 'Volunteer opportunity')}${commitment ? ` · ${escapeHtml(commitment)}` : ''}</p><strong>${escapeHtml(item.title)}</strong>${organizer?.name ? `<p>${escapeHtml(organizer.name)}</p>` : ''}<p>${escapeHtml(participation.whatYouWillDo || item.summary)}</p>${participation.riskClarity ? `<p class="sheet-intro">Before you sign up: ${escapeHtml(participation.riskClarity)}</p>` : ''}${expiry ? `<p class="sheet-intro">${escapeHtml(expiry)}</p>` : ''}${link(item.officialUrl, 'Learn more / Sign up')}</article>`;
    });
  return cards.length ? `<section class="civic-group"><h3 class="civic-group-title">Verified opportunities</h3><div class="civic-card-list">${cards.join('')}</div></section>` : empty('Verified volunteer opportunities will appear when included in this region.');
}
function listingSources(items = []) {
  const source = (items?.items || items).find((item) => item?.title && item?.summary && official(item.officialUrl));
  return source ? `<section class="civic-group civic-source-group"><h3 class="civic-group-title">Explore more</h3><article class="route-card civic-card"><p class="eyebrow">Official source</p><strong>${escapeHtml(source.title)}</strong><p>${escapeHtml(source.summary)}</p>${link(source.officialUrl, 'Explore current listings')}</article></section>` : '';
}

export function eventFilterLabel(cityId = state.activeCity) {
  const name = CITIES[cityId]?.name;
  return name ? `All ${name} events` : 'All events';
}

export function humanSourceLabel(source) {
  return typeof source?.name === 'string' && source.name.trim() ? source.name.trim() : '';
}

export function renderCivicEventCard(item) {
  const venue = [item.locationLabel, item.venueAddress].filter(Boolean).join(' · ');
  const source = humanSourceLabel(item.source);
  return `<article class="route-card civic-card civic-event-card"><strong class="civic-card-title">${escapeHtml(item.title)}</strong><p class="civic-event-meta">${escapeHtml([venue, item.date].filter(Boolean).join(' · '))}</p><p>${escapeHtml(item.summary)}</p>${source ? `<p class="civic-source">${escapeHtml(source)}</p>` : ''}${link(item.officialUrl)}</article>`;
}
export async function renderCivic(view) {
  const target = el(view === 'vote' ? 'voteCivicContent' : 'volunteerCivicContent'); if (!target) return;
  target.innerHTML = '<div class="empty-state">Loading local civic information…</div>';
  const data = await load();
  if (view === 'vote') {
    currentVote = { data: { ...(data?.vote || {}), meetings: (data?.meetings?.items || []).map((item) => ({ ...item, url: item.officialUrl, freshnessExpiresAt: item.expiresAt })) }, borough: currentVote?.borough || 'All' };
    target.innerHTML = vote(currentVote.data);
    target.querySelectorAll('[data-civic-witness]').forEach((button) => button.addEventListener('click', async () => { await db.put('civic_witnesses', { id: `${button.dataset.civicWitness}:${button.dataset.civicItem}`, type: button.dataset.civicWitness, itemId: button.dataset.civicItem, city: state.activeCity, createdAt: new Date().toISOString() }); button.textContent = 'Saved on this device'; button.disabled = true; }));
    target.querySelectorAll('[data-civic-borough]').forEach((button) => button.addEventListener('click', () => { currentVote.borough = button.dataset.civicBorough; target.innerHTML = vote(currentVote.data); renderCivicBoroughControls(target); }));
  } else target.innerHTML = volunteer(data?.volunteer, data?.organizers) + listingSources(data?.['volunteer-sources']);
}
export async function renderCivicEvents() {
  const target = el('exploreEventsList'); if (!target) return;
  target.innerHTML = '<div class="empty-state">Loading verified local events…</div>';
  const data = await load();
  const items = data?.events?.items || [];
  const active = items.filter((item) => item?.title && item?.date && item?.summary && official(item.officialUrl) && Number.isFinite(Date.parse(item.expiresAt)) && Date.now() < Date.parse(item.expiresAt));
  const locations = [...new Set(active.map((item) => item.locationLabel).filter(Boolean))].sort();
  if (eventLocation !== 'All' && !locations.includes(eventLocation)) eventLocation = 'All';
  const visible = eventLocation === 'All' ? active : active.filter((item) => item.locationLabel === eventLocation);
  const filters = locations.length ? `<div class="poi-chips" role="group" aria-label="Event location"><button class="poi-chip ${eventLocation === 'All' ? 'active' : ''}" data-event-location="All">${escapeHtml(eventFilterLabel())}</button>${locations.map((location) => `<button class="poi-chip ${eventLocation === location ? 'active' : ''}" data-event-location="${escapeHtml(location)}">${escapeHtml(location)}</button>`).join('')}</div>` : '';
  const verifiedCards = visible.length ? visible.map(renderCivicEventCard).join('') : empty('Verified civic events will appear here when included in this region.');
  target.innerHTML = filters + verifiedCards + listingSources(data?.['event-sources']);
  target.querySelectorAll('[data-event-location]').forEach((button) => button.addEventListener('click', () => { eventLocation = button.dataset.eventLocation; void renderCivicEvents(); }));
}
function renderCivicBoroughControls(target) { target.querySelectorAll('[data-civic-borough]').forEach((button) => button.addEventListener('click', () => { currentVote.borough = button.dataset.civicBorough; target.innerHTML = vote(currentVote.data); renderCivicBoroughControls(target); })); target.querySelectorAll('[data-civic-witness]').forEach((button) => button.addEventListener('click', async () => { await db.put('civic_witnesses', { id: `${button.dataset.civicWitness}:${button.dataset.civicItem}`, type: button.dataset.civicWitness, itemId: button.dataset.civicItem, city: state.activeCity, createdAt: new Date().toISOString() }); button.textContent = 'Saved on this device'; button.disabled = true; })); }
