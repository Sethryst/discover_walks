import db from './storage.js';

const THEME_TERMS = { park: ['park', 'garden', 'green', 'trees', 'nature'], trail: ['trail', 'wildlife', 'river', 'waterfront'], history: ['history', 'historic', 'museum', 'memorial', 'learn'], quiet: ['quiet', 'gentle', 'calm', 'peaceful', 'slow'] };

export function parseWalkDescription(text, pois = []) {
  const description = String(text || '').trim();
  if (!description) return { description: '', durationMinutes: 30, preferences: [], matchedPois: [] };
  const durationMatch = description.match(/\b(15|20|30|45|60|75|90)\s*(?:minute|min|minutes)\b/i);
  const durationMinutes = durationMatch ? Number(durationMatch[1]) : 30;
  const normalized = normalize(description);
  const preferences = Object.entries(THEME_TERMS).filter(([, terms]) => terms.some((term) => normalized.includes(term))).map(([theme]) => theme);
  const matchedPois = pois.map((poi) => {
    const name = normalize(poi.name); const meaningfulWords = name.split(' ').filter((word) => word.length > 4); const exact = name.length >= 5 && normalized.includes(name);
    return { poi, name, exact, fuzzy: meaningfulWords.length >= 2 && meaningfulWords.every((word) => normalized.includes(word)) };
  }).filter((match) => match.exact || match.fuzzy).sort((a, b) => Number(b.exact) - Number(a.exact) || b.name.length - a.name.length).slice(0, 4).map((match) => match.poi);
  return { description, durationMinutes, preferences, matchedPois };
}

export async function saveWalkDraft(cityId, parsed) {
  const createdAt = new Date().toISOString();
  const draft = { id: `text-walk:${createdAt}`, cityId, description: parsed.description, durationMinutes: parsed.durationMinutes, preferences: parsed.preferences, poiIds: parsed.matchedPois.map((poi) => poi.id), createdAt, private: true };
  await db.put('walk_drafts', draft);
  return draft;
}

function normalize(value) { return String(value || '').toLocaleLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim(); }
