import assert from 'node:assert/strict';
import { eventFilterLabel, humanSourceLabel, renderCivicEventCard } from '../js/civic.js';

assert.equal(eventFilterLabel('vienna'), 'All Vienna events');

const pgCard = renderCivicEventCard({
  title: 'The African Odyssey Exhibition',
  date: 'Aug 6 – Nov 1',
  summary: 'A verified exhibition.',
  locationLabel: 'Montpelier Historic Site & Museum',
  venueAddress: '9650 Muirkirk Road, Laurel, MD',
  officialUrl: 'https://example.gov/event',
  source: { authorityTier: 'local_government', name: 'M-NCPPC Department of Parks and Recreation' }
});
assert.match(pgCard, /Montpelier Historic Site &amp; Museum · 9650 Muirkirk Road, Laurel, MD/);
assert.match(pgCard, /M-NCPPC Department of Parks and Recreation/);
assert.doesNotMatch(pgCard, /local_government/);

const longTitle = 'Summer on the Green: An Exceptionally Long Community Concert Title That Must Wrap on a Narrow Phone';
const narrowCard = renderCivicEventCard({ title: longTitle, date: 'Aug 14', summary: 'Verified.', officialUrl: 'https://example.gov/event' });
assert.match(narrowCard, /civic-event-card/);
assert.match(narrowCard, /civic-card-title/);
assert.match(narrowCard, /Exceptionally Long Community Concert/);

console.log('Civic UI regression checks passed.');
