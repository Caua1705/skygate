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
import { esc, fmtMin } from '../../utils/format.js';
import { findNode } from '../../state/selectors.js';
import { getPublicNodeLabel } from '../../services/nodePresentation.js';
import { Button, dsIcon } from '../../components/ds/index.js';

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
  const minutes = fmtMin(navState.route?.estimatedMinutes ?? 0);
  const left    = Math.max(0, total - active - 1);

  return `<div class="sg-tl__strip">
    <span class="sg-tl__strip-item">
      ${dsIcon('solar:clock-circle-bold')}<b>${esc(String(minutes))}</b> min
    </span>
    <span class="sg-tl__strip-sep" aria-hidden="true"></span>
    <span class="sg-tl__strip-item">
      ${dsIcon('solar:routing-2-bold')}Passo <b>${active + 1}</b> de ${total}
    </span>
    <span class="sg-tl__strip-sep" aria-hidden="true"></span>
    <span class="sg-tl__strip-item">
      ${left ? `faltam <b>${left}</b>` : 'último passo'}
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
function renderViewToggle(view) {
  const tab = (id, active, icon, label) => `
    <button type="button" class="sg-nav-tab${active ? ' is-active' : ''}" id="${id}"
      role="tab" aria-selected="${active}" aria-controls="nav-panel">
      ${dsIcon(icon)}${esc(label)}
    </button>`;

  return `<div class="sg-nav-tabs" role="tablist" aria-label="Modo de visualização">
    ${tab('tab-steps-btn', view === 'timeline', 'lucide:list', 'Passo a passo')}
    ${tab('tab-route-btn', view === 'trajeto',  'lucide:route', 'Ver trajeto')}
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
  const isLast   = navState.activeStepIndex >= navState.semanticSteps.length - 1;

  return `
    <div class="sg-ds sg-ds-dark sg-tl-screen sg-nav-screen--${esc(view)}" id="nav-screen">

      <header class="sg-tl-hdr" role="banner">
        <button type="button" class="sg-tl-hdr__btn" id="exit-nav-btn" aria-label="Sair da navegação">
          ${dsIcon('solar:arrow-left-linear')}
        </button>
        <div class="sg-tl-hdr__brand">
          <img class="sg-tl-hdr__logo" src="assets/logo-skygate-white.png" alt="SkyGate">
          <span class="sg-tl-hdr__dest">
            ${dsIcon('solar:map-point-bold', 'sg-tl-hdr__pin')}
            <span>FOR · Chegue a ${esc(destName)}</span>
          </span>
        </div>
        <button type="button" class="sg-tl-hdr__btn" id="help-btn" aria-label="Ajuda">
          ${dsIcon('solar:question-circle-linear')}
        </button>
      </header>

      ${renderViewToggle(view)}

      ${renderSummaryStrip()}

      <div class="sg-tl__scroll" id="nav-scroll">
        <div id="nav-panel" class="${esc(bodyClass)}" role="tabpanel"
          aria-labelledby="${view === 'trajeto' ? 'tab-route-btn' : 'tab-steps-btn'}">
          ${body}
        </div>
      </div>

      <!-- Only the primary action. Switching views is the toggle's job, and
           a second control for it down here is what made one screen look
           like two. -->
      <div class="sg-tl-foot">
        <div class="sg-tl-foot__row">
          ${Button({
            label: isLast ? 'Chegou!' : 'Próximo',
            variant: 'primary',
            iconRight: 'solar:arrow-right-linear',
            id: 'nav-next',
            disabled: isLast,
            className: 'sg-tl-foot__next',
          })}
        </div>
      </div>

      <!-- announceStep() has always written here, but no view ever rendered
           the element, so step changes were silent for screen readers. -->
      <p class="sr-only" id="nav-live" role="status" aria-live="polite"></p>
    </div>
  `;
}
