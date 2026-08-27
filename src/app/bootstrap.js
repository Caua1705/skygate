import { getAirports, getAirportMap, SkyGateApiError } from '../services/api/index.js';
import { app, appData, mapState, navState, planState, uiState } from '../state/appState.js';
import { getBaseFloorSvg } from '../map/floorMapBuilder.js';
import { render } from './router.js';
import { asArray } from '../utils/format.js';
import { FORTALEZA_SLUG } from './constants.js';
import { getAirportSlug } from '../state/selectors.js';
import { normalizeMap } from '../services/normalize.js';
import { restoreSessionState } from '../state/sessionPersistence.js';
import { autoFitRoute } from '../map/mapFit.js';

/* ============================================================
   16. INIT
   ============================================================ */

/**
 * Warm the floor plans after initial load.
 *
 * They are fetched files now, not built strings, so this is real network
 * work — hence idle time, and hence a swallowed rejection: a plan that fails
 * to preload is retried when its floor is actually opened, and must never
 * surface as an unhandled rejection during startup.
 */
export function preloadFloorSvgs() {
  if (!appData.floors.length) return;
  const warm = id => { getBaseFloorSvg(id).catch(() => {}); };
  appData.floors.forEach(f => {
    if (mapState.svgBaseCache[f.id]) return;
    if ('requestIdleCallback' in window) requestIdleCallback(() => warm(f.id));
    else setTimeout(() => warm(f.id), 200);
  });
}

export async function init() {
  let restoredJourney = false;
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
    if (!floors.length || !nodes.length) {
      throw new SkyGateApiError('O mapa do aeroporto veio vazio.', { kind: 'invalid_response' });
    }
    appData.floors = floors;
    appData.nodes  = nodes;
    mapState.selectedFloorId = floors[0]?.id ?? '0';
    restoredJourney = restoreSessionState({
      state: { app, planState, navState, mapState },
      nodes,
      floors,
    });
    uiState.error = '';

  } catch (err) {
    console.error('[SkyGate] init:', err);
    if (err instanceof SkyGateApiError && err.kind === 'network') {
      uiState.error = 'Você está sem conexão. Conecte-se e tente novamente.';
    } else if (err instanceof SkyGateApiError && err.kind === 'timeout') {
      uiState.error = 'A conexão está lenta. Tente novamente em instantes.';
    } else if (err instanceof SkyGateApiError && err.kind === 'invalid_response') {
      uiState.error = 'Não foi possível carregar o mapa deste aeroporto.';
    } else {
      uiState.error = 'Não foi possível carregar os dados do aeroporto.';
    }
  } finally {
    uiState.loading = '';
    if (!restoredJourney) app.mode = 'planning';
    render();
    if (restoredJourney && app.mode === 'navigation' && navState.view === 'map') {
      // One millisecond is visually instant, while still taking the deliberate
      // re-frame path that relays out callouts against the restored viewport.
      requestAnimationFrame(() => autoFitRoute(1));
    }
    // Preload after a short delay to not block initial render
    setTimeout(preloadFloorSvgs, 800);
  }
}



// Expose presentation tests to browser console for validation
// Usage: window.__sgPresentationTests() after page load
// All tests are defined in nodePresentation.js


init();
