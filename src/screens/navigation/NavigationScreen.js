import { getPublicNodeLabel, SEARCH_CATEGORIES } from '../../services/nodePresentation.js';
import { appData, mapState, navState, planState, uiState } from '../../state/appState.js';
import { esc, fmtMin } from '../../utils/format.js';
import { findNode, getFloorLabel } from '../../state/selectors.js';
import { buildRouteOverlaySvg, getBaseFloorSvg } from '../../map/floorMapBuilder.js';
import { getStepIconName, navIcon } from '../../components/Icon.js';
import { render } from '../../app/router.js';
import { countFloorChanges, formatMeters } from '../../services/routeSteps.js';
import { getNodeMeta } from '../../app/constants.js';

export function renderNavigation() {
  const fid = mapState.selectedFloorId;

  return `
    <div class="sg-nav-screen" id="nav-screen">
      <!-- Map area (top ~55%) -->
      <div class="sg-map-area" id="map-area" aria-label="Mapa do aeroporto — ${esc(getFloorLabel(fid))}" role="img">
        <div class="sg-map-wrapper" id="map-wrapper">
          <div class="sg-map-inner" id="map-inner">
            <!-- Base floor SVG (cached, never rebuilt on step change) -->
            <div id="map-base" class="sg-map-layer sg-map-layer--base">
              ${getBaseFloorSvg(fid)}
            </div>
            <!-- Route overlay SVG (rebuilt on step change only) -->
            <div id="map-route" class="sg-map-layer sg-map-layer--route">
              ${buildRouteOverlaySvg(fid)}
            </div>
          </div>
        </div>

        <!-- Brand block (doubles as "back to route summary") -->
        <header class="sg-nav-brand" role="banner">
          <button type="button" class="sg-nav-brand__btn" id="exit-nav-btn" aria-label="Voltar ao resumo da rota">
            <span class="sg-nav-brand__row">
              <span class="sg-nav-brand__logo">${navIcon('plane')}</span>
              <span class="sg-nav-brand__name">SkyGate</span>
            </span>
            <span class="sg-nav-brand__loc">
              ${navIcon('pin')}
              <span>FOR • Aeroporto de Fortaleza</span>
            </span>
          </button>
        </header>

        <!-- Help -->
        <button type="button" class="sg-nav-help" id="help-btn" aria-label="Ajuda">?</button>

        <!-- Right-side floating controls: floors + recenter -->
        <div class="sg-map-fabs" aria-label="Controles do mapa">
          ${renderFloorControl()}
          <button type="button" class="sg-map-fab" id="fit-segment-btn" aria-label="Centralizar no passo atual">
            ${navIcon('navigate')}
          </button>
        </div>

        <!-- Return to current step button -->
        ${mapState.manualFloor ? `<button type="button" class="sg-return-btn" id="return-btn" aria-label="Voltar ao passo atual">
          ${navIcon('navigate')}
          Voltar ao passo
        </button>` : ''}

        <!-- Floor change announcement (shown briefly on switch) -->
        <div class="sg-floor-announce ${mapState.manualFloor ? 'sg-floor-announce--manual' : ''}" id="floor-announce" aria-hidden="true">
          ${esc(getFloorLabel(fid))}
        </div>
      </div>

      <!-- Bottom sheet -->
      <div
        class="sg-instruction-card"
        id="instruction-card"
        role="region"
        aria-label="Instrução de navegação"
        aria-live="polite"
        aria-atomic="true"
      >${renderInstructionCardInner()}</div>

      <!-- Route overview overlay (semantic only — no graph nodes) -->
      ${uiState.showOverview ? renderOverlayOverview() : ''}
    </div>
  `;
}

/**
 * Bottom-sheet contents. Shared by the full render and the partial
 * step update so the two can never drift apart.
 */
export function renderInstructionCardInner() {
  const steps   = navState.semanticSteps;
  const total   = steps.length;
  const stepIdx = navState.activeStepIndex;
  const curStep = steps[stepIdx];
  const nextStep = steps[stepIdx + 1];
  const isLast  = stepIdx >= total - 1;
  const accessible = planState.routeMode === 'accessible';
  const fid = mapState.selectedFloorId;
  const upcoming = steps.slice(stepIdx + 1);

  const nextDist = formatMeters(curStep?.distanceMeters ?? 0);

  return `
    <div class="sg-sheet-handle" aria-hidden="true"></div>

    <!-- Step rail -->
    <div class="sg-step-rail">
      <span class="sg-step-rail__label">Passo ${stepIdx + 1} de ${total}</span>
      ${total <= 10 ? `<div class="sg-step-rail__track" aria-hidden="true">
        ${Array.from({ length: total }, (_, i) => {
          const state = i < stepIdx ? 'is-done' : i === stepIdx ? 'is-active' : '';
          const seg = i === 0 ? '' : `<span class="sg-step-rail__seg ${i <= stepIdx ? 'is-done' : ''}"></span>`;
          return `${seg}<span class="sg-step-rail__dot ${state}"></span>`;
        }).join('')}
      </div>` : `<span class="sg-step-rail__counter" aria-hidden="true">${stepIdx + 1}/${total}</span>`}
    </div>

    <!-- Headline -->
    <div class="sg-instr-head">
      <span class="sg-instr-head__icon">${navIcon(getStepIconName(curStep))}</span>
      <h2 class="sg-instr-head__title" id="instr-text">${esc(curStep?.text ?? '')}</h2>
    </div>

    <!-- Context chips -->
    <div class="sg-nav-chips">
      <span class="sg-nav-chip">${navIcon('layers')}${esc(getFloorLabel(fid))}</span>
      ${accessible
        ? `<span class="sg-nav-chip sg-nav-chip--teal">${navIcon('wheelchair')}Rota acessível</span>`
        : `<span class="sg-nav-chip sg-nav-chip--teal">${navIcon('navigate')}Rota mais rápida</span>`}
    </div>

    <div class="sg-nav-divider" role="presentation"></div>

    <!-- Metrics -->
    <dl class="sg-metrics">
      <div class="sg-metric">
        <div class="sg-metric__top">${navIcon('clock')}<dd class="sg-metric__value">${fmtMin(navState.route?.estimatedMinutes ?? 0)} min</dd></div>
        <dt class="sg-metric__label">Tempo estimado</dt>
      </div>
      <div class="sg-metric">
        <div class="sg-metric__top">${navIcon('stairs')}<dd class="sg-metric__value">${countFloorChanges()}</dd></div>
        <dt class="sg-metric__label">Andares</dt>
      </div>
      <div class="sg-metric">
        <div class="sg-metric__top">${navIcon(getStepIconName(nextStep))}<dd class="sg-metric__value">${nextStep && nextDist ? `Em ${esc(nextDist)}` : 'Chegada'}</dd></div>
        <dt class="sg-metric__label">${esc(nextStep ? stripPeriod(nextStep.text) : 'Você chegou')}</dt>
      </div>
    </dl>

    <!-- Actions -->
    <div class="sg-nav-actions">
      <button type="button" class="sg-nav-next" id="nav-next"
        ${isLast ? 'disabled' : ''} aria-disabled="${isLast}"
        aria-label="${isLast ? 'Chegou ao destino' : 'Próxima instrução'}">
        ${isLast ? 'Chegou!' : 'Próximo'}${navIcon('chevron', 'sg-ico--sm')}
      </button>
      <button type="button" class="sg-nav-steps" id="instr-steps-btn" aria-haspopup="dialog">
        ${navIcon('list')}Ver etapas
      </button>
    </div>

    <!-- Upcoming steps -->
    ${upcoming.length ? `
      <h3 class="sg-next-steps__title">Próximas etapas</h3>
      <ul class="sg-next-steps">
        ${upcoming.map((s, i) => {
          const d = formatMeters(s.distanceMeters ?? 0);
          return `<li class="sg-next-step">
            <span class="sg-next-step__icon">${navIcon(getStepIconName(s))}</span>
            <div class="sg-next-step__body">
              <p class="sg-next-step__text">${esc(stripPeriod(s.text))}</p>
              ${d ? `<p class="sg-next-step__dist">${esc(d)}</p>` : ''}
            </div>
          </li>`;
        }).join('')}
      </ul>
    ` : ''}
  `;
}

export function stripPeriod(t) {
  return String(t ?? '').replace(/\.\s*$/, '');
}

export function renderFloorControl() {
  const cur = appData.floors.find(f => f.id === mapState.selectedFloorId) ?? appData.floors[0];
  const isOpen = uiState.floorMenuOpen && appData.floors.length > 1;

  return `<div class="sg-floor-ctrl ${isOpen ? 'is-open' : ''}" id="floor-ctrl">
    <button type="button" class="sg-map-fab" id="floor-trigger-btn"
      aria-haspopup="true" aria-expanded="${isOpen}"
      aria-label="Piso atual: ${esc(cur?.name ?? getFloorLabel(mapState.selectedFloorId))}. Toque para mudar.">
      ${navIcon('layers')}
      ${navState.routeFloorIds.has(cur?.id) ? `<span class="sg-floor-trigger__dot" aria-hidden="true"></span>` : ''}
    </button>
    ${isOpen ? `<div class="sg-floor-menu" role="menu" aria-label="Escolher piso">
      ${appData.floors.map(f => {
        const active   = f.id === mapState.selectedFloorId;
        const onRoute  = navState.routeFloorIds.has(f.id);
        return `<button type="button" class="sg-floor-item ${active ? 'is-active' : ''}"
          data-floor-id="${esc(f.id)}" role="menuitem" aria-current="${active}">
          ${active ? '<iconify-icon icon="solar:check-circle-bold" aria-hidden="true"></iconify-icon>'
            : onRoute ? '<iconify-icon icon="solar:map-point-bold" style="color:var(--teal-500)" aria-hidden="true"></iconify-icon>'
            : '<iconify-icon icon="solar:layers-minimalistic-linear" style="opacity:.4" aria-hidden="true"></iconify-icon>'}
          <span>${esc(f.name)}</span>
          ${onRoute && !active ? `<span class="sg-floor-item__badge" aria-hidden="true"></span>` : ''}
        </button>`;
      }).join('')}
    </div>` : ''}
  </div>`;
}

export function renderOverlayOverview() {
  const steps = navState.semanticSteps;
  const curIdx = navState.activeStepIndex;

  return `<div class="sg-overview-overlay" id="route-overview" role="dialog" aria-modal="true" aria-labelledby="overview-title">
    <div class="sg-overview-backdrop" id="overview-backdrop" aria-hidden="true"></div>
    <div class="sg-overview-sheet">
      <div class="sg-overview-handle" aria-hidden="true"></div>
      <div class="sg-overview-header">
        <h2 class="sg-overview-title" id="overview-title">Visão geral da rota</h2>
        <button type="button" class="sg-icon-btn" id="close-overview" aria-label="Fechar visão geral">
          <iconify-icon icon="solar:close-circle-bold" aria-hidden="true"></iconify-icon>
        </button>
      </div>
      <div class="sg-overview-dest">
        <iconify-icon icon="solar:routing-2-bold" aria-hidden="true"></iconify-icon>
        ${esc(findNode(planState.destinationCode) ? getPublicNodeLabel(findNode(planState.destinationCode)) : 'Destino')} · ${fmtMin(navState.route?.estimatedMinutes ?? 0)} min
      </div>
      <ol class="sg-overview-list" aria-label="Passos da rota">
        ${steps.map((step, i) => {
          const done   = i < curIdx;
          const active = i === curIdx;
          const meta   = getNodeMeta(step.nodeType ?? 'corridor');
          return `<li class="sg-overview-item ${active ? 'is-active' : done ? 'is-done' : ''} ${step.isTransition ? 'is-transition' : ''}">
            <button type="button" class="sg-overview-item__btn" data-step-index="${i}" aria-label="Ir para passo ${i+1}: ${esc(step.text)}" aria-current="${active}">
              <div class="sg-overview-item__icon">
                ${done
                  ? '<iconify-icon icon="solar:check-circle-bold" aria-hidden="true"></iconify-icon>'
                  : `<iconify-icon icon="${step.icon ?? meta.icon}" aria-hidden="true"></iconify-icon>`}
              </div>
              <div>
                <p class="sg-overview-item__text">${esc(step.text)}</p>
                ${step.floorId ? `<p class="sg-overview-item__floor">${esc(getFloorLabel(step.floorId))}</p>` : ''}
              </div>
            </button>
            ${i < steps.length - 1 ? `<div class="sg-overview-connector" aria-hidden="true"></div>` : ''}
          </li>`;
        }).join('')}
      </ol>
    </div>
  </div>`;
}

// Curated, direction-appropriate subsets of the real SEARCH_CATEGORIES —
// chips are genuine filters (they narrow appData.nodes by type), never
// free-text shortcuts and never invented categories.
