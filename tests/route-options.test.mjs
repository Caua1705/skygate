import assert from 'node:assert/strict';
import { appData, planState } from '../src/state/appState.js';
import { buildRouteOptions, scoreOptions } from '../src/services/routeOptions.js';

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
      ],
    },
  }, { accessible: true });
  assert.deepEqual(accessible.map(option => option.id), ['lift']);
} finally {
  appData.nodes = previousNodes;
  planState.flightTime = previousFlight;
}

console.log('route-options.test.mjs passed');
