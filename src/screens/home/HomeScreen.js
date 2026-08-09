/**
 * HomeScreen — planning screen, rebuilt on the Design System v5.
 *
 * Root scope is `.sg-ds` (light theme), so every DS component inside
 * inherits the brand tokens. Styles live in styles/screens/home.css.
 *
 * Behaviour hooks consumed by src/app/events.js — do not rename without
 * updating that file:
 *   .open-search[data-kind]   opens SearchOverlay for origin/destination
 *   .clear-loc[data-kind]     clears that field
 *   #swap-btn                 swaps origin <-> destination
 *   #accessible-toggle        toggles accessible routing (actions.js also
 *                             patches this node in place, and reaches for
 *                             .sg-access-row / .sg-access-row__icon)
 *   #flight-time              horário do voo ('HH:MM'); #flight-clear removes it
 *   #calc-btn                 handleCalculate -> RouteSummaryScreen
 *   #help-btn #retry-btn #retry-route-btn #dismiss-error
 *   .sg-home-quick[data-cat-key]  quick-action shortcuts (own class, not
 *                             .sg-quick-card — see events.js and home.css)
 *   #origin-btn #destination-btn   focus targets after clearLocation
 *   #plan-status              live region for the toggle announcement
 */
import { getPublicNodeCategory, getPublicNodeLabel } from '../../services/nodePresentation.js';
import { findNode, getFloorLabel } from '../../state/selectors.js';
import { appData, planState, uiState } from '../../state/appState.js';
import { esc } from '../../utils/format.js';
import { Button, Card, Chip, Header, IconButton, dsIcon } from '../../components/ds/index.js';
import { effectiveFlightDay, gateCloseClock, hasFlight } from '../../services/flightSlack.js';

/* Four quick actions on a single row (Uber/Maps style). The visible label is
   ONE word; the fuller description lives in `hint`, which goes to the
   aria-label where it costs no layout. */
const QUICK_CATS = [
  { key: 'gates',     label: 'Portões',   icon: 'solar:plain-bold', hint: 'encontre seu portão' },
  { key: 'checkin',   label: 'Check-in',  icon: 'solar:bag-2-bold', hint: 'balcões e áreas de check-in' },
  { key: 'restrooms', label: 'Banheiros', icon: 'solar:bath-bold',  hint: 'encontre o banheiro mais próximo' },
  { key: 'food',      label: 'Comida',    icon: 'solar:cup-hot-bold', hint: 'restaurantes e cafés' },
];

/**
 * One endpoint field: label + chosen place + floor/category Chip, with the
 * clear button as a SIBLING of the field button.
 *
 * The previous markup nested a role="button" span inside the field <button>.
 * Nested interactive content is invalid HTML and screen readers announce it
 * unpredictably, so the two controls are now siblings in a positioned
 * wrapper and clear is a real <button> (Enter/Space for free).
 */
function endpointField({ kind, node, label, placeholder, clearLabel, busy = false }) {
  const chip = node
    ? Chip({
        label: `${getFloorLabel(node.floorId)} · ${getPublicNodeCategory(node)}`,
        variant: 'outline',
      })
    : '';

  const name = node ? getPublicNodeLabel(node) : '';
  const a11yLabel = node
    ? `${label}: ${name}. Toque para mudar`
    : `Selecionar ${label.toLowerCase()}`;

  return `<div class="sg-home__field-wrap sg-home__field-wrap--${kind}">
    <button type="button"
      class="sg-home__field open-search"
      data-kind="${kind}"
      id="${kind}-btn"
      aria-label="${esc(a11yLabel)}"
      aria-haspopup="dialog"
      ${busy ? 'disabled' : ''}>
      <span class="sg-home__field-label">${esc(label)}</span>
      <span class="sg-home__field-value${node ? '' : ' is-placeholder'}">${esc(node ? name : placeholder)}</span>
      ${chip ? `<span class="sg-home__field-chip">${chip}</span>` : ''}
    </button>
    ${node ? `<button type="button"
      class="sg-home__clear clear-loc"
      data-kind="${kind}"
      aria-label="${esc(clearLabel)}"
      ${busy ? 'disabled' : ''}>
      ${dsIcon('solar:close-circle-bold')}
    </button>` : ''}
  </div>`;
}

/* The dashed turquoise rail (hollow dot = origin, filled dot = destination)
   is drawn entirely in CSS from .sg-home__field-wrap — see home.css.
   Anchoring the dots to each field, rather than spacing them down a
   separate column, keeps them level with the place name whether or not
   the field is showing a Chip. */

/**
 * Horário do voo — the ONE time input in the app, and the reason the product
 * exists: with it, every route can say how much slack it leaves.
 *
 * OPTIONAL BUT PUSHED (the Waze "home/work" pattern): SkyGate is built for the
 * passenger with a flight, so the field gets a real block, an inviting line of
 * copy and brand colour — not a timid "optional" footnote. "Calcular rota"
 * works with or without it; someone without a flight simply gets an excellent
 * indoor map and no slack.
 *
 * Departure time, NOT boarding time: departure is what a passenger knows by
 * heart. The estimated gate-close margin is applied for them (APP_CONFIG.flight).
 */
function flightField(busy = false) {
  const value = planState.flightTime;
  const filled = hasFlight();
  const gateClose = filled ? gateCloseClock() : '';

  /* COLLAPSED BY DEFAULT — the field is optional, so it must not cost the same
     vertical budget as the origin/destination pair it sits under. It opens
     already expanded once a time is set, because then it carries a real answer
     ("portão fecha ~19:04") the traveller came back to read.

     <details>/<summary> on purpose, NOT a JS disclosure: the platform gives the
     open/closed state, the Enter/Space handling and the aria-expanded for free,
     and none of it touches app state — which keeps this a presentation change.

     The two summary labels are BOTH rendered and swapped in CSS on `.is-filled`.
     setFlightTime() (actions.js) patches that class on this very element without
     a re-render, so the collapsed line follows the value for free; rendering the
     text in JS instead would leave it stale until the next render(). */
  const flightType = planState.flightType === 'international' ? 'international' : 'domestic';
  const flightDay = effectiveFlightDay();
  return `<details class="sg-home__flight${filled ? ' is-filled' : ''}"${filled ? ' open' : ''}${busy ? ' inert aria-disabled="true"' : ''}>
    <summary class="sg-home__flight-summary">
      <span class="sg-home__flight-icon" aria-hidden="true">${dsIcon('lucide:plane-takeoff')}</span>
      <span class="sg-home__flight-summary-text">
        <span class="sg-home__flight-add">Adicionar horário do voo</span>
        <span class="sg-home__flight-set">Horário do voo</span>
      </span>
      <span class="sg-home__flight-caret" aria-hidden="true">${dsIcon('lucide:chevron-down')}</span>
    </summary>

    <div class="sg-home__flight-body">
      <p class="sg-home__flight-copy" id="flight-help">
        ${filled
          ? `${flightDay === 'tomorrow' ? 'Amanhã' : 'Hoje'} · portão fecha <strong>~${esc(gateClose)}</strong> (estimado).`
          : 'Adicione seu voo e veja quanto tempo sobra.'}
      </p>
      <div class="sg-home__flight-control">
        <!-- aria-label, not a visible <label for>: a <label> inside <summary>
             would fight the disclosure for the same click. -->
        <input type="time" id="flight-time" class="sg-home__flight-input"
          value="${esc(value)}" step="300"
          aria-label="Horário do voo" aria-describedby="flight-help"${busy ? ' disabled' : ''}>
        <button type="button" class="sg-home__flight-clear${filled ? '' : ' is-hidden'}" id="flight-clear"
          aria-label="Remover horário do voo"${filled && !busy ? '' : ' disabled'}>${dsIcon('lucide:x')}</button>
      </div>

      <fieldset class="sg-home__flight-type">
        <legend>Dia do voo</legend>
        <div class="sg-home__flight-segment">
          <label>
            <input type="radio" name="flight-day" value="today"
              ${flightDay === 'today' ? 'checked' : ''}${busy ? ' disabled' : ''}>
            <span>Hoje</span>
          </label>
          <label>
            <input type="radio" name="flight-day" value="tomorrow"
              ${flightDay === 'tomorrow' ? 'checked' : ''}${busy ? ' disabled' : ''}>
            <span>Amanhã</span>
          </label>
        </div>
      </fieldset>

      <fieldset class="sg-home__flight-type">
        <legend>Tipo de voo</legend>
        <div class="sg-home__flight-segment">
          <label>
            <input type="radio" name="flight-type" value="domestic"
              ${flightType === 'domestic' ? 'checked' : ''}${busy ? ' disabled' : ''}>
            <span>Doméstico</span>
          </label>
          <label>
            <input type="radio" name="flight-type" value="international"
              ${flightType === 'international' ? 'checked' : ''}${busy ? ' disabled' : ''}>
            <span>Internacional</span>
          </label>
        </div>
        <p>Usamos o tipo do voo para estimar o fechamento do portão.</p>
      </fieldset>
    </div>
  </details>`;
}

function routeCard({ oNode, dNode, disabled, isCalc, hint, same, isAccessible, offline }) {
  const body = `
    ${uiState.error ? `
      <div class="sg-home__error" role="alert">
        ${dsIcon('solar:danger-circle-bold')}
        <span>${esc(uiState.error)}</span>
        ${offline
          ? `<button type="button" id="retry-btn" class="sg-home__error-retry">Tentar novamente</button>`
          : `<button type="button" id="retry-route-btn" class="sg-home__error-action">Tentar de novo</button>
             <button type="button" id="dismiss-error" class="sg-home__error-close" aria-label="Fechar alerta">
               ${dsIcon('solar:close-circle-bold')}
             </button>`}
      </div>` : ''}

    <div class="sg-home__journey" role="group" aria-label="Selecionar origem e destino">
      <div class="sg-home__fields${oNode && dNode ? ' is-filled' : ''}">
        ${endpointField({
          kind: 'origin', node: oNode, label: 'Ponto de partida', busy: isCalc,
          placeholder: 'Onde você está?', clearLabel: 'Limpar ponto de partida',
        })}
        ${endpointField({
          kind: 'destination', node: dNode, label: 'Destino', busy: isCalc,
          placeholder: 'Para onde deseja ir?', clearLabel: 'Limpar destino',
        })}
      </div>
      <div class="sg-home__swap">
        ${IconButton({
          icon: 'solar:round-sort-vertical-bold',
          label: 'Inverter ponto de partida e destino',
          id: 'swap-btn',
          disabled: isCalc || (!planState.originCode && !planState.destinationCode),
        })}
      </div>
    </div>

    <div class="sg-home__divider" role="presentation"></div>

    ${flightField(isCalc)}

    <div class="sg-home__divider" role="presentation"></div>

    <!-- Class names carried over from the previous markup on purpose:
         actions.js patches .sg-access-row__icon in place when it flips. -->
    <!-- ONE compact line: icon, label, switch. The old second line ("Usa
         elevadores e evita escadas.") is gone from the layout, not from the
         product — #plan-status already announces exactly that sentence to
         screen readers on every flip (actions.js/toggleAccessibleRoute), so
         dropping the visible copy costs no accessibility. aria-describedby
         went with it rather than being left pointing at a removed node. -->
    <div class="sg-access-row sg-home__access">
      ${dsIcon('solar:accessibility-bold', `sg-access-row__icon${isAccessible ? ' is-on' : ''}`)}
      <span class="sg-home__access-copy">
        <span class="sg-home__access-title" id="access-title">Evitar escadas</span>
        <span class="sg-home__access-hint" id="access-hint">Prioriza elevadores sempre que possível.</span>
      </span>
      <button type="button"
        class="sg-toggle sg-home__toggle${isAccessible ? ' is-on' : ''}"
        id="accessible-toggle"
        role="switch"
        aria-checked="${isAccessible}"
        aria-labelledby="access-title"
        aria-describedby="access-hint"
        ${isCalc ? 'disabled' : ''}>
        <span class="sg-toggle__thumb" aria-hidden="true"></span>
      </button>
    </div>

    <div class="sg-home__action">
      ${isCalc
        ? `<button type="button" class="ds-btn ds-btn--primary ds-btn--block" id="calc-btn" disabled aria-busy="true">
             <span class="sg-home__spinner" aria-hidden="true"></span><span>Calculando…</span>
           </button>`
        : Button({
            label: 'Ver rotas',
            variant: 'primary',
            iconRight: 'solar:arrow-right-bold',
            block: true,
            disabled,
            id: 'calc-btn',
          })}
      ${hint ? `<p class="sg-home__hint${same ? ' is-warn' : ''}" role="status" aria-live="polite">${esc(hint)}</p>` : ''}
    </div>
  `;

  return Card({ variant: 'raised', html: body, className: 'sg-home__card' });
}

/**
 * A layout-matched first-load scaffold keeps the hierarchy stable while the
 * airport map arrives. Users see what is becoming available instead of a
 * spinner floating in a blank page, which reduces perceived wait and shift.
 */
function loadingScaffold(message) {
  return `<div class="sg-home__loading" role="status" aria-live="polite">
    <span class="sr-only">${esc(message)}</span>
    <div class="sg-home__loading-card" aria-hidden="true">
      <div class="sg-home__skeleton-route">
        <span class="sg-home__skeleton-dot"></span>
        <span class="sg-home__skeleton-field">
          <span class="sg-home__skeleton-line is-label"></span>
          <span class="sg-home__skeleton-line is-value"></span>
        </span>
      </div>
      <div class="sg-home__skeleton-route">
        <span class="sg-home__skeleton-dot is-filled"></span>
        <span class="sg-home__skeleton-field">
          <span class="sg-home__skeleton-line is-label"></span>
          <span class="sg-home__skeleton-line is-value is-short"></span>
        </span>
      </div>
      <span class="sg-home__skeleton-rule"></span>
      <span class="sg-home__skeleton-row"></span>
      <span class="sg-home__skeleton-button"></span>
    </div>
    <p class="sg-home__loading-copy" aria-hidden="true">${esc(message)}</p>
  </div>`;
}

function offlineCard() {
  return Card({
    variant: 'raised',
    className: 'sg-home__offline',
    html: `<div role="alert">
      <span class="sg-home__offline-icon" aria-hidden="true">${dsIcon('solar:danger-circle-bold')}</span>
      <h2>Não foi possível conectar</h2>
      <p>Precisamos dos dados do aeroporto para buscar locais e calcular sua rota.</p>
      ${Button({
        label: 'Tentar novamente',
        variant: 'primary',
        icon: 'solar:restart-bold',
        block: true,
        id: 'retry-btn',
      })}
    </div>`,
  });
}

export function renderPlanning() {
  const oNode = findNode(planState.originCode);
  const dNode = findNode(planState.destinationCode);
  const isCalc   = uiState.loading === 'route';
  const same     = planState.originCode && planState.originCode === planState.destinationCode;
  const missing  = !planState.originCode || !planState.destinationCode;
  const disabled = missing || same || !!uiState.loading;
  const hint = same   ? 'Origem e destino devem ser diferentes.'
    : missing && planState.originCode      ? 'Selecione o destino também.'
    : missing && planState.destinationCode ? 'Selecione a origem também.'
    : '';
  const isAccessible = planState.accessibleRoute;
  const airportCity  = appData.airport?.city ?? 'Fortaleza';
  const airportLabel = uiState.loading === 'airports' ? 'Conectando…' : `Aeroporto de ${airportCity}`;

  const blocked = uiState.loading === 'airports' || uiState.loading === 'map';

  // Backend unreachable: the airport data never arrived. The screen still
  // renders in full — only routing actually needs the server, so the error
  // is an inline banner and the CTA is disabled, rather than a dead end.
  const offline = !!uiState.error && !appData.floors.length;

  return `
    <div class="sg-ds sg-home" id="planning-root" aria-busy="${isCalc}">

      ${Header({
        title: 'SkyGate',
        subtitle: `FOR · ${airportLabel}`,
        subtitleIcon: 'solar:map-point-bold',
        onHelp: true,
        helpId: 'help-btn',
        wordmark: true,   // the real lockup spells "SkyGate" — no text title
        className: 'sg-home__header',
      })}

      <!-- Title only. The subtitle ("Escolha seu ponto de partida e destino")
           said what the two field placeholders below already say, and cost a
           whole line above the fold. -->
      <div class="sg-home__heading">
        <h1 class="sg-home__title">Encontre seu caminho</h1>
      </div>

      <div class="sg-home__main">
        <div class="sg-home__scroll">
          ${blocked ? `
            ${loadingScaffold(
              uiState.loading === 'airports'
                ? 'Conectando ao aeroporto…'
                : 'Preparando o mapa do terminal…'
            )}
          ` : `
            ${offline ? offlineCard() : `
            ${routeCard({ oNode, dNode, disabled, isCalc, hint, same, isAccessible, offline: false })}

            <section class="sg-home__quick" aria-labelledby="quick-title">
              <h2 class="sg-home__section-title" id="quick-title">Encontre rapidamente</h2>
              <div class="sg-home__quick-row">
                ${QUICK_CATS.map(cat => `
                  <button type="button"
                    class="sg-home-quick"
                    data-cat-key="${esc(cat.key)}"
                    aria-label="${esc(cat.label)} — ${esc(cat.hint)}"
                    ${isCalc ? 'disabled' : ''}>
                    <span class="sg-home-quick__icon" aria-hidden="true">${dsIcon(cat.icon)}</span>
                    <span class="sg-home-quick__label">${esc(cat.label)}</span>
                  </button>
                `).join('')}
              </div>
            </section>`}
          `}
        </div>
      </div>

      <div id="plan-status" class="sr-only" role="status" aria-live="polite" aria-atomic="true"></div>
    </div>
  `;
}


// ---- SUMMARY ----
