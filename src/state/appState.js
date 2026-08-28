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

  // Absolute local calendar date (`YYYY-MM-DD`) behind the Hoje/Amanhã UI.
  // It prevents “tomorrow” from moving forward again when midnight passes.
  flightDate: '',

  /**
   * A clock without a date is ambiguous around midnight. Defaulting to today
   * is deliberately conservative: a past time must never silently become
   * tomorrow and create almost 24 hours of fictitious margin.
   */
  flightDay: 'today',          // 'today' | 'tomorrow'

  /**
   * 'domestic' | 'international' — drives the gate-close margin (APP_CONFIG
   * .flight.gateCloseMargin). The passenger chooses it alongside the flight
   * day; it is never inferred from a gate or destination.
   */
  flightType: 'domestic',
};

export const navState = {
  route: null,          // normalized route
  semanticSteps: [],    // { text, icon, nodeType, isTransition, floorId, rawFrom, rawTo }
  /**
   * RETAINED, NOT USED BY THE SCREEN. Navigation no longer has a "current
   * step" — every step is shown at once and nothing is confirmed — so this
   * stays at 0 for the whole trip. It is kept because the session schema
   * (sessionPersistence.js, schema v1) validates it and the route-choice
   * screen's resume estimate reads it through getEstimatedRemainingMinutes().
   * Removing it means a schema bump; see the note in NavigationShell.js.
   */
  activeStepIndex: 0,
  hasStarted: false,    // the trip was opened at least once — drives "retomar" on the choice screen
  routeFloorIds: new Set(),
  /**
   * The WAYS of walking `route` offered on the choice screen, and which one
   * the traveller picked — see services/routeOptions.js. Built once per
   * calculation; `selectedOptionId` is what navigation is started with.
   */
  routeOptions: [],
  selectedOptionId: '',
  /**
   * RETAINED for the session schema only. Navigation is ONE screen now (map
   * with the step list in a sheet), so this is always 'map'.
   */
  view: 'map',
};

export const mapState = {
  selectedFloorId: '',
  floorTransforms: {},  // { floorId: { x, y, scale } }
  svgBaseCache: {},     // { floorId: svgString } — never rebuilt
  manualFloor: false,   // kept for the session restore path; navigation no longer sets it
};

export const uiState = {
  loading: '',          // 'airports'|'map'|'route'|''
  error: '',
  searchOpenFor: '',    // 'origin'|'destination'|''
  searchQuery: '',
  searchCategory: '',   // SEARCH_CATEGORIES key or '' — active quick-filter chip
  modalNodeCode: '',    // legacy node-based detail sheet (LocationDetail)
  placeDetailId: '',    // rich business detail sheet (PlaceDetailSheet)
  placeRouteContext: null, // { text } when the card was opened from an active route

  floorMenuOpen: false,
  routeAnimating: false,

  /**
   * NAVIGATION — consultation, not progress.
   * `focusedStepIndex` is the step the traveller tapped to see on the map
   * (-1 = none). It is a viewing choice, never a claim about where they are,
   * and it is deliberately not persisted.
   * `sheetDetent` is the resting height of the step sheet: 'collapsed'
   * (summary only) | 'half' | 'full'.
   */
  focusedStepIndex: -1,
  sheetDetent: 'half',

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
