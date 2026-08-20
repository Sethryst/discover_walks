#!/usr/bin/env node
/**
 * audit-poi-tags.mjs
 *
 * 1. Flags POI entries whose name/description hints at a category that isn't
 *    reflected in their tags — the root cause of "parks showing up as history
 *    sites." Mirrors the app's two auto-tag rules (subcategory containing
 *    "HISTOR", and name/source containing "Historical Sign") so it only
 *    flags genuine gaps a human needs to resolve, not ones the app already
 *    fixes on load.
 * 2. Flags coordinate clusters where many differently-named POIs share one
 *    exact lat/lng — a signature of a batch-geocoding fallback, and the
 *    likely explanation when signs turn up plotted in a river/water body
 *    instead of their real location.
 *
 * Usage:
 *   node audit-poi-tags.mjs ./data/norfolk-poi.json
 *   node audit-poi-tags.mjs ./data/*.json          (audit several at once)
 */
import { readFileSync } from 'node:fs';

// Keyword → tag it implies. Mirrors the app's POI_TAGS vocabulary.
const HINTS = [
  [/\bpark\b/i, 'park'],
  [/\bplayground\b/i, 'park'],
  [/\btrail(head)?\b/i, 'trail'],
  [/\blibrary\b/i, 'library'],
  [/\brec(reation)?\s*center\b/i, 'recreation_center'],
  [/\bcommunity\s*garden\b/i, 'community_garden'],
  [/\b(pier|boat\s*ramp|marina|beach|waterfront)\b/i, 'water_access'],
  [/\b(mural|sculpture|public\s*art)\b/i, 'public_art'],
  [/\b(museum|monument|memorial|historic|heritage|landmark|marker)\b/i, 'history'],
  [/\b(basketball)\b/i, 'basketball'],
  [/\b(tennis)\b/i, 'tennis'],
  [/\b(dog\s*park)\b/i, 'dog_park'],
  [/\b(splash\s*pad)\b/i, 'splash_pad'],
  [/\b(disc\s*golf)\b/i, 'disc_golf'],
  [/\b(skate\s*park)\b/i, 'skate_park']
];

function normalizeTags(poi) {
  const tags = new Set(poi.tags || []);
  if (poi.category) tags.add(poi.category);
  (poi.amenities || []).forEach((amenity) => tags.add(amenity));
  if (poi.subcategory && /histor/i.test(poi.subcategory)) tags.add('history');
  if (/historical sign/i.test(`${poi.name || ''} ${poi.source || ''}`)) tags.add('history');
  return tags;
}

function suggestSubtype(text) {
  if (/museum/i.test(text)) return 'museum';
  if (/monument/i.test(text)) return 'monument';
  if (/cemetery/i.test(text)) return 'cemetery';
  if (/librar|building|hall|house|church/i.test(text)) return 'landmark';
  return 'marker';
}

function auditCoordinateClusters(pois, minClusterSize = 4) {
  const byCoord = new Map();
  pois.forEach((poi) => {
    if (!Number.isFinite(poi.lat) || !Number.isFinite(poi.lng)) return;
    const key = `${poi.lat},${poi.lng}`;
    if (!byCoord.has(key)) byCoord.set(key, []);
    byCoord.get(key).push(poi);
  });
  return [...byCoord.entries()]
    .filter(([, members]) => members.length >= minClusterSize)
    .sort((a, b) => b[1].length - a[1].length);
}

function auditFile(path) {
  const raw = JSON.parse(readFileSync(path, 'utf8'));
  const pois = raw.pointsOfInterest || [];
  const issues = [];

  pois.forEach((poi) => {
    const tags = normalizeTags(poi);
    const text = `${poi.name || ''} ${poi.description || ''} ${poi.subcategory || ''}`;
    const impliedTags = new Set(HINTS.filter(([re]) => re.test(text)).map(([, tag]) => tag));

    // Case 1: text implies a tag the record doesn't have.
    const missing = [...impliedTags].filter((tag) => !tags.has(tag));
    if (missing.length) {
      const note = missing.includes('history') ? `  (would land in subtype: ${suggestSubtype(text)})` : '';
      issues.push({ id: poi.id, name: poi.name, kind: 'missing-tag', have: [...tags], suggest: missing, note });
    }

    // Case 2: tagged 'history' but nothing in the text/other tags
    // supports it being a historic site specifically — likely a
    // park/rec facility that was bulk-tagged 'history' by mistake.
    if (tags.has('history') && !impliedTags.has('history') && impliedTags.size) {
      issues.push({ id: poi.id, name: poi.name, kind: 'suspect-history-tag', have: [...tags], suggest: [...impliedTags] });
    }

    // Case 3: no tags and no category at all.
    if (tags.size === 0) {
      issues.push({ id: poi.id, name: poi.name, kind: 'untagged', have: [], suggest: [] });
    }
  });

  console.log(`\n${path} — ${pois.length} POIs, ${issues.length} tag issues flagged`);
  issues.forEach((issue) => {
    console.log(`  [${issue.kind}] ${issue.id || '(no id)'} "${issue.name}" — has: [${issue.have.join(', ')}] suggest: [${issue.suggest.join(', ')}]${issue.note || ''}`);
  });

  const clusters = auditCoordinateClusters(pois);
  console.log(`\n${path} — ${clusters.length} shared-coordinate clusters (4+ differently-named POIs at one exact lat/lng)`);
  console.log('  These are the likely cause of points plotting in rivers/water — check each against the real GPS location of its members.');
  clusters.forEach(([coord, members]) => {
    console.log(`  [${coord}] ${members.length} POIs share this point, e.g.: ${members.slice(0, 3).map((m) => `"${m.name}"`).join(', ')}${members.length > 3 ? ', ...' : ''}`);
  });

  return issues.length + clusters.length;
}

const files = process.argv.slice(2);
if (!files.length) {
  console.error('Usage: node audit-poi-tags.mjs <path-to-city-poi.json> [...]');
  process.exit(1);
}
const total = files.reduce((sum, file) => sum + auditFile(file), 0);
console.log(`\nTotal flagged across ${files.length} file(s): ${total}`);
process.exit(total ? 1 : 0);
