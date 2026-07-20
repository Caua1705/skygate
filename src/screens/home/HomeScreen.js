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
 *   #calc-btn                 handleCalculate -> RouteSummaryScreen
 *   #help-btn #retry-btn #dismiss-error
 *   .sg-quick-card[data-cat-key]
 *   #origin-btn #destination-btn   focus targets after clearLocation
 *   #plan-status              live region for the toggle announcement
 */
import { getPublicNodeCategory, getPublicNodeLabel } from '../../services/nodePresentation.js';
import { findNode, getFloorLabel } from '../../state/selectors.js';
import { appData, planState, uiState } from '../../state/appState.js';
import { esc } from '../../utils/format.js';
import { Button, Card, Chip, Header, IconButton, dsIcon } from '../../components/ds/index.js';

/* Four columns on the grid, so the visible copy is kept SHORT — at 4-up on a
   360px phone each card is only ~78px wide. The long-form description lives
   in `hint`, which goes to the aria-label, where it costs no layout. */
const QUICK_CATS = [
  { key: 'gates',    label: 'Portões',     icon: 'solar:plain-bold',   subtitle: 'Embarque',     hint: 'Encontre seu portão'         },
  { key: 'services', label: 'Check-in',    icon: 'solar:bag-2-bold',   subtitle: 'Balcões',      hint: 'Balcões e áreas de check-in' },
  { key: 'food',     label: 'Alimentação', icon: 'solar:cup-hot-bold', subtitle: 'Restaurantes', hint: 'Restaurantes e lojas'        },
  { key: 'services', label: 'Serviços',    icon: 'solar:bell-bold',    subtitle: 'Facilidades',  hint: 'Facilidades do aeroporto'    },
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
function endpointField({ kind, node, label, placeholder, clearLabel }) {
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
      aria-haspopup="dialog">
      <span class="sg-home__field-label">${esc(label)}</span>
      <span class="sg-home__field-value${node ? '' : ' is-placeholder'}">${esc(node ? name : placeholder)}</span>
      ${chip ? `<span class="sg-home__field-chip">${chip}</span>` : ''}
    </button>
    ${node ? `<button type="button"
      class="sg-home__clear clear-loc"
      data-kind="${kind}"
      aria-label="${esc(clearLabel)}">
      ${dsIcon('solar:close-circle-bold')}
    </button>` : ''}
  </div>`;
}

/* The dashed turquoise rail (hollow dot = origin, filled dot = destination)
   is drawn entirely in CSS from .sg-home__field-wrap — see home.css.
   Anchoring the dots to each field, rather than spacing them down a
   separate column, keeps them level with the place name whether or not
   the field is showing a Chip. */

function routeCard({ oNode, dNode, disabled, isCalc, hint, same, isAccessible, offline }) {
  const body = `
    ${uiState.error ? `
      <div class="sg-home__error" role="alert">
        ${dsIcon('solar:danger-circle-bold')}
        <span>${esc(uiState.error)}</span>
        ${offline
          ? `<button type="button" id="retry-btn" class="sg-home__error-retry">Tentar novamente</button>`
          : `<button type="button" id="dismiss-error" class="sg-home__error-close" aria-label="Fechar alerta">
               ${dsIcon('solar:close-circle-bold')}
             </button>`}
      </div>` : ''}

    <div class="sg-home__journey" role="group" aria-label="Selecionar origem e destino">
      <div class="sg-home__fields${oNode && dNode ? ' is-filled' : ''}">
        ${endpointField({
          kind: 'origin', node: oNode, label: 'Ponto de partida',
          placeholder: 'Onde você está?', clearLabel: 'Limpar ponto de partida',
        })}
        ${endpointField({
          kind: 'destination', node: dNode, label: 'Destino',
          placeholder: 'Para onde deseja ir?', clearLabel: 'Limpar destino',
        })}
      </div>
      <div class="sg-home__swap">
        ${IconButton({
          icon: 'solar:round-sort-vertical-bold',
          label: 'Inverter ponto de partida e destino',
          id: 'swap-btn',
          disabled: !planState.originCode && !planState.destinationCode,
        })}
      </div>
    </div>

    <div class="sg-home__divider" role="presentation"></div>

    <!-- Class names carried over from the previous markup on purpose:
         actions.js patches .sg-access-row__icon in place when it flips. -->
    <div class="sg-access-row sg-home__access">
      ${dsIcon('solar:accessibility-bold', `sg-access-row__icon${isAccessible ? ' is-on' : ''}`)}
      <div class="sg-home__access-text">
        <span class="sg-home__access-title" id="access-title">Rota acessível</span>
        <span class="sg-home__access-desc" id="access-desc">Usa elevadores e evita escadas.</span>
      </div>
      <button type="button"
        class="sg-toggle sg-home__toggle${isAccessible ? ' is-on' : ''}"
        id="accessible-toggle"
        role="switch"
        aria-checked="${isAccessible}"
        aria-labelledby="access-title"
        aria-describedby="access-desc">
        <span class="sg-toggle__thumb" aria-hidden="true"></span>
      </button>
    </div>

    <div class="sg-home__action">
      ${isCalc
        ? `<button type="button" class="ds-btn ds-btn--primary ds-btn--block" id="calc-btn" disabled aria-busy="true">
             <span class="sg-home__spinner" aria-hidden="true"></span><span>Calculando…</span>
           </button>`
        : Button({
            label: 'Calcular rota',
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
    <div class="sg-ds sg-home" id="planning-root">

      <!-- HERO: purely decorative airport photo + brand overlay behind the
           header and title. The photo, framing and measured contrast live in
           styles/screens/home.css (.sg-home__hero). If the image is ever
           missing, the photo layer just fails to load and the brand gradient
           carries the band — a designed fallback, not a bug. -->
      <div class="sg-home__hero" aria-hidden="true" role="presentation"></div>

      ${Header({
        title: 'SkyGate',
        subtitle: `FOR · ${airportLabel}`,
        subtitleIcon: 'solar:map-point-bold',
        onHelp: true,
        helpId: 'help-btn',
        wordmark: true,   // the real lockup spells "SkyGate" — no text title
        className: 'sg-home__header',
      })}

      <div class="sg-home__heading">
        <h1 class="sg-home__title">Encontre seu caminho</h1>
        <p class="sg-home__subtitle">Escolha seu ponto de partida e destino.</p>
      </div>

      <main class="sg-home__main">
        <div class="sg-home__scroll">
          ${blocked ? `
            <div class="sg-home__state" role="status" aria-live="polite">
              <div class="sg-spinner"></div>
              <p>${uiState.loading === 'airports' ? 'Conectando ao aeroporto…' : 'Carregando dados…'}</p>
            </div>
          ` : `
            ${routeCard({ oNode, dNode, disabled: disabled || offline, isCalc, hint, same, isAccessible, offline })}

            <section class="sg-home__quick" aria-labelledby="quick-title">
              <h2 class="sg-home__section-title" id="quick-title">Encontre rapidamente</h2>
              <div class="sg-home__quick-scroll">
                ${QUICK_CATS.map(cat => `
                  <button type="button"
                    class="sg-quick-card sg-home__quick-card"
                    data-cat-key="${esc(cat.key)}"
                    aria-label="${esc(cat.label)}: ${esc(cat.hint)}">
                    <span class="sg-home__quick-icon" aria-hidden="true">${dsIcon(cat.icon)}</span>
                    <span class="sg-home__quick-name">${esc(cat.label)}</span>
                    <span class="sg-home__quick-sub">${esc(cat.subtitle)}</span>
                  </button>
                `).join('')}
              </div>
            </section>
          `}
        </div>
      </main>

      <div id="plan-status" class="sr-only" role="status" aria-live="polite" aria-atomic="true"></div>
    </div>
  `;
}


// ---- SUMMARY ----
