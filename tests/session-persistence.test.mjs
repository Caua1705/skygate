import assert from 'node:assert/strict';
import {
  SESSION_STORAGE_KEY,
  SESSION_TTL_MS,
  applyRestoredSession,
  createSessionSnapshot,
  decodeSessionState,
  persistSessionState,
  restoreSessionState,
  serializeSessionState,
} from '../src/state/sessionPersistence.js';

const floors = [
  { id: '0', name: 'Térreo' },
  { id: '1', name: 'Piso 1' },
];
const nodes = [
  { code: 'origin', floorId: '0', type: 'entrance' },
  { code: 'lift', floorId: '0', type: 'elevator' },
  { code: 'gate', floorId: '1', type: 'gate' },
];

function makeState(mode = 'navigation') {
  const route = {
    estimatedMinutes: 6,
    path: ['origin', 'lift', 'gate'],
    segments: [
      { type: 'floor', floorId: '0', nodeCodes: ['origin', 'lift'] },
      { type: 'transition', transitionType: 'elevator', fromFloor: '0', toFloor: '1' },
      { type: 'floor', floorId: '1', nodeCodes: ['gate'] },
    ],
    steps: [
      { index: 0, text: 'Comece na entrada.', floorId: '0', toFloor: '0', isTransition: false, transitionType: '' },
      { index: 1, text: 'Use o elevador.', floorId: '0', toFloor: '1', isTransition: true, transitionType: 'elevator' },
      { index: 2, text: 'Chegue ao portão.', floorId: '1', toFloor: '1', isTransition: false, transitionType: '' },
    ],
    warnings: [],
  };
  if (mode === 'navigation') route.optionId = 'fastest';
  const semanticSteps = [
    { text: 'Comece na entrada.', icon: 'lucide:map-pin', nodeType: 'entrance', isTransition: false, floorId: '0', toFloor: '0', rawFrom: 0, rawTo: 0, landmarkCode: 'origin', distanceMeters: 20 },
    { text: 'Use o elevador.', icon: 'lucide:accessibility', nodeType: 'elevator', isTransition: true, floorId: '0', toFloor: '1', rawFrom: 1, rawTo: 1, landmarkCode: 'lift', distanceMeters: 10 },
    { text: 'Chegue ao portão.', icon: 'lucide:flag', nodeType: 'gate', isTransition: false, floorId: '1', toFloor: '1', rawFrom: 2, rawTo: 2, landmarkCode: 'gate', distanceMeters: 0 },
  ];
  const routeOptions = [{
    id: 'fastest', name: 'Mais rápida', icon: 'lucide:zap', minutes: 6,
    deltaMinutes: 0, floors: 2, passesBy: [], steps: route.steps,
    path: route.path, warnings: [], isEstimate: true, fits: '',
    recommendedByApi: false, serverSlackMin: null, serverStatus: '',
  }];

  return {
    app: { mode },
    planState: {
      originCode: 'origin', destinationCode: 'gate', routeMode: 'fastest',
      accessibleRoute: false, flightTime: '14:30', flightDate: '2026-08-08', flightDay: 'today',
      flightType: 'domestic',
    },
    navState: {
      route, semanticSteps, activeStepIndex: mode === 'navigation' ? 2 : 0,
      hasStarted: mode === 'navigation', routeFloorIds: new Set(['0', '1']),
      routeOptions, selectedOptionId: 'fastest', view: 'map',
    },
    mapState: {
      selectedFloorId: '0', floorTransforms: { 0: { x: 9, y: 4, scale: 3 } },
      svgBaseCache: { 0: '<svg />' }, manualFloor: true,
    },
    uiState: { loading: '', searchOpenFor: 'destination', riskAcknowledged: true },
  };
}

function emptyTargetState() {
  return {
    app: { mode: 'planning' },
    planState: {},
    navState: {},
    mapState: { floorTransforms: { stale: true }, manualFloor: true },
  };
}

function memoryStorage() {
  const values = new Map();
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key),
  };
}

const now = Date.UTC(2026, 7, 8, 12, 0, 0);
const source = makeState();
const snapshot = createSessionSnapshot(source, now);
assert.equal(snapshot.schemaVersion, 1);
assert.equal(snapshot.expiresAt, now + SESSION_TTL_MS);
assert.equal('uiState' in snapshot.journey, false, 'transient overlays are never durable');
assert.equal('floorTransforms' in snapshot.journey.map, false, 'stale pan/zoom is never durable');

const decoded = decodeSessionState(serializeSessionState(source, now), { now, nodes, floors });
assert.equal(decoded.status, 'valid');
assert.ok(decoded.value.navigation.routeFloorIds instanceof Set);
assert.equal(decoded.value.navigation.activeStepIndex, 2);

const target = emptyTargetState();
applyRestoredSession(decoded.value, target);
assert.equal(target.app.mode, 'navigation');
assert.equal(target.mapState.selectedFloorId, '1', 'resume follows the active step, not a stale browsed floor');
assert.deepEqual(target.mapState.floorTransforms, {});
assert.equal(target.mapState.manualFloor, false);
assert.equal(target.navState.activeStepIndex, 2);

const storage = memoryStorage();
assert.equal(persistSessionState({ state: source, nodes, floors, storage, now }), true);
const restoredTarget = emptyTargetState();
assert.equal(restoreSessionState({ state: restoredTarget, nodes, floors, storage, now: now + 1000 }), true);
assert.equal(restoredTarget.planState.destinationCode, 'gate');
assert.deepEqual([...restoredTarget.navState.routeFloorIds], ['0', '1']);

const stepsOnlyStarted = makeState('navigation');
stepsOnlyStarted.navState.route.path = [];
stepsOnlyStarted.navState.routeOptions[0].path = [];
stepsOnlyStarted.navState.semanticSteps = stepsOnlyStarted.navState.semanticSteps.map(step => ({
  ...step,
  rawFrom: 0,
  rawTo: 0,
}));
const stepsOnlyStorage = memoryStorage();
assert.equal(
  persistSessionState({ state: stepsOnlyStarted, nodes, floors, storage: stepsOnlyStorage, now }),
  true,
  'an active steps-only journey is durable once its selected option is applied',
);
const stepsOnlyTarget = emptyTargetState();
assert.equal(
  restoreSessionState({
    state: stepsOnlyTarget,
    nodes,
    floors,
    storage: stepsOnlyStorage,
    now: now + 1000,
  }),
  true,
);
assert.equal(stepsOnlyTarget.app.mode, 'navigation');
assert.equal(stepsOnlyTarget.navState.activeStepIndex, 2);

const expiredStorage = memoryStorage();
expiredStorage.setItem(SESSION_STORAGE_KEY, serializeSessionState(source, now));
assert.equal(restoreSessionState({
  state: emptyTargetState(), nodes, floors, storage: expiredStorage, now: now + SESSION_TTL_MS,
}), false);
assert.equal(expiredStorage.getItem(SESSION_STORAGE_KEY), null, 'expired sessions are removed');

const badReference = JSON.parse(serializeSessionState(source, now));
badReference.journey.navigation.route.path[2] = 'missing-node';
assert.equal(decodeSessionState(JSON.stringify(badReference), { now, nodes, floors }).status, 'invalid');

/* -- Accessible restore: annotate, never discard --------------------------
   The gate here was the same duplicated logic removed from routeSteps.js, and
   it had the same effect: an accessible journey was calculated fine, saved
   fine, and then refused to come back on reload. Structural validation is
   untouched; only the accessibility advice stopped being fatal. */
const accessible = makeState();
accessible.planState.routeMode = 'accessible';
accessible.planState.accessibleRoute = true;
const cleanAccessible = decodeSessionState(serializeSessionState(accessible, now), { now, nodes, floors });
assert.equal(cleanAccessible.status, 'valid');
assert.deepEqual(cleanAccessible.value.navigation.route.warnings, [], 'a clean accessible journey says nothing');

const nodesWithUnsafeLift = nodes.map(node => node.code === 'lift' ? { ...node, type: 'stairs' } : node);
const unsafeLift = decodeSessionState(
  serializeSessionState(accessible, now),
  { now, nodes: nodesWithUnsafeLift, floors },
);
assert.equal(unsafeLift.status, 'valid', 'a staircase on the path no longer throws the session away');
assert.equal(unsafeLift.value.navigation.route.warnings.length, 1, 'it is reported instead');
assert.match(unsafeLift.value.navigation.route.warnings[0], /escadas/i);
assert.equal(
  unsafeLift.value.navigation.routeOptions[0].warnings.length,
  1,
  'the option carries the same advice as the route',
);

// A named warning written at calculation time is better than the generic one
// this layer can produce, and must not be joined by a near-duplicate — which
// is also what stops warnings growing on every save/restore cycle.
const alreadyWarned = makeState();
alreadyWarned.planState.routeMode = 'accessible';
alreadyWarned.planState.accessibleRoute = true;
alreadyWarned.navState.route.warnings = ['Esta rota passa por Escada C. Procure um elevador próximo.'];
alreadyWarned.navState.routeOptions[0].warnings = ['Esta rota passa por Escada C. Procure um elevador próximo.'];
const rewarned = decodeSessionState(
  serializeSessionState(alreadyWarned, now),
  { now, nodes: nodesWithUnsafeLift, floors },
);
assert.equal(rewarned.status, 'valid');
assert.deepEqual(
  rewarned.value.navigation.route.warnings,
  ['Esta rota passa por Escada C. Procure um elevador próximo.'],
  'an existing stairs warning is kept as-is and never doubled',
);

// A journey that is NOT accessible-mode is not annotated at all.
const plainWithStairs = decodeSessionState(
  serializeSessionState(makeState(), now),
  { now, nodes: nodesWithUnsafeLift, floors },
);
assert.equal(plainWithStairs.status, 'valid');
assert.deepEqual(plainWithStairs.value.navigation.route.warnings, []);

const implicitAccessible = makeState('summary');
implicitAccessible.planState.routeMode = 'accessible';
implicitAccessible.planState.accessibleRoute = true;
implicitAccessible.navState.route.path = [];
implicitAccessible.navState.route.steps = [
  { index: 0, text: 'Siga pelo corredor.', floorId: '0', toFloor: '0', isTransition: false, transitionType: '' },
  { index: 1, text: 'Chegue ao destino.', floorId: '1', toFloor: '1', isTransition: false, transitionType: '' },
];
implicitAccessible.navState.routeOptions[0].path = [];
implicitAccessible.navState.routeOptions[0].steps = implicitAccessible.navState.route.steps;
const implicitRestored = decodeSessionState(
  serializeSessionState(implicitAccessible, now),
  { now, nodes, floors },
);
assert.equal(
  implicitRestored.status,
  'valid',
  'a pathless cross-floor session comes back: an unproven transition is not evidence of stairs',
);
assert.deepEqual(implicitRestored.value.navigation.route.warnings, [], 'and it has nothing to warn about');

const emptyAliasAccessible = makeState('summary');
emptyAliasAccessible.planState.routeMode = 'accessible';
emptyAliasAccessible.planState.accessibleRoute = true;
emptyAliasAccessible.navState.route.path = [];
emptyAliasAccessible.navState.route.segments = [
  { type: 'floor', floorId: '0', nodeCodes: ['origin'] },
  { type: 'floor', floorId: '1', nodeCodes: ['gate'] },
];
emptyAliasAccessible.navState.route.steps = [
  { index: 0, text: 'Siga pelo corredor.', floorId: '', floor: '0', toFloor: '', isTransition: false, transitionType: '' },
  { index: 1, text: 'Chegue ao destino.', floorId: '', floor: '1', toFloor: '', isTransition: false, transitionType: '' },
];
emptyAliasAccessible.navState.routeOptions[0].path = [];
emptyAliasAccessible.navState.routeOptions[0].steps = emptyAliasAccessible.navState.route.steps;
assert.equal(
  decodeSessionState(serializeSessionState(emptyAliasAccessible, now), { now, nodes, floors }).status,
  'valid',
  'empty normalized floor fields are the API shape, not a session to reject',
);

const orderDependentAccessible = makeState('summary');
orderDependentAccessible.planState.routeMode = 'accessible';
orderDependentAccessible.planState.accessibleRoute = true;
orderDependentAccessible.navState.route.path = ['origin', 'g0', 'g1', 'e0', 'e1', 'gate'];
orderDependentAccessible.navState.route.steps = [
  { index: 0, text: 'Use o elevador.', floorId: '0', toFloor: '1', isTransition: true, transitionType: 'elevator' },
];
orderDependentAccessible.navState.route.segments = [
  { type: 'floor', floorId: '0', nodeCodes: ['origin', 'g0', 'e0'] },
  { type: 'transition', transitionType: 'elevator', fromFloor: '0', toFloor: '1' },
  { type: 'floor', floorId: '1', nodeCodes: ['g1', 'e1', 'gate'] },
];
orderDependentAccessible.navState.routeOptions[0].path = orderDependentAccessible.navState.route.path;
orderDependentAccessible.navState.routeOptions[0].steps = orderDependentAccessible.navState.route.steps;
const orderDependentNodes = [
  ...nodes,
  { code: 'g0', floorId: '0', type: 'corridor' },
  { code: 'g1', floorId: '1', type: 'corridor' },
  { code: 'e0', floorId: '0', type: 'elevator' },
  { code: 'e1', floorId: '1', type: 'elevator' },
];
assert.equal(
  decodeSessionState(serializeSessionState(orderDependentAccessible, now), {
    now,
    nodes: orderDependentNodes,
    floors,
  }).status,
  'valid',
  'a multi-floor accessible route is restored instead of being re-derived away',
);

const legacyView = JSON.parse(serializeSessionState(source, now));
legacyView.journey.navigation.view = 'trajeto';
assert.equal(decodeSessionState(JSON.stringify(legacyView), { now, nodes, floors }).status, 'invalid');

const skippedFreshStep = makeState('summary');
skippedFreshStep.navState.activeStepIndex = 1;
assert.equal(decodeSessionState(serializeSessionState(skippedFreshStep, now), { now, nodes, floors }).status, 'invalid');

const incompleteFloors = JSON.parse(serializeSessionState(source, now));
incompleteFloors.journey.navigation.routeFloorIds = ['1'];
assert.equal(decodeSessionState(JSON.stringify(incompleteFloors), { now, nodes, floors }).status, 'invalid');

const divergentStartedRoute = JSON.parse(serializeSessionState(source, now));
divergentStartedRoute.journey.navigation.routeOptions[0].path = ['origin', 'origin', 'gate'];
assert.equal(decodeSessionState(JSON.stringify(divergentStartedRoute), { now, nodes, floors }).status, 'invalid');

const injectedIcon = JSON.parse(serializeSessionState(source, now));
injectedIcon.journey.navigation.semanticSteps[0].icon = 'x" onload="alert(1)';
assert.equal(decodeSessionState(JSON.stringify(injectedIcon), { now, nodes, floors }).status, 'invalid');

const midnightSource = makeState();
midnightSource.planState.flightTime = '00:30';
midnightSource.planState.flightDate = '2026-08-09';
midnightSource.planState.flightDay = 'tomorrow';
const beforeMidnight = new Date(2026, 7, 8, 23, 50).getTime();
const afterMidnight = new Date(2026, 7, 9, 0, 10).getTime();
const midnightDecoded = decodeSessionState(serializeSessionState(midnightSource, beforeMidnight), {
  now: afterMidnight, nodes, floors,
});
assert.equal(midnightDecoded.status, 'valid');
assert.equal(midnightDecoded.value.plan.flightDate, '2026-08-09');
assert.equal(midnightDecoded.value.plan.flightDay, 'today', 'the absolute flight date does not move at midnight');

const planning = makeState('planning');
planning.planState.destinationCode = '';
const planningDecoded = decodeSessionState(serializeSessionState(planning, now), { now, nodes, floors });
assert.equal(planningDecoded.status, 'valid');
assert.equal(planningDecoded.value.navigation, null);

const preservedStorage = memoryStorage();
assert.equal(persistSessionState({ state: source, nodes, floors, storage: preservedStorage, now }), true);
const previousRaw = preservedStorage.getItem(SESSION_STORAGE_KEY);
const partialState = makeState('summary');
partialState.navState.route = null;
assert.equal(persistSessionState({ state: partialState, nodes, floors, storage: preservedStorage, now: now + 1 }), false);
assert.equal(preservedStorage.getItem(SESSION_STORAGE_KEY), previousRaw, 'a partial write keeps the last valid journey');

console.log('✓ session persistence tests passed');
