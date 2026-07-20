import { calculateRoute, SkyGateApiError } from '../services/api/index.js';
import { app, appData, mapState, navState, planState, uiState } from '../state/appState.js';
import { render } from './router.js';
import { findNode, getAirportSlug } from '../state/selectors.js';
import { normalizeRoute } from '../services/normalize.js';
import { attachStepDistances, buildSemanticSteps } from '../services/routeSteps.js';

/* ============================================================
   15. ROUTE CALCULATION
   ============================================================ */

export async function handleCalculate() {
  if (uiState.loading === 'route') return;
  if (!planState.originCode || !planState.destinationCode) return;
  if (planState.originCode === planState.destinationCode) return;

  try {
    uiState.loading = 'route';
    uiState.error = '';
    navState.route = null;
    render();

    const raw = await calculateRoute({
      airport_slug:     getAirportSlug(appData.airport),
      origin_code:      planState.originCode,
      destination_code: planState.destinationCode,
      route_mode:       planState.routeMode,
    });

    const route = normalizeRoute(raw);
    if (!route.path.length && !route.steps.length) {
      throw Object.assign(new Error('No path.'), { kind: 'no_path' });
    }

    navState.route = route;
    navState.routeFloorIds = new Set(
      (route.segments ?? []).filter(s => s.type === 'floor').map(s => s.floorId)
    );
    navState.semanticSteps = attachStepDistances(buildSemanticSteps(route), route.path);
    navState.activeStepIndex = 0;
    mapState.manualFloor = false;

    // Set selected floor to origin floor
    const firstFloor = (route.segments ?? []).find(s => s.type === 'floor')?.floorId
      ?? findNode(planState.originCode)?.floorId
      ?? mapState.selectedFloorId;
    mapState.selectedFloorId = firstFloor;

    app.mode = 'summary';

  } catch (err) {
    console.error('[SkyGate]', err);
    navState.route = null;
    uiState.error = routeError(err);
  } finally {
    uiState.loading = '';
    render();
  }
}

export function routeError(err) {
  if (err?.kind === 'no_path') return 'Não foi possível encontrar um caminho entre os pontos selecionados.';
  if (err instanceof SkyGateApiError) {
    if (err.kind === 'network') return 'Sem conexão. Verifique sua internet e tente novamente.';
    if (err.status === 404)     return 'Rota não encontrada para estes pontos.';
    if (err.status === 422)     return 'Não foi possível calcular esta rota. Verifique origem e destino.';
    if (err.status >= 500)      return 'Servidor temporariamente indisponível. Tente novamente.';
  }
  return 'Não foi possível calcular a rota. Tente novamente.';
}

