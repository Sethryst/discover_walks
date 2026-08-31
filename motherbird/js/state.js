export const state = {
  // persisted data
  profile: null,
  settings: null,
  walks: [],
  observations: [],
  moments: [],

  // city / map data
  activeCity: 'fairfax',
  cityPois: {},
  trailSegments: {},
  pois: [],
  neighborhoodData: null,
  discoveredNeighborhoodIds: new Set(),
  spatialIndexCity: null,
  locallyClosedPoiIds: new Map(),
  personalPlaces: [],
  personalPlaceCategories: [],
  layerFilters: { public: {}, personal: {} },
  layerUiState: { expanded: {} },
  layerLights: { news: false, recreation: true, cuisine: false, personal: false },

  // map objects
  map: null,
  currentPosition: null,
  curatedRouteLine: null,
  plannedRouteLine: null,
  plannedRouteLines: [],
  plannedRoute: null,
  observationLayer: null,
  poiLayer: null,
  personalPlaceLayer: null,
  neighborhoodLayer: null,
  fieldEditionEntryLayer: null,
  fieldEditionMap: null,
  fieldEditionProtocol: null,
  federalBoundaryOverlay: null,

  // walking session
  activeWalk: null,
  watchId: null,
  timerId: null,
  knownTrackPoints: [],
  speechRecognition: null,

  // UI / prompts
  currentSite: null,
  draftObservationLocation: null,
  draftObservationIcon: 'camera',
  prompted: new Set(),
  poiTags: new Set(),
  archiveFilter: 'all',
  planningMode: false,
  personalPlaceSelecting: false,
  plannerStart: null,
  plannerEnd: null,
  planOptions: [],
  routePlanningFailures: [],
  visiblePlanIds: new Set(),
  textWalkStops: [],
  quietFallbackPlaces: [],

  // online
  online: {
    client: null,
    session: null,
    remoteProfile: null,
    fieldEditionVerified: false,
    cloudBackupCreatedAt: null
  },

  // region automation
  regionAutomation: null,

  // extra maps
  walkDetailMap: null
};
