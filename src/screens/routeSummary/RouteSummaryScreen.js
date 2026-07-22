/**
 * RouteChoiceScreen — "Escolha seu caminho" (app.mode === 'summary').
 *
 * The middle screen of the flow: Home picks A → B and calculates, this screen
 * decides HOW to walk it, navigation executes it. It is NOT a summary of one
 * answer — it is the choice between several, which is the whole point of the
 * product: fast, or via the food court, or via the shops.
 *
 * The calculation stays on Home. This screen only ever READS navState.route
 * and the options built from it (services/routeOptions.js).
 *
 * Light theme, like Home. Only the active navigation screen is dark.
 *
 * Behaviour hooks consumed by src/app/events.js — do not rename without
 * updating that file:
 *   #back-to-planning-btn     back to Home
 *   #edit-route-btn           "Alterar" — back to Home, route discarded
 *   .sg-rc__chip[data-budget] time-budget presets
 *   #budget-time              'HH:MM' input behind the "Horário exato" preset
 *   .route-option-input       the radio per route card
 *   #start-nav-btn            enters navigation with the selected option
 */
import { getPublicNodeLabel, getPublicNodeSubtitle } from '../../services/nodePresentation.js';
import { app, navState, planState } from '../../state/appState.js';
import { renderPlanning } from '../home/HomeScreen.js';
import { findNode, getFloorLabel, getModeLabel } from '../../state/selectors.js';
import { esc, fmtMin } from '../../utils/format.js';
import { Button, Chip, dsIcon } from '../../components/ds/index.js';
import { budgetFit, findOption } from '../../services/routeOptions.js';
import { BUDGET_PRESETS, budgetMinutes, formatBudget } from '../../services/timeBudget.js';

export function renderSummary() {
  const route = navState.route;
  if (!route) { app.mode = 'planning'; return renderPlanning(); }

  const options  = navState.routeOptions ?? [];
  const selected = findOption(options, navState.selectedOptionId);
  const budget   = budgetMinutes();

  return `
    <div class="sg-ds sg-rc" id="route-choice-root">

      <header class="sg-rc__header" role="banner">
        <button type="button" class="sg-rc__back" id="back-to-planning-btn" aria-label="Voltar ao planejamento">
          ${dsIcon('solar:arrow-left-linear')}
        </button>
        <h1 class="sg-rc__title">Escolha seu caminho</h1>
        <button type="button" class="sg-rc__edit" id="edit-route-btn"
          aria-label="Alterar origem e destino">
          ${dsIcon('solar:pen-2-linear')}<span>Alterar</span>
        </button>
      </header>

      <div class="sg-rc__scroll">
        ${tripLine()}
        ${budgetSection(budget)}
        ${optionsSection(options, selected, budget)}
      </div>

      <div class="sg-rc__footer">
        ${renderChoiceFooterNote(selected, budget)}
        ${Button({
          label: 'Iniciar navegação',
          variant: 'primary',
          icon: 'solar:play-bold',
          block: true,
          id: 'start-nav-btn',
          className: 'sg-rc__cta',
        })}
      </div>
    </div>
  `;
}

/* ============================================================
   1. TRIP LINE — where you are and where you are going.
   Compact on purpose: it is context, not the hero. The hero is the choice.
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
        icon: isAccessible ? 'solar:accessibility-bold' : 'solar:bolt-bold',
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
   2. TIME BUDGET — optional, and it says so.
   Answering it enriches every card below (progressive disclosure); skipping
   it costs the traveller nothing.
   ============================================================ */
function budgetSection(budget) {
  const active = planState.timeBudget;

  const chips = BUDGET_PRESETS.map(p => {
    const on = active === p.key;
    return `<button type="button"
      class="sg-rc__chip${on ? ' is-selected' : ''}"
      data-budget="${esc(p.key)}"
      aria-pressed="${on}">
      ${dsIcon(p.icon)}<span>${esc(p.label)}</span>
    </button>`;
  }).join('');

  const exactOpen = active === 'exact';

  return `<section class="sg-rc__budget" aria-labelledby="sg-rc-budget-h">
    <div class="sg-rc__budget-head">
      <h2 class="sg-rc__section-title" id="sg-rc-budget-h">Quanto tempo você tem?</h2>
      <span class="sg-rc__optional">opcional</span>
    </div>

    <div class="sg-rc__chips" role="group" aria-labelledby="sg-rc-budget-h">${chips}</div>

    ${exactOpen ? `<div class="sg-rc__exact">
      <label class="sg-rc__exact-label" for="budget-time">Preciso estar lá às</label>
      <input type="time" id="budget-time" class="sg-rc__exact-input"
        value="${esc(planState.budgetUntil)}" step="300">
    </div>` : ''}

    <div class="sg-rc__budget-echo-slot" id="budget-echo">${renderBudgetEcho(budget)}</div>
  </section>`;
}

/**
 * "Você tem 45 min pela frente." Its own renderer because typing in the time
 * field must update it WITHOUT re-rendering the field — see refreshRouteChoice
 * in app/actions.js.
 */
export function renderBudgetEcho(budget = budgetMinutes()) {
  if (!Number.isFinite(budget) || budget <= 0) return '';
  return `<p class="sg-rc__budget-echo">
    ${dsIcon('solar:clock-circle-bold')}
    <span>Você tem <strong>${esc(formatBudget(budget))}</strong> pela frente.</span>
  </p>`;
}

/* ============================================================
   3. ROUTE CARDS — the hero.
   Real radios in labels: keyboard grouping, arrow keys and the checked state
   come from the platform instead of being reimplemented on divs.
   ============================================================ */
function optionsSection(options, selected, budget) {
  if (!options.length) return '';

  return `<section class="sg-rc__options" aria-labelledby="sg-rc-options-h">
    <h2 class="sg-rc__section-title" id="sg-rc-options-h">Como você quer atravessar</h2>
    <div class="sg-rc__list" id="route-option-list">${renderChoiceOptions(options, selected, budget)}</div>
  </section>`;
}

/** The cards alone — re-rendered in place when the time budget changes. */
export function renderChoiceOptions(
  options = navState.routeOptions ?? [],
  selected = findOption(options, navState.selectedOptionId),
  budget = budgetMinutes(),
) {
  return options.map((o, i) => optionCard(o, o.id === selected?.id, i === 0, budget)).join('');
}

function optionCard(option, isSelected, isFastest, budget) {
  const fit = budgetFit(option, budget, isFastest);

  return `<label class="sg-rc-opt${isSelected ? ' is-selected' : ''}">
    <input type="radio" name="sg-route-option" class="sg-rc-opt__input route-option-input"
      value="${esc(option.id)}"${isSelected ? ' checked' : ''}>

    <span class="sg-rc-opt__body">
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
            : (isFastest ? 'direto' : 'sem desvio')}
        </span>
        <span class="sg-rc-opt__dot" aria-hidden="true">·</span>
        <span class="sg-rc-opt__floors">
          ${dsIcon('solar:layers-bold')}
          ${esc(String(option.floors))} ${option.floors === 1 ? 'piso' : 'pisos'}
        </span>
        ${option.isEstimate
          ? `<span class="sg-rc-opt__dot" aria-hidden="true">·</span>
             <span class="sg-rc-opt__est">tempo estimado</span>`
          : ''}
      </span>

      ${fit ? `<span class="sg-rc-opt__fit sg-rc-opt__fit--${fit.tone}">
        ${dsIcon(fit.tone === 'over' ? 'solar:danger-circle-bold' : 'solar:check-circle-bold')}
        <span><strong>${esc(fit.label)}</strong>${fit.hint ? ` · ${esc(fit.hint)}` : ''}</span>
      </span>` : ''}

      ${passesByRow(option.passesBy)}
    </span>

    <span class="sg-rc-opt__mark" aria-hidden="true">${dsIcon('solar:check-circle-bold')}</span>
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
   4. FOOTER — one hero action, plus the one line that makes the choice legible.
   ============================================================ */
export function renderChoiceFooterNote(
  selected = findOption(navState.routeOptions ?? [], navState.selectedOptionId),
  budget = budgetMinutes(),
) {
  if (!selected) return '';
  const fit = budgetFit(selected, budget, selected.id === navState.routeOptions?.[0]?.id);

  const tail = fit
    ? ` · ${fit.tone === 'over' ? `${Math.abs(fit.slack)} min a mais do que você tem` : fit.label}`
    : '';

  return `<p class="sg-rc__footer-note" id="sg-rc-selection" aria-live="polite">
    <strong>${esc(selected.name)}</strong> · ${esc(fmtMin(selected.minutes))} min${esc(tail)}
  </p>`;
}
