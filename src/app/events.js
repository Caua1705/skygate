import { $ } from '../utils/dom.js';
import {
  activateNavigationPrimary, addFlightFromChoice, advanceStep, clearFlightTime,
  clearLocation, closeLocationDetail, closePlaceDetail, closeOverview, closeSearch,
  editRoute, exitNavigation, goToStep, openCategorySearch, openLocationDetail,
  openPlaceFromMap, openPlaceOrLocationDetail, openOverview, openSearch,
  restartNavigation, returnToCurrentStep, selectLocation, selectRouteOption,
  setFlightDay, setFlightTime, setFlightType, setRouteMode, showHelp,
  showRouteMap, showTimeline, startNavigation, swapLocations,
  toggleAccessibleRoute, toggleRiskAck, traceRouteToLocation, tracePlaceRoute,
} from './actions.js';
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

  // Flight time (Home). `input`, not `change`: the derived gate deadline
  // should appear as soon as the value is valid, and the field is never
  // re-rendered from under the caret.
  $('flight-time')?.addEventListener('input', e => setFlightTime(e.target.value));
  $('flight-clear')?.addEventListener('click', clearFlightTime);
  document.querySelectorAll('input[name="flight-day"]').forEach(input =>
    input.addEventListener('change', () => { if (input.checked) setFlightDay(input.value); })
  );
  document.querySelectorAll('input[name="flight-type"]').forEach(input =>
    input.addEventListener('change', () => { if (input.checked) setFlightType(input.value); })
  );

  // Route choice ("Escolha seu caminho")
  $('back-to-planning-btn')?.addEventListener('click', () => { app.mode = 'planning'; render(); });
  $('edit-route-btn')?.addEventListener('click', editRoute);
  $('add-flight-btn')?.addEventListener('click', addFlightFromChoice);
  $('restart-nav-btn')?.addEventListener('click', restartNavigation);
  bindRouteOptionEvents();
  bindChoiceFooterEvents();

  // Navigation
  $('exit-nav-btn')?.addEventListener('click', exitNavigation);
  // Timeline ⇄ trajeto. ONE control, rendered by NavigationShell and present
  // in both views — clicking the tab that is already active re-renders the
  // same view, which is the correct no-op.
  bindNavigationTabs();
  // The old top-down plan's own back button (see showFloorPlan).
  $('back-to-timeline-btn')?.addEventListener('click', showTimeline);
  bindTimelinePlaceEvents();
  $('nav-prev')?.addEventListener('click', () => advanceStep(-1));
  $('nav-next')?.addEventListener('click', activateNavigationPrimary);
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
  // Only the topmost dialog owns focus. Detail sheets can open over Search,
  // so trapping every mounted overlay would make the top sheet inert too.
  bindFocusTrap(
    $('place-detail')
    ?? $('detail-overlay')
    ?? $('route-overview')
    ?? $('search-overlay')
  );
}

/** Keyboard-complete two-view tablist: Etapas | Mapa. */
export function bindNavigationTabs() {
  const tabs = [$('tab-steps-btn'), $('tab-route-btn')].filter(Boolean);
  if (tabs.length !== 2) return;

  const activate = tab => {
    if (tab.id === 'tab-route-btn') showRouteMap();
    else showTimeline();
  };

  tabs.forEach(tab => {
    tab.addEventListener('click', () => activate(tab));
    tab.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      event.stopPropagation();
      const current = tabs.indexOf(event.currentTarget);
      const target = event.key === 'Home' ? tabs[0]
        : event.key === 'End' ? tabs.at(-1)
        : tabs[(current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
      activate(target);
    });
  });
}

/**
 * Keep Tab focus inside a dialog while it is open. Cheap and dependency-free:
 * wrap from last→first and first→last. Returning focus to the trigger is done
 * by the close action.
 */
export function bindFocusTrap(container) {
  if (!container) return;
  const parent = container.parentElement;
  [...(parent?.children ?? [])].forEach(sibling => {
    if (sibling !== container) sibling.inert = true;
  });
  container.addEventListener('keydown', e => {
    if (e.key !== 'Tab') return;
    const f = [...container.querySelectorAll(
      'a[href]:not([tabindex="-1"]), button:not([disabled]):not([tabindex="-1"]), input:not([disabled]):not([tabindex="-1"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )].filter(el => el.offsetParent !== null || el === document.activeElement);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
}

export function releaseModalBackground(container) {
  const parent = container?.parentElement;
  [...(parent?.children ?? [])].forEach(sibling => { sibling.inert = false; });
}

/**
 * The route cards are real radios, so `change` covers click, Space and the
 * arrow keys in one listener.
 */
export function bindRouteOptionEvents() {
  document.querySelectorAll('.route-option-input').forEach(input =>
    input.addEventListener('change', () => { if (input.checked) selectRouteOption(input.value); })
  );
}

/**
 * The footer is rebuilt whenever the selection changes shape (a viable route's
 * summary line vs an unviable one's warning + acknowledgement), so its
 * controls are bound separately from the rest of the screen.
 */
export function bindChoiceFooterEvents() {
  $('start-nav-btn')?.addEventListener('click', startNavigation);
  $('risk-ack')?.addEventListener('change', e => toggleRiskAck(e.target.checked));
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
    setFloorMenuOpen(!uiState.floorMenuOpen, true);
  });
  const items = [...document.querySelectorAll('.sg-floor-item')];
  items.forEach((btn, index) => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      uiState.floorMenuOpen = false;
      switchFloor(btn.dataset.floorId, true);
      requestAnimationFrame(() => $('floor-trigger-btn')?.focus({ preventScroll: true }));
    });
    btn.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setFloorMenuOpen(false, true);
        return;
      }
      if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const target = event.key === 'Home' ? items[0]
        : event.key === 'End' ? items.at(-1)
        : items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length];
      target?.focus({ preventScroll: true });
    });
  });
  document.addEventListener('click', closeFloorMenuOnOutside);
}

function setFloorMenuOpen(open, restoreFocus = false) {
  uiState.floorMenuOpen = !!open;
  if (app.mode !== 'navigation') { render(); return; }
  const control = $('floor-ctrl');
  if (!control) return;
  control.outerHTML = renderFloorControl();
  bindFloorControlEvents();
  if (restoreFocus) {
    requestAnimationFrame(() => {
      const target = open
        ? document.querySelector('.sg-floor-item.is-active') ?? document.querySelector('.sg-floor-item')
        : $('floor-trigger-btn');
      target?.focus({ preventScroll: true });
    });
  }
}

export function closeFloorMenuOnOutside(e) {
  if (!uiState.floorMenuOpen) return;
  if (!e.target.closest('#floor-ctrl')) {
    setFloorMenuOpen(false, false);
  }
}

/**
 * Keep the search sheet pinned to the VISUAL viewport.
 *
 * Without this, opening the keyboard on iOS leaves the layout viewport at full
 * height, so the sheet's lower half — the results list — sits behind the
 * keyboard. Sizing the overlay to visualViewport.height and offsetting it by
 * offsetTop puts the sheet's bottom edge exactly on top of the keyboard, so
 * the list keeps whatever room is left instead of being covered.
 *
 * The listener lives on the (global) visualViewport, but the overlay is torn
 * out and rebuilt by every render(), so it is re-attached or detached from
 * bindSearchOverlayEvents() on each pass — see the guard there.
 */
let _vvHandler = null;
/* Focus is moved into the sheet exactly ONCE per opening. bindEvents() runs on
   every render, and re-focusing there would pull the caret out of the search
   field any time anything else re-rendered. Reset when the overlay is gone. */
let _searchFocused = false;

function detachSearchViewport_() {
  const vv = window.visualViewport;
  if (vv && _vvHandler) {
    vv.removeEventListener('resize', _vvHandler);
    vv.removeEventListener('scroll', _vvHandler);
  }
  _vvHandler = null;
}

function attachSearchViewport_(overlay) {
  const vv = window.visualViewport;
  if (!vv) return;               // no support: the sheet keeps its dvh height
  detachSearchViewport_();
  _vvHandler = () => {
    // The overlay may already be gone (closed between frames).
    if (!overlay.isConnected) { detachSearchViewport_(); return; }
    overlay.style.height = `${vv.height}px`;
    overlay.style.transform = `translateY(${vv.offsetTop}px)`;
  };
  vv.addEventListener('resize', _vvHandler);
  vv.addEventListener('scroll', _vvHandler);
  _vvHandler();
}

export function bindSearchOverlayEvents() {
  const overlay = $('search-overlay');
  if (!overlay) { detachSearchViewport_(); _searchFocused = false; return; }
  attachSearchViewport_(overlay);

  /* Focus the SHEET, not the field. The dialog is aria-modal, so focus has to
     move inside it or a keyboard/screen-reader user is stranded on a trigger
     the modal just hid. A container with tabindex="-1" takes focus without
     summoning the keyboard, and Tab from there reaches the field first. */
  if (!_searchFocused) {
    _searchFocused = true;
    requestAnimationFrame(() => $('search-sheet')?.focus({ preventScroll: true }));
  }

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
    /* NO AUTOFOCUS — deliberate, do not restore.
       Focusing here raised the keyboard the instant the sheet opened, which
       ate ~55% of the screen and left about one result row visible. Origin in
       particular is almost always PICKED from the list, not typed, so the
       keyboard was in the way of the common path. The field is the first
       thing in the sheet and one tap away when someone does want to type. */
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
    if (uiState.floorMenuOpen) { e.preventDefault(); setFloorMenuOpen(false, true); return; }
    if (app.mode === 'navigation') { exitNavigation(); return; }
  }
  const interactiveTarget = e.target instanceof Element && e.target.closest(
    'button, a, input, select, textarea, [role="tab"], [contenteditable="true"]'
  );
  if (app.mode === 'navigation' && !uiState.searchOpenFor && !uiState.showOverview && !interactiveTarget) {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); advanceStep(1); }
    if (e.key === 'ArrowLeft'  || e.key === 'ArrowUp')   { e.preventDefault(); advanceStep(-1); }
  }
});

