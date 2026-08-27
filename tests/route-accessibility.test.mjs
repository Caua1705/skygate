import assert from 'node:assert/strict';
import { APP_CONFIG } from '../src/app/config/appConfig.js';
import { appData, planState } from '../src/state/appState.js';
import { normalizeStep } from '../src/services/normalize.js';
import {
  accessibleModeWarnings,
  attachStepDistances,
  buildSemanticSteps,
  formatMeters,
  getStepTransitionType,
  pathMeters,
  routePathMatchesPlan,
  segmentMeters,
} from '../src/services/routeSteps.js';

appData.nodes = [
  { code: 'A', floorId: '0', type: 'entrance', name: 'Entrada', isPoi: true },
  { code: 'S', floorId: '0', type: 'stairs', name: 'Escada', isPoi: true },
  { code: 'E', floorId: '0', type: 'elevator', name: 'Elevador', isPoi: true },
  { code: 'D', floorId: '1', type: 'gate', name: 'Portão 1', isPoi: true },
];
planState.originCode = 'A';
planState.destinationCode = 'D';

assert.equal(APP_CONFIG.distance.metersPerUnit, 0.38);
assert.ok(
  Math.abs(segmentMeters({ x: 0, y: 0 }, { x: 3, y: 4 }) - 1.9) < 1e-10,
  'map-unit distance uses the calibrated 0.38 m/unit scale',
);
assert.ok(
  Math.abs((2111.68 * APP_CONFIG.distance.metersPerUnit) - (9.97 * 80)) < 5,
  'the reference route calibration agrees with the API time within five metres',
);
assert.equal(formatMeters(2111.68 * APP_CONFIG.distance.metersPerUnit), '~800 m');
assert.equal(formatMeters(1250), '~1,3 km');
assert.equal(formatMeters(0), '');

const stairs = normalizeStep({
  instruction: 'Use as escadas até o piso 1.',
  floor: '0',
  transition: { type: 'stairs', to_floor: '1' },
}, 0);
assert.equal(stairs.transitionType, 'stairs');
assert.equal(stairs.toFloor, '1');
assert.equal(getStepTransitionType(stairs), 'stairs');

// ── Accessible mode reviews, it does not reject ───────────────────────────
// route_mode='accessible' makes the backend prune inaccessible nodes and stair
// edges before Dijkstra, so its answer is accessible by construction. These
// assertions pin the rule that only POSITIVE evidence of stairs speaks up.
const stepsOnlyStairs = { path: [], segments: [], steps: [stairs] };
const stairsWarnings = accessibleModeWarnings(stepsOnlyStairs);
assert.equal(stairsWarnings.length, 1, 'an instruction naming stairs is worth saying out loud');
assert.match(stairsWarnings[0], /escadas/i);

// Presentation must stay truthful: never erase the unsafe instruction or
// relabel it as an elevator.
planState.routeMode = 'accessible';
const preserved = buildSemanticSteps(stepsOnlyStairs);
assert.equal(preserved[0].text, 'Use as escadas até o piso 1.');
assert.equal(preserved[0].nodeType, 'stairs');
assert.equal(preserved[0].toFloor, '1');

const escalator = normalizeStep({
  instruction: 'Pegue a escada rolante até o piso 1.',
  floor: '0',
  transition: { type: 'escalator', to_floor: '1' },
}, 0);
assert.match(
  accessibleModeWarnings({ path: [], segments: [], steps: [escalator] })[0],
  /escada rolante/i,
  'an escalator is named as an escalator, not folded into "escadas"',
);

const elevator = normalizeStep({
  instruction: 'Use o elevador até o piso 1.',
  floor: '0',
  transition: { type: 'elevator', to_floor: '1' },
}, 0);
assert.deepEqual(
  accessibleModeWarnings({ path: [], segments: [], steps: [elevator] }),
  [],
  'an explicit elevator has nothing to warn about',
);

// The heart of the fix: steps[] arrives from the API as strings, so floorId and
// toFloor are always ''. An unproven floor change must stay silent — treating
// absence of evidence as evidence of stairs is what rejected valid routes.
const unknown = normalizeStep({ instruction: 'Suba até o piso 1.', floor: '0', transition: true }, 0);
assert.deepEqual(
  accessibleModeWarnings({ path: [], segments: [], steps: [unknown] }),
  [],
  'an unidentified floor transition is not evidence of stairs',
);

const descent = normalizeStep({ instruction: 'Desça até o piso 1.', floor: '0' }, 0);
assert.equal(descent.isTransition, true, 'Portuguese descent copy is recognized as a transition');
assert.deepEqual(
  accessibleModeWarnings({ path: [], segments: [], steps: [descent] }),
  [],
  'an unidentified descent is not evidence of stairs either',
);
assert.equal(
  normalizeStep({ instruction: 'Desconto no café.', floor: '0' }, 0).isTransition,
  false,
  'ordinary words beginning with desc are not floor transitions',
);

const stringSteps = ['Siga pelo corredor.', 'Use o elevador até o piso 1.'].map(normalizeStep);
assert.deepEqual(
  accessibleModeWarnings({ path: ['A', 'E', 'D'], segments: [], steps: stringSteps }),
  [],
  'the real API shape — steps[] as plain strings — passes without complaint',
);

const implicitFloorChange = [
  normalizeStep({ instruction: 'Siga pelo corredor.', floor: '0' }, 0),
  normalizeStep({ instruction: 'Chegue ao destino.', floor: '1' }, 1),
];
assert.deepEqual(
  accessibleModeWarnings({ path: [], segments: [], steps: implicitFloorChange }),
  [],
  'a steps-only floor change without elevator metadata is normal, not suspicious',
);

const stairsNodeWarnings = accessibleModeWarnings({ path: ['A', 'S', 'D'], steps: [] });
assert.equal(stairsNodeWarnings.length, 1, 'a staircase NODE in the geometry is real evidence');
assert.match(stairsNodeWarnings[0], /Escada/);
assert.deepEqual(
  accessibleModeWarnings({ path: ['A', 'E', 'D'], steps: [] }),
  [],
  'a concrete elevator path is quiet',
);
assert.deepEqual(
  accessibleModeWarnings({ path: ['A', 'D'], steps: [], segments: [] }),
  [],
  'a floor change the client cannot explain belongs to the server, not to a warning',
);
assert.deepEqual(
  accessibleModeWarnings({ path: ['A', 'MISSING', 'D'], steps: [], segments: [] }),
  [],
  'an unknown node is caught by routePathMatchesPlan, and does not crash the review',
);
assert.match(
  accessibleModeWarnings({
    path: ['A', 'E', 'D'],
    steps: [],
    segments: [{ type: 'transition', transitionType: 'stairs', fromFloor: '0', toFloor: '1' }],
  })[0],
  /escadas/i,
  'stairs declared in segment metadata are still reported',
);
assert.equal(
  accessibleModeWarnings({
    path: ['A', 'S', 'D'],
    steps: [stairs],
    segments: [{ type: 'transition', transitionType: 'stairs', fromFloor: '0', toFloor: '1' }],
  }).length,
  1,
  'one staircase is one warning, however many places describe it',
);

assert.equal(routePathMatchesPlan({ path: ['A', 'E', 'D'], steps: [] }, 'A', 'D'), true);
assert.equal(
  routePathMatchesPlan({ path: ['A', 'E'], steps: [] }, 'A', 'D'),
  false,
  'geometry that stops before the requested destination is rejected for every route mode',
);
assert.equal(
  routePathMatchesPlan({ path: ['A'], steps: [] }, 'A', 'D'),
  false,
  'a single-node geometry is not a complete journey',
);
assert.equal(
  routePathMatchesPlan({ path: ['A', 'MISSING', 'D'], steps: [] }, 'A', 'D'),
  false,
  'unknown geometry nodes are rejected before rendering',
);
assert.equal(
  routePathMatchesPlan({ path: [], steps: [{ text: 'Siga em frente.' }] }, 'A', 'D'),
  true,
  'API variants that intentionally return instructions without geometry remain supported',
);

appData.nodes.push(
  { code: 'G0', floorId: '0', type: 'corridor', name: 'Corredor térreo' },
  { code: 'G1', floorId: '1', type: 'corridor', name: 'Corredor superior' },
  { code: 'E0', floorId: '0', type: 'elevator', name: 'Elevador térreo' },
  { code: 'E1', floorId: '1', type: 'elevator', name: 'Elevador superior' },
  { code: 'B', floorId: '1', type: 'gate', name: 'Portão B' },
);
assert.deepEqual(
  accessibleModeWarnings({
    path: ['A', 'G0', 'G1', 'E0', 'E1', 'B'],
    steps: [elevator],
    segments: [{ type: 'transition', transitionType: 'elevator', fromFloor: '0', toFloor: '1' }],
  }),
  [],
  'a real multi-floor accessible route is accepted instead of being second-guessed',
);

// Rendering is a truthful fallback even if a caller bypasses the guard: the
// journey starts at its origin and an unsafe transition is never hidden.
const preservedPath = buildSemanticSteps({ path: ['A', 'S', 'D'], steps: [] });
assert.equal(preservedPath[0].text, 'Comece em Entrada.');
assert.ok(
  preservedPath.some(step => step.nodeType === 'stairs'),
  'a rejected staircase remains visible if its path is rendered',
);

const geometricNode = (code, x, y, {
  type = 'corridor',
  name = code,
  isPoi = false,
  floorId = '0',
} = {}) => ({ code, x, y, type, name, isPoi, floorId });

function geometricSteps(nodes, path, originCode = 'O', destinationCode = 'G') {
  appData.nodes = nodes;
  planState.originCode = originCode;
  planState.destinationCode = destinationCode;
  return buildSemanticSteps({ path, segments: [], steps: [] });
}

const rightPath = ['O', 'a', 'b', 'c', 'd', 'G'];
const rightSteps = geometricSteps([
  geometricNode('O', 0, 0, { type: 'entrance', name: 'Entrada', isPoi: true }),
  geometricNode('a', 20, 0),
  geometricNode('b', 40, 0),
  geometricNode('c', 40, 20),
  geometricNode('d', 40, 40),
  geometricNode('G', 40, 60, { type: 'gate', name: 'Portão 8', isPoi: true }),
], rightPath);

const rightTurn = rightSteps.find(step => step.text.startsWith('Vire à direita'));
assert.ok(rightTurn, 'east to south is a right turn in SVG coordinates');
assert.equal(rightTurn.rawFrom, 2, 'the turn starts at the real bend node');
assert.equal(rightSteps.filter(step => /^Vire à/.test(step.text)).length, 1);
assert.equal(rightSteps[0].text, 'Comece em Entrada.');
assert.equal(rightSteps.at(-1).text, 'Chegue a Portão 8.');

const measuredRightSteps = attachStepDistances(rightSteps, rightPath);
measuredRightSteps.forEach((step, index) => {
  assert.ok(Number.isInteger(step.rawFrom) && Number.isInteger(step.rawTo));
  assert.ok(step.rawFrom >= 0 && step.rawTo >= step.rawFrom && step.rawTo < rightPath.length);
  const nextFrom = measuredRightSteps[index + 1]?.rawFrom ?? rightPath.length - 1;
  assert.ok(
    Math.abs(step.distanceMeters - pathMeters(rightPath, step.rawFrom, Math.max(step.rawFrom, nextFrom))) < 1e-10,
    'distance remains aligned with the next semantic instruction',
  );
});

const leftSteps = geometricSteps([
  geometricNode('O', 0, 40, { type: 'entrance', name: 'Entrada', isPoi: true }),
  geometricNode('a', 20, 40),
  geometricNode('b', 40, 40),
  geometricNode('c', 40, 20),
  geometricNode('d', 40, 0),
  geometricNode('G', 40, -20, { type: 'gate', name: 'Portão 9', isPoi: true }),
], rightPath);
assert.ok(
  leftSteps.some(step => step.text === 'Vire à esquerda e siga pelo corredor.'),
  'east to north is a left turn when SVG Y grows downwards',
);

const shallowSteps = geometricSteps([
  geometricNode('O', 0, 0, { type: 'entrance', name: 'Entrada', isPoi: true }),
  geometricNode('a', 20, 0),
  geometricNode('b', 40, 0),
  geometricNode('c', 60, 8),
  geometricNode('d', 80, 16),
  geometricNode('G', 100, 24, { type: 'gate', name: 'Portão 10', isPoi: true }),
], rightPath);
assert.equal(
  shallowSteps.some(step => /^Vire|retorno/.test(step.text)),
  false,
  'a gentle 22-degree drift stays a single corridor instruction',
);
assert.equal(shallowSteps.filter(step => step.text === 'Siga pelo corredor.').length, 1);

const microPath = ['O', 'a', 'b', 'c', 'd', 'e', 'f', 'G'];
const microDoglegSteps = geometricSteps([
  geometricNode('O', 0, 0, { type: 'entrance', name: 'Entrada', isPoi: true }),
  geometricNode('a', 20, 0),
  geometricNode('b', 24, 0),
  geometricNode('c', 24, 4),
  geometricNode('d', 28, 4),
  geometricNode('e', 28, 8),
  geometricNode('f', 60, 8),
  geometricNode('G', 80, 8, { type: 'gate', name: 'Portão 11', isPoi: true }),
], microPath);
assert.equal(
  microDoglegSteps.some(step => /^Vire|retorno/.test(step.text)),
  false,
  'sub-three-metre zigzags are smoothed instead of exploding into steps',
);

const doubleTurnPath = ['O', 'a', 'b', 'c', 'd', 'e', 'f', 'G'];
const doubleTurnSteps = geometricSteps([
  geometricNode('O', 0, 0, { type: 'entrance', name: 'Entrada', isPoi: true }),
  geometricNode('a', 20, 0),
  geometricNode('b', 40, 0),
  geometricNode('c', 40, 20),
  geometricNode('d', 40, 40),
  geometricNode('e', 60, 40),
  geometricNode('f', 80, 40),
  geometricNode('G', 100, 40, { type: 'gate', name: 'Portão 12', isPoi: true }),
], doubleTurnPath);
assert.deepEqual(
  doubleTurnSteps.filter(step => /^Vire à/.test(step.text)).map(step => step.text),
  [
    'Vire à direita e siga pelo corredor.',
    'Vire à esquerda e siga pelo corredor.',
  ],
  'separate, meaningful bends remain separate manoeuvres',
);

const poiPath = ['O', 'a', 'b', 'P', 'd', 'G'];
const poiSteps = geometricSteps([
  geometricNode('O', 0, 0, { type: 'entrance', name: 'Entrada', isPoi: true }),
  geometricNode('a', 20, 0),
  geometricNode('b', 40, 0),
  geometricNode('P', 40, 20, { type: 'shop', name: 'Loja Central', isPoi: true }),
  geometricNode('d', 40, 40),
  geometricNode('G', 40, 60, { type: 'gate', name: 'Portão 13', isPoi: true }),
], poiPath);
const poiTurn = poiSteps.find(step => step.text === 'Vire à direita e siga pelo corredor.');
const poiStep = poiSteps.find(step => step.landmarkCode === 'P');
assert.ok(poiTurn);
assert.ok(
  poiStep?.text === 'Passe por Loja Central.',
  'a POI at the end of a geometric run is preserved as its own step',
);
assert.ok(poiTurn.rawTo > poiTurn.rawFrom, 'the final turn owns a visible route edge');
assert.equal(
  poiTurn.rawTo,
  poiStep.rawFrom,
  'the turn overlay ends at the POI boundary without consuming its semantic step',
);
const measuredPoiSteps = attachStepDistances(poiSteps, poiPath);
const measuredPoiTurn = measuredPoiSteps.find(step => step === poiTurn);
assert.equal(
  measuredPoiTurn.distanceMeters,
  pathMeters(poiPath, poiTurn.rawFrom, poiStep.rawFrom),
  'the displayed turn distance matches the same edge covered by the overlay',
);
assert.equal(poiSteps[0].landmarkCode, 'O');
assert.equal(poiSteps.at(-1).landmarkCode, 'G');

console.log('route-accessibility.test.mjs passed');
