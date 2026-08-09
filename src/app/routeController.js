import { calculateRoute, SkyGateApiError } from '../services/api/index.js';
import { app, appData, mapState, navState, planState, uiState } from '../state/appState.js';

import { render } from './router.js';
import { findNode, getAirportSlug } from '../state/selectors.js';
import { normalizeRoute } from '../services/normalize.js';
import {
  attachStepDistances,
  buildSemanticSteps,
  isRouteCompatibleWithAccessibleMode,
  routePathMatchesPlan,
} from '../services/routeSteps.js';
import { buildRouteOptions, scoreOptions } from '../services/routeOptions.js';

let calculationGeneration = 0;

function planSignature() {
  return [
    planState.originCode,
    planState.destinationCode,
    planState.routeMode,
    planState.flightTime,
    planState.flightDate,
    planState.flightDay,
    planState.flightType,
  ].join('|');
}

/** The recommended route if we can give one, else the fastest. */
function pickInitialOption(options) {
  const scored = scoreOptions(options);
  return (
    scored.find(option => option.recommended)
    ?? scored.find(option => option.recommendedByApi)
    ?? scored.reduce((best, option) => !best || option.minutes < best.minutes ? option : best, null)
  )?.id ?? '';
}

/* ============================================================
   15. ROUTE CALCULATION
   ============================================================ */

export async function handleCalculate() {
  if (uiState.loading === 'route') return;
  if (!planState.originCode || !planState.destinationCode) return;
  if (planState.originCode === planState.destinationCode) return;

  try {
    const generation = ++calculationGeneration;
    const requestedPlan = {
      signature: planSignature(),
      originCode: planState.originCode,
      destinationCode: planState.destinationCode,
      routeMode: planState.routeMode,
      flightTime: planState.flightTime,
    };
    uiState.loading = 'route';
    uiState.error = '';
    navState.route = null;
    render();

    const raw = await calculateRoute({
      airport_slug:     getAirportSlug(appData.airport),
      origin_code:      requestedPlan.originCode,
      destination_code: requestedPlan.destinationCode,
      route_mode:       requestedPlan.routeMode,
      // Optional. When present the endpoint can return folga_min/status per
      // route; the client recomputes both anyway (see routeOptions.js), so an
      // endpoint that ignores this field changes nothing on screen.
      ...(requestedPlan.flightTime ? { horario_voo: requestedPlan.flightTime } : {}),
    });

    // A slow response must never be rendered against a different trip.
    if (generation !== calculationGeneration || requestedPlan.signature !== planSignature()) return;

    const route = normalizeRoute(raw);
    if (!route.path.length && !route.steps.length) {
      throw Object.assign(new Error('No path.'), { kind: 'no_path' });
    }
    if (!routePathMatchesPlan(route, requestedPlan.originCode, requestedPlan.destinationCode)) {
      throw Object.assign(new Error('Route geometry does not match the requested journey.'), { kind: 'no_path' });
    }
    if (requestedPlan.routeMode === 'accessible') {
      if (!isRouteCompatibleWithAccessibleMode(route)) {
        throw Object.assign(new Error('Accessible route contains an unsafe or unknown floor transition.'), {
          kind: 'accessible_path',
        });
      }
    }

    navState.route = route;
    navState.routeFloorIds = new Set(
      (route.segments ?? []).filter(s => s.type === 'floor').map(s => s.floorId)
    );
    navState.semanticSteps = attachStepDistances(buildSemanticSteps(route), route.path);
    navState.activeStepIndex = 0;
    navState.hasStarted = false;
    navState.view = 'map';
    mapState.manualFloor = false;

    // Real ways of walking returned by the backend. When there is only one
    // path, the choice screen deliberately presents one route rather than
    // manufacturing variety from annotations on the same geometry.
    navState.routeOptions = buildRouteOptions(route, {
      accessible: requestedPlan.routeMode === 'accessible',
    });
    navState.selectedOptionId = pickInitialOption(navState.routeOptions);
    uiState.riskAcknowledged = false;

    // Set selected floor to origin floor
    const firstFloor = (route.segments ?? []).find(s => s.type === 'floor')?.floorId
      ?? findNode(planState.originCode)?.floorId
      ?? mapState.selectedFloorId;
    mapState.selectedFloorId = firstFloor;

    app.mode = 'summary';

  } catch (err) {
    console.error('[SkyGate]', err);
    navState.route = null;
    navState.routeOptions = [];
    navState.selectedOptionId = '';
    uiState.error = routeError(err);
  } finally {
    uiState.loading = '';
    const routeFailed = Boolean(uiState.error);
    render();
    if (routeFailed) {
      requestAnimationFrame(() => {
        document.getElementById('retry-route-btn')?.focus({ preventScroll: true });
      });
    }
  }
}

export function routeError(err) {
  if (err?.kind === 'no_path') return 'Não foi possível encontrar um caminho entre os pontos selecionados.';
  if (err?.kind === 'accessible_path') return 'Não encontramos uma rota sem escadas entre estes pontos.';
  if (err instanceof SkyGateApiError) {
    if (err.kind === 'network') return 'Sem conexão. Verifique sua internet e tente novamente.';
    if (err.status === 404)     return 'Rota não encontrada para estes pontos.';
    if (err.status === 422)     return 'Não foi possível calcular esta rota. Verifique origem e destino.';
    if (err.status >= 500)      return 'Servidor temporariamente indisponível. Tente novamente.';
  }
  return 'Não foi possível calcular a rota. Tente novamente.';
}
