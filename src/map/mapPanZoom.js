import { $ } from '../utils/dom.js';
import { getFloorTransform } from '../state/selectors.js';
import { mapState } from '../state/appState.js';
import { clamp } from '../utils/format.js';
import { MAX_SCALE, MIN_SCALE } from '../app/constants.js';
import { buildLabelLayerHtml } from './floorMapBuilder.js';

/* ============================================================
   8. MAP PAN & ZOOM
   ============================================================ */

/* Captions are placed against the framing they will actually be seen in:
   buildLabelLayerHtml() projects the floating controls back into map space
   to avoid them, and that projection depends on the live pan/zoom. Every
   re-frame therefore has to re-place them once it has settled.

   Only ANIMATED transforms qualify. duration > 0 means a deliberate
   re-frame (a fit, a floor change, a recentre) — a handful per session.
   duration === 0 is a drag or a pinch, which arrives once per frame with a
   finger down; re-laying out captions there would rebuild the layer sixty
   times a second for a view the user is still choosing. */
let _labelRelayout = 0;
function relayoutLabelsAfter(duration) {
  clearTimeout(_labelRelayout);
  _labelRelayout = setTimeout(() => {
    const el = $('map-labels');
    if (el) el.innerHTML = buildLabelLayerHtml(mapState.selectedFloorId);
  }, duration + 40);
}

export function applyMapTransform(duration = 0) {
  const wrapper = $('map-wrapper');
  if (!wrapper) return;
  if (duration > 0) relayoutLabelsAfter(duration);
  const { x, y, scale } = getFloorTransform(mapState.selectedFloorId);
  const inner = wrapper.querySelector('.sg-map-inner');
  if (inner) {
    // Decelerating curve, not `ease`: re-framing between steps should glide
    // to a stop rather than snap.
    inner.style.transition = duration > 0
      ? `transform ${duration}ms cubic-bezier(.22, .61, .36, 1)`
      : 'none';
    inner.style.transform = `translate(${x}px,${y}px) scale(${scale})`;
    // POI markers counter-scale off this so they keep a constant on-screen
    // size: at scale 6 a 32px tap target would otherwise become ~190px and
    // swallow half the map, and at 0.25 it would be untappable.
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
  const wrapper = $('map-wrapper');
  if (wrapper && cx !== undefined) {
    const rect = wrapper.getBoundingClientRect();
    const px = cx - rect.left - rect.width / 2;
    const py = cy - rect.top - rect.height / 2;
    setTransform(t.x - (factor - 1) * (px - t.x), t.y - (factor - 1) * (py - t.y), newScale);
  } else {
    setTransform(t.x, t.y, newScale);
  }
}

export function resetTransform() {
  mapState.floorTransforms[mapState.selectedFloorId] = { x: 0, y: 0, scale: 1 };
  applyMapTransform(160);
}

export let _panDragging = false, _panStart = { x: 0, y: 0, tx: 0, ty: 0 };
export let _lastPinchDist = 0, _panHandlers = null;

export function bindMapPan() {
  const area = $('map-area');
  if (!area) return;
  if (_panHandlers) {
    window.removeEventListener('mousemove', _panHandlers.mm);
    window.removeEventListener('mouseup',   _panHandlers.mu);
  }

  // .sg-poi is listed explicitly: without it a tap on a POI marker would be
  // swallowed as the start of a pan instead of opening the place card.
  const isCtrl = e => e.target.closest('button,a,.sg-poi,.sg-floor-ctrl,.sg-map-fab,.sg-instruction-card');

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
}

