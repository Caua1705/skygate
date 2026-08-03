/**
 * RouteChoiceScreen — "Escolha seu caminho" (app.mode === 'summary').
 *
 * The middle screen of the flow: Home picks A → B (and, ideally, the flight
 * time) and calculates; this screen decides HOW to walk it; navigation
 * executes it. It is NOT a summary of one answer — it is the choice between
 * several, scored against the passenger's real margin.
 *
 * WITH a flight time this is a copilot: every real backend option carries its
 * live slack and temperature badge. Recommendation respects backend guidance
 * and viability; the client never manufactures a detour.
 *
 * WITHOUT one it degrades to a very good indoor map: times and deltas only,
 * plus a visible invitation to add the flight. The passenger without a flight
 * is not the target, but is never blocked.
 *
 * The calculation stays on Home. This screen only READS navState.route and the
 * options built from it (services/routeOptions.js); slack is recomputed here
 * on every render so it follows the device clock.
 *
 * Behaviour hooks consumed by src/app/events.js — do not rename without
 * updating that file:
 *   #back-to-planning-btn     back to Home
 *   #edit-route-btn           "Alterar" — back to Home, route discarded
 *   #add-flight-btn           back to Home, focused on the flight field
 *   .route-option-input       the radio per route card
 *   #risk-ack                 "start anyway" confirmation for an unviable route
 *   #start-nav-btn            enters navigation with the selected option
 */
import { getPublicNodeLabel, getPublicNodeSubtitle } from '../../services/nodePresentation.js';
import { app, navState, planState, uiState } from '../../state/appState.js';
import { renderPlanning } from '../home/HomeScreen.js';
import { findNode, getFloorLabel, getModeLabel } from '../../state/selectors.js';
import { esc, fmtMin } from '../../utils/format.js';
import { Button, Chip, dsIcon } from '../../components/ds/index.js';
import { findOption, scoreOptions, slackHint } from '../../services/routeOptions.js';
import {
  formatDuration, formatSlack, gateCloseClock, hasFlight, minutesUntilGateClose,
} from '../../services/flightSlack.js';
import { getEstimatedRemainingMinutes } from '../navigation/NavigationShell.js';

export function renderSummary() {
  const route = navState.route;
  if (!route) { app.mode = 'planning'; return renderPlanning(); }

  const options  = scoreOptions(navState.routeOptions ?? []);
  const selected = findOption(options, navState.selectedOptionId);
  const hasAlternatives = options.length > 1;

  return `
    <div class="sg-ds sg-rc" id="route-choice-root">

      <header class="sg-rc__header">
        <button type="button" class="sg-rc__back" id="back-to-planning-btn" aria-label="Voltar e alterar o trajeto">
          ${dsIcon('lucide:arrow-left')}
        </button>
        <h1 class="sg-rc__title">${hasAlternatives ? 'Escolha uma rota' : 'Sua rota'}</h1>
      </header>

      <div class="sg-rc__scroll">
        ${tripLine()}
        ${hasFlight() ? renderMarginBanner() : flightInvite()}
        ${optionsSection(options, selected, hasAlternatives)}
      </div>

      ${footer(selected)}
    </div>
  `;
}

/* ============================================================
   1. TRIP LINE — context, not the hero. The hero is the choice.
   ============================================================ */
function tripLine() {
  const origin = findNode(planState.originCode);
  const dest   = findNode(planState.destinationCode);
  const isAccessible = planState.routeMode === 'accessible';

  return `<section class="sg-rc__trip" aria-label="Trajeto selecionado">
    ${tripRow('De', origin, 'Origem')}
    ${tripRow('Para', dest, 'Destino')}
    <div class="sg-rc__trip-mode">
      ${Chip({
        label: getModeLabel(planState.routeMode),
        variant: 'outline',
        icon: isAccessible ? 'lucide:accessibility' : 'lucide:zap',
      })}
    </div>
  </section>`;
}

/* The floor is stacked UNDER the place name, not beside it: a phone-width row
   cannot hold "Porta 1 — Entrada e saída" and "Térreo · Acesso principal" side
   by side without ellipsising both into uselessness. */
function tripRow(label, node, fallback) {
  const name  = node ? getPublicNodeLabel(node) : fallback;
  const floor = node ? (getPublicNodeSubtitle(node) || getFloorLabel(node.floorId)) : '';
  return `<div class="sg-rc__trip-row">
    <span class="sg-rc__trip-label">${esc(label)}</span>
    <span class="sg-rc__trip-text">
      <span class="sg-rc__trip-name">${esc(name)}</span>
      ${floor ? `<span class="sg-rc__trip-floor">${esc(floor)}</span>` : ''}
    </span>
  </div>`;
}

/* ============================================================
   2a. WITH a flight — the margin, stated ONCE and slack-first.
   ------------------------------------------------------------
   Hierarchy is deliberate. The hero is the only number the passenger
   actually needs to act on: how long they have from RIGHT NOW. The clock
   times underneath are the receipt — why that number is what it is —
   set small, and never shown as a bare hour: an estimated gate closing
   printed like a fact reads as an airline announcement we never got.
   Hence "portão fecha ~19:04 (estimado)", never "19:04".
   ============================================================ */
export function renderMarginBanner() {
  const left = minutesUntilGateClose();
  const late = left !== null && left < 0;
  const gate = gateCloseClock();

  return `<section class="sg-rc__margin${late ? ' is-late' : ''}" aria-label="Sua margem até o portão fechar">
    <span class="sg-rc__margin-icon" aria-hidden="true">
      ${dsIcon(late ? 'lucide:circle-alert' : 'lucide:plane-takeoff')}
    </span>

    <div class="sg-rc__margin-text">
      ${late
        ? `<p class="sg-rc__margin-hero">
             <span class="sg-rc__margin-value">O portão já deve ter fechado</span>
           </p>`
        : `<p class="sg-rc__margin-hero">
             <span class="sg-rc__margin-lead">Você tem</span>
             <strong class="sg-rc__margin-value">~${esc(formatDuration(left))}</strong>
           </p>`}
      <p class="sg-rc__margin-basis">
        portão fecha <strong>~${esc(gate)}</strong> <span class="sg-rc__margin-est">(estimado)</span>
        <span class="sg-rc__margin-sep" aria-hidden="true">·</span>
        ${planState.flightDay === 'tomorrow' ? 'amanhã' : 'hoje'} ·
        voo ${planState.flightType === 'international' ? 'internacional' : 'doméstico'} · ${esc(planState.flightTime)}
      </p>
    </div>
  </section>`;
}

/* ============================================================
   2b. WITHOUT a flight — the app saying "the best of me is over here".
   Present and visible, never a blocker.
   ============================================================ */
function flightInvite() {
  /* One line of copy and an INLINE action, not a block button. This card is an
     invitation; the route cards below are the decision. A full-width outline
     button gave it the same silhouette as the primary CTA and made it read as
     the thing to press. The <button> stays a real button (same #add-flight-btn
     hook, same handler) — only its presentation is a link. */
  return `<section class="sg-rc__invite">
    <span class="sg-rc__invite-icon" aria-hidden="true">${dsIcon('lucide:plane-takeoff')}</span>
    <div class="sg-rc__invite-text">
      <h2 class="sg-rc__invite-title">Vai pegar um voo?</h2>
      <p class="sg-rc__invite-copy">Veja quanto tempo sobra em cada caminho.</p>
      <button type="button" class="sg-rc__invite-link" id="add-flight-btn">
        ${dsIcon('lucide:plus')}<span>Adicionar horário do voo</span>
      </button>
    </div>
  </section>`;
}

/* ============================================================
   3. ROUTE CARDS — the hero.
   Real radios in labels: keyboard grouping, arrow keys and the checked state
   come from the platform instead of being reimplemented on divs.
   ============================================================ */
function optionsSection(options, selected, hasAlternatives = options.length > 1) {
  if (!options.length) return '';

  return `<section class="sg-rc__options" aria-labelledby="sg-rc-options-h">
    <h2 class="sg-rc__section-title" id="sg-rc-options-h">${hasAlternatives ? 'Compare as opções' : 'Rota disponível'}</h2>
    <div class="sg-rc__list" id="route-option-list">${renderChoiceOptions(options, selected)}</div>
  </section>`;
}

/** The cards alone — re-rendered in place when the selection changes. */
export function renderChoiceOptions(
  options = scoreOptions(navState.routeOptions ?? []),
  selected = findOption(options, navState.selectedOptionId),
) {
  const selectable = options.length > 1;
  return options.map(o => optionCard(o, o.id === selected?.id, selectable)).join('');
}

function optionCard(option, isSelected, selectable) {
  const slack = option.slack;
  const doomed = slack?.status === 'inviavel';
  const hint = slackHint(option);
  const tag = selectable ? 'label' : 'article';

  return `<${tag} class="sg-rc-opt${isSelected ? ' is-selected' : ''}${doomed ? ' is-doomed' : ''}${selectable ? '' : ' is-single'}">
    ${selectable ? `<input type="radio" name="sg-route-option" class="sg-rc-opt__input route-option-input"
      value="${esc(option.id)}"${isSelected ? ' checked' : ''}>` : ''}

    <span class="sg-rc-opt__body">
      ${selectable && option.recommended ? `<span class="sg-rc-opt__rec">
        ${dsIcon('lucide:sparkles')}<span>Recomendada para você</span>
      </span>` : ''}

      <span class="sg-rc-opt__head">
        <span class="sg-rc-opt__icon" aria-hidden="true">${dsIcon(option.icon)}</span>
        <span class="sg-rc-opt__name">${esc(option.name)}</span>
        <span class="sg-rc-opt__time">
          <strong>${esc(fmtMin(option.minutes))}</strong><span class="sg-rc-opt__unit">min</span>
        </span>
      </span>

      <span class="sg-rc-opt__meta">
        <span class="sg-rc-opt__delta${option.deltaMinutes ? '' : ' is-direct'}">
          ${option.deltaMinutes
            ? `+${esc(String(option.deltaMinutes))} min`
            : (option.isFastest ? 'direto' : 'sem desvio')}
        </span>
        <span class="sg-rc-opt__dot" aria-hidden="true">·</span>
        <span class="sg-rc-opt__floors">
          ${dsIcon('lucide:layers')}
          ${esc(String(option.floors))} ${option.floors === 1 ? 'piso' : 'pisos'}
        </span>
        ${option.isEstimate
          ? `<span class="sg-rc-opt__dot" aria-hidden="true">·</span>
             <span class="sg-rc-opt__est">tempo estimado</span>`
          : ''}
      </span>

      ${slack ? `<span class="sg-rc-opt__slack sg-rc-opt__slack--${esc(slack.meta.tone)}">
        ${dsIcon(slack.meta.icon)}
        <span class="sg-rc-opt__slack-text">
          <strong>${esc(slack.meta.label)}</strong>
          <span class="sg-rc-opt__slack-num">${esc(formatSlack(slack.slackMin))}</span>
          ${hint ? `<span class="sg-rc-opt__slack-hint">${esc(hint)}</span>` : ''}
        </span>
      </span>` : ''}

      ${passesByRow(option.passesBy)}
      ${warningsRow(option.warnings)}
    </span>

    ${selectable ? `<span class="sg-rc-opt__mark" aria-hidden="true">${dsIcon('lucide:circle-check')}</span>` : ''}
  </${tag}>`;
}

function warningsRow(warnings = []) {
  const messages = warnings.map(w => typeof w === 'string' ? w : (w?.message ?? w?.text ?? '')).filter(Boolean);
  if (!messages.length) return '';
  return `<span class="sg-rc-opt__warnings">
    ${dsIcon('lucide:triangle-alert')}
    <span>${messages.slice(0, 2).map(esc).join(' · ')}</span>
  </span>`;
}

/**
 * The places this route walks past. Open/closed here is turquoise/amber, never
 * green — the brand has no green, and the "Aberto agora" pill elsewhere in the
 * app still uses --success and needs the same treatment when it is next touched.
 * `open === null` means we have no hours for that place, so nothing is claimed.
 */
function passesByRow(passesBy) {
  if (!passesBy?.length) return '';

  return `<span class="sg-rc-opt__places">
    ${passesBy.map(p => `<span class="sg-rc-place">
      <span class="sg-rc-place__icon" aria-hidden="true">${dsIcon(p.icon)}</span>
      <span class="sg-rc-place__name">${esc(p.name)}</span>
      ${p.open === null ? '' : `<span class="sg-rc-place__status ${p.open ? 'is-open' : 'is-closed'}">
        ${esc(p.open ? 'aberto' : 'fechado')}
      </span>`}
    </span>`).join('')}
  </span>`;
}

/* ============================================================
   4. FOOTER — one hero action.
   An unviable route can still be walked, but not by accident: the CTA is
   disabled until the passenger explicitly acknowledges they would arrive
   after the estimated gate closing.
   ============================================================ */
function footer(selected) {
  return `<div class="sg-rc__footer">
    ${renderChoiceFooterInner(selected)}
  </div>`;
}

export function renderChoiceFooterInner(
  selected = findOption(scoreOptions(navState.routeOptions ?? []), navState.selectedOptionId),
) {
  const doomed = selected?.slack?.status === 'inviavel';
  const acked  = uiState.riskAcknowledged;
  const resuming = navState.activeStepIndex > 0;
  const remaining = resuming ? getEstimatedRemainingMinutes() : 0;
  const primaryLabel = doomed
    ? (resuming ? 'Retomar mesmo assim' : 'Iniciar mesmo assim')
    : resuming
      ? (remaining ? `Retomar · ~${remaining} min` : 'Retomar na etapa final')
      : `Iniciar · ${fmtMin(selected?.minutes ?? 0)} min`;

  return `${doomed ? `<div class="sg-rc__risk" role="alert">
      <p class="sg-rc__risk-text">
        ${dsIcon('lucide:circle-alert')}
        <span>Você chegaria <strong>após o fechamento estimado do portão</strong>.</span>
      </p>
      <label class="sg-rc__risk-ack">
        <input type="checkbox" id="risk-ack"${acked ? ' checked' : ''}>
        <span>Entendo que posso perder o voo</span>
      </label>
    </div>` : renderChoiceFooterNote(selected)}

    ${resuming ? `<button type="button" class="sg-rc__restart" id="restart-nav-btn">
      ${dsIcon('lucide:rotate-ccw')}<span>Reiniciar do início</span>
    </button>` : ''}

    ${Button({
      label: primaryLabel,
      variant: 'primary',
      icon: 'lucide:play',
      block: true,
      disabled: !selected || (doomed && !acked),
      id: 'start-nav-btn',
      className: `sg-rc__cta${doomed ? ' is-risky' : ''}`,
    })}`;
}

/**
 * VISUALLY GONE, still announced. The line read "Mais rápida · 1 min", which
 * is exactly what the selected card already shows a few pixels above — the
 * footer was repeating the card's own headline back at it and spending a row
 * of the fold to do it.
 *
 * It stays in the DOM as an sr-only live region because selecting a card
 * patches the footer WITHOUT a re-render (actions.js/selectRouteOption), and
 * this was the only thing telling a screen-reader user the choice took.
 */
function renderChoiceFooterNote(selected) {
  if (!selected) return '';
  const slack = selected.slack;
  const tail = slack ? ` · ${formatSlack(slack.slackMin)}` : '';

  return `<p class="sr-only" id="sg-rc-selection" aria-live="polite">
    ${esc(selected.name)} · ${esc(fmtMin(selected.minutes))} min${esc(tail)}
  </p>`;
}
