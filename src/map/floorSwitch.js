import { $ } from '../utils/dom.js';
import { app, mapState, navState } from '../state/appState.js';
import { getFloorLabel } from '../state/selectors.js';
import { updateMapForFloor } from '../app/router.js';

/* ============================================================
   12. FLOOR SWITCHING
   ============================================================ */

export function switchFloor(fid, isManual = true) {
  if (fid === mapState.selectedFloorId && !isManual) return;
  mapState.selectedFloorId = fid;

  if (isManual && navState.route) {
    const curStepFloor = navState.semanticSteps[navState.activeStepIndex]?.floorId ?? '';
    mapState.manualFloor = fid !== curStepFloor;
  } else {
    mapState.manualFloor = false;
  }

  // Announce floor change
  const liveEl = $('floor-live');
  if (liveEl) liveEl.textContent = `${getFloorLabel(fid)}`;

  if (app.mode === 'navigation') {
    updateMapForFloor(fid);
  }
}

