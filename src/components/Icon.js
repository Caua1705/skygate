import { app } from '../state/appState.js';

/* ============================================================
   5c. NAVIGATION ICON SET — inline SVG

   The navigation screen uses inline SVG (not iconify) so the glyphs match
   the reference design exactly and can never fail to resolve. The rest of
   the app keeps using <iconify-icon>.
   ============================================================ */

export const NAV_ICON_BODIES = {
  plane:      { fill: true,  body: '<path d="M12 2c.83 0 1.5.9 1.5 2.05v5.2l7.5 4.32v2.06l-7.5-2.2v4.42l2.6 1.9v1.6L12 20.4l-4.1.95v-1.6l2.6-1.9v-4.42l-7.5 2.2v-2.06l7.5-4.32v-5.2C10.5 2.9 11.17 2 12 2z"/>' },
  pin:        { fill: true,  body: '<path d="M12 2.2c-3.87 0-7 3.13-7 7 0 5.14 6.28 12.2 6.55 12.5.24.27.66.27.9 0 .27-.3 6.55-7.36 6.55-12.5 0-3.87-3.13-7-7-7zm0 9.55a2.55 2.55 0 1 1 0-5.1 2.55 2.55 0 0 1 0 5.1z"/>' },
  layers:     { fill: false, body: '<path d="M12 3.2 3.4 7.4 12 11.6l8.6-4.2L12 3.2z"/><path d="m3.4 12.2 8.6 4.2 8.6-4.2"/><path d="m3.4 16.8 8.6 4.2 8.6-4.2"/>' },
  navigate:   { fill: true,  body: '<path d="M20.9 3.1 4.3 10.2c-1.05.45-.9 1.98.2 2.24l6.6 1.55 1.55 6.6c.26 1.1 1.8 1.25 2.24.2l7.1-16.6c.36-.85-.5-1.7-1.1-1.09z"/>' },
  clock:      { fill: false, body: '<circle cx="12" cy="12" r="8.8"/><path d="M12 6.9V12l3.5 2.1"/>' },
  stairs:     { fill: false, body: '<path d="M3.6 19.4h4.2v-3.6H12v-3.6h4.2V8.6h4.2"/><path d="M7.8 19.4v-3.6M12 15.8v-3.6M16.2 12.2V8.6"/>' },
  turnRight:  { fill: false, body: '<path d="M6.4 20.2v-7.1a4.2 4.2 0 0 1 4.2-4.2h6.6"/><path d="m13.9 5.2 3.9 3.7-3.9 3.7"/>' },
  turnLeft:   { fill: false, body: '<path d="M17.6 20.2v-7.1a4.2 4.2 0 0 0-4.2-4.2H6.8"/><path d="m10.1 5.2-3.9 3.7 3.9 3.7"/>' },
  arrowUp:    { fill: false, body: '<path d="M12 20.2V4.6"/><path d="m5.4 11.2 6.6-6.6 6.6 6.6"/>' },
  wheelchair: { fill: false, body: '<circle cx="12.4" cy="4.4" r="2.1"/><path d="M11.1 8.2v5.1h5l3.1 6.1"/><path d="M14.6 13.9a5.6 5.6 0 1 1-6.7-4.6"/>' },
  list:       { fill: false, body: '<path d="M9.2 6.2h11M9.2 12h11M9.2 17.8h11"/><path d="M4.4 6.2h.02M4.4 12h.02M4.4 17.8h.02" stroke-width="3"/>' },
  chevron:    { fill: false, body: '<path d="m9.4 5.2 6.8 6.8-6.8 6.8"/>' },
  person:     { fill: true,  body: '<path d="M12 12.1a4.05 4.05 0 1 0 0-8.1 4.05 4.05 0 0 0 0 8.1zm0 1.9c-4.05 0-7.1 2.25-7.1 5.05V20h14.2v-.95c0-2.8-3.05-5.05-7.1-5.05z"/>' },
};

/** Inline SVG icon for the navigation screen. */
export function navIcon(name, extraClass = '') {
  const def = NAV_ICON_BODIES[name];
  if (!def) return '';
  const paint = def.fill
    ? 'fill="currentColor" stroke="none"'
    : 'fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"';
  return `<svg class="sg-ico ${extraClass}" viewBox="0 0 24 24" ${paint} aria-hidden="true" focusable="false">${def.body}</svg>`;
}

/** Pick the directional glyph that matches a step's instruction. */
export function getStepIconName(step) {
  if (!step) return 'arrowUp';
  if (step.isTransition) return 'stairs';
  if (/\bdireita\b/i.test(step.text)) return 'turnRight';
  if (/\besquerda\b/i.test(step.text)) return 'turnLeft';
  return 'arrowUp';
}

