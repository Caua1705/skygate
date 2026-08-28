/**
 * stepsSheet — the three-height bottom sheet that holds the step list.
 *
 * Detents:
 *   collapsed   only the summary line is visible
 *   half        about half the screen
 *   full        nearly the whole screen; the banner stays above it
 *
 * Heights are measured, not assumed: collapsed is the summary's own height,
 * full stops just under the banner, and both are recomputed on resize so a
 * rotated phone or an opened keyboard cannot leave the sheet mid-air.
 *
 * Dragging is on the HEAD (grip + summary) only. The list underneath is a
 * normal scroller, and a sheet that also drags from its list fights that
 * scroll on every flick. Keyboard: the grip is a button — ArrowUp/ArrowDown
 * move one detent, Enter/Space toggle collapsed ⇄ half. Desktop and phone
 * landscape turn the sheet into a side column and detents no longer apply.
 *
 * Pure DOM; state lives in uiState.sheetDetent so a re-render keeps the
 * height the traveller chose.
 */
import { uiState } from '../../state/appState.js';
import { $, prefersReducedMotion } from '../../utils/dom.js';

const DETENTS = ['collapsed', 'half', 'full'];
/** Where the sheet is a side column instead (keep in sync with navigation-sheet.css). */
const SIDE_COLUMN = '(min-width: 1024px), (orientation: landscape) and (max-height: 600px) and (min-width: 560px)';

/** Distance, in px, a drag must travel before it counts as a drag. */
const DRAG_SLOP = 6;
/** Velocity (px/ms) above which a flick jumps a detent regardless of distance. */
const FLICK = 0.45;

let _bound = null;   // { sheet, cleanup }
let _onSnap = null;

function isDesktop() {
  return typeof window !== 'undefined' && window.matchMedia?.(SIDE_COLUMN).matches;
}

/** The heights, in px, each detent resolves to right now. */
export function detentHeights() {
  const sheet = $('nav-sheet');
  const head  = $('sheet-head');
  const screen = $('nav-screen');
  if (!sheet || !head || !screen) return null;
  const screenH = screen.clientHeight || window.innerHeight;
  const banner = document.querySelector('.sg-navbar');
  const bannerBottom = banner ? banner.getBoundingClientRect().bottom - screen.getBoundingClientRect().top : 0;
  // The sheet's padding-bottom IS the safe-area inset (navigation-sheet.css);
  // reading it computed gives the resolved px on notched phones.
  const safeBottom = parseFloat(getComputedStyle(sheet).paddingBottom) || 0;

  const collapsed = head.offsetHeight + safeBottom;
  const full = Math.max(collapsed + 120, screenH - bannerBottom - 8);
  const half = Math.min(full, Math.max(collapsed + 96, Math.round(screenH * 0.5)));
  return { collapsed, half, full };
}

/** Apply the detent stored in uiState to the DOM, animated unless asked otherwise. */
export function applySheetDetent({ animate = true } = {}) {
  const sheet = $('nav-sheet');
  if (!sheet) return;
  const detent = DETENTS.includes(uiState.sheetDetent) ? uiState.sheetDetent : 'half';
  sheet.dataset.detent = detent;

  const grip = $('sheet-grip');
  if (grip) {
    grip.setAttribute('aria-expanded', detent === 'collapsed' ? 'false' : 'true');
    const label = { collapsed: 'recolhida', half: 'a meia tela', full: 'expandida' }[detent];
    grip.setAttribute('aria-label',
      `Lista de passos ${label}. Arraste ou use as setas para cima e para baixo para mudar a altura.`);
  }

  if (isDesktop()) {
    sheet.style.height = '';
    sheet.style.transition = '';
    return;
  }
  const heights = detentHeights();
  if (!heights) return;
  sheet.style.transition = animate && !prefersReducedMotion()
    ? 'height 280ms cubic-bezier(.22, .61, .36, 1)'
    : 'none';
  sheet.style.height = `${heights[detent]}px`;
}

/** Move to a detent, tell the map, and keep the list scrolled sensibly. */
export function setSheetDetent(detent, { animate = true } = {}) {
  if (!DETENTS.includes(detent)) return;
  const changed = uiState.sheetDetent !== detent;
  uiState.sheetDetent = detent;
  applySheetDetent({ animate });
  if (detent === 'collapsed') {
    const list = $('steps-list');
    if (list) list.scrollTop = 0;
  }
  if (changed) _onSnap?.(detent);
}

function nearestDetent(height, velocity, heights) {
  // A decisive flick wins over position: up opens, down closes, one step.
  const order = DETENTS;
  const current = order.indexOf(uiState.sheetDetent);
  if (Math.abs(velocity) > FLICK) {
    const next = velocity < 0 ? Math.min(current + 1, order.length - 1) : Math.max(current - 1, 0);
    return order[next];
  }
  return order.reduce((best, key) =>
    Math.abs(heights[key] - height) < Math.abs(heights[best] - height) ? key : best, order[0]);
}

/**
 * Wire the sheet in the current DOM. Called after every navigation render;
 * the previous binding is released first, because render() rebuilds the
 * elements and the old listeners would be holding detached nodes.
 *
 * @param {{ onSnap?: (detent: string) => void }} [opts]
 */
export function bindStepsSheet({ onSnap } = {}) {
  unbindStepsSheet();
  const sheet = $('nav-sheet');
  const head  = $('sheet-head');
  const grip  = $('sheet-grip');
  if (!sheet || !head || !grip) return;
  _onSnap = onSnap ?? null;

  applySheetDetent({ animate: false });

  // ── Pointer drag on the head ──
  let dragging = false, moved = false;
  let startY = 0, startH = 0, lastY = 0, lastT = 0, velocity = 0;

  const onDown = e => {
    if (isDesktop() || e.button > 0) return;
    const heights = detentHeights();
    if (!heights) return;
    dragging = true; moved = false;
    startY = lastY = e.clientY; lastT = performance.now(); velocity = 0;
    startH = sheet.getBoundingClientRect().height;
    sheet.style.transition = 'none';
    head.setPointerCapture?.(e.pointerId);
  };
  const onMove = e => {
    if (!dragging) return;
    const dy = e.clientY - startY;
    if (!moved && Math.abs(dy) < DRAG_SLOP) return;
    moved = true;
    const now = performance.now();
    const dt = Math.max(1, now - lastT);
    velocity = (e.clientY - lastY) / dt;
    lastY = e.clientY; lastT = now;
    const heights = detentHeights();
    if (!heights) return;
    const h = Math.min(heights.full + 24, Math.max(heights.collapsed - 12, startH - dy));
    sheet.style.height = `${h}px`;
    sheet.classList.add('is-dragging');
    e.preventDefault();
  };
  const onUp = e => {
    if (!dragging) return;
    dragging = false;
    sheet.classList.remove('is-dragging');
    head.releasePointerCapture?.(e.pointerId);
    const heights = detentHeights();
    if (!moved) {
      // A tap on the head toggles between the two useful resting heights.
      if (e.target.closest('#sheet-grip') || e.target.closest('#sheet-summary')) {
        setSheetDetent(uiState.sheetDetent === 'collapsed' ? 'half' : 'collapsed');
      }
      return;
    }
    if (!heights) return;
    setSheetDetent(nearestDetent(sheet.getBoundingClientRect().height, velocity, heights));
    // Snapping to the same detent still needs the height re-applied.
    applySheetDetent({ animate: true });
  };

  head.addEventListener('pointerdown', onDown);
  head.addEventListener('pointermove', onMove);
  head.addEventListener('pointerup', onUp);
  head.addEventListener('pointercancel', onUp);
  // The tap fallback for the grip has to be a click as well, so a keyboard
  // Enter/Space on the button also toggles.
  const onGripKey = e => {
    const current = DETENTS.indexOf(uiState.sheetDetent);
    if (e.key === 'ArrowUp')        { e.preventDefault(); setSheetDetent(DETENTS[Math.min(current + 1, DETENTS.length - 1)]); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); setSheetDetent(DETENTS[Math.max(current - 1, 0)]); }
    else if (e.key === 'Home')      { e.preventDefault(); setSheetDetent('full'); }
    else if (e.key === 'End')       { e.preventDefault(); setSheetDetent('collapsed'); }
    else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setSheetDetent(uiState.sheetDetent === 'collapsed' ? 'half' : 'collapsed');
    }
  };
  grip.addEventListener('keydown', onGripKey);

  const onResize = () => applySheetDetent({ animate: false });
  window.addEventListener('resize', onResize);
  window.visualViewport?.addEventListener('resize', onResize);

  _bound = {
    sheet,
    cleanup() {
      head.removeEventListener('pointerdown', onDown);
      head.removeEventListener('pointermove', onMove);
      head.removeEventListener('pointerup', onUp);
      head.removeEventListener('pointercancel', onUp);
      grip.removeEventListener('keydown', onGripKey);
      window.removeEventListener('resize', onResize);
      window.visualViewport?.removeEventListener('resize', onResize);
    },
  };
}

export function unbindStepsSheet() {
  _bound?.cleanup();
  _bound = null;
  _onSnap = null;
}
