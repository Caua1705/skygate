/**
 * NavigationShell — the destination banner and the route totals.
 *
 * Navigation is ONE screen: the floor plan fills the viewport, a navy banner
 * floats over its top edge naming where the traveller is going, and a
 * draggable sheet at the bottom lists every step of the route at once (see
 * NavigationSteps.js). There is no "current step", no confirmation and no
 * view toggle — we have no indoor positioning, so the app never claims to
 * know where the person is. It shows the whole route and lets them look.
 *
 * Behaviour hooks (bound in events.js):
 *   #exit-nav-btn   leave navigation (back to the route choice)
 *   #help-btn       contextual help
 */
import { navState, planState } from '../../state/appState.js';
import { esc } from '../../utils/format.js';
import { findNode } from '../../state/selectors.js';
import { getPublicNodeLabel } from '../../services/nodePresentation.js';
import { gateCloseClock, hasFlight } from '../../services/flightSlack.js';
import { formatMeters } from '../../services/routeSteps.js';
import { dsIcon } from '../../components/ds/index.js';

/**
 * The totals the banner states: backend minutes, measured metres, and the
 * number of steps. Distance is the sum of the per-step legs so it agrees
 * with what the list shows leg by leg.
 */
export function getRouteTotals() {
  const steps = navState.semanticSteps;
  const minutes = Math.max(0, Math.round(Number(navState.route?.estimatedMinutes) || 0));
  const meters = steps.reduce((sum, step) => sum + (Number(step.distanceMeters) || 0), 0);
  return { minutes, meters, steps: steps.length };
}

/**
 * The public name of the destination — the title of the whole task.
 */
export function getDestinationLabel() {
  const node = findNode(planState.destinationCode);
  return node ? getPublicNodeLabel(node) : 'seu destino';
}

/**
 * "12 min · ~450 m · Portão ~14:05" — the parts that are actually known.
 * The gate clock is an estimate derived from the flight time and stays
 * labelled as such in the accessible name.
 */
export function bannerSummary() {
  const totals = getRouteTotals();
  const visible = [];
  const spoken = [];
  if (totals.minutes) {
    visible.push(`${totals.minutes} min`);
    spoken.push(`Tempo total estimado: ${totals.minutes} ${totals.minutes === 1 ? 'minuto' : 'minutos'}`);
  }
  const distance = formatMeters(totals.meters);
  if (distance) {
    visible.push(distance);
    spoken.push(`Distância aproximada: ${distance.replace('~', '')}`);
  }
  const gate = hasFlight() ? gateCloseClock() : '';
  if (gate) {
    visible.push(`Portão ~${gate}`);
    spoken.push(`Fechamento estimado do portão por volta de ${gate}`);
  }
  return { visible, gate, ariaLabel: spoken.length ? `${spoken.join('. ')}.` : 'Totais indisponíveis.' };
}

/**
 * The banner: solid navy, white text, floating over the map. Back on the
 * left, the destination as the heading, the totals under it.
 */
export function renderNavigationBanner() {
  const summary = bannerSummary();
  const accessible = planState.accessibleRoute || planState.routeMode === 'accessible';

  return `<header class="sg-ds sg-navbar">
    <button type="button" class="sg-navbar__btn" id="exit-nav-btn" aria-label="Voltar para a escolha da rota">
      ${dsIcon('solar:arrow-left-linear')}
    </button>
    <div class="sg-navbar__copy">
      <span class="sg-navbar__eyebrow">${accessible ? 'Rota sem escadas para' : 'Rota para'}</span>
      <h1 class="sg-navbar__title">${esc(getDestinationLabel())}</h1>
      <p class="sg-navbar__totals" aria-label="${esc(summary.ariaLabel)}">
        ${summary.visible.map((part, i) => `${i ? '<span class="sg-navbar__sep" aria-hidden="true">·</span>' : ''}<span>${esc(part)}</span>`).join('')}
      </p>
    </div>
    <button type="button" class="sg-navbar__btn" id="help-btn" aria-label="Ajuda durante a navegação">
      ${dsIcon('solar:question-circle-linear')}
    </button>
  </header>`;
}

/**
 * Estimate what remains without introducing a second timing model.
 *
 * KEPT FOR THE ROUTE-CHOICE SCREEN. Navigation itself no longer tracks a
 * current step, so from the map's point of view the whole route is always
 * ahead and this returns the backend total. RouteSummaryScreen still calls
 * it when offering to resume a trip; the apportioning by measured distance
 * is preserved so that behaviour is unchanged should activeStepIndex ever
 * move again.
 */
export function getEstimatedRemainingMinutes() {
  const steps = navState.semanticSteps;
  const totalMinutes = Math.max(0, Number(navState.route?.estimatedMinutes) || 0);
  const active = Math.min(Math.max(navState.activeStepIndex, 0), Math.max(0, steps.length - 1));
  if (!steps.length || !totalMinutes || active >= steps.length - 1) return 0;

  const distances = steps.map(step => Math.max(0, Number(step.distanceMeters) || 0));
  const totalDistance = distances.reduce((sum, value) => sum + value, 0);
  const ratio = totalDistance > 0
    ? distances.slice(active).reduce((sum, value) => sum + value, 0) / totalDistance
    : (steps.length - active - 1) / Math.max(1, steps.length - 1);

  return Math.max(1, Math.ceil(totalMinutes * Math.min(1, Math.max(0, ratio))));
}
