import { getPublicNodeLabel, SEARCH_CATEGORIES } from '../services/nodePresentation.js';
import {
  _searchDebounce,
  bindChoiceFooterEvents,
  bindFocusTrap,
  bindRouteOptionEvents,
  releaseModalBackground,
} from './events.js';
import { app, appData, mapState, navState, planState, uiState } from '../state/appState.js';
import { persistJourney, render, updateStepLayer } from './router.js';
import { findNode } from '../state/selectors.js';
import {
  renderChoiceFooterInner,
  renderChoiceOptions,
  renderMarginBanner,
} from '../screens/routeSummary/RouteSummaryScreen.js';
import {
  effectiveFlightDay,
  flightDateForDay,
  gateCloseClock,
  hasFlight,
} from '../services/flightSlack.js';
import { esc } from '../utils/format.js';
import { switchFloor } from '../map/floorSwitch.js';
import { autoFitRoute, fitStepToView } from '../map/mapFit.js';
import { prefersReducedMotion , $ } from '../utils/dom.js';
import { hasPlaceDetails } from '../components/PlaceDetailSheet.js';
import { attachStepDistances, buildSemanticSteps, formatMeters, pathMeters, segmentMeters } from '../services/routeSteps.js';
import { findOption, routeForSelectedOption, scoreOptions } from '../services/routeOptions.js';
import { getCurrentRouteNode } from '../map/floorMapBuilder.js';
import { setSheetDetent } from '../screens/navigation/stepsSheet.js';


/* ============================================================
   14. ACTIONS
   ============================================================ */

/**
 * How long the navigation entrance runs, in ms. Must outlast the slowest
 * keyframe in the `.sg-map-inner.is-entering` block in navigation.css
 * (badges: 720ms delay + 420ms) — cut it short and a badge freezes
 * half-scaled.
 */
const ENTRANCE_MS = 1300;

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
let _detailTriggerSel = '';

/** A full render detaches the opener; keep a selector for its replacement. */
function stableDetailTriggerSelector(el) {
  if (!el || el === document.body) return '';
  if (el.id) return `#${CSS.escape(el.id)}`;

  const code = el.dataset?.code;
  if (code && el.classList.contains('sg-search-item__info')) {
    return `.sg-search-item__info[data-code="${CSS.escape(code)}"]`;
  }
  if (code && el.classList.contains('sg-poi')) {
    return `.sg-poi[data-code="${CSS.escape(code)}"]`;
  }

  const placeCode = el.dataset?.placeCode;
  if (placeCode && el.classList.contains('sg-step__place')) {
    return `.sg-step__place[data-place-code="${CSS.escape(placeCode)}"]`;
  }
  return '';
}

function detailFocusFallback() {
  return $('search-input')
    ?? $('sheet-grip')
    ?? $('calc-btn');
}

export function openLocationDetail(code) {
  if (!code || !findNode(code)) return;
  _detailTriggerEl = document.activeElement;
  _detailTriggerSel = stableDetailTriggerSelector(_detailTriggerEl);
  uiState.modalNodeCode = code;
  render();
  requestAnimationFrame(() => $('close-detail')?.focus({ preventScroll: true }));
}

export function closeLocationDetail() {
  if (!uiState.modalNodeCode) return;
  uiState.modalNodeCode = '';
  render();
  const trigger = _detailTriggerEl;
  const selector = _detailTriggerSel;
  _detailTriggerEl = null;
  _detailTriggerSel = '';
  requestAnimationFrame(() => {
    const target = trigger && document.contains(trigger)
      ? trigger
      : (selector && document.querySelector(selector)) || detailFocusFallback();
    target?.focus?.({ preventScroll: true });
  });
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
  return stableDetailTriggerSelector(el);
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

  const idx  = path.indexOf(code);

  // On the route: walking distance from the start of the trip.
  if (idx >= 0) {
    const d = formatMeters(pathMeters(path, 0, idx));
    return { text: d ? `No seu caminho · a ${d} da partida` : 'No seu caminho' };
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
      : (sel && document.querySelector(sel)) || detailFocusFallback();
    target?.focus?.({ preventScroll: true });
  });
}

/** "Traçar rota até aqui" — close the card and set it as the destination. */
export function tracePlaceRoute(code) {
  uiState.placeDetailId = '';
  uiState.placeRouteContext = null;

  // From active navigation the app has no idea where the passenger is, so
  // the replan keeps the trip's origin (getCurrentRouteNode resolves to it).
  // selectLocation retains the existing validation, cleanup, render and
  // focus flow after this origin correction.
  if (app.mode === 'navigation' && navState.route) {
    const currentCode = getCurrentRouteNode()?.code;
    if (currentCode === code) { render(); return; }
    if (currentCode && currentCode !== code) planState.originCode = currentCode;
  }
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
  if (!uiState.searchOpenFor) {
    requestAnimationFrame(() => {
      const status = $('plan-status');
      if (status) status.textContent = 'Origem e destino selecionados. Tra\u00e7ar rota dispon\u00edvel.';
      $('calc-btn')?.focus({ preventScroll: true });
    });
  }
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
  requestAnimationFrame(() => {
    const status = $('plan-status');
    if (status) status.textContent = 'Origem e destino invertidos.';
    $('swap-btn')?.focus({ preventScroll: true });
  });
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
  persistJourney();
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
  navState.hasStarted = false;
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
  if (hasFlight()) {
    planState.flightDay = effectiveFlightDay();
    planState.flightDate = flightDateForDay(planState.flightDay);
  } else {
    planState.flightDate = '';
  }
  refreshFlightField();
  persistJourney();
}

export function setFlightDay(value) {
  if (uiState.loading === 'route' || !['today', 'tomorrow'].includes(value)) return;
  planState.flightDay = value;
  planState.flightDate = hasFlight() ? flightDateForDay(value) : '';
  refreshFlightField();
  persistJourney();
}

export function setFlightType(value) {
  if (uiState.loading === 'route' || !['domestic', 'international'].includes(value)) return;
  planState.flightType = value;
  refreshFlightField();
  persistJourney();
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
    ? `${effectiveFlightDay() === 'tomorrow' ? 'Amanhã' : 'Hoje'} · portão fecha <strong>~${esc(gateCloseClock())}</strong> (estimado).`
    : 'Adicione seu voo e veja quanto tempo sobra.';
}

export function clearFlightTime() {
  if (uiState.loading === 'route') return;
  planState.flightTime = '';
  planState.flightDate = '';
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
  // A different route is a different trip: it opens fresh, not as "retomar".
  navState.activeStepIndex = 0;
  navState.hasStarted = false;
  uiState.riskAcknowledged = false;
  document.querySelectorAll('.sg-rc-opt').forEach(el => {
    el.classList.toggle('is-selected', el.querySelector('.route-option-input')?.value === id);
  });
  refreshChoiceFooter();
  persistJourney();
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
    if (target && !target.matches(':disabled')) {
      target.focus({ preventScroll: true });
      return;
    }
    ($('risk-ack') ?? document.querySelector('.route-option-input:checked'))
      ?.focus({ preventScroll: true });
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
 * navigable path. The direct API route may intentionally be steps-only; its
 * original steps and segments stay intact so progress remains restorable.
 */
function applySelectedRouteOption() {
  const option = findOption(navState.routeOptions ?? [], navState.selectedOptionId);
  const base = navState.route;
  if (!option || !base || base.optionId === option.id) return;

  const selectedRoute = routeForSelectedOption(base, option);
  if (!selectedRoute) return;
  navState.route = selectedRoute;
  const { path, segments } = selectedRoute;
  navState.routeFloorIds = new Set(
    segments.filter(segment => segment.type === 'floor').map(segment => segment.floorId).filter(Boolean)
  );
  navState.semanticSteps = attachStepDistances(buildSemanticSteps(navState.route), path);
}


/* ============================================================
   NAVIGATION — one screen, every step visible, nothing to confirm
   ============================================================ */

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
  // There is no current step to resume at: the whole route is shown every
  // time. hasStarted only records that the trip was opened, which is what
  // lets the choice screen say "retomar" instead of "iniciar".
  navState.hasStarted = true;
  uiState.focusedStepIndex = -1;
  uiState.sheetDetent = 'half';
  uiState.floorMenuOpen = false;

  const firstStep = navState.semanticSteps[0];
  const targetFloor = firstStep?.floorId || findNode(planState.originCode)?.floorId || mapState.selectedFloorId;
  mapState.selectedFloorId = targetFloor;
  mapState.manualFloor = false;

  render();
  playMapEntrance();
}

export function restartNavigation() {
  if (!navState.route) return;
  navState.activeStepIndex = 0;
  navState.hasStarted = false;
  startNavigation();
}

function playMapEntrance() {
  // After render: play the entrance and frame the WHOLE route on this floor.
  // One class on .sg-map-inner drives the choreography in CSS: the plan
  // settles in, the route draws itself along its length, the badges arrive.
  // It has to come off again (ENTRANCE_MS), because the overlay layers are
  // re-rendered inside this element on every floor change.
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
  uiState.focusedStepIndex = -1;
  uiState.floorMenuOpen = false;
  render();
}

/**
 * Centre the map on one step. A LOOK, not a confirmation: nothing about
 * the route's state changes, the list keeps every row, and the traveller
 * can tap any step in any order.
 *
 * @param {number} idx
 * @param {{ fromMap?: boolean }} [opts]  true when the tap came from a map
 *   badge — then the list is scrolled to the row instead of the other way
 *   round, so the two stay in sync whichever one was touched.
 */
export function focusStep(idx, { fromMap = false } = {}) {
  const step = navState.semanticSteps[idx];
  if (!step) return;
  const toggledOff = uiState.focusedStepIndex === idx && !fromMap;
  uiState.focusedStepIndex = toggledOff ? -1 : idx;
  refreshFocusedStep();

  if (toggledOff) {
    requestAnimationFrame(() => autoFitRoute(280));
  } else if (step.floorId && step.floorId !== mapState.selectedFloorId) {
    // updateMapForFloor re-renders the overlays and re-frames through
    // autoFitRoute, which now honours the focused step.
    switchFloor(step.floorId, false);
  } else {
    updateStepLayer();
    requestAnimationFrame(() => fitStepToView(idx, 320) || autoFitRoute(320));
  }

  // The map has to be visible for the tap to have meant anything.
  if (!toggledOff && uiState.sheetDetent === 'full') setSheetDetent('half');

  if (fromMap && !toggledOff) {
    const row = document.querySelector(`.sg-step[data-step-index="${idx}"]`);
    row?.scrollIntoView({ block: 'center', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
    if (uiState.sheetDetent === 'collapsed') setSheetDetent('half');
    row?.querySelector('.sg-step__hit')?.focus({ preventScroll: true });
  }

  const liveEl = $('nav-live');
  if (liveEl) {
    liveEl.textContent = toggledOff
      ? 'Mostrando a rota completa no mapa.'
      : `Mostrando o passo ${idx + 1} no mapa: ${String(step.text ?? '')}`;
  }
}

/** Keep the list rows and the map badges agreeing on which step is focused. */
export function refreshFocusedStep() {
  const focused = uiState.focusedStepIndex;
  document.querySelectorAll('.sg-step').forEach(row => {
    const idx = Number(row.dataset.stepIndex);
    const on = idx === focused;
    row.classList.toggle('is-focused', on);
    row.querySelector('.sg-step__hit')?.setAttribute('aria-pressed', on ? 'true' : 'false');
  });
  document.querySelectorAll('.sg-map-step').forEach(badge => {
    badge.classList.toggle('is-focused', Number(badge.dataset.stepIndex) === focused);
  });
}

/**
 * The recentre control: the focused step if there is one (switching to
 * its floor when needed), otherwise the whole route on a floor it runs on.
 */
export function recenterMap() {
  if (!navState.route) return;
  const focused = navState.semanticSteps[uiState.focusedStepIndex];
  if (focused) {
    if (focused.floorId && focused.floorId !== mapState.selectedFloorId) {
      switchFloor(focused.floorId, false);
    } else {
      requestAnimationFrame(() => autoFitRoute(320));
    }
    return;
  }
  const onRoute = navState.routeFloorIds.has(mapState.selectedFloorId);
  const firstRouteFloor = navState.semanticSteps[0]?.floorId ?? [...navState.routeFloorIds][0];
  if (!onRoute && firstRouteFloor) {
    switchFloor(firstRouteFloor, false);
  } else {
    requestAnimationFrame(() => autoFitRoute(320));
  }
}

/** The sheet moved: what is visible changed, so the frame is recomputed. */
export function onSheetSnap() {
  if (app.mode !== 'navigation' || !navState.route) return;
  // After the height transition, not during it — the fit measures the sheet.
  setTimeout(() => autoFitRoute(260), prefersReducedMotion() ? 0 : 300);
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
          ['lucide:list', 'Todos os passos, sempre', 'Arraste a lista para cima ou para baixo. Não há nada para confirmar.'],
          ['lucide:map-pin', 'Toque num passo', 'O mapa centraliza naquele ponto; os números do mapa são os da lista.'],
          ['lucide:layers', 'Atenção às trocas de piso', 'Elas aparecem destacadas na lista e no mapa; use o botão de pisos para ver outro andar.'],
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
