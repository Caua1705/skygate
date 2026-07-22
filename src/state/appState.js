/* Shared mutable app state.
   `appMode` became `app.mode` so that modules can reassign it through a
   live object reference (ES module bindings are read-only for importers). */

export const app = { mode: 'planning' }; // 'planning' | 'summary' | 'navigation'
export const planState = {
  originCode: '',
  destinationCode: '',
  routeMode: 'fastest',       // 'fastest' | 'accessible'
  accessibleRoute: false,     // compact toggle — replaces the two big mode cards

  /**
   * The passenger's departure time as 'HH:MM' — the ONE time input in the whole
   * app, collected on Home. Optional but prominent: SkyGate is built for the
   * passenger with a flight, so the field is pushed, not hidden.
   *
   * Everything downstream (gate deadline, per-route slack, the status badges)
   * is DERIVED from this by services/flightSlack.js against the device clock.
   * Nothing caches a minute count — `now` moves while the screen is on.
   */
  flightTime: '',
};

export const navState = {
  route: null,          // normalized route
  semanticSteps: [],    // { text, icon, nodeType, isTransition, floorId, rawFrom, rawTo }
  activeStepIndex: 0,
  routeFloorIds: new Set(),
  /**
   * The WAYS of walking `route` offered on the choice screen, and which one
   * the traveller picked — see services/routeOptions.js. Built once per
   * calculation; `selectedOptionId` is what navigation is started with.
   */
  routeOptions: [],
  selectedOptionId: '',
  /**
   * Which navigation view is on screen: 'timeline' (default) or 'trajeto',
   * the schematic metro diagram. All of them read the SAME steps and
   * activeStepIndex above — this only chooses how they are drawn, so
   * switching views never loses the traveller's place.
   *
   * 'map', the old top-down floor plan, is no longer reachable from the UI:
   * "Ver trajeto" now opens the metro diagram instead. The plan's renderer
   * and its whole map layer are left intact and still honour this value, so
   * setting it by hand (or wiring a control to showFloorPlan()) brings it
   * back without any of it having to be rebuilt.
   */
  view: 'timeline',
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

  /**
   * The passenger ticked "entendo que posso perder o voo" for a route whose
   * slack is negative. Reset whenever the selected route changes — the
   * acknowledgement is about THAT route, not a blanket opt-out.
   */
  riskAcknowledged: false,
};

export const appData = {
  airport: null,
  floors: [],
  nodes: [],
};

