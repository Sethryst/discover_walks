import assert from 'node:assert/strict';
import test from 'node:test';
import { nearbyWatchPlaces } from '../js/watch-session.js';

test('watch nearby places returns only saved places within one mile in distance order', () => {
  const places = nearbyWatchPlaces([
    { id: 'far', name: 'Far', state: 'saved', location: { lat: 39, lng: -77 } },
    { id: 'near', name: 'Near', state: 'saved', location: { lat: 38.9001, lng: -77.2 } },
    { id: 'hidden', name: 'Candidate', state: 'candidate', location: { lat: 38.90001, lng: -77.2 } }
  ], { lat: 38.9, lng: -77.2 });
  assert.deepEqual(places.map((place) => place.id), ['near']);
});
