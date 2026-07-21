import { getPublicNodeLabel } from '../services/nodePresentation.js';
import { appData, mapState, navState, planState } from '../state/appState.js';
import { NAV_VISIBLE_TYPES, getNodeMeta } from '../app/constants.js';
import { clamp, esc } from '../utils/format.js';
import { findNode, getFloorLabel } from '../state/selectors.js';

/* ============================================================
   6. FLOOR MAP BUILDER — Clean semantic map (no technical nodes)

   IMPORTANT: there is no floor plan from the backend. The API returns only
   nodes (code/type/name/x/y/floor); everything drawn here is synthesised
   from those coordinates. So "the SVG" is entirely ours to restyle.

   Visual design (navigation theme):
   - Flat 2D: base and route share one coordinate space, so the route and
     the POIs sit exactly on the plan (no perspective tilt).
   - Dark navy background, terminal body barely lighter — the plan is
     context, the route is the subject.
   - Paint lives in CSS: every generated element carries a class and no
     inline fill/stroke, so the map can be re-themed without touching JS.
   - No corridor dots, no waypoint circles, no internal labels
   ============================================================ */

export const MAP_W = 900, MAP_H = 600;
export const MAP_PAD = 48; // internal padding

export function getFloorBounds(floorId) {
  const ns = appData.nodes.filter(n => n.floorId === floorId && (n.x || n.y));
  if (!ns.length) return { minX: 0, maxX: 100, minY: 0, maxY: 100, w: 100, h: 100 };
  const xs = ns.map(n => n.x), ys = ns.map(n => n.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  return { minX, maxX, minY, maxY, w: maxX - minX || 1, h: maxY - minY || 1 };
}

export function nodeToSvg(node, bounds) {
  return {
    x: MAP_PAD + ((node.x - bounds.minX) / bounds.w) * (MAP_W - MAP_PAD * 2),
    y: MAP_PAD + ((node.y - bounds.minY) / bounds.h) * (MAP_H - MAP_PAD * 2),
  };
}

/**
 * Build the BASE floor SVG — terminal shape + zone areas.
 * This NEVER shows corridor/waypoint nodes.
 * Cached per floorId — rebuilt only when floor data changes.
 */
export function buildBaseFloorSvg(floorId) {
  const allNodes = appData.nodes.filter(n => n.floorId === floorId);
  if (!allNodes.length) {
    return `<svg viewBox="0 0 ${MAP_W} ${MAP_H}" class="sg-map-svg sg-map-base" aria-hidden="true"><rect class="sg-map__bg" width="${MAP_W}" height="${MAP_H}"/></svg>`;
  }

  const bounds = getFloorBounds(floorId);
  const toSvg  = n => nodeToSvg(n, bounds);

  // Terminal outline — hull from all nodes + generous padding
  const termPad = 60;
  const allPts   = allNodes.map(toSvg);
  const xs = allPts.map(p => p.x), ys = allPts.map(p => p.y);
  const tX = Math.min(...xs) - termPad;
  const tY = Math.min(...ys) - termPad;
  const tW = Math.max(...xs) - Math.min(...xs) + termPad * 2;
  const tH = Math.max(...ys) - Math.min(...ys) + termPad * 2;

  // Zone clusters — group POI nodes by area (x-quartile)
  const poiNodes = allNodes.filter(n => n.isPoi && !n.isInternal);

  // Divide into 4 x-bands
  const xRange = bounds.w / 4;
  const zones = Array.from({ length: 4 }, (_, qi) => {
    const band = poiNodes.filter(n => {
      const relX = n.x - bounds.minX;
      return relX >= qi * xRange && relX < (qi + 1) * xRange;
    });
    if (band.length < 2) return null;
    const pts = band.map(toSvg);
    const bxs = pts.map(p => p.x), bys = pts.map(p => p.y);
    const zPad = 28;
    return {
      x: Math.min(...bxs) - zPad, y: Math.min(...bys) - zPad,
      w: Math.max(...bxs) - Math.min(...bxs) + zPad * 2,
      h: Math.max(...bys) - Math.min(...bys) + zPad * 2,
    };
  }).filter(Boolean);

  // Vertical connection symbols (elevator, stairs, escalator) — shown always as small icons
  const verticals = allNodes.filter(n => n.isVertical);

  // Gate labels — show gate codes only (these are meaningful to passengers)
  const gates = allNodes.filter(n => n.type === 'gate');

  // Glyphs for vertical connections: tiny geometric paths, drawn around a
  // local origin. Platform text glyphs (▲ ≡ ╱) rendered inconsistently.
  const VERT_GLYPH = {
    elevator:  'M-2.6 -1.1 0 -3.7 2.6 -1.1M-2.6 1.1 0 3.7 2.6 1.1',
    stairs:    'M-3.4 2.9h2.3V0.6h2.3v-2.3h2.3',
    escalator: 'M-3.4 3 3.4 -3',
  };

  return `<svg
    viewBox="0 0 ${MAP_W} ${MAP_H}"
    class="sg-map-svg sg-map-base"
    aria-hidden="true"
    style="overflow:visible"
  >
    <!-- Background -->
    <rect class="sg-map__bg" width="${MAP_W}" height="${MAP_H}"/>

    <!-- Terminal body -->
    <rect class="sg-map__terminal" x="${tX.toFixed(1)}" y="${tY.toFixed(1)}"
      width="${tW.toFixed(1)}" height="${tH.toFixed(1)}" rx="24"/>

    <!-- Zone areas -->
    ${zones.map(z =>
      `<rect class="sg-map__zone" x="${z.x.toFixed(1)}" y="${z.y.toFixed(1)}" width="${z.w.toFixed(1)}" height="${z.h.toFixed(1)}" rx="14"/>`
    ).join('')}

    <!-- Zone divider lines (very subtle) -->
    ${Array.from({ length: 3 }, (_, i) => {
      const baseX = MAP_PAD + ((i + 1) * xRange / bounds.w) * (MAP_W - MAP_PAD * 2);
      return `<line class="sg-map__divider" x1="${baseX.toFixed(1)}" y1="${(tY + 20).toFixed(1)}" x2="${baseX.toFixed(1)}" y2="${(tY + tH - 20).toFixed(1)}"/>`;
    }).join('')}

    <!-- Vertical connections (always visible — passengers rely on these) -->
    ${verticals.map(n => {
      const p = toSvg(n);
      const d = VERT_GLYPH[n.type] ?? VERT_GLYPH.stairs;
      // aria-label uses public label — never raw node name
      return `<g class="sg-map__vert" aria-label="${esc(getPublicNodeLabel(n))}"
        transform="translate(${p.x.toFixed(1)},${p.y.toFixed(1)})">
        <circle class="sg-map__vert-disc" r="9"/>
        <path class="sg-map__vert-glyph" d="${d}"/>
      </g>`;
    }).join('')}

    <!-- Gate labels (meaningful to passengers) -->
    ${gates.map(n => {
      const p = toSvg(n);
      const label = n.name.replace(/Portão\s*/i, '').trim() || n.name;
      return `<g class="sg-map__gate" aria-label="Portão ${esc(label)}">
        <rect class="sg-map__gate-chip" x="${(p.x - 14).toFixed(1)}" y="${(p.y - 8).toFixed(1)}" width="28" height="16" rx="4"/>
        <text class="sg-map__gate-label" x="${p.x.toFixed(1)}" y="${p.y.toFixed(1)}" dy="0.37em" text-anchor="middle">${esc(label.length > 6 ? label.slice(0, 6) : label)}</text>
      </g>`;
    }).join('')}

    <!-- Floor label watermark -->
    <text class="sg-map__watermark" x="${(MAP_W / 2).toFixed(1)}" y="${(tY + tH - 14).toFixed(1)}" text-anchor="middle" aria-hidden="true">${esc(getFloorLabel(floorId))}</text>
  </svg>`;
}

/** Teardrop map pin whose tip sits exactly on (x, y). */
export function mapPin(x, y, cls = '') {
  return `<g class="sg-map-pin ${cls}" transform="translate(${x.toFixed(1)},${y.toFixed(1)})">
    <path class="sg-map-pin__body" d="M0 0c-6.6-9.2-11.2-14.5-11.2-19.8a11.2 11.2 0 0 1 22.4 0C11.2-14.5 6.6-9.2 0 0z"/>
    <circle class="sg-map-pin__core" cy="-19.8" r="4.8"/>
  </g>`;
}

/* ── LABEL LAYOUT ──────────────────────────────────────────────
   mapLabel() used to place every caption independently, so the origin and
   destination boxes happily landed on top of each other whenever the two
   nodes were close — the unreadable stacked text. Captions now go through
   one layout pass that knows about every box and every marker.
   ────────────────────────────────────────────────────────────── */

// charW is a deliberate slight over-estimate of Inter's average advance at
// 12.5px: the box is sized from character count, so erring narrow would clip.
const LBL = { padX: 12, lineH: 17, padY: 9, charW: 7.05, gap: 6 };

function labelSize(lines) {
  const widest = Math.max(...lines.map(l => l.length));
  return { w: widest * LBL.charW + LBL.padX * 2, h: lines.length * LBL.lineH + LBL.padY * 2 };
}

function overlaps(a, b, m = LBL.gap) {
  return a.x - m < b.x + b.w && a.x + a.w + m > b.x &&
         a.y - m < b.y + b.h && a.y + a.h + m > b.y;
}

/**
 * Anchor offsets tried in order, as [dx, dy] of the box centre relative to
 * the marker. Sides first (they read best), then the diagonals.
 */
const ANCHORS = [
  [ 1,  0], [-1,  0], [ 0, -1], [ 0,  1],
  [ 1, -1], [-1, -1], [ 1,  1], [-1,  1],
];

/**
 * Greedy placer. Items are laid out most-important-first; each one tries
 * every anchor, then a shortened single-line form, and is dropped entirely
 * if nothing fits — the marker itself still carries the meaning, which is
 * far better than two captions printed on top of each other.
 *
 * @param {Array} items   { x, y, lines, priority, cls, radius }
 * @param {Array} blocked keep-out rects for the markers themselves
 * @returns {string} SVG
 */
export function layoutLabels(items, blocked = []) {
  const taken = [...blocked];
  const drawn = [];

  [...items].sort((a, b) => b.priority - a.priority).forEach(item => {
    let chosen = null, chosenLines = null;

    // Full caption first; if it cannot fit anywhere, retry with the title only.
    const variants = item.lines.length > 1 ? [item.lines, item.lines.slice(0, 1)] : [item.lines];

    for (const lines of variants) {
      const { w, h } = labelSize(lines);
      const off = (item.radius ?? 14) + LBL.gap;
      for (const [ax, ay] of ANCHORS) {
        const cx = item.x + ax * (off + w / 2);
        const cy = item.y + ay * (off + h / 2);
        const box = {
          x: clamp(cx - w / 2, 2, MAP_W - w - 2),
          y: clamp(cy - h / 2, 2, MAP_H - h - 2),
          w, h,
        };
        if (taken.some(t => overlaps(box, t))) continue;
        chosen = box; chosenLines = lines;
        break;
      }
      if (chosen) break;
    }

    if (!chosen) return;   // nothing fits — drop this caption
    taken.push(chosen);
    drawn.push(renderLabelBox(chosen, chosenLines, item.cls));
  });

  return drawn.join('');
}

function renderLabelBox(box, lines, cls = '') {
  return `<g class="sg-map-label ${cls}">
    <rect class="sg-map-label__box" x="${box.x.toFixed(1)}" y="${box.y.toFixed(1)}"
      width="${box.w.toFixed(1)}" height="${box.h.toFixed(1)}" rx="9"/>
    ${lines.map((l, i) => `<text class="sg-map-label__text ${i === 0 ? 'is-title' : 'is-sub'}"
      x="${(box.x + LBL.padX).toFixed(1)}"
      y="${(box.y + LBL.padY + LBL.lineH * i + LBL.lineH / 2).toFixed(1)}"
      dy="0.35em">${esc(l)}</text>`).join('')}
  </g>`;
}

/**
 * Build the ROUTE OVERLAY SVG — shown over the base map.
 * Updated per step without touching the base.
 * Filters: only show origin, dest, doors/elevators ON route, current landmark.
 */
export function buildRouteOverlaySvg(floorId) {
  const route = navState.route;
  if (!route) return '<svg class="sg-map-svg sg-map-route" aria-hidden="true"></svg>';

  const bounds    = getFloorBounds(floorId);
  const toSvg     = n => nodeToSvg(n, bounds);
  const path      = route.path;

  // Get floor-specific codes from segments
  const seg = route.segments?.find(s => s.type === 'floor' && s.floorId === floorId);
  const floorCodes = seg?.nodeCodes?.length ? seg.nodeCodes
    : path.filter(c => findNode(c)?.floorId === floorId);

  if (!floorCodes.length) {
    return `<svg viewBox="0 0 ${MAP_W} ${MAP_H}" class="sg-map-svg sg-map-route" aria-hidden="true"></svg>`;
  }

  // Step range partitioning for coloring
  const stepIdx = navState.activeStepIndex;
  const steps   = navState.semanticSteps;
  const curStep = steps[stepIdx];

  // Partition codes by step state (completed/active/upcoming)
  const floorPathIndices = floorCodes.map(c => path.indexOf(c)).filter(i => i >= 0);
  const minFloorIdx = Math.min(...floorPathIndices);
  const maxFloorIdx = Math.max(...floorPathIndices);

  const activeFrom = curStep?.rawFrom ?? 0;
  const activeTo   = curStep?.rawTo   ?? path.length - 1;

  const getStatus = (pathIdx) => {
    if (pathIdx < activeFrom) return 'completed';
    if (pathIdx <= activeTo)  return 'active';
    return 'upcoming';
  };

  const completedPts = [], activePts = [], upcomingPts = [];
  floorCodes.forEach(code => {
    const pi = path.indexOf(code);
    if (pi < 0) return;
    const n = findNode(code);
    if (!n) return;
    const p = toSvg(n);
    const st = getStatus(pi);
    if (st === 'completed') completedPts.push(p);
    else if (st === 'active') activePts.push(p);
    else upcomingPts.push(p);
  });

  const poly = pts => pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

  // Determine which nodes to show as markers (strict filtering)
  const routeSet = new Set(floorCodes);
  const originNode = findNode(planState.originCode);
  const destNode   = findNode(planState.destinationCode);
  const showOrigin = originNode?.floorId === floorId;
  const showDest   = destNode?.floorId   === floorId;

  // Visible landmarks: only vertical connections + doors/entrances ON the route
  const visibleLandmarks = appData.nodes.filter(n =>
    n.floorId === floorId &&
    routeSet.has(n.code) &&
    NAV_VISIBLE_TYPES.has(n.type) &&
    n.code !== planState.originCode &&
    n.code !== planState.destinationCode
  );

  // Current instruction landmark. Skipped when it IS the origin or the
  // destination — those already have a marker and a caption, and printing
  // the same place name twice is just noise competing for space.
  const curLandmark = curStep?.landmarkCode ? findNode(curStep.landmarkCode) : null;
  const showCurLandmark = curLandmark?.floorId === floorId &&
    curLandmark.code !== planState.destinationCode &&
    curLandmark.code !== planState.originCode;

  /**
   * Route stroke stack: two soft halo passes → body → bright core.
   *
   * No SVG filter anywhere. feGaussianBlur over a route this long, inside a
   * container the user can zoom to 8x, is genuinely expensive — it repaints
   * the whole blurred region every pan frame and was locking up the renderer
   * under test. Stacked translucent strokes give the same soft bloom for the
   * cost of ordinary path painting.
   */
  const routeLine = (pts, state, { flow = false } = {}) => `
    <polyline class="sg-route__halo is-${state}" points="${poly(pts)}"/>
    <polyline class="sg-route__halo2 is-${state}" points="${poly(pts)}"/>
    <polyline class="sg-route__line is-${state}" points="${poly(pts)}"/>
    <polyline class="sg-route__core is-${state}" points="${poly(pts)}"/>
    ${flow ? `<polyline class="sg-route__flow" points="${poly(pts)}"/>` : ''}`;

  // Which points anchor the "you are here" / waypoint / destination markers
  const originPt = showOrigin ? toSvg(originNode) : null;
  const destPt   = showDest   ? toSvg(destNode)   : null;

  return `<svg
    viewBox="0 0 ${MAP_W} ${MAP_H}"
    class="sg-map-svg sg-map-route"
    aria-hidden="true"
    style="overflow:visible"
  >
    <defs>
      <!-- Soft marker halo without a filter: a radial fade costs one gradient
           lookup instead of a full-region blur. -->
      <radialGradient id="sgHalo">
        <stop offset="35%" stop-color="#29ABE2" stop-opacity=".55"/>
        <stop offset="70%" stop-color="#29ABE2" stop-opacity=".18"/>
        <stop offset="100%" stop-color="#29ABE2" stop-opacity="0"/>
      </radialGradient>
    </defs>

    <!-- Completed route (dimmed, already walked) -->
    ${completedPts.length > 1 ? routeLine(completedPts, 'completed') : ''}

    <!-- Upcoming route -->
    ${upcomingPts.length > 1 ? routeLine(upcomingPts, 'upcoming') : ''}

    <!-- Active route segment (dominant) -->
    ${activePts.length > 1 ? routeLine(activePts, 'active', { flow: true })
      : activePts.length === 1 ? `
      <circle class="sg-route__spot" cx="${activePts[0].x.toFixed(1)}" cy="${activePts[0].y.toFixed(1)}" r="6"/>
    ` : ''}

    <!-- Full route fallback (no step data) -->
    ${(!completedPts.length && !activePts.length && !upcomingPts.length && floorCodes.length > 1) ? (() => {
      const allPts = floorCodes.map(c => { const n = findNode(c); return n ? toSvg(n) : null; }).filter(Boolean);
      return allPts.length > 1 ? routeLine(allPts, 'active', { flow: true }) : '';
    })() : ''}

    <!-- Route-relevant landmarks (vertical connections, doors on route) -->
    ${visibleLandmarks.map(n => {
      const p = toSvg(n);
      return `<g class="sg-route-mark" aria-label="${esc(getPublicNodeLabel(n))}"
        transform="translate(${p.x.toFixed(1)},${p.y.toFixed(1)})">
        <circle class="sg-route-mark__ring" r="6.5"/>
        <circle class="sg-route-mark__core" r="3"/>
      </g>`;
    }).join('')}

    <!-- Current step landmark -->
    ${showCurLandmark && curLandmark ? (() => {
      const p = toSvg(curLandmark);
      return `<g aria-label="Ponto atual: ${esc(getPublicNodeLabel(curLandmark))}">
        ${mapPin(p.x, p.y, 'sg-map-pin--step')}
      </g>`;
    })() : ''}

    <!-- Destination: filled pin -->
    ${destPt ? `<g class="sg-map-dest" aria-label="Destino: ${esc(getPublicNodeLabel(destNode))}">
      <circle class="sg-map-dest__halo" cx="${destPt.x.toFixed(1)}" cy="${destPt.y.toFixed(1)}" r="22"/>
      ${mapPin(destPt.x, destPt.y, 'sg-map-pin--dest')}
    </g>` : ''}

    <!-- "Você está aqui": pulsing turquoise dot + halo -->
    ${originPt ? `<g class="sg-map-here" aria-label="Você está aqui: ${esc(getPublicNodeLabel(originNode))}"
      transform="translate(${originPt.x.toFixed(1)},${originPt.y.toFixed(1)})">
      <circle class="sg-map-here__pulse" r="15"/>
      <circle class="sg-map-here__halo" r="24"/>
      <circle class="sg-map-here__dot" r="9"/>
      <circle class="sg-map-here__center" r="3.4"/>
    </g>` : ''}

    <!-- Captions last: one layout pass, so no two boxes can ever collide -->
    ${(() => {
      // POI dots live in a separate HTML layer but share this coordinate
      // space, so they have to be obstacles here too — otherwise a caption
      // happily lands underneath them and the text is unreadable again.
      const blocked = getRoutePois(floorId).map(({ p }) => ({ x: p.x - 15, y: p.y - 15, w: 30, h: 30 }));
      const items = [];
      if (destPt) {
        items.push({ x: destPt.x, y: destPt.y - 20, radius: 16, priority: 3,
          cls: 'sg-map-label--dest', lines: [getPublicNodeLabel(destNode), 'Seu destino'] });
        blocked.push({ x: destPt.x - 13, y: destPt.y - 33, w: 26, h: 35 });
      }
      if (originPt) {
        items.push({ x: originPt.x, y: originPt.y, radius: 19, priority: 2,
          cls: 'sg-map-label--here', lines: ['Você está aqui', getPublicNodeLabel(originNode)] });
        blocked.push({ x: originPt.x - 17, y: originPt.y - 17, w: 34, h: 34 });
      }
      if (showCurLandmark && curLandmark) {
        const p = toSvg(curLandmark);
        items.push({ x: p.x, y: p.y - 20, radius: 16, priority: 1,
          cls: 'sg-map-label--step', lines: [getPublicNodeLabel(curLandmark)] });
        blocked.push({ x: p.x - 13, y: p.y - 33, w: 26, h: 35 });
      }
      return layoutLabels(items, blocked);
    })()}
  </svg>`;
}

/* ── POIs ALONG THE ROUTE ──────────────────────────────────────
   Rendered as HTML, not SVG, in their own layer. The layer is exactly the
   same 900x600 box as the SVG viewBox, so 1 SVG unit == 1 CSS px and the
   markers land precisely on the plan. HTML buys us real <button>s (focus,
   aria-label, comfortable tap targets) and <iconify-icon> for the category
   glyph, which cannot be used inside an SVG document.
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

/** How close to the line a POI has to be to count as "on the way". */
export const POI_NEAR_UNITS = 78;
const POI_MAX = 10;

/**
 * POIs worth offering on this floor: real businesses/services near the
 * route, nearest first, capped so the map never turns into a pin cushion.
 * Origin, destination and vertical connections are excluded — they already
 * have their own, louder markers.
 */
export function getRoutePois(floorId) {
  const route = navState.route;
  if (!route) return [];

  const bounds = getFloorBounds(floorId);
  const toSvg  = n => nodeToSvg(n, bounds);

  const seg = route.segments?.find(s => s.type === 'floor' && s.floorId === floorId);
  const floorCodes = seg?.nodeCodes?.length ? seg.nodeCodes
    : route.path.filter(c => findNode(c)?.floorId === floorId);
  const linePts = floorCodes.map(c => findNode(c)).filter(Boolean).map(toSvg);
  if (linePts.length < 2) return [];

  const routeSet = new Set(floorCodes);

  return appData.nodes
    .filter(n =>
      n.floorId === floorId &&
      n.isPoi && !n.isInternal && !n.isVertical &&
      n.code !== planState.originCode &&
      n.code !== planState.destinationCode)
    .map(n => {
      const p = toSvg(n);
      return { node: n, p, onRoute: routeSet.has(n.code), dist: distToPolyline(p, linePts) };
    })
    .filter(poi => poi.onRoute || poi.dist <= POI_NEAR_UNITS)
    .sort((a, b) => (b.onRoute - a.onRoute) || (a.dist - b.dist))
    .slice(0, POI_MAX);
}

/** HTML for the POI layer. Empty string when there is nothing to show. */
export function buildPoiLayerHtml(floorId) {
  return getRoutePois(floorId).map(({ node, p, onRoute }) => {
    const label = getPublicNodeLabel(node);
    const meta  = getNodeMeta(node.type);
    return `<button type="button" class="sg-poi${onRoute ? ' is-on-route' : ''}"
      data-code="${esc(node.code)}"
      style="left:${p.x.toFixed(1)}px;top:${p.y.toFixed(1)}px"
      aria-label="${esc(label)} — ver detalhes">
      <span class="sg-poi__dot" aria-hidden="true"><iconify-icon icon="${esc(meta.icon)}"></iconify-icon></span>
      <span class="sg-poi__label">${esc(label)}</span>
    </button>`;
  }).join('');
}

export function getBaseFloorSvg(floorId) {
  if (!mapState.svgBaseCache[floorId]) {
    mapState.svgBaseCache[floorId] = buildBaseFloorSvg(floorId);
  }
  return mapState.svgBaseCache[floorId];
}

