import assert from 'node:assert/strict';
import { createSeasonalAwareness } from '../js/seasonal-awareness.js';

const item = createSeasonalAwareness({
  id: 'meadowlark-spring-warblers',
  place: { name: 'Meadowlark Botanical Gardens', category: 'garden', coordinates: [-77.2825, 38.9376] },
  significance: { seasonalReason: 'Migrating warblers use mature trees near water.', weatherCondition: 'Best after calm weather.', timeWindow: 'Early May mornings' },
  walkerActions: ['look', 'listen'], confidence: 'likely', contributedBy: 'time', collectedAt: '2026-08-06T12:00:00Z',
  sources: [{ name: 'Approved field source', url: 'https://example.org/source', collectedAt: '2026-08-06T12:00:00Z', license: 'Editorial review required' }]
});

assert.equal(item.confidence, 'likely');
assert.equal(item.place.name, 'Meadowlark Botanical Gardens');
assert.throws(() => createSeasonalAwareness({ ...item, confidence: 'guess' }), /confidence/);
console.log('seasonal awareness contract test passed');
