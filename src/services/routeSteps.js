import { getRouteLandmarkLabel, getPublicNodeLabel } from './nodePresentation.js';
import { APP_CONFIG } from '../app/config/appConfig.js';
import { navState, planState } from '../state/appState.js';
import { INTERNAL_TYPES, VERTICAL_TYPES, getNodeMeta } from '../app/constants.js';
import { findNode } from '../state/selectors.js';
import { clamp } from '../utils/format.js';

/* ============================================================
   5. SEMANTIC STEP BUILDER v3
   ============================================================ */

export function buildSemanticSteps(route) {
  const { path } = route;
  return path.length ? buildFromPath(path) : buildFromSteps(route.steps);
}

const BLOCKED_ACCESSIBLE_TRANSITIONS = new Set(['stairs', 'escalator']);

/**
 * A non-empty geometry is authoritative: it must start and finish at the
 * requested places and every referenced node must exist in the loaded map.
 * Steps-only responses remain supported because some API variants do not
 * expose geometry.
 */
export function routePathMatchesPlan(route, originCode, destinationCode) {
  const path = route?.path ?? [];
  if (!path.length) return Boolean(route?.steps?.length);
  return path.length >= 2
    && path[0] === originCode
    && path.at(-1) === destinationCode
    && path.every(code => Boolean(findNode(code)));
}

/**
 * Recover the real vertical-transport type from normalized API metadata first,
 * then from passenger-facing text. The order matters: "escada rolante" must
 * never be reduced to the broader "escada" match.
 */
export function getStepTransitionType(step) {
  if (!step?.isTransition) return '';
  const explicit = String(
    step.transitionType
      ?? step.transition_type
      ?? step.transition?.type
      ?? '',
  ).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const text = String(step.text ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const signal = `${explicit} ${text}`;

  if (/\b(?:escalator|escada\s+rolante|rolante)\b/.test(signal)) return 'escalator';
  if (/\b(?:stairs?|escadas?)\b/.test(signal)) return 'stairs';
  if (/\b(?:elevators?|elevadores?|elevador|lift)\b/.test(signal)) return 'elevator';
  return 'transition';
}

/**
 * Non-blocking accessibility review of a route the backend already built.
 *
 * ── WHY THIS NO LONGER REJECTS ────────────────────────────────────────
 * When route_mode is 'accessible' the backend removes inaccessible nodes and
 * stair edges BEFORE running Dijkstra, so the route it returns is accessible by
 * construction. The client cannot improve on that, and the old gate did not
 * try to: it demanded PROOF of every floor transition through steps[].floorId
 * and steps[].toFloor, fields the API does not send — steps[] arrives as plain
 * strings and normalizeStep() fixes both to ''. Absence of evidence was read as
 * evidence of stairs, so valid accessible routes were thrown away and the
 * passenger who most needs one was told no route exists.
 *
 * What remains is a review that only ever speaks up on POSITIVE evidence:
 * a stairs/escalator node in the geometry, or an instruction that says so out
 * loud. Those come from the map and from passenger-facing text, not from the
 * metadata that was never populated. Silence means "nothing to add", never
 * "unverified" — an unproven floor change is normal and produces no warning.
 *
 * @returns {string[]} passenger-facing warnings, empty when nothing was found.
 */
export function accessibleModeWarnings(route) {
  const warnings = [];

  const blockedNode = (route?.path ?? [])
    .map(findNode)
    .find(node => BLOCKED_ACCESSIBLE_TRANSITIONS.has(node?.type));
  if (blockedNode) {
    // Name the place when the map gives it a name; otherwise still say what it
    // is. A warning that reads "passa por ." helps nobody.
    const kind = blockedNode.type === 'escalator' ? 'uma escada rolante' : 'escadas';
    const place = getPublicNodeLabel(blockedNode) || kind;
    warnings.push(`Esta rota passa por ${place}. Procure um elevador próximo se precisar evitar degraus.`);
  }

  const spokenTypes = (route?.steps ?? [])
    .filter(step => step?.isTransition)
    .map(getStepTransitionType);
  const segmentTypes = (route?.segments ?? [])
    .filter(segment => segment?.type === 'transition')
    .map(segment => getStepTransitionType({
      isTransition: true,
      transitionType: segment.transitionType,
      text: '',
    }));
  const declared = [...spokenTypes, ...segmentTypes]
    .find(type => BLOCKED_ACCESSIBLE_TRANSITIONS.has(type));
  if (declared && !blockedNode) {
    warnings.push(declared === 'escalator'
      ? 'Uma das instruções menciona escada rolante. Confira se há elevador no trecho.'
      : 'Uma das instruções menciona escadas. Confira se há elevador no trecho.');
  }

  return warnings;
}

export function classifyNode(node) {
  if (!node) return 'internal';
  if (VERTICAL_TYPES.has(node.type)) return 'vertical';
  if (INTERNAL_TYPES.has(node.type)) return 'internal';
  if (node.isPoi) return 'named_poi';
  return 'internal';
}

// A bend must be both visually meaningful and far enough from its neighbours
// to be useful while walking. Distances are physical metres after the airport
// map calibration, so these limits stay stable if the SVG coordinate range
// changes. A 50-degree threshold deliberately ignores gentle corridor drift.
const TURN_MIN_ANGLE_DEGREES = 50;
const U_TURN_MIN_ANGLE_DEGREES = 150;
const TURN_SAMPLE_METERS = 5;
const TURN_MIN_LEG_METERS = 3;
const TURN_MIN_SPACING_METERS = 7;

function routeNodeAt(path, index, floorId) {
  const node = findNode(path[index]);
  return node
    && node.floorId === floorId
    && Number.isFinite(node.x)
    && Number.isFinite(node.y)
    ? node
    : null;
}

/** Find a stable point on one side of a bend instead of trusting tiny edges. */
function sampleTurnLeg(path, pivotIndex, direction, minIndex, maxIndex, floorId) {
  let index = pivotIndex;
  let node = routeNodeAt(path, index, floorId);
  if (!node) return null;

  let walked = 0;
  while (index + direction >= minIndex && index + direction <= maxIndex) {
    const nextIndex = index + direction;
    const next = routeNodeAt(path, nextIndex, floorId);
    if (!next) return null;
    walked += segmentMeters(node, next);
    index = nextIndex;
    node = next;
    if (walked >= TURN_SAMPLE_METERS) return { node, walked };
  }

  return walked >= TURN_MIN_LEG_METERS ? { node, walked } : null;
}

function turnAt(path, pivotIndex, runStart, runEnd, floorId) {
  const pivot = routeNodeAt(path, pivotIndex, floorId);
  if (!pivot) return null;

  // The node immediately outside an internal run may be an origin, POI or
  // destination. It is valid geometric context, but never becomes a turn step.
  const minIndex = Math.max(0, runStart - 1);
  const maxIndex = Math.min(path.length - 1, runEnd + 1);
  const before = sampleTurnLeg(path, pivotIndex, -1, minIndex, maxIndex, floorId);
  const after = sampleTurnLeg(path, pivotIndex, 1, minIndex, maxIndex, floorId);
  if (!before || !after) return null;

  const incoming = { x: pivot.x - before.node.x, y: pivot.y - before.node.y };
  const outgoing = { x: after.node.x - pivot.x, y: after.node.y - pivot.y };
  const incomingLength = Math.hypot(incoming.x, incoming.y);
  const outgoingLength = Math.hypot(outgoing.x, outgoing.y);
  if (!incomingLength || !outgoingLength) return null;

  const cosine = clamp(
    (incoming.x * outgoing.x + incoming.y * outgoing.y) / (incomingLength * outgoingLength),
    -1,
    1,
  );
  const angle = Math.acos(cosine) * 180 / Math.PI;
  if (angle < TURN_MIN_ANGLE_DEGREES) return null;

  if (angle >= U_TURN_MIN_ANGLE_DEGREES) {
    return { index: pivotIndex, angle, direction: 'around' };
  }

  // SVG coordinates grow downwards on Y: east -> south has a positive cross
  // product and is therefore a passenger's right turn.
  const cross = incoming.x * outgoing.y - incoming.y * outgoing.x;
  if (Math.abs(cross) < Number.EPSILON) return null;
  return { index: pivotIndex, angle, direction: cross > 0 ? 'right' : 'left' };
}

function findTurns(path, runStart, runEnd, floorId) {
  const candidates = [];
  for (let index = runStart; index <= runEnd; index++) {
    const turn = turnAt(path, index, runStart, runEnd, floorId);
    if (turn) candidates.push(turn);
  }

  // Dense graphs can describe one physical corner with several close nodes.
  // Keep only the clearest angle in that short cluster so the timeline does
  // not turn a single manoeuvre into repeated commands.
  const turns = [];
  candidates.forEach(candidate => {
    const previous = turns.at(-1);
    if (previous && pathMeters(path, previous.index, candidate.index) < TURN_MIN_SPACING_METERS) {
      if (candidate.angle > previous.angle) turns[turns.length - 1] = candidate;
      return;
    }
    turns.push(candidate);
  });
  return turns;
}

function walkingInstruction(direction) {
  if (direction === 'right') {
    return { text: 'Vire à direita e siga pelo corredor.', icon: 'lucide:corner-up-right' };
  }
  if (direction === 'left') {
    return { text: 'Vire à esquerda e siga pelo corredor.', icon: 'lucide:corner-up-left' };
  }
  if (direction === 'around') {
    return { text: 'Faça o retorno e siga pelo corredor.', icon: 'lucide:undo-2' };
  }
  return { text: 'Siga pelo corredor.', icon: 'solar:arrow-right-bold' };
}

function buildWalkingSteps(path, runStart, runEnd, floorId) {
  const turns = findTurns(path, runStart, runEnd, floorId);
  const starts = [];
  if (!turns.length || turns[0].index !== runStart) {
    starts.push({ index: runStart, direction: 'straight' });
  }
  starts.push(...turns);

  // Share the exit node with the following POI/transition step. The semantic
  // step still starts at that node, while the current overlay owns the edge
  // walked to reach it instead of collapsing to a zero-length highlight.
  const exitIndex = runEnd + 1;
  const runExit = routeNodeAt(path, exitIndex, floorId) ? exitIndex : runEnd;

  return starts.map((entry, index) => {
    const instruction = walkingInstruction(entry.direction);
    const nextStart = starts[index + 1]?.index ?? runExit;
    return {
      text: instruction.text,
      isTransition: false,
      floorId,
      toFloor: floorId,
      icon: instruction.icon,
      nodeType: 'corridor',
      rawFrom: entry.index,
      rawTo: Math.max(entry.index, nextStart),
      landmarkCode: null,
    };
  });
}

/**
 * The first step is DEPARTURE guidance, not the origin restated: the banner
 * already names the destination, so step 1 says where to leave from and
 * which way to head — towards the corridor, or towards the lift / shop /
 * gate that comes next when the route starts straight at one.
 */
export function departureText(originLabel, nextNode) {
  if (!nextNode) return `Saia de ${originLabel}.`;
  const toward = classifyNode(nextNode) === 'internal'
    ? 'ao corredor'
    : `a ${getPublicNodeLabel(nextNode)}`;
  return `Saia de ${originLabel} em direção ${toward}.`;
}

export function buildFromPath(path) {
  const semantic = [];
  let i = 0;

  const floorAt = idx => {
    const n = findNode(path[idx]);
    return n?.floorId ?? '';
  };

  while (i < path.length) {
    const code = path[i];
    const node = findNode(code);
    const cls  = classifyNode(node);

    if (cls === 'vertical') {
      const fromFloor = floorAt(i - 1);
      const toFloor   = floorAt(i + 1);
      // Use presentation layer for human-readable instruction text
      const instrText = getRouteLandmarkLabel(node, { toFloor: (toFloor && fromFloor !== toFloor) ? toFloor : '' });
      semantic.push({
        text: instrText,
        isTransition: true, floorId: node.floorId, toFloor: toFloor || node.floorId,
        icon: getNodeMeta(node.type).icon, nodeType: node.type,
        rawFrom: i, rawTo: i,
        landmarkCode: node.code,
      });
      i++;
      continue;
    }

    if (cls === 'named_poi') {
      const isDest = node.code === planState.destinationCode;
      const isOrigin = i === 0 && node.code === planState.originCode;
      const poiLabel = getPublicNodeLabel(node);
      semantic.push({
        text: isDest
          ? `Chegue a ${poiLabel}.`
          : isOrigin ? departureText(poiLabel, findNode(path[i + 1])) : `Passe por ${poiLabel}.`,
        isTransition: false, floorId: node.floorId, toFloor: node.floorId,
        icon: getNodeMeta(node.type).icon, nodeType: node.type,
        rawFrom: i, rawTo: i,
        landmarkCode: node.code,
      });
      i++;
      continue;
    }

    // Internal: buffer until floor or type change
    const bufStart = i;
    const bufFloor = floorAt(i);
    const bufNodes = [];
    while (i < path.length && classifyNode(findNode(path[i])) === 'internal' && floorAt(i) === bufFloor) {
      bufNodes.push(findNode(path[i]));
      i++;
    }
    if (!bufNodes.length) { i++; continue; }

    semantic.push(...buildWalkingSteps(path, bufStart, i - 1, bufFloor));
  }

  // Ensure destination is always the last step
  const destNode = findNode(planState.destinationCode);
  if (destNode) {
    const last = semantic[semantic.length - 1];
    const destPublicLabel = getPublicNodeLabel(destNode);
    if (!last || !last.text.includes(destPublicLabel)) {
      semantic.push({
        text: `Chegue a ${destPublicLabel}.`, isTransition: false,
        floorId: destNode.floorId, toFloor: destNode.floorId,
        icon: getNodeMeta(destNode.type).icon, nodeType: destNode.type,
        rawFrom: path.length - 1, rawTo: path.length - 1,
        landmarkCode: destNode.code,
      });
    }
  }

  return semantic.filter(s => s.text);
}

export function buildFromSteps(steps) {
  if (!steps.length) return [];
  const semantic = [];
  let buf = [];

  const transitionStep = step => {
    const text = cleanStepText(step.text);
    if (!text) return null;
    const transitionType = getStepTransitionType(step);
    const nodeType = VERTICAL_TYPES.has(transitionType) ? transitionType : 'transition';
    return {
      text,
      isTransition: true,
      floorId: step.floorId,
      toFloor: step.toFloor || step.floorId,
      icon: nodeType === 'transition'
        ? 'solar:round-transfer-vertical-bold'
        : getNodeMeta(nodeType).icon,
      nodeType,
      rawFrom: 0,
      rawTo: 0,
      landmarkCode: null,
    };
  };

  const flush = () => {
    if (!buf.length) return;
    const trans = buf.find(s => s.isTransition);
    if (trans) {
      const normalized = transitionStep(trans);
      if (normalized) semantic.push(normalized);
    } else {
      const goodTexts = buf.map(s => s.text).filter(t => t && !isInternalText(t));
      const text = goodTexts.length ? cleanStepText(goodTexts[goodTexts.length - 1]) : 'Siga pelo corredor.';
      if (text && (!semantic.length || semantic[semantic.length - 1].text !== text)) {
        semantic.push({ text, isTransition: false, floorId: buf[0]?.floorId ?? '', toFloor: buf[0]?.floorId ?? '', icon: 'solar:arrow-right-bold', nodeType: 'corridor', rawFrom: 0, rawTo: 0, landmarkCode: null });
      }
    }
    buf = [];
  };

  steps.forEach(step => {
    if (step.isTransition) {
      flush();
      const normalized = transitionStep(step);
      if (normalized) semantic.push(normalized);
      return;
    }
    if (isInternalText(step.text)) { buf.push(step); } else { flush(); const t = cleanStepText(step.text); if (t) semantic.push({ text: t, isTransition: false, floorId: step.floorId, toFloor: step.floorId, icon: 'solar:arrow-right-bold', nodeType: 'corridor', rawFrom: 0, rawTo: 0, landmarkCode: null }); }
  });
  flush();

  const destNode = findNode(planState.destinationCode);
  if (destNode) {
    const last = semantic[semantic.length - 1];
    const destPublicLabel = getPublicNodeLabel(destNode);
    if (!last || !last.text.includes(destPublicLabel)) {
      semantic.push({ text: `Chegue a ${destPublicLabel}.`, isTransition: false, floorId: destNode.floorId, toFloor: destNode.floorId, icon: getNodeMeta(destNode.type).icon, nodeType: destNode.type, rawFrom: 0, rawTo: 0, landmarkCode: destNode.code });
    }
  }
  return semantic.filter(s => s.text);
}

export const INTERNAL_TEXT_PATTERNS = [
  /siga\s+at[eé]\s+(o\s+)?(corredor|waypoint|transi[cç][aã]o|passarela|n[oó])/i,
  /\bcorredor\s+[a-z\d]/i,
  /\btransi[cç][aã]o\s+passarela/i,
  /\bwaypoint\b/i,
  /\bpassarela\s+\d/i,
];

export function isInternalText(t) { return INTERNAL_TEXT_PATTERNS.some(re => re.test(t)); }

export function cleanStepText(raw) {
  if (!raw) return '';
  let t = raw.replace(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+){2,}\b/g, '').replace(/\s{2,}/g, ' ').replace(/^[,;\s]+|[,;\s]+$/g, '').trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : '';
}

/* ============================================================
   5b. WALKING DISTANCE — measured along the route path

   Node coordinates are abstract map units; APP_CONFIG.distance.metersPerUnit
   applies the empirical airport calibration. The result is useful wayfinding
   guidance, not surveyed geometry, so formatted values are marked approximate.
   ============================================================ */

export function segmentMeters(a, b) {
  if (!a || !b) return 0;
  return Math.hypot(b.x - a.x, b.y - a.y) * APP_CONFIG.distance.metersPerUnit;
}

/** Total walking distance between two indices of the route path. */
export function pathMeters(path, fromIdx, toIdx) {
  const start = clamp(fromIdx, 0, path.length - 1);
  const end   = clamp(toIdx,   0, path.length - 1);
  let total = 0;
  for (let i = start; i < end; i++) {
    total += segmentMeters(findNode(path[i]), findNode(path[i + 1]));
  }
  return total;
}

export function roundMeters(m) {
  const grid = APP_CONFIG.distance.roundToMeters;
  if (!(m > 0)) return 0;
  return Math.max(grid, Math.round(m / grid) * grid);
}

export function formatMeters(m) {
  const r = roundMeters(m);
  if (!r) return '';
  return r >= 1000 ? `~${(r / 1000).toFixed(1).replace('.', ',')} km` : `~${r} m`;
}

/**
 * The navigation screen's distance: same 10 m grid, no tilde. "60 m" reads
 * as a fact the traveller can act on; "~60 m" reads as a shrug.
 */
export function formatDistance(m) {
  return formatMeters(m).replace(/^~/, '');
}

/**
 * Attach `distanceMeters` to each semantic step: the distance walked from
 * that step's own path position up to where the next step begins.
 */
export function attachStepDistances(steps, path) {
  if (!path.length) {
    steps.forEach(s => { s.distanceMeters = 0; });
    return steps;
  }
  steps.forEach((step, i) => {
    const from = step.rawFrom ?? 0;
    const to   = steps[i + 1]?.rawFrom ?? path.length - 1;
    step.distanceMeters = pathMeters(path, from, Math.max(from, to));
  });
  return steps;
}

/** Number of floor changes on the route — drives the "Andares" metric. */
export function countFloorChanges() {
  return navState.semanticSteps.filter(
    s => s.isTransition && s.toFloor && s.toFloor !== s.floorId
  ).length;
}
