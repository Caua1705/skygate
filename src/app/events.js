import { $ } from '../utils/dom.js';
import {
  addFlightFromChoice, clearFlightTime,
  clearLocation, closeLocationDetail, closePlaceDetail, closeSearch,
  editRoute, exitNavigation, focusStep, onSheetSnap, openCategorySearch, openLocationDetail,
  openPlaceFromMap, openPlaceOrLocationDetail, openSearch, recenterMap,
  restartNavigation, selectLocation, selectRouteOption,
  setFlightDay, setFlightTime, setFlightType, setRouteMode, showHelp,
  startNavigation, swapLocations,
  toggleAccessibleRoute, toggleRiskAck, traceRouteToLocation, tracePlaceRoute,
} from './actions.js';
import { handleCalculate } from './routeController.js';
import { init } from './bootstrap.js';
import { app, uiState } from '../state/appState.js';
import { render, updateSearchChips_, updateSearchResults_ } from './router.js';
import { renderFloorControl } from '../screens/navigation/NavigationScreen.js';
import { bindStepsSheet, unbindStepsSheet } from '../screens/navigation/stepsSheet.js';
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
  $('retry-route-btn')?.addEventListener('click', handleCalculate);
  $('focus-steps')?.addEventListener('click', () => {
    $('sheet-grip')?.focus({ preventScroll: true });
  });
  $('help-btn')?.addEventListener('click', showHelp);
  $('retry-btn')?.addEventListener('click', init);
  $('dismiss-error')?.addEventListener('click', () => {
    uiState.error = '';
    render();
    requestAnimationFrame(() => $('calc-btn')?.focus({ preventScroll: true }));
  });

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

  // Navigation — one screen: map, banner, two controls, the step sheet.
  $('exit-nav-btn')?.addEventListener('click', exitNavigation);
  $('recenter-btn')?.addEventListener('click', recenterMap);
  if (app.mode === 'navigation') bindStepsSheet({ onSnap: onSheetSnap });
  else unbindStepsSheet();
  bindStepListEvents();
  bindMapStepEvents();

  // Floor control
  bindFloorControlEvents();

  // POIs on the map — same detail card as search, plus route context
  bindMapPoiEvents();

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
    ?? $('search-overlay')
  );
}

/**
 * The step list. Tapping a row centres the map on that step; the place
 * chip beside a row (when the step goes through a business we have a
 * record for) opens the same detail card as the map POIs and the search.
 */
export function bindStepListEvents() {
  document.querySelectorAll('.sg-step__hit[data-step-index]').forEach(btn =>
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.stepIndex, 10);
      if (!Number.isNaN(idx)) focusStep(idx);
    })
  );
  document.querySelectorAll('.sg-step__place[data-place-code]').forEach(btn =>
    btn.addEventListener('click', () => openPlaceFromMap(btn.dataset.placeCode))
  );
}

/**
 * Numbered badges on the map. Delegated to the layer container, which
 * survives every innerHTML swap of its contents (floor changes, zoom
 * relayouts), so nothing has to be re-bound.
 */
export function bindMapStepEvents() {
  const layer = $('map-steps');
  if (!layer || layer.dataset.bound) return;
  layer.dataset.bound = 'true';
  layer.addEventListener('click', e => {
    const badge = e.target.closest('.sg-map-step[data-step-index]');
    if (!badge) return;
    e.stopPropagation();
    const idx = parseInt(badge.dataset.stepIndex, 10);
    if (!Number.isNaN(idx)) focusStep(idx, { fromMap: true });
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
 * POI markers live in their own layer that is re-rendered on every floor
 * change, so this is exported and called again after those updates.
 */
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
/* Focus is moved once per endpoint sheet. Tracking the KIND, not a boolean,
   lets the origin -> destination handoff focus the replacement dialog while
   same-dialog renders leave the search caret alone. */
let _searchFocusedKind = '';

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
  if (!overlay) { detachSearchViewport_(); _searchFocusedKind = ''; return; }
  attachSearchViewport_(overlay);

  /* Focus the SHEET, not the field. The dialog is aria-modal, so focus has to
     move inside it or a keyboard/screen-reader user is stranded on a trigger
     the modal just hid. A container with tabindex="-1" takes focus without
     summoning the keyboard, and Tab from there reaches the field first. */
  if (_searchFocusedKind !== uiState.searchOpenFor) {
    _searchFocusedKind = uiState.searchOpenFor;
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

// Keyboard
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    // The modal help dialog owns Escape through its `cancel` event. Letting
    // this fall through would close Help and leave active navigation too.
    if ($('help-dialog')) return;
    if (uiState.placeDetailId) { closePlaceDetail(); return; }
    if (uiState.modalNodeCode) { closeLocationDetail(); return; }
    if (uiState.searchOpenFor) { e.preventDefault(); closeSearch(); return; }
    if (uiState.floorMenuOpen) { e.preventDefault(); setFloorMenuOpen(false, true); return; }
    if (app.mode === 'navigation') { exitNavigation(); return; }
  }
});

