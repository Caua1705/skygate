import { getPublicNodeCategory, getPublicNodeLabel } from '../../services/nodePresentation.js';
import { findNode, getFloorLabel } from '../../state/selectors.js';
import { appData, planState, uiState } from '../../state/appState.js';
import { getNodeMeta } from '../../app/constants.js';
import { esc } from '../../utils/format.js';
import { root } from '../../utils/dom.js';

/* ============================================================
   10. RENDERERS
   ============================================================ */

// ---- PLANNING ----

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
  const airportCity = appData.airport?.city ?? 'Fortaleza';
  const airportLabel = uiState.loading === 'airports' ? 'Conectando…' : `Aeroporto de ${airportCity}`;

  const QUICK_CATS = [
    { key:'gates',      label:'Portões',           icon:'solar:plain-bold',        subtitle:'Encontre seu portão'      },
    { key:'services',   label:'Check-in',           icon:'solar:bag-2-bold',        subtitle:'Balcões e áreas'          },
    { key:'food',       label:'Alimentação e lojas',icon:'solar:cup-hot-bold',      subtitle:'Restaurantes e compras'   },
    { key:'services',   label:'Serviços',           icon:'solar:bell-bold',         subtitle:'Facilidades do aeroporto' },
  ];

  // Journey rail filled state (both locations chosen)
  const railFilled = (oNode && dNode) ? ' is-filled' : '';

  // Floor + category pill shown under a selected origin/destination value
  const metaPill = (node) => !node ? '' : `<span class="sg-journey-field__meta">
    <iconify-icon icon="${getNodeMeta(node.type).icon}" aria-hidden="true"></iconify-icon>
    <span>${esc(getFloorLabel(node.floorId))} · ${esc(getPublicNodeCategory(node))}</span>
  </span>`;

  return `
    <div class="sg-planning" id="planning-root">

      <!-- ░░ DECORATIVE AIRPORT BACKGROUND ░░ -->
      <div class="sg-hero-bg" aria-hidden="true" role="presentation">
        <img
          src="assets/airport-lounge-hero.webp"
          alt=""
          class="sg-hero-bg__img"
          aria-hidden="true"
          loading="eager"
          fetchpriority="high"
          decoding="async"
        >
        <div class="sg-hero-bg__overlay" aria-hidden="true"></div>
      </div>

      <!-- ░░ BRAND UTILITY ROW ░░ -->
      <header class="sg-brandbar" role="banner">
        <div class="sg-brandbar__left">
          <span class="sg-brandbar__logo-tile" aria-hidden="true">
            <img src="assets/logo.png" alt="" class="sg-brandbar__logo">
          </span>
          <span class="sg-brandbar__wordmark">SkyGate</span>
        </div>
        <button
          type="button"
          class="sg-help-btn"
          id="help-btn"
          aria-label="Ajuda sobre o SkyGate"
        >
          <iconify-icon icon="solar:question-circle-bold" aria-hidden="true"></iconify-icon>
        </button>
      </header>

      <!-- ░░ AIRPORT CONTEXT (static — only Fortaleza supported) ░░ -->
      <div class="sg-airport-ctx" aria-label="Aeroporto de Fortaleza">
        <iconify-icon icon="solar:map-point-bold" class="sg-airport-ctx__icon" aria-hidden="true"></iconify-icon>
        <span class="sg-airport-ctx__text">FOR&nbsp;·&nbsp;${esc(airportLabel)}</span>
      </div>

      <!-- ░░ HEADING REGION ░░ -->
      <div class="sg-heading-region">
        <h1 class="sg-heading">Encontre<br>seu caminho</h1>
        <p class="sg-heading-sub">Escolha seu ponto de partida e destino.</p>
      </div>

      <!-- ░░ MAIN SCROLLABLE CONTENT ░░ -->
      <main class="sg-planning-main" id="planning-main">
        <div class="sg-planning-scroll">

          ${uiState.loading === 'airports' || uiState.loading === 'map' ? `
            <div class="sg-fullstate" role="status" aria-live="polite">
              <div class="sg-spinner"></div>
              <p>${uiState.loading === 'airports' ? 'Conectando ao aeroporto…' : 'Carregando dados…'}</p>
            </div>
          ` : uiState.error && !appData.floors.length ? `
            <div class="sg-fullstate sg-fullstate--error" role="alert">
              <iconify-icon icon="solar:danger-circle-bold" aria-hidden="true" style="font-size:40px;color:var(--red-600)"></iconify-icon>
              <p style="max-width:260px;line-height:1.5">${esc(uiState.error)}</p>
              <button type="button" class="sg-btn-primary" id="retry-btn" style="max-width:180px">Tentar novamente</button>
            </div>
          ` : `

            <!-- ░░ ROUTE COMPOSER SURFACE ░░ -->
            <div class="sg-composer">

              ${uiState.error ? `
              <div class="sg-form-error" role="alert">
                <iconify-icon icon="solar:danger-circle-bold" aria-hidden="true"></iconify-icon>
                <span>${esc(uiState.error)}</span>
                <button type="button" id="dismiss-error" aria-label="Fechar alerta">
                  <iconify-icon icon="solar:close-circle-bold" aria-hidden="true"></iconify-icon>
                </button>
              </div>` : ''}

              <!-- Journey rail + input fields + swap -->
              <div class="sg-journey sg-journey--composer" role="group" aria-label="Selecionar origem e destino">

                <!-- Decorative vertical journey rail (aria-hidden) -->
                <div class="sg-journey__rail${railFilled}" aria-hidden="true">
                  <span class="sg-journey__dot sg-journey__dot--origin"></span>
                  <span class="sg-journey__connector"></span>
                  <span class="sg-journey__dot sg-journey__dot--dest"></span>
                </div>

                <!-- Input fields -->
                <div class="sg-journey__fields">

                  <!-- Origin -->
                  <button type="button"
                    class="sg-journey-field open-search"
                    data-kind="origin"
                    id="origin-btn"
                    aria-label="${oNode ? `Ponto de partida: ${esc(getPublicNodeLabel(oNode))}. Toque para mudar` : 'Selecionar ponto de partida'}"
                    aria-haspopup="dialog">
                    <div class="sg-journey-field__inner">
                      <span class="sg-journey-field__label">Ponto de partida</span>
                      <span class="sg-journey-field__value${oNode ? '' : ' is-ph'}">
                        ${oNode ? esc(getPublicNodeLabel(oNode)) : 'Onde você está?'}
                      </span>
                      ${metaPill(oNode)}
                    </div>
                    ${oNode ? `<span class="sg-journey-clear clear-loc" data-kind="origin" id="clear-origin" role="button" tabindex="0" aria-label="Limpar ponto de partida">
                      <iconify-icon icon="solar:close-circle-bold" aria-hidden="true"></iconify-icon>
                    </span>` : ''}
                  </button>

                  <!-- Divider row with swap button centred on the line -->
                  <div class="sg-journey__divider" aria-hidden="true">
                    <div class="sg-journey__sep-line"></div>
                    <button type="button"
                      class="sg-journey__swap"
                      id="swap-btn"
                      aria-label="Inverter ponto de partida e destino"
                      ${!planState.originCode && !planState.destinationCode ? 'disabled' : ''}>
                      <iconify-icon icon="solar:round-sort-vertical-bold" aria-hidden="true"></iconify-icon>
                    </button>
                  </div>

                  <!-- Destination -->
                  <button type="button"
                    class="sg-journey-field open-search"
                    data-kind="destination"
                    id="destination-btn"
                    aria-label="${dNode ? `Destino: ${esc(getPublicNodeLabel(dNode))}. Toque para mudar` : 'Selecionar destino'}"
                    aria-haspopup="dialog">
                    <div class="sg-journey-field__inner">
                      <span class="sg-journey-field__label">Destino</span>
                      <span class="sg-journey-field__value${dNode ? '' : ' is-ph'}">
                        ${dNode ? esc(getPublicNodeLabel(dNode)) : 'Para onde deseja ir?'}
                      </span>
                      ${metaPill(dNode)}
                    </div>
                    ${dNode ? `<span class="sg-journey-clear clear-loc" data-kind="destination" id="clear-dest" role="button" tabindex="0" aria-label="Limpar destino">
                      <iconify-icon icon="solar:close-circle-bold" aria-hidden="true"></iconify-icon>
                    </span>` : ''}
                  </button>

                </div>
                <!-- /sg-journey__fields -->
              </div>
              <!-- /sg-journey -->

              <!-- Accessible route row -->
              <div class="sg-access-row sg-access-row--composer">
                <label class="sg-access-row__label" for="accessible-toggle">
                  <iconify-icon icon="solar:accessibility-bold" aria-hidden="true" class="sg-access-row__icon${isAccessible ? ' is-on' : ''}"></iconify-icon>
                  <div class="sg-access-row__text">
                    <span class="sg-access-row__title">Rota acessível</span>
                    <span class="sg-access-row__desc">Usa elevadores e evita escadas.</span>
                  </div>
                </label>
                <button type="button"
                  class="sg-toggle${isAccessible ? ' is-on' : ''}"
                  id="accessible-toggle"
                  role="switch"
                  aria-checked="${isAccessible}"
                  aria-label="Ativar rota acessível">
                  <span class="sg-toggle__thumb" aria-hidden="true"></span>
                </button>
              </div>

              <!-- Primary CTA -->
              <div class="sg-composer__action">
                <button type="button"
                  class="sg-calc-btn"
                  id="calc-btn"
                  ${disabled ? 'disabled' : ''}
                  aria-busy="${isCalc}"
                  aria-disabled="${disabled}">
                  ${isCalc
                    ? `<span class="sg-spinner-sm" aria-hidden="true"></span><span>Calculando…</span>`
                    : `<span>Calcular rota</span><iconify-icon icon="solar:arrow-right-bold" aria-hidden="true" class="sg-calc-btn__arrow"></iconify-icon>`}
                </button>
                ${hint ? `<p class="sg-form-hint${same ? ' is-warn' : ''}" role="status" aria-live="polite">${esc(hint)}</p>` : ''}
              </div>

            </div>
            <!-- /sg-composer -->

            <!-- ░░ QUICK ACCESS SECTION ░░ -->
            <section class="sg-quick-section" aria-label="Encontre rapidamente">
              <h2 class="sg-quick-section__title">Encontre rapidamente</h2>
              <div class="sg-quick-scroll" role="list" aria-label="Atalhos de categoria">
                ${QUICK_CATS.map(cat => `
                  <button type="button"
                    class="sg-quick-card"
                    data-cat-key="${cat.key}"
                    aria-label="${esc(cat.label)}: ${esc(cat.subtitle)}"
                    role="listitem">
                    <span class="sg-quick-card__icon-wrap" aria-hidden="true">
                      <iconify-icon icon="${cat.icon}" aria-hidden="true"></iconify-icon>
                    </span>
                    <span class="sg-quick-card__name">${esc(cat.label)}</span>
                    <span class="sg-quick-card__sub">${esc(cat.subtitle)}</span>
                  </button>
                `).join('')}
              </div>
            </section>

          `}
        </div>
        <!-- /sg-planning-scroll -->
      </main>

      <div id="plan-status" class="sr-only" role="status" aria-live="polite" aria-atomic="true"></div>
    </div>
  `;
}


// ---- SUMMARY ----

