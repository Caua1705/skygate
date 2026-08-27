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
import {
  getEstimatedRemainingMinutes,
  getNavigationTiming,
  navigationPrimaryLabel,
  renderNavigationTiming,
  renderSummaryStrip,
  renderViewToggle,
} from '../src/screens/navigation/NavigationShell.js';
import {
  MAP_H,
  MAP_W,
  MARK_SCALE,
  baseFloorPlaceholderSvg,
  buildLabelLayerHtml,
  buildRouteOverlaySvg,
  getCurrentRouteNode,
  getFloorBounds,
  nodeToSvg,
  planInnerMarkup,
  placeLabels,
} from '../src/map/floorMapBuilder.js';

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

// The map now lives in the floor plans' own space, so the projection is the
// identity: a node is drawn at exactly the x/y the API reported. Anything
// else and the nodes float off the real drawing behind them.
assert.equal(MAP_W, 3740);
assert.equal(MAP_H, 1800);
const floorOneBounds = getFloorBounds('1');
// Zero is a real coordinate, not a missing value.
assert.equal(floorOneBounds.minX, 0);
assert.equal(floorOneBounds.minY, 0);
for (const node of appData.nodes) {
  const projected = nodeToSvg(node, floorOneBounds);
  assert.equal(projected.x, node.x, `${node.code} keeps its raw x`);
  assert.equal(projected.y, node.y, `${node.code} keeps its raw y`);
}
// The bounds of the floor must not influence the projection at all — that
// per-floor re-normalisation is exactly what made alignment impossible.
assert.deepEqual(
  nodeToSvg(appData.nodes[1], getFloorBounds('2')),
  nodeToSvg(appData.nodes[1], floorOneBounds),
  'projection ignores which floor bounds it is handed',
);

// The plan is now a fetched file, unwrapped and re-rooted by us. The
// unwrapping is the part that has to be exact: the viewBox it declares is the
// contract with the node coordinates.
assert.equal(
  planInnerMarkup('<svg viewBox="0 0 3740 1800"><g id="piso 1"><path d="M0 0h1"/></g></svg>'),
  '<g id="piso 1"><path d="M0 0h1"/></g>',
);
assert.equal(planInnerMarkup('not an svg'), '', 'garbage in, empty stage out');
assert.equal(planInnerMarkup(''), '');
assert.equal(planInnerMarkup(null), '');

const placeholder = baseFloorPlaceholderSvg('1');
assert.match(placeholder, /viewBox="0 0 3740 1800"/, 'the empty stage keeps the plan space');
assert.match(placeholder, /Piso 1/, 'and still says which floor it is');

// Auto-fit exposes only a slice of the 3740x1800 canvas. The current-step
// capsule must clamp to that live slice, including when the marker hugs
// either horizontal edge; its compact title remains readable if the place
// name is wider than the frame.
//
// The frame and the marker are scaled by MARK_SCALE along with the caption
// box itself: this asserts the clamping, not the absolute size, and an
// unscaled frame would simply be too small for any caption to fit.
const visibleFrame = {
  x: 300 * MARK_SCALE, y: 150 * MARK_SCALE,
  w: 126 * MARK_SCALE, h: 160 * MARK_SCALE,
};
for (const markerX of [304 * MARK_SCALE, 422 * MARK_SCALE]) {
  const marker = {
    x: markerX - 18 * MARK_SCALE, y: 212 * MARK_SCALE,
    w: 36 * MARK_SCALE, h: 36 * MARK_SCALE,
  };
  const [callout] = placeLabels([{
    x: markerX,
    y: 230 * MARK_SCALE,
    radius: 20 * MARK_SCALE,
    priority: 4,
    cls: 'sg-map-label--here',
    lines: ['Etapa atual', 'Nome de local deliberadamente muito comprido'],
  }], [marker], visibleFrame);
  assert.ok(callout, `current-step callout is retained at x=${markerX}`);
  assert.ok(callout.box.x >= visibleFrame.x);
  assert.ok(callout.box.x + callout.box.w <= visibleFrame.x + visibleFrame.w);
  assert.ok(callout.box.y >= visibleFrame.y);
  assert.ok(callout.box.y + callout.box.h <= visibleFrame.y + visibleFrame.h);
  assert.deepEqual(callout.lines, ['Etapa atual']);
}

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
assert.equal(d.stations[3].eyebrow, 'ETAPA ATUAL');
assert.equal(d.stations[4].eyebrow, 'DESTINO');
assert.equal(d.stations[2].eyebrow, 'PISO 2', 'a floor change names the floor it reaches');

// Off-route references are real nodes, near a stop, and never on the route.
assert.ok(d.refs.length && d.refs.length <= 2, 'a nearby landmark is offered, capped at two');
// The label comes from getPublicNodeLabel, so a restroom is "Banheiro …".
assert.ok(d.refs.every(r => /^Banheiro/.test(r.label)), 'the nearby landmark is the one within reach');
assert.ok(!JSON.stringify(d.refs).includes('Longe'), 'a distant POI is not a landmark');

// Final confirmation: the whole line is walked, but arrival is only claimed
// after the passenger activates the explicit finish action.
navState.activeStepIndex = steps.length - 1;
assert.equal(buildDiagram(steps, steps.length - 1).stations.at(-1).eyebrow, 'ETAPA FINAL');

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

// Active-navigation presentation stays honest and reversible.
navState.route = { estimatedMinutes: 7, path: ['a', 'b', 'c', 'd', 'e'] };
navState.semanticSteps = steps.map((step, index) => ({ ...step, rawFrom: index, rawTo: index }));
navState.activeStepIndex = 0;
assert.equal(getEstimatedRemainingMinutes(), 7, 'the opening estimate is the backend total');
navState.activeStepIndex = 2;
assert.equal(getEstimatedRemainingMinutes(), 4, 'remaining time falls with confirmed progress');
const noFlightStripText = renderSummaryStrip().replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
assert.match(noFlightStripText, /min restantes/);
assert.match(renderSummaryStrip(), /Etapa <b>3<\/b> de 5/);

navState.activeStepIndex = 3;
assert.equal(getCurrentRouteNode()?.code, 'd', 'the real-map marker follows the active route node');
assert.match(buildLabelLayerHtml('2'), /Etapa atual/);
assert.doesNotMatch(buildLabelLayerHtml('2'), /Você está aqui/);

// A single-node current step must not cut the line on either side. The
// completed segment ends at the current node and upcoming starts there.
navState.activeStepIndex = 1;
navState.route.segments = [
  { type: 'floor', floorId: '1', nodeCodes: ['a', 'b', 'c'] },
  { type: 'floor', floorId: '2', nodeCodes: ['d', 'e'] },
];
const floorOverlay = buildRouteOverlaySvg('1');
const completedLine = floorOverlay.match(/sg-route__line is-completed" points="([^"]+)/)?.[1]?.split(' ') ?? [];
const upcomingLine = floorOverlay.match(/sg-route__line is-active" points="([^"]+)/)?.[1]?.split(' ') ?? [];
assert.equal(completedLine.length, 2, 'completed line reaches the current node');
assert.equal(upcomingLine.length, 2, 'upcoming line starts at the current node');
assert.equal(completedLine.at(-1), upcomingLine[0], 'status boundaries share a point');

const timelineTabs = renderViewToggle('timeline');
const mapTabs = renderViewToggle('map');
assert.match(timelineTabs, /Etapas\s*<\/button>/);
assert.match(mapTabs, /Mapa\s*<\/button>/);
assert.match(timelineTabs, /id="tab-steps-btn"[\s\S]*tabindex="0"/);
assert.match(mapTabs, /id="tab-route-btn"[\s\S]*tabindex="0"/);
assert.equal(
  (mapTabs.match(/aria-controls="navigation-panel"/g) ?? []).length,
  2,
  'both tabs always reference the stable swapped panel',
);

const originalFlightTime = planState.flightTime;
planState.flightTime = '12:00';
const flightTiming = getNavigationTiming();
assert.match(flightTiming.gate, /^\d{2}:\d{2}$/, 'walking keeps the estimated gate deadline visible');
assert.match(flightTiming.ariaLabel, /Tempo restante estimado/, 'flight context keeps the remaining walk estimate');
assert.match(flightTiming.ariaLabel, /Fechamento estimado/, 'the gate deadline never reads as an airline fact');
const combinedTiming = renderNavigationTiming();
assert.match(combinedTiming, /~\d+ min/, 'the compact timing keeps the remaining walk visible');
assert.match(combinedTiming, new RegExp(`Portão <strong>~${flightTiming.gate}<\\/strong>`));
assert.match(renderSummaryStrip(), /~\d+ min[\s\S]*Portão/, 'the timeline presents walk and gate timing together');
planState.flightTime = originalFlightTime;

// Manual progress uses explicit, identical language in both navigation views.
navState.activeStepIndex = 1;
assert.equal(navigationPrimaryLabel(), 'Concluir etapa');
navState.activeStepIndex = steps.length - 1;
assert.equal(navigationPrimaryLabel(), 'Finalizar rota');

console.log('route-diagram.test.mjs passed');
