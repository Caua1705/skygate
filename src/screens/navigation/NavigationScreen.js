import { getPublicNodeLabel, SEARCH_CATEGORIES } from '../../services/nodePresentation.js';
import { appData, mapState, navState, planState, uiState } from '../../state/appState.js';
import { esc, fmtMin } from '../../utils/format.js';
import { findNode, getFloorLabel } from '../../state/selectors.js';
import { buildRouteOverlaySvg, getBaseFloorSvg } from '../../map/floorMapBuilder.js';
import { getStepIconName, navIcon } from '../../components/Icon.js';
import { render } from '../../app/router.js';
import { countFloorChanges, formatMeters } from '../../services/routeSteps.js';
import { getNodeMeta } from '../../app/constants.js';
import { Button, Chip, Metric, MetricGroup, StepRail, dsIcon } from '../../components/ds/index.js';

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

        <!-- Header bar (over the dark map): exit · white lockup · help.
             A soft scrim behind it guarantees AA on any map content. -->
        <header class="sg-ds sg-navhdr" role="banner">
          <button type="button" class="sg-navhdr__btn" id="exit-nav-btn" aria-label="Voltar ao resumo da rota">
            ${dsIcon('solar:arrow-left-linear')}
          </button>
          <div class="sg-navhdr__brand">
            <img class="sg-navhdr__logo" src="assets/logo-skygate-white.png" alt="SkyGate">
            <span class="sg-navhdr__loc">
              ${dsIcon('solar:map-point-bold', 'sg-navhdr__pin')}
              <span>FOR · Aeroporto de Fortaleza</span>
            </span>
          </div>
          <button type="button" class="sg-navhdr__btn" id="help-btn" aria-label="Ajuda">
            ${dsIcon('solar:question-circle-linear')}
          </button>
        </header>

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
        class="sg-ds sg-navsheet sg-instruction-card"
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
    <div class="ds-sheet__grip" aria-hidden="true"></div>

    <!-- Step rail (DS): done → turquoise, current → bright --sky-500, future → grey -->
    ${StepRail({ current: stepIdx + 1, total, className: 'sg-navsheet__rail' })}

    <!-- Current instruction -->
    <div class="sg-navsheet__head">
      <span class="sg-navsheet__head-icon" aria-hidden="true">${navIcon(getStepIconName(curStep))}</span>
      <h2 class="sg-navsheet__head-title" id="instr-text">${esc(curStep?.text ?? '')}</h2>
    </div>

    <!-- Context chips -->
    <div class="sg-navsheet__chips">
      ${Chip({ label: getFloorLabel(fid), variant: 'outline', icon: 'solar:layers-bold' })}
      ${Chip({
        label: accessible ? 'Rota acessível' : 'Rota mais rápida',
        variant: 'outline',
        icon: accessible ? 'solar:accessibility-bold' : 'solar:bolt-bold',
      })}
    </div>

    <!-- Metrics -->
    <div class="sg-navsheet__metrics">
      ${MetricGroup([
        Metric({ icon: 'solar:clock-circle-bold', value: fmtMin(navState.route?.estimatedMinutes ?? 0), unit: 'min', label: 'Tempo estimado' }),
        Metric({ icon: 'solar:layers-bold', value: countFloorChanges(), label: 'Andares' }),
        Metric({
          icon: nextStep ? 'solar:arrow-right-linear' : 'solar:flag-2-bold',
          value: nextStep && nextDist ? `Em ${nextDist}` : 'Chegada',
          label: nextStep ? stripPeriod(nextStep.text) : 'Você chegou',
        }),
      ])}
    </div>

    <!-- Actions: Próximo is the hero -->
    <div class="sg-navsheet__actions">
      ${Button({
        label: isLast ? 'Chegou!' : 'Próximo',
        variant: 'primary',
        iconRight: 'solar:arrow-right-linear',
        id: 'nav-next',
        disabled: isLast,
        className: 'sg-navsheet__next',
      })}
      ${Button({
        label: 'Ver etapas',
        variant: 'outline',
        icon: 'solar:list-bold',
        id: 'instr-steps-btn',
        className: 'sg-navsheet__steps',
      })}
    </div>

    <!-- Upcoming steps — turquoise timeline, numbered from the next step -->
    ${upcoming.length ? `
      <h3 class="sg-navsheet__next-title">Próximas etapas</h3>
      <ol class="sg-navsheet__next">
        ${upcoming.map((s, i) => {
          const d = formatMeters(s.distanceMeters ?? 0);
          return `<li class="sg-navsheet__step">
            <span class="sg-navsheet__step-num" aria-hidden="true">${stepIdx + 2 + i}</span>
            <div class="sg-navsheet__step-body">
              <p class="sg-navsheet__step-text">${esc(stripPeriod(s.text))}</p>
              ${d ? `<p class="sg-navsheet__step-dist">${esc(d)}</p>` : ''}
            </div>
          </li>`;
        }).join('')}
      </ol>
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
