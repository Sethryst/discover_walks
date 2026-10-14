// Reviewable, static discovery layer for the Fairfax routing-area simulator.
// It enriches built-in places without changing their identity or claiming new
// route geometry. Every item points back to a built-in place or trail record.
export const ROUTING_AREA_DISCOVERY_SIDECAR = Object.freeze({
  fairfaxCourthouse: { basePlaceId: 'history:fairfax-historic-sites:9', focus: 'history', invitation: 'Notice the courthouse as a civic landmark, then look for the older street pattern around it.', prompt: 'What still feels designed for the town that came before the county?', value: 'historical context' },
  cityHistoricDistrict: { basePlaceId: 'osm:node:356599862', focus: 'history', invitation: 'Walk the historic district slowly and compare the older buildings with the present-day street life.', prompt: 'Which detail would disappear if you hurried?', value: 'place attention' },
  westmoreDogPark: { basePlaceId: 'osm:node:8723631352', focus: 'community', invitation: 'Use this neighborhood park as a small pause point and notice how people share the space.', prompt: 'What makes this feel like a neighborhood place rather than a destination?', value: 'social texture' },
  pineyBranch: { basePlaceId: 'parks:fairfax-county-parks:16806', focus: 'water', invitation: 'Follow the stream edge where the mapped path supports it and listen for changes in the water sound.', prompt: 'Where does the landscape make the water visible?', value: 'watershed awareness' },
  patriotParkNorth: { basePlaceId: 'facilities:fairfax-county-park-amenities:200', focus: 'nature', invitation: 'Pause at the park edge and look for the boundary between maintained space and habitat.', prompt: 'What is being cared for here, and what is being left to grow?', value: 'habitat noticing' },
  rockyRunTrailhead: { basePlaceId: 'facilities:fairfax-county-park-amenities:278', focus: 'trail', invitation: 'Use the trailhead as a threshold: notice the first change in surface, sound, and pace.', prompt: 'When did this become a trail instead of a street?', value: 'trail transition' },
  difficultRunSouth: { basePlaceId: 'facilities:fairfax-county-park-amenities:280', focus: 'water', invitation: 'Approach the stream valley as a corridor rather than a single destination.', prompt: 'What connects the places on either side of this valley?', value: 'landscape connection' },
  difficultRunNorth: { basePlaceId: 'facilities:fairfax-county-park-amenities:269', focus: 'nature', invitation: 'Look for the small signs of a larger habitat around this trailhead.', prompt: 'What evidence of wildlife can you find without leaving the path?', value: 'wildlife attention' },
  heartHavenGarden: { basePlaceId: 'osm:way:1173140660', focus: 'reflection', invitation: 'Treat the garden as a quiet room outdoors and let the route slow down here.', prompt: 'What did the quieter pace let you notice?', value: 'reflection' },
  viennaDogPark: { basePlaceId: 'osm:relation:1991153', focus: 'community', invitation: 'Notice how a small public space creates a meeting point within the larger route.', prompt: 'Who is this place designed to welcome?', value: 'shared public life' }
});

export function discoveryForRoutingLocation(id) {
  return ROUTING_AREA_DISCOVERY_SIDECAR[id] || null;
}
