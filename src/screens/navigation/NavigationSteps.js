/**
 * NavigationSteps — the whole route as one scrollable, numbered list.
 *
 * WHY EVERY STEP AT ONCE. The old screen showed one instruction and asked
 * the traveller to press "Concluir etapa" after each one. Nobody walking
 * through an airport with a bag has a hand free for that, and without
 * indoor positioning the app cannot advance on its own. So there is no
 * current step and nothing to confirm: the list is the route, numbered to
 * match the badges drawn on the map, and the traveller reads it whenever
 * they want to. Tapping a step centres the map on it — a look, not a claim.
 *
 * DATA. Every row is one entry of navState.semanticSteps; nothing is
 * invented. Per-leg minutes split the backend's total in proportion to the
 * metres measured along the path, exactly as the choice screen does.
 *
 * FLOOR CHANGES are where people get lost, so they are the one thing the
 * list marks loudly: a divider names the floor being left and the floor
 * being reached, and the transition step itself (lift, stairs, escalator)
 * is drawn on a navy chip.
 *
 * Behaviour hooks (bound in events.js):
 *   .sg-step__hit[data-step-index]      centre the map on that step
 *   .sg-step__place[data-place-code]    open the PlaceDetailSheet
 */
import { navState, planState, uiState } from '../../state/appState.js';
import { esc } from '../../utils/format.js';
import { findNode, getFloorLabel } from '../../state/selectors.js';
import { getPlaceDetails, getOpenStatus } from '../../services/placesMock.js';
import { getPublicNodeCategory, getPublicNodeLabel, POI_TYPES, VERTICAL_TYPES } from '../../services/nodePresentation.js';
import { formatDistance } from '../../services/routeSteps.js';
import { getNodeMeta } from '../../app/constants.js';
import { dsIcon } from '../../components/ds/index.js';

/**
 * Per-step walking minutes: the backend total, split by measured distance,
 * as a whole number with a floor of 1 — a leg you walk takes at least a
 * minute to say, and "0 min" is noise.
 */
export function stepMinutes(step) {
  const total = navState.route?.estimatedMinutes ?? 0;
  const meters = step.distanceMeters ?? 0;
  if (!total || !(meters > 0)) return 0;
  const all = navState.semanticSteps.reduce((sum, s) => sum + (s.distanceMeters ?? 0), 0);
  if (!all) return 0;
  return Math.max(1, Math.round(total * (meters / all)));
}

/** "120 m · 2 min" — whichever halves are actually known. */
export function stepMeta(step) {
  const parts = [];
  const dist = formatDistance(step.distanceMeters ?? 0);
  if (dist) parts.push(dist);
  const mins = stepMinutes(step);
  if (mins >= 1) parts.push(`${mins} min`);
  return parts.join(' · ');
}

/** The instruction without its closing full stop — a row title, not a sentence. */
export function stepTitle(step) {
  return String(step?.text ?? '').replace(/\.\s*$/, '');
}

/**
 * The establishment a step passes through, when there is one.
 *
 * A rich record (placesMock) makes the chip a button that opens the detail
 * card. A plain POI node still gets its public name and category, because
 * "the step goes through Dufry" is worth stating even when we know nothing
 * else about Dufry. Origin and destination are excluded: the banner and the
 * destination row already name them.
 */
export function stepEstablishment(step) {
  const code = step?.landmarkCode;
  if (!code || code === planState.destinationCode || code === planState.originCode) return null;
  const node = findNode(code);
  if (!node || VERTICAL_TYPES.has(node.type) || !POI_TYPES.has(node.type)) return null;
  const place = getPlaceDetails(code);
  if (place) {
    const status = getOpenStatus(place.opening_hours);
    return {
      code,
      name: place.name,
      category: place.category ?? getPublicNodeCategory(node),
      open: status.open,
      closesAt: status.open && status.today ? status.today.close : '',
      hasDetails: true,
    };
  }
  return { code, name: getPublicNodeLabel(node), category: getPublicNodeCategory(node), open: null, closesAt: '', hasDetails: false };
}

/** Does the route change floor between `prev` and `step`? */
export function changesFloor(prev, step) {
  return Boolean(prev?.floorId && step?.floorId && prev.floorId !== step.floorId);
}

function establishmentMarkup(place) {
  const status = place.open === null
    ? ''
    : `${place.open ? 'Aberto' : 'Fechado'}${place.closesAt ? ` · até ${esc(place.closesAt)}` : ''}`;
  const inner = `
    <span class="sg-step__place-glyph" aria-hidden="true">${dsIcon('solar:shop-2-bold')}</span>
    <span class="sg-step__place-copy">
      <span class="sg-step__place-name">${esc(place.name)}</span>
      <span class="sg-step__place-meta">
        ${place.category ? `<span>${esc(place.category)}</span>` : ''}
        ${status ? `<span class="sg-step__place-status ${place.open ? 'is-open' : 'is-closed'}">${status}</span>` : ''}
      </span>
    </span>`;
  return place.hasDetails
    ? `<button type="button" class="sg-step__place has-details" data-place-code="${esc(place.code)}"
        aria-label="Ver detalhes de ${esc(place.name)}">${inner}
        <span class="sg-step__place-cue" aria-hidden="true">${dsIcon('solar:alt-arrow-right-linear')}</span>
      </button>`
    : `<span class="sg-step__place">${inner}</span>`;
}

function floorDivider(fromFloor, toFloor) {
  const from = getFloorLabel(fromFloor);
  const to = getFloorLabel(toFloor);
  return `<li class="sg-steps__floor" role="presentation">
    <span class="sg-steps__floor-icon" aria-hidden="true">${dsIcon('solar:layers-bold')}</span>
    <span class="sg-steps__floor-text">
      <span class="sg-steps__floor-label">Troca de piso</span>
      <span class="sg-steps__floor-route">${esc(from)} <span aria-hidden="true">→</span><span class="sr-only">para</span> ${esc(to)}</span>
    </span>
  </li>`;
}

/** One row. The number matches the badge drawn on the map for this step. */
export function renderStepItem(step, index) {
  const number = index + 1;
  const isDest = index === navState.semanticSteps.length - 1;
  const isFocused = index === uiState.focusedStepIndex;
  const title = stepTitle(step);
  const meta = stepMeta(step);
  const place = stepEstablishment(step);
  const icon = isDest
    ? 'solar:map-point-bold'
    : (step.icon || getNodeMeta(step.nodeType ?? 'corridor').icon);
  const reachesFloor = step.isTransition && step.toFloor && step.toFloor !== step.floorId
    ? getFloorLabel(step.toFloor)
    : '';

  const classes = [
    'sg-step',
    step.isTransition ? 'is-transition' : '',
    isDest ? 'is-dest' : '',
    index === 0 ? 'is-origin' : '',
    isFocused ? 'is-focused' : '',
    place ? 'has-place' : '',
  ].filter(Boolean).join(' ');

  const spoken = [
    `Passo ${number}${isDest ? ', destino' : ''}: ${title}.`,
    meta,
    reachesFloor ? `Leva ao ${reachesFloor}.` : '',
    'Mostrar no mapa.',
  ].filter(Boolean).join(' ');

  return `<li class="${classes}" data-step-index="${index}">
    <button type="button" class="sg-step__hit" data-step-index="${index}"
      aria-label="${esc(spoken)}" aria-pressed="${isFocused ? 'true' : 'false'}">
      <span class="sg-step__num" aria-hidden="true">${number}</span>
      <span class="sg-step__icon" aria-hidden="true">${dsIcon(icon)}</span>
      <span class="sg-step__body">
        <span class="sg-step__text">${esc(title)}</span>
        ${meta || reachesFloor ? `<span class="sg-step__meta">
          ${meta ? `<span>${esc(meta)}</span>` : ''}
          ${reachesFloor ? `<span class="sg-step__to-floor">${dsIcon('solar:layers-bold')}${esc(reachesFloor)}</span>` : ''}
        </span>` : ''}
      </span>
    </button>
    ${place ? establishmentMarkup(place) : ''}
  </li>`;
}

/**
 * The list body: every step, with a divider wherever the route changes
 * floor. Exported alone so the sheet can be refreshed without rebuilding the
 * map around it.
 */
export function renderStepsList() {
  const steps = navState.semanticSteps;
  if (!steps.length) return `<li class="sg-steps__empty">Nenhum trajeto calculado.</li>`;
  const rows = [];
  steps.forEach((step, i) => {
    const prev = steps[i - 1];
    if (changesFloor(prev, step)) rows.push(floorDivider(prev.floorId, step.floorId));
    rows.push(renderStepItem(step, i));
  });
  return rows.join('');
}

/** The one-line summary that stays visible when the sheet is collapsed. */
export function renderStepsSummary() {
  const steps = navState.semanticSteps;
  const floors = new Set(steps.map(s => s.floorId).filter(Boolean)).size;
  const parts = [`${steps.length} ${steps.length === 1 ? 'passo' : 'passos'}`];
  if (floors > 1) parts.push(`${floors} pisos`);
  return `<span class="sg-sheet__count">${esc(parts.join(' · '))}</span>
    <span class="sg-sheet__hint">Toque num passo para ver no mapa</span>`;
}
