import { getPublicNodeLabel } from '../services/nodePresentation.js';
import { appData, mapState, navState, planState } from '../state/appState.js';
import { NAV_VISIBLE_TYPES } from '../app/constants.js';
import { clamp, esc } from '../utils/format.js';
import { findNode, getFloorLabel, getFloorTransform } from '../state/selectors.js';

/* ============================================================
   6. FLOOR MAP BUILDER — Clean semantic map (no technical nodes)

   IMPORTANT: there is no floor plan from the backend. The API returns only
   nodes (code/type/name/x/y/floor); everything drawn here is synthesised
   from those coordinates. So "the SVG" is entirely ours to restyle.

   VISUAL PREMISE — "dark stage, lit route":
   the plan is scenery and the route is the only thing under the spotlight.
   Every decision below follows from that one sentence:
   - The base floor is drawn as GHOST ARCHITECTURE — outlines at alpha
     .06–.10, no fills, no icons, no gate chips. It suggests the building
     without ever competing with the line.
   - The route carries the whole visual budget: stacked glow strokes, a
     gradient that brightens towards the destination, a travelling highlight.
   - Markers are rationed. Origin, destination and the current landmark are
     the only loud things; POIs are 8px dots that only grow when touched.
   - Flat 2D: base, route and POI layers share one coordinate space, so a
     marker at (x,y) sits exactly on the plan at (x,y).
   - Paint lives in CSS: every generated element carries a class and no
     inline fill/stroke, so the map can be re-themed without touching JS.
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

  /* GHOST PLAN ONLY.
     Vertical connections and gate chips used to be drawn here — dozens of
     discs and labelled boxes scattered over the whole floor, all at the same
     visual weight as everything else. That is exactly the noise the "dark
     stage" premise removes: the lifts and stairs the traveller actually has
     to use are on the route, and the route overlay marks those. Anything
     else was decoration competing with the line. */

  return `<svg
    viewBox="0 0 ${MAP_W} ${MAP_H}"
    class="sg-map-svg sg-map-base"
    aria-hidden="true"
    style="overflow:visible"
  >
    <!-- Background: transparent on purpose, so the radial "stage" gradient
         painted on .sg-map-area shows through and keeps covering the map
         when the user pans past the edge of the 900x600 plan. -->
    <rect class="sg-map__bg" width="${MAP_W}" height="${MAP_H}"/>

    <!-- Terminal body: contour only -->
    <rect class="sg-map__terminal" x="${tX.toFixed(1)}" y="${tY.toFixed(1)}"
      width="${tW.toFixed(1)}" height="${tH.toFixed(1)}" rx="28"/>

    <!-- Zone areas: contour only -->
    ${zones.map(z =>
      `<rect class="sg-map__zone" x="${z.x.toFixed(1)}" y="${z.y.toFixed(1)}" width="${z.w.toFixed(1)}" height="${z.h.toFixed(1)}" rx="16"/>`
    ).join('')}

    <!-- Zone divider lines (barely there — a hint of structure) -->
    ${Array.from({ length: 3 }, (_, i) => {
      const baseX = MAP_PAD + ((i + 1) * xRange / bounds.w) * (MAP_W - MAP_PAD * 2);
      return `<line class="sg-map__divider" x1="${baseX.toFixed(1)}" y1="${(tY + 26).toFixed(1)}" x2="${baseX.toFixed(1)}" y2="${(tY + tH - 26).toFixed(1)}"/>`;
    }).join('')}

    <!-- Floor label watermark -->
    <text class="sg-map__watermark" x="${(MAP_W / 2).toFixed(1)}" y="${(tY + tH - 18).toFixed(1)}" text-anchor="middle" aria-hidden="true">${esc(getFloorLabel(floorId))}</text>
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
 *
 * LEFT is tried before right, and that ordering is deliberate: the floor
 * and recentre FABs float over the right edge of the map on every screen
 * size. This placer works in map units and cannot see them, so a caption
 * that defaults rightwards slides under the controls and gets chopped —
 * which is exactly what "Você está aqui" did on a phone. Going left first
 * costs nothing when there is room on both sides, and avoids the only
 * fixed obstacle on screen when there is not.
 */
const ANCHORS = [
  [-1,  0], [ 1,  0], [ 0, -1], [ 0,  1],
  [-1, -1], [ 1, -1], [-1,  1], [ 1,  1],
];

/**
 * Greedy placer. Items are laid out most-important-first; each one tries
 * every anchor, then a shortened single-line form, and is dropped entirely
 * if nothing fits — the marker itself still carries the meaning, which is
 * far better than two captions printed on top of each other.
 *
 * @param {Array} items   { x, y, lines, priority, cls, radius }
 * @param {Array} blocked keep-out rects for the markers themselves
 * @returns {Array} placed { box, lines, cls } — geometry only, no markup
 */
export function placeLabels(items, blocked = []) {
  const taken = [...blocked];
  const placed = [];

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
    placed.push({ box: chosen, lines: chosenLines, cls: item.cls });
  });

  return placed;
}

/* ── CAPTION LAYER (HTML) ──────────────────────────────────────
   Captions used to be <rect> + <text> inside the route SVG. They are now
   HTML in their own layer, for one reason: `backdrop-filter` is what makes
   a glass capsule read as glass, and it does not work on SVG shapes. The
   layer is the same 900x600 box as the viewBox, so the geometry computed by
   placeLabels() drops straight in as left/top/width pixels.

   The dark rgba background is deliberately opaque enough to stand on its
   own: where backdrop-filter is unsupported the capsule is still a solid
   navy pill and the white text still clears AA.
   ────────────────────────────────────────────────────────────── */

/**
 * The floor/recentre FABs as a keep-out rect in MAP units.
 *
 * placeLabels works in map space and has no idea the controls exist, so a
 * caption anchored near the right edge slides under them — "Você está aqui"
 * did exactly that whenever the fit put the origin over on that side. The
 * FABs are screen-space, so their box has to be projected back through the
 * live pan/zoom, inverting the same equation mapFit.js documents:
 *
 *     screenX = wrapperW/2 + tx + (mapX - MAP_W/2) * scale
 *
 * Returns null when there is nothing to measure (no DOM, no controls, or a
 * degenerate transform), in which case captions simply place as before.
 * The rect is a snapshot for the current frame: captions are laid out for
 * the view the fit just produced, and re-laid out on the next step.
 */
function controlsKeepOut(floorId) {
  if (typeof document === 'undefined') return null;
  const wrapper = document.getElementById('map-wrapper');
  const fabs    = document.querySelector('.sg-map-fabs');
  if (!wrapper || !fabs) return null;

  const w = wrapper.getBoundingClientRect();
  const f = fabs.getBoundingClientRect();
  if (!w.width || !w.height || f.left >= w.right) return null;

  const { x: tx, y: ty, scale } = getFloorTransform(floorId);
  if (!scale) return null;

  const toMapX = sx => (sx - w.width  / 2 - tx) / scale + MAP_W / 2;
  const toMapY = sy => (sy - w.height / 2 - ty) / scale + MAP_H / 2;

  const pad = 10;   // screen px of breathing room around the controls
  const x1 = toMapX(f.left - w.left - pad);
  const y1 = toMapY(f.top  - w.top  - pad);
  // Out to the right edge of the frame: everything past the controls is
  // just as unusable as the strip beneath them.
  const x2 = toMapX(w.width);
  const y2 = toMapY(f.bottom - w.top + pad);

  return { x: x1, y: y1, w: Math.max(0, x2 - x1), h: Math.max(0, y2 - y1) };
}

/** Captions for the visible floor, already collision-resolved. */
export function buildLabelLayerHtml(floorId) {
  const route = navState.route;
  if (!route) return '';

  const bounds = getFloorBounds(floorId);
  const toSvg  = n => nodeToSvg(n, bounds);

  const originNode = findNode(planState.originCode);
  const destNode   = findNode(planState.destinationCode);
  const originPt = originNode?.floorId === floorId ? toSvg(originNode) : null;
  const destPt   = destNode?.floorId   === floorId ? toSvg(destNode)   : null;

  const curStep  = navState.semanticSteps[navState.activeStepIndex];
  const curLandmark = curStep?.landmarkCode ? findNode(curStep.landmarkCode) : null;
  const showCurLandmark = curLandmark?.floorId === floorId &&
    curLandmark.code !== planState.destinationCode &&
    curLandmark.code !== planState.originCode;

  // POI dots share this coordinate space, so they are obstacles too —
  // otherwise a caption lands on top of one and neither is readable.
  const blocked = getRoutePois(floorId).map(({ p }) => ({ x: p.x - 12, y: p.y - 12, w: 24, h: 24 }));
  const controls = controlsKeepOut(floorId);
  if (controls) blocked.push(controls);
  const items = [];

  if (destPt) {
    items.push({ x: destPt.x, y: destPt.y - 20, radius: 18, priority: 3,
      cls: 'sg-map-label--dest', lines: [getPublicNodeLabel(destNode), 'Seu destino'] });
    blocked.push({ x: destPt.x - 14, y: destPt.y - 36, w: 28, h: 38 });
  }
  if (originPt) {
    items.push({ x: originPt.x, y: originPt.y, radius: 20, priority: 2,
      cls: 'sg-map-label--here', lines: ['Você está aqui', getPublicNodeLabel(originNode)] });
    blocked.push({ x: originPt.x - 18, y: originPt.y - 18, w: 36, h: 36 });
  }
  if (showCurLandmark && curLandmark) {
    const p = toSvg(curLandmark);
    items.push({ x: p.x, y: p.y - 20, radius: 16, priority: 1,
      cls: 'sg-map-label--step', lines: [getPublicNodeLabel(curLandmark)] });
    blocked.push({ x: p.x - 13, y: p.y - 33, w: 26, h: 35 });
  }

  return placeLabels(items, blocked).map(({ box, lines, cls }) => `
    <div class="sg-map-label ${cls}" style="left:${box.x.toFixed(1)}px;top:${box.y.toFixed(1)}px;width:${box.w.toFixed(1)}px">
      ${lines.map((l, i) => `<span class="sg-map-label__text ${i === 0 ? 'is-title' : 'is-sub'}">${esc(l)}</span>`).join('')}
    </div>`).join('');
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
   * Route stroke stack: three soft halo passes → body → bright core.
   *
   * No SVG filter anywhere. feGaussianBlur over a route this long, inside a
   * container the user can zoom to 8x, is genuinely expensive — it repaints
   * the whole blurred region every pan frame and was locking up the renderer
   * under test. Stacked translucent strokes give the same neon bloom for the
   * cost of ordinary path painting, and they survive zooming.
   *
   * pathLength="100" normalises every leg to a 0–100 dash space. That is
   * what lets one CSS keyframe draw a 90-unit leg and a 900-unit leg in the
   * same 800ms, and what keeps the travelling highlight the same visual
   * length on a short leg as on a long one.
   */
  const routeLine = (pts, state, { flow = false } = {}) => {
    const pl = `points="${poly(pts)}" pathLength="100"`;
    return `
    <polyline class="sg-route__halo is-${state}" ${pl}/>
    <polyline class="sg-route__halo2 is-${state}" ${pl}/>
    <polyline class="sg-route__halo3 is-${state}" ${pl}/>
    <polyline class="sg-route__line is-${state}" ${pl}/>
    <polyline class="sg-route__core is-${state}" ${pl}/>
    ${flow ? `<polyline class="sg-route__flow" ${pl}/>` : ''}`;
  };

  /* Gradient along the direction of travel: cooler and softer at "you",
     brightest at the destination, so the line itself points forward. Drawn
     in user space between the two ends of this floor's path — a gradient in
     objectBoundingBox units would flip direction whenever the route happened
     to run right-to-left. */
  const floorPts = floorCodes.map(c => { const n = findNode(c); return n ? toSvg(n) : null; }).filter(Boolean);
  const gA = floorPts[0] ?? { x: 0, y: 0 };
  const gB = floorPts[floorPts.length - 1] ?? { x: MAP_W, y: MAP_H };

  /** No drawable active leg → the road ahead carries the full treatment. */
  const upcomingIsLead = activePts.length < 2 && upcomingPts.length > 1;

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

      <!-- Wider, warmer halo for the destination — it has to win the map. -->
      <radialGradient id="sgHaloDest">
        <stop offset="25%" stop-color="#7FE3FF" stop-opacity=".50"/>
        <stop offset="60%" stop-color="#29ABE2" stop-opacity=".22"/>
        <stop offset="100%" stop-color="#29ABE2" stop-opacity="0"/>
      </radialGradient>

      <!-- Direction-of-travel gradient (see routeLine above) -->
      <linearGradient id="sgRouteGrad" gradientUnits="userSpaceOnUse"
        x1="${gA.x.toFixed(1)}" y1="${gA.y.toFixed(1)}"
        x2="${gB.x.toFixed(1)}" y2="${gB.y.toFixed(1)}">
        <stop offset="0%"   stop-color="#3F9FCE"/>
        <stop offset="45%"  stop-color="#29ABE2"/>
        <stop offset="100%" stop-color="#6FE0FF"/>
      </linearGradient>
    </defs>

    <!-- Completed route (dimmed, already walked) -->
    ${completedPts.length > 1 ? routeLine(completedPts, 'completed') : ''}

    <!-- Upcoming route.

         When the current step covers a single node — which is exactly what
         the FIRST step usually is ("Passe por Porta 3", one point) — there
         is no active leg to be dominant, and the whole line was rendering
         in the dim upcoming treatment. The opening frame of the navigation,
         the one moment the route has to look like the subject, was the one
         frame where it looked switched off. With no active leg to contrast
         against, what is ahead IS the route: promote it. -->
    ${upcomingPts.length > 1
      ? routeLine(upcomingPts, upcomingIsLead ? 'active' : 'upcoming', { flow: upcomingIsLead })
      : ''}

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

    <!-- Route-relevant landmarks (vertical connections, doors on route).

         Every marker below is an OUTER group carrying the translate as an
         attribute, wrapping an INNER group that the entrance animation
         scales. They cannot be the same element: a CSS transform on the
         group would override the translate attribute outright and every
         marker would pop in from the map's top-left corner. -->
    ${visibleLandmarks.map(n => {
      const p = toSvg(n);
      return `<g class="sg-route-mark" aria-label="${esc(getPublicNodeLabel(n))}"
        transform="translate(${p.x.toFixed(1)},${p.y.toFixed(1)})">
        <g class="sg-pop">
          <circle class="sg-route-mark__ring" r="5.5"/>
          <circle class="sg-route-mark__core" r="2.4"/>
        </g>
      </g>`;
    }).join('')}

    <!-- Current step landmark -->
    ${showCurLandmark && curLandmark ? (() => {
      const p = toSvg(curLandmark);
      return `<g class="sg-map-step" aria-label="Ponto atual: ${esc(getPublicNodeLabel(curLandmark))}"
        transform="translate(${p.x.toFixed(1)},${p.y.toFixed(1)})">
        <g class="sg-pop">${mapPin(0, 0, 'sg-map-pin--step')}</g>
      </g>` ;
    })() : ''}

    <!-- Destination: glowing pin, the end of the light -->
    ${destPt ? `<g class="sg-map-dest" aria-label="Destino: ${esc(getPublicNodeLabel(destNode))}"
      transform="translate(${destPt.x.toFixed(1)},${destPt.y.toFixed(1)})">
      <circle class="sg-map-dest__glow" r="34"/>
      <g class="sg-pop">
        <circle class="sg-map-dest__halo" r="20"/>
        ${mapPin(0, 0, 'sg-map-pin--dest')}
      </g>
    </g>` : ''}

    <!-- "Você está aqui": pulsing turquoise dot with two radar waves -->
    ${originPt ? `<g class="sg-map-here" aria-label="Você está aqui: ${esc(getPublicNodeLabel(originNode))}"
      transform="translate(${originPt.x.toFixed(1)},${originPt.y.toFixed(1)})">
      <circle class="sg-map-here__wave" r="13"/>
      <circle class="sg-map-here__wave sg-map-here__wave--2" r="13"/>
      <circle class="sg-map-here__halo" r="26"/>
      <g class="sg-pop">
        <circle class="sg-map-here__dot" r="8.5"/>
        <circle class="sg-map-here__center" r="3.2"/>
      </g>
    </g>` : ''}

    <!-- Captions are NOT here: they live in the HTML label layer, where a
         glass capsule can actually be glass. See buildLabelLayerHtml(). -->
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
/**
 * Hard ceiling on visible POIs. Was 10 with a 78-unit catchment, which put
 * a labelled icon roughly every centimetre of route on a phone — the exact
 * "generic, cluttered map" this redesign exists to kill. The route is the
 * subject; POIs are a footnote you can tap.
 */
const POI_MAX = 6;
/** Below this many POIs literally on the path, top up with nearby ones. */
const POI_MIN = 3;

/**
 * POIs worth offering on this floor. Places the route physically passes
 * through come first and are usually the whole list; only when there are
 * barely any of those do nearby places get pulled in, so the map stays
 * quiet on a dense floor instead of filling up to the cap every time.
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

  const candidates = appData.nodes
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
    .sort((a, b) => (b.onRoute - a.onRoute) || (a.dist - b.dist));

  const onRoute = candidates.filter(poi => poi.onRoute);
  // Enough places directly on the path: show only those, nothing else.
  if (onRoute.length >= POI_MIN) return onRoute.slice(0, POI_MAX);
  // Sparse route: top up with the nearest few so "no seu caminho" still has
  // something to offer, but stop well short of the cap.
  return candidates.slice(0, Math.max(POI_MIN, onRoute.length));
}

/**
 * HTML for the POI layer. Empty string when there is nothing to show.
 *
 * A POI at rest is an 8px dot — no category icon, no caption. The icon used
 * to be a 26px turquoise disc with a glyph, which at six-plus per screen
 * read louder than the route itself. The glyph is not lost: it leads the
 * detail card that opens on tap, where there is room to actually see it.
 * The accessible name lives on the button, so a screen reader still hears
 * the full place name that the eye no longer has to filter out.
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

export function getBaseFloorSvg(floorId) {
  if (!mapState.svgBaseCache[floorId]) {
    mapState.svgBaseCache[floorId] = buildBaseFloorSvg(floorId);
  }
  return mapState.svgBaseCache[floorId];
}

