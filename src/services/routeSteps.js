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
  const { path, segments } = route;
  const accessible = planState.routeMode === 'accessible';
  return path.length ? buildFromPath(path, accessible) : buildFromSteps(route.steps, accessible);
}

export function classifyNode(node) {
  if (!node) return 'internal';
  if (VERTICAL_TYPES.has(node.type)) return 'vertical';
  if (INTERNAL_TYPES.has(node.type)) return 'internal';
  if (node.isPoi) return 'named_poi';
  return 'internal';
}

export function buildFromPath(path, accessible) {
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
      if (accessible && (node.type === 'stairs' || node.type === 'escalator')) { i++; continue; }
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
      const poiLabel = getPublicNodeLabel(node);
      semantic.push({
        text: isDest ? `Chegue a ${poiLabel}.` : `Passe por ${poiLabel}.`,
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

    // Generate one walking step for segment
    const prev = semantic[semantic.length - 1];
    const text = 'Siga pelo corredor.';
    if (!prev || prev.text !== text || prev.floorId !== bufFloor) {
      semantic.push({
        text, isTransition: false, floorId: bufFloor, toFloor: bufFloor,
        icon: 'solar:arrow-right-bold', nodeType: 'corridor',
        rawFrom: bufStart, rawTo: i - 1,
        landmarkCode: null,
      });
    } else {
      prev.rawTo = i - 1;
    }
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

export function buildFromSteps(steps, accessible) {
  if (!steps.length) return [];
  const semantic = [];
  let buf = [];

  const flush = () => {
    if (!buf.length) return;
    const trans = buf.find(s => s.isTransition);
    if (trans) {
      const t = cleanStepText(trans.text);
      if (t) semantic.push({ text: t, isTransition: true, floorId: trans.floorId, toFloor: trans.floorId, icon: 'solar:round-transfer-vertical-bold', nodeType: 'elevator', rawFrom: 0, rawTo: 0, landmarkCode: null });
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
    if (accessible && /escada|escalator/i.test(step.text) && !/elev/i.test(step.text)) return;
    if (step.isTransition) { flush(); const t = cleanStepText(step.text); if (t) semantic.push({ text: t, isTransition: true, floorId: step.floorId, toFloor: step.floorId, icon: 'solar:round-transfer-vertical-bold', nodeType: 'elevator', rawFrom: 0, rawTo: 0, landmarkCode: null }); return; }
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
   converts them to metres. Nothing here is hardcoded per route.
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
  return r >= 1000 ? `${(r / 1000).toFixed(1).replace('.', ',')} km` : `${r} m`;
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

