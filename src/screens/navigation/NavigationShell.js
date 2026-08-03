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
import { Button, IconButton, dsIcon } from '../../components/ds/index.js';

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
 * The status band: total time, position in the route, how much is left.
 *
 * Part of the frame, not of either body — it answers "how is the trip
 * going", which is a question about the journey and not about the drawing.
 * Pinned rather than scrolled for the same reason the footer is.
 */
export function renderSummaryStrip() {
  const total   = navState.semanticSteps.length;
  const active  = navState.activeStepIndex;
  const minutes = getEstimatedRemainingMinutes();

  return `<div class="sg-tl__strip" aria-label="Resumo da navegação">
    <span class="sg-tl__strip-item" aria-label="Tempo restante estimado: ${minutes} minutos">
      ${dsIcon('solar:clock-circle-bold')}<b>${esc(String(minutes))}</b> min restantes
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
  const tab = (id, active, icon, label, controls) => `
    <button type="button" class="sg-nav-tab${active ? ' is-active' : ''}" id="${id}"
      role="tab" aria-selected="${active}" aria-controls="${controls}"
      tabindex="${active ? '0' : '-1'}">
      ${dsIcon(icon)}${esc(label)}
    </button>`;

  return `<div class="sg-nav-tabs${className ? ` ${esc(className)}` : ''}" role="tablist" aria-label="Visualização da navegação">
    ${tab('tab-steps-btn', !isMap, 'lucide:list', 'Etapas', 'navigation-view')}
    ${tab('tab-route-btn', isMap, 'lucide:map', 'Mapa', 'map-wrapper')}
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
  const destNode = findNode(planState.destinationCode);
  const destName = destNode ? getPublicNodeLabel(destNode) : 'seu destino';
  const isFirst  = navState.activeStepIndex <= 0;
  const isLast   = navState.activeStepIndex >= navState.semanticSteps.length - 1;

  return `
    <div class="sg-ds sg-ds-dark sg-tl-screen sg-nav-screen--${esc(view)}" id="nav-screen">

      <header class="sg-tl-hdr">
        <button type="button" class="sg-tl-hdr__btn" id="exit-nav-btn" aria-label="Sair da navegação">
          ${dsIcon('solar:arrow-left-linear')}
        </button>
        <!-- ONE row: back | logo | destination | help. The logo and the
             destination used to stack, which cost the screen a whole band
             before any route content. The logo shrinks to make room; the
             destination is the thing a navigating passenger reads, and it
             also appears as the last item of the timeline, so ellipsising a
             very long name here loses nothing. -->
        <img class="sg-tl-hdr__logo" src="assets/logo-skygate-white.png" alt="SkyGate">
        <span class="sg-tl-hdr__dest">
          ${dsIcon('solar:map-point-bold', 'sg-tl-hdr__pin')}
          <span>FOR · Chegue a ${esc(destName)}</span>
        </span>
        <button type="button" class="sg-tl-hdr__btn" id="help-btn" aria-label="Ajuda">
          ${dsIcon('solar:question-circle-linear')}
        </button>
      </header>

      ${renderViewToggle(view)}

      ${renderSummaryStrip()}

      <div class="sg-tl__scroll" id="nav-scroll">
        <div id="navigation-view" class="${esc(bodyClass)}" role="tabpanel"
          aria-labelledby="${view === 'trajeto' ? 'tab-route-btn' : 'tab-steps-btn'}">
          ${body}
        </div>
      </div>

      <!-- Only the primary action. Switching views is the toggle's job, and
           a second control for it down here is what made one screen look
           like two. -->
      <div class="sg-tl-foot">
        <div class="sg-tl-foot__row">
          ${IconButton({
            icon: 'solar:arrow-left-linear',
            label: 'Voltar à etapa anterior',
            id: 'nav-prev',
            disabled: isFirst,
            className: 'sg-tl-foot__prev',
          })}
          ${Button({
            label: isLast ? 'Finalizar rota' : 'Próxima etapa',
            variant: 'primary',
            iconRight: isLast ? 'solar:flag-2-bold' : 'solar:arrow-right-linear',
            id: 'nav-next',
            className: 'sg-tl-foot__next',
          })}
        </div>
      </div>
    </div>
  `;
}
