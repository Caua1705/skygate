/**
 * routeOptions — "how do you want to cross the airport?"
 *
 * The Home screen picks A → B and asks the backend for a route. This module
 * turns that answer into the two-to-three WAYS of walking it that the choice
 * screen offers: the direct one, the one through the food court, the one
 * through the shops.
 *
 * ─── SWAP TO BACKEND ──────────────────────────────────────────────────
 * The screen only ever calls `buildRouteOptions(route)`. The moment Dijkstra
 * starts returning alternatives, put them on the response under `rotas`
 * (or `alternatives` / `routes` / `route_options`) shaped like this and they
 * are used verbatim — nothing in the UI changes:
 *
 *   {
 *     id: 'food',
 *     nome: 'Pela praça de alimentação',   // `name` also accepted
 *     tempo_min: 15,
 *     delta_vs_rapida_min: 3,
 *     pisos: 2,
 *     passa_por: [{ loja: 'Club Café', icone: 'lucide:coffee' }],
 *     etapas: [...]                         // same shape as route.steps
 *   }
 *
 * ON `folga_min` / `status`: the endpoint may also accept `horario_voo` and
 * return those per route. We PARSE them but recompute slack on the client
 * anyway — see scoreOptions(). A slack minted server-side is stale the second
 * it is serialised, and this screen sits open while the passenger reads it.
 * The server's copy is the right thing for logging and for any push
 * notification; the number on screen has to follow the device clock.
 *
 * Until alternatives exist, `deriveOptions()` below builds the extra cards
 * from the POIs that actually sit on or beside the calculated path, and flags
 * them `isEstimate` so the UI labels the numbers as approximations instead of
 * passing a guess off as a fact. The component is written for N options either
 * way — it never assumes exactly three.
 * ──────────────────────────────────────────────────────────────────────
 */
import { INTERNAL_TYPES, getPublicNodeLabel, getTypeMeta } from './nodePresentation.js';
import { getOpenStatus, getPlaceDetails } from './placesMock.js';
import { appData } from '../state/appState.js';
import { findNode, getFloorLabel } from '../state/selectors.js';
import { asArray, clamp, first } from '../utils/format.js';
import { slackFor } from './flightSlack.js';

/** The direct route is always id `fastest`; the screen pre-selects it. */
export const FASTEST_ID = 'fastest';

/**
 * The detour flavours we can synthesise locally, in display order.
 * `types` are node types as they arrive from the API (see nodePresentation).
 */
const FLAVOURS = [
  {
    id: 'food',
    name: 'Pela praça de alimentação',
    icon: 'lucide:coffee',
    types: new Set(['restaurant']),
    fits: 'dá tempo de comer algo no caminho',
  },
  {
    id: 'shops',
    name: 'Pelas lojas',
    icon: 'lucide:shopping-bag',
    types: new Set(['shop', 'pharmacy']),
    fits: 'dá tempo de passar nas lojas',
  },
];

/** Node type → Lucide glyph for the "passa por" chips. */
const PLACE_ICONS = {
  restaurant: 'lucide:utensils',
  shop:       'lucide:shopping-bag',
  pharmacy:   'lucide:pill',
  lounge:     'lucide:armchair',
};

/** How many places one card lists before it stops being scannable. */
const MAX_PASSES_BY = 3;

/** A synthesised detour never claims to cost more than this. */
const MAX_DERIVED_DELTA = 25;

/* ============================================================
   PUBLIC
   ============================================================ */

/**
 * The options for a calculated route, best-first. Always returns at least the
 * direct route, so the screen has something to select even when the airport
 * has no POIs near the path at all.
 */
export function buildRouteOptions(route) {
  if (!route) return [];
  const fromApi = normalizeApiOptions(route.raw);
  if (fromApi.length) return fromApi;
  return deriveOptions(route);
}

/** The selected option, falling back to the first one. */
export function findOption(options, id) {
  return options.find(o => o.id === id) ?? options[0] ?? null;
}

/**
 * The options ready to render: each one scored against the flight deadline,
 * ordered, and with exactly one marked as the app's recommendation.
 *
 * Recomputed at RENDER time, never stored — `now` moves while the screen is
 * open, so a route that was "apertada" a moment ago becomes "inviável" on its
 * own. Returns the options untouched (slack null, no recommendation) when the
 * passenger gave no flight time.
 */
export function scoreOptions(options, now = new Date()) {
  if (!options?.length) return [];

  const fastestId = options[0]?.id;
  const scored = options.map(o => {
    const fit = slackFor(o.minutes, now);
    return { ...o, isFastest: o.id === fastestId, slack: fit, recommended: false };
  });

  if (!scored[0].slack) return scored;   // no flight: plain list, no verdicts

  const ordered = orderByViability(scored);
  const pick = pickRecommended(ordered);
  return ordered.map(o => ({ ...o, recommended: o.id === pick }));
}

/**
 * Viable routes keep their natural order (fastest, food, shops); anything the
 * passenger cannot actually make sinks to the bottom. Deliberately NOT a sort
 * by slack — reshuffling the whole list every minute as the clock ticks would
 * make the screen impossible to trust.
 */
function orderByViability(scored) {
  const viable = scored.filter(o => o.slack.status !== 'inviavel');
  const doomed = scored.filter(o => o.slack.status === 'inviavel');
  return [...viable, ...doomed];
}

/**
 * The one route the app puts its name on.
 *
 * Tight margin → the direct route, and the others carry their own warning.
 * Generous margin → the scenic one, because that is the whole point of having
 * time to spare: the copilot should say "you can afford the coffee".
 *
 * When NOTHING fits, nothing is recommended. The fastest is still what the
 * screen pre-selects (it is the least bad), but stamping "recomendada para
 * você" on a route the passenger would miss their flight on is the app
 * endorsing a plan it has just called impossible.
 */
function pickRecommended(ordered) {
  const viable = ordered.filter(o => o.slack.status !== 'inviavel');
  if (!viable.length) return '';

  const scenic = viable.find(o => !o.isFastest && o.slack.status === 'tranquila');
  return (scenic ?? viable[0]).id;
}

/** The short line under a card's badge: what this margin lets you do. */
export function slackHint(option) {
  const status = option.slack?.status;
  if (!status) return '';
  if (status === 'inviavel') {
    return option.isFastest ? 'você chegaria após o embarque' : 'a rota direta cabe melhor';
  }
  if (status === 'apertada') return 'siga direto, sem paradas';
  if (status === 'tranquila') return option.fits ?? 'dá tempo de aproveitar o aeroporto';
  return option.isFastest ? '' : (option.fits ?? '');
}

/* ============================================================
   BACKEND SHAPE
   ============================================================ */

function normalizeApiOptions(raw) {
  const list = asArray(first(raw?.rotas, raw?.alternatives, raw?.routes, raw?.route_options, []));
  if (list.length < 2) return [];   // one route is not a choice — derive instead

  return list.map((r, i) => {
    const minutes = Math.max(1, Math.round(Number(first(r?.tempo_min, r?.estimated_time_minutes, r?.minutes, 0)) || 0));
    return {
      id: String(first(r?.id, r?.slug, `rota-${i}`)),
      name: String(first(r?.nome, r?.name, r?.label, `Opção ${i + 1}`)),
      icon: String(first(r?.icone, r?.icon, i === 0 ? 'lucide:zap' : 'lucide:map-pin')),
      minutes,
      deltaMinutes: Math.max(0, Math.round(Number(first(r?.delta_vs_rapida_min, r?.delta_minutes, 0)) || 0)),
      floors: Math.max(1, Number(first(r?.pisos, r?.floors, 1)) || 1),
      passesBy: asArray(r?.passa_por ?? r?.passes_by).slice(0, MAX_PASSES_BY).map(normalizePassBy),
      steps: asArray(r?.etapas ?? r?.steps),
      path: asArray(r?.path ?? r?.node_codes),
      isEstimate: false,
      fits: String(first(r?.sugestao, r?.hint, '')),
      // Kept for logging/parity checks; the screen recomputes live. See the
      // "ON folga_min / status" note at the top of this file.
      serverSlackMin: Number.isFinite(Number(r?.folga_min)) ? Number(r.folga_min) : null,
      serverStatus: String(first(r?.status, '')),
    };
  });
}

function normalizePassBy(p) {
  if (typeof p === 'string') return { code: '', name: p, icon: 'lucide:map-pin', floor: '', open: null };
  return {
    code: String(first(p?.code, p?.node_code, '')),
    name: String(first(p?.loja, p?.name, p?.label, 'Local')),
    icon: String(first(p?.icone, p?.icon, 'lucide:map-pin')),
    floor: String(first(p?.piso, p?.floor, '')),
    open: typeof p?.aberto === 'boolean' ? p.aberto : null,
  };
}

/* ============================================================
   LOCAL DERIVATION (until the backend returns alternatives)
   ============================================================ */

function deriveOptions(route) {
  const baseMinutes = Math.max(1, Math.round(route.estimatedMinutes) || 1);
  const floors = countFloors(route);
  const pathCodes = route.path ?? [];
  const pathSet = new Set(pathCodes);
  const pathNodes = pathCodes.map(findNode).filter(Boolean);
  const totalUnits = pathLengthUnits(pathNodes);

  const fastest = {
    id: FASTEST_ID,
    name: 'Mais rápida',
    icon: 'lucide:zap',
    minutes: baseMinutes,
    deltaMinutes: 0,
    floors,
    passesBy: [],
    steps: route.steps ?? [],
    path: pathCodes,
    isEstimate: false,
    fits: '',
  };

  const detours = FLAVOURS.map(flavour => {
    const picks = poisNearPath(pathNodes, pathSet, flavour.types);
    if (!picks.length) return null;

    // Scale-free: the detour is a fraction of the walk we already have a
    // trusted duration for, so it never depends on metersPerUnit being right.
    const extraUnits = picks.reduce((sum, p) => sum + (p.onPath ? 0 : p.distance * 2), 0);
    const deltaMinutes = (extraUnits > 0 && totalUnits > 0)
      ? clamp(Math.round(baseMinutes * (extraUnits / totalUnits)), 1, MAX_DERIVED_DELTA)
      : 0;

    return {
      id: flavour.id,
      name: flavour.name,
      icon: flavour.icon,
      minutes: baseMinutes + deltaMinutes,
      deltaMinutes,
      floors,
      passesBy: picks.map(p => describePlace(p.node)),
      steps: route.steps ?? [],
      path: pathCodes,
      // The places are real and measured; the minutes they cost are inferred.
      isEstimate: deltaMinutes > 0,
      fits: flavour.fits,
    };
  }).filter(Boolean);

  return [fastest, ...detours];
}

/**
 * POIs of the given types, ranked by how little they take you off the route:
 * anything already on the path first, then whatever is closest to it.
 * Distances stay in raw node units — only their RATIO is ever used.
 */
function poisNearPath(pathNodes, pathSet, types) {
  if (!pathNodes.length) return [];

  const scored = appData.nodes
    .filter(n => types.has(n.type) && !INTERNAL_TYPES.has(n.type))
    .map(node => {
      let best = Infinity;
      for (const p of pathNodes) {
        if (p.floorId !== node.floorId) continue;   // a different floor is a different walk
        best = Math.min(best, Math.hypot(p.x - node.x, p.y - node.y));
      }
      return { node, distance: best, onPath: pathSet.has(node.code) };
    })
    .filter(s => Number.isFinite(s.distance));

  scored.sort((a, b) => (Number(b.onPath) - Number(a.onPath)) || (a.distance - b.distance));
  return scored.slice(0, MAX_PASSES_BY);
}

/** One entry in a card's "passa por" row. */
function describePlace(node) {
  const place = getPlaceDetails(node.code);
  const status = place?.opening_hours ? getOpenStatus(place.opening_hours) : null;
  return {
    code: node.code,
    name: place?.name ?? getPublicNodeLabel(node),
    icon: PLACE_ICONS[node.type] ?? 'lucide:map-pin',
    floor: getFloorLabel(node.floorId),
    open: status ? status.open : null,     // null = unknown, never rendered
    closesAt: status?.open ? (status.today?.close ?? '') : '',
  };
}

function countFloors(route) {
  const ids = new Set(
    (route.segments ?? []).filter(s => s.type === 'floor').map(s => s.floorId).filter(Boolean)
  );
  if (!ids.size) {
    (route.path ?? []).forEach(code => {
      const n = findNode(code);
      if (n?.floorId) ids.add(n.floorId);
    });
  }
  return Math.max(1, ids.size);
}

function pathLengthUnits(pathNodes) {
  let total = 0;
  for (let i = 0; i < pathNodes.length - 1; i++) {
    const a = pathNodes[i], b = pathNodes[i + 1];
    if (a.floorId !== b.floorId) continue;
    total += Math.hypot(b.x - a.x, b.y - a.y);
  }
  return total;
}
