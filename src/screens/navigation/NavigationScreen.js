import { getPublicNodeLabel } from '../../services/nodePresentation.js';
import { appData, mapState, navState, planState, uiState } from '../../state/appState.js';
import { esc, fmtMin } from '../../utils/format.js';
import { findNode, getFloorLabel } from '../../state/selectors.js';
import { buildLabelLayerHtml, buildPoiLayerHtml, buildRouteOverlaySvg, peekBaseFloorSvg } from '../../map/floorMapBuilder.js';
import { getStepIconName, navIcon } from '../../components/Icon.js';
import { render } from '../../app/router.js';
import { formatMeters } from '../../services/routeSteps.js';
import { getNodeMeta } from '../../app/constants.js';
import { Button, IconButton, StepRail, dsIcon } from '../../components/ds/index.js';
import { renderNavigationTimeline } from './NavigationTimeline.js';
import { renderNavigationRouteMap } from './NavigationRouteMap.js';
import {
  navigationPrimaryLabel,
  renderNavigationHeader,
  renderNavigationTiming,
  renderViewToggle,
} from './NavigationShell.js';

/**
 * Navigation dispatch. The real floor map is the default active-navigation
 * view; the timeline is its instruction-first companion. The synthetic
 * trajeto renderer remains available for compatibility and its pure tests,
 * but is intentionally no longer offered as spatial guidance.
 */
export function renderNavigation() {
  switch (navState.view) {
    case 'trajeto': return renderNavigationRouteMap();
    case 'map':     return renderNavigationMap();
    default:        return renderNavigationTimeline();
  }
}

export function renderNavigationMap() {
  const fid = mapState.selectedFloorId;

  return `
    <div class="sg-nav-screen" id="nav-screen">
      <button type="button" class="sg-skip-navview" id="focus-view-tabs">
        Ir para Etapas e Mapa
      </button>
      <div class="sg-map-area" id="map-area" aria-label="Mapa da rota — ${esc(getFloorLabel(fid))}" role="region"
        data-map-tilt="${mapState.tilt ? 'on' : 'off'}">
        <div class="sg-map-wrapper" id="navigation-panel" role="tabpanel" aria-labelledby="tab-route-btn">
          <div class="sg-map-inner" id="map-inner">
            <!-- The real floor plan. Rendering is synchronous but the plan
                 is fetched, so this paints the empty stage on a cold start
                 and mountBaseFloorSvg() drops the plan in when it lands. -->
            <div id="map-base" class="sg-map-layer sg-map-layer--base">
              ${peekBaseFloorSvg(fid)}
            </div>
            <!-- Route overlay SVG (rebuilt on step change only) -->
            <div id="map-route" class="sg-map-layer sg-map-layer--route">
              ${buildRouteOverlaySvg(fid)}
            </div>
            <!-- POIs along the route: HTML buttons in the same 3740x1800 space -->
            <div id="map-pois" class="sg-map-layer sg-map-layer--pois">
              ${buildPoiLayerHtml(fid)}
            </div>
            <!-- Origin/destination captions: glass capsules, same space again.
                 Last, so a caption is never covered by a POI dot. -->
            <div id="map-labels" class="sg-map-layer sg-map-layer--labels">
              ${buildLabelLayerHtml(fid)}
            </div>
          </div>
        </div>

        ${renderNavigationHeader({ map: true })}

        <!-- Right-side floating controls: floors + recenter -->
        <div class="sg-map-fabs" aria-label="Controles do mapa">
          ${renderFloorControl()}
          <button type="button" class="sg-map-fab" id="fit-segment-btn" aria-label="Centralizar no passo atual">
            ${navIcon('navigate')}
          </button>
          <!-- EXPERIMENT — flat / tilted camera. Temporary control: it exists
               to be compared on a phone, not to ship. Removing the experiment
               means deleting this button, its listener in events.js, mapState
               .tilt and the TILTED CAMERA block in navigation.css. -->
          <button type="button" class="sg-map-fab sg-map-fab--tilt" id="tilt-toggle-btn"
            aria-pressed="${mapState.tilt ? 'true' : 'false'}"
            aria-label="Alternar câmera inclinada (experimento)">
            ${navIcon('layers')}
          </button>
          <div class="sg-map-zoom" role="group" aria-label="Zoom do mapa">
            <button type="button" class="sg-map-fab" id="zoom-in-btn" aria-label="Aumentar zoom">
              <span class="sg-map-zoom-glyph" aria-hidden="true">+</span>
            </button>
            <button type="button" class="sg-map-fab" id="zoom-out-btn" aria-label="Diminuir zoom">
              <span class="sg-map-zoom-glyph" aria-hidden="true">&minus;</span>
            </button>
          </div>
        </div>

        <!-- Return to current step button -->
        <button type="button" class="sg-return-btn" id="return-btn" aria-label="Voltar ao passo atual"
          ${mapState.manualFloor ? '' : 'hidden'}>
          ${navIcon('navigate')}
          Voltar ao passo
        </button>

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
  const isFirst = stepIdx <= 0;
  const isLast  = stepIdx >= total - 1;
  const fid = mapState.selectedFloorId;
  const currentDistance = formatMeters(curStep?.distanceMeters ?? 0);
  const floor = getFloorLabel(curStep?.floorId ?? fid);
  const instructionMeta = [
    currentDistance ? `${currentDistance} nesta etapa` : (isLast ? 'Etapa final' : 'Agora'),
    floor,
  ].join(' · ');

  // The complete route already lives in the Etapas tab. The fixed map sheet
  // only answers what matters while walking: where progress stands, what to
  // do now, what comes immediately after, and how to confirm the step.
  return `
    <div class="sg-navsheet__pinned">
      <div class="sg-navsheet__status">
        <span aria-hidden="true">Etapa <strong>${stepIdx + 1}</strong> de ${total}</span>
        ${renderNavigationTiming('sg-navsheet__status-time')}
      </div>

      ${StepRail({
        current: stepIdx + 1,
        total,
        label: `Etapa ${stepIdx + 1} de ${total}`,
        className: 'sg-navsheet__rail',
      })}

      <div class="sg-navsheet__head">
        <span class="sg-navsheet__head-icon" aria-hidden="true">${navIcon(getStepIconName(curStep))}</span>
        <div class="sg-navsheet__head-copy">
          <p class="sg-navsheet__head-meta">${esc(instructionMeta)}</p>
          <h2 class="sg-navsheet__head-title" id="instr-text">${esc(curStep?.text ?? '')}</h2>
        </div>
      </div>

      ${nextStep ? `
        <div class="sg-navsheet__preview" aria-label="Próxima instrução">
          <span class="sg-navsheet__preview-icon" aria-hidden="true">${navIcon(getStepIconName(nextStep))}</span>
          <span class="sg-navsheet__preview-copy">
            <span class="sg-navsheet__preview-label">Depois</span>
            <span class="sg-navsheet__preview-text">${esc(stripPeriod(nextStep.text))}</span>
          </span>
        </div>
      ` : `
        <div class="sg-navsheet__preview sg-navsheet__preview--arrival">
          <span class="sg-navsheet__preview-icon" aria-hidden="true">${dsIcon('lucide:flag')}</span>
          <span class="sg-navsheet__preview-copy">
            <span class="sg-navsheet__preview-label">Destino</span>
            <span class="sg-navsheet__preview-text">Conclua a etapa para finalizar a rota.</span>
          </span>
        </div>
      `}
    </div>

    ${renderViewToggle('map', 'sg-nav-tabs--sheet')}

    <div class="sg-navsheet__foot">
      <p class="sg-navsheet__foot-hint">Confirme somente depois de concluir esta instrução.</p>
      <div class="sg-navsheet__actions">
        ${IconButton({
          icon: 'solar:arrow-left-linear',
          label: 'Voltar à etapa anterior',
          id: 'nav-prev',
          disabled: isFirst,
          className: 'sg-navsheet__prev',
        })}
        ${Button({
          label: navigationPrimaryLabel(),
          variant: 'primary',
          iconRight: isLast ? 'solar:flag-2-bold' : 'lucide:check',
          id: 'nav-next',
          className: 'sg-navsheet__next',
        })}
      </div>
    </div>
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
      aria-haspopup="menu" aria-expanded="${isOpen}"
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
                  ? dsIcon('solar:check-circle-bold')
                  : dsIcon(step.icon ?? meta.icon)}
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
