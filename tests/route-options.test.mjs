import assert from 'node:assert/strict';
import { appData, planState } from '../src/state/appState.js';
import {
  buildRouteOptions,
  routeForSelectedOption,
  scoreOptions,
} from '../src/services/routeOptions.js';

const previousNodes = appData.nodes;
const previousFlight = planState.flightTime;

try {
  appData.nodes = [
    { code: 'A', floorId: '0', type: 'entrance' },
    { code: 'B', floorId: '0', type: 'waypoint' },
    { code: 'C', floorId: '0', type: 'waypoint' },
    { code: 'S', floorId: '0', type: 'stairs' },
    { code: 'D', floorId: '0', type: 'gate' },
  ];
  planState.flightTime = '';

  const base = {
    path: ['A', 'B', 'D'],
    steps: [{ text: 'Siga em frente.' }],
    segments: [{ type: 'floor', floorId: '0', nodeCodes: ['A', 'B', 'D'] }],
    warnings: [],
    estimatedMinutes: 8,
    raw: {},
  };

  const fallback = buildRouteOptions(base);
  assert.equal(fallback.length, 1, 'one backend route produces one honest option');
  assert.deepEqual(fallback[0].path, base.path);
  assert.deepEqual(fallback[0].passesBy, [], 'the client does not invent commercial detours');
  assert.equal(fallback[0].isEstimate, true);

  const stepsOnlyBase = {
    path: [],
    steps: [{ text: 'Siga pelo corredor.', floorId: '0' }],
    segments: [{ type: 'floor', floorId: '0', nodeCodes: [] }],
    warnings: [],
    estimatedMinutes: 5,
    raw: {},
  };
  const stepsOnlyOption = buildRouteOptions(stepsOnlyBase)[0];
  const selectedStepsOnly = routeForSelectedOption(stepsOnlyBase, stepsOnlyOption);
  assert.equal(selectedStepsOnly.optionId, stepsOnlyOption.id);
  assert.equal(selectedStepsOnly.estimatedMinutes, stepsOnlyOption.minutes);
  assert.strictEqual(selectedStepsOnly.steps, stepsOnlyBase.steps, 'steps-only guidance is preserved');
  assert.strictEqual(selectedStepsOnly.segments, stepsOnlyBase.segments, 'steps-only floor context is preserved');

  const withAlternatives = buildRouteOptions({
    ...base,
    raw: {
      alternatives: [
        { id: 'quiet', name: 'Menos movimentada', minutes: 10, path: ['A', 'C', 'D'] },
        { id: 'direct', name: 'Mais rápida', minutes: 7, path: ['A', 'B', 'D'] },
        { id: 'broken', name: 'Inválida', minutes: 4, path: ['A', 'missing', 'D'] },
        { id: 'stairs', name: 'Pelas escadas', minutes: 6, path: ['A', 'S', 'D'] },
      ],
    },
  });

  assert.deepEqual(withAlternatives.map(option => option.id), ['quiet', 'direct', 'stairs']);
  assert.equal(withAlternatives[0].deltaMinutes, 4);
  assert.equal(scoreOptions(withAlternatives)[2].isFastest, true);

  const accessible = buildRouteOptions({
    ...base,
    raw: {
      alternatives: [
        { id: 'lift', name: 'Pelo elevador', minutes: 9, path: ['A', 'C', 'D'] },
        { id: 'stairs', name: 'Pelas escadas', minutes: 6, path: ['A', 'S', 'D'] },
        { id: 'contradictory', name: 'Texto inseguro', minutes: 8, path: ['A', 'C', 'D'], steps: ['Use as escadas até o piso 1.'] },
      ],
    },
  }, { accessible: true });
  // The backend built these under route_mode='accessible'; the client no longer
  // discards them. It annotates the ones that name stairs out loud.
  assert.deepEqual(
    accessible.map(option => option.id),
    ['lift', 'stairs', 'contradictory'],
    'accessible options survive instead of being re-derived away',
  );
  assert.deepEqual(accessible[0].warnings, [], 'a clean accessible option says nothing');
  assert.equal(accessible[1].warnings.length, 1, 'a staircase node is flagged, not removed');
  assert.match(accessible[1].warnings[0], /escada/i);
  assert.equal(accessible[2].warnings.length, 1, 'unsafe instruction text is flagged too');
  assert.match(accessible[2].warnings[0], /escadas/i);

  const notAccessible = buildRouteOptions({
    ...base,
    raw: { alternatives: [{ id: 'stairs', name: 'Pelas escadas', minutes: 6, path: ['A', 'S', 'D'] }] },
  });
  assert.deepEqual(
    notAccessible[0].warnings,
    [],
    'stairs are only worth a warning when the passenger asked to avoid them',
  );
} finally {
  appData.nodes = previousNodes;
  planState.flightTime = previousFlight;
}

console.log('route-options.test.mjs passed');
