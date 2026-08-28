import { app, appData, mapState, navState, planState, uiState } from '../state/appState.js';
import { root , $ } from '../utils/dom.js';
import { renderPlanning } from '../screens/home/HomeScreen.js';
import { renderSearchOverlay, renderSearchResults } from '../components/SearchOverlay.js';
import { renderLocationDetail } from '../components/LocationDetail.js';
import { renderPlaceDetailSheet } from '../components/PlaceDetailSheet.js';
import { renderSummary } from '../screens/routeSummary/RouteSummaryScreen.js';
import { renderFloorControl, renderNavigation } from '../screens/navigation/NavigationScreen.js';
import { bindEvents, bindFloorControlEvents, bindMapPoiEvents, bindSearchItemEvents } from './events.js';
import { applyMapTransform, bindMapPan } from '../map/mapPanZoom.js';
import { autoFitRoute } from '../map/mapFit.js';
import { refreshSummaryTiming } from './actions.js';
import { buildPoiLayerHtml, buildRouteOverlaySvg, buildStepLayerHtml, getBaseFloorSvg, peekBaseFloorSvg } from '../map/floorMapBuilder.js';
import { getFloorLabel } from '../state/selectors.js';
import { filterNodes, groupByCategory } from '../services/nodeSearch.js';
import { persistSessionState } from '../state/sessionPersistence.js';

/* ============================================================
   11. MAIN RENDER — dispatch by app.mode
   ============================================================ */

let summaryRefreshTimer = null;
let lastRenderedMode = '';
let screenTransitionTimer = 0;

const MODE_ORDER = { planning: 0, summary: 1, navigation: 2 };

/**
 * Screen changes get one restrained transition and a predictable focus
 * destination. Re-renders inside the same screen stay instant, so typing
 * or selecting a route never replays page choreography.
 */
function finishScreenChange(previousMode) {
  const currentMode = app.mode;
  root.dataset.mode = currentMode;
  if (!previousMode || previousMode === currentMode) return;

  const screen = root.firstElementChild;
  if (!screen) return;
  const direction = (MODE_ORDER[currentMode] ?? 0) >= (MODE_ORDER[previousMode] ?? 0)
    ? 'forward'
    : 'back';
  const directionClass = 'sg-screen-enter--' + direction;
  screen.classList.add('sg-screen-enter', directionClass);
  clearTimeout(screenTransitionTimer);
  screenTransitionTimer = setTimeout(
    () => screen.classList.remove('sg-screen-enter', directionClass),
    360,
  );

  requestAnimationFrame(() => {
    const heading = screen.querySelector('h1');
    if (!heading) return;
    heading.classList.add('sg-screen-focus');
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  });
}

function scheduleSummaryRefresh() {
  clearTimeout(summaryRefreshTimer);
  summaryRefreshTimer = null;
  if (app.mode !== 'summary' || !planState.flightTime) return;

  const now = new Date();
  const delay = Math.max(1000, (60 - now.getSeconds()) * 1000 - now.getMilliseconds() + 50);
  summaryRefreshTimer = setTimeout(() => {
    refreshSummaryTiming();
    scheduleSummaryRefresh();
  }, delay);
}

/** Save only stable journey state; loading renders can contain half a route. */
export function persistJourney() {
  if (uiState.loading || !appData.nodes.length || !appData.floors.length) return false;
  return persistSessionState({
    state: { app, planState, navState, mapState },
    nodes: appData.nodes,
    floors: appData.floors,
  });
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') {
    persistJourney();
    return;
  }
  if (app.mode === 'summary' && planState.flightTime) refreshSummaryTiming();
  scheduleSummaryRefresh();
});

window.addEventListener('pagehide', persistJourney);

/** Every screen is light now; the map stage is the palest of them. */
const THEME_COLOR = { planning: '#F4F6FA', summary: '#F4F6FA', navigation: '#EFEDE7' };

export function render() {
  const previousMode = lastRenderedMode;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLOR[app.mode] ?? '#F4F6FA');
  document.documentElement.style.colorScheme = 'light';
  switch (app.mode) {
    case 'planning':   root.innerHTML = renderPlanning() + renderSearchOverlay() + renderLocationDetail() + renderPlaceDetailSheet(); break;
    case 'summary':    root.innerHTML = renderSummary() + renderSearchOverlay() + renderLocationDetail() + renderPlaceDetailSheet(); break;
    case 'navigation': root.innerHTML = renderNavigation() + renderSearchOverlay() + renderLocationDetail() + renderPlaceDetailSheet(); break;
  }
  finishScreenChange(previousMode);
  lastRenderedMode = app.mode;
  bindEvents();
  scheduleSummaryRefresh();
  if (app.mode === 'navigation') {
    applyMapTransform(0);
    bindMapPan();
    // The template painted the empty stage; fill it in once the plan for
    // this floor has been fetched (immediately, from cache, after the first).
    mountBaseFloorSvg(mapState.selectedFloorId);
  }
  persistJourney();
}

/**
 * Drop a floor plan into the base layer once its fetch resolves.
 *
 * Guarded on the floor still being the selected one: a traveller who taps
 * through two floors while the first plan is in flight must not have it
 * land under the second floor's route.
 */
export async function mountBaseFloorSvg(floorId) {
  const svg = await getBaseFloorSvg(floorId);
  if (mapState.selectedFloorId !== floorId) return;
  const baseEl = $('map-base');
  if (baseEl) baseEl.innerHTML = svg;
}

/* Partial map update — route, POIs and badges; not the base, not the sheet. */
export function updateRouteOverlay() {
  const routeEl = $('map-route');
  if (!routeEl) return;
  requestAnimationFrame(() => {
    routeEl.innerHTML = buildRouteOverlaySvg(mapState.selectedFloorId);
    updatePoiLayer();
    updateStepLayer();
  });
}

/* POIs are re-rendered per floor and need their listeners re-attached. */
export function updatePoiLayer() {
  const el = $('map-pois');
  if (!el) return;
  el.innerHTML = buildPoiLayerHtml(mapState.selectedFloorId);
  bindMapPoiEvents();
}

/* Step badges: the layer's click handling is delegated to the container
   (events.js), so a swap of its contents needs no re-binding. */
export function updateStepLayer() {
  const el = $('map-steps');
  if (!el) return;
  el.innerHTML = buildStepLayerHtml(mapState.selectedFloorId);
}

/* Full map swap on floor change */
export function updateMapForFloor(floorId) {
  const baseEl  = $('map-base');
  const routeEl = $('map-route');
  if (!baseEl || !routeEl) return;
  requestAnimationFrame(() => {
    baseEl.innerHTML  = peekBaseFloorSvg(floorId);
    mountBaseFloorSvg(floorId);
    routeEl.innerHTML = buildRouteOverlaySvg(floorId);
    $('map-area')?.setAttribute('aria-label',
      `Mapa da rota — ${getFloorLabel(floorId)}. Use as setas para mover e mais ou menos para o zoom.`);
    updatePoiLayer();
    updateStepLayer();
    applyMapTransform(0);
    // Re-frame on the new floor: the stored per-floor transform is usually
    // a stale frame from a different leg, which lands the user on empty plan.
    if (navState.route) autoFitRoute(260);
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
