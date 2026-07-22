/**
 * NavigationTimeline — the DEFAULT navigation view.
 *
 * A vertical, scrollable timeline of the journey ("acompanhar pedido"), dark
 * themed, replacing the top-down map as the thing the traveller sees first.
 * The map is not gone: it is one tap away behind "Ver trajeto", and will be
 * replaced there by the schematic metro view in a later step.
 *
 * WHY A LIST AND NOT A MAP. A top-down plan asks the traveller to locate
 * themselves on it before it can help — orient, find the dot, trace the line.
 * A list answers the only question that matters while walking ("what do I do
 * now, and what comes after") without any of that work, and it is the format
 * every delivery app has already taught people to read.
 *
 * DATA. Nothing is invented here: every node is one entry of
 * navState.semanticSteps, and the active index is navState.activeStepIndex —
 * the exact same state the map view reads. Photos and opening hours come
 * from getPlaceDetails(), the same source as the detail card.
 *
 * Behaviour hooks (bound in events.js / actions.js):
 *   .sg-tl__item[data-place-code]    open the PlaceDetailSheet
 *
 * The header, the view toggle, the status strip and the footer are NOT here:
 * they are the screen's frame and live in NavigationShell, shared with the
 * metro diagram.
 */
import { navState, planState } from '../../state/appState.js';
import { esc } from '../../utils/format.js';
import { getFloorLabel } from '../../state/selectors.js';
import { getOpenStatus, getPlaceDetails } from '../../services/placesMock.js';
import { formatMeters } from '../../services/routeSteps.js';
import { getNodeMeta } from '../../app/constants.js';
import { dsIcon } from '../../components/ds/index.js';
import { renderNavigationShell } from './NavigationShell.js';

/**
 * Per-step walking minutes.
 *
 * The card's route-context line refuses to show per-leg minutes because we
 * have no walking speed we trust — and that objection still stands. This is
 * a different calculation: it splits the total the API itself returned in
 * proportion to distances we measured along the path. No invented speed, and
 * the split is exact when the traveller walks at a constant pace, which is
 * what the "~" is for. Legs that round to under a minute show distance only,
 * because "~0 min" is noise pretending to be information.
 */
function stepMinutes(step) {
  const total = navState.route?.estimatedMinutes ?? 0;
  if (!total) return 0;
  const all = navState.semanticSteps.reduce((sum, s) => sum + (s.distanceMeters ?? 0), 0);
  if (!all) return 0;
  return Math.round(total * ((step.distanceMeters ?? 0) / all));
}

/** "120 m · ~2 min" — whichever halves are actually known. */
function stepMeta(step) {
  const parts = [];
  const dist = formatMeters(step.distanceMeters ?? 0);
  if (dist) parts.push(dist);
  const mins = stepMinutes(step);
  if (mins >= 1) parts.push(`~${mins} min`);
  return parts.join(' · ');
}

/** The business a step passes through, when it is one we have a record for. */
function stepPlace(step) {
  return step.landmarkCode ? getPlaceDetails(step.landmarkCode) : null;
}

function statusOf(index, active) {
  if (index < active) return 'done';
  if (index === active) return 'current';
  return 'upcoming';
}

/**
 * Photo card for a step that passes a real business.
 *
 * The name sits ON the photo under a gradient scrim rather than beside it:
 * a thumbnail plus a separate caption reads as two things, and the row
 * already carries the instruction text. Open/closed uses the SEMANTIC
 * success/danger scale (never the brand turquoise) so "open" is legible as
 * a state and not as decoration.
 */
function placeCard(place) {
  const status = getOpenStatus(place.opening_hours);
  return `<span class="sg-tl__place">
    <span class="sg-tl__place-photo">
      ${place.photo_url
        ? `<img src="${esc(place.photo_url)}" alt="" loading="lazy" decoding="async">`
        : dsIcon('solar:buildings-2-bold', 'sg-tl__place-glyph')}
    </span>
    <span class="sg-tl__place-scrim" aria-hidden="true"></span>
    <span class="sg-tl__place-info">
      <span class="sg-tl__place-name">${esc(place.name)}</span>
      <span class="sg-tl__place-status ${status.open ? 'is-open' : 'is-closed'}">
        <span class="sg-tl__place-dot" aria-hidden="true"></span>
        ${status.open ? 'Aberto agora' : 'Fechado'}${status.open && status.today ? ` · até ${esc(status.today.close)}` : ''}
      </span>
    </span>
    <span class="sg-tl__place-cue" aria-hidden="true">${dsIcon('solar:alt-arrow-right-linear')}</span>
  </span>`;
}

/** One timeline node. Rendered as a <button> only when it opens something. */
function timelineItem(step, index, active) {
  const status = statusOf(index, active);
  const place  = stepPlace(step);
  const isDest = step.landmarkCode && step.landmarkCode === planState.destinationCode;
  const isLast = index === navState.semanticSteps.length - 1;
  const meta   = stepMeta(step);
  const icon   = step.icon || getNodeMeta(step.nodeType ?? 'corridor').icon;

  const title = String(step.text ?? '').replace(/\.\s*$/, '');
  // --i drives the entrance stagger; see the .sg-tl__item keyframes.
  const attrs = `class="sg-tl__item is-${status}${isDest ? ' is-dest' : ''}${place ? ' has-place' : ''}" style="--i:${index}"`;

  const body = `
    <span class="sg-tl__rail" aria-hidden="true">
      <span class="sg-tl__dot">
        ${isDest ? dsIcon('solar:map-point-bold', 'sg-tl__dot-glyph')
          : status === 'done' ? dsIcon('solar:check-circle-bold', 'sg-tl__dot-glyph')
          : dsIcon(icon, 'sg-tl__dot-glyph')}
      </span>
      ${status === 'current' ? `
        <span class="sg-tl__wave"></span>
        <span class="sg-tl__wave sg-tl__wave--2"></span>` : ''}
      ${!isLast ? `<span class="sg-tl__line"></span>` : ''}
    </span>

    <span class="sg-tl__body">
      ${status === 'current' ? `<span class="sg-tl__now">Você está aqui</span>` : ''}
      <span class="sg-tl__title">${esc(title)}</span>
      ${meta || step.toFloor ? `<span class="sg-tl__meta">
        ${meta ? `<span class="sg-tl__dist">${esc(meta)}</span>` : ''}
        ${step.isTransition && step.toFloor && step.toFloor !== step.floorId
          ? `<span class="sg-tl__floor">${dsIcon('solar:layers-bold')}${esc(getFloorLabel(step.toFloor))}</span>`
          : ''}
      </span>` : ''}
      ${place ? placeCard(place) : ''}
    </span>`;

  // Only steps with a real business record are interactive. Making every row
  // a button would promise a card that most rows cannot open.
  return place
    ? `<li ${attrs}><button type="button" class="sg-tl__hit" data-place-code="${esc(step.landmarkCode)}"
         aria-label="${esc(title)} — ver detalhes de ${esc(place.name)}"
         ${status === 'current' ? 'aria-current="step"' : ''}>${body}</button></li>`
    : `<li ${attrs}${status === 'current' ? ' aria-current="step"' : ''}><span class="sg-tl__hit">${body}</span></li>`;
}

/** The scrollable list. Exported so a step change can swap it alone. */
export function renderTimelineList() {
  const steps  = navState.semanticSteps;
  const active = navState.activeStepIndex;
  return steps.map((step, i) => timelineItem(step, i, active)).join('');
}

/** The timeline is now only a BODY: the frame around it is NavigationShell. */
export function renderNavigationTimeline() {
  return renderNavigationShell({
    view: 'timeline',
    body: `<ol class="sg-tl" id="tl-list" aria-label="Etapas do trajeto">
      ${renderTimelineList()}
    </ol>`,
  });
}
