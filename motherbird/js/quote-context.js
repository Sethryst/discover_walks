import db from './storage.js';
import { state } from './state.js';
import { WALK_QUOTES } from './reflection.js';

const MAX_DEDUPE_KEYS = 120;

const CONTEXT_TAGS = Object.freeze({
  'setting-out-trailhead': new Set(['trailhead', 'trail_start', 'trail_entrance']),
  'crossing-stream-water': new Set(['bridge', 'stream', 'water', 'water_access', 'river', 'lake']),
  'entering-park-threshold': new Set(['park', 'nature_reserve', 'protected_area']),
  'entering-woods-forest-canopy': new Set(['forest', 'woods', 'woodland', 'canopy']),
  'wildlife-sighting': new Set(['wildlife', 'birding', 'nature_observation']),
  'overlook-vista': new Set(['overlook', 'vista', 'viewpoint', 'scenic']),
  'climbing-elevation-gain': new Set(['climb', 'summit', 'mountain'])
});

function tagsFor(poi) { return new Set((poi?.tags || poi?.categories || []).map((tag) => String(tag).toLowerCase().replace(/\s+/g, '_'))); }

export function quoteContextForPoi(poi) {
  const tags = tagsFor(poi);
  for (const [context, contextTags] of Object.entries(CONTEXT_TAGS)) {
    const matches = [...contextTags].filter((tag) => tags.has(tag));
    if (matches.length) return { context, confidence: Math.min(0.98, 0.72 + matches.length * 0.1), matchedTags: matches };
  }
  return null;
}

export function quoteForContext(context, seed = '') {
  const candidates = WALK_QUOTES.filter((quote) => quote.context === context);
  if (!candidates.length) return null;
  const index = [...String(seed)].reduce((sum, character) => sum + character.charCodeAt(0), 0) % candidates.length;
  return candidates[index];
}

export async function suggestContextualQuote({ context, poi = null, confidence = 0, eventId = '' } = {}) {
  if (!context || confidence < 0.72) return null;
  const key = `${state.activeCity || 'unknown'}:${context}:${eventId || poi?.id || 'walk'}`;
  const seen = Array.isArray(state.settings?.quoteEventKeys) ? state.settings.quoteEventKeys : [];
  if (seen.includes(key)) return null;
  const quote = quoteForContext(context, eventId || poi?.id || context);
  if (!quote) return null;
  state.settings.quoteEventKeys = [...seen, key].slice(-MAX_DEDUPE_KEYS);
  await db.put('settings', state.settings);
  const suggestion = { ...quote, context, confidence: Number(confidence.toFixed(2)), eventId: eventId || poi?.id || null, poiId: poi?.id || null };
  globalThis.window?.dispatchEvent(new CustomEvent('journal-quote-suggestion', { detail: suggestion }));
  return suggestion;
}

export const quoteContextTestHelpers = { tagsFor };
