/* Shared mutable app state.
   `appMode` became `app.mode` so that modules can reassign it through a
   live object reference (ES module bindings are read-only for importers). */

export const app = { mode: 'planning' }; // 'planning' | 'summary' | 'navigation'
export const planState = {
  originCode: '',
  destinationCode: '',
  routeMode: 'fastest',       // 'fastest' | 'accessible'
  accessibleRoute: false,     // compact toggle — replaces the two big mode cards
};

export const navState = {
  route: null,          // normalized route
  semanticSteps: [],    // { text, icon, nodeType, isTransition, floorId, rawFrom, rawTo }
  activeStepIndex: 0,
  routeFloorIds: new Set(),
};

export const mapState = {
  selectedFloorId: '',
  floorTransforms: {},  // { floorId: { x, y, scale } }
  svgBaseCache: {},     // { floorId: svgString } — never rebuilt
  manualFloor: false,
};

export const uiState = {
  loading: '',          // 'airports'|'map'|'route'|''
  error: '',
  searchOpenFor: '',    // 'origin'|'destination'|''
  searchQuery: '',
  searchCategory: '',   // SEARCH_CATEGORIES key or '' — active quick-filter chip
  showOverview: false,
  modalNodeCode: '',    // legacy node-based detail sheet (LocationDetail)
  placeDetailId: '',    // rich business detail sheet (PlaceDetailSheet)
  placeRouteContext: null, // { text } when the card was opened from an active route

  floorMenuOpen: false,
  routeAnimating: false,
};

export const appData = {
  airport: null,
  floors: [],
  nodes: [],
};

