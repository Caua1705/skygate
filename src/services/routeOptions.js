/**
 * Route-option presentation and live flight scoring.
 *
 * Product rule: an option is selectable only when it represents a route the
 * backend can actually navigate. When the API returns one route, the UI shows
 * one route. We never manufacture a food/shop alternative by annotating the
 * same node path: that would promise a detour navigation cannot follow.
 *
 * Accepted backend collections: rotas, alternatives, routes, or route_options.
 * The rest of the app consumes the stable shape returned here, so a richer
 * backend response does not leak into screen components.
 */
import { asArray, first } from '../utils/format.js';
import { findNode } from '../state/selectors.js';
import { slackFor } from './flightSlack.js';
import { buildSegments, normalizeStep } from './normalize.js';
import { isRouteCompatibleWithAccessibleMode } from './routeSteps.js';

export const FASTEST_ID = 'fastest';

const MAX_PASSES_BY = 3;

export function buildRouteOptions(route, { accessible = false } = {}) {
  if (!route) return [];
  const fromApi = normalizeApiOptions(route.raw, route, { accessible });
  return fromApi.length ? fromApi : [directOption(route)];
}

export function findOption(options, id) {
  return options.find(option => option.id === id) ?? options[0] ?? null;
}

/**
 * Carry a selected option into the active route without discarding information
 * the option format does not repeat. In particular, a steps-only direct route
 * has no path but still owns valid backend steps and floor segments.
 */
export function routeForSelectedOption(baseRoute, option) {
  if (!baseRoute || !option) return null;
  const path = option.path ?? [];
  if (!path.length) {
    return {
      ...baseRoute,
      optionId: option.id,
      warnings: option.warnings ?? baseRoute.warnings ?? [],
      estimatedMinutes: option.minutes,
    };
  }

  return {
    ...baseRoute,
    optionId: option.id,
    path,
    steps: option.steps?.length
      ? option.steps.map((step, index) => normalizeStep(step, index))
      : [],
    segments: buildSegments(path),
    warnings: option.warnings ?? [],
    estimatedMinutes: option.minutes,
  };
}

/**
 * Re-score on every render because the deadline moves while the screen is
 * open. List order remains stable except that impossible routes move below
 * viable ones; constant re-sorting by minute would make the choice unstable.
 */
export function scoreOptions(options, now = new Date()) {
  if (!options?.length) return [];

  const fastest = options.reduce((best, option) => (
    !best || option.minutes < best.minutes ? option : best
  ), null);
  const scored = options.map(option => ({
    ...option,
    isFastest: option.id === fastest?.id,
    slack: slackFor(option.minutes, now),
    recommended: false,
  }));

  if (!scored[0].slack) return scored;

  const ordered = orderByViability(scored);
  const recommendedId = pickRecommended(ordered);
  return ordered.map(option => ({ ...option, recommended: option.id === recommendedId }));
}

function orderByViability(options) {
  return [
    ...options.filter(option => option.slack.status !== 'inviavel'),
    ...options.filter(option => option.slack.status === 'inviavel'),
  ];
}

function pickRecommended(options) {
  const viable = options.filter(option => option.slack.status !== 'inviavel');
  if (!viable.length) return '';
  return (viable.find(option => option.recommendedByApi)
    ?? viable.find(option => option.isFastest)
    ?? viable[0]).id;
}

export function slackHint(option) {
  const status = option.slack?.status;
  if (!status) return '';
  if (status === 'inviavel') return 'chegada após o fechamento estimado do portão';
  if (status === 'apertada') return 'siga direto, sem paradas';
  if (status === 'tranquila') return option.fits || 'boa margem até o portão';
  return option.fits || '';
}

function normalizeApiOptions(raw, baseRoute, { accessible = false } = {}) {
  const source = first(raw?.rotas, raw?.alternatives, raw?.routes, raw?.route_options, []);
  const list = asArray(source).filter(item => item && typeof item === 'object');
  if (!list.length) return [];

  const fallbackMinutes = positiveMinutes(baseRoute?.estimatedMinutes, 1);
  const parsed = list.map((item, index) => {
    const path = normalizeCodes(first(item?.node_codes, item?.nodeCodes, item?.path, item?.nodes, []));
    const minutes = positiveMinutes(
      first(item?.tempo_min, item?.estimated_time_minutes, item?.minutes),
      fallbackMinutes,
    );
    const suppliedFloors = Number(first(item?.pisos, item?.floors, 0));
    return {
      id: String(first(item?.id, item?.slug, index === 0 ? FASTEST_ID : 'route-' + (index + 1))),
      name: String(first(item?.nome, item?.name, item?.label, index === 0 ? 'Mais rápida' : 'Rota ' + (index + 1))),
      icon: String(first(item?.icone, item?.icon, index === 0 ? 'lucide:zap' : 'lucide:route')),
      minutes,
      deltaMinutes: Math.max(0, Math.round(Number(first(item?.delta_vs_rapida_min, item?.delta_minutes, 0)) || 0)),
      floors: suppliedFloors > 0 ? Math.round(suppliedFloors) : countPathFloors(path),
      passesBy: asArray(item?.passa_por ?? item?.passes_by).slice(0, MAX_PASSES_BY).map(normalizePassBy),
      steps: asArray(item?.etapas ?? item?.steps),
      path,
      warnings: asArray(item?.warnings ?? item?.avisos),
      // Walking time always depends on pace and airport conditions. Even
      // when supplied by the API it is an estimate, never a timetable fact.
      isEstimate: true,
      fits: String(first(item?.sugestao, item?.hint, '')),
      recommendedByApi: Boolean(first(item?.recommended, item?.recomendada, false)),
      serverSlackMin: Number.isFinite(Number(item?.folga_min)) ? Number(item.folga_min) : null,
      serverStatus: String(first(item?.status, '')),
    };
  });

  const expectedStart = baseRoute?.path?.[0] ?? '';
  const expectedEnd = baseRoute?.path?.at?.(-1) ?? '';
  const valid = parsed.filter(option => {
    if (option.path.length < 2 || option.path.some(code => !findNode(code))) return false;
    if (accessible && !isRouteCompatibleWithAccessibleMode({
      path: option.path,
      steps: option.steps.map((step, stepIndex) => normalizeStep(step, stepIndex)),
    })) return false;
    if (expectedStart && option.path[0] !== expectedStart) return false;
    if (expectedEnd && option.path.at(-1) !== expectedEnd) return false;
    return true;
  });
  if (!valid.length) return [];

  const fastestMinutes = Math.min(...valid.map(option => option.minutes));
  return valid.map(option => ({
    ...option,
    deltaMinutes: option.deltaMinutes || Math.max(0, option.minutes - fastestMinutes),
  }));
}

function directOption(route) {
  return {
    id: FASTEST_ID,
    name: 'Mais rápida',
    icon: 'lucide:zap',
    minutes: positiveMinutes(route.estimatedMinutes, 1),
    deltaMinutes: 0,
    floors: countRouteFloors(route),
    passesBy: [],
    steps: route.steps ?? [],
    path: route.path ?? [],
    warnings: route.warnings ?? [],
    isEstimate: true,
    fits: '',
    recommendedByApi: false,
  };
}

function normalizePassBy(place) {
  if (typeof place === 'string') {
    return { code: '', name: place, icon: 'lucide:map-pin', floor: '', open: null };
  }
  return {
    code: String(first(place?.code, place?.node_code, '')),
    name: String(first(place?.loja, place?.name, place?.label, 'Local')),
    icon: String(first(place?.icone, place?.icon, 'lucide:map-pin')),
    floor: String(first(place?.piso, place?.floor, '')),
    open: typeof place?.aberto === 'boolean' ? place.aberto : null,
  };
}

function normalizeCodes(value) {
  return asArray(value).map(item => {
    if (typeof item === 'string' || typeof item === 'number') return String(item);
    return String(first(item?.code, item?.node_code, ''));
  }).filter(Boolean);
}

function positiveMinutes(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.max(1, Math.round(n)) : fallback;
}

function countPathFloors(path) {
  const ids = new Set(path.map(code => findNode(code)?.floorId).filter(Boolean));
  return Math.max(1, ids.size);
}

function countRouteFloors(route) {
  const ids = new Set(
    (route.segments ?? [])
      .filter(segment => segment.type === 'floor')
      .map(segment => segment.floorId)
      .filter(Boolean),
  );
  if (!ids.size) (route.path ?? []).forEach(code => {
    const floorId = findNode(code)?.floorId;
    if (floorId) ids.add(floorId);
  });
  return Math.max(1, ids.size);
}
