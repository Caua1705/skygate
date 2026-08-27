import { calculateRoute, SkyGateApiError } from '../services/api/index.js';
import { app, appData, mapState, navState, planState, uiState } from '../state/appState.js';

import { render } from './router.js';
import { findNode, getAirportSlug } from '../state/selectors.js';
import { normalizeRoute } from '../services/normalize.js';
import {
  accessibleModeWarnings,
  attachStepDistances,
  buildSemanticSteps,
  routePathMatchesPlan,
} from '../services/routeSteps.js';
import { buildRouteOptions, scoreOptions } from '../services/routeOptions.js';
import { boardingTimeISO } from '../services/flightSlack.js';

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
      boardingTime: boardingTimeISO(planState.flightTime),
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
      // Optional, and the ONLY field that makes the server compute
      // free_time_minutes. It must be a full ISO 8601 instant WITH the airport's
      // offset — a bare 'HH:MM' is not in the request schema and is dropped
      // silently, which is exactly how every slack came back null before.
      ...(requestedPlan.boardingTime ? { boarding_time: requestedPlan.boardingTime } : {}),
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
    // The backend prunes inaccessible nodes and stair edges before it runs
    // Dijkstra, so an 'accessible' response is accessible by construction and
    // is never second-guessed here. The local review only ADDS warnings when it
    // sees stairs named out loud; the summary screen already shows them.
    if (requestedPlan.routeMode === 'accessible') {
      const warnings = accessibleModeWarnings(route);
      if (warnings.length) route.warnings = [...route.warnings, ...warnings];
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

/**
 * `routeMode` only sharpens the wording of a REAL failure. The client no longer
 * invents an accessibility failure of its own, so "sem escadas" is said only
 * when the backend itself found no route under route_mode='accessible'.
 */
export function routeError(err, routeMode = planState.routeMode) {
  const accessible = routeMode === 'accessible';
  if (err?.kind === 'no_path') {
    return accessible
      ? 'Não encontramos uma rota sem escadas entre estes pontos.'
      : 'Não foi possível encontrar um caminho entre os pontos selecionados.';
  }
  if (err instanceof SkyGateApiError) {
    if (err.kind === 'network') return 'Sem conexão. Verifique sua internet e tente novamente.';
    if (err.status === 404) {
      return accessible
        ? 'Não encontramos uma rota sem escadas entre estes pontos.'
        : 'Rota não encontrada para estes pontos.';
    }
    if (err.status === 422)     return 'Não foi possível calcular esta rota. Verifique origem e destino.';
    if (err.status >= 500)      return 'Servidor temporariamente indisponível. Tente novamente.';
  }
  return 'Não foi possível calcular a rota. Tente novamente.';
}
