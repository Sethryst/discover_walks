export const state = {
  // persisted data
  profile: null,
  settings: null,
  walks: [],
  savedRoutes: [],
  observations: [],
  moments: [],

  // city / map data
  activeCity: null,
  cityPois: {},
  trailSegments: {},
  pois: [],
  neighborhoodData: null,
  discoveredNeighborhoodIds: new Set(),
  spatialIndexCity: null,
  locallyClosedPoiIds: new Map(),
  personalPlaces: [],
  personalPlaceCategories: [],
  publicMarkers: [],
  publicMarkerVotes: new Set(),
  layerFilters: { public: {}, personal: {} },
  layerUiState: { expanded: {} },
  layerLights: { news: false, recreation: true, cuisine: false, personal: false },

  // map objects
  map: null,
  activeViewportBounds: null,
  currentPosition: null,
  lastPosition: null,
  curatedRouteLine: null,
  plannedRouteLine: null,
  plannedRouteLines: [],
  plannedRoute: null,
  observationLayer: null,
  poiLayer: null,
  personalPlaceLayer: null,
  publicMarkerLayer: null,
  neighborhoodLayer: null,
  fieldEditionEntryLayer: null,
  fieldEditionMap: null,
  fieldEditionProtocol: null,
  installedBasemapMap: null,
  installedBasemapProtocol: null,
  installedBasemapRegion: null,
  nationalPoiMap: null,
  nationalPoiActivating: false,
  nationalPoiSync: null,
  nationalPoiSuppressed: false,
  nationalPoiAttribution: false,
  nationalOsmLayers: {},
  walkingCell: null,
  routingDebugLayer: null,
  walkingCellMap: null,
  walkingCellSync: null,
  geoCyphers: [],
  geoCypherPrompted: new Set(),
  pmtilesProtocol: null,
  onlineBasemapLayer: null,
  mapPaintLayer: null,
  mapPaintActive: false,
  mapDrawingHistory: [],
  localDrawings: [],
  spatialQuery: null,
  spatialQueryLayer: null,
  spatialQueryResults: [],
  spatialQueryDismissed: new Set(),
  spatialQuerySelected: new Set(),
  activeRoom: null,
  fieldGuidePreviewMarker: null,
  federalBoundaryOverlay: null,
  historicalTopoLayer: null,
  historicalTopoControl: null,

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
  personalPlaceDraft: null,
  plannerStart: null,
  plannerEnd: null,
  plannerStops: [],
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

// POI and cluster layers are deliberately detached while an endpoint gesture
// is armed. Leaflet's synthetic layer propagation can otherwise turn a POI
// click into a map click even after DOM propagation has been stopped.
export function setPlannerSelecting(value) {
  state.plannerSelecting = value;
  const layer = state.poiLayer;
  if (!layer || !state.map) return;
  if (value) {
    if (state.map.hasLayer(layer)) state.map.removeLayer(layer);
  } else if (!state.map.hasLayer(layer)) {
    layer.addTo(state.map);
  }
}
