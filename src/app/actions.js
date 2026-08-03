import { SEARCH_CATEGORIES } from '../services/nodePresentation.js';
import {
  _searchDebounce,
  bindChoiceFooterEvents,
  bindFocusTrap,
  bindInstructionSwipe,
  bindRouteOptionEvents,
  bindTimelinePlaceEvents,
  releaseModalBackground,
} from './events.js';
import { app, appData, mapState, navState, planState, uiState } from '../state/appState.js';
import { render, updateRouteOverlay } from './router.js';
import { findNode } from '../state/selectors.js';
import { renderInstructionCardInner, renderOverlayOverview } from '../screens/navigation/NavigationScreen.js';
import { renderTimelineList } from '../screens/navigation/NavigationTimeline.js';
import { renderRouteDiagram } from '../screens/navigation/NavigationRouteMap.js';
import { renderSummaryStrip } from '../screens/navigation/NavigationShell.js';
import {
  renderChoiceFooterInner,
  renderChoiceOptions,
  renderMarginBanner,
} from '../screens/routeSummary/RouteSummaryScreen.js';
import { gateCloseClock, hasFlight } from '../services/flightSlack.js';
import { esc } from '../utils/format.js';
import { switchFloor } from '../map/floorSwitch.js';
import { autoFitRoute, fitStepToView } from '../map/mapFit.js';
import { prefersReducedMotion , $ } from '../utils/dom.js';
import { hasPlaceDetails } from '../components/PlaceDetailSheet.js';
import { attachStepDistances, buildSemanticSteps, formatMeters, pathMeters, segmentMeters } from '../services/routeSteps.js';
import { findOption, scoreOptions } from '../services/routeOptions.js';
import { buildSegments, normalizeStep } from '../services/normalize.js';

/* ============================================================
   14. ACTIONS
   ============================================================ */

/**
 * How long the navigation entrance runs, in ms. Must outlast the slowest
 * keyframe in the `.sg-map-inner.is-entering` block in navigation.css
 * (destination pop: 760ms delay + 460ms) — cut it short and the marker
 * freezes half-scaled.
 */
const ENTRANCE_MS = 1500;

/**
 * How long the timeline entrance runs, in ms. Must outlast the last node's
 * stagger — see `--i` in the .sg-tl__item rules — so a long route's bottom
 * rows are not frozen mid-fade when the class comes off. The stagger is
 * capped in CSS, which is what keeps this a constant and not a function of
 * the step count.
 */
const TIMELINE_ENTRANCE_MS = 1400;

/**
 * How long the "Ver trajeto" entrance runs, in ms. Must outlast the slowest
 * keyframe in the `.sg-nav-screen--trajeto.is-entering` block in
 * navigation-route-map.css (the marker pop: 760ms delay + 520ms).
 */
const ROUTE_MAP_ENTRANCE_MS = 1400;

export function openSearch(kind) {
  if (!['origin', 'destination'].includes(kind)) return;
  clearTimeout(_searchDebounce);
  uiState.searchOpenFor = kind;
  uiState.searchQuery = '';
  uiState.searchCategory = '';
  render();
}

export function closeSearch() {
  if (!uiState.searchOpenFor) return;
  const prev = uiState.searchOpenFor;
  uiState.searchOpenFor = '';
  uiState.searchQuery = '';
  uiState.searchCategory = '';
  clearTimeout(_searchDebounce);
  render();
  requestAnimationFrame(() => $(`${prev}-btn`)?.focus({ preventScroll: true }));
}

export let _detailTriggerEl = null;

export function openLocationDetail(code) {
  if (!code || !findNode(code)) return;
  _detailTriggerEl = document.activeElement;
  uiState.modalNodeCode = code;
  render();
  requestAnimationFrame(() => $('close-detail')?.focus({ preventScroll: true }));
}

export function closeLocationDetail() {
  if (!uiState.modalNodeCode) return;
  uiState.modalNodeCode = '';
  render();
  const trigger = _detailTriggerEl;
  _detailTriggerEl = null;
  requestAnimationFrame(() => trigger?.focus?.({ preventScroll: true }));
}

export function traceRouteToLocation(code) {
  uiState.modalNodeCode = '';
  selectLocation('destination', code);
}

/* ---- Place detail sheet (rich business card) ---- */
let _placeTriggerEl = null;
let _placeTriggerSel = '';
let _placeClosing = false;

/** Keep the exit here in sync with the CSS (.sg-place-overlay.is-closing). */
const PLACE_EXIT_MS = 240;

/**
 * render() rebuilds the whole DOM, so the node that opened the card is
 * detached by the time we close it. Remember how to find its replacement.
 */
function placeTriggerSelector(el) {
  if (!el || el === document.body) return '';
  if (el.id) return `#${el.id}`;
  const code = el.dataset?.code;
  if (code && el.classList.contains('sg-search-item__info')) {
    return `.sg-search-item__info[data-code="${code}"]`;
  }
  return '';
}

/**
 * The "i" target. Prefers the rich place card when we have a record for the
 * code; otherwise falls back to the legacy node detail so nothing regresses.
 */
export function openPlaceOrLocationDetail(code) {
  if (hasPlaceDetails(code)) return openPlaceDetail(code);
  return openLocationDetail(code);
}

export function openPlaceDetail(id, routeContext = null) {
  if (!hasPlaceDetails(id)) return;
  _placeTriggerEl = document.activeElement;
  _placeTriggerSel = placeTriggerSelector(_placeTriggerEl);
  uiState.placeDetailId = id;
  uiState.placeRouteContext = routeContext;
  render();
  requestAnimationFrame(() => $('place-detail-close')?.focus({ preventScroll: true }));
}

/**
 * Tapping a POI on the navigation map. Same card as everywhere else — it
 * just receives the extra route context, which the search flow never has.
 */
export function openPlaceFromMap(code) {
  if (!code) return;
  if (!hasPlaceDetails(code)) return openLocationDetail(code);
  return openPlaceDetail(code, buildRouteContext(code));
}

/**
 * The one contextual line the card gets when it is opened from an active
 * route. Deliberately conservative: distances are measured, never guessed.
 *
 * TODO(rota): show minutes instead of metres once we have a walking speed
 * we actually trust. The API gives a total time for the whole route, so a
 * per-leg estimate today would be a made-up number dressed as a fact.
 */
function buildRouteContext(code) {
  if (app.mode !== 'navigation' || !navState.route) return null;
  const path = navState.route.path ?? [];
  const target = findNode(code);
  if (!target || !path.length) return null;

  const here = navState.semanticSteps[navState.activeStepIndex]?.rawFrom ?? 0;
  const idx  = path.indexOf(code);

  // On the route, still ahead of the traveller: distance along the path.
  if (idx >= 0) {
    if (idx < here) return { text: 'No seu caminho · já passou' };
    const d = formatMeters(pathMeters(path, here, idx));
    return { text: d ? `No seu caminho · a ${d}` : 'No seu caminho' };
  }

  // Off the path: straight-line distance to the closest node of the route.
  let best = Infinity;
  path.forEach(c => {
    const n = findNode(c);
    if (n && n.floorId === target.floorId) best = Math.min(best, segmentMeters(n, target));
  });
  if (!Number.isFinite(best)) return null;
  const d = formatMeters(best);
  return { text: d ? `Perto da sua rota · a ${d}` : 'Perto da sua rota' };
}

/**
 * Close = play the exit, then unmount. The guard makes a second Escape/tap
 * during the 240ms a no-op instead of restarting the animation.
 */
export function closePlaceDetail() {
  if (!uiState.placeDetailId || _placeClosing) return;
  const overlay = $('place-detail');
  if (!overlay || prefersReducedMotion()) return unmountPlaceDetail();
  _placeClosing = true;
  overlay.classList.add('is-closing');
  setTimeout(unmountPlaceDetail, PLACE_EXIT_MS);
}

function unmountPlaceDetail() {
  _placeClosing = false;
  uiState.placeDetailId = '';
  uiState.placeRouteContext = null;
  render();
  const trigger = _placeTriggerEl, sel = _placeTriggerSel;
  _placeTriggerEl = null;
  _placeTriggerSel = '';
  // Return focus to the element that opened the card: the node itself if it
  // survived the re-render, else its freshly rendered twin. Falling back to
  // the search field keeps focus in context rather than dropping it to <body>.
  requestAnimationFrame(() => {
    const target = (trigger && document.contains(trigger))
      ? trigger
      : (sel && document.querySelector(sel)) || $('search-input');
    target?.focus?.({ preventScroll: true });
  });
}

/** "Traçar rota até aqui" — close the card and set it as the destination. */
export function tracePlaceRoute(code) {
  uiState.placeDetailId = '';
  uiState.placeRouteContext = null;
  selectLocation('destination', code);
}

export function selectLocation(kind, code) {
  if (uiState.loading === 'route') return;
  const other = kind === 'origin' ? planState.destinationCode : planState.originCode;
  if (!code || code === other) return;
  if (kind === 'origin')      planState.originCode = code;
  if (kind === 'destination') planState.destinationCode = code;
  navState.route = null;
  // Selecting the first endpoint immediately opens the missing counterpart.
  // This removes a return trip to Home without guessing either location.
  uiState.searchOpenFor = kind === 'origin' && !planState.destinationCode
    ? 'destination'
    : kind === 'destination' && !planState.originCode
      ? 'origin'
      : '';
  uiState.searchQuery = '';
  uiState.searchCategory = '';
  uiState.error = '';
  clearTimeout(_searchDebounce);
  if (app.mode !== 'planning') { app.mode = 'planning'; }
  render();
}

export function clearLocation(kind) {
  if (uiState.loading === 'route') return;
  if (kind === 'origin')      planState.originCode = '';
  if (kind === 'destination') planState.destinationCode = '';
  navState.route = null;
  navState.routeFloorIds = new Set();
  uiState.error = '';
  if (app.mode !== 'planning') { app.mode = 'planning'; }
  render();
  requestAnimationFrame(() => $(`${kind}-btn`)?.focus({ preventScroll: true }));
}

export function swapLocations() {
  if (uiState.loading === 'route') return;
  [planState.originCode, planState.destinationCode] = [planState.destinationCode, planState.originCode];
  navState.route = null;
  render();
}

export function setRouteMode(mode) {
  // Legacy path — used by summary screen back button etc.
  if (!['fastest', 'accessible'].includes(mode) || planState.routeMode === mode) return;
  planState.routeMode = mode;
  planState.accessibleRoute = mode === 'accessible';
  navState.route = null;
  render();
}

export function toggleAccessibleRoute() {
  if (uiState.loading === 'route') return;
  planState.accessibleRoute = !planState.accessibleRoute;
  planState.routeMode = planState.accessibleRoute ? 'accessible' : 'fastest';
  navState.route = null;
  // Announce state change for screen readers
  const liveEl = $('plan-status');
  if (liveEl) liveEl.textContent = planState.accessibleRoute
    ? 'Evitar escadas ativado. Vamos priorizar elevadores sempre que possível.'
    : 'Rota acessível desativada. Rota mais rápida será usada.';
  // Update only the toggle without full re-render for performance
  const toggleEl = $('accessible-toggle');
  if (toggleEl) {
    const on = planState.accessibleRoute;
    toggleEl.classList.toggle('is-on', on);
    toggleEl.setAttribute('aria-checked', String(on));
    // Find the accessibility icon in the row label (new structure)
    const rowLabel = toggleEl.closest('.sg-access-row')?.querySelector('.sg-access-row__icon');
    const icon = rowLabel ?? toggleEl.previousElementSibling?.querySelector('iconify-icon');
    if (icon) {
      icon.classList.toggle('is-on', on);
      icon.classList.toggle('is-active', on); // backward compat
    }
  } else {
    render();
  }
}

export function openCategorySearch(catKey) {
  // Open destination search pre-filtered by category
  const cat = SEARCH_CATEGORIES.find(c => c.key === catKey);
  if (!cat) return;
  clearTimeout(_searchDebounce);
  uiState.searchOpenFor = 'destination';
  uiState.searchQuery = '';
  uiState.searchCategory = cat.key;
  render();
}

export function editRoute() {
  navState.route = null;
  navState.routeFloorIds = new Set();
  navState.semanticSteps = [];
  navState.activeStepIndex = 0;
  navState.routeOptions = [];
  navState.selectedOptionId = '';
  uiState.riskAcknowledged = false;
  app.mode = 'planning';
  render();
}

/* ============================================================
   FLIGHT TIME — the one time input in the app (Home)
   ============================================================ */

/**
 * Patched in place, never re-rendered: a full render() would tear out the
 * <input type="time"> mid-edit and drop the caret on every keystroke. Only the
 * copy line under the label changes as the value becomes valid, so that is the
 * only thing rewritten.
 */
export function setFlightTime(value) {
  if (uiState.loading === 'route') return;
  planState.flightTime = String(value ?? '');
  refreshFlightField();
}

export function setFlightDay(value) {
  if (uiState.loading === 'route' || !['today', 'tomorrow'].includes(value)) return;
  planState.flightDay = value;
  refreshFlightField();
}

export function setFlightType(value) {
  if (uiState.loading === 'route' || !['domestic', 'international'].includes(value)) return;
  planState.flightType = value;
  refreshFlightField();
}

function refreshFlightField() {
  const block = document.querySelector('.sg-home__flight');
  const help  = $('flight-help');
  if (!block || !help) return;

  const filled = hasFlight();
  block.classList.toggle('is-filled', filled);
  const clear = $('flight-clear');
  if (clear) {
    clear.classList.toggle('is-hidden', !filled);
    clear.disabled = !filled;
  }
  // Must match flightField() in HomeScreen.js — the estimated gate closing is
  // never shown as a bare time.
  help.innerHTML = filled
    ? `${planState.flightDay === 'tomorrow' ? 'Amanhã' : 'Hoje'} · portão fecha <strong>~${esc(gateCloseClock())}</strong> (estimado).`
    : 'Adicione seu voo e veja quanto tempo sobra.';
}

export function clearFlightTime() {
  if (uiState.loading === 'route') return;
  planState.flightTime = '';
  render();
  requestAnimationFrame(() => {
    const input = $('flight-time');
    const disclosure = input?.closest('details');
    if (disclosure) disclosure.open = true;
    input?.focus({ preventScroll: true });
  });
}

/**
 * "Adicionar horário do voo" from the choice screen. Goes back to Home with
 * the route intact and lands the passenger ON the field, so the invitation
 * costs one tap rather than a hunt.
 */
export function addFlightFromChoice() {
  app.mode = 'planning';
  render();
  requestAnimationFrame(() => {
    const input = $('flight-time');
    const disclosure = input?.closest('details');
    if (disclosure) disclosure.open = true;
    input?.focus({ preventScroll: true });
    input?.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  });
}

/* ============================================================
   ROUTE CHOICE SCREEN — which way to walk
   ============================================================ */

/**
 * Pick a way to walk the route. The cards are patched in place rather than
 * re-rendered: they are real radios, and rebuilding them mid-interaction would
 * drop focus out of the group and break arrow-key selection.
 *
 * The FOOTER is rebuilt, because it changes shape with the choice — a viable
 * route gets a summary line, an unviable one gets the warning and its
 * acknowledgement gate. The acknowledgement resets: it was about the OTHER
 * route, and consenting to miss one flight is not consent for the next.
 */
export function selectRouteOption(id) {
  if (!id || navState.selectedOptionId === id) return;
  navState.selectedOptionId = id;
  // Progress belongs to the path it was confirmed on. A different route
  // starts at its own first step instead of inheriting an unrelated index.
  navState.activeStepIndex = 0;
  uiState.riskAcknowledged = false;
  document.querySelectorAll('.sg-rc-opt').forEach(el => {
    el.classList.toggle('is-selected', el.querySelector('.route-option-input')?.value === id);
  });
  refreshChoiceFooter();
}

/** The passenger accepted that this route arrives after estimated gate close. */
export function toggleRiskAck(on) {
  uiState.riskAcknowledged = !!on;
  const cta = $('start-nav-btn');
  if (cta) cta.disabled = !on;
}

function refreshChoiceFooter() {
  const footer = document.querySelector('.sg-rc__footer');
  if (!footer) return;
  footer.innerHTML = renderChoiceFooterInner();
  bindChoiceFooterEvents();
}

/** Recompute every time-sensitive part without tearing down the whole screen. */
export function refreshSummaryTiming() {
  if (app.mode !== 'summary' || !navState.route) return;

  const active = document.activeElement;
  const focusedOption = active?.classList?.contains('route-option-input') ? active.value : '';
  const focusedId = active?.id ?? '';

  const margin = document.querySelector('.sg-rc__margin');
  if (margin && hasFlight()) margin.outerHTML = renderMarginBanner();

  const list = $('route-option-list');
  if (list) {
    const options = scoreOptions(navState.routeOptions ?? []);
    list.innerHTML = renderChoiceOptions(options, findOption(options, navState.selectedOptionId));
    bindRouteOptionEvents();
  }
  refreshChoiceFooter();

  requestAnimationFrame(() => {
    const target = focusedOption
      ? document.querySelector(`.route-option-input[value="${CSS.escape(focusedOption)}"]`)
      : focusedId ? $(focusedId) : null;
    target?.focus?.({ preventScroll: true });
  });
}

function isSelectedRouteUnviable() {
  const scored = scoreOptions(navState.routeOptions ?? []);
  return findOption(scored, navState.selectedOptionId)?.slack?.status === 'inviavel';
}

/**
 * Carry the chosen way into navigation.
 *
 * Alternatives are accepted only when the backend supplies a complete,
 * navigable path. All derived route state is rebuilt atomically here so the
 * floor map, instructions and progress always describe the same option.
 */
function applySelectedRouteOption() {
  const option = findOption(navState.routeOptions ?? [], navState.selectedOptionId);
  const path = option?.path ?? [];
  if (!option || !path.length) return;

  const base = navState.route;
  if (base?.optionId === option.id) return;

  const steps = option.steps?.length
    ? option.steps.map((step, index) => normalizeStep(step, index))
    : [];
  const segments = buildSegments(path);
  navState.route = {
    ...base,
    optionId: option.id,
    path,
    steps,
    segments,
    warnings: option.warnings ?? [],
    estimatedMinutes: option.minutes,
  };
  navState.routeFloorIds = new Set(
    segments.filter(segment => segment.type === 'floor').map(segment => segment.floorId).filter(Boolean)
  );
  navState.semanticSteps = attachStepDistances(buildSemanticSteps(navState.route), path);
}

export function openOverview() {
  uiState.showOverview = true;
  // Partial: just inject the overlay
  const existing = $('route-overview');
  if (existing) return;
  const navScreen = $('nav-screen');
  if (navScreen) {
    navScreen.insertAdjacentHTML('beforeend', renderOverlayOverview());
    bindFocusTrap($('route-overview'));
    document.querySelector('.sg-overview-item__btn')?.focus({ preventScroll: true });
    // Bind events for new overlay
    $('close-overview')?.addEventListener('click', closeOverview);
    $('overview-backdrop')?.addEventListener('click', closeOverview);
    document.querySelectorAll('.sg-overview-item__btn').forEach(btn =>
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.stepIndex, 10);
        if (!isNaN(idx)) { closeOverview(); goToStep(idx); }
      })
    );
  }
}

export function closeOverview() {
  uiState.showOverview = false;
  const overlay = $('route-overview');
  releaseModalBackground(overlay);
  overlay?.remove();
}

export function returnToCurrentStep() {
  if (!navState.route) return;
  const stepFloor = navState.semanticSteps[navState.activeStepIndex]?.floorId
    ?? [...navState.routeFloorIds][0]
    ?? appData.floors[0]?.id;
  if (stepFloor) { switchFloor(stepFloor, false); }
  mapState.manualFloor = false;
  const rb = $('return-btn');
  if (rb) rb.classList.add('is-hidden');
  requestAnimationFrame(() => autoFitRoute());
}

export function startNavigation() {
  if (!navState.semanticSteps.length) return;
  // Belt and braces: the CTA is already disabled in this state, but the guard
  // means no other caller can start a route that arrives after gate closing
  // without the passenger having said so.
  if (isSelectedRouteUnviable() && !uiState.riskAcknowledged) {
    // The deadline may have crossed while Summary stayed open. Refresh the
    // visible risk gate instead of making the primary action fail silently.
    refreshSummaryTiming();
    requestAnimationFrame(() => $('risk-ack')?.focus({ preventScroll: true }));
    return;
  }
  applySelectedRouteOption();
  app.mode = 'navigation';
  // A route that was temporarily exited resumes at the passenger's last
  // confirmed step. A newly calculated route already starts at zero.
  navState.activeStepIndex = Math.min(
    Math.max(0, navState.activeStepIndex),
    Math.max(0, navState.semanticSteps.length - 1),
  );
  // The real floor plan is the spatial source of truth. Instructions remain
  // one tap away in the companion Etapas view.
  navState.view = 'map';

  const activeStep = navState.semanticSteps[navState.activeStepIndex];
  const targetFloor = activeStep?.floorId || findNode(planState.originCode)?.floorId || mapState.selectedFloorId;
  mapState.selectedFloorId = targetFloor;
  mapState.manualFloor = false;

  render();
  playMapEntrance();
  bindInstructionSwipe();
}

export function restartNavigation() {
  if (!navState.route) return;
  navState.activeStepIndex = 0;
  startNavigation();
}

/**
 * Timeline entrance: the nodes fade in top-to-bottom and the connector grows
 * down behind them. Driven by one class, like the map entrance, and removed
 * when it ends — the list is re-rendered in place on every step change, and
 * a class left on would replay the whole opening each time.
 */
function playTimelineEntrance() {
  const screen = $('nav-screen');
  if (!screen || prefersReducedMotion()) return;
  screen.classList.add('is-entering');
  setTimeout(() => screen.classList.remove('is-entering'), TIMELINE_ENTRANCE_MS);
}

/** Open the real floor map on the passenger's confirmed active step. */
export function showRouteMap() {
  if (!navState.route) return;
  // The toggle shows both tabs in both views, so the active one gets clicked.
  // Re-rendering the view you are already on would replay its entrance for
  // no reason; switching views is idempotent instead.
  if (navState.view === 'map') return;
  navState.view = 'map';
  const step = navState.semanticSteps[navState.activeStepIndex];
  if (step?.floorId) mapState.selectedFloorId = step.floorId;
  mapState.manualFloor = false;
  render();
  playMapEntrance();
  bindInstructionSwipe();
  requestAnimationFrame(() => $('tab-route-btn')?.focus({ preventScroll: true }));
}

/** Backward-compatible name for callers that explicitly request the plan. */
export function showFloorPlan() {
  if (!navState.route) return;
  navState.view = 'map';
  const step = navState.semanticSteps[navState.activeStepIndex];
  if (step?.floorId) mapState.selectedFloorId = step.floorId;
  mapState.manualFloor = false;
  render();
  playMapEntrance();
  bindInstructionSwipe();
}

/** Back to the timeline, on the same step. Idempotent, like showRouteMap(). */
export function showTimeline() {
  if (navState.view === 'timeline') return;
  navState.view = 'timeline';
  render();
  playTimelineEntrance();
  scrollTimelineToCurrent('auto');
  requestAnimationFrame(() => $('tab-steps-btn')?.focus({ preventScroll: true }));
}

/**
 * Diagram entrance: the walked line draws itself, then the stops land. Same
 * contract as the other two — one class, removed when it ends, because the
 * diagram is re-rendered in place on every step change.
 */
function playRouteMapEntrance() {
  const screen = $('nav-screen');
  if (!screen || prefersReducedMotion()) return;
  screen.classList.add('is-entering');
  setTimeout(() => screen.classList.remove('is-entering'), ROUTE_MAP_ENTRANCE_MS);
}

function playMapEntrance() {
  // After render: play the entrance and frame the CURRENT LEG close up.
  // The old whole-route overview left the route as a small squiggle in a
  // large dark field on a phone; autoFitRoute zooms to the leg being walked.
  //
  // ENTRANCE. One class on .sg-map-inner drives the whole choreography in
  // CSS: the plan settles in, the route draws itself along its length, then
  // the markers pop in origin → landmarks → destination. It has to come off
  // again (ENTRANCE_MS), because the route overlay and POI layers are
  // re-rendered inside this element on every step change — leave the class
  // on and each step would replay the whole opening sequence.
  //
  // Nothing here animates the header, the FABs or the sheet: autoFitRoute
  // measures those three elements to work out the visible region, and a
  // moving target gives a wrong frame.
  if (!prefersReducedMotion()) {
    requestAnimationFrame(() => {
      const inner = $('map-inner');
      if (inner) {
        inner.classList.add('is-entering');
        setTimeout(() => inner.classList.remove('is-entering'), ENTRANCE_MS);
      }
      setTimeout(() => autoFitRoute(), 100);
    });
  } else {
    requestAnimationFrame(() => autoFitRoute(0));
  }
}

export function exitNavigation() {
  app.mode = 'summary';
  mapState.manualFloor = false;
  render();
}

/**
 * Finish is intentionally different from temporarily leaving navigation.
 * The destination becomes the next journey's origin, while all route-derived
 * state is cleared so stale steps can never leak into a new calculation.
 */
export function finishNavigation() {
  if (app.mode !== 'navigation' || !navState.semanticSteps.length) return;

  const completedDestination = planState.destinationCode;
  planState.originCode = completedDestination;
  planState.destinationCode = '';

  navState.route = null;
  navState.semanticSteps = [];
  navState.activeStepIndex = 0;
  navState.routeFloorIds = new Set();
  navState.routeOptions = [];
  navState.selectedOptionId = '';
  navState.view = 'map';

  mapState.manualFloor = false;
  uiState.showOverview = false;
  uiState.floorMenuOpen = false;
  uiState.routeAnimating = false;
  uiState.riskAcknowledged = false;
  uiState.modalNodeCode = '';
  uiState.placeDetailId = '';
  uiState.placeRouteContext = null;
  uiState.error = '';

  app.mode = 'planning';
  render();
  requestAnimationFrame(() => {
    $('nav-live')?.replaceChildren(document.createTextNode('Rota finalizada.'));
    $('destination-btn')?.focus({ preventScroll: true });
  });
}

/** The stable footer action: advance until the final step, then finish. */
export function activateNavigationPrimary() {
  const last = navState.semanticSteps.length - 1;
  if (last < 0) return;
  if (navState.activeStepIndex >= last) {
    finishNavigation();
    return;
  }
  advanceStep(1);
}

export function goToStep(idx) {
  const total = navState.semanticSteps.length;
  if (idx < 0 || idx >= total) return;
  applyStepChange(idx);
}

export function advanceStep(delta) {
  const total = navState.semanticSteps.length;
  const next  = navState.activeStepIndex + delta;
  if (next < 0 || next >= total) return;
  applyStepChange(next);
}

/**
 * Move the active step and refresh whichever view is on screen.
 *
 * The views share the state but not the update path: the timeline swaps its
 * list and scrolls, the diagram redraws itself, the plan redraws its overlay
 * and re-frames. Doing all three regardless would run the plan's fit against
 * elements that are not in the document, which is how you get a silent
 * ReferenceError per keypress.
 */
function applyStepChange(idx) {
  navState.activeStepIndex = idx;
  const step = navState.semanticSteps[idx];
  if (step?.floorId && step.floorId !== mapState.selectedFloorId) {
    switchFloor(step.floorId, false);
  }

  if (navState.view === 'map') {
    // Update only changed parts (no full re-render)
    updateInstructionCard();
    updateRouteOverlay();
    // Always re-frame; fitStepToView itself drops the animation to 0ms under
    // prefers-reduced-motion, so skipping it entirely just left the map behind.
    requestAnimationFrame(() => fitStepToView(idx));
  } else if (navState.view === 'trajeto') {
    updateRouteMap();
  } else {
    updateTimeline();
  }

  announceStep(idx, step);
}

/**
 * Redraw the metro diagram in place.
 *
 * The whole SVG is rebuilt rather than patched: one step moves the boundary
 * between the solid and the dotted line, retypes three pills and moves the
 * marker, which is most of the drawing anyway. Only the panel is touched, so
 * the frame stays put and the entrance choreography is not replayed.
 */
export function updateRouteMap() {
  // The panel id is shared with the timeline, so check it is actually the
  // diagram before overwriting it.
  const el = $('navigation-view');
  if (!el?.classList.contains('sg-rt__map')) return;
  el.innerHTML = renderRouteDiagram();
  updateTimelineFooter();
  scrollRouteMapToCurrent();
}

/**
 * Keep the traveller's marker on screen after a step.
 *
 * A third down the viewport, like the timeline, so what fills the screen
 * below it is the part of the trip that has not happened yet.
 */
export function scrollRouteMapToCurrent(behavior) {
  const scroller = $('nav-scroll');
  const here     = $('rt-here');
  if (!scroller || !here) return;
  const mode = behavior ?? (prefersReducedMotion() ? 'auto' : 'smooth');
  // Rect deltas, not offsetTop: the marker is an SVG node, which has no
  // offsetTop at all, and the scroller is not its offsetParent either.
  const delta = here.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
  const top = scroller.scrollTop + delta - scroller.clientHeight * 0.32;
  scroller.scrollTo({ top: Math.max(0, top), behavior: mode });
}

/**
 * Re-render the timeline list in place and bring the new current node into
 * view. The list is swapped rather than diffed because a step change moves
 * the done/current/upcoming boundary on nearly every row anyway.
 */
export function updateTimeline() {
  const list = $('tl-list');
  if (!list) return;
  list.innerHTML = renderTimelineList();
  bindTimelinePlaceEvents();
  updateTimelineFooter();
  scrollTimelineToCurrent();
}

/** Keep Previous/Next/Finish and the summary strip honest after a step.
    Both views render the same footer button and the same strip, so both
    refresh through here. */
function updateTimelineFooter() {
  const isFirst = navState.activeStepIndex <= 0;
  const isLast = navState.activeStepIndex >= navState.semanticSteps.length - 1;
  const previous = $('nav-prev');
  if (previous) previous.disabled = isFirst;
  const next = $('nav-next');
  if (next) {
    next.disabled = false;
    const label = next.querySelector('span');
    if (label) label.textContent = isLast ? 'Finalizar rota' : 'Próxima etapa';
    const icon = next.querySelector('iconify-icon:last-of-type');
    if (icon) icon.setAttribute('icon', isLast ? 'solar:flag-2-bold' : 'solar:arrow-right-linear');
  }
  const strip = document.querySelector('.sg-tl__strip');
  if (strip) strip.outerHTML = renderSummaryStrip();
}

/**
 * Scroll the current node to a comfortable reading position — a third down
 * the viewport, not dead centre, so the steps that come NEXT are the ones
 * filling the screen below it.
 */
export function scrollTimelineToCurrent(behavior) {
  const scroller = $('nav-scroll');
  const current  = document.querySelector('.sg-tl__item.is-current');
  if (!scroller || !current) return;
  const mode = behavior ?? (prefersReducedMotion() ? 'auto' : 'smooth');
  // Measured from rects, not offsetTop. Timeline items are position:relative
  // but the scroller is not, so their offsetParent is the fixed screen —
  // offsetTop therefore included the header and scrolled every step short by
  // its height. Rect deltas do not care what the offsetParent happens to be.
  const delta = current.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
  const top = scroller.scrollTop + delta - scroller.clientHeight * 0.28;
  scroller.scrollTo({ top: Math.max(0, top), behavior: mode });
}

export function updateInstructionCard() {
  const card = $('instruction-card');
  if (!card) return;

  card.innerHTML = renderInstructionCardInner();
  // The card itself no longer scrolls — its middle band does.
  card.querySelector('.sg-navsheet__scroll')?.scrollTo(0, 0);

  // Re-bind the controls the sheet owns
  $('nav-next')?.addEventListener('click', activateNavigationPrimary);
  $('nav-prev')?.addEventListener('click', () => advanceStep(-1));
  $('instr-steps-btn')?.addEventListener('click', openOverview);
  bindInstructionSwipe();
}

export function announceStep(idx, step) {
  const liveEl = $('nav-live');
  if (liveEl) liveEl.textContent = `Etapa ${idx + 1} de ${navState.semanticSteps.length}: ${step?.text ?? ''}`;
}

export function showHelp() {
  const existing = $('help-dialog');
  if (existing) { existing.close?.(); existing.remove(); return; }

  const trigger = document.activeElement;
  const dialog = document.createElement('dialog');
  dialog.id = 'help-dialog';
  dialog.className = 'sg-ds sg-help';
  dialog.setAttribute('aria-labelledby', 'help-title');

  const content = app.mode === 'navigation'
    ? {
        eyebrow: 'Durante a rota',
        title: 'Navegue no seu ritmo',
        items: [
          ['lucide:map', 'Mapa real', 'Use o mapa para se orientar e Etapas para conferir o trajeto completo.'],
          ['lucide:circle-check', 'Confirme seu avanço', 'Próxima etapa registra manualmente onde você chegou.'],
          ['lucide:rotate-ccw', 'Saia sem perder o ponto', 'Ao voltar, a rota continua na última etapa confirmada.'],
        ],
      }
    : app.mode === 'summary'
      ? {
          eyebrow: 'Antes de começar',
          title: 'Escolha com confiança',
          items: [
            ['lucide:route', 'Compare rotas reais', 'Opções só aparecem quando o aeroporto oferece caminhos diferentes.'],
            ['lucide:clock-3', 'Confira a margem', 'O horário do voo ajuda a estimar quanto tempo ainda sobra.'],
            ['lucide:play', 'Inicie ou retome', 'Seu progresso é preservado quando você sai temporariamente da navegação.'],
          ],
        }
      : {
          eyebrow: 'Planeje sua rota',
          title: 'Chegue sem complicação',
          items: [
            ['lucide:map-pin', 'Escolha dois pontos', 'Selecione onde você está e para onde quer ir.'],
            ['lucide:plane-takeoff', 'Adicione seu voo', 'Dia, horário e tipo do voo melhoram a estimativa de margem.'],
            ['lucide:accessibility', 'Evite escadas', 'Ative a preferência para priorizar caminhos com elevadores.'],
          ],
        };

  dialog.innerHTML = `
    <div class="sg-help__handle" aria-hidden="true"></div>
    <header class="sg-help__header">
      <div>
        <p class="sg-help__eyebrow">${esc(content.eyebrow)}</p>
        <h2 class="sg-help__title" id="help-title">${esc(content.title)}</h2>
      </div>
      <button type="button" class="sg-help__close" aria-label="Fechar ajuda">
        <iconify-icon icon="lucide:x" aria-hidden="true"></iconify-icon>
      </button>
    </header>
    <ul class="sg-help__list">
      ${content.items.map(([icon, title, copy]) => `<li>
        <span class="sg-help__icon" aria-hidden="true"><iconify-icon icon="${esc(icon)}"></iconify-icon></span>
        <span><strong>${esc(title)}</strong><small>${esc(copy)}</small></span>
      </li>`).join('')}
    </ul>
    <button type="button" class="ds-btn ds-btn--primary ds-btn--block sg-help__done">Entendi</button>
  `;

  const close = () => {
    dialog.close?.();
    dialog.remove();
    trigger?.focus?.({ preventScroll: true });
  };
  dialog.querySelector('.sg-help__close')?.addEventListener('click', close);
  dialog.querySelector('.sg-help__done')?.addEventListener('click', close);
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  dialog.addEventListener('click', event => { if (event.target === dialog) close(); });
  document.body.appendChild(dialog);
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
  requestAnimationFrame(() => dialog.querySelector('.sg-help__close')?.focus({ preventScroll: true }));
}
