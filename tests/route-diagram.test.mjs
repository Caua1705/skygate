/**
 * "Ver trajeto" — the schematic metro diagram.
 *
 * The view is pure geometry over navState, so it can be exercised without a
 * browser: fill the real state modules, build the diagram, and assert the
 * things a screenshot only hints at — that the line is split exactly at the
 * traveller, that a floor change bends it in the right place, and that
 * nothing is ever drawn outside the canvas.
 */
import assert from 'node:assert/strict';
import { appData, navState, planState } from '../src/state/appState.js';
import { buildDiagram, renderRouteDiagram } from '../src/screens/navigation/NavigationRouteMap.js';

const VB_W = 360;   // must match the module's canvas width

/** Every <rect> the diagram draws must fit inside the canvas. */
function assertInsideCanvas(svg, label) {
  const boxes = [...svg.matchAll(/<rect[^>]*\sx="([-\d.]+)"[^>]*width="([\d.]+)"/g)];
  assert.ok(boxes.length, `${label}: expected some boxes to check`);
  for (const [, x, w] of boxes) {
    assert.ok(Number(x) >= 0 && Number(x) + Number(w) <= VB_W,
      `${label}: box ${x}..${Number(x) + Number(w)} escapes the ${VB_W}-unit canvas`);
  }
}

appData.floors = [{ id: '1', name: 'Piso 1' }, { id: '2', name: 'Piso 2' }];
appData.nodes = [
  { code: 'a', type: 'gate',        name: 'Portão A3',        floorId: '1', x: 0,   y: 0  },
  { code: 'b', type: 'shop',        name: 'Rituais',          floorId: '1', x: 40,  y: 10 },
  { code: 'c', type: 'elevator',    name: 'Elevador Central', floorId: '1', x: 80,  y: 20 },
  { code: 'd', type: 'shop',        name: 'Dufry Shopping Duty Free Fortaleza', floorId: '2', x: 120, y: 30 },
  { code: 'e', type: 'restaurant',  name: 'Chilli Beans',     floorId: '2', x: 160, y: 40 },
  // Off route: one within reach of a stop, one far away.
  { code: 'near', type: 'restroom', name: 'Sanitários B',     floorId: '2', x: 132, y: 34 },
  { code: 'far',  type: 'shop',     name: 'Longe Demais',     floorId: '2', x: 900, y: 900 },
];
planState.originCode = 'a';
planState.destinationCode = 'e';

const steps = [
  { text: 'Comece no Portão A3.',   landmarkCode: 'a', floorId: '1', toFloor: '1' },
  { text: 'Passe por Rituais.',     landmarkCode: 'b', floorId: '1', toFloor: '1' },
  { text: 'Suba pelo elevador.',    landmarkCode: 'c', floorId: '1', toFloor: '2', isTransition: true },
  { text: 'Passe por Dufry Shopping Duty Free Fortaleza.', landmarkCode: 'd', floorId: '2', toFloor: '2' },
  { text: 'Chegue a Chilli Beans.', landmarkCode: 'e', floorId: '2', toFloor: '2' },
];
navState.route = { estimatedMinutes: 7, path: ['a', 'b', 'c', 'd', 'e'] };
navState.semanticSteps = steps;

for (let active = 0; active < steps.length; active += 1) {
  navState.activeStepIndex = active;
  const d = buildDiagram(steps, active);
  const svg = renderRouteDiagram();

  assert.equal(d.stations.length, steps.length, 'every step becomes a station');
  assert.equal(d.stations.filter(s => s.status === 'current').length, 1, 'exactly one station is current');
  assert.equal(d.stations.filter(s => s.status === 'done').length, active, 'walked stations match the index');

  // The line is cut at the traveller: nothing solid before the first step,
  // nothing dotted once the destination is reached.
  assert.equal(Boolean(d.walked), active > 0, `walked path present iff active>0 (active=${active})`);
  assert.equal(Boolean(d.remaining), active < steps.length - 1, `dotted path present iff not arrived (active=${active})`);

  assert.ok(!/NaN|Infinity|undefined/.test(svg), `no NaN/undefined in the SVG (active=${active})`);
  assertInsideCanvas(svg, `active=${active}`);
}

// The bend belongs where the floor actually changes — between the lift and
// the stop above it — not at the lift itself.
const d = buildDiagram(steps, 3);
assert.equal(d.stations[1].x, d.stations[2].x, 'the lift stays in the lane it was reached in');
assert.notEqual(d.stations[2].x, d.stations[3].x, 'the floor change bends the line');

// Pills carry the NAME of a stop, not the sentence that instructs it.
assert.equal(d.stations[0].label, 'Portão A3');
assert.equal(d.stations[4].label, 'Chilli Beans');
assert.equal(d.stations[0].eyebrow, 'PARTIDA');
assert.equal(d.stations[3].eyebrow, 'VOCÊ ESTÁ AQUI');
assert.equal(d.stations[4].eyebrow, 'DESTINO');
assert.equal(d.stations[2].eyebrow, 'PISO 2', 'a floor change names the floor it reaches');

// Off-route references are real nodes, near a stop, and never on the route.
assert.ok(d.refs.length && d.refs.length <= 2, 'a nearby landmark is offered, capped at two');
// The label comes from getPublicNodeLabel, so a restroom is "Banheiro …".
assert.ok(d.refs.every(r => /^Banheiro/.test(r.label)), 'the nearby landmark is the one within reach');
assert.ok(!JSON.stringify(d.refs).includes('Longe'), 'a distant POI is not a landmark');

// Arrival: the whole line is walked and the last stop says so.
navState.activeStepIndex = steps.length - 1;
assert.equal(buildDiagram(steps, steps.length - 1).stations.at(-1).eyebrow, 'VOCÊ CHEGOU');

// A one-stop route has no line to draw and must not try.
navState.semanticSteps = [steps[4]];
navState.activeStepIndex = 0;
const solo = buildDiagram(navState.semanticSteps, 0);
assert.equal(solo.stations.length, 1);
assert.equal(solo.walked, '');
assert.equal(solo.remaining, '');
assert.ok(!/NaN/.test(renderRouteDiagram()));

// A long flat route still reads as a metro line, and long names are cut to
// fit rather than allowed to run off the canvas.
navState.route = { estimatedMinutes: 18, path: [] };
navState.semanticSteps = Array.from({ length: 12 }, (_, i) => ({
  text: `Passe por Estabelecimento Comercial Número ${i} do Aeroporto.`,
  floorId: '1', toFloor: '1',
}));
navState.activeStepIndex = 5;
const long = buildDiagram(navState.semanticSteps, 5);
const longSvg = renderRouteDiagram();
assert.equal(new Set(long.stations.map(s => s.x)).size, 2, 'a flat route still uses both lanes');
assert.ok(longSvg.includes('…</text>'), 'a long name is truncated, not overflowed');
assertInsideCanvas(longSvg, 'long route');

// No route at all: a sentence, not a crash.
navState.semanticSteps = [];
assert.match(renderRouteDiagram(), /Nenhum trajeto/);

console.log('route-diagram.test.mjs passed');
