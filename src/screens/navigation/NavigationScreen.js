/**
 * NavigationScreen — ONE screen: the floor plan under everything, the navy
 * destination banner floating at the top, at most two map controls on the
 * right, and the step sheet rising from the bottom.
 *
 * Light theme. The plans are pale architectural drawings, so the surfaces
 * stay light and the ROUTE is the dark, saturated thing on the screen
 * (navy casing under a turquoise line) — see styles/screens/navigation.css.
 */
import { appData, mapState, navState, uiState } from '../../state/appState.js';
import { esc } from '../../utils/format.js';
import { getFloorLabel } from '../../state/selectors.js';
import { buildPoiLayerHtml, buildRouteOverlaySvg, buildStepLayerHtml, peekBaseFloorSvg } from '../../map/floorMapBuilder.js';
import { navIcon } from '../../components/Icon.js';
import { renderNavigationBanner } from './NavigationShell.js';
import { renderStepsList, renderStepsSummary } from './NavigationSteps.js';

export const SHEET_DETENTS = ['collapsed', 'half', 'full'];

const DETENT_LABEL = {
  collapsed: 'recolhida',
  half: 'a meia tela',
  full: 'expandida',
};

export function renderNavigation() {
  const fid = mapState.selectedFloorId;
  const detent = SHEET_DETENTS.includes(uiState.sheetDetent) ? uiState.sheetDetent : 'half';

  return `
    <div class="sg-nav-screen sg-ds" id="nav-screen">
      <button type="button" class="sg-skip-navview" id="focus-steps">
        Ir para a lista de passos
      </button>

      <div class="sg-map-area" id="map-area" role="region" tabindex="0"
        aria-label="Mapa da rota — ${esc(getFloorLabel(fid))}. Use as setas para mover e mais ou menos para o zoom.">
        <div class="sg-map-wrapper" id="map-wrapper">
          <div class="sg-map-inner" id="map-inner">
            <!-- The real floor plan. Rendering is synchronous but the plan
                 is fetched, so this paints the empty stage on a cold start
                 and mountBaseFloorSvg() drops the plan in when it lands. -->
            <div id="map-base" class="sg-map-layer sg-map-layer--base">
              ${peekBaseFloorSvg(fid)}
            </div>
            <!-- The route: one cased line per floor. -->
            <div id="map-route" class="sg-map-layer sg-map-layer--route">
              ${buildRouteOverlaySvg(fid)}
            </div>
            <!-- POIs along the route: HTML buttons in the same 3740x1800 space -->
            <div id="map-pois" class="sg-map-layer sg-map-layer--pois">
              ${buildPoiLayerHtml(fid)}
            </div>
            <!-- Numbered step badges, matching the list. Last, so a number
                 is never covered by a POI dot. -->
            <div id="map-steps" class="sg-map-layer sg-map-layer--steps">
              ${buildStepLayerHtml(fid)}
            </div>
          </div>
        </div>
      </div>

      ${renderNavigationBanner()}

      <!-- Right-side floating controls: floors + recentre. Two, no more. -->
      <div class="sg-map-fabs" aria-label="Controles do mapa">
        ${renderFloorControl()}
        <button type="button" class="sg-map-fab" id="recenter-btn" aria-label="Centralizar a rota no mapa">
          ${navIcon('navigate')}
        </button>
      </div>

      <!-- Floor change announcement (shown briefly on switch) -->
      <div class="sg-floor-announce" id="floor-announce" aria-hidden="true">
        ${esc(getFloorLabel(fid))}
      </div>

      <!-- The step sheet: every step, always available. -->
      <section class="sg-sheet" id="nav-sheet" data-detent="${detent}" aria-label="Passos da rota">
        <div class="sg-sheet__head" id="sheet-head">
          <button type="button" class="sg-sheet__grip" id="sheet-grip"
            aria-label="Lista de passos ${DETENT_LABEL[detent]}. Arraste ou use as setas para cima e para baixo para mudar a altura."
            aria-expanded="${detent === 'collapsed' ? 'false' : 'true'}">
            <span class="sg-sheet__grip-bar" aria-hidden="true"></span>
          </button>
          <div class="sg-sheet__summary" id="sheet-summary">${renderStepsSummary()}</div>
        </div>
        <ol class="sg-steps" id="steps-list" aria-label="Passos da rota, do início ao destino">
          ${renderStepsList()}
        </ol>
      </section>
    </div>
  `;
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
            : onRoute ? '<iconify-icon icon="solar:map-point-bold" class="is-on-route" aria-hidden="true"></iconify-icon>'
            : '<iconify-icon icon="solar:layers-minimalistic-linear" class="is-off-route" aria-hidden="true"></iconify-icon>'}
          <span>${esc(f.name)}</span>
          ${onRoute && !active ? `<span class="sg-floor-item__badge" aria-hidden="true"></span>` : ''}
        </button>`;
      }).join('')}
    </div>` : ''}
  </div>`;
}
