import { $, prefersReducedMotion } from '../utils/dom.js';
import { getFloorTransform } from '../state/selectors.js';
import { mapState } from '../state/appState.js';
import { clamp } from '../utils/format.js';
import { MAX_SCALE, MIN_SCALE } from '../app/constants.js';
import { buildStepLayerHtml } from './floorMapBuilder.js';

/* ============================================================
   8. MAP PAN & ZOOM
   ============================================================ */

/* Step badges are thinned by collision at the zoom they will actually be
   seen at (see visibleStepPoints), so every re-frame has to re-place them
   once it has settled. Only ANIMATED transforms qualify: duration > 0 means
   a deliberate re-frame (a fit, a floor change, a recentre) — a handful per
   session. duration === 0 is normally a drag or pinch, which arrives once
   per frame; those are followed by a quiet debounce instead so a pinch does
   not rebuild the layer sixty times a second. */
let _badgeRelayout = 0;
function relayoutBadgesAfter(delay) {
  clearTimeout(_badgeRelayout);
  _badgeRelayout = setTimeout(() => {
    const el = $('map-steps');
    if (el) el.innerHTML = buildStepLayerHtml(mapState.selectedFloorId);
  }, delay);
}

export function applyMapTransform(duration = 0) {
  const wrapper = document.querySelector('.sg-map-wrapper');
  if (!wrapper) return;
  relayoutBadgesAfter(duration > 0 || prefersReducedMotion() ? duration + 40 : 160);
  const { x, y, scale } = getFloorTransform(mapState.selectedFloorId);
  const inner = wrapper.querySelector('.sg-map-inner');
  if (inner) {
    // Decelerating curve, not `ease`: re-framing should glide to a stop.
    inner.style.transition = duration > 0
      ? `transform ${duration}ms cubic-bezier(.22, .61, .36, 1)`
      : 'none';
    inner.style.transform = `translate(${x}px,${y}px) scale(${scale})`;
    // The HTML layers counter-scale off this so a badge or a POI keeps a
    // constant on-screen size, and the route stroke divides by it so the
    // line keeps a constant on-screen width.
    inner.style.setProperty('--map-zoom', String(scale));
  }
}

export function setTransform(x, y, scale, duration = 0) {
  const s = clamp(scale, MIN_SCALE, MAX_SCALE);
  mapState.floorTransforms[mapState.selectedFloorId] = { x, y, scale: s };
  applyMapTransform(duration);
}

export function zoomAt(delta, cx, cy) {
  const t = getFloorTransform(mapState.selectedFloorId);
  const newScale = clamp(t.scale + delta, MIN_SCALE, MAX_SCALE);
  const factor = newScale / t.scale;
  const wrapper = document.querySelector('.sg-map-wrapper');
  if (wrapper && cx !== undefined) {
    const rect = wrapper.getBoundingClientRect();
    const px = cx - rect.left - rect.width / 2;
    const py = cy - rect.top - rect.height / 2;
    setTransform(t.x - (factor - 1) * (px - t.x), t.y - (factor - 1) * (py - t.y), newScale);
  } else {
    setTransform(t.x, t.y, newScale);
  }
}

/** Zoom about the centre of the map area — the keyboard's zoom. */
export function zoomBy(delta) {
  const t = getFloorTransform(mapState.selectedFloorId);
  setTransform(t.x, t.y, clamp(t.scale * (1 + delta), MIN_SCALE, MAX_SCALE), 120);
}

export function panBy(dx, dy) {
  const t = getFloorTransform(mapState.selectedFloorId);
  setTransform(t.x + dx, t.y + dy, t.scale, 120);
}

export function resetTransform() {
  mapState.floorTransforms[mapState.selectedFloorId] = { x: 0, y: 0, scale: 1 };
  applyMapTransform(160);
}

export let _panDragging = false, _panStart = { x: 0, y: 0, tx: 0, ty: 0 };
export let _lastPinchDist = 0, _panHandlers = null;

/** Keyboard pan step in px; ~a fifth of a phone screen per press. */
const KEY_PAN = 72;

export function bindMapPan() {
  const area = $('map-area');
  if (!area) return;
  if (_panHandlers) {
    window.removeEventListener('mousemove', _panHandlers.mm);
    window.removeEventListener('mouseup',   _panHandlers.mu);
  }

  // .sg-poi and .sg-map-step are listed explicitly: without them a tap on
  // a marker would be swallowed as the start of a pan instead of opening
  // the place card or focusing the step.
  const isCtrl = e => e.target.closest('button,a,.sg-poi,.sg-map-step,.sg-floor-ctrl,.sg-map-fab');

  const onMD = e => {
    if (e.button !== 0 || isCtrl(e)) return;
    _panDragging = true;
    const t = getFloorTransform(mapState.selectedFloorId);
    _panStart = { x: e.clientX, y: e.clientY, tx: t.x, ty: t.y };
    area.style.cursor = 'grabbing';
  };
  const onMM = e => {
    if (!_panDragging) return;
    const t = getFloorTransform(mapState.selectedFloorId);
    setTransform(_panStart.tx + e.clientX - _panStart.x, _panStart.ty + e.clientY - _panStart.y, t.scale);
  };
  const onMU = () => { _panDragging = false; area.style.cursor = ''; };

  _panHandlers = { mm: onMM, mu: onMU };
  area.addEventListener('mousedown', onMD);
  window.addEventListener('mousemove', onMM);
  window.addEventListener('mouseup', onMU);

  area.addEventListener('wheel', e => {
    if (isCtrl(e)) return;
    e.preventDefault();
    zoomAt(e.deltaY < 0 ? 0.3 : -0.3, e.clientX, e.clientY);
  }, { passive: false });

  area.addEventListener('touchstart', e => {
    if (isCtrl(e)) return;
    if (e.touches.length === 1) {
      const t = getFloorTransform(mapState.selectedFloorId);
      _panDragging = true;
      _panStart = { x: e.touches[0].clientX, y: e.touches[0].clientY, tx: t.x, ty: t.y };
    }
    if (e.touches.length === 2) {
      _panDragging = false;
      _lastPinchDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    }
  }, { passive: true });

  area.addEventListener('touchmove', e => {
    if (isCtrl(e)) return;
    if (e.touches.length === 1 && _panDragging) {
      const t = getFloorTransform(mapState.selectedFloorId);
      setTransform(_panStart.tx + e.touches[0].clientX - _panStart.x, _panStart.ty + e.touches[0].clientY - _panStart.y, t.scale);
    }
    if (e.touches.length === 2 && _lastPinchDist) {
      const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      const mid = { x: (e.touches[0].clientX + e.touches[1].clientX) / 2, y: (e.touches[0].clientY + e.touches[1].clientY) / 2 };
      zoomAt((d - _lastPinchDist) * 0.012, mid.x, mid.y);
      _lastPinchDist = d;
    }
  }, { passive: true });

  area.addEventListener('touchend', () => { _panDragging = false; _lastPinchDist = 0; });

  // The explicit zoom buttons are gone (two floating controls, no more), so
  // the map itself is operable from the keyboard: arrows pan, + and - zoom.
  // Only when the map area itself has focus — never while a badge or a POI
  // inside it is the active element, or their own keys would be eaten.
  area.addEventListener('keydown', e => {
    if (e.target !== area) return;
    const keys = {
      ArrowUp:    () => panBy(0, KEY_PAN),
      ArrowDown:  () => panBy(0, -KEY_PAN),
      ArrowLeft:  () => panBy(KEY_PAN, 0),
      ArrowRight: () => panBy(-KEY_PAN, 0),
      '+': () => zoomBy(0.25), '=': () => zoomBy(0.25),
      '-': () => zoomBy(-0.2), '_': () => zoomBy(-0.2),
    };
    const action = keys[e.key];
    if (!action) return;
    e.preventDefault();
    action();
  });
}
