import { mapState, navState } from '../state/appState.js';
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
   ============================================================ */

export function fitStepToView(stepIndex) {
  if (!navState.route) return;
  const step = navState.semanticSteps[stepIndex];
  if (!step) return;
  const path  = navState.route.path;
  const from  = step.rawFrom ?? 0;
  const to    = step.rawTo   ?? path.length - 1;
  const codes = path.slice(from, to + 1);
  const stepNodes = codes.map(c => findNode(c)).filter(n => n?.floorId === mapState.selectedFloorId);
  if (!stepNodes.length) return;

  const bounds = getFloorBounds(mapState.selectedFloorId);
  const toSvgFn = n => nodeToSvg(n, bounds);
  const pts = stepNodes.map(toSvgFn);
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  const pad = 80;
  const bX1 = Math.min(...xs) - pad, bX2 = Math.max(...xs) + pad;
  const bY1 = Math.min(...ys) - pad, bY2 = Math.max(...ys) + pad;

  const wrapper = $('map-wrapper');
  if (!wrapper) return;
  const rect = wrapper.getBoundingClientRect();
  if (!rect.width || !rect.height) return;

  const scaleX = rect.width  / (bX2 - bX1);
  const scaleY = rect.height / (bY2 - bY1);
  const newScale = clamp(Math.min(scaleX, scaleY) * 0.9, MIN_SCALE, MAX_SCALE);
  const midX = (bX1 + bX2) / 2, midY = (bY1 + bY2) / 2;
  const nx = (MAP_W / 2 - midX) * newScale;
  const ny = (MAP_H / 2 - midY) * newScale;

  setTransform(nx, ny, newScale, prefersReducedMotion() ? 0 : 280);
}

export function fitFullRoute() {
  if (!navState.route) return;
  const fid = mapState.selectedFloorId;
  const seg = navState.route.segments?.find(s => s.type === 'floor' && s.floorId === fid);
  const codes = seg?.nodeCodes ?? navState.route.path.filter(c => findNode(c)?.floorId === fid);
  const nodes = codes.map(c => findNode(c)).filter(Boolean);
  if (!nodes.length) return;

  const bounds = getFloorBounds(fid);
  const pts = nodes.map(n => nodeToSvg(n, bounds));
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  // Padding for the pins (which rise ~34 above their anchor) and captions.
  // It used to reserve 150/190 horizontally for captions placed blind; they
  // now go through layoutLabels, which clamps them inside the viewBox, so
  // that much slack only zoomed the plan out until nothing was readable.
  const padL = 70, padR = 80, padT = 60, padB = 50;
  const bX1 = Math.min(...xs) - padL, bX2 = Math.max(...xs) + padR;
  const bY1 = Math.min(...ys) - padT, bY2 = Math.max(...ys) + padB;

  const wrapper = $('map-wrapper');
  if (!wrapper) return;
  const rect = wrapper.getBoundingClientRect();
  if (!rect.width || !rect.height) return;

  const scaleX = rect.width  / (bX2 - bX1);
  const scaleY = rect.height / (bY2 - bY1);
  const newScale = clamp(Math.min(scaleX, scaleY) * 0.96, MIN_SCALE, MAX_SCALE);
  const midX = (bX1 + bX2) / 2, midY = (bY1 + bY2) / 2;
  const nx = (MAP_W / 2 - midX) * newScale;
  const ny = (MAP_H / 2 - midY) * newScale;

  setTransform(nx, ny, newScale, prefersReducedMotion() ? 0 : 320);
}

