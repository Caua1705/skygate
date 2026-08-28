import { getPublicNodeLabel } from '../services/nodePresentation.js';
import { appData, mapState, navState, planState, uiState } from '../state/appState.js';
import { clamp, esc } from '../utils/format.js';
import { findNode, getFloorLabel, getFloorTransform } from '../state/selectors.js';
import { createSvgMapCache } from './svgMapCache.js';

/* ============================================================
   6. FLOOR MAP BUILDER — the real floor plan, with the route over it

   THE PLAN IS REAL. assets/floors/{floorId}.svg is the architectural
   drawing of that level, exported on a 3740x1800 viewBox — the SAME space
   the API reports node x/y in. Nothing is synthesised and nothing is
   re-scaled: a node at (2263.88, 942.59) is drawn at (2263.88, 942.59) and
   lands on the door the plan draws there. That is why nodeToSvg() is the
   identity function.

   Map units are physical: 1 unit is APP_CONFIG.distance.metersPerUnit
   (0.38 m) on every floor.

   VISUAL PREMISE — "light plan, dark route":
   the drawing is pale (it always was; #E2E2EE lavender straight out of
   Figma) so it is painted as a light surface map and the ROUTE is the one
   dark, saturated thing on it — a navy casing under a turquoise line.
   Everything the traveller has to find (the line, the step numbers, the
   destination) is darker than everything they merely look at.

   FOUR LAYERS, one coordinate space, in paint order:
     base    the plan (SVG), themed in navigation.css
     route   the cased line (SVG)
     pois    places along the route (HTML buttons)
     steps   numbered step badges matching the list (HTML buttons)
   HTML layers counter-scale the map zoom (see .sg-poi / .sg-map-step) so a
   badge is the same size on screen whether the map is at 0.2x or 4x; the
   route's stroke does the same through a CSS calc on --map-zoom.
   ============================================================ */

/** The floor plans' own viewBox. Node x/y are already in this space. */
export const MAP_W = 3740, MAP_H = 1800;

/**
 * The route node a step is anchored to: its landmark when it has one,
 * otherwise the node at its own path position.
 */
export function stepAnchorNode(step, path = navState.route?.path ?? []) {
  if (!step) return null;
  if (step.landmarkCode) return findNode(step.landmarkCode);
  if (!path.length) return null;
  const rawIndex = Number(step.rawFrom);
  return findNode(path[clamp(Number.isFinite(rawIndex) ? rawIndex : 0, 0, path.length - 1)]) ?? null;
}

/**
 * The node behind the confirmed active step. Navigation no longer moves
 * activeStepIndex, so in practice this is the ORIGIN — kept because the
 * replan-from-here action reads it, and that is exactly what it should
 * return when the app has no idea where the traveller has got to.
 */
export function getCurrentRouteNode() {
  const path = navState.route?.path ?? [];
  const step = navState.semanticSteps[navState.activeStepIndex];
  return stepAnchorNode(step, path)
    ?? (path.length ? findNode(path[0]) : null)
    ?? findNode(planState.originCode);
}

export function getFloorBounds(floorId) {
  // (0, 0) is a valid map coordinate, commonly used by the first node on a
  // floor. Truthiness used to discard it and could project that node far
  // outside the plan after normalising the remaining bounds.
  const ns = appData.nodes.filter(n =>
    n.floorId === floorId && Number.isFinite(n.x) && Number.isFinite(n.y)
  );
  if (!ns.length) return { minX: 0, maxX: 100, minY: 0, maxY: 100, w: 100, h: 100 };
  const xs = ns.map(n => n.x), ys = ns.map(n => n.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  return { minX, maxX, minY, maxY, w: maxX - minX || 1, h: maxY - minY || 1 };
}

/**
 * Project a node into the map's coordinate space — which is the plan's own
 * space, so this is the identity.
 *
 * `bounds` is accepted and ignored on purpose: every caller already computes
 * it and passes it, and keeping the signature means the projection stays a
 * single function that the base plan, the route overlay, the POI layer and
 * mapFit all share. Re-scaling here is precisely what stopped nodes from
 * landing on the plan.
 */
export function nodeToSvg(node, _bounds) {
  return { x: node.x, y: node.y };
}

/**
 * The route's node codes on one floor, in walking order. Segments are the
 * authority when the API sends them; the raw path filtered by floor is the
 * fallback.
 */
export function floorRouteCodes(floorId, route = navState.route) {
  if (!route) return [];
  const segmentCodes = (route.segments ?? [])
    .filter(segment => segment.type === 'floor' && segment.floorId === floorId)
    .flatMap(segment => segment.nodeCodes ?? []);
  return [...new Set(segmentCodes.length
    ? segmentCodes
    : (route.path ?? []).filter(code => findNode(code)?.floorId === floorId))];
}

/* -- THE FLOOR PLAN ------------------------------------------------
   assets/floors/{floorId}.svg, fetched once per floor and INLINED.

   Inlined rather than <image href> or a CSS background for one reason: the
   plan is a full-colour Figma export and it has to be re-themed. Only real
   DOM can be, and .sg-map__plan in navigation.css is where that happens.
   ------------------------------------------------------------------ */

const floorPlanUrl = floorId => `/assets/floors/${encodeURIComponent(floorId)}.svg`;

/**
 * The plan's contents without its own <svg> wrapper.
 *
 * We supply the wrapper ourselves so the class names, the aria-hidden and
 * the viewBox are ours. The file's viewBox is already 0 0 3740 1800, exactly
 * what we re-declare, so dropping its root tag changes nothing geometric.
 */
export function planInnerMarkup(svgText) {
  const text = String(svgText ?? '');
  const rootStart = text.indexOf('<svg');
  if (rootStart < 0) return '';
  const rootEnd = text.indexOf('>', rootStart);
  const close = text.lastIndexOf('</svg>');
  if (rootEnd < 0 || close < rootEnd) return '';
  return text.slice(rootEnd + 1, close);
}

/** The empty stage: what the base layer shows before a plan has arrived. */
export function baseFloorPlaceholderSvg(floorId) {
  return `<svg viewBox="0 0 ${MAP_W} ${MAP_H}" class="sg-map-svg sg-map-base" aria-hidden="true">
    <rect class="sg-map__bg" width="${MAP_W}" height="${MAP_H}"/>
    <text class="sg-map__watermark" x="${MAP_W / 2}" y="${MAP_H / 2}" text-anchor="middle">${esc(getFloorLabel(floorId))}</text>
  </svg>`;
}

/**
 * Build the BASE floor SVG: the real plan, wrapped in our own root.
 *
 * A plan that fails to load degrades to the empty stage rather than to a
 * broken screen — the route, the POIs and the badges live in separate
 * layers and stay usable without the scenery behind them.
 */
export async function buildBaseFloorSvg(floorId) {
  let inner = '';
  try {
    const response = await fetch(floorPlanUrl(floorId));
    if (!response.ok) throw new Error(`floor plan ${floorId}: HTTP ${response.status}`);
    inner = planInnerMarkup(await response.text());
  } catch (error) {
    console.warn('[SkyGate] planta do piso indisponivel', floorId, error);
    return baseFloorPlaceholderSvg(floorId);
  }
  if (!inner) return baseFloorPlaceholderSvg(floorId);

  return `<svg viewBox="0 0 ${MAP_W} ${MAP_H}" class="sg-map-svg sg-map-base" aria-hidden="true">
    <rect class="sg-map__bg" width="${MAP_W}" height="${MAP_H}"/>
    <g class="sg-map__plan">${inner}</g>
  </svg>`;
}

/* ── THE ROUTE ────────────────────────────────────────────────
   One cased polyline per floor: a navy stroke underneath, a turquoise
   stroke on top. No completed / active / upcoming split — the app does not
   know where the traveller is, so the whole route is equally the route.

   pathLength="100" normalises the line to a 0–100 dash space so the
   entrance can draw a 90-unit leg and a 900-unit leg in the same time.
   Stroke widths live in navigation.css and are divided by --map-zoom so
   the line keeps the same thickness on screen at every zoom.
   ──────────────────────────────────────────────────────────── */

export function buildRouteOverlaySvg(floorId) {
  const route = navState.route;
  if (!route) return `<svg viewBox="0 0 ${MAP_W} ${MAP_H}" class="sg-map-svg sg-map-route" aria-hidden="true"></svg>`;

  const bounds = getFloorBounds(floorId);
  const pts = floorRouteCodes(floorId)
    .map(code => findNode(code))
    .filter(Boolean)
    .map(n => nodeToSvg(n, bounds));

  if (pts.length < 2) {
    // A single node on this floor (a lift landing, say) still deserves a mark
    // so the floor does not look empty of route; the badge layer names it.
    const spot = pts[0]
      ? `<circle class="sg-route__spot" cx="${pts[0].x.toFixed(1)}" cy="${pts[0].y.toFixed(1)}" r="6"/>`
      : '';
    return `<svg viewBox="0 0 ${MAP_W} ${MAP_H}" class="sg-map-svg sg-map-route" aria-hidden="true" style="overflow:visible">${spot}</svg>`;
  }

  const points = pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  return `<svg viewBox="0 0 ${MAP_W} ${MAP_H}" class="sg-map-svg sg-map-route" aria-hidden="true" style="overflow:visible">
    <polyline class="sg-route__casing" points="${points}" pathLength="100" stroke-width="14"/>
    <polyline class="sg-route__line"   points="${points}" pathLength="100" stroke-width="8"/>
  </svg>`;
}

/* ── STEP BADGES ──────────────────────────────────────────────
   One numbered badge per semantic step on this floor, at the node the
   step is anchored to. The number is the step's position in the list
   (1-based), so "3" on the map is row 3 in the sheet.

   HTML, not SVG: a badge needs text, a tap target and a counter-scale,
   all of which HTML gives for free. Origin and destination are just the
   first and last badges, styled apart; the destination also carries its
   name, because on a map the end of the line should say where it goes.
   ──────────────────────────────────────────────────────────── */

/** Screen px below which two badges are considered to collide. */
const BADGE_CLEAR_PX = 30;

/**
 * Badge geometry for this floor: { index, step, p, isOrigin, isDest }.
 * Steps whose anchor is on another floor, or that have no geometry at all
 * (steps-only routes), produce nothing.
 */
export function getStepPoints(floorId) {
  const route = navState.route;
  if (!route) return [];
  const bounds = getFloorBounds(floorId);
  const path = route.path ?? [];
  const last = navState.semanticSteps.length - 1;
  return navState.semanticSteps.map((step, index) => {
    const node = stepAnchorNode(step, path);
    if (!node || node.floorId !== floorId || !Number.isFinite(node.x) || !Number.isFinite(node.y)) return null;
    return { index, step, node, p: nodeToSvg(node, bounds), isOrigin: index === 0, isDest: index === last };
  }).filter(Boolean);
}

/**
 * Which badges get drawn at the given zoom. Two numbers printed on top of
 * each other read as neither, so when steps sit closer than a badge's own
 * width on screen the less important one is dropped: endpoints and the
 * focused step always survive, then floor transitions, then the rest in
 * walking order. Re-run whenever the zoom settles (see mapPanZoom.js).
 */
export function visibleStepPoints(points, scale) {
  const s = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const focused = uiState.focusedStepIndex;
  const rank = pt => (pt.isOrigin || pt.isDest) ? 0 : pt.index === focused ? 1 : pt.step.isTransition ? 2 : 3;
  const kept = [];
  [...points]
    .sort((a, b) => rank(a) - rank(b) || a.index - b.index)
    .forEach(pt => {
      const clear = kept.every(k => Math.hypot(k.p.x - pt.p.x, k.p.y - pt.p.y) * s >= BADGE_CLEAR_PX);
      if (clear) kept.push(pt);
    });
  return kept.sort((a, b) => a.index - b.index);
}

export function buildStepLayerHtml(floorId, scale = getFloorTransform(floorId).scale) {
  const points = visibleStepPoints(getStepPoints(floorId), scale);
  return points.map(({ index, step, node, p, isOrigin, isDest }) => {
    const number = index + 1;
    const name = getPublicNodeLabel(node);
    const kind = isDest ? 'Destino' : isOrigin ? 'Partida' : step.isTransition ? 'Troca de piso' : 'Passo';
    const classes = [
      'sg-map-step',
      isOrigin ? 'is-origin' : '',
      isDest ? 'is-dest' : '',
      step.isTransition ? 'is-transition' : '',
      index === uiState.focusedStepIndex ? 'is-focused' : '',
    ].filter(Boolean).join(' ');
    return `<button type="button" class="${classes}" data-step-index="${index}"
      style="left:${p.x.toFixed(1)}px;top:${p.y.toFixed(1)}px"
      aria-label="${esc(kind)} ${number}: ${esc(String(step.text ?? '').replace(/\.\s*$/, ''))}. Ver na lista.">
      <span class="sg-map-step__badge" aria-hidden="true">${number}</span>
      ${isDest || isOrigin ? `<span class="sg-map-step__label" aria-hidden="true">${esc(isDest ? name : 'Partida')}</span>` : ''}
    </button>`;
  }).join('');
}

/* ── POIs ALONG THE ROUTE ──────────────────────────────────────
   Rendered as HTML, not SVG, in their own layer. The layer is exactly the
   same 3740x1800 box as the SVG viewBox, so 1 SVG unit == 1 CSS px and the
   markers land precisely on the plan. HTML buys us real <button>s (focus,
   aria-label, comfortable tap targets).
   ────────────────────────────────────────────────────────────── */

/** Shortest distance from a point to a polyline, in SVG units. */
function distToPolyline(p, pts) {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / len2, 0, 1) : 0;
    best = Math.min(best, Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)));
  }
  return best;
}

/**
 * How close to the line a POI has to be to count as "on the way".
 * 133 units x 0.38 m/unit is about 50 m.
 */
export const POI_NEAR_UNITS = 133;
/** Hard ceiling on visible POIs. The route is the subject; POIs are a footnote. */
const POI_MAX = 6;
/** Below this many POIs literally on the path, top up with nearby ones. */
const POI_MIN = 3;

/**
 * POIs worth offering on this floor. Places the route physically passes
 * through come first and are usually the whole list; only when there are
 * barely any of those do nearby places get pulled in. Origin, destination
 * and vertical connections are excluded — they have badges of their own.
 */
export function getRoutePois(floorId) {
  const route = navState.route;
  if (!route) return [];

  const bounds = getFloorBounds(floorId);
  const toSvg  = n => nodeToSvg(n, bounds);

  const floorCodes = floorRouteCodes(floorId, route);
  const linePts = floorCodes.map(c => findNode(c)).filter(Boolean).map(toSvg);
  if (linePts.length < 2) return [];

  const routeSet = new Set(floorCodes);
  const badged = new Set(navState.semanticSteps.map(s => s.landmarkCode).filter(Boolean));

  const candidates = appData.nodes
    .filter(n =>
      n.floorId === floorId &&
      n.isPoi && !n.isInternal && !n.isVertical &&
      !badged.has(n.code) &&
      n.code !== planState.originCode &&
      n.code !== planState.destinationCode)
    .map(n => {
      const p = toSvg(n);
      return { node: n, p, onRoute: routeSet.has(n.code), dist: distToPolyline(p, linePts) };
    })
    .filter(poi => poi.onRoute || poi.dist <= POI_NEAR_UNITS)
    .sort((a, b) => (b.onRoute - a.onRoute) || (a.dist - b.dist));

  const onRoute = candidates.filter(poi => poi.onRoute);
  if (onRoute.length >= POI_MIN) return onRoute.slice(0, POI_MAX);
  return candidates.slice(0, Math.max(POI_MIN, onRoute.length));
}

/**
 * HTML for the POI layer. Empty string when there is nothing to show.
 * A POI at rest is a small dot; its name appears on hover/focus and the
 * tap opens the detail card, which leads with the name anyway.
 */
export function buildPoiLayerHtml(floorId) {
  return getRoutePois(floorId).map(({ node, p, onRoute }) => {
    const label = getPublicNodeLabel(node);
    return `<button type="button" class="sg-poi${onRoute ? ' is-on-route' : ''}"
      data-code="${esc(node.code)}"
      style="left:${p.x.toFixed(1)}px;top:${p.y.toFixed(1)}px"
      aria-label="${esc(label)} — ver detalhes">
      <span class="sg-poi__dot" aria-hidden="true"></span>
      <span class="sg-poi__label">${esc(label)}</span>
    </button>`;
  }).join('');
}

/**
 * One in-flight fetch per floor however many callers ask at once — a floor
 * switch and the idle preloader routinely race for the same file.
 * mapState.svgBaseCache keeps the RESOLVED markup, so the synchronous first
 * paint has something to render.
 */
const floorPlanCache = createSvgMapCache(floorId => buildBaseFloorSvg(floorId));

/** The plan if it is already here, the empty stage if it is still coming. */
export function peekBaseFloorSvg(floorId) {
  return mapState.svgBaseCache[floorId] ?? baseFloorPlaceholderSvg(floorId);
}

export async function getBaseFloorSvg(floorId) {
  if (mapState.svgBaseCache[floorId]) return mapState.svgBaseCache[floorId];
  const svg = await floorPlanCache.load(floorId);
  mapState.svgBaseCache[floorId] = svg;
  return svg;
}
