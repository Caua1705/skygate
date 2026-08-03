/**
 * NavigationShell — the frame both navigation views live in.
 *
 * Navigation is ONE screen with two bodies, not two screens. The frame is
 * what makes that true on the glass: header → toggle → status → [body] →
 * footer, where only the body is swapped. The traveller sees the same
 * destination, the same toggle in the same place and the same primary
 * action whichever view they are on, so switching reads as changing the
 * drawing rather than as going somewhere else.
 *
 * WHY THIS EXISTS. The toggle first shipped inside the metro view, and the
 * timeline reached it through a "Ver trajeto" button in its own footer. Two
 * different controls, in two different places, doing one thing — which is
 * exactly how one screen starts looking like two. The toggle belongs to the
 * screen, so it is rendered here and only here.
 *
 * The body is a string because that is the idiom of every other renderer in
 * src/screens — no component framework, no virtual DOM, just markup.
 *
 * Behaviour hooks (bound in events.js):
 *   #exit-nav-btn     leave navigation
 *   #tab-steps-btn    show the timeline
 *   #tab-route-btn    show the metro diagram
 *   #nav-next         advance the active step
 */
import { navState, planState } from '../../state/appState.js';
import { esc } from '../../utils/format.js';
import { findNode } from '../../state/selectors.js';
import { getPublicNodeLabel } from '../../services/nodePresentation.js';
import { gateCloseClock, hasFlight } from '../../services/flightSlack.js';
import { Button, IconButton, dsIcon } from '../../components/ds/index.js';

/**
 * One navigation header for both the spatial map and the instruction list.
 * The destination is the title of the task; the product wordmark is omitted
 * here so it never competes with the place the passenger is trying to reach.
 */
export function renderNavigationHeader({ map = false } = {}) {
  const destNode = findNode(planState.destinationCode);
  const destName = destNode ? getPublicNodeLabel(destNode) : 'seu destino';
  const classes = map ? 'sg-navtop sg-ds sg-ds-dark sg-navhdr sg-navtop--map' : 'sg-navtop';
  const eyebrow = planState.accessibleRoute || planState.routeMode === 'accessible'
    ? 'FOR · Sem escadas'
    : 'FOR · Navegando para';

  return '<header class="' + classes + '">'
    + '<button type="button" class="sg-navtop__btn" id="exit-nav-btn" aria-label="Sair da navegação">'
    + dsIcon('solar:arrow-left-linear') + '</button>'
    + '<div class="sg-navtop__route">'
    + '<span class="sg-navtop__pin" aria-hidden="true">' + dsIcon('solar:map-point-bold') + '</span>'
    + '<span class="sg-navtop__copy">'
    + '<span class="sg-navtop__eyebrow">' + eyebrow + '</span>'
    + '<h1 class="sg-navtop__title">' + esc(destName) + '</h1>'
    + '</span></div>'
    + '<button type="button" class="sg-navtop__btn" id="help-btn" aria-label="Ajuda durante a navegação">'
    + dsIcon('solar:question-circle-linear') + '</button>'
    + '</header>';
}

/** The manual progress action uses identical language in both nav views. */
export function navigationPrimaryLabel() {
  const isLast = navState.activeStepIndex >= navState.semanticSteps.length - 1;
  return isLast ? 'Finalizar rota' : 'Concluir etapa';
}

/**
 * Estimate what remains without introducing a second timing model.
 *
 * The backend owns the total estimate. We only apportion that total across
 * the semantic steps using distances already attached to them. A route with
 * no measured distances falls back to step progress, never a made-up speed.
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

/**
 * Preserve the flight deadline once walking starts. A gate clock is stable
 * enough to scan while moving and remains explicitly labelled as estimated;
 * without flight context the route's remaining time stays the useful signal.
 */
export function getNavigationTiming() {
  const remaining = getEstimatedRemainingMinutes();
  const gate = hasFlight() ? gateCloseClock() : '';
  return {
    remaining,
    gate,
    ariaLabel: gate
      ? `Fechamento estimado do portão por volta de ${gate}`
      : `Tempo restante estimado: ${remaining} minutos`,
  };
}

/**
 * The status band: total time, position in the route, how much is left.
 *
 * Part of the frame, not of either body — it answers "how is the trip
 * going", which is a question about the journey and not about the drawing.
 * Pinned rather than scrolled for the same reason the footer is.
 */
export function renderSummaryStrip() {
  const total   = navState.semanticSteps.length;
  const active  = navState.activeStepIndex;
  const timing = getNavigationTiming();

  return `<div class="sg-tl__strip" aria-label="Resumo da navegação">
    <span class="sg-tl__strip-item" aria-label="${esc(timing.ariaLabel)}">
      ${timing.gate
        ? `${dsIcon('lucide:plane-takeoff')}Portão <b>~${esc(timing.gate)}</b> (estimado)`
        : `${dsIcon('solar:clock-circle-bold')}<b>${esc(String(timing.remaining))}</b> min restantes`}
    </span>
    <span class="sg-tl__strip-sep" aria-hidden="true"></span>
    <span class="sg-tl__strip-item">
      ${dsIcon('solar:routing-2-bold')}Etapa <b>${Math.min(active + 1, total)}</b> de ${total}
    </span>
  </div>`;
}

/**
 * The view toggle.
 *
 * Real tabs: the selected one is announced as such and names the panel it
 * controls, and both are always present, so the pair reads as one control
 * with two states rather than as two unrelated buttons. Clicking the active
 * tab is a no-op — it already shows what it names.
 *
 * The icons are Lucide (the policy for anything new); the chrome around
 * them keeps the `solar:` set the rest of the app draws.
 */
export function renderViewToggle(view, className = '') {
  const isMap = view === 'map' || view === 'trajeto';
  const tab = (id, active, icon, label) => `
    <button type="button" class="sg-nav-tab${active ? ' is-active' : ''}" id="${id}"
      role="tab" aria-selected="${active}" aria-controls="navigation-panel"
      tabindex="${active ? '0' : '-1'}">
      ${dsIcon(icon)}${esc(label)}
    </button>`;

  return `<div class="sg-nav-tabs${className ? ` ${esc(className)}` : ''}" role="tablist" aria-label="Visualização da navegação">
    ${tab('tab-steps-btn', !isMap, 'lucide:list', 'Etapas')}
    ${tab('tab-route-btn', isMap, 'lucide:map', 'Mapa')}
  </div>`;
}

/**
 * The whole screen around a body.
 *
 * @param {object}  opts
 * @param {string}  opts.view   'timeline' | 'trajeto' — which tab is lit
 * @param {string}  opts.body   markup for the scrolling middle band
 * @param {string} [opts.bodyClass]  class for the panel wrapper
 */
export function renderNavigationShell({ view, body, bodyClass = '' }) {
  const isFirst  = navState.activeStepIndex <= 0;
  const isLast   = navState.activeStepIndex >= navState.semanticSteps.length - 1;

  return `
    <div class="sg-ds sg-ds-dark sg-tl-screen sg-nav-screen--${esc(view)}" id="nav-screen">

      ${renderNavigationHeader()}

      ${renderSummaryStrip()}

      <button type="button" class="sg-skip-navview" id="focus-view-tabs">
        Ir para Etapas e Mapa
      </button>
      <div class="sg-tl__scroll" id="nav-scroll">
        <div id="navigation-panel" class="${esc(bodyClass)}" role="tabpanel"
          aria-labelledby="${view === 'trajeto' ? 'tab-route-btn' : 'tab-steps-btn'}">
          ${body}
        </div>
      </div>

      <div class="sg-tl__view-switch">
        ${renderViewToggle(view, 'sg-nav-tabs--footer')}
      </div>

      <!-- Only the primary action. Switching views is the toggle's job, and
           a second control for it down here is what made one screen look
           like two. -->
      <div class="sg-tl-foot">
        <p class="sg-tl-foot__hint">Confirme somente depois de concluir a instrução atual.</p>
        <div class="sg-tl-foot__row">
          ${IconButton({
            icon: 'solar:arrow-left-linear',
            label: 'Voltar à etapa anterior',
            id: 'nav-prev',
            disabled: isFirst,
            className: 'sg-tl-foot__prev',
          })}
          ${Button({
            label: navigationPrimaryLabel(),
            variant: 'primary',
            iconRight: isLast ? 'solar:flag-2-bold' : 'lucide:check',
            id: 'nav-next',
            className: 'sg-tl-foot__next',
          })}
        </div>
      </div>
    </div>
  `;
}
