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
import { refreshSummaryTiming, scrollTimelineToCurrent } from './actions.js';
import { buildLabelLayerHtml, buildPoiLayerHtml, buildRouteOverlaySvg, getBaseFloorSvg, peekBaseFloorSvg } from '../map/floorMapBuilder.js';
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
 * destination. Re-renders inside the same screen stay instant, so typing,
 * selecting a route or advancing a step never replays page choreography.
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

export function render() {
  const previousMode = lastRenderedMode;
  const theme = app.mode === 'navigation' ? '#0A192F' : '#F4F6FA';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme);
  document.documentElement.style.colorScheme = app.mode === 'navigation' ? 'dark' : 'light';
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
    // Both are no-ops without the map DOM, so the timeline view costs
    // nothing here and the map view keeps its previous behaviour.
    applyMapTransform(0);
    bindMapPan();
    // The template painted the empty stage; fill it in once the plan for
    // this floor has been fetched (immediately, from cache, after the first).
    if (navState.view === 'map') mountBaseFloorSvg(mapState.selectedFloorId);
    // The traveller must land on the step they are actually on, not at the
    // top of a route they are halfway through. Each view scrolls itself; the
    // diagram does it from showRouteMap(), where the entrance is played.
    if (navState.view === 'timeline') requestAnimationFrame(() => scrollTimelineToCurrent('auto'));
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

/* Partial map update — only route overlay, not base or full render */
export function updateRouteOverlay() {
  const routeEl = $('map-route');
  if (!routeEl) return;
  requestAnimationFrame(() => {
    routeEl.innerHTML = buildRouteOverlaySvg(mapState.selectedFloorId);
    updatePoiLayer();
  });
}

/* POIs depend on the active step (what is still ahead), so they refresh
   with the route overlay and need their listeners re-attached. */
export function updatePoiLayer() {
  const el = $('map-pois');
  if (!el) return;
  el.innerHTML = buildPoiLayerHtml(mapState.selectedFloorId);
  bindMapPoiEvents();
  // Captions are laid out AROUND the POI dots, so they can only be correct
  // once the dots for this step exist.
  updateLabelLayer();
}

/* Caption capsules — same cadence as the POIs they avoid. */
export function updateLabelLayer() {
  const el = $('map-labels');
  if (!el) return;
  el.innerHTML = buildLabelLayerHtml(mapState.selectedFloorId);
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
    $('map-area')?.setAttribute('aria-label', `Mapa da rota \u2014 ${getFloorLabel(floorId)}`);
    updatePoiLayer();
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
    // Update return button
    const rb = $('return-btn');
    const showReturn = navState.route && mapState.manualFloor;
    if (rb) rb.hidden = !showReturn;
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
