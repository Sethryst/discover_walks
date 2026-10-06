import db from './storage.js';
import { state } from './state.js';
import { WALK_QUOTES } from './reflection.js';

const MAX_DEDUPE_KEYS = 120;

const CONTEXT_TAGS = Object.freeze({
  'setting-out-trailhead': new Set(['trailhead', 'trail_start', 'trail_entrance']),
  'crossing-stream-water': new Set([
    'bridge', 'footbridge', 'stream', 'creek', 'water', 'water_access',
    'river', 'riverbank', 'lake', 'canal', 'canal_access', 'waterway',
    'wetland', 'crossing_water'
  ]),
  'entering-park-threshold': new Set(['park', 'nature_reserve', 'protected_area']),
  'entering-woods-forest-canopy': new Set(['forest', 'woods', 'woodland', 'canopy']),
  'wildlife-sighting': new Set(['wildlife', 'birding', 'nature_observation']),
  'overlook-vista': new Set(['overlook', 'vista', 'viewpoint', 'scenic']),
  'climbing-elevation-gain': new Set(['climb', 'summit', 'mountain'])
});

const CONTEXT_TEXT_PATTERNS = Object.freeze([
  ['setting-out-trailhead', /trailhead|trail\s*(?:start|entrance)|path\s*entrance/i],
  ['crossing-stream-water', /footbridge|bridge|stream|creek|river|riverbank|lake|canal|waterway|wetland/i],
  ['entering-park-threshold', /park|nature\s+reserve|protected\s+area|preserve/i],
  ['entering-woods-forest-canopy', /forest|woods?|woodland|canopy|grove/i],
  ['wildlife-sighting', /wildlife|birding|bird\s+(?:sanctuary|watch|area)|nature\s+observation/i],
  ['overlook-vista', /overlook|vista|viewpoint|lookout|scenic/i],
  ['climbing-elevation-gain', /climb|summit|mountain|peak|elevation/i]
]);

function tagsFor(poi) {
  const values = [...(poi?.tags || poi?.categories || []), poi?.category].filter(Boolean);
  return new Set(values.map((tag) => String(tag).toLowerCase().replace(/\s+/g, '_')));
}

export function quoteContextForPoi(poi) {
  const tags = tagsFor(poi);
  for (const [context, contextTags] of Object.entries(CONTEXT_TAGS)) {
    const matches = [...contextTags].filter((tag) => tags.has(tag));
    if (matches.length) return { context, confidence: Math.min(0.98, 0.72 + matches.length * 0.1), matchedTags: matches };
  }
  const text = [poi?.name, poi?.title, poi?.description, poi?.category].filter(Boolean).join(' ');
  for (const [context, pattern] of CONTEXT_TEXT_PATTERNS) {
    const match = text.match(pattern);
    if (match) return { context, confidence: 0.78, matchedTags: [match[0].toLowerCase()] };
  }
  return null;
}

export function quoteForContext(context, seed = '') {
  const candidates = WALK_QUOTES.filter((quote) => quote.context === context);
  if (!candidates.length) return null;
  const index = [...String(seed)].reduce((sum, character) => sum + character.charCodeAt(0), 0) % candidates.length;
  return candidates[index];
}

export async function suggestContextualQuote({ context, poi = null, confidence = 0, eventId = '', walkId = '' } = {}) {
  if (!context || confidence < 0.72) return null;
  const activeWalkId = walkId || state.activeWalk?.id || 'walk';
  const key = `${state.activeCity || 'unknown'}:${activeWalkId}:${context}:${eventId || poi?.id || 'walk'}`;
  const seen = Array.isArray(state.settings?.quoteEventKeys) ? state.settings.quoteEventKeys : [];
  if (seen.includes(key)) return null;
  const quote = quoteForContext(context, eventId || poi?.id || context);
  if (!quote) return null;
  state.settings.quoteEventKeys = [...seen, key].slice(-MAX_DEDUPE_KEYS);
  await db.put('settings', state.settings);
  const suggestion = { ...quote, context, confidence: Number(confidence.toFixed(2)), eventId: eventId || poi?.id || null, poiId: poi?.id || null, walkId: activeWalkId === 'walk' ? null : activeWalkId };
  globalThis.window?.dispatchEvent(new CustomEvent('journal-quote-suggestion', { detail: suggestion }));
  return suggestion;
}

export const quoteContextTestHelpers = { tagsFor };
