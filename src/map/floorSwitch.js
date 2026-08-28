import { $ } from '../utils/dom.js';
import { app, mapState } from '../state/appState.js';
import { getFloorLabel } from '../state/selectors.js';
import { updateMapForFloor } from '../app/router.js';

/* ============================================================
   12. FLOOR SWITCHING
   ============================================================ */

/**
 * @param {string}  fid       the floor to show
 * @param {boolean} isManual  true when the traveller picked it from the menu;
 *                            false when the app follows a tapped step. Kept
 *                            in the signature for callers; there is no
 *                            "current step's floor" to compare against any
 *                            more, so both paths behave the same.
 */
export function switchFloor(fid, isManual = true) {
  if (fid === mapState.selectedFloorId && !isManual) return;
  mapState.selectedFloorId = fid;
  mapState.manualFloor = false;

  // Announce floor change
  const liveEl = $('floor-live');
  if (liveEl) liveEl.textContent = `${getFloorLabel(fid)}`;

  if (app.mode === 'navigation') {
    updateMapForFloor(fid);
  }
}
