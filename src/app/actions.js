import { SEARCH_CATEGORIES } from '../services/nodePresentation.js';
import { _searchDebounce, bindInstructionSwipe } from './events.js';
import { app, appData, mapState, navState, planState, uiState } from '../state/appState.js';
import { render, updateRouteOverlay } from './router.js';
import { findNode } from '../state/selectors.js';
import { renderInstructionCardInner, renderOverlayOverview } from '../screens/navigation/NavigationScreen.js';
import { switchFloor } from '../map/floorSwitch.js';
import { autoFitRoute, fitStepToView } from '../map/mapFit.js';
import { prefersReducedMotion , $ } from '../utils/dom.js';
import { hasPlaceDetails } from '../components/PlaceDetailSheet.js';
import { formatMeters, pathMeters, segmentMeters } from '../services/routeSteps.js';

/* ============================================================
   14. ACTIONS
   ============================================================ */

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
  const other = kind === 'origin' ? planState.destinationCode : planState.originCode;
  if (!code || code === other) return;
  if (kind === 'origin')      planState.originCode = code;
  if (kind === 'destination') planState.destinationCode = code;
  navState.route = null;
  uiState.searchOpenFor = '';
  uiState.searchQuery = '';
  uiState.searchCategory = '';
  uiState.error = '';
  clearTimeout(_searchDebounce);
  if (app.mode !== 'planning') { app.mode = 'planning'; }
  render();
}

export function clearLocation(kind) {
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
  planState.accessibleRoute = !planState.accessibleRoute;
  planState.routeMode = planState.accessibleRoute ? 'accessible' : 'fastest';
  navState.route = null;
  // Announce state change for screen readers
  const liveEl = $('plan-status');
  if (liveEl) liveEl.textContent = planState.accessibleRoute
    ? 'Rota acessível ativada. Usará elevadores e evitará escadas.'
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
  app.mode = 'planning';
  render();
}

export function openOverview() {
  uiState.showOverview = true;
  // Partial: just inject the overlay
  const existing = $('route-overview');
  if (existing) return;
  const navScreen = $('nav-screen');
  if (navScreen) {
    navScreen.insertAdjacentHTML('beforeend', renderOverlayOverview());
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
  $('route-overview')?.remove();
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
  app.mode = 'navigation';
  navState.activeStepIndex = 0;

  const firstStep = navState.semanticSteps[0];
  const targetFloor = firstStep?.floorId || findNode(planState.originCode)?.floorId || mapState.selectedFloorId;
  mapState.selectedFloorId = targetFloor;
  mapState.manualFloor = false;

  render();

  // After render: animate the route in and frame the CURRENT LEG close up.
  // The old whole-route overview left the route as a small squiggle in a
  // large dark field on a phone; autoFitRoute zooms to the leg being walked.
  if (!prefersReducedMotion()) {
    requestAnimationFrame(() => {
      // Class renamed with the map restyle: .sg-route-active → the active leg
      const routeEl = document.querySelector('.sg-route__line.is-active');
      if (routeEl) { routeEl.classList.add('sg-route-draw'); }
      setTimeout(() => autoFitRoute(), 100);
    });
  } else {
    requestAnimationFrame(() => autoFitRoute(0));
  }
  bindInstructionSwipe();
}

export function exitNavigation() {
  app.mode = 'summary';
  mapState.manualFloor = false;
  render();
}

export function goToStep(idx) {
  const total = navState.semanticSteps.length;
  if (idx < 0 || idx >= total) return;
  navState.activeStepIndex = idx;
  const step = navState.semanticSteps[idx];
  if (step?.floorId && step.floorId !== mapState.selectedFloorId) {
    switchFloor(step.floorId, false);
  }
  updateInstructionCard();
  updateRouteOverlay();
  requestAnimationFrame(() => fitStepToView(idx));
  announceStep(idx, step);
}

export function advanceStep(delta) {
  const total = navState.semanticSteps.length;
  const next  = navState.activeStepIndex + delta;
  if (next < 0 || next >= total) return;
  navState.activeStepIndex = next;

  const step = navState.semanticSteps[next];
  if (step?.floorId && step.floorId !== mapState.selectedFloorId) {
    switchFloor(step.floorId, false);
  }

  // Update only changed parts (no full re-render)
  updateInstructionCard();
  updateRouteOverlay();
  // Always re-frame; fitStepToView itself drops the animation to 0ms under
  // prefers-reduced-motion, so skipping it entirely just left the map behind.
  requestAnimationFrame(() => fitStepToView(next));
  announceStep(next, step);
}

export function updateInstructionCard() {
  const card = $('instruction-card');
  if (!card) return;

  card.innerHTML = renderInstructionCardInner();
  // The card itself no longer scrolls — its middle band does.
  card.querySelector('.sg-navsheet__scroll')?.scrollTo(0, 0);

  // Re-bind the controls the sheet owns
  $('nav-next')?.addEventListener('click', () => advanceStep(1));
  $('instr-steps-btn')?.addEventListener('click', openOverview);
  bindInstructionSwipe();
}

export function announceStep(idx, step) {
  const liveEl = $('nav-live');
  if (liveEl) liveEl.textContent = `Passo ${idx + 1} de ${navState.semanticSteps.length}: ${step?.text ?? ''}`;
}

export function showHelp() {
  const existing = $('help-toast');
  if (existing) { existing.remove(); return; }
  const el = document.createElement('div');
  el.id = 'help-toast';
  el.setAttribute('role', 'status');
  el.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#0f172a;color:#fff;padding:14px 20px;border-radius:14px;font-size:13px;font-weight:600;box-shadow:0 8px 28px rgba(0,0,0,.4);z-index:300;max-width:320px;text-align:center;line-height:1.6';
  el.innerHTML = '<strong>Como usar o SkyGate</strong><br>1. Escolha origem e destino<br>2. Selecione o tipo de rota<br>3. Calcule e toque em "Iniciar navegação"<br>4. Use ← Anterior / Próximo → para navegar';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 6000);
}

