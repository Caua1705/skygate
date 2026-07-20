import { getPublicNodeLabel, getPublicNodeSubtitle } from '../../services/nodePresentation.js';
import { app, navState, planState } from '../../state/appState.js';
import { renderPlanning } from '../home/HomeScreen.js';
import { findNode, getFloorLabel, getModeLabel } from '../../state/selectors.js';
import { getNodeMeta } from '../../app/constants.js';
import { esc, fmtMin } from '../../utils/format.js';

export function renderSummary() {
  const route = navState.route;
  if (!route) { app.mode = 'planning'; return renderPlanning(); }

  const dest    = findNode(planState.destinationCode);
  const origin  = findNode(planState.originCode);
  const fids    = [...navState.routeFloorIds];
  const steps   = navState.semanticSteps;
  const transitions = (route.segments ?? []).filter(s => s.type === 'transition').length;
  const destMeta = getNodeMeta(dest?.type ?? 'service');

  return `
    <div class="sg-summary-screen">
      <header class="sg-planning-header" role="banner">
        <button type="button" class="sg-icon-btn" id="back-to-planning-btn" aria-label="Voltar ao planejamento">
          <iconify-icon icon="solar:arrow-left-bold" aria-hidden="true"></iconify-icon>
        </button>
        <div class="sg-planning-brand" style="flex:1">
          <span class="sg-planning-name">Rota calculada</span>
          <span class="sg-planning-loc" style="color:var(--teal-600)">
            ${esc(origin ? getPublicNodeLabel(origin) : 'Origem')} → ${esc(dest ? getPublicNodeLabel(dest) : 'Destino')}
          </span>
        </div>
      </header>

      <main class="sg-summary-body">
        <!-- Destination hero -->
        <div class="sg-summary-hero">
          <div class="sg-summary-dest-icon" style="background:${destMeta.color}18;color:${destMeta.color}">
            <iconify-icon icon="${destMeta.icon}" aria-hidden="true"></iconify-icon>
          </div>
          <div>
            <p class="sg-summary-dest-floor">${esc(getPublicNodeSubtitle(dest) || getFloorLabel(dest?.floorId ?? ''))}</p>
            <h1 class="sg-summary-dest-name">${esc(dest ? getPublicNodeLabel(dest) : 'Destino')}</h1>
          </div>
          <span class="sg-mode-pill sg-mode-pill--${planState.routeMode}">
            <iconify-icon icon="${planState.routeMode === 'accessible' ? 'solar:accessibility-bold' : 'solar:bolt-bold'}" aria-hidden="true"></iconify-icon>
            ${getModeLabel(planState.routeMode)}
          </span>
        </div>

        <!-- Stats row -->
        <div class="sg-summary-stats" role="list">
          <div class="sg-stat" role="listitem">
            <span class="sg-stat__value">${fmtMin(route.estimatedMinutes)}<span class="sg-stat__unit">min</span></span>
            <span class="sg-stat__label">Estimado</span>
          </div>
          <div class="sg-stat-div" aria-hidden="true"></div>
          <div class="sg-stat" role="listitem">
            <span class="sg-stat__value">${steps.length}</span>
            <span class="sg-stat__label">${steps.length === 1 ? 'passo' : 'passos'}</span>
          </div>
          <div class="sg-stat-div" aria-hidden="true"></div>
          <div class="sg-stat" role="listitem">
            <span class="sg-stat__value">${fids.length || 1}</span>
            <span class="sg-stat__label">${(fids.length || 1) === 1 ? 'piso' : 'pisos'}</span>
          </div>
          ${transitions > 0 ? `
          <div class="sg-stat-div" aria-hidden="true"></div>
          <div class="sg-stat" role="listitem">
            <span class="sg-stat__value">${transitions}</span>
            <span class="sg-stat__label">${transitions === 1 ? 'conexão' : 'conexões'}</span>
          </div>` : ''}
        </div>

        <!-- First step preview -->
        ${steps[0] ? `<div class="sg-summary-preview">
          <div class="sg-summary-preview__icon">
            <iconify-icon icon="${steps[0].icon ?? 'solar:arrow-right-bold'}" aria-hidden="true"></iconify-icon>
          </div>
          <div>
            <p class="sg-summary-preview__label">Primeiro passo</p>
            <p class="sg-summary-preview__text">${esc(steps[0].text)}</p>
          </div>
        </div>` : ''}

        <!-- Actions -->
        <div class="sg-summary-actions">
          <button type="button" class="sg-btn-primary sg-btn-primary--large" id="start-nav-btn">
            <iconify-icon icon="solar:play-bold" aria-hidden="true"></iconify-icon>
            Iniciar navegação
          </button>
          <button type="button" class="sg-btn-secondary" id="view-map-btn">
            <iconify-icon icon="solar:map-bold" aria-hidden="true"></iconify-icon>
            Ver mapa
          </button>
        </div>

        <!-- Route overview preview (semantic only) -->
        <details class="sg-summary-steps">
          <summary class="sg-summary-steps__toggle">
            <iconify-icon icon="solar:list-bold" aria-hidden="true"></iconify-icon>
            Ver etapas
            <span class="sg-summary-steps__count">${steps.length}</span>
            <iconify-icon icon="solar:alt-arrow-down-bold" class="sg-summary-steps__chevron" aria-hidden="true"></iconify-icon>
          </summary>
          <ol class="sg-summary-steps__list">
            ${steps.map((s, i) => `<li class="sg-summary-step ${s.isTransition ? 'sg-summary-step--transition' : ''}">
              <span class="sg-summary-step__num" aria-hidden="true">${i + 1}</span>
              <span class="sg-summary-step__text">${esc(s.text)}</span>
              ${s.floorId ? `<span class="sg-summary-step__floor">${esc(getFloorLabel(s.floorId))}</span>` : ''}
            </li>`).join('')}
          </ol>
        </details>

        <button type="button" class="sg-edit-btn" id="edit-route-btn">
          <iconify-icon icon="solar:pen-bold" aria-hidden="true"></iconify-icon>
          Alterar rota
        </button>
      </main>
    </div>
  `;
}

// ---- NAVIGATION ----

