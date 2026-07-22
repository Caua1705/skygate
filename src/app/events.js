import { $ } from '../utils/dom.js';
import { advanceStep, clearLocation, closeLocationDetail, closePlaceDetail, closeOverview, closeSearch, editRoute, exitNavigation, goToStep, openCategorySearch, openLocationDetail, openPlaceFromMap, openPlaceOrLocationDetail, openOverview, openSearch, returnToCurrentStep, selectLocation, selectRouteOption, setBudgetTime, setRouteMode, setTimeBudget, showHelp, showRouteMap, showTimeline, startNavigation, swapLocations, toggleAccessibleRoute, traceRouteToLocation, tracePlaceRoute } from './actions.js';
import { handleCalculate } from './routeController.js';
import { init } from './bootstrap.js';
import { app, navState, uiState } from '../state/appState.js';
import { render, updateSearchChips_, updateSearchResults_ } from './router.js';
import { autoFitRoute } from '../map/mapFit.js';
import { zoomAt } from '../map/mapPanZoom.js';
import { renderFloorControl } from '../screens/navigation/NavigationScreen.js';
import { switchFloor } from '../map/floorSwitch.js';
import { DEBOUNCE_MS } from './constants.js';

/* ============================================================
   13. EVENT BINDING
   ============================================================ */

export let _searchDebounce = null;

export function bindEvents() {
  // Planning
  document.querySelectorAll('.open-search').forEach(btn =>
    btn.addEventListener('click', () => openSearch(btn.dataset.kind))
  );
  // Clear buttons are real <button>s and siblings of the field button, so
  // they need no stopPropagation and get Enter/Space for free.
  document.querySelectorAll('.clear-loc').forEach(btn =>
    btn.addEventListener('click', () => clearLocation(btn.dataset.kind))
  );
  $('swap-btn')?.addEventListener('click', swapLocations);
  document.querySelectorAll('[data-mode]').forEach(btn =>
    btn.addEventListener('click', () => setRouteMode(btn.dataset.mode))
  );
  $('calc-btn')?.addEventListener('click', handleCalculate);
  $('help-btn')?.addEventListener('click', showHelp);
  $('retry-btn')?.addEventListener('click', init);
  $('dismiss-error')?.addEventListener('click', () => { uiState.error = ''; render(); });

  // Accessible route toggle (compact replacement for two big mode cards)
  $('accessible-toggle')?.addEventListener('click', toggleAccessibleRoute);

  // Quick category shortcuts — open destination search pre-filtered by category.
  // .sg-home-quick is the Home's own hook: it deliberately does NOT reuse
  // .sg-quick-card, whose legacy width:122px!important (planning-v5.css) would
  // otherwise leak into the Home shortcuts.
  document.querySelectorAll('.sg-quick__item, .sg-quick-item, .sg-quick-card, .sg-home-quick').forEach(btn =>
    btn.addEventListener('click', () => openCategorySearch(btn.dataset.catKey))
  );

  // Route choice ("Escolha seu caminho")
  $('start-nav-btn')?.addEventListener('click', startNavigation);
  $('back-to-planning-btn')?.addEventListener('click', () => { app.mode = 'planning'; render(); });
  $('edit-route-btn')?.addEventListener('click', editRoute);
  document.querySelectorAll('.sg-rc__chip[data-budget]').forEach(btn =>
    btn.addEventListener('click', () => setTimeBudget(btn.dataset.budget))
  );
  // `input`, not `change`: the fit badges should follow the clock the traveller
  // is typing, and the field is never re-rendered from under them.
  $('budget-time')?.addEventListener('input', e => setBudgetTime(e.target.value));
  bindRouteOptionEvents();

  // Navigation
  $('exit-nav-btn')?.addEventListener('click', exitNavigation);
  // Timeline ⇄ trajeto. ONE control, rendered by NavigationShell and present
  // in both views — clicking the tab that is already active re-renders the
  // same view, which is the correct no-op.
  $('tab-steps-btn')?.addEventListener('click', showTimeline);
  $('tab-route-btn')?.addEventListener('click', showRouteMap);
  // The old top-down plan's own back button (see showFloorPlan).
  $('back-to-timeline-btn')?.addEventListener('click', showTimeline);
  bindTimelinePlaceEvents();
  $('nav-prev')?.addEventListener('click', () => advanceStep(-1));
  $('nav-next')?.addEventListener('click', () => advanceStep(1));
  $('fit-segment-btn')?.addEventListener('click', () => autoFitRoute());
  $('zoom-in-btn')?.addEventListener('click', () => zoomAt(0.4));
  $('zoom-out-btn')?.addEventListener('click', () => zoomAt(-0.4));
  $('overview-btn')?.addEventListener('click', openOverview);
  $('instr-steps-btn')?.addEventListener('click', openOverview);
  $('return-btn')?.addEventListener('click', returnToCurrentStep);

  // Floor control
  bindFloorControlEvents();

  // POIs on the map — same detail card as search, plus route context
  bindMapPoiEvents();

  // Overview
  $('close-overview')?.addEventListener('click', closeOverview);
  $('overview-backdrop')?.addEventListener('click', closeOverview);
  document.querySelectorAll('.sg-overview-item__btn').forEach(btn =>
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.stepIndex, 10);
      if (!isNaN(idx)) { closeOverview(); goToStep(idx); }
    })
  );

  // Search
  bindSearchOverlayEvents();

  // Location detail sheet (legacy node-based)
  $('detail-backdrop')?.addEventListener('click', closeLocationDetail);
  $('close-detail')?.addEventListener('click', closeLocationDetail);
  $('detail-route-btn')?.addEventListener('click', e => {
    const code = e.currentTarget.dataset.code;
    if (code) traceRouteToLocation(code);
  });

  // Place detail sheet (rich business card)
  $('place-detail-backdrop')?.addEventListener('click', closePlaceDetail);
  $('place-detail-close')?.addEventListener('click', closePlaceDetail);
  $('place-route-btn')?.addEventListener('click', e => {
    const code = e.currentTarget.dataset.code;
    if (code) tracePlaceRoute(code);
  });
  bindFocusTrap($('place-detail'));
}

/**
 * Keep Tab focus inside a dialog while it is open. Cheap and dependency-free:
 * wrap from last→first and first→last. Returning focus to the trigger is done
 * by the close action.
 */
export function bindFocusTrap(container) {
  if (!container) return;
  container.addEventListener('keydown', e => {
    if (e.key !== 'Tab') return;
    const f = [...container.querySelectorAll(
      'a[href], button:not([disabled]), input, [tabindex]:not([tabindex="-1"])'
    )].filter(el => el.offsetParent !== null || el === document.activeElement);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
}

/**
 * The route cards are real radios, so `change` covers click, Space and the
 * arrow keys in one listener. Exported because the list is re-rendered in
 * place whenever the time budget changes (refreshRouteChoice).
 */
export function bindRouteOptionEvents() {
  document.querySelectorAll('.route-option-input').forEach(input =>
    input.addEventListener('change', () => { if (input.checked) selectRouteOption(input.value); })
  );
}

/**
 * POI markers live in their own layer that is re-rendered on every step and
 * floor change, so this is exported and called again after those updates.
 */
/**
 * Timeline nodes that carry a business open the same rich card as the map
 * POIs and the search list — same action, so the "No seu caminho" context
 * line comes along for free. Exported because the list is re-rendered on
 * every step change.
 */
export function bindTimelinePlaceEvents() {
  document.querySelectorAll('.sg-tl__hit[data-place-code]').forEach(btn =>
    btn.addEventListener('click', () => openPlaceFromMap(btn.dataset.placeCode))
  );
}

export function bindMapPoiEvents() {
  document.querySelectorAll('.sg-poi').forEach(btn =>
    btn.addEventListener('click', e => {
      e.stopPropagation();
      openPlaceFromMap(btn.dataset.code);
    })
  );
}

export function bindFloorControlEvents() {
  $('floor-trigger-btn')?.addEventListener('click', e => {
    e.stopPropagation();
    uiState.floorMenuOpen = !uiState.floorMenuOpen;
    if (app.mode === 'navigation') {
      const fc = $('floor-ctrl');
      if (fc) { fc.outerHTML = renderFloorControl(); bindFloorControlEvents(); }
    } else {
      render();
    }
  });
  document.querySelectorAll('.sg-floor-item').forEach(btn =>
    btn.addEventListener('click', e => {
      e.stopPropagation();
      uiState.floorMenuOpen = false;
      switchFloor(btn.dataset.floorId, true);
    })
  );
  document.addEventListener('click', closeFloorMenuOnOutside);
}

export function closeFloorMenuOnOutside(e) {
  if (!uiState.floorMenuOpen) return;
  if (!e.target.closest('#floor-ctrl')) {
    uiState.floorMenuOpen = false;
    const fc = $('floor-ctrl');
    if (fc) { fc.outerHTML = renderFloorControl(); bindFloorControlEvents(); }
    document.removeEventListener('click', closeFloorMenuOnOutside);
  }
}

export function bindSearchOverlayEvents() {
  $('search-backdrop')?.addEventListener('click', closeSearch);
  $('close-search')?.addEventListener('click', closeSearch);
  const input = $('search-input');
  if (input) {
    input.addEventListener('input', e => {
      uiState.searchQuery = e.target.value;
      // Typing exits category-filter mode — text search and chip filters are mutually exclusive
      if (uiState.searchCategory) {
        uiState.searchCategory = '';
        updateSearchChips_();
      }
      clearTimeout(_searchDebounce);
      _searchDebounce = setTimeout(updateSearchResults_, DEBOUNCE_MS);
    });
    requestAnimationFrame(() => input.focus({ preventScroll: true }));
  }
  bindSearchItemEvents();
  document.querySelectorAll('.sg-chip').forEach(btn =>
    btn.addEventListener('click', () => {
      const key = btn.dataset.catKey;
      uiState.searchCategory = uiState.searchCategory === key ? '' : key;
      uiState.searchQuery = '';
      const inp = $('search-input');
      if (inp) inp.value = '';
      updateSearchChips_();
      updateSearchResults_();
    })
  );
}

export function bindSearchItemEvents() {
  document.querySelectorAll('.sg-search-item').forEach(btn =>
    btn.addEventListener('click', () => selectLocation(btn.dataset.kind, btn.dataset.code))
  );
  // Tapping the row selects the place for the route; tapping the "i" opens the
  // rich detail card (falling back to the legacy node detail when unmocked).
  document.querySelectorAll('.sg-search-item__info').forEach(btn =>
    btn.addEventListener('click', e => { e.stopPropagation(); openPlaceOrLocationDetail(btn.dataset.code); })
  );
}

// Carousel swipe for instruction card
export let _instrSwipeStart = null;
export function bindInstructionSwipe() {
  const card = $('instruction-card');
  if (!card) return;
  card.addEventListener('touchstart', e => {
    if (e.touches.length !== 1) return;
    _instrSwipeStart = { x: e.touches[0].clientX, t: Date.now() };
  }, { passive: true });
  card.addEventListener('touchend', e => {
    if (!_instrSwipeStart) return;
    const dx = e.changedTouches[0].clientX - _instrSwipeStart.x;
    const dt = Date.now() - _instrSwipeStart.t;
    _instrSwipeStart = null;
    if (Math.abs(dx) < 40 || dt > 500) return;
    if (dx < 0) advanceStep(1);
    else advanceStep(-1);
  }, { passive: true });
}

// Keyboard
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (uiState.placeDetailId) { closePlaceDetail(); return; }
    if (uiState.modalNodeCode) { closeLocationDetail(); return; }
    if (uiState.showOverview)  { closeOverview(); return; }
    if (uiState.searchOpenFor) { e.preventDefault(); closeSearch(); return; }
    if (uiState.floorMenuOpen) { uiState.floorMenuOpen = false; document.getElementById('floor-ctrl')?.querySelector('button')?.focus(); return; }
    // Escape unwinds one layer at a time, matching the back button: from a
    // second view back to the timeline, and only from the timeline out of
    // the trip.
    if (app.mode === 'navigation' && navState.view !== 'timeline') { showTimeline(); return; }
    if (app.mode === 'navigation') { exitNavigation(); return; }
  }
  if (app.mode === 'navigation' && !uiState.searchOpenFor && !uiState.showOverview) {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); advanceStep(1); }
    if (e.key === 'ArrowLeft'  || e.key === 'ArrowUp')   { e.preventDefault(); advanceStep(-1); }
  }
});

