import { mapState, navState, planState } from '../state/appState.js';
import { findNode } from '../state/selectors.js';
// MAP_H was used by both fit functions but never imported — every call to
// fitStepToView/fitFullRoute threw ReferenceError, which silently killed the
// recenter FAB and the auto-fit on step change.
import { MAP_H, MAP_W, getFloorBounds, nodeToSvg } from './floorMapBuilder.js';
import { clamp } from '../utils/format.js';
import { MAX_SCALE, MIN_SCALE } from '../app/constants.js';
import { setTransform } from './mapPanZoom.js';
import { prefersReducedMotion , $ } from '../utils/dom.js';

/* ============================================================
   7. MAP AUTO-FIT

   Geometry, once, so the rest reads easily:
   `.sg-map-inner` is a fixed 900x600 box centred in `.sg-map-wrapper` and
   transformed with translate(tx,ty) scale(s) about its own centre. A map
   point (px,py) therefore lands at, relative to the wrapper:

       screenX = wrapperW/2 + tx + (px - MAP_W/2) * s
       screenY = wrapperH/2 + ty + (py - MAP_H/2) * s

   To put a point at an arbitrary target (X,Y) we solve for tx,ty. That is
   the whole trick behind framing the route somewhere other than the dead
   centre of the map area.
   ============================================================ */

/* These four numbers decide how close the map opens, and they fight each
   other: every unit of padding is a unit of the frame NOT spent on the
   route. Tuned against the 900x600 map space, where a short first leg is
   ~90 units and the whole floor is 900. Earlier values (260 min span, 60+90
   padding) built a 560-unit frame around that 90-unit leg — 84% empty, the
   "small route lost in a dark field" this was meant to fix. */
/** Breathing room around the framed box, as a share of its own span. */
const FIT_PAD_RATIO = 0.12;
/** Floor for that padding in map units — clears a pin, which rises ~34. */
const FIT_PAD_MIN = 40;
/** A leg shorter than this is grown, so a single node never zooms to 8x. */
const MIN_SPAN = 170;
/**
 * Room for an origin/destination caption, which is ~195 map units wide.
 * Not the full width: reserving all of it zooms the leg back out, and the
 * brief asked for close framing. Captions on markers OUTSIDE the current
 * leg (a destination two steps away) can still fall off-frame.
 */
const CAPTION_PAD = 60;
/**
 * Ceiling for the AUTO fit only — pinch-zoom still goes to MAX_SCALE.
 * Framing a short leg inside a large map area (desktop, where the map gets
 * ~1300px) otherwise solves to 6x, which blows the markers and the route up
 * to absurd sizes because they are drawn in map units.
 */
const FIT_MAX_SCALE = 2.6;

/**
 * The part of the map area the user can actually see.
 *
 * The header floats over the top of the map and the sheet covers the
 * bottom, so the geometric centre of the map area is NOT the centre of what
 * is visible — framing there pushes the route under the sheet. Insets are
 * measured from the live elements rather than hardcoded, which keeps this
 * correct on desktop too, where the sheet is a right-hand panel instead.
 */
function safeViewport(wrapper) {
  const w = wrapper.getBoundingClientRect();
  let top = 0, bottom = 0, right = 0;

  const header = document.querySelector('.sg-navhdr');
  if (header) {
    const h = header.getBoundingClientRect();
    // The scrim fades out; only the solid upper part really occludes.
    top = clamp(h.bottom - w.top, 0, w.height * 0.4) * 0.8;
  }

  const sheet = $('instruction-card');
  if (sheet) {
    const s = sheet.getBoundingClientRect();
    const overlapsHorizontally = s.left < w.right && s.right > w.left;
    if (overlapsHorizontally) bottom = clamp(w.bottom - s.top, 0, w.height * 0.5);
    else if (s.left >= w.right - 1) right = 0;   // desktop: wrapper already stops short
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
    // Visible region as a box in wrapper-relative coordinates.
    left: 0, top,
    width, height,
    cx: width / 2,
    cy: top + height / 2,
  };
}

/**
 * Slide one axis so the plan keeps covering the visible region.
 * Positions come from the same screen(p) formula documented above.
 *
 * @param {number} t         translation on this axis
 * @param {number} scale
 * @param {number} mapSize   MAP_W or MAP_H
 * @param {number} wrapper   wrapper width or height
 * @param {number} safeMin   near edge of the visible region, wrapper-relative
 * @param {number} safeMax   far edge
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
 * @param {{ duration?: number, captionPad?: boolean }} opts
 */
export function fitPointsToView(pts, { duration, captionPad = false } = {}) {
  if (!pts.length) return false;
  const wrapper = $('map-wrapper');
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
  const side = pad + (captionPad ? CAPTION_PAD : 0);
  const bX1 = minX - side, bX2 = maxX + side;
  const bY1 = minY - pad,  bY2 = maxY + pad;

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
  // otherwise be centred with half the screen showing the void beyond the
  // plan — the "lost in a dark field" complaint in its other form.
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
 * Frame the leg the traveller is walking right now: from this step's
 * position through the start of the next one. That is the close-up the
 * navigation opens with — the whole-route overview reads as "small route
 * lost in a dark field" on a phone.
 */
export function fitStepToView(stepIndex, duration) {
  if (!navState.route) return false;
  const steps = navState.semanticSteps;
  const step = steps[stepIndex];
  if (!step) return false;

  const path = navState.route.path;
  const from = step.rawFrom ?? 0;
  // Through the START of the next step, so the leg ahead is on screen too.
  const to = steps[stepIndex + 1]?.rawFrom ?? step.rawTo ?? path.length - 1;
  const codes = path.slice(from, Math.max(from, to) + 1);

  const pts = pointsFor(codes, mapState.selectedFloorId);
  if (!pts.length) return false;

  // Keep the origin/destination markers in frame when they belong to this
  // leg, and reserve room for their captions.
  const hasEndpoint = codes.includes(planState.originCode) || codes.includes(planState.destinationCode);
  return fitPointsToView(pts, { duration, captionPad: hasEndpoint });
}

/** Frame the whole route on the visible floor (used as a fallback). */
export function fitFullRoute(duration) {
  if (!navState.route) return false;
  const fid = mapState.selectedFloorId;
  const seg = navState.route.segments?.find(s => s.type === 'floor' && s.floorId === fid);
  const codes = seg?.nodeCodes ?? navState.route.path.filter(c => findNode(c)?.floorId === fid);
  const pts = pointsFor(codes, fid);
  if (!pts.length) return false;
  return fitPointsToView(pts, { duration, captionPad: true });
}

/**
 * The one entry point callers should use: frame the current step, falling
 * back to the whole route when this step has nothing on the visible floor
 * (which is exactly what happens after a manual floor switch).
 */
export function autoFitRoute(duration) {
  if (!navState.route) return false;
  return fitStepToView(navState.activeStepIndex, duration) || fitFullRoute(duration);
}
