import { POI_TYPES as _PRES_POI, INTERNAL_TYPES as _PRES_INTERNAL, VERTICAL_TYPES as _PRES_VERTICAL, getTypeMeta } from '../services/nodePresentation.js';
import { app } from '../state/appState.js';

/* ============================================================
   1. CONSTANTS
   ============================================================ */

export const FORTALEZA_SLUG = 'fortaleza';
export const MAX_RESULTS    = 40;
export const DEBOUNCE_MS    = 200;
/**
 * Zoom-out floor. Dropped from 0.25 when the map moved to the plans' own
 * 3740x1800 space: floor 2's nodes span 2935 units, so seeing a whole level
 * on a 390px phone needs about 0.13. At the old 0.25 the user simply could
 * not zoom out far enough to see where they were going.
 */
export const MIN_SCALE      = 0.12;
export const MAX_SCALE      = 8;
export const ROUTE_ANIM_MS  = 400; // route draw animation duration

export const FLOOR_LABELS = { '0': 'Térreo', '1': 'Piso 1', '2': 'Piso 2', '3': 'Piso 3' };

// ── Presentation layer re-exports (single source of truth) ──
export const POI_TYPES       = _PRES_POI;
export const INTERNAL_TYPES  = _PRES_INTERNAL;
export const VERTICAL_TYPES  = _PRES_VERTICAL;

/** Types shown on map during navigation — route-relevant only */
export const NAV_VISIBLE_TYPES = new Set([
  'elevator', 'stairs', 'escalator', 'entrance', 'exit', 'gate',
]);

/** Delegate to presentation module — keeps a single metadata source */
export function getNodeMeta(type) {
  const m = getTypeMeta(type);
  // Map presentation fields to legacy field names used inside app.js
  return { label: m.publicType, icon: m.icon, color: m.color, group: m.publicType.toUpperCase() };
}

