import { getAirports, getAirportMap, SkyGateApiError } from '../services/api/index.js';
import { app, appData, mapState, uiState } from '../state/appState.js';
import { buildBaseFloorSvg } from '../map/floorMapBuilder.js';
import { render } from './router.js';
import { asArray } from '../utils/format.js';
import { FORTALEZA_SLUG } from './constants.js';
import { getAirportSlug } from '../state/selectors.js';
import { normalizeMap } from '../services/normalize.js';

/* ============================================================
   16. INIT
   ============================================================ */

/** Preload base SVGs for all floors after initial load */
export function preloadFloorSvgs() {
  if (!appData.floors.length) return;
  // Build SVG for each floor in idle time — populates cache
  appData.floors.forEach(f => {
    if (!mapState.svgBaseCache[f.id]) {
      if ('requestIdleCallback' in window) {
        requestIdleCallback(() => { mapState.svgBaseCache[f.id] = buildBaseFloorSvg(f.id); });
      } else {
        setTimeout(() => { mapState.svgBaseCache[f.id] = buildBaseFloorSvg(f.id); }, 200);
      }
    }
  });
}

export async function init() {
  try {
    uiState.loading = 'airports';
    uiState.error = '';
    app.mode = 'planning';
    render();

    const airports = await getAirports();
    const list = Array.isArray(airports) ? airports : asArray(airports);
    appData.airport = list.find(a => (a.slug ?? a.code ?? '') === FORTALEZA_SLUG)
      ?? list.find(a => String(a.slug ?? '').toLowerCase().includes(FORTALEZA_SLUG))
      ?? { slug: FORTALEZA_SLUG, name: 'Aeroporto Internacional de Fortaleza', city: 'Fortaleza' };

    uiState.loading = 'map';
    render();

    const mapData = await getAirportMap(getAirportSlug(appData.airport));
    const { floors, nodes } = normalizeMap(mapData);
    appData.floors = floors;
    appData.nodes  = nodes;
    mapState.selectedFloorId = floors[0]?.id ?? '0';
    uiState.error = '';

  } catch (err) {
    console.error('[SkyGate] init:', err);
    uiState.error = err instanceof SkyGateApiError && err.kind === 'network'
      ? 'Sem conexão com o servidor. Verifique se o backend está rodando.'
      : 'Não foi possível carregar os dados do aeroporto.';
  } finally {
    uiState.loading = '';
    app.mode = 'planning';
    render();
    // Preload after a short delay to not block initial render
    setTimeout(preloadFloorSvgs, 800);
  }
}



// Expose presentation tests to browser console for validation
// Usage: window.__sgPresentationTests() after page load
// All tests are defined in nodePresentation.js


init();

