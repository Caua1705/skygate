import { mapState, navState, planState, uiState } from '../state/appState.js';
import { findNode } from '../state/selectors.js';
import { MAP_H, MAP_W, floorRouteCodes, getFloorBounds, nodeToSvg } from './floorMapBuilder.js';
import { clamp } from '../utils/format.js';
import { MAX_SCALE, MIN_SCALE } from '../app/constants.js';
import { setTransform } from './mapPanZoom.js';
import { prefersReducedMotion , $ } from '../utils/dom.js';

/* ============================================================
   7. MAP AUTO-FIT

   Geometry, once, so the rest reads easily:
   `.sg-map-inner` is a fixed 3740x1800 box — the floor plans' own viewBox —
   centred in `.sg-map-wrapper` and transformed with translate(tx,ty)
   scale(s) about its own centre. A map point (px,py) therefore lands at,
   relative to the wrapper:

       screenX = wrapperW/2 + tx + (px - MAP_W/2) * s
       screenY = wrapperH/2 + ty + (py - MAP_H/2) * s

   To put a point at an arbitrary target (X,Y) we solve for tx,ty. That is
   the whole trick behind framing the route somewhere other than the dead
   centre of the map area.

   WHAT GETS FRAMED. The app has no positioning, so the default frame is
   the WHOLE route on the visible floor. Tapping a step in the sheet frames
   that step's leg instead (uiState.focusedStepIndex); the recentre control
   and every floor change go back through autoFitRoute(), which honours the
   focused step when it has geometry on this floor and falls back to the
   full route otherwise.
   ============================================================ */

/** Breathing room around the framed box, as a share of its own span. */
const FIT_PAD_RATIO = 0.12;
/** Floor for that padding in map units — clears a badge and its label. */
const FIT_PAD_MIN = 68;
/** A leg shorter than this is grown, so a single node never zooms to 8x. */
const MIN_SPAN = 289;
/**
 * Ceiling for the AUTO fit only — pinch-zoom still goes to MAX_SCALE.
 * Framing a short leg inside a large map area (desktop) otherwise solves
 * to 6x and the drawing turns into a handful of blurred walls.
 */
const FIT_MAX_SCALE = 2.6;

/**
 * The part of the map area the user can actually see.
 *
 * The banner floats over the top of the map and the sheet covers the
 * bottom, so the geometric centre of the map area is NOT the centre of what
 * is visible — framing there pushes the route under the sheet. Insets are
 * measured from the live elements rather than hardcoded, which keeps this
 * correct on desktop too, where the sheet is a right-hand column.
 */
function safeViewport(wrapper) {
  const w = wrapper.getBoundingClientRect();
  let top = 0, bottom = 0, right = 0;

  const banner = document.querySelector('.sg-navbar');
  if (banner) {
    const b = banner.getBoundingClientRect();
    top = clamp(b.bottom - w.top + 8, 0, w.height * 0.4);
  }

  const sheet = $('nav-sheet');
  if (sheet) {
    const s = sheet.getBoundingClientRect();
    const overlapsHorizontally = s.left < w.right - 1 && s.right > w.left;
    if (overlapsHorizontally) bottom = clamp(w.bottom - s.top, 0, w.height * 0.6);
  }

  const fabs = document.querySelector('.sg-map-fabs');
  if (fabs) {
    const f = fabs.getBoundingClientRect();
    if (f.right > w.left && f.left < w.right) right = clamp(w.right - f.left, 0, w.width * 0.3);
  }

  const width  = Math.max(40, w.width - right);
  const height = Math.max(40, w.height - top - bottom);
  return {
    wrapperW: w.width, wrapperH: w.height,
    left: 0, top,
    width, height,
    cx: width / 2,
    cy: top + height / 2,
  };
}

/**
 * Slide one axis so the plan keeps covering the visible region.
 * Positions come from the same screen(p) formula documented above.
 */
function clampToContent(t, scale, mapSize, wrapper, safeMin, safeMax) {
  const half = (mapSize / 2) * scale;
  const lo = wrapper / 2 + t - half;      // where map coordinate 0 lands
  const hi = wrapper / 2 + t + half;      // where mapSize lands
  const safeSize = safeMax - safeMin;

  // Plan smaller than the frame: nothing to clamp, just centre it.
  if (mapSize * scale <= safeSize) return safeMin + safeSize / 2 - wrapper / 2;

  if (lo > safeMin) return t + (safeMin - lo);   // gap on the near side
  if (hi < safeMax) return t + (safeMax - hi);   // gap on the far side
  return t;
}

/**
 * Frame a set of map-space points inside the visible region.
 * @param {Array<{x:number,y:number}>} pts
 * @param {{ duration?: number }} opts
 */
export function fitPointsToView(pts, { duration } = {}) {
  if (!pts.length) return false;
  const wrapper = document.querySelector('.sg-map-wrapper');
  if (!wrapper) return false;
  const view = safeViewport(wrapper);
  if (!view.wrapperW || !view.wrapperH) return false;

  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  let minX = Math.min(...xs), maxX = Math.max(...xs);
  let minY = Math.min(...ys), maxY = Math.max(...ys);

  // A single-node leg has no extent; grow it about its centre so the fit
  // lands on a sensible zoom instead of slamming into MAX_SCALE.
  const growTo = (lo, hi, min) => {
    const span = hi - lo;
    if (span >= min) return [lo, hi];
    const mid = (lo + hi) / 2, half = min / 2;
    return [mid - half, mid + half];
  };
  [minX, maxX] = growTo(minX, maxX, MIN_SPAN);
  [minY, maxY] = growTo(minY, maxY, MIN_SPAN * (view.height / view.width));

  const pad = Math.max(FIT_PAD_MIN, (maxX - minX) * FIT_PAD_RATIO);
  const bX1 = minX - pad, bX2 = maxX + pad;
  const bY1 = minY - pad, bY2 = maxY + pad;

  const scale = clamp(
    Math.min(view.width / (bX2 - bX1), view.height / (bY2 - bY1)),
    MIN_SCALE, Math.min(FIT_MAX_SCALE, MAX_SCALE),
  );

  // Solve the two equations above for tx,ty so the box centre lands on the
  // centre of the VISIBLE region rather than the centre of the map area.
  const midX = (bX1 + bX2) / 2, midY = (bY1 + bY2) / 2;
  let tx = view.cx - view.wrapperW / 2 + (MAP_W / 2 - midX) * scale;
  let ty = view.cy - view.wrapperH / 2 + (MAP_H / 2 - midY) * scale;

  // Keep the plan under the frame. A leg near the edge of the floor would
  // otherwise be centred with half the screen showing nothing.
  tx = clampToContent(tx, scale, MAP_W, view.wrapperW, view.left, view.left + view.width);
  ty = clampToContent(ty, scale, MAP_H, view.wrapperH, view.top,  view.top  + view.height);

  setTransform(tx, ty, scale, prefersReducedMotion() ? 0 : (duration ?? 320));
  return true;
}

/** Map-space points for a list of node codes on the visible floor. */
function pointsFor(codes, floorId) {
  const bounds = getFloorBounds(floorId);
  return codes
    .map(c => findNode(c))
    .filter(n => n && n.floorId === floorId)
    .map(n => nodeToSvg(n, bounds));
}

/**
 * Frame one step's leg: from its own position through the start of the
 * next step, so the stretch it describes is what fills the screen.
 */
export function fitStepToView(stepIndex, duration) {
  if (!navState.route) return false;
  const steps = navState.semanticSteps;
  const step = steps[stepIndex];
  if (!step) return false;

  const path = navState.route.path ?? [];
  if (!path.length) return false;
  const from = step.rawFrom ?? 0;
  const to = steps[stepIndex + 1]?.rawFrom ?? step.rawTo ?? path.length - 1;
  const codes = path.slice(from, Math.max(from, to) + 1);
  if (step.landmarkCode && !codes.includes(step.landmarkCode)) codes.unshift(step.landmarkCode);

  const pts = pointsFor(codes, mapState.selectedFloorId);
  if (!pts.length) return false;
  return fitPointsToView(pts, { duration });
}

/** Frame the whole route on the visible floor. */
export function fitFullRoute(duration) {
  if (!navState.route) return false;
  const fid = mapState.selectedFloorId;
  const codes = floorRouteCodes(fid);
  const pts = pointsFor(codes, fid);
  // Endpoints have labels; make sure they are inside the frame too.
  [planState.originCode, planState.destinationCode].forEach(code => {
    const n = findNode(code);
    if (n && n.floorId === fid && !codes.includes(code)) pts.push(nodeToSvg(n, getFloorBounds(fid)));
  });
  if (!pts.length) return false;
  return fitPointsToView(pts, { duration });
}

/**
 * The one entry point callers should use: the focused step when it has
 * geometry on this floor, otherwise the whole route on this floor.
 */
export function autoFitRoute(duration) {
  if (!navState.route) return false;
  const focused = uiState.focusedStepIndex;
  if (focused >= 0 && fitStepToView(focused, duration)) return true;
  return fitFullRoute(duration);
}
