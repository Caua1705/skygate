import assert from 'node:assert/strict';
import { createStore } from '../src/state/createStore.js';
import { createSvgMapCache } from '../src/map/svgMapCache.js';
import { buildSemanticSteps } from '../src/presentation/semanticStepBuilder.js';

const store = createStore({ accessible: false, count: 0 });
let updates = 0;
const unsubscribe = store.subscribe((state) => state.accessible, () => { updates += 1; });
store.setState({ count: 1 });
store.setState({ accessible: true });
unsubscribe();
assert.equal(updates, 1);

let loadCount = 0;
const cache = createSvgMapCache(async (floor) => { loadCount += 1; return `<svg id="${floor}"/>`; });
assert.equal(await cache.load('2'), '<svg id="2"/>');
assert.equal(await cache.load('2'), '<svg id="2"/>');
assert.equal(loadCount, 1);

const nodes = new Map([
  ['a', { code: 'a', type: 'gate', name: 'Portão 1', floorId: '2' }],
  ['b', { code: 'b', type: 'corridor', name: 'Corredor A', floorId: '2' }],
  ['c', { code: 'c', type: 'restroom', name: 'WC', floorId: '2' }],
]);
const steps = buildSemanticSteps({ path: ['a', 'b', 'c'], nodeByCode: nodes, destinationCode: 'c' });
assert.equal(steps.some((step) => /Corredor/.test(step.text)), false);
assert.equal(steps.at(-1).text, 'Chegue a Banheiro do aeroporto.');
console.log('state-and-map.test.mjs passed');
