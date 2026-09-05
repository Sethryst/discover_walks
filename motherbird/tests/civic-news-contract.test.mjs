import assert from 'node:assert/strict';
import { civicNoticesFromPack, locateOfficialVenue, newsIsAvailable } from '../js/civic-news.js';

const future = new Date(Date.now() + 86400000).toISOString();
const past = new Date(Date.now() - 86400000).toISOString();
const townHall = { id: 'vienna-hall', name: 'Charles Robinson Jr. Town Hall', lat: 38.901, lng: -77.265 };
const park = { id: 'random-park', name: 'Town Green Park', lat: 38.9, lng: -77.26 };

const events = {
  events: {
    items: [
      {
        id: 'dc-event',
        title: 'Ward 2 Roll Off Day',
        officialUrl: 'https://beta.dc.gov/events/ward-2',
        expiresAt: future,
        locationLabel: 'Bundy Field',
        venueAddress: '470 P St NW, Washington, DC 20001'
      },
      {
        id: 'expired',
        title: 'Old concert',
        officialUrl: 'https://beta.dc.gov/events/old',
        expiresAt: past,
        locationLabel: 'Yards Park'
      }
    ]
  },
  meetings: {
    items: [
      {
        id: 'vienna-council',
        title: 'Town Council Meeting',
        officialUrl: 'https://www.viennava.gov/meetings/council',
        expiresAt: future,
        locationLabel: 'Charles Robinson Jr. Town Hall',
        venueAddress: '127 Center St. South'
      },
      {
        id: 'pool-hours',
        title: 'Public pool hours',
        officialUrl: 'https://www.example.gov/pool',
        expiresAt: future,
        locationLabel: 'Rec Center'
      }
    ]
  },
  vote: {
    items: [
      {
        id: 'general',
        title: 'General Election',
        officialUrl: 'https://www.dcboe.org/elections/2026-elections',
        expiresAt: future,
        date: '2026-11-03'
      }
    ]
  }
};

const notices = civicNoticesFromPack(events, [townHall, park]);
assert.equal(notices.some((item) => item.id === 'dc-event' && item.kind === 'Event'), true);
assert.equal(notices.some((item) => item.id === 'expired'), false);
assert.equal(notices.find((item) => item.id === 'vienna-council')?.location?.lat, 38.901);
assert.equal(notices.find((item) => item.id === 'pool-hours'), undefined);
assert.equal(notices.find((item) => item.id === 'general')?.location, null);
assert.equal(notices.find((item) => item.id === 'dc-event')?.location, null);

assert.deepEqual(
  locateOfficialVenue({ locationLabel: 'Washington, DC — see official event page' }, [townHall, park]),
  null
);

assert.equal(newsIsAvailable({ capability: 'furnished', notices: [] }, 0), true);
assert.equal(newsIsAvailable({ capability: 'empty-by-design', notices: [] }, 0), false);
assert.equal(newsIsAvailable({ capability: 'none', notices }, 0), true);

console.log('Civic NEWS contract checks passed.');
