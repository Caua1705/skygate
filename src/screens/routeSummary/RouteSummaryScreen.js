/**
 * RouteChoiceScreen — "Escolha seu caminho" (app.mode === 'summary').
 *
 * The middle screen of the flow: Home picks A → B (and, ideally, the flight
 * time) and calculates; this screen decides HOW to walk it; navigation
 * executes it. It is NOT a summary of one answer — it is the choice between
 * several, scored against the passenger's real margin.
 *
 * WITH a flight time this is a copilot: every card carries its slack, a
 * temperature badge, and one route is marked as the app's recommendation —
 * the scenic one when there is room, the direct one when there is not.
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

export function renderSummary() {
  const route = navState.route;
  if (!route) { app.mode = 'planning'; return renderPlanning(); }

  const options  = scoreOptions(navState.routeOptions ?? []);
  const selected = findOption(options, navState.selectedOptionId);

  return `
    <div class="sg-ds sg-rc" id="route-choice-root">

      <header class="sg-rc__header" role="banner">
        <button type="button" class="sg-rc__back" id="back-to-planning-btn" aria-label="Voltar ao planejamento">
          ${dsIcon('lucide:arrow-left')}
        </button>
        <h1 class="sg-rc__title">Escolha seu caminho</h1>
        <button type="button" class="sg-rc__edit" id="edit-route-btn"
          aria-label="Alterar origem e destino">
          ${dsIcon('lucide:pencil')}<span>Alterar</span>
        </button>
      </header>

      <div class="sg-rc__scroll">
        ${tripLine()}
        ${hasFlight() ? marginBanner() : flightInvite()}
        ${optionsSection(options, selected)}
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
function marginBanner() {
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
        voo ${esc(planState.flightTime)}
      </p>
    </div>
  </section>`;
}

/* ============================================================
   2b. WITHOUT a flight — the app saying "the best of me is over here".
   Present and visible, never a blocker.
   ============================================================ */
function flightInvite() {
  return `<section class="sg-rc__invite">
    <span class="sg-rc__invite-icon" aria-hidden="true">${dsIcon('lucide:plane-takeoff')}</span>
    <div class="sg-rc__invite-text">
      <h2 class="sg-rc__invite-title">Vai pegar um voo?</h2>
      <p class="sg-rc__invite-copy">
        Com o horário do voo, o SkyGate mostra quanto tempo sobra em cada caminho
        e recomenda o melhor para a sua margem.
      </p>
    </div>
    ${Button({
      label: 'Adicionar horário do voo',
      variant: 'outline',
      icon: 'lucide:plus',
      block: true,
      id: 'add-flight-btn',
      className: 'sg-rc__invite-cta',
    })}
  </section>`;
}

/* ============================================================
   3. ROUTE CARDS — the hero.
   Real radios in labels: keyboard grouping, arrow keys and the checked state
   come from the platform instead of being reimplemented on divs.
   ============================================================ */
function optionsSection(options, selected) {
  if (!options.length) return '';

  return `<section class="sg-rc__options" aria-labelledby="sg-rc-options-h">
    <h2 class="sg-rc__section-title" id="sg-rc-options-h">Como você quer atravessar</h2>
    <div class="sg-rc__list" id="route-option-list">${renderChoiceOptions(options, selected)}</div>
  </section>`;
}

/** The cards alone — re-rendered in place when the selection changes. */
export function renderChoiceOptions(
  options = scoreOptions(navState.routeOptions ?? []),
  selected = findOption(options, navState.selectedOptionId),
) {
  return options.map(o => optionCard(o, o.id === selected?.id)).join('');
}

function optionCard(option, isSelected) {
  const slack = option.slack;
  const doomed = slack?.status === 'inviavel';
  const hint = slackHint(option);

  return `<label class="sg-rc-opt${isSelected ? ' is-selected' : ''}${doomed ? ' is-doomed' : ''}">
    <input type="radio" name="sg-route-option" class="sg-rc-opt__input route-option-input"
      value="${esc(option.id)}"${isSelected ? ' checked' : ''}>

    <span class="sg-rc-opt__body">
      ${option.recommended ? `<span class="sg-rc-opt__rec">
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
    </span>

    <span class="sg-rc-opt__mark" aria-hidden="true">${dsIcon('lucide:circle-check')}</span>
  </label>`;
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
   after boarding.
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

  return `${doomed ? `<div class="sg-rc__risk" role="alert">
      <p class="sg-rc__risk-text">
        ${dsIcon('lucide:circle-alert')}
        <span>Você chegaria <strong>após o embarque</strong> por este caminho.</span>
      </p>
      <label class="sg-rc__risk-ack">
        <input type="checkbox" id="risk-ack"${acked ? ' checked' : ''}>
        <span>Entendo que posso perder o voo</span>
      </label>
    </div>` : renderChoiceFooterNote(selected)}

    ${Button({
      label: doomed ? 'Iniciar mesmo assim' : 'Iniciar navegação',
      variant: 'primary',
      icon: 'lucide:play',
      block: true,
      disabled: doomed && !acked,
      id: 'start-nav-btn',
      className: `sg-rc__cta${doomed ? ' is-risky' : ''}`,
    })}`;
}

function renderChoiceFooterNote(selected) {
  if (!selected) return '';
  const slack = selected.slack;
  const tail = slack ? ` · ${formatSlack(slack.slackMin)}` : '';

  return `<p class="sg-rc__footer-note" id="sg-rc-selection" aria-live="polite">
    <strong>${esc(selected.name)}</strong> · ${esc(fmtMin(selected.minutes))} min${esc(tail)}
  </p>`;
}
