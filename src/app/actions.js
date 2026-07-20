import { SEARCH_CATEGORIES } from '../services/nodePresentation.js';
import { _searchDebounce, bindInstructionSwipe } from './events.js';
import { app, appData, mapState, navState, planState, uiState } from '../state/appState.js';
import { render, updateRouteOverlay } from './router.js';
import { findNode } from '../state/selectors.js';
import { renderInstructionCardInner, renderOverlayOverview } from '../screens/navigation/NavigationScreen.js';
import { switchFloor } from '../map/floorSwitch.js';
import { fitFullRoute, fitStepToView } from '../map/mapFit.js';
import { prefersReducedMotion , $ } from '../utils/dom.js';

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
  requestAnimationFrame(() => fitStepToView(navState.activeStepIndex));
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

  // After render: animate the route in and frame the whole journey, so the
  // "you are here → destination" overview matches the reference screen.
  if (!prefersReducedMotion()) {
    requestAnimationFrame(() => {
      const routeEl = document.querySelector('.sg-route-active');
      if (routeEl) { routeEl.classList.add('sg-route-draw'); }
      setTimeout(fitFullRoute, 100);
    });
  } else {
    requestAnimationFrame(fitFullRoute);
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
  requestAnimationFrame(() => {
    if (!prefersReducedMotion()) fitStepToView(next);
  });
  announceStep(next, step);
}

export function updateInstructionCard() {
  const card = $('instruction-card');
  if (!card) return;

  card.innerHTML = renderInstructionCardInner();
  card.scrollTop = 0;

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

