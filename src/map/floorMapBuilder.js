import { getPublicNodeLabel } from '../services/nodePresentation.js';
import { appData, mapState, navState, planState } from '../state/appState.js';
import { NAV_VISIBLE_TYPES } from '../app/constants.js';
import { clamp, esc } from '../utils/format.js';
import { findNode, getFloorLabel, getFloorTransform } from '../state/selectors.js';
import { createSvgMapCache } from './svgMapCache.js';

/* ============================================================
   6. FLOOR MAP BUILDER — the real floor plan, with the route over it

   THE PLAN IS REAL NOW. assets/floors/{floorId}.svg is the architectural
   drawing of that level, exported on a 3740x1800 viewBox — the SAME space
   the API reports node x/y in. Nothing is synthesised any more and nothing
   is re-scaled: a node at (2263.88, 942.59) is drawn at (2263.88, 942.59)
   and lands on the door the plan draws there.

   That is the whole reason nodeToSvg() is the identity function. It used to
   re-normalise each floor's node cloud into 900x600 with its own bounding
   box, which gave every floor a DIFFERENT scale (floor 2 shrank to 0.27x,
   floor 3 was blown up 4.15x) and made alignment with any real plan
   impossible by construction.

   One consequence worth stating: map units are now physical. 1 unit is
   APP_CONFIG.distance.metersPerUnit (0.38 m) on every floor, so a constant
   expressed in units below is a real distance, not an arbitrary number.

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

/** The floor plans' own viewBox. Node x/y are already in this space. */
export const MAP_W = 3740, MAP_H = 1800;

/**
 * Everything drawn in map units — pins, marker rings, caption boxes — is
 * multiplied by this so it keeps its old ON-SCREEN size in the new space.
 *
 * It is 1.7, not the 4.15 the canvas grew by, and the difference matters.
 * The old code fitted each floor's node cloud into 900x600 separately, so
 * the drawn scale was never 900/3740; measured against the live API it was
 * 0.61 on floor 0, 0.58 on floor 1, 0.27 on floor 2 and 4.15 on floor 3.
 * 1/0.6 ≈ 1.7 reproduces what floors 0 and 1 — where a journey starts —
 * looked like before, and gives every floor that same honest scale instead
 * of four different ones. See the note in mapFit.js on the framing.
 */
export const MARK_SCALE = 1.7;

/** Round to one decimal; SVG output never needs more. */
const u = n => (n * MARK_SCALE).toFixed(1);

/**
 * The node represented by the passenger's manually confirmed active step.
 * This is route progress, not an indoor-positioning claim.
 */
export function getCurrentRouteNode() {
  const path = navState.route?.path ?? [];
  const step = navState.semanticSteps[navState.activeStepIndex];
  const rawIndex = Number(step?.rawFrom);
  const pathIndex = path.length
    ? clamp(Number.isFinite(rawIndex) ? rawIndex : 0, 0, path.length - 1)
    : 0;
  const code = step?.landmarkCode || path[pathIndex] || planState.originCode;
  return findNode(code) ?? findNode(planState.originCode);
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
 * Project a node into the map's coordinate space — which is now the plan's
 * own space, so this is the identity.
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

/* -- THE FLOOR PLAN ------------------------------------------------
   assets/floors/{floorId}.svg, fetched once per floor and INLINED.

   Inlined rather than <image href> or a CSS background for one reason: the
   plan is a full-colour Figma export and this screen is a dark stage. Only
   real DOM can be re-themed, and .sg-map__plan in navigation.css is where
   that happens. An <image> would be an opaque bitmap the theme cannot reach
   into.
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
 * broken screen — the route overlay, the POIs and the captions live in
 * separate layers and stay usable without the scenery behind them.
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

/** Teardrop map pin whose tip sits exactly on (x, y). */
export function mapPin(x, y, cls = '') {
  // The tip is at the group's own origin, so scaling about it leaves the tip
  // exactly on (x, y) — the one property this shape has to keep.
  return `<g class="sg-map-pin ${cls}" transform="translate(${x.toFixed(1)},${y.toFixed(1)}) scale(${MARK_SCALE})">
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
// All five are map units, so they carry MARK_SCALE like every other drawn
// dimension, and the caption CSS in navigation.css is scaled to match.
const LBL = {
  padX: 12 * MARK_SCALE,
  lineH: 17 * MARK_SCALE,
  padY: 9 * MARK_SCALE,
  charW: 7.05 * MARK_SCALE,
  gap: 6 * MARK_SCALE,
};

function labelSize(lines) {
  const widest = Math.max(...lines.map(l => l.length));
  return { w: widest * LBL.charW + LBL.padX * 2, h: lines.length * LBL.lineH + LBL.padY * 2 };
}

function overlaps(a, b, m = LBL.gap) {
  return a.x - m < b.x + b.w && a.x + a.w + m > b.x &&
         a.y - m < b.y + b.h && a.y + a.h + m > b.y;
}

const FULL_MAP_LABEL_FRAME = Object.freeze({ x: 2, y: 2, w: MAP_W - 4, h: MAP_H - 4 });

/**
 * Anchor order adapts to the marker's position in the visible frame. The
 * first horizontal and vertical choices always point inwards; on a narrow
 * frame a vertical anchor comes first because a capsule is much wider than
 * it is tall. This avoids solving a right-edge collision by moving the same
 * overflowing box to the left edge.
 */
function anchorsFor(item, frame, boxW, offset) {
  const inwardX = item.x <= frame.x + frame.w / 2 ? 1 : -1;
  const inwardY = item.y <= frame.y + frame.h / 2 ? 1 : -1;
  const horizontal = [inwardX, 0];
  const vertical = [0, inwardY];
  const axial = frame.w < (boxW + offset) * 2
    ? [vertical, horizontal, [0, -inwardY], [-inwardX, 0]]
    : [horizontal, vertical, [0, -inwardY], [-inwardX, 0]];
  return [
    ...axial,
    [inwardX, inwardY], [-inwardX, inwardY],
    [inwardX, -inwardY], [-inwardX, -inwardY],
  ];
}

/**
 * Greedy placer. Items are laid out most-important-first; each one tries
 * every anchor, then a shortened single-line form, and is dropped entirely
 * if nothing fits — the marker itself still carries the meaning, which is
 * far better than two captions printed on top of each other.
 *
 * @param {Array} items   { x, y, lines, priority, cls, radius }
 * @param {Array} blocked keep-out rects for the markers themselves
 * @param {{x:number,y:number,w:number,h:number}} frame visible map-space box
 * @returns {Array} placed { box, lines, cls } — geometry only, no markup
 */
export function placeLabels(items, blocked = [], frame = FULL_MAP_LABEL_FRAME) {
  const viewport = frame?.w > 0 && frame?.h > 0 ? frame : FULL_MAP_LABEL_FRAME;
  const taken = [...blocked];
  const placed = [];

  [...items].sort((a, b) => b.priority - a.priority).forEach(item => {
    let chosen = null, chosenLines = null;

    // Full caption first; if it cannot fit anywhere, retry with the title only.
    const variants = item.lines.length > 1 ? [item.lines, item.lines.slice(0, 1)] : [item.lines];

    for (const lines of variants) {
      const { w, h } = labelSize(lines);
      if (w > viewport.w || h > viewport.h) continue;
      const off = (item.radius ?? 14 * MARK_SCALE) + LBL.gap;
      for (const [ax, ay] of anchorsFor(item, viewport, w, off)) {
        const cx = item.x + ax * (off + w / 2);
        const cy = item.y + ay * (off + h / 2);
        const box = {
          x: clamp(cx - w / 2, viewport.x, viewport.x + viewport.w - w),
          y: clamp(cy - h / 2, viewport.y, viewport.y + viewport.h - h),
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
   layer is the same 3740x1800 box as the viewBox, so the geometry computed by
   placeLabels() drops straight in as left/top/width pixels.

   The dark rgba background is deliberately opaque enough to stand on its
   own: where backdrop-filter is unsupported the capsule is still a solid
   navy pill and the white text still clears AA.
   ────────────────────────────────────────────────────────────── */

/**
 * The floor/recentre FABs as a keep-out rect in MAP units.
 *
 * placeLabels works in map space and has no idea the controls exist, so a
 * caption anchored near the right edge slides under them — the active step
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
  const wrapper = document.querySelector('#navigation-panel.sg-map-wrapper');
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

/**
 * The wrapper's currently visible rectangle projected back into map space.
 * Auto-fit often shows only a small slice of the 3740x1800 canvas; clamping a
 * caption to the whole canvas can therefore leave it correctly "on the map"
 * but visibly cut off by the wrapper. Eight screen pixels remain as a stable
 * edge gap regardless of zoom.
 */
function visibleMapFrame(floorId) {
  if (typeof document === 'undefined') return null;
  const wrapper = document.querySelector('#navigation-panel.sg-map-wrapper');
  if (!wrapper) return null;

  const w = wrapper.getBoundingClientRect();
  const { x: tx, y: ty, scale } = getFloorTransform(floorId);
  if (!w.width || !w.height || !Number.isFinite(scale) || scale <= 0) return null;

  const toMapX = sx => (sx - w.width  / 2 - tx) / scale + MAP_W / 2;
  const toMapY = sy => (sy - w.height / 2 - ty) / scale + MAP_H / 2;
  const edge = 8;
  const x1 = Math.max(FULL_MAP_LABEL_FRAME.x, toMapX(edge));
  const y1 = Math.max(FULL_MAP_LABEL_FRAME.y, toMapY(edge));
  const x2 = Math.min(FULL_MAP_LABEL_FRAME.x + FULL_MAP_LABEL_FRAME.w, toMapX(w.width - edge));
  const y2 = Math.min(FULL_MAP_LABEL_FRAME.y + FULL_MAP_LABEL_FRAME.h, toMapY(w.height - edge));

  if (x2 <= x1 || y2 <= y1) return null;
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/** Captions for the visible floor, already collision-resolved. */
export function buildLabelLayerHtml(floorId) {
  const route = navState.route;
  if (!route) return '';

  const bounds = getFloorBounds(floorId);
  const toSvg  = n => nodeToSvg(n, bounds);

  const currentNode = getCurrentRouteNode();
  const destNode = findNode(planState.destinationCode);
  const currentPt = currentNode?.floorId === floorId ? toSvg(currentNode) : null;
  const destPt = destNode?.floorId === floorId && destNode.code !== currentNode?.code
    ? toSvg(destNode)
    : null;

  // POI dots share this coordinate space, so they are obstacles too —
  // otherwise a caption lands on top of one and neither is readable.
  const blocked = getRoutePois(floorId).map(({ p }) => ({
    x: p.x - 12 * MARK_SCALE, y: p.y - 12 * MARK_SCALE,
    w: 24 * MARK_SCALE, h: 24 * MARK_SCALE,
  }));
  const controls = controlsKeepOut(floorId);
  if (controls) blocked.push(controls);
  const items = [];

  if (destPt) {
    items.push({ x: destPt.x, y: destPt.y - 20 * MARK_SCALE, radius: 18 * MARK_SCALE, priority: 3,
      cls: 'sg-map-label--dest', lines: [getPublicNodeLabel(destNode), 'Seu destino'] });
    blocked.push({
      x: destPt.x - 14 * MARK_SCALE, y: destPt.y - 36 * MARK_SCALE,
      w: 28 * MARK_SCALE, h: 38 * MARK_SCALE,
    });
  }
  if (currentPt) {
    items.push({ x: currentPt.x, y: currentPt.y, radius: 20 * MARK_SCALE, priority: 4,
      cls: 'sg-map-label--here', lines: ['Etapa atual', getPublicNodeLabel(currentNode)] });
    blocked.push({
      x: currentPt.x - 18 * MARK_SCALE, y: currentPt.y - 18 * MARK_SCALE,
      w: 36 * MARK_SCALE, h: 36 * MARK_SCALE,
    });
  }

  return placeLabels(items, blocked, visibleMapFrame(floorId) ?? undefined).map(({ box, lines, cls }) => `
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
  const segmentCodes = (route.segments ?? [])
    .filter(segment => segment.type === 'floor' && segment.floorId === floorId)
    .flatMap(segment => segment.nodeCodes ?? []);
  const floorCodes = [...new Set(segmentCodes.length
    ? segmentCodes
    : path.filter(code => findNode(code)?.floorId === floorId))];

  if (!floorCodes.length) {
    return `<svg viewBox="0 0 ${MAP_W} ${MAP_H}" class="sg-map-svg sg-map-route" aria-hidden="true"></svg>`;
  }

  // Step range partitioning for coloring
  const stepIdx = navState.activeStepIndex;
  const steps   = navState.semanticSteps;
  const curStep = steps[stepIdx];

  const activeFrom = curStep?.rawFrom ?? 0;
  const activeTo   = curStep?.rawTo   ?? path.length - 1;

  // Partition EDGES, not nodes. Each state keeps the boundary node it shares
  // with its neighbour, so completed → current → upcoming is one continuous
  // line even when the current step covers a single point.
  const floorPoints = floorCodes.map(code => {
    const pi = path.indexOf(code);
    if (pi < 0) return null;
    const n = findNode(code);
    return n ? { pi, p: toSvg(n) } : null;
  }).filter(Boolean);
  const edgePoints = { completed: [], active: [], upcoming: [] };
  for (let i = 1; i < floorPoints.length; i++) {
    const previous = floorPoints[i - 1];
    const next = floorPoints[i];
    const state = next.pi <= activeFrom ? 'completed'
      : previous.pi >= activeTo ? 'upcoming'
      : 'active';
    const points = edgePoints[state];
    if (!points.length || points.at(-1) !== previous.p) points.push(previous.p);
    points.push(next.p);
  }
  const completedPts = edgePoints.completed;
  const activePts = edgePoints.active;
  const upcomingPts = edgePoints.upcoming;
  const activeSpot = floorPoints.find(point => point.pi >= activeFrom && point.pi <= activeTo)?.p ?? null;

  const poly = pts => pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

  // Determine which nodes to show as markers (strict filtering)
  const routeSet = new Set(floorCodes);
  const currentNode = getCurrentRouteNode();
  const destNode = findNode(planState.destinationCode);
  const showCurrent = currentNode?.floorId === floorId;
  const showDest = destNode?.floorId === floorId && destNode.code !== currentNode?.code;

  // Visible landmarks: only vertical connections + doors/entrances ON the route
  const visibleLandmarks = appData.nodes.filter(n =>
    n.floorId === floorId &&
    routeSet.has(n.code) &&
    NAV_VISIBLE_TYPES.has(n.type) &&
    n.code !== planState.originCode &&
    n.code !== planState.destinationCode &&
    n.code !== currentNode?.code
  );

  // Current instruction landmark. Skipped when it IS the origin or the
  // destination — those already have a marker and a caption, and printing
  // the same place name twice is just noise competing for space.
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

  // Which points anchor the confirmed current step and destination markers.
  const currentPt = showCurrent ? toSvg(currentNode) : null;
  const destPt = showDest ? toSvg(destNode) : null;

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
         the FIRST step usually is ("Comece em Porta 3", one point) — there
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
      : activeSpot ? `
      <circle class="sg-route__spot" cx="${activeSpot.x.toFixed(1)}" cy="${activeSpot.y.toFixed(1)}" r="${u(6)}"/>
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
          <circle class="sg-route-mark__ring" r="${u(5.5)}"/>
          <circle class="sg-route-mark__core" r="${u(2.4)}"/>
        </g>
      </g>`;
    }).join('')}

    <!-- Destination: glowing pin, the end of the light -->
    ${destPt ? `<g class="sg-map-dest" aria-label="Destino: ${esc(getPublicNodeLabel(destNode))}"
      transform="translate(${destPt.x.toFixed(1)},${destPt.y.toFixed(1)})">
      <circle class="sg-map-dest__glow" r="${u(34)}"/>
      <g class="sg-pop">
        <circle class="sg-map-dest__halo" r="${u(20)}"/>
        ${mapPin(0, 0, 'sg-map-pin--dest')}
      </g>
    </g>` : ''}

    <!-- Passenger-confirmed active step: progress, not live positioning. -->
    ${currentPt ? `<g class="sg-map-here" aria-label="Etapa atual: ${esc(getPublicNodeLabel(currentNode))}"
      transform="translate(${currentPt.x.toFixed(1)},${currentPt.y.toFixed(1)})">
      <circle class="sg-map-here__wave" r="${u(13)}"/>
      <circle class="sg-map-here__wave sg-map-here__wave--2" r="${u(13)}"/>
      <circle class="sg-map-here__halo" r="${u(26)}"/>
      <g class="sg-pop">
        <circle class="sg-map-here__dot" r="${u(8.5)}"/>
        <circle class="sg-map-here__center" r="${u(3.2)}"/>
      </g>
    </g>` : ''}

    <!-- Captions are NOT here: they live in the HTML label layer, where a
         glass capsule can actually be glass. See buildLabelLayerHtml(). -->
  </svg>`;
}

/* ── POIs ALONG THE ROUTE ──────────────────────────────────────
   Rendered as HTML, not SVG, in their own layer. The layer is exactly the
   same 3740x1800 box as the SVG viewBox, so 1 SVG unit == 1 CSS px and the
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

/**
 * How close to the line a POI has to be to count as "on the way".
 *
 * Now a real distance: 133 units x 0.38 m/unit is about 50 m. The old 78 was
 * measured in the per-floor normalised space, where it meant 108 m on floor 2
 * and 7 m on floor 3 — one constant describing two different products.
 */
export const POI_NEAR_UNITS = 133;
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

  const segmentCodes = (route.segments ?? [])
    .filter(segment => segment.type === 'floor' && segment.floorId === floorId)
    .flatMap(segment => segment.nodeCodes ?? []);
  const floorCodes = [...new Set(segmentCodes.length
    ? segmentCodes
    : route.path.filter(code => findNode(code)?.floorId === floorId))];
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
