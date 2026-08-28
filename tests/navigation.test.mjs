/**
 * Navigation — one screen, every step visible, nothing to confirm.
 *
 * The screen is pure markup over navState, so it can be exercised without
 * a browser: fill the real state modules, render, and assert the things a
 * screenshot only hints at — that every step is listed and numbered, that
 * the map badges carry the same numbers, that a floor change is marked,
 * and that nothing about "the current step" survives anywhere.
 */
import assert from 'node:assert/strict';
import { appData, navState, planState, uiState } from '../src/state/appState.js';
import {
  MAP_H,
  MAP_W,
  baseFloorPlaceholderSvg,
  buildRouteOverlaySvg,
  buildStepLayerHtml,
  floorRouteCodes,
  getCurrentRouteNode,
  getFloorBounds,
  getStepPoints,
  nodeToSvg,
  planInnerMarkup,
  visibleStepPoints,
} from '../src/map/floorMapBuilder.js';
import {
  changesFloor,
  renderStepsList,
  renderStepsSummary,
  stepEstablishment,
  stepMeta,
} from '../src/screens/navigation/NavigationSteps.js';
import {
  bannerSummary,
  getDestinationLabel,
  getEstimatedRemainingMinutes,
  getRouteTotals,
  renderNavigationBanner,
} from '../src/screens/navigation/NavigationShell.js';
import { renderNavigation } from '../src/screens/navigation/NavigationScreen.js';

const count = (html, needle) => html.split(needle).length - 1;
const rows = html => (html.match(/<li class="sg-step[" ]/g) ?? []).length;

appData.floors = [{ id: '1', name: 'Piso 1' }, { id: '2', name: 'Piso 2' }];
appData.nodes = [
  { code: 'a', type: 'gate',       name: 'Portão A3',        floorId: '1', x: 0,   y: 0,  isPoi: true },
  { code: 'b', type: 'shop',       name: 'Rituais',          floorId: '1', x: 40,  y: 10, isPoi: true },
  { code: 'c', type: 'elevator',   name: 'Elevador Central', floorId: '1', x: 80,  y: 20, isPoi: true, isVertical: true },
  { code: 'd', type: 'shop',       name: 'Dufry Shopping',   floorId: '2', x: 120, y: 30, isPoi: true },
  { code: 'e', type: 'restaurant', name: 'Chilli Beans',     floorId: '2', x: 160, y: 40, isPoi: true },
  { code: 'near', type: 'restroom', name: 'Sanitários B',    floorId: '2', x: 132, y: 34, isPoi: true },
];
planState.originCode = 'a';
planState.destinationCode = 'e';

// The map lives in the floor plans' own space, so the projection is the
// identity: a node is drawn at exactly the x/y the API reported.
assert.equal(MAP_W, 3740);
assert.equal(MAP_H, 1800);
const bounds = getFloorBounds('1');
assert.equal(bounds.minX, 0, 'zero is a real coordinate, not a missing value');
for (const node of appData.nodes) {
  const projected = nodeToSvg(node, bounds);
  assert.equal(projected.x, node.x);
  assert.equal(projected.y, node.y);
}
assert.equal(
  planInnerMarkup('<svg viewBox="0 0 3740 1800"><g id="piso 1"><path d="M0 0h1"/></g></svg>'),
  '<g id="piso 1"><path d="M0 0h1"/></g>',
);
assert.equal(planInnerMarkup('not an svg'), '');
assert.match(baseFloorPlaceholderSvg('1'), /viewBox="0 0 3740 1800"/);
assert.match(baseFloorPlaceholderSvg('1'), /Piso 1/);

const steps = [
  { text: 'Saia de Portão A3 em direção ao corredor.', landmarkCode: 'a', floorId: '1', toFloor: '1', rawFrom: 0, rawTo: 0, nodeType: 'gate',     icon: 'solar:map-point-bold', distanceMeters: 10 },
  { text: 'Passe por Rituais.',      landmarkCode: 'b', floorId: '1', toFloor: '1', rawFrom: 1, rawTo: 1, nodeType: 'shop',     icon: 'solar:shop-2-bold',    distanceMeters: 20 },
  { text: 'Use o elevador até o Piso 2.', landmarkCode: 'c', floorId: '1', toFloor: '2', rawFrom: 2, rawTo: 2, nodeType: 'elevator', icon: 'solar:round-transfer-vertical-bold', isTransition: true, distanceMeters: 0 },
  { text: 'Passe por Dufry Shopping.', landmarkCode: 'd', floorId: '2', toFloor: '2', rawFrom: 3, rawTo: 3, nodeType: 'shop',   icon: 'solar:shop-2-bold',    distanceMeters: 30 },
  { text: 'Chegue a Chilli Beans.',  landmarkCode: 'e', floorId: '2', toFloor: '2', rawFrom: 4, rawTo: 4, nodeType: 'restaurant', icon: 'solar:map-point-bold', distanceMeters: 0 },
];
navState.route = {
  estimatedMinutes: 7,
  path: ['a', 'b', 'c', 'd', 'e'],
  segments: [
    { type: 'floor', floorId: '1', nodeCodes: ['a', 'b', 'c'] },
    { type: 'transition', transitionType: 'elevator', fromFloor: '1', toFloor: '2' },
    { type: 'floor', floorId: '2', nodeCodes: ['d', 'e'] },
  ],
};
navState.semanticSteps = steps;
navState.routeFloorIds = new Set(['1', '2']);
navState.activeStepIndex = 0;
uiState.focusedStepIndex = -1;
uiState.sheetDetent = 'half';

// ── The route: ONE cased line per floor, no progress split ──
assert.deepEqual(floorRouteCodes('1'), ['a', 'b', 'c']);
assert.deepEqual(floorRouteCodes('2'), ['d', 'e']);
const floorOne = buildRouteOverlaySvg('1');
assert.equal(count(floorOne, 'sg-route__casing'), 1, 'one casing stroke');
assert.equal(count(floorOne, 'sg-route__line'), 1, 'one line stroke');
const casingPts = floorOne.match(/sg-route__casing" points="([^"]+)/)[1];
const linePts = floorOne.match(/sg-route__line"\s+points="([^"]+)/)[1];
assert.equal(casingPts, linePts, 'casing and line share the same geometry');
assert.equal(casingPts.split(' ').length, 3, 'the whole floor path is one line');
assert.match(floorOne, /pathLength="100"/);
for (const stale of ['is-completed', 'is-active', 'is-upcoming', 'sg-map-here', 'Etapa atual']) {
  assert.ok(!floorOne.includes(stale), `no trace of a current step: ${stale}`);
}
assert.equal(buildRouteOverlaySvg('2').match(/points="([^"]+)/)[1].split(' ').length, 2);

// ── Step badges match the list's numbering ──
assert.deepEqual(getStepPoints('1').map(p => p.index), [0, 1, 2]);
assert.deepEqual(getStepPoints('2').map(p => p.index), [3, 4]);
const badgesOne = buildStepLayerHtml('1', 10);
assert.equal(count(badgesOne, 'data-step-index="'), 3);
assert.match(badgesOne, /data-step-index="0"[\s\S]*?sg-map-step__badge[^>]*>1</);
assert.match(badgesOne, /data-step-index="2"[\s\S]*?sg-map-step__badge[^>]*>3</);
assert.match(badgesOne, /sg-map-step is-origin[\s\S]*?Partida/, 'the first badge says where the trip starts');
assert.match(badgesOne, /data-step-index="2"/);
assert.ok(/is-transition[^>]*data-step-index="2"/.test(badgesOne), 'the lift is marked as a floor change');
const badgesTwo = buildStepLayerHtml('2', 10);
assert.match(badgesTwo, /is-dest[^>]*data-step-index="4"[\s\S]*?>5<[\s\S]*?Chilli Beans/, 'the destination badge carries its name');

// Collision thinning: when the map is far out, numbers that would overlap
// are dropped, endpoints first to survive.
const pts = getStepPoints('1');
assert.equal(visibleStepPoints(pts, 10).length, 3, 'zoomed in, every badge fits');
const farOut = visibleStepPoints(pts, 0.1);
assert.equal(farOut.length, 1, 'zoomed out, overlapping badges are thinned');
assert.equal(farOut[0].index, 0, 'the origin is the one that survives');
// Priority when two badges contend: a floor change beats an ordinary step,
// and the step being looked at beats both.
const contending = [
  { index: 0, isOrigin: true, p: { x: 0, y: 0 }, step: {} },
  { index: 1, p: { x: 100, y: 0 }, step: {} },
  { index: 2, p: { x: 110, y: 0 }, step: { isTransition: true } },
];
assert.deepEqual(visibleStepPoints(contending, 1).map(p => p.index), [0, 2], 'the lift outranks a plain step');
uiState.focusedStepIndex = 1;
assert.deepEqual(visibleStepPoints(contending, 1).map(p => p.index), [0, 1], 'the focused step outranks the lift');
uiState.focusedStepIndex = -1;

// ── The list: every step, numbered, with the floor change marked ──
const list = renderStepsList();
assert.equal(rows(list), 5, 'every step becomes a row');
for (let i = 0; i < 5; i += 1) {
  assert.match(list, new RegExp(`data-step-index="${i}"[\\s\\S]*?sg-step__num[^>]*>${i + 1}<`), `row ${i + 1} is numbered`);
}
assert.equal(count(list, 'class="sg-steps__floor"'), 1, 'exactly one floor change on this route');
assert.ok(list.indexOf('sg-steps__floor') < list.indexOf('data-step-index="3"'), 'the divider sits before the first step on the new floor');
assert.ok(list.indexOf('sg-steps__floor') > list.indexOf('data-step-index="2"'), 'and after the lift');
assert.match(list, /Troca de piso[\s\S]*?Piso 1[\s\S]*?Piso 2/);
assert.match(list, /is-transition[\s\S]*?data-step-index="2"/);
assert.match(list, /is-dest[\s\S]*?data-step-index="4"/);
assert.match(list, /sg-step__place[\s\S]*?Rituais/, 'a step through a shop names the shop');
assert.match(list, /sg-step__place[\s\S]*?Dufry Shopping/);
assert.equal(count(list, 'aria-pressed="true"'), 0, 'nothing is selected until the traveller looks at a step');
for (const stale of ['Concluir', 'Etapa atual', 'Confirme', 'etapa', 'aria-current', 'nav-next']) {
  assert.ok(!list.includes(stale), `the list carries no confirmation model: ${stale}`);
}
assert.ok(changesFloor(steps[2], steps[3]));
assert.ok(!changesFloor(steps[0], steps[1]));

const meta = stepMeta(steps[1]);
assert.equal(meta, '20 m · 2 min', 'a leg states its distance and its share of the total time, no tilde');
assert.equal(stepMeta(steps[0]), '10 m · 1 min', 'a short leg still takes at least a minute');
assert.equal(stepMeta(steps[4]), '', 'a zero-length arrival states nothing');
assert.ok(!renderStepsList().includes('~'), 'the list never hedges its numbers');

const rituais = stepEstablishment(steps[1]);
assert.equal(rituais.name, 'Rituais');
assert.equal(rituais.hasDetails, true, 'every mapped place opens the detail card');
assert.match(list, /<button[^>]*class="sg-step__place has-details" data-place-code="b"/, 'as a real button beside the row');
assert.equal(stepEstablishment(steps[0]), null, 'the origin is never an establishment');
assert.equal(stepEstablishment(steps[2]), null, 'a lift is never an establishment');
assert.equal(stepEstablishment(steps[4]), null, 'nor is the destination');

uiState.focusedStepIndex = 1;
const focusedList = renderStepsList();
assert.equal(count(focusedList, 'aria-pressed="true"'), 1);
assert.match(focusedList, /is-focused[^>]*data-step-index="1"/);
uiState.focusedStepIndex = -1;

assert.match(renderStepsSummary(), /5 passos/);
assert.match(renderStepsSummary(), /2 pisos/);

// ── The banner: destination, total time, total distance ──
assert.equal(getDestinationLabel(), 'Chilli Beans');
assert.deepEqual(getRouteTotals(), { minutes: 7, meters: 60, steps: 5 });
const summary = bannerSummary();
assert.ok(summary.visible.includes('7 min'));
assert.ok(summary.visible.includes('60 m'), 'total distance, rounded to 10 m, no tilde');
assert.equal(summary.gate, '', 'no flight, no gate clock');
const banner = renderNavigationBanner();
assert.match(banner, /<h1[^>]*>Chilli Beans<\/h1>/);
assert.match(banner, /id="exit-nav-btn"/);
assert.match(banner, /Rota para/);
assert.match(banner, /7 min/);

const originalFlightTime = planState.flightTime;
planState.flightTime = '12:00';
const withFlight = bannerSummary();
assert.match(withFlight.gate, /^\d{2}:\d{2}$/, 'a flight adds the estimated gate deadline');
assert.ok(withFlight.visible.some(part => part.startsWith('Portão')));
assert.match(withFlight.ariaLabel, /Fechamento estimado/, 'the gate deadline never reads as an airline fact');
planState.flightTime = originalFlightTime;

planState.accessibleRoute = true;
assert.match(renderNavigationBanner(), /sem escadas/);
planState.accessibleRoute = false;

// Kept for the route-choice screen's resume estimate: with no confirmed
// progress the whole route is ahead.
assert.equal(getEstimatedRemainingMinutes(), 7);
assert.equal(getCurrentRouteNode()?.code, 'a', 'with nothing confirmed the "current" node is the origin');

// ── The screen: one map, one banner, two controls, one sheet ──
const screen = renderNavigation();
assert.match(screen, /id="nav-sheet"[^>]*data-detent="half"/);
assert.match(screen, /id="steps-list"/);
assert.equal(count(screen, 'class="sg-map-fab"'), 2, 'floors + recentre, and no more');
assert.match(screen, /id="recenter-btn"/);
assert.match(screen, /id="floor-trigger-btn"/);
for (const stale of ['tab-steps-btn', 'tab-route-btn', 'Concluir etapa', 'nav-next', 'nav-prev', 'zoom-in-btn', 'tilt', 'Etapa atual', 'de 5', 'Confirme somente']) {
  assert.ok(!screen.includes(stale), `removed from the screen: ${stale}`);
}
assert.match(screen, /sg-steps__floor/, 'the floor change is visible on the screen');

// ── Degenerate routes ──
// A steps-only API response: no path, and buildFromSteps() leaves every
// landmarkCode null. Nothing can be placed on the map, but the list is whole.
navState.route = { estimatedMinutes: 3, path: [], segments: [], steps: [] };
navState.semanticSteps = steps.map(step => ({ ...step, landmarkCode: null, rawFrom: 0, rawTo: 0 }));
assert.deepEqual(getStepPoints('1'), [], 'a steps-only route has no geometry to badge');
assert.ok(!buildRouteOverlaySvg('1').includes('polyline'));
assert.equal(rows(renderStepsList()), 5, 'but every step is still listed');

navState.semanticSteps = [];
assert.match(renderStepsList(), /Nenhum trajeto/);
assert.equal(getRouteTotals().steps, 0);

console.log('navigation.test.mjs passed');
