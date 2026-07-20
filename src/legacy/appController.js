/**
 * SkyGate — App Controller v4
 *
 * Three distinct interface modes:
 *   'planning'   → No map. Light surface with origin/destination form.
 *   'summary'    → No map. Compact route summary card with 3 actions.
 *   'navigation' → Map as primary UI. Compact floating instruction card.
 *
 * Map strategy:
 *   - No real SVG endpoint exists in the API.
 *   - We build a CLEAN, semantic floor map from node coordinates.
 *   - Base map (terminal shape + zones) is cached per floor — never rebuilt.
 *   - Route overlay is a separate SVG layer updated per step — no full rebuild.
 *   - Technical nodes (corridor, waypoint, transition) are NEVER shown.
 *   - Only useful markers: origin, destination, vertical connections on route,
 *     doors on route, current instruction landmark.
 */

import { calculateRoute, getAirportMap, getAirports, SkyGateApiError } from '../api/index.js';
import { APP_CONFIG } from '../config/appConfig.js';
import {
  INTERNAL_TYPES as _PRES_INTERNAL,
  VERTICAL_TYPES as _PRES_VERTICAL,
  CIRCULATION_TYPES,
  POI_TYPES as _PRES_POI,
  SEARCH_CATEGORIES,
  getTypeMeta,
  getPublicNodeLabel,
  getPublicNodeSubtitle,
  getPublicNodeCategory,
  getNodeSearchAliases,
  isNodeVisibleInDefaultSearch,
  isNodeVisibleInTextSearch,
  isNodeVisibleOnMap,
  getRouteLandmarkLabel,
  buildSearchText,
  runPresentationTests,
  getFloorLabel as _presFloorLabel,
} from '../services/nodePresentation.js';

/* ============================================================
   1. CONSTANTS
   ============================================================ */

const FORTALEZA_SLUG = 'fortaleza';
const MAX_RESULTS    = 40;
const DEBOUNCE_MS    = 200;
const MIN_SCALE      = 0.25;
const MAX_SCALE      = 8;
const ROUTE_ANIM_MS  = 400; // route draw animation duration

const FLOOR_LABELS = { '0': 'Térreo', '1': 'Piso 1', '2': 'Piso 2', '3': 'Piso 3' };

// ── Presentation layer re-exports (single source of truth) ──
const POI_TYPES       = _PRES_POI;
const INTERNAL_TYPES  = _PRES_INTERNAL;
const VERTICAL_TYPES  = _PRES_VERTICAL;

/** Types shown on map during navigation — route-relevant only */
const NAV_VISIBLE_TYPES = new Set([
  'elevator', 'stairs', 'escalator', 'entrance', 'exit', 'gate',
]);

/** Delegate to presentation module — keeps a single metadata source */
function getNodeMeta(type) {
  const m = getTypeMeta(type);
  // Map presentation fields to legacy field names used inside app.js
  return { label: m.publicType, icon: m.icon, color: m.color, group: m.publicType.toUpperCase() };
}

/* ============================================================
   2. STATE
   ============================================================ */

/** App mode drives the entire layout */
let appMode = 'planning'; // 'planning' | 'summary' | 'navigation'

const planState = {
  originCode: '',
  destinationCode: '',
  routeMode: 'fastest',       // 'fastest' | 'accessible'
  accessibleRoute: false,     // compact toggle — replaces the two big mode cards
};

const navState = {
  route: null,          // normalized route
  semanticSteps: [],    // { text, icon, nodeType, isTransition, floorId, rawFrom, rawTo }
  activeStepIndex: 0,
  routeFloorIds: new Set(),
};

const mapState = {
  selectedFloorId: '',
  floorTransforms: {},  // { floorId: { x, y, scale } }
  svgBaseCache: {},     // { floorId: svgString } — never rebuilt
  manualFloor: false,
};

const uiState = {
  loading: '',          // 'airports'|'map'|'route'|''
  error: '',
  searchOpenFor: '',    // 'origin'|'destination'|''
  searchQuery: '',
  searchCategory: '',   // SEARCH_CATEGORIES key or '' — active quick-filter chip
  showOverview: false,
  modalNodeCode: '',
  floorMenuOpen: false,
  routeAnimating: false,
};

const appData = {
  airport: null,
  floors: [],
  nodes: [],
};

/* ============================================================
   3. HELPERS
   ============================================================ */

function asArray(v) {
  if (Array.isArray(v)) return v;
  if (Array.isArray(v?.items)) return v.items;
  if (Array.isArray(v?.data)) return v.data;
  if (Array.isArray(v?.airports)) return v.airports;
  if (Array.isArray(v?.nodes)) return v.nodes;
  return [];
}

function first(...vals) {
  return vals.find(v => v !== undefined && v !== null && v !== '');
}

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

function norm(v) {
  return String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

function fmtMin(m) { return String(Math.max(1, Math.round(Number(m) || 0))); }

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function getFloorLabel(id) {
  const s = String(id ?? '');
  return FLOOR_LABELS[s] ?? appData.floors.find(f => f.id === s)?.name ?? `Piso ${s}`;
}



function getAirportSlug(a) {
  return first(a?.slug, a?.code, a?.id, FORTALEZA_SLUG);
}

function findNode(code) {
  return appData.nodes.find(n => n.code === code) ?? null;
}

function getModeLabel(m) {
  return m === 'accessible' ? 'Acessível' : 'Mais rápida';
}

function getFloorTransform(fid) {
  return mapState.floorTransforms[fid] ?? { x: 0, y: 0, scale: 1 };
}

function prefersReducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

const $ = id => document.getElementById(id);

/* ============================================================
   4. DATA NORMALIZATION
   ============================================================ */

function normalizeMap(raw) {
  const rawNodes = asArray(raw?.nodes ?? raw?.points ?? raw?.data?.nodes);

  const nodes = rawNodes.map((r, i) => {
    const code    = String(first(r?.node_code, r?.code, r?.id, `n${i}`));
    const floorId = String(first(r?.floor, r?.floor_id, r?.level, '0'));
    const type    = String(first(r?.type, r?.category, r?.kind, 'waypoint')).toLowerCase();
    const name    = first(r?.display_name, r?.name, r?.label, r?.title, code);
    const nodeShell = { code, floorId, type, name,
      isPoi: POI_TYPES.has(type) && !INTERNAL_TYPES.has(type),
      isInternal: INTERNAL_TYPES.has(type),
      isVertical: VERTICAL_TYPES.has(type),
      x: Number(first(r?.x, r?.position_x, 0)),
      y: Number(first(r?.y, r?.position_y, 0)),
      image:   first(r?.image_url,  r?.photo,    r?.image,   ''),
      logo:    first(r?.logo_url,   r?.logo,     ''),
      phone:   first(r?.phone,      r?.contact_phone, ''),
      website: first(r?.website,    r?.url,      ''),
      hours:   first(r?.opening_hours, r?.hours, ''),
      description: first(r?.description, ''),
    };
    // searchText is built from presentation layer (aliases + public label)
    nodeShell.searchText = buildSearchText(nodeShell);
    return nodeShell;
  });

  const floorIds = [...new Set(
    rawNodes.map(n => String(n?.floor ?? '')).filter(Boolean)
  )].sort();

  const floors = (floorIds.length ? floorIds
    : [...new Set(nodes.map(n => n.floorId))].sort()
  ).map(id => ({ id, name: FLOOR_LABELS[id] ?? `Piso ${id}` }));

  return { floors, nodes };
}

function normalizeRoute(raw) {
  const rawSegs = raw?.floor_segments ?? raw?.floorSegments;
  let segments = Array.isArray(rawSegs)
    ? rawSegs.map(normalizeSeg).filter(Boolean)
    : [];
  const path = extractCodes(raw);
  if (!segments.length && path.length) segments = buildSegments(path);
  const rawSteps = asArray(raw?.steps ?? raw?.instructions ?? raw?.directions);
  const steps = rawSteps.map((s, i) => normalizeStep(s, i));
  const estimatedMinutes = Number(first(raw?.total_estimated_time_minutes, raw?.estimated_time_minutes, 0));
  return {
    raw, estimatedMinutes: Number.isFinite(estimatedMinutes) ? estimatedMinutes : 0,
    path, segments, steps, warnings: asArray(raw?.warnings),
  };
}

function normalizeSeg(s) {
  if (!s || typeof s !== 'object') return null;
  if (s.transition && typeof s.transition === 'object') {
    return {
      type: 'transition',
      transitionType: String(first(s.transition.type, 'transition')),
      fromFloor: String(first(s.transition.from_floor, s.transition.fromFloor, '')),
      toFloor:   String(first(s.transition.to_floor,   s.transition.toFloor,   '')),
    };
  }
  const floorId = String(first(s?.floor, s?.floor_id, s?.level, ''));
  if (!floorId) return null;
  return { type: 'floor', floorId, nodeCodes: extractCodes(s) };
}

function normalizeStep(step, index) {
  if (typeof step === 'string') return { index, text: step, floorId: '', isTransition: false };
  const text = String(first(step?.instruction, step?.text, step?.title, step?.description, 'Siga.'));
  const floorId = String(first(step?.floor, step?.floor_id, step?.level, ''));
  const isTransition = !!(step?.transition || step?.transition_type || /elev|escad|suba|desc/i.test(text));
  return { index, text, floorId, isTransition };
}

function extractCodes(src) {
  const cands = first(src?.node_codes, src?.nodeCodes, src?.path_node_codes,
    src?.pathNodeCodes, src?.path, src?.nodes, []);
  return asArray(cands).map(item => {
    if (typeof item === 'string' || typeof item === 'number') return String(item);
    return String(first(item?.code, item?.node_code, ''));
  }).filter(Boolean);
}

function buildSegments(codes) {
  const groups = [];
  codes.forEach(code => {
    const n = findNode(code);
    const fid = n?.floorId ?? mapState.selectedFloorId;
    const last = groups[groups.length - 1];
    if (!last || last.floorId !== fid) groups.push({ type: 'floor', floorId: fid, nodeCodes: [] });
    groups[groups.length - 1].nodeCodes.push(code);
  });
  return groups;
}

/* ============================================================
   5. SEMANTIC STEP BUILDER v3
   ============================================================ */

function buildSemanticSteps(route) {
  const { path, segments } = route;
  const accessible = planState.routeMode === 'accessible';
  return path.length ? buildFromPath(path, accessible) : buildFromSteps(route.steps, accessible);
}

function classifyNode(node) {
  if (!node) return 'internal';
  if (VERTICAL_TYPES.has(node.type)) return 'vertical';
  if (INTERNAL_TYPES.has(node.type)) return 'internal';
  if (node.isPoi) return 'named_poi';
  return 'internal';
}

function buildFromPath(path, accessible) {
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

function buildFromSteps(steps, accessible) {
  if (!steps.length) return [];
  const semantic = [];
  let buf = [];

  const flush = () => {
    if (!buf.length) return;
    const trans = buf.find(s => s.isTransition);
    if (trans) {
      const t = cleanStepText(trans.text);
      if (t) semantic.push({ text: t, isTransition: true, floorId: trans.floorId, toFloor: trans.floorId, icon: 'solar:elevator-bold', nodeType: 'elevator', rawFrom: 0, rawTo: 0, landmarkCode: null });
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
    if (step.isTransition) { flush(); const t = cleanStepText(step.text); if (t) semantic.push({ text: t, isTransition: true, floorId: step.floorId, toFloor: step.floorId, icon: 'solar:elevator-bold', nodeType: 'elevator', rawFrom: 0, rawTo: 0, landmarkCode: null }); return; }
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

const INTERNAL_TEXT_PATTERNS = [
  /siga\s+at[eé]\s+(o\s+)?(corredor|waypoint|transi[cç][aã]o|passarela|n[oó])/i,
  /\bcorredor\s+[a-z\d]/i,
  /\btransi[cç][aã]o\s+passarela/i,
  /\bwaypoint\b/i,
  /\bpassarela\s+\d/i,
];

function isInternalText(t) { return INTERNAL_TEXT_PATTERNS.some(re => re.test(t)); }

function cleanStepText(raw) {
  if (!raw) return '';
  let t = raw.replace(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+){2,}\b/g, '').replace(/\s{2,}/g, ' ').replace(/^[,;\s]+|[,;\s]+$/g, '').trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : '';
}

/* ============================================================
   5b. WALKING DISTANCE — measured along the route path

   Node coordinates are abstract map units; APP_CONFIG.distance.metersPerUnit
   converts them to metres. Nothing here is hardcoded per route.
   ============================================================ */

function segmentMeters(a, b) {
  if (!a || !b) return 0;
  return Math.hypot(b.x - a.x, b.y - a.y) * APP_CONFIG.distance.metersPerUnit;
}

/** Total walking distance between two indices of the route path. */
function pathMeters(path, fromIdx, toIdx) {
  const start = clamp(fromIdx, 0, path.length - 1);
  const end   = clamp(toIdx,   0, path.length - 1);
  let total = 0;
  for (let i = start; i < end; i++) {
    total += segmentMeters(findNode(path[i]), findNode(path[i + 1]));
  }
  return total;
}

function roundMeters(m) {
  const grid = APP_CONFIG.distance.roundToMeters;
  if (!(m > 0)) return 0;
  return Math.max(grid, Math.round(m / grid) * grid);
}

function formatMeters(m) {
  const r = roundMeters(m);
  if (!r) return '';
  return r >= 1000 ? `${(r / 1000).toFixed(1).replace('.', ',')} km` : `${r} m`;
}

/**
 * Attach `distanceMeters` to each semantic step: the distance walked from
 * that step's own path position up to where the next step begins.
 */
function attachStepDistances(steps, path) {
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
function countFloorChanges() {
  return navState.semanticSteps.filter(
    s => s.isTransition && s.toFloor && s.toFloor !== s.floorId
  ).length;
}

/* ============================================================
   5c. NAVIGATION ICON SET — inline SVG

   The navigation screen uses inline SVG (not iconify) so the glyphs match
   the reference design exactly and can never fail to resolve. The rest of
   the app keeps using <iconify-icon>.
   ============================================================ */

const NAV_ICON_BODIES = {
  plane:      { fill: true,  body: '<path d="M12 2c.83 0 1.5.9 1.5 2.05v5.2l7.5 4.32v2.06l-7.5-2.2v4.42l2.6 1.9v1.6L12 20.4l-4.1.95v-1.6l2.6-1.9v-4.42l-7.5 2.2v-2.06l7.5-4.32v-5.2C10.5 2.9 11.17 2 12 2z"/>' },
  pin:        { fill: true,  body: '<path d="M12 2.2c-3.87 0-7 3.13-7 7 0 5.14 6.28 12.2 6.55 12.5.24.27.66.27.9 0 .27-.3 6.55-7.36 6.55-12.5 0-3.87-3.13-7-7-7zm0 9.55a2.55 2.55 0 1 1 0-5.1 2.55 2.55 0 0 1 0 5.1z"/>' },
  layers:     { fill: false, body: '<path d="M12 3.2 3.4 7.4 12 11.6l8.6-4.2L12 3.2z"/><path d="m3.4 12.2 8.6 4.2 8.6-4.2"/><path d="m3.4 16.8 8.6 4.2 8.6-4.2"/>' },
  navigate:   { fill: true,  body: '<path d="M20.9 3.1 4.3 10.2c-1.05.45-.9 1.98.2 2.24l6.6 1.55 1.55 6.6c.26 1.1 1.8 1.25 2.24.2l7.1-16.6c.36-.85-.5-1.7-1.1-1.09z"/>' },
  clock:      { fill: false, body: '<circle cx="12" cy="12" r="8.8"/><path d="M12 6.9V12l3.5 2.1"/>' },
  stairs:     { fill: false, body: '<path d="M3.6 19.4h4.2v-3.6H12v-3.6h4.2V8.6h4.2"/><path d="M7.8 19.4v-3.6M12 15.8v-3.6M16.2 12.2V8.6"/>' },
  turnRight:  { fill: false, body: '<path d="M6.4 20.2v-7.1a4.2 4.2 0 0 1 4.2-4.2h6.6"/><path d="m13.9 5.2 3.9 3.7-3.9 3.7"/>' },
  turnLeft:   { fill: false, body: '<path d="M17.6 20.2v-7.1a4.2 4.2 0 0 0-4.2-4.2H6.8"/><path d="m10.1 5.2-3.9 3.7 3.9 3.7"/>' },
  arrowUp:    { fill: false, body: '<path d="M12 20.2V4.6"/><path d="m5.4 11.2 6.6-6.6 6.6 6.6"/>' },
  wheelchair: { fill: false, body: '<circle cx="12.4" cy="4.4" r="2.1"/><path d="M11.1 8.2v5.1h5l3.1 6.1"/><path d="M14.6 13.9a5.6 5.6 0 1 1-6.7-4.6"/>' },
  list:       { fill: false, body: '<path d="M9.2 6.2h11M9.2 12h11M9.2 17.8h11"/><path d="M4.4 6.2h.02M4.4 12h.02M4.4 17.8h.02" stroke-width="3"/>' },
  chevron:    { fill: false, body: '<path d="m9.4 5.2 6.8 6.8-6.8 6.8"/>' },
  person:     { fill: true,  body: '<path d="M12 12.1a4.05 4.05 0 1 0 0-8.1 4.05 4.05 0 0 0 0 8.1zm0 1.9c-4.05 0-7.1 2.25-7.1 5.05V20h14.2v-.95c0-2.8-3.05-5.05-7.1-5.05z"/>' },
};

/** Inline SVG icon for the navigation screen. */
function navIcon(name, extraClass = '') {
  const def = NAV_ICON_BODIES[name];
  if (!def) return '';
  const paint = def.fill
    ? 'fill="currentColor" stroke="none"'
    : 'fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round"';
  return `<svg class="sg-ico ${extraClass}" viewBox="0 0 24 24" ${paint} aria-hidden="true" focusable="false">${def.body}</svg>`;
}

/** Pick the directional glyph that matches a step's instruction. */
function getStepIconName(step) {
  if (!step) return 'arrowUp';
  if (step.isTransition) return 'stairs';
  if (/\bdireita\b/i.test(step.text)) return 'turnRight';
  if (/\besquerda\b/i.test(step.text)) return 'turnLeft';
  return 'arrowUp';
}

/* ============================================================
   6. FLOOR MAP BUILDER — Clean semantic map (no technical nodes)

   Visual design (navigation theme):
   - Dark slate background, terminal body slightly lighter
   - Rendered in perspective via CSS on the base layer
   - Zone clusters: barely-there light tints
   - No corridor dots, no waypoint circles, no internal labels
   ============================================================ */

const MAP_W = 900, MAP_H = 600;
const MAP_PAD = 48; // internal padding

function getFloorBounds(floorId) {
  const ns = appData.nodes.filter(n => n.floorId === floorId && (n.x || n.y));
  if (!ns.length) return { minX: 0, maxX: 100, minY: 0, maxY: 100, w: 100, h: 100 };
  const xs = ns.map(n => n.x), ys = ns.map(n => n.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  return { minX, maxX, minY, maxY, w: maxX - minX || 1, h: maxY - minY || 1 };
}

function nodeToSvg(node, bounds) {
  return {
    x: MAP_PAD + ((node.x - bounds.minX) / bounds.w) * (MAP_W - MAP_PAD * 2),
    y: MAP_PAD + ((node.y - bounds.minY) / bounds.h) * (MAP_H - MAP_PAD * 2),
  };
}

/**
 * Build the BASE floor SVG — terminal shape + zone areas.
 * This NEVER shows corridor/waypoint nodes.
 * Cached per floorId — rebuilt only when floor data changes.
 */
function buildBaseFloorSvg(floorId) {
  const allNodes = appData.nodes.filter(n => n.floorId === floorId);
  if (!allNodes.length) {
    return `<svg viewBox="0 0 ${MAP_W} ${MAP_H}" class="sg-map-svg sg-map-base" aria-hidden="true"><rect width="${MAP_W}" height="${MAP_H}" fill="#16263a"/></svg>`;
  }

  const bounds = getFloorBounds(floorId);
  const toSvg  = n => nodeToSvg(n, bounds);

  // Terminal outline — hull from all nodes + generous padding
  const termPad = 60;
  const allPts   = allNodes.map(toSvg);
  const xs = allPts.map(p => p.x), ys = allPts.map(p => p.y);
  const tX = Math.min(...xs) - termPad;
  const tY = Math.min(...ys) - termPad;
  const tW = Math.max(...xs) - Math.min(...xs) + termPad * 2;
  const tH = Math.max(...ys) - Math.min(...ys) + termPad * 2;

  // Zone clusters — group POI nodes by area (x-quartile)
  const poiNodes = allNodes.filter(n => n.isPoi && !n.isInternal);
  const zoneColors = [
    'rgba(255,255,255,0.045)',
    'rgba(148,190,255,0.035)',
    'rgba(255,255,255,0.03)',
    'rgba(45,212,191,0.035)',
  ];

  // Divide into 4 x-bands
  const xRange = bounds.w / 4;
  const zones = Array.from({ length: 4 }, (_, qi) => {
    const band = poiNodes.filter(n => {
      const relX = n.x - bounds.minX;
      return relX >= qi * xRange && relX < (qi + 1) * xRange;
    });
    if (band.length < 2) return null;
    const pts = band.map(toSvg);
    const bxs = pts.map(p => p.x), bys = pts.map(p => p.y);
    const zPad = 28;
    return {
      x: Math.min(...bxs) - zPad, y: Math.min(...bys) - zPad,
      w: Math.max(...bxs) - Math.min(...bxs) + zPad * 2,
      h: Math.max(...bys) - Math.min(...bys) + zPad * 2,
      fill: zoneColors[qi],
    };
  }).filter(Boolean);

  // Vertical connection symbols (elevator, stairs, escalator) — shown always as small icons
  const verticals = allNodes.filter(n => n.isVertical);

  // Gate labels — show gate codes only (these are meaningful to passengers)
  const gates = allNodes.filter(n => n.type === 'gate');

  return `<svg
    viewBox="0 0 ${MAP_W} ${MAP_H}"
    class="sg-map-svg sg-map-base"
    aria-hidden="true"
    style="overflow:visible"
  >
    <!-- Background -->
    <rect width="${MAP_W}" height="${MAP_H}" fill="#16263a"/>

    <!-- Terminal body -->
    <rect x="${tX.toFixed(1)}" y="${tY.toFixed(1)}" width="${tW.toFixed(1)}" height="${tH.toFixed(1)}"
      rx="24" fill="#20344c" stroke="rgba(255,255,255,0.10)" stroke-width="1.5"/>

    <!-- Zone areas -->
    ${zones.map(z =>
      `<rect x="${z.x.toFixed(1)}" y="${z.y.toFixed(1)}" width="${z.w.toFixed(1)}" height="${z.h.toFixed(1)}" rx="14" fill="${z.fill}"/>`
    ).join('')}

    <!-- Zone divider lines (very subtle) -->
    ${Array.from({ length: 3 }, (_, i) => {
      const baseX = MAP_PAD + ((i + 1) * xRange / bounds.w) * (MAP_W - MAP_PAD * 2);
      return `<line x1="${baseX.toFixed(1)}" y1="${(tY + 20).toFixed(1)}" x2="${baseX.toFixed(1)}" y2="${(tY + tH - 20).toFixed(1)}" stroke="rgba(255,255,255,0.14)" stroke-width="1" stroke-dasharray="4 6"/>`;
    }).join('')}

    <!-- Vertical connections (always visible — passengers rely on these) -->
    ${verticals.map(n => {
      const p = toSvg(n);
      const meta = getNodeMeta(n.type);
      const symFill = 'rgba(255,255,255,0.10)';
      const symStroke = n.type === 'elevator' ? '#f0b866' : '#7fe3d3';
      const sym = n.type === 'elevator' ? '▲' : n.type === 'escalator' ? '≡' : '╱';
      // aria-label uses public label — never raw node name
      return `<g aria-label="${esc(getPublicNodeLabel(n))}">
        <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="9" fill="${symFill}" stroke="${symStroke}" stroke-width="1.5"/>
        <text x="${p.x.toFixed(1)}" y="${p.y.toFixed(1)}" dy="0.37em" text-anchor="middle" font-size="8" fill="${symStroke}" font-family="system-ui">${sym}</text>
      </g>`;
    }).join('')}

    <!-- Gate labels (meaningful to passengers) -->
    ${gates.map(n => {
      const p = toSvg(n);
      const label = n.name.replace(/Portão\s*/i, '').trim() || n.name;
      return `<g aria-label="Portão ${esc(label)}">
        <rect x="${(p.x - 14).toFixed(1)}" y="${(p.y - 8).toFixed(1)}" width="28" height="16" rx="4" fill="rgba(255,255,255,0.13)"/>
        <text x="${p.x.toFixed(1)}" y="${p.y.toFixed(1)}" dy="0.37em" text-anchor="middle" font-size="7.5" fill="rgba(255,255,255,0.72)" font-family="Inter,system-ui" font-weight="700">${esc(label.length > 6 ? label.slice(0, 6) : label)}</text>
      </g>`;
    }).join('')}

    <!-- Floor label watermark -->
    <text x="${(MAP_W / 2).toFixed(1)}" y="${(tY + tH - 14).toFixed(1)}" text-anchor="middle" font-size="11" fill="rgba(255,255,255,0.22)" font-family="Inter,system-ui" font-weight="600" aria-hidden="true">${esc(getFloorLabel(floorId))}</text>
  </svg>`;
}

/** Teardrop map pin whose tip sits exactly on (x, y). */
function mapPin(x, y, innerFill = '#0f2540', pinFill = '#ffffff') {
  return `<g transform="translate(${x.toFixed(1)},${y.toFixed(1)})">
    <path d="M0 0c-6.6-9.2-11.2-14.5-11.2-19.8a11.2 11.2 0 0 1 22.4 0C11.2-14.5 6.6-9.2 0 0z"
      fill="${pinFill}" stroke="rgba(9,24,42,0.28)" stroke-width="0.8"/>
    <circle cy="-19.8" r="4.8" fill="${innerFill}"/>
  </g>`;
}

/**
 * Dark rounded caption box beside a marker. `side` is the preferred side;
 * it flips automatically when the box would fall outside the map viewBox.
 */
function mapLabel(x, y, lines, side = 'right', gap = 15) {
  const padX = 12, lineH = 17, boxPadY = 9;
  const widest = Math.max(...lines.map(l => l.length));
  const w = widest * 6.85 + padX * 2;
  const h = lines.length * lineH + boxPadY * 2;

  const fitsRight = x + gap + w <= MAP_W;
  const fitsLeft  = x - gap - w >= 0;
  const placeRight = side === 'right' ? (fitsRight || !fitsLeft) : !(fitsLeft || !fitsRight);

  const bx = clamp(placeRight ? x + gap : x - gap - w, 2, MAP_W - w - 2);
  const by = clamp(y - h / 2, 2, MAP_H - h - 2);
  return `<g>
    <rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}"
      rx="9" fill="#0e2136" opacity="0.93"/>
    ${lines.map((l, i) => `<text x="${(bx + padX).toFixed(1)}"
      y="${(by + boxPadY + lineH * i + lineH / 2).toFixed(1)}" dy="0.35em"
      font-family="Inter,system-ui" font-size="12.5"
      font-weight="${i === 0 ? 700 : 500}"
      fill="${i === 0 ? '#ffffff' : 'rgba(255,255,255,0.72)'}">${esc(l)}</text>`).join('')}
  </g>`;
}

/**
 * Build the ROUTE OVERLAY SVG — shown over the base map.
 * Updated per step without touching the base.
 * Filters: only show origin, dest, doors/elevators ON route, current landmark.
 */
function buildRouteOverlaySvg(floorId) {
  const route = navState.route;
  if (!route) return '<svg class="sg-map-svg sg-map-route" aria-hidden="true"></svg>';

  const bounds    = getFloorBounds(floorId);
  const toSvg     = n => nodeToSvg(n, bounds);
  const routeColor = planState.routeMode === 'accessible' ? '#0d9488' : '#14b8a6';
  const path      = route.path;

  // Get floor-specific codes from segments
  const seg = route.segments?.find(s => s.type === 'floor' && s.floorId === floorId);
  const floorCodes = seg?.nodeCodes?.length ? seg.nodeCodes
    : path.filter(c => findNode(c)?.floorId === floorId);

  if (!floorCodes.length) {
    return `<svg viewBox="0 0 ${MAP_W} ${MAP_H}" class="sg-map-svg sg-map-route" aria-hidden="true"></svg>`;
  }

  // Step range partitioning for coloring
  const stepIdx = navState.activeStepIndex;
  const steps   = navState.semanticSteps;
  const curStep = steps[stepIdx];

  // Partition codes by step state (completed/active/upcoming)
  const floorPathIndices = floorCodes.map(c => path.indexOf(c)).filter(i => i >= 0);
  const minFloorIdx = Math.min(...floorPathIndices);
  const maxFloorIdx = Math.max(...floorPathIndices);

  const activeFrom = curStep?.rawFrom ?? 0;
  const activeTo   = curStep?.rawTo   ?? path.length - 1;

  const getStatus = (pathIdx) => {
    if (pathIdx < activeFrom) return 'completed';
    if (pathIdx <= activeTo)  return 'active';
    return 'upcoming';
  };

  const completedPts = [], activePts = [], upcomingPts = [];
  floorCodes.forEach(code => {
    const pi = path.indexOf(code);
    if (pi < 0) return;
    const n = findNode(code);
    if (!n) return;
    const p = toSvg(n);
    const st = getStatus(pi);
    if (st === 'completed') completedPts.push(p);
    else if (st === 'active') activePts.push(p);
    else upcomingPts.push(p);
  });

  const poly = pts => pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');

  // Determine which nodes to show as markers (strict filtering)
  const routeSet = new Set(floorCodes);
  const originNode = findNode(planState.originCode);
  const destNode   = findNode(planState.destinationCode);
  const showOrigin = originNode?.floorId === floorId;
  const showDest   = destNode?.floorId   === floorId;

  // Visible landmarks: only vertical connections + doors/entrances ON the route
  const visibleLandmarks = appData.nodes.filter(n =>
    n.floorId === floorId &&
    routeSet.has(n.code) &&
    NAV_VISIBLE_TYPES.has(n.type) &&
    n.code !== planState.originCode &&
    n.code !== planState.destinationCode
  );

  // Current instruction landmark
  const curLandmark = curStep?.landmarkCode ? findNode(curStep.landmarkCode) : null;
  const showCurLandmark = curLandmark?.floorId === floorId && curLandmark?.code !== planState.destinationCode;

  // Glow stack: wide blurred halo → solid stroke → hot white core.
  const glowLine = (pts, { width = 4.6, opacity = 1, dash = '', cls = '' }) => `
    <polyline points="${poly(pts)}" fill="none" stroke="${routeColor}"
      stroke-width="${width * 2.6}" stroke-linecap="round" stroke-linejoin="round"
      opacity="${(0.34 * opacity).toFixed(2)}" filter="url(#sgRouteGlow)"/>
    <polyline points="${poly(pts)}" fill="none" stroke="${routeColor}"
      stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"
      opacity="${opacity}" ${dash ? `stroke-dasharray="${dash}"` : ''} ${cls ? `class="${cls}"` : ''}/>
    <polyline points="${poly(pts)}" fill="none" stroke="#ecfffb"
      stroke-width="${width * 0.36}" stroke-linecap="round" stroke-linejoin="round"
      opacity="${(0.9 * opacity).toFixed(2)}"/>`;

  // Which points anchor the "you are here" / waypoint / destination markers
  const originPt = showOrigin ? toSvg(originNode) : null;
  const destPt   = showDest   ? toSvg(destNode)   : null;

  return `<svg
    viewBox="0 0 ${MAP_W} ${MAP_H}"
    class="sg-map-svg sg-map-route"
    aria-hidden="true"
    style="overflow:visible"
  >
    <defs>
      <filter id="sgRouteGlow" x="-60%" y="-60%" width="220%" height="220%">
        <feGaussianBlur stdDeviation="7" result="blur"/>
        <feMerge>
          <feMergeNode in="blur"/>
          <feMergeNode in="blur"/>
        </feMerge>
      </filter>
    </defs>

    <!-- Completed route (dimmed, already walked) -->
    ${completedPts.length > 1 ? glowLine(completedPts, { width: 3.6, opacity: 0.38 }) : ''}

    <!-- Upcoming route -->
    ${upcomingPts.length > 1 ? glowLine(upcomingPts, { width: 4, opacity: 0.72 }) : ''}

    <!-- Active route segment (dominant) -->
    ${activePts.length > 1 ? glowLine(activePts, { width: 5, opacity: 1, cls: 'sg-route-active' })
      : activePts.length === 1 ? `
      <circle cx="${activePts[0].x.toFixed(1)}" cy="${activePts[0].y.toFixed(1)}" r="6" fill="${routeColor}" stroke="#ecfffb" stroke-width="2"/>
    ` : ''}

    <!-- Full route fallback (no step data) -->
    ${(!completedPts.length && !activePts.length && !upcomingPts.length && floorCodes.length > 1) ? (() => {
      const allPts = floorCodes.map(c => { const n = findNode(c); return n ? toSvg(n) : null; }).filter(Boolean);
      return allPts.length > 1 ? glowLine(allPts, { width: 5, opacity: 1, cls: 'sg-route-active' }) : '';
    })() : ''}

    <!-- Route-relevant landmarks (vertical connections, doors on route) -->
    ${visibleLandmarks.map(n => {
      const p = toSvg(n);
      return `<g aria-label="${esc(getPublicNodeLabel(n))}">
        <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="6.5" fill="#ffffff" stroke="${routeColor}" stroke-width="2"/>
        <circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3" fill="${routeColor}"/>
      </g>`;
    }).join('')}

    <!-- Current step landmark: pin + floating caption -->
    ${showCurLandmark && curLandmark ? (() => {
      const p = toSvg(curLandmark);
      const label = getPublicNodeLabel(curLandmark);
      return `<g aria-label="Ponto atual: ${esc(label)}">
        ${mapPin(p.x, p.y, routeColor)}
        ${mapLabel(p.x, p.y - 20, [label], 'right')}
      </g>`;
    })() : ''}

    <!-- Destination pin + caption -->
    ${destPt ? (() => {
      const destLabel = getPublicNodeLabel(destNode);
      return `<g aria-label="Destino: ${esc(destLabel)}">
        <circle cx="${destPt.x.toFixed(1)}" cy="${destPt.y.toFixed(1)}" r="7" fill="${routeColor}" opacity="0.55" filter="url(#sgRouteGlow)"/>
        ${mapPin(destPt.x, destPt.y, '#0f2540')}
        ${mapLabel(destPt.x, destPt.y - 22, [destLabel, 'Seu destino'], 'right')}
      </g>`;
    })() : ''}

    <!-- "Você está aqui": white puck, person glyph, pulsing dashed ring -->
    ${originPt ? (() => {
      const label = getPublicNodeLabel(originNode);
      return `<g aria-label="Você está aqui: ${esc(label)}">
        <circle cx="${originPt.x.toFixed(1)}" cy="${originPt.y.toFixed(1)}" r="26"
          fill="none" stroke="${routeColor}" stroke-width="2" stroke-dasharray="6 6"
          class="sg-here-ring" style="transform-origin:${originPt.x.toFixed(1)}px ${originPt.y.toFixed(1)}px"/>
        <circle cx="${originPt.x.toFixed(1)}" cy="${originPt.y.toFixed(1)}" r="20" fill="${routeColor}" opacity="0.45" filter="url(#sgRouteGlow)"/>
        <circle cx="${originPt.x.toFixed(1)}" cy="${originPt.y.toFixed(1)}" r="15" fill="#ffffff" stroke="${routeColor}" stroke-width="3"/>
        <g transform="translate(${(originPt.x - 9).toFixed(1)},${(originPt.y - 9).toFixed(1)}) scale(0.75)" fill="#0f2540">
          ${NAV_ICON_BODIES.person.body}
        </g>
        ${mapLabel(originPt.x, originPt.y - 18, ['Você está aqui', label], 'left', 32)}
      </g>`;
    })() : ''}
  </svg>`;
}

function getBaseFloorSvg(floorId) {
  if (!mapState.svgBaseCache[floorId]) {
    mapState.svgBaseCache[floorId] = buildBaseFloorSvg(floorId);
  }
  return mapState.svgBaseCache[floorId];
}

/* ============================================================
   7. MAP AUTO-FIT
   ============================================================ */

function fitStepToView(stepIndex) {
  if (!navState.route) return;
  const step = navState.semanticSteps[stepIndex];
  if (!step) return;
  const path  = navState.route.path;
  const from  = step.rawFrom ?? 0;
  const to    = step.rawTo   ?? path.length - 1;
  const codes = path.slice(from, to + 1);
  const stepNodes = codes.map(c => findNode(c)).filter(n => n?.floorId === mapState.selectedFloorId);
  if (!stepNodes.length) return;

  const bounds = getFloorBounds(mapState.selectedFloorId);
  const toSvgFn = n => nodeToSvg(n, bounds);
  const pts = stepNodes.map(toSvgFn);
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  const pad = 80;
  const bX1 = Math.min(...xs) - pad, bX2 = Math.max(...xs) + pad;
  const bY1 = Math.min(...ys) - pad, bY2 = Math.max(...ys) + pad;

  const wrapper = $('map-wrapper');
  if (!wrapper) return;
  const rect = wrapper.getBoundingClientRect();
  if (!rect.width || !rect.height) return;

  const scaleX = rect.width  / (bX2 - bX1);
  const scaleY = rect.height / (bY2 - bY1);
  const newScale = clamp(Math.min(scaleX, scaleY) * 0.9, MIN_SCALE, MAX_SCALE);
  const midX = (bX1 + bX2) / 2, midY = (bY1 + bY2) / 2;
  const nx = (MAP_W / 2 - midX) * newScale;
  const ny = (MAP_H / 2 - midY) * newScale;

  setTransform(nx, ny, newScale, prefersReducedMotion() ? 0 : 280);
}

function fitFullRoute() {
  if (!navState.route) return;
  const fid = mapState.selectedFloorId;
  const seg = navState.route.segments?.find(s => s.type === 'floor' && s.floorId === fid);
  const codes = seg?.nodeCodes ?? navState.route.path.filter(c => findNode(c)?.floorId === fid);
  const nodes = codes.map(c => findNode(c)).filter(Boolean);
  if (!nodes.length) return;

  const bounds = getFloorBounds(fid);
  const pts = nodes.map(n => nodeToSvg(n, bounds));
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
  // Asymmetric padding: pins rise above their anchor and captions sit beside
  // it, so the raw node bounds are not what actually has to fit on screen.
  const padL = 150, padR = 190, padT = 80, padB = 70;
  const bX1 = Math.min(...xs) - padL, bX2 = Math.max(...xs) + padR;
  const bY1 = Math.min(...ys) - padT, bY2 = Math.max(...ys) + padB;

  const wrapper = $('map-wrapper');
  if (!wrapper) return;
  const rect = wrapper.getBoundingClientRect();
  if (!rect.width || !rect.height) return;

  const scaleX = rect.width  / (bX2 - bX1);
  const scaleY = rect.height / (bY2 - bY1);
  const newScale = clamp(Math.min(scaleX, scaleY) * 0.96, MIN_SCALE, MAX_SCALE);
  const midX = (bX1 + bX2) / 2, midY = (bY1 + bY2) / 2;
  const nx = (MAP_W / 2 - midX) * newScale;
  const ny = (MAP_H / 2 - midY) * newScale;

  setTransform(nx, ny, newScale, prefersReducedMotion() ? 0 : 320);
}

/* ============================================================
   8. MAP PAN & ZOOM
   ============================================================ */

function applyMapTransform(duration = 0) {
  const wrapper = $('map-wrapper');
  if (!wrapper) return;
  const { x, y, scale } = getFloorTransform(mapState.selectedFloorId);
  const inner = wrapper.querySelector('.sg-map-inner');
  if (inner) {
    inner.style.transition = duration > 0 ? `transform ${duration}ms ease` : 'none';
    inner.style.transform = `translate(${x}px,${y}px) scale(${scale})`;
  }
}

function setTransform(x, y, scale, duration = 0) {
  const s = clamp(scale, MIN_SCALE, MAX_SCALE);
  mapState.floorTransforms[mapState.selectedFloorId] = { x, y, scale: s };
  applyMapTransform(duration);
}

function zoomAt(delta, cx, cy) {
  const t = getFloorTransform(mapState.selectedFloorId);
  const newScale = clamp(t.scale + delta, MIN_SCALE, MAX_SCALE);
  const factor = newScale / t.scale;
  const wrapper = $('map-wrapper');
  if (wrapper && cx !== undefined) {
    const rect = wrapper.getBoundingClientRect();
    const px = cx - rect.left - rect.width / 2;
    const py = cy - rect.top - rect.height / 2;
    setTransform(t.x - (factor - 1) * (px - t.x), t.y - (factor - 1) * (py - t.y), newScale);
  } else {
    setTransform(t.x, t.y, newScale);
  }
}

function resetTransform() {
  mapState.floorTransforms[mapState.selectedFloorId] = { x: 0, y: 0, scale: 1 };
  applyMapTransform(160);
}

let _panDragging = false, _panStart = { x: 0, y: 0, tx: 0, ty: 0 };
let _lastPinchDist = 0, _panHandlers = null;

function bindMapPan() {
  const area = $('map-area');
  if (!area) return;
  if (_panHandlers) {
    window.removeEventListener('mousemove', _panHandlers.mm);
    window.removeEventListener('mouseup',   _panHandlers.mu);
  }

  const isCtrl = e => e.target.closest('button,a,.sg-floor-ctrl,.sg-map-fab,.sg-instruction-card');

  const onMD = e => {
    if (e.button !== 0 || isCtrl(e)) return;
    _panDragging = true;
    const t = getFloorTransform(mapState.selectedFloorId);
    _panStart = { x: e.clientX, y: e.clientY, tx: t.x, ty: t.y };
    area.style.cursor = 'grabbing';
  };
  const onMM = e => {
    if (!_panDragging) return;
    const t = getFloorTransform(mapState.selectedFloorId);
    setTransform(_panStart.tx + e.clientX - _panStart.x, _panStart.ty + e.clientY - _panStart.y, t.scale);
  };
  const onMU = () => { _panDragging = false; area.style.cursor = ''; };

  _panHandlers = { mm: onMM, mu: onMU };
  area.addEventListener('mousedown', onMD);
  window.addEventListener('mousemove', onMM);
  window.addEventListener('mouseup', onMU);

  area.addEventListener('wheel', e => {
    if (isCtrl(e)) return;
    e.preventDefault();
    zoomAt(e.deltaY < 0 ? 0.3 : -0.3, e.clientX, e.clientY);
  }, { passive: false });

  area.addEventListener('touchstart', e => {
    if (isCtrl(e)) return;
    if (e.touches.length === 1) {
      const t = getFloorTransform(mapState.selectedFloorId);
      _panDragging = true;
      _panStart = { x: e.touches[0].clientX, y: e.touches[0].clientY, tx: t.x, ty: t.y };
    }
    if (e.touches.length === 2) {
      _panDragging = false;
      _lastPinchDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    }
  }, { passive: true });

  area.addEventListener('touchmove', e => {
    if (isCtrl(e)) return;
    if (e.touches.length === 1 && _panDragging) {
      const t = getFloorTransform(mapState.selectedFloorId);
      setTransform(_panStart.tx + e.touches[0].clientX - _panStart.x, _panStart.ty + e.touches[0].clientY - _panStart.y, t.scale);
    }
    if (e.touches.length === 2 && _lastPinchDist) {
      const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      const mid = { x: (e.touches[0].clientX + e.touches[1].clientX) / 2, y: (e.touches[0].clientY + e.touches[1].clientY) / 2 };
      zoomAt((d - _lastPinchDist) * 0.012, mid.x, mid.y);
      _lastPinchDist = d;
    }
  }, { passive: true });

  area.addEventListener('touchend', () => { _panDragging = false; _lastPinchDist = 0; });
}

/* ============================================================
   9. SEARCH HELPERS
   ============================================================ */

function filterNodes(q, exceptCode = '', categoryKey = '') {
  const t = q ? norm(q) : '';
  const cat = categoryKey ? SEARCH_CATEGORIES.find(c => c.key === categoryKey) : null;
  return appData.nodes
    .filter(n => {
      if (n.code === exceptCode) return false;
      if (INTERNAL_TYPES.has(n.type)) return false; // never surface technical corridor/waypoint/transition nodes
      // An active category chip is authoritative — it can surface circulation
      // types (elevator/stairs/escalator) that are hidden from the default,
      // query-less view. Otherwise fall back to the presentation layer's
      // text/default visibility rules.
      if (cat) return cat.types.includes(n.type);
      return t
        ? isNodeVisibleInTextSearch(n, t)
        : isNodeVisibleInDefaultSearch(n);
    })
    .slice(0, MAX_RESULTS);
}

function groupByCategory(nodes) {
  // Use presentation SEARCH_CATEGORIES for ordering + labels
  const map = new Map();
  nodes.forEach(n => {
    // Find the first category whose types include this node's type
    const cat = SEARCH_CATEGORIES.find(c => c.types.includes(n.type));
    const g = cat ? cat.label : getNodeMeta(n.type).group ?? 'Outros';
    if (!map.has(g)) map.set(g, []);
    map.get(g).push(n);
  });
  // Return groups in SEARCH_CATEGORIES order
  const ordered = new Map();
  SEARCH_CATEGORIES.forEach(cat => {
    if (map.has(cat.label)) ordered.set(cat.label, map.get(cat.label));
  });
  // Append any remaining groups (types not in SEARCH_CATEGORIES)
  map.forEach((v, k) => { if (!ordered.has(k)) ordered.set(k, v); });
  return ordered;
}

/* ============================================================
   10. RENDERERS
   ============================================================ */

// ---- PLANNING ----

function renderPlanning() {
  const oNode = findNode(planState.originCode);
  const dNode = findNode(planState.destinationCode);
  const isCalc   = uiState.loading === 'route';
  const same     = planState.originCode && planState.originCode === planState.destinationCode;
  const missing  = !planState.originCode || !planState.destinationCode;
  const disabled = missing || same || !!uiState.loading;
  const hint = same   ? 'Origem e destino devem ser diferentes.'
    : missing && planState.originCode      ? 'Selecione o destino também.'
    : missing && planState.destinationCode ? 'Selecione a origem também.'
    : '';
  const isAccessible = planState.accessibleRoute;
  const airportCity = appData.airport?.city ?? 'Fortaleza';
  const airportLabel = uiState.loading === 'airports' ? 'Conectando…' : `Aeroporto de ${airportCity}`;

  const QUICK_CATS = [
    { key:'gates',      label:'Portões',           icon:'solar:plain-bold',        subtitle:'Encontre seu portão'      },
    { key:'services',   label:'Check-in',           icon:'solar:bag-2-bold',        subtitle:'Balcões e áreas'          },
    { key:'food',       label:'Alimentação e lojas',icon:'solar:cup-hot-bold',      subtitle:'Restaurantes e compras'   },
    { key:'services',   label:'Serviços',           icon:'solar:bell-bold',         subtitle:'Facilidades do aeroporto' },
  ];

  // Journey rail filled state (both locations chosen)
  const railFilled = (oNode && dNode) ? ' is-filled' : '';

  // Floor + category pill shown under a selected origin/destination value
  const metaPill = (node) => !node ? '' : `<span class="sg-journey-field__meta">
    <iconify-icon icon="${getNodeMeta(node.type).icon}" aria-hidden="true"></iconify-icon>
    <span>${esc(getFloorLabel(node.floorId))} · ${esc(getPublicNodeCategory(node))}</span>
  </span>`;

  return `
    <div class="sg-planning" id="planning-root">

      <!-- ░░ DECORATIVE AIRPORT BACKGROUND ░░ -->
      <div class="sg-hero-bg" aria-hidden="true" role="presentation">
        <img
          src="assets/airport-lounge-hero.webp"
          alt=""
          class="sg-hero-bg__img"
          aria-hidden="true"
          loading="eager"
          fetchpriority="high"
          decoding="async"
        >
        <div class="sg-hero-bg__overlay" aria-hidden="true"></div>
      </div>

      <!-- ░░ BRAND UTILITY ROW ░░ -->
      <header class="sg-brandbar" role="banner">
        <div class="sg-brandbar__left">
          <span class="sg-brandbar__logo-tile" aria-hidden="true">
            <img src="assets/logo.png" alt="" class="sg-brandbar__logo">
          </span>
          <span class="sg-brandbar__wordmark">SkyGate</span>
        </div>
        <button
          type="button"
          class="sg-help-btn"
          id="help-btn"
          aria-label="Ajuda sobre o SkyGate"
        >
          <iconify-icon icon="solar:question-circle-bold" aria-hidden="true"></iconify-icon>
        </button>
      </header>

      <!-- ░░ AIRPORT CONTEXT (static — only Fortaleza supported) ░░ -->
      <div class="sg-airport-ctx" aria-label="Aeroporto de Fortaleza">
        <iconify-icon icon="solar:map-point-bold" class="sg-airport-ctx__icon" aria-hidden="true"></iconify-icon>
        <span class="sg-airport-ctx__text">FOR&nbsp;·&nbsp;${esc(airportLabel)}</span>
      </div>

      <!-- ░░ HEADING REGION ░░ -->
      <div class="sg-heading-region">
        <h1 class="sg-heading">Encontre<br>seu caminho</h1>
        <p class="sg-heading-sub">Escolha seu ponto de partida e destino.</p>
      </div>

      <!-- ░░ MAIN SCROLLABLE CONTENT ░░ -->
      <main class="sg-planning-main" id="planning-main">
        <div class="sg-planning-scroll">

          ${uiState.loading === 'airports' || uiState.loading === 'map' ? `
            <div class="sg-fullstate" role="status" aria-live="polite">
              <div class="sg-spinner"></div>
              <p>${uiState.loading === 'airports' ? 'Conectando ao aeroporto…' : 'Carregando dados…'}</p>
            </div>
          ` : uiState.error && !appData.floors.length ? `
            <div class="sg-fullstate sg-fullstate--error" role="alert">
              <iconify-icon icon="solar:danger-circle-bold" aria-hidden="true" style="font-size:40px;color:var(--red-600)"></iconify-icon>
              <p style="max-width:260px;line-height:1.5">${esc(uiState.error)}</p>
              <button type="button" class="sg-btn-primary" id="retry-btn" style="max-width:180px">Tentar novamente</button>
            </div>
          ` : `

            <!-- ░░ ROUTE COMPOSER SURFACE ░░ -->
            <div class="sg-composer">

              ${uiState.error ? `
              <div class="sg-form-error" role="alert">
                <iconify-icon icon="solar:danger-circle-bold" aria-hidden="true"></iconify-icon>
                <span>${esc(uiState.error)}</span>
                <button type="button" id="dismiss-error" aria-label="Fechar alerta">
                  <iconify-icon icon="solar:close-circle-bold" aria-hidden="true"></iconify-icon>
                </button>
              </div>` : ''}

              <!-- Journey rail + input fields + swap -->
              <div class="sg-journey sg-journey--composer" role="group" aria-label="Selecionar origem e destino">

                <!-- Decorative vertical journey rail (aria-hidden) -->
                <div class="sg-journey__rail${railFilled}" aria-hidden="true">
                  <span class="sg-journey__dot sg-journey__dot--origin"></span>
                  <span class="sg-journey__connector"></span>
                  <span class="sg-journey__dot sg-journey__dot--dest"></span>
                </div>

                <!-- Input fields -->
                <div class="sg-journey__fields">

                  <!-- Origin -->
                  <button type="button"
                    class="sg-journey-field open-search"
                    data-kind="origin"
                    id="origin-btn"
                    aria-label="${oNode ? `Ponto de partida: ${esc(getPublicNodeLabel(oNode))}. Toque para mudar` : 'Selecionar ponto de partida'}"
                    aria-haspopup="dialog">
                    <div class="sg-journey-field__inner">
                      <span class="sg-journey-field__label">Ponto de partida</span>
                      <span class="sg-journey-field__value${oNode ? '' : ' is-ph'}">
                        ${oNode ? esc(getPublicNodeLabel(oNode)) : 'Onde você está?'}
                      </span>
                      ${metaPill(oNode)}
                    </div>
                    ${oNode ? `<span class="sg-journey-clear clear-loc" data-kind="origin" id="clear-origin" role="button" tabindex="0" aria-label="Limpar ponto de partida">
                      <iconify-icon icon="solar:close-circle-bold" aria-hidden="true"></iconify-icon>
                    </span>` : ''}
                  </button>

                  <!-- Divider row with swap button centred on the line -->
                  <div class="sg-journey__divider" aria-hidden="true">
                    <div class="sg-journey__sep-line"></div>
                    <button type="button"
                      class="sg-journey__swap"
                      id="swap-btn"
                      aria-label="Inverter ponto de partida e destino"
                      ${!planState.originCode && !planState.destinationCode ? 'disabled' : ''}>
                      <iconify-icon icon="solar:round-sort-vertical-bold" aria-hidden="true"></iconify-icon>
                    </button>
                  </div>

                  <!-- Destination -->
                  <button type="button"
                    class="sg-journey-field open-search"
                    data-kind="destination"
                    id="destination-btn"
                    aria-label="${dNode ? `Destino: ${esc(getPublicNodeLabel(dNode))}. Toque para mudar` : 'Selecionar destino'}"
                    aria-haspopup="dialog">
                    <div class="sg-journey-field__inner">
                      <span class="sg-journey-field__label">Destino</span>
                      <span class="sg-journey-field__value${dNode ? '' : ' is-ph'}">
                        ${dNode ? esc(getPublicNodeLabel(dNode)) : 'Para onde deseja ir?'}
                      </span>
                      ${metaPill(dNode)}
                    </div>
                    ${dNode ? `<span class="sg-journey-clear clear-loc" data-kind="destination" id="clear-dest" role="button" tabindex="0" aria-label="Limpar destino">
                      <iconify-icon icon="solar:close-circle-bold" aria-hidden="true"></iconify-icon>
                    </span>` : ''}
                  </button>

                </div>
                <!-- /sg-journey__fields -->
              </div>
              <!-- /sg-journey -->

              <!-- Accessible route row -->
              <div class="sg-access-row sg-access-row--composer">
                <label class="sg-access-row__label" for="accessible-toggle">
                  <iconify-icon icon="solar:accessibility-bold" aria-hidden="true" class="sg-access-row__icon${isAccessible ? ' is-on' : ''}"></iconify-icon>
                  <div class="sg-access-row__text">
                    <span class="sg-access-row__title">Rota acessível</span>
                    <span class="sg-access-row__desc">Usa elevadores e evita escadas.</span>
                  </div>
                </label>
                <button type="button"
                  class="sg-toggle${isAccessible ? ' is-on' : ''}"
                  id="accessible-toggle"
                  role="switch"
                  aria-checked="${isAccessible}"
                  aria-label="Ativar rota acessível">
                  <span class="sg-toggle__thumb" aria-hidden="true"></span>
                </button>
              </div>

              <!-- Primary CTA -->
              <div class="sg-composer__action">
                <button type="button"
                  class="sg-calc-btn"
                  id="calc-btn"
                  ${disabled ? 'disabled' : ''}
                  aria-busy="${isCalc}"
                  aria-disabled="${disabled}">
                  ${isCalc
                    ? `<span class="sg-spinner-sm" aria-hidden="true"></span><span>Calculando…</span>`
                    : `<span>Calcular rota</span><iconify-icon icon="solar:arrow-right-bold" aria-hidden="true" class="sg-calc-btn__arrow"></iconify-icon>`}
                </button>
                ${hint ? `<p class="sg-form-hint${same ? ' is-warn' : ''}" role="status" aria-live="polite">${esc(hint)}</p>` : ''}
              </div>

            </div>
            <!-- /sg-composer -->

            <!-- ░░ QUICK ACCESS SECTION ░░ -->
            <section class="sg-quick-section" aria-label="Encontre rapidamente">
              <h2 class="sg-quick-section__title">Encontre rapidamente</h2>
              <div class="sg-quick-scroll" role="list" aria-label="Atalhos de categoria">
                ${QUICK_CATS.map(cat => `
                  <button type="button"
                    class="sg-quick-card"
                    data-cat-key="${cat.key}"
                    aria-label="${esc(cat.label)}: ${esc(cat.subtitle)}"
                    role="listitem">
                    <span class="sg-quick-card__icon-wrap" aria-hidden="true">
                      <iconify-icon icon="${cat.icon}" aria-hidden="true"></iconify-icon>
                    </span>
                    <span class="sg-quick-card__name">${esc(cat.label)}</span>
                    <span class="sg-quick-card__sub">${esc(cat.subtitle)}</span>
                  </button>
                `).join('')}
              </div>
            </section>

          `}
        </div>
        <!-- /sg-planning-scroll -->
      </main>

      <div id="plan-status" class="sr-only" role="status" aria-live="polite" aria-atomic="true"></div>
    </div>
  `;
}


// ---- SUMMARY ----

function renderSummary() {
  const route = navState.route;
  if (!route) { appMode = 'planning'; return renderPlanning(); }

  const dest    = findNode(planState.destinationCode);
  const origin  = findNode(planState.originCode);
  const fids    = [...navState.routeFloorIds];
  const steps   = navState.semanticSteps;
  const transitions = (route.segments ?? []).filter(s => s.type === 'transition').length;
  const destMeta = getNodeMeta(dest?.type ?? 'service');

  return `
    <div class="sg-summary-screen">
      <header class="sg-planning-header" role="banner">
        <button type="button" class="sg-icon-btn" id="back-to-planning-btn" aria-label="Voltar ao planejamento">
          <iconify-icon icon="solar:arrow-left-bold" aria-hidden="true"></iconify-icon>
        </button>
        <div class="sg-planning-brand" style="flex:1">
          <span class="sg-planning-name">Rota calculada</span>
          <span class="sg-planning-loc" style="color:var(--teal-600)">
            ${esc(origin ? getPublicNodeLabel(origin) : 'Origem')} → ${esc(dest ? getPublicNodeLabel(dest) : 'Destino')}
          </span>
        </div>
      </header>

      <main class="sg-summary-body">
        <!-- Destination hero -->
        <div class="sg-summary-hero">
          <div class="sg-summary-dest-icon" style="background:${destMeta.color}18;color:${destMeta.color}">
            <iconify-icon icon="${destMeta.icon}" aria-hidden="true"></iconify-icon>
          </div>
          <div>
            <p class="sg-summary-dest-floor">${esc(getPublicNodeSubtitle(dest) || getFloorLabel(dest?.floorId ?? ''))}</p>
            <h1 class="sg-summary-dest-name">${esc(dest ? getPublicNodeLabel(dest) : 'Destino')}</h1>
          </div>
          <span class="sg-mode-pill sg-mode-pill--${planState.routeMode}">
            <iconify-icon icon="${planState.routeMode === 'accessible' ? 'solar:accessibility-bold' : 'solar:bolt-bold'}" aria-hidden="true"></iconify-icon>
            ${getModeLabel(planState.routeMode)}
          </span>
        </div>

        <!-- Stats row -->
        <div class="sg-summary-stats" role="list">
          <div class="sg-stat" role="listitem">
            <span class="sg-stat__value">${fmtMin(route.estimatedMinutes)}<span class="sg-stat__unit">min</span></span>
            <span class="sg-stat__label">Estimado</span>
          </div>
          <div class="sg-stat-div" aria-hidden="true"></div>
          <div class="sg-stat" role="listitem">
            <span class="sg-stat__value">${steps.length}</span>
            <span class="sg-stat__label">${steps.length === 1 ? 'passo' : 'passos'}</span>
          </div>
          <div class="sg-stat-div" aria-hidden="true"></div>
          <div class="sg-stat" role="listitem">
            <span class="sg-stat__value">${fids.length || 1}</span>
            <span class="sg-stat__label">${(fids.length || 1) === 1 ? 'piso' : 'pisos'}</span>
          </div>
          ${transitions > 0 ? `
          <div class="sg-stat-div" aria-hidden="true"></div>
          <div class="sg-stat" role="listitem">
            <span class="sg-stat__value">${transitions}</span>
            <span class="sg-stat__label">${transitions === 1 ? 'conexão' : 'conexões'}</span>
          </div>` : ''}
        </div>

        <!-- First step preview -->
        ${steps[0] ? `<div class="sg-summary-preview">
          <div class="sg-summary-preview__icon">
            <iconify-icon icon="${steps[0].icon ?? 'solar:arrow-right-bold'}" aria-hidden="true"></iconify-icon>
          </div>
          <div>
            <p class="sg-summary-preview__label">Primeiro passo</p>
            <p class="sg-summary-preview__text">${esc(steps[0].text)}</p>
          </div>
        </div>` : ''}

        <!-- Actions -->
        <div class="sg-summary-actions">
          <button type="button" class="sg-btn-primary sg-btn-primary--large" id="start-nav-btn">
            <iconify-icon icon="solar:play-bold" aria-hidden="true"></iconify-icon>
            Iniciar navegação
          </button>
          <button type="button" class="sg-btn-secondary" id="view-map-btn">
            <iconify-icon icon="solar:map-bold" aria-hidden="true"></iconify-icon>
            Ver mapa
          </button>
        </div>

        <!-- Route overview preview (semantic only) -->
        <details class="sg-summary-steps">
          <summary class="sg-summary-steps__toggle">
            <iconify-icon icon="solar:list-bold" aria-hidden="true"></iconify-icon>
            Ver etapas
            <span class="sg-summary-steps__count">${steps.length}</span>
            <iconify-icon icon="solar:alt-arrow-down-bold" class="sg-summary-steps__chevron" aria-hidden="true"></iconify-icon>
          </summary>
          <ol class="sg-summary-steps__list">
            ${steps.map((s, i) => `<li class="sg-summary-step ${s.isTransition ? 'sg-summary-step--transition' : ''}">
              <span class="sg-summary-step__num" aria-hidden="true">${i + 1}</span>
              <span class="sg-summary-step__text">${esc(s.text)}</span>
              ${s.floorId ? `<span class="sg-summary-step__floor">${esc(getFloorLabel(s.floorId))}</span>` : ''}
            </li>`).join('')}
          </ol>
        </details>

        <button type="button" class="sg-edit-btn" id="edit-route-btn">
          <iconify-icon icon="solar:pen-bold" aria-hidden="true"></iconify-icon>
          Alterar rota
        </button>
      </main>
    </div>
  `;
}

// ---- NAVIGATION ----

function renderNavigation() {
  const fid = mapState.selectedFloorId;

  return `
    <div class="sg-nav-screen" id="nav-screen">
      <!-- Map area (top ~55%) -->
      <div class="sg-map-area" id="map-area" aria-label="Mapa do aeroporto — ${esc(getFloorLabel(fid))}" role="img">
        <div class="sg-map-wrapper" id="map-wrapper">
          <div class="sg-map-inner" id="map-inner">
            <!-- Base floor SVG (cached, never rebuilt on step change) -->
            <div id="map-base" class="sg-map-layer sg-map-layer--base">
              ${getBaseFloorSvg(fid)}
            </div>
            <!-- Route overlay SVG (rebuilt on step change only) -->
            <div id="map-route" class="sg-map-layer sg-map-layer--route">
              ${buildRouteOverlaySvg(fid)}
            </div>
          </div>
        </div>

        <!-- Brand block (doubles as "back to route summary") -->
        <header class="sg-nav-brand" role="banner">
          <button type="button" class="sg-nav-brand__btn" id="exit-nav-btn" aria-label="Voltar ao resumo da rota">
            <span class="sg-nav-brand__row">
              <span class="sg-nav-brand__logo">${navIcon('plane')}</span>
              <span class="sg-nav-brand__name">SkyGate</span>
            </span>
            <span class="sg-nav-brand__loc">
              ${navIcon('pin')}
              <span>FOR • Aeroporto de Fortaleza</span>
            </span>
          </button>
        </header>

        <!-- Help -->
        <button type="button" class="sg-nav-help" id="help-btn" aria-label="Ajuda">?</button>

        <!-- Right-side floating controls: floors + recenter -->
        <div class="sg-map-fabs" aria-label="Controles do mapa">
          ${renderFloorControl()}
          <button type="button" class="sg-map-fab" id="fit-segment-btn" aria-label="Centralizar no passo atual">
            ${navIcon('navigate')}
          </button>
        </div>

        <!-- Return to current step button -->
        ${mapState.manualFloor ? `<button type="button" class="sg-return-btn" id="return-btn" aria-label="Voltar ao passo atual">
          ${navIcon('navigate')}
          Voltar ao passo
        </button>` : ''}

        <!-- Floor change announcement (shown briefly on switch) -->
        <div class="sg-floor-announce ${mapState.manualFloor ? 'sg-floor-announce--manual' : ''}" id="floor-announce" aria-hidden="true">
          ${esc(getFloorLabel(fid))}
        </div>
      </div>

      <!-- Bottom sheet -->
      <div
        class="sg-instruction-card"
        id="instruction-card"
        role="region"
        aria-label="Instrução de navegação"
        aria-live="polite"
        aria-atomic="true"
      >${renderInstructionCardInner()}</div>

      <!-- Route overview overlay (semantic only — no graph nodes) -->
      ${uiState.showOverview ? renderOverlayOverview() : ''}
    </div>
  `;
}

/**
 * Bottom-sheet contents. Shared by the full render and the partial
 * step update so the two can never drift apart.
 */
function renderInstructionCardInner() {
  const steps   = navState.semanticSteps;
  const total   = steps.length;
  const stepIdx = navState.activeStepIndex;
  const curStep = steps[stepIdx];
  const nextStep = steps[stepIdx + 1];
  const isLast  = stepIdx >= total - 1;
  const accessible = planState.routeMode === 'accessible';
  const fid = mapState.selectedFloorId;
  const upcoming = steps.slice(stepIdx + 1);

  const nextDist = formatMeters(curStep?.distanceMeters ?? 0);

  return `
    <div class="sg-sheet-handle" aria-hidden="true"></div>

    <!-- Step rail -->
    <div class="sg-step-rail">
      <span class="sg-step-rail__label">Passo ${stepIdx + 1} de ${total}</span>
      ${total <= 10 ? `<div class="sg-step-rail__track" aria-hidden="true">
        ${Array.from({ length: total }, (_, i) => {
          const state = i < stepIdx ? 'is-done' : i === stepIdx ? 'is-active' : '';
          const seg = i === 0 ? '' : `<span class="sg-step-rail__seg ${i <= stepIdx ? 'is-done' : ''}"></span>`;
          return `${seg}<span class="sg-step-rail__dot ${state}"></span>`;
        }).join('')}
      </div>` : `<span class="sg-step-rail__counter" aria-hidden="true">${stepIdx + 1}/${total}</span>`}
    </div>

    <!-- Headline -->
    <div class="sg-instr-head">
      <span class="sg-instr-head__icon">${navIcon(getStepIconName(curStep))}</span>
      <h2 class="sg-instr-head__title" id="instr-text">${esc(curStep?.text ?? '')}</h2>
    </div>

    <!-- Context chips -->
    <div class="sg-nav-chips">
      <span class="sg-nav-chip">${navIcon('layers')}${esc(getFloorLabel(fid))}</span>
      ${accessible
        ? `<span class="sg-nav-chip sg-nav-chip--teal">${navIcon('wheelchair')}Rota acessível</span>`
        : `<span class="sg-nav-chip sg-nav-chip--teal">${navIcon('navigate')}Rota mais rápida</span>`}
    </div>

    <div class="sg-nav-divider" role="presentation"></div>

    <!-- Metrics -->
    <dl class="sg-metrics">
      <div class="sg-metric">
        <div class="sg-metric__top">${navIcon('clock')}<dd class="sg-metric__value">${fmtMin(navState.route?.estimatedMinutes ?? 0)} min</dd></div>
        <dt class="sg-metric__label">Tempo estimado</dt>
      </div>
      <div class="sg-metric">
        <div class="sg-metric__top">${navIcon('stairs')}<dd class="sg-metric__value">${countFloorChanges()}</dd></div>
        <dt class="sg-metric__label">Andares</dt>
      </div>
      <div class="sg-metric">
        <div class="sg-metric__top">${navIcon(getStepIconName(nextStep))}<dd class="sg-metric__value">${nextStep && nextDist ? `Em ${esc(nextDist)}` : 'Chegada'}</dd></div>
        <dt class="sg-metric__label">${esc(nextStep ? stripPeriod(nextStep.text) : 'Você chegou')}</dt>
      </div>
    </dl>

    <!-- Actions -->
    <div class="sg-nav-actions">
      <button type="button" class="sg-nav-next" id="nav-next"
        ${isLast ? 'disabled' : ''} aria-disabled="${isLast}"
        aria-label="${isLast ? 'Chegou ao destino' : 'Próxima instrução'}">
        ${isLast ? 'Chegou!' : 'Próximo'}${navIcon('chevron', 'sg-ico--sm')}
      </button>
      <button type="button" class="sg-nav-steps" id="instr-steps-btn" aria-haspopup="dialog">
        ${navIcon('list')}Ver etapas
      </button>
    </div>

    <!-- Upcoming steps -->
    ${upcoming.length ? `
      <h3 class="sg-next-steps__title">Próximas etapas</h3>
      <ul class="sg-next-steps">
        ${upcoming.map((s, i) => {
          const d = formatMeters(s.distanceMeters ?? 0);
          return `<li class="sg-next-step">
            <span class="sg-next-step__icon">${navIcon(getStepIconName(s))}</span>
            <div class="sg-next-step__body">
              <p class="sg-next-step__text">${esc(stripPeriod(s.text))}</p>
              ${d ? `<p class="sg-next-step__dist">${esc(d)}</p>` : ''}
            </div>
          </li>`;
        }).join('')}
      </ul>
    ` : ''}
  `;
}

function stripPeriod(t) {
  return String(t ?? '').replace(/\.\s*$/, '');
}

function renderFloorControl() {
  const cur = appData.floors.find(f => f.id === mapState.selectedFloorId) ?? appData.floors[0];
  const isOpen = uiState.floorMenuOpen && appData.floors.length > 1;

  return `<div class="sg-floor-ctrl ${isOpen ? 'is-open' : ''}" id="floor-ctrl">
    <button type="button" class="sg-map-fab" id="floor-trigger-btn"
      aria-haspopup="true" aria-expanded="${isOpen}"
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
            : onRoute ? '<iconify-icon icon="solar:map-point-bold" style="color:var(--teal-500)" aria-hidden="true"></iconify-icon>'
            : '<iconify-icon icon="solar:layers-minimalistic-linear" style="opacity:.4" aria-hidden="true"></iconify-icon>'}
          <span>${esc(f.name)}</span>
          ${onRoute && !active ? `<span class="sg-floor-item__badge" aria-hidden="true"></span>` : ''}
        </button>`;
      }).join('')}
    </div>` : ''}
  </div>`;
}

function renderOverlayOverview() {
  const steps = navState.semanticSteps;
  const curIdx = navState.activeStepIndex;

  return `<div class="sg-overview-overlay" id="route-overview" role="dialog" aria-modal="true" aria-labelledby="overview-title">
    <div class="sg-overview-backdrop" id="overview-backdrop" aria-hidden="true"></div>
    <div class="sg-overview-sheet">
      <div class="sg-overview-handle" aria-hidden="true"></div>
      <div class="sg-overview-header">
        <h2 class="sg-overview-title" id="overview-title">Visão geral da rota</h2>
        <button type="button" class="sg-icon-btn" id="close-overview" aria-label="Fechar visão geral">
          <iconify-icon icon="solar:close-circle-bold" aria-hidden="true"></iconify-icon>
        </button>
      </div>
      <div class="sg-overview-dest">
        <iconify-icon icon="solar:routing-2-bold" aria-hidden="true"></iconify-icon>
        ${esc(findNode(planState.destinationCode) ? getPublicNodeLabel(findNode(planState.destinationCode)) : 'Destino')} · ${fmtMin(navState.route?.estimatedMinutes ?? 0)} min
      </div>
      <ol class="sg-overview-list" aria-label="Passos da rota">
        ${steps.map((step, i) => {
          const done   = i < curIdx;
          const active = i === curIdx;
          const meta   = getNodeMeta(step.nodeType ?? 'corridor');
          return `<li class="sg-overview-item ${active ? 'is-active' : done ? 'is-done' : ''} ${step.isTransition ? 'is-transition' : ''}">
            <button type="button" class="sg-overview-item__btn" data-step-index="${i}" aria-label="Ir para passo ${i+1}: ${esc(step.text)}" aria-current="${active}">
              <div class="sg-overview-item__icon">
                ${done
                  ? '<iconify-icon icon="solar:check-circle-bold" aria-hidden="true"></iconify-icon>'
                  : `<iconify-icon icon="${step.icon ?? meta.icon}" aria-hidden="true"></iconify-icon>`}
              </div>
              <div>
                <p class="sg-overview-item__text">${esc(step.text)}</p>
                ${step.floorId ? `<p class="sg-overview-item__floor">${esc(getFloorLabel(step.floorId))}</p>` : ''}
              </div>
            </button>
            ${i < steps.length - 1 ? `<div class="sg-overview-connector" aria-hidden="true"></div>` : ''}
          </li>`;
        }).join('')}
      </ol>
    </div>
  </div>`;
}

// Curated, direction-appropriate subsets of the real SEARCH_CATEGORIES —
// chips are genuine filters (they narrow appData.nodes by type), never
// free-text shortcuts and never invented categories.
const ORIGIN_CHIP_KEYS = ['access', 'gates', 'restrooms', 'services', 'circulation'];
const DEST_CHIP_KEYS   = ['gates', 'food', 'shops', 'restrooms', 'services'];

function renderSearchOverlay() {
  const kind = uiState.searchOpenFor;
  if (!kind) return '';
  const isOrigin = kind === 'origin';
  const title = isOrigin ? 'Selecionar origem' : 'Selecionar destino';
  const ph = isOrigin
    ? 'Portão, banheiro, café, check-in…'
    : 'Portão 7, câmbio, sala VIP, farmácia…';
  const except = isOrigin ? planState.destinationCode : planState.originCode;
  const results = filterNodes(uiState.searchQuery, except, uiState.searchCategory);
  const grouped = groupByCategory(results);
  const chipKeys = isOrigin ? ORIGIN_CHIP_KEYS : DEST_CHIP_KEYS;
  const chips = chipKeys.map(key => SEARCH_CATEGORIES.find(c => c.key === key)).filter(Boolean);
  // Announce result count for screen readers
  const totalResults = Array.from(grouped.values()).reduce((a, b) => a + b.length, 0);

  return `<div class="sg-search-overlay" id="search-overlay" role="dialog" aria-modal="true" aria-labelledby="search-title">
    <button type="button" class="sg-search-backdrop" id="search-backdrop" tabindex="-1" aria-label="Fechar busca"></button>
    <div class="sg-search-sheet">
      <div class="sg-search-handle" aria-hidden="true"></div>
      <div class="sg-search-header">
        <h2 id="search-title" class="sg-search-title">${esc(title)}</h2>
        <button type="button" class="sg-icon-btn" id="close-search" aria-label="Fechar busca">
          <iconify-icon icon="solar:close-circle-bold" aria-hidden="true"></iconify-icon>
        </button>
      </div>
      <div class="sg-search-input-wrap">
        <iconify-icon icon="solar:magnifer-linear" aria-hidden="true"></iconify-icon>
        <input type="search" id="search-input" class="sg-search-input"
          placeholder="${esc(ph)}" value="${esc(uiState.searchQuery)}"
          autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="search"
          aria-label="${esc(title)}" aria-controls="search-results" data-kind="${kind}">
      </div>
      <div class="sg-quick-chips" role="group" aria-label="Filtrar por categoria">
        ${chips.map(c => `<button type="button" class="sg-chip${c.key === uiState.searchCategory ? ' is-active' : ''}"
          data-cat-key="${c.key}" aria-pressed="${c.key === uiState.searchCategory}">
          <iconify-icon icon="${c.icon}" aria-hidden="true"></iconify-icon>
          <span>${esc(c.label)}</span>
        </button>`).join('')}
      </div>
      <div id="search-results" class="sg-search-results"
        role="listbox"
        aria-live="polite"
        aria-label="Resultados de busca"
        aria-relevant="additions text">
        <span class="sr-only" aria-live="assertive" aria-atomic="true">
          ${totalResults > 0 ? `${totalResults} resultado${totalResults > 1 ? 's' : ''}` : (uiState.searchQuery || uiState.searchCategory) ? 'Nenhum resultado' : ''}
        </span>
        ${renderSearchResults(grouped, kind)}
      </div>
    </div>
  </div>`;
}

function renderSearchResults(grouped, kind) {
  if (!grouped.size) {
    const isEmpty = !uiState.searchQuery && !uiState.searchCategory;
    return `<div class="sg-search-empty" role="status">
      <iconify-icon icon="${isEmpty ? 'solar:magnifer-linear' : 'solar:map-point-wave-linear'}" aria-hidden="true"></iconify-icon>
      <p>${isEmpty ? 'Escolha uma categoria ou busque acima' : 'Nenhum resultado encontrado'}</p>
      <p class="sg-search-empty__sub">${isEmpty ? 'Ex: "Portão 18", "banheiro", "café"' : 'Tente outro termo ou outra categoria.'}</p>
    </div>`;
  }

  return Array.from(grouped).map(([g, nodes]) => `
    <div class="sg-search-group">
      <p class="sg-search-group__label">${esc(g)}</p>
      ${nodes.map(n => {
        const meta       = getNodeMeta(n.type);
        const pubLabel   = getPublicNodeLabel(n);         // passenger-facing name
        const pubSub     = getPublicNodeSubtitle(n);      // floor + category
        const accessible = CIRCULATION_TYPES.has(n.type);
        return `<div class="sg-search-row">
          <button type="button" class="sg-search-item" data-kind="${kind}" data-code="${esc(n.code)}"
            role="option"
            aria-label="${esc(pubLabel)} — ${esc(pubSub)}${accessible ? ' — Acessibilidade' : ''}"
            aria-selected="false">
            <span class="sg-search-item__icon" style="color:${meta.color};background:${meta.color}1f" aria-hidden="true">
              <iconify-icon icon="${meta.icon}"></iconify-icon>
            </span>
            <span class="sg-search-item__body">
              <span class="sg-search-item__name">${esc(pubLabel)}</span>
              <span class="sg-search-item__meta">${esc(pubSub)}</span>
            </span>
            ${accessible ? `<span class="sg-search-item__arrow" aria-label="Acessibilidade">
              <iconify-icon icon="solar:accessibility-bold" style="font-size:13px;color:var(--sg-teal-600)"></iconify-icon>
            </span>` : `<iconify-icon icon="solar:alt-arrow-right-linear" class="sg-search-item__arrow" aria-hidden="true"></iconify-icon>`}
          </button>
          <button type="button" class="sg-search-item__info" data-code="${esc(n.code)}"
            aria-label="Ver detalhes de ${esc(pubLabel)}">
            <iconify-icon icon="solar:info-circle-linear" aria-hidden="true"></iconify-icon>
          </button>
        </div>`;
      }).join('')}
    </div>
  `).join('');
}

/* Location / business details sheet — shows only fields the API actually
   returned; every field is hidden individually when missing rather than
   leaving an empty row. */
function renderLocationDetail() {
  const code = uiState.modalNodeCode;
  if (!code) return '';
  const node = findNode(code);
  if (!node) return '';

  const meta       = getNodeMeta(node.type);
  const label      = getPublicNodeLabel(node);
  const category   = getPublicNodeCategory(node);
  const floorLabel = getFloorLabel(node.floorId);
  const accessible = CIRCULATION_TYPES.has(node.type);
  const canRoute   = node.code !== planState.destinationCode;

  const rows = [
    node.hours && { icon: 'solar:clock-circle-bold', text: esc(node.hours) },
    node.phone && { icon: 'solar:phone-bold', text: esc(node.phone) },
    node.website && {
      icon: 'solar:global-bold',
      html: `<a href="${esc(node.website)}" target="_blank" rel="noopener noreferrer">${esc(node.website.replace(/^https?:\/\//, ''))}</a>`,
    },
  ].filter(Boolean);

  return `<div class="sg-detail-overlay" id="detail-overlay" role="dialog" aria-modal="true" aria-labelledby="detail-title">
    <button type="button" class="sg-detail-backdrop" id="detail-backdrop" tabindex="-1" aria-label="Fechar detalhes"></button>
    <div class="sg-detail-sheet">
      <div class="sg-detail-handle" aria-hidden="true"></div>
      <button type="button" class="sg-icon-btn sg-detail-close" id="close-detail" aria-label="Fechar detalhes">
        <iconify-icon icon="solar:close-circle-bold" aria-hidden="true"></iconify-icon>
      </button>

      ${node.image ? `<div class="sg-detail-image">
        <img src="${esc(node.image)}" alt="" loading="lazy">
      </div>` : ''}

      <div class="sg-detail-body">
        <div class="sg-detail-identity">
          ${node.logo
            ? `<img src="${esc(node.logo)}" alt="" class="sg-detail-logo" loading="lazy">`
            : `<span class="sg-detail-icon" style="color:${meta.color};background:${meta.color}1f" aria-hidden="true">
                 <iconify-icon icon="${meta.icon}"></iconify-icon>
               </span>`}
          <div class="sg-detail-identity__text">
            <h2 class="sg-detail-name" id="detail-title">${esc(label)}</h2>
            <p class="sg-detail-category">${esc(category)}</p>
          </div>
        </div>

        <div class="sg-detail-meta-row">
          <span class="sg-detail-meta-pill">
            <iconify-icon icon="solar:layers-minimalistic-bold" aria-hidden="true"></iconify-icon>
            ${esc(floorLabel)}
          </span>
          ${accessible ? `<span class="sg-detail-meta-pill sg-detail-meta-pill--access">
            <iconify-icon icon="solar:accessibility-bold" aria-hidden="true"></iconify-icon>
            Acessibilidade e circulação
          </span>` : ''}
        </div>

        ${rows.length ? `<div class="sg-detail-rows">
          ${rows.map(r => `<div class="sg-detail-row">
            <iconify-icon icon="${r.icon}" aria-hidden="true"></iconify-icon>
            ${r.html ?? `<span>${r.text}</span>`}
          </div>`).join('')}
        </div>` : ''}

        ${node.description ? `<p class="sg-detail-description">${esc(node.description)}</p>` : ''}
      </div>

      <div class="sg-detail-actions">
        <button type="button" class="sg-btn-primary sg-btn-primary--large" id="detail-route-btn"
          data-code="${esc(node.code)}" ${canRoute ? '' : 'disabled'}>
          <iconify-icon icon="solar:routing-2-bold" aria-hidden="true"></iconify-icon>
          Traçar rota
        </button>
      </div>
    </div>
  </div>`;
}

/* ============================================================
   11. MAIN RENDER — dispatch by appMode
   ============================================================ */

const root = document.getElementById('app');

function render() {
  switch (appMode) {
    case 'planning':   root.innerHTML = renderPlanning() + renderSearchOverlay() + renderLocationDetail(); break;
    case 'summary':    root.innerHTML = renderSummary() + renderSearchOverlay() + renderLocationDetail(); break;
    case 'navigation': root.innerHTML = renderNavigation() + renderSearchOverlay() + renderLocationDetail(); break;
  }
  bindEvents();
  if (appMode === 'navigation') {
    applyMapTransform(0);
    bindMapPan();
  }
}

/* Partial map update — only route overlay, not base or full render */
function updateRouteOverlay() {
  const routeEl = $('map-route');
  if (!routeEl) return;
  requestAnimationFrame(() => {
    routeEl.innerHTML = buildRouteOverlaySvg(mapState.selectedFloorId);
  });
}

/* Full map swap on floor change */
function updateMapForFloor(floorId) {
  const baseEl  = $('map-base');
  const routeEl = $('map-route');
  if (!baseEl || !routeEl) return;
  requestAnimationFrame(() => {
    baseEl.innerHTML  = getBaseFloorSvg(floorId);
    routeEl.innerHTML = buildRouteOverlaySvg(floorId);
    applyMapTransform(0);
    // Brief floor label flash
    const ann = $('floor-announce');
    if (ann) {
      ann.textContent = getFloorLabel(floorId);
      ann.classList.add('is-visible');
      setTimeout(() => ann.classList.remove('is-visible'), 1200);
    }
    // Update floor control without full re-render
    const fc = $('floor-ctrl');
    if (fc) { fc.outerHTML = renderFloorControl(); bindFloorControlEvents(); }
    // Update return button
    const rb = $('return-btn');
    const showReturn = navState.route && mapState.manualFloor;
    if (rb) rb.classList.toggle('is-hidden', !showReturn);
  });
}

function updateSearchResults_() {
  const el = $('search-results');
  if (!el || !uiState.searchOpenFor) return;
  const except = uiState.searchOpenFor === 'origin' ? planState.destinationCode : planState.originCode;
  const results = filterNodes(uiState.searchQuery, except, uiState.searchCategory);
  const grouped = groupByCategory(results);
  el.innerHTML = renderSearchResults(grouped, uiState.searchOpenFor);
  bindSearchItemEvents();
}

function updateSearchChips_() {
  document.querySelectorAll('.sg-chip').forEach(btn => {
    const active = btn.dataset.catKey === uiState.searchCategory;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-pressed', String(active));
  });
}

/* ============================================================
   12. FLOOR SWITCHING
   ============================================================ */

function switchFloor(fid, isManual = true) {
  if (fid === mapState.selectedFloorId && !isManual) return;
  mapState.selectedFloorId = fid;

  if (isManual && navState.route) {
    const curStepFloor = navState.semanticSteps[navState.activeStepIndex]?.floorId ?? '';
    mapState.manualFloor = fid !== curStepFloor;
  } else {
    mapState.manualFloor = false;
  }

  // Announce floor change
  const liveEl = $('floor-live');
  if (liveEl) liveEl.textContent = `${getFloorLabel(fid)}`;

  if (appMode === 'navigation') {
    updateMapForFloor(fid);
  }
}

/* ============================================================
   13. EVENT BINDING
   ============================================================ */

let _searchDebounce = null;

function bindEvents() {
  // Planning
  document.querySelectorAll('.open-search').forEach(btn =>
    btn.addEventListener('click', () => openSearch(btn.dataset.kind))
  );
  document.querySelectorAll('.clear-loc').forEach(btn =>
    btn.addEventListener('click', () => clearLocation(btn.dataset.kind))
  );
  $('swap-btn')?.addEventListener('click', swapLocations);
  document.querySelectorAll('[data-mode]').forEach(btn =>
    btn.addEventListener('click', () => setRouteMode(btn.dataset.mode))
  );
  $('calc-btn')?.addEventListener('click', handleCalculate);
  $('help-btn')?.addEventListener('click', showHelp);
  $('retry-btn')?.addEventListener('click', init);
  $('dismiss-error')?.addEventListener('click', () => { uiState.error = ''; render(); });

  // Accessible route toggle (compact replacement for two big mode cards)
  $('accessible-toggle')?.addEventListener('click', toggleAccessibleRoute);

  // Quick category shortcuts — open destination search pre-filtered by category
  document.querySelectorAll('.sg-quick__item, .sg-quick-item, .sg-quick-card').forEach(btn =>
    btn.addEventListener('click', () => openCategorySearch(btn.dataset.catKey))
  );

  // Clear-location spans (role=button, keyboard accessible)
  document.querySelectorAll('.sg-journey-clear').forEach(el => {
    el.addEventListener('click', e => { e.stopPropagation(); clearLocation(el.dataset.kind); });
    el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); clearLocation(el.dataset.kind); } });
  });

  // Summary
  $('start-nav-btn')?.addEventListener('click', startNavigation);
  $('view-map-btn')?.addEventListener('click', startNavigation); // same action, enters nav mode
  $('back-to-planning-btn')?.addEventListener('click', () => { appMode = 'planning'; render(); });
  $('edit-route-btn')?.addEventListener('click', editRoute);

  // Navigation
  $('exit-nav-btn')?.addEventListener('click', exitNavigation);
  $('nav-prev')?.addEventListener('click', () => advanceStep(-1));
  $('nav-next')?.addEventListener('click', () => advanceStep(1));
  $('fit-segment-btn')?.addEventListener('click', () => fitStepToView(navState.activeStepIndex));
  $('zoom-in-btn')?.addEventListener('click', () => zoomAt(0.4));
  $('zoom-out-btn')?.addEventListener('click', () => zoomAt(-0.4));
  $('overview-btn')?.addEventListener('click', openOverview);
  $('instr-steps-btn')?.addEventListener('click', openOverview);
  $('return-btn')?.addEventListener('click', returnToCurrentStep);

  // Floor control
  bindFloorControlEvents();

  // Overview
  $('close-overview')?.addEventListener('click', closeOverview);
  $('overview-backdrop')?.addEventListener('click', closeOverview);
  document.querySelectorAll('.sg-overview-item__btn').forEach(btn =>
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.stepIndex, 10);
      if (!isNaN(idx)) { closeOverview(); goToStep(idx); }
    })
  );

  // Search
  bindSearchOverlayEvents();

  // Location detail sheet
  $('detail-backdrop')?.addEventListener('click', closeLocationDetail);
  $('close-detail')?.addEventListener('click', closeLocationDetail);
  $('detail-route-btn')?.addEventListener('click', e => {
    const code = e.currentTarget.dataset.code;
    if (code) traceRouteToLocation(code);
  });
}

function bindFloorControlEvents() {
  $('floor-trigger-btn')?.addEventListener('click', e => {
    e.stopPropagation();
    uiState.floorMenuOpen = !uiState.floorMenuOpen;
    if (appMode === 'navigation') {
      const fc = $('floor-ctrl');
      if (fc) { fc.outerHTML = renderFloorControl(); bindFloorControlEvents(); }
    } else {
      render();
    }
  });
  document.querySelectorAll('.sg-floor-item').forEach(btn =>
    btn.addEventListener('click', e => {
      e.stopPropagation();
      uiState.floorMenuOpen = false;
      switchFloor(btn.dataset.floorId, true);
    })
  );
  document.addEventListener('click', closeFloorMenuOnOutside);
}

function closeFloorMenuOnOutside(e) {
  if (!uiState.floorMenuOpen) return;
  if (!e.target.closest('#floor-ctrl')) {
    uiState.floorMenuOpen = false;
    const fc = $('floor-ctrl');
    if (fc) { fc.outerHTML = renderFloorControl(); bindFloorControlEvents(); }
    document.removeEventListener('click', closeFloorMenuOnOutside);
  }
}

function bindSearchOverlayEvents() {
  $('search-backdrop')?.addEventListener('click', closeSearch);
  $('close-search')?.addEventListener('click', closeSearch);
  const input = $('search-input');
  if (input) {
    input.addEventListener('input', e => {
      uiState.searchQuery = e.target.value;
      // Typing exits category-filter mode — text search and chip filters are mutually exclusive
      if (uiState.searchCategory) {
        uiState.searchCategory = '';
        updateSearchChips_();
      }
      clearTimeout(_searchDebounce);
      _searchDebounce = setTimeout(updateSearchResults_, DEBOUNCE_MS);
    });
    requestAnimationFrame(() => input.focus({ preventScroll: true }));
  }
  bindSearchItemEvents();
  document.querySelectorAll('.sg-chip').forEach(btn =>
    btn.addEventListener('click', () => {
      const key = btn.dataset.catKey;
      uiState.searchCategory = uiState.searchCategory === key ? '' : key;
      uiState.searchQuery = '';
      const inp = $('search-input');
      if (inp) inp.value = '';
      updateSearchChips_();
      updateSearchResults_();
    })
  );
}

function bindSearchItemEvents() {
  document.querySelectorAll('.sg-search-item').forEach(btn =>
    btn.addEventListener('click', () => selectLocation(btn.dataset.kind, btn.dataset.code))
  );
  document.querySelectorAll('.sg-search-item__info').forEach(btn =>
    btn.addEventListener('click', e => { e.stopPropagation(); openLocationDetail(btn.dataset.code); })
  );
}

// Carousel swipe for instruction card
let _instrSwipeStart = null;
function bindInstructionSwipe() {
  const card = $('instruction-card');
  if (!card) return;
  card.addEventListener('touchstart', e => {
    if (e.touches.length !== 1) return;
    _instrSwipeStart = { x: e.touches[0].clientX, t: Date.now() };
  }, { passive: true });
  card.addEventListener('touchend', e => {
    if (!_instrSwipeStart) return;
    const dx = e.changedTouches[0].clientX - _instrSwipeStart.x;
    const dt = Date.now() - _instrSwipeStart.t;
    _instrSwipeStart = null;
    if (Math.abs(dx) < 40 || dt > 500) return;
    if (dx < 0) advanceStep(1);
    else advanceStep(-1);
  }, { passive: true });
}

// Keyboard
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (uiState.modalNodeCode) { closeLocationDetail(); return; }
    if (uiState.showOverview)  { closeOverview(); return; }
    if (uiState.searchOpenFor) { e.preventDefault(); closeSearch(); return; }
    if (uiState.floorMenuOpen) { uiState.floorMenuOpen = false; document.getElementById('floor-ctrl')?.querySelector('button')?.focus(); return; }
    if (appMode === 'navigation') { exitNavigation(); return; }
  }
  if (appMode === 'navigation' && !uiState.searchOpenFor && !uiState.showOverview) {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); advanceStep(1); }
    if (e.key === 'ArrowLeft'  || e.key === 'ArrowUp')   { e.preventDefault(); advanceStep(-1); }
  }
});

/* ============================================================
   14. ACTIONS
   ============================================================ */

function openSearch(kind) {
  if (!['origin', 'destination'].includes(kind)) return;
  clearTimeout(_searchDebounce);
  uiState.searchOpenFor = kind;
  uiState.searchQuery = '';
  uiState.searchCategory = '';
  render();
}

function closeSearch() {
  if (!uiState.searchOpenFor) return;
  const prev = uiState.searchOpenFor;
  uiState.searchOpenFor = '';
  uiState.searchQuery = '';
  uiState.searchCategory = '';
  clearTimeout(_searchDebounce);
  render();
  requestAnimationFrame(() => $(`${prev}-btn`)?.focus({ preventScroll: true }));
}

let _detailTriggerEl = null;

function openLocationDetail(code) {
  if (!code || !findNode(code)) return;
  _detailTriggerEl = document.activeElement;
  uiState.modalNodeCode = code;
  render();
  requestAnimationFrame(() => $('close-detail')?.focus({ preventScroll: true }));
}

function closeLocationDetail() {
  if (!uiState.modalNodeCode) return;
  uiState.modalNodeCode = '';
  render();
  const trigger = _detailTriggerEl;
  _detailTriggerEl = null;
  requestAnimationFrame(() => trigger?.focus?.({ preventScroll: true }));
}

function traceRouteToLocation(code) {
  uiState.modalNodeCode = '';
  selectLocation('destination', code);
}

function selectLocation(kind, code) {
  const other = kind === 'origin' ? planState.destinationCode : planState.originCode;
  if (!code || code === other) return;
  if (kind === 'origin')      planState.originCode = code;
  if (kind === 'destination') planState.destinationCode = code;
  navState.route = null;
  uiState.searchOpenFor = '';
  uiState.searchQuery = '';
  uiState.searchCategory = '';
  uiState.error = '';
  clearTimeout(_searchDebounce);
  if (appMode !== 'planning') { appMode = 'planning'; }
  render();
}

function clearLocation(kind) {
  if (kind === 'origin')      planState.originCode = '';
  if (kind === 'destination') planState.destinationCode = '';
  navState.route = null;
  navState.routeFloorIds = new Set();
  uiState.error = '';
  if (appMode !== 'planning') { appMode = 'planning'; }
  render();
  requestAnimationFrame(() => $(`${kind}-btn`)?.focus({ preventScroll: true }));
}

function swapLocations() {
  [planState.originCode, planState.destinationCode] = [planState.destinationCode, planState.originCode];
  navState.route = null;
  render();
}

function setRouteMode(mode) {
  // Legacy path — used by summary screen back button etc.
  if (!['fastest', 'accessible'].includes(mode) || planState.routeMode === mode) return;
  planState.routeMode = mode;
  planState.accessibleRoute = mode === 'accessible';
  navState.route = null;
  render();
}

function toggleAccessibleRoute() {
  planState.accessibleRoute = !planState.accessibleRoute;
  planState.routeMode = planState.accessibleRoute ? 'accessible' : 'fastest';
  navState.route = null;
  // Announce state change for screen readers
  const liveEl = $('plan-status');
  if (liveEl) liveEl.textContent = planState.accessibleRoute
    ? 'Rota acessível ativada. Usará elevadores e evitará escadas.'
    : 'Rota acessível desativada. Rota mais rápida será usada.';
  // Update only the toggle without full re-render for performance
  const toggleEl = $('accessible-toggle');
  if (toggleEl) {
    const on = planState.accessibleRoute;
    toggleEl.classList.toggle('is-on', on);
    toggleEl.setAttribute('aria-checked', String(on));
    // Find the accessibility icon in the row label (new structure)
    const rowLabel = toggleEl.closest('.sg-access-row')?.querySelector('.sg-access-row__icon');
    const icon = rowLabel ?? toggleEl.previousElementSibling?.querySelector('iconify-icon');
    if (icon) {
      icon.classList.toggle('is-on', on);
      icon.classList.toggle('is-active', on); // backward compat
    }
  } else {
    render();
  }
}

function openCategorySearch(catKey) {
  // Open destination search pre-filtered by category
  const cat = SEARCH_CATEGORIES.find(c => c.key === catKey);
  if (!cat) return;
  clearTimeout(_searchDebounce);
  uiState.searchOpenFor = 'destination';
  uiState.searchQuery = '';
  uiState.searchCategory = cat.key;
  render();
}

function editRoute() {
  navState.route = null;
  navState.routeFloorIds = new Set();
  navState.semanticSteps = [];
  navState.activeStepIndex = 0;
  appMode = 'planning';
  render();
}

function openOverview() {
  uiState.showOverview = true;
  // Partial: just inject the overlay
  const existing = $('route-overview');
  if (existing) return;
  const navScreen = $('nav-screen');
  if (navScreen) {
    navScreen.insertAdjacentHTML('beforeend', renderOverlayOverview());
    document.querySelector('.sg-overview-item__btn')?.focus({ preventScroll: true });
    // Bind events for new overlay
    $('close-overview')?.addEventListener('click', closeOverview);
    $('overview-backdrop')?.addEventListener('click', closeOverview);
    document.querySelectorAll('.sg-overview-item__btn').forEach(btn =>
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.stepIndex, 10);
        if (!isNaN(idx)) { closeOverview(); goToStep(idx); }
      })
    );
  }
}

function closeOverview() {
  uiState.showOverview = false;
  $('route-overview')?.remove();
}

function returnToCurrentStep() {
  if (!navState.route) return;
  const stepFloor = navState.semanticSteps[navState.activeStepIndex]?.floorId
    ?? [...navState.routeFloorIds][0]
    ?? appData.floors[0]?.id;
  if (stepFloor) { switchFloor(stepFloor, false); }
  mapState.manualFloor = false;
  const rb = $('return-btn');
  if (rb) rb.classList.add('is-hidden');
  requestAnimationFrame(() => fitStepToView(navState.activeStepIndex));
}

function startNavigation() {
  if (!navState.semanticSteps.length) return;
  appMode = 'navigation';
  navState.activeStepIndex = 0;

  const firstStep = navState.semanticSteps[0];
  const targetFloor = firstStep?.floorId || findNode(planState.originCode)?.floorId || mapState.selectedFloorId;
  mapState.selectedFloorId = targetFloor;
  mapState.manualFloor = false;

  render();

  // After render: animate the route in and frame the whole journey, so the
  // "you are here → destination" overview matches the reference screen.
  if (!prefersReducedMotion()) {
    requestAnimationFrame(() => {
      const routeEl = document.querySelector('.sg-route-active');
      if (routeEl) { routeEl.classList.add('sg-route-draw'); }
      setTimeout(fitFullRoute, 100);
    });
  } else {
    requestAnimationFrame(fitFullRoute);
  }
  bindInstructionSwipe();
}

function exitNavigation() {
  appMode = 'summary';
  mapState.manualFloor = false;
  render();
}

function goToStep(idx) {
  const total = navState.semanticSteps.length;
  if (idx < 0 || idx >= total) return;
  navState.activeStepIndex = idx;
  const step = navState.semanticSteps[idx];
  if (step?.floorId && step.floorId !== mapState.selectedFloorId) {
    switchFloor(step.floorId, false);
  }
  updateInstructionCard();
  updateRouteOverlay();
  requestAnimationFrame(() => fitStepToView(idx));
  announceStep(idx, step);
}

function advanceStep(delta) {
  const total = navState.semanticSteps.length;
  const next  = navState.activeStepIndex + delta;
  if (next < 0 || next >= total) return;
  navState.activeStepIndex = next;

  const step = navState.semanticSteps[next];
  if (step?.floorId && step.floorId !== mapState.selectedFloorId) {
    switchFloor(step.floorId, false);
  }

  // Update only changed parts (no full re-render)
  updateInstructionCard();
  updateRouteOverlay();
  requestAnimationFrame(() => {
    if (!prefersReducedMotion()) fitStepToView(next);
  });
  announceStep(next, step);
}

function updateInstructionCard() {
  const card = $('instruction-card');
  if (!card) return;

  card.innerHTML = renderInstructionCardInner();
  card.scrollTop = 0;

  // Re-bind the controls the sheet owns
  $('nav-next')?.addEventListener('click', () => advanceStep(1));
  $('instr-steps-btn')?.addEventListener('click', openOverview);
  bindInstructionSwipe();
}

function announceStep(idx, step) {
  const liveEl = $('nav-live');
  if (liveEl) liveEl.textContent = `Passo ${idx + 1} de ${navState.semanticSteps.length}: ${step?.text ?? ''}`;
}

function showHelp() {
  const existing = $('help-toast');
  if (existing) { existing.remove(); return; }
  const el = document.createElement('div');
  el.id = 'help-toast';
  el.setAttribute('role', 'status');
  el.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#0f172a;color:#fff;padding:14px 20px;border-radius:14px;font-size:13px;font-weight:600;box-shadow:0 8px 28px rgba(0,0,0,.4);z-index:300;max-width:320px;text-align:center;line-height:1.6';
  el.innerHTML = '<strong>Como usar o SkyGate</strong><br>1. Escolha origem e destino<br>2. Selecione o tipo de rota<br>3. Calcule e toque em "Iniciar navegação"<br>4. Use ← Anterior / Próximo → para navegar';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 6000);
}

/* ============================================================
   15. ROUTE CALCULATION
   ============================================================ */

async function handleCalculate() {
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

    appMode = 'summary';

  } catch (err) {
    console.error('[SkyGate]', err);
    navState.route = null;
    uiState.error = routeError(err);
  } finally {
    uiState.loading = '';
    render();
  }
}

function routeError(err) {
  if (err?.kind === 'no_path') return 'Não foi possível encontrar um caminho entre os pontos selecionados.';
  if (err instanceof SkyGateApiError) {
    if (err.kind === 'network') return 'Sem conexão. Verifique sua internet e tente novamente.';
    if (err.status === 404)     return 'Rota não encontrada para estes pontos.';
    if (err.status === 422)     return 'Não foi possível calcular esta rota. Verifique origem e destino.';
    if (err.status >= 500)      return 'Servidor temporariamente indisponível. Tente novamente.';
  }
  return 'Não foi possível calcular a rota. Tente novamente.';
}

/* ============================================================
   16. INIT
   ============================================================ */

/** Preload base SVGs for all floors after initial load */
function preloadFloorSvgs() {
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

async function init() {
  try {
    uiState.loading = 'airports';
    uiState.error = '';
    appMode = 'planning';
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
    appMode = 'planning';
    render();
    // Preload after a short delay to not block initial render
    setTimeout(preloadFloorSvgs, 800);
  }
}

init();

// Expose presentation tests to browser console for validation
// Usage: window.__sgPresentationTests() after page load
// All tests are defined in nodePresentation.js
