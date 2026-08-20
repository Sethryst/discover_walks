export const state = {
  // persisted data
  profile: null,
  settings: null,
  walks: [],
  observations: [],
  moments: [],

  // city / map data
  activeCity: 'vienna',
  cityPois: {},
  trailSegments: {},
  pois: [],
  neighborhoodData: null,
  discoveredNeighborhoodIds: new Set(),
  spatialIndexCity: null,
  locallyClosedPoiIds: new Map(),

  // map objects
  map: null,
  currentPosition: null,
  curatedRouteLine: null,
  plannedRouteLine: null,
  plannedRouteLines: [],
  plannedRoute: null,
  observationLayer: null,
  poiLayer: null,
  neighborhoodLayer: null,
  fieldEditionEntryLayer: null,
  fieldEditionMap: null,
  fieldEditionProtocol: null,

  // walking session
  activeWalk: null,
  watchId: null,
  timerId: null,

  // UI / prompts
  currentSite: null,
  draftObservationLocation: null,
  draftObservationIcon: 'camera',
  prompted: new Set(),
  poiTags: new Set(),
  archiveFilter: 'all',
  planningMode: false,
  plannerStart: null,
  plannerEnd: null,
  planOptions: [],
  visiblePlanIds: new Set(),
  textWalkStops: [],
  quietFallbackPlaces: [],

  // online
  online: {
    client: null,
    session: null,
    remoteProfile: null
  },

  // region automation
  regionAutomation: null,

  // extra maps
  walkDetailMap: null
};
