import { app, mapState, navState, planState, uiState } from '../state/appState.js';
import { root , $ } from '../utils/dom.js';
import { renderPlanning } from '../screens/home/HomeScreen.js';
import { renderSearchOverlay, renderSearchResults } from '../components/SearchOverlay.js';
import { renderLocationDetail } from '../components/LocationDetail.js';
import { renderPlaceDetailSheet } from '../components/PlaceDetailSheet.js';
import { renderSummary } from '../screens/routeSummary/RouteSummaryScreen.js';
import { renderFloorControl, renderNavigation } from '../screens/navigation/NavigationScreen.js';
import { bindEvents, bindFloorControlEvents, bindSearchItemEvents } from './events.js';
import { applyMapTransform, bindMapPan } from '../map/mapPanZoom.js';
import { buildRouteOverlaySvg, getBaseFloorSvg } from '../map/floorMapBuilder.js';
import { getFloorLabel } from '../state/selectors.js';
import { filterNodes, groupByCategory } from '../services/nodeSearch.js';

/* ============================================================
   11. MAIN RENDER — dispatch by app.mode
   ============================================================ */


export function render() {
  switch (app.mode) {
    case 'planning':   root.innerHTML = renderPlanning() + renderSearchOverlay() + renderLocationDetail() + renderPlaceDetailSheet(); break;
    case 'summary':    root.innerHTML = renderSummary() + renderSearchOverlay() + renderLocationDetail() + renderPlaceDetailSheet(); break;
    case 'navigation': root.innerHTML = renderNavigation() + renderSearchOverlay() + renderLocationDetail() + renderPlaceDetailSheet(); break;
  }
  bindEvents();
  if (app.mode === 'navigation') {
    applyMapTransform(0);
    bindMapPan();
  }
}

/* Partial map update — only route overlay, not base or full render */
export function updateRouteOverlay() {
  const routeEl = $('map-route');
  if (!routeEl) return;
  requestAnimationFrame(() => {
    routeEl.innerHTML = buildRouteOverlaySvg(mapState.selectedFloorId);
  });
}

/* Full map swap on floor change */
export function updateMapForFloor(floorId) {
  const baseEl  = $('map-base');
  const routeEl = $('map-route');
  if (!baseEl || !routeEl) return;
  requestAnimationFrame(() => {
    baseEl.innerHTML  = getBaseFloorSvg(floorId);
    routeEl.innerHTML = buildRouteOverlaySvg(floorId);
    applyMapTransform(0);
    // Brief floor label flash
    const ann = $('floor-announce');
    if (ann) {
      ann.textContent = getFloorLabel(floorId);
      ann.classList.add('is-visible');
      setTimeout(() => ann.classList.remove('is-visible'), 1200);
    }
    // Update floor control without full re-render
    const fc = $('floor-ctrl');
    if (fc) { fc.outerHTML = renderFloorControl(); bindFloorControlEvents(); }
    // Update return button
    const rb = $('return-btn');
    const showReturn = navState.route && mapState.manualFloor;
    if (rb) rb.classList.toggle('is-hidden', !showReturn);
  });
}

export function updateSearchResults_() {
  const el = $('search-results');
  if (!el || !uiState.searchOpenFor) return;
  const except = uiState.searchOpenFor === 'origin' ? planState.destinationCode : planState.originCode;
  const results = filterNodes(uiState.searchQuery, except, uiState.searchCategory);
  const grouped = groupByCategory(results);
  el.innerHTML = renderSearchResults(grouped, uiState.searchOpenFor);
  bindSearchItemEvents();
}

export function updateSearchChips_() {
  document.querySelectorAll('.sg-chip').forEach(btn => {
    const active = btn.dataset.catKey === uiState.searchCategory;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-pressed', String(active));
  });
}

